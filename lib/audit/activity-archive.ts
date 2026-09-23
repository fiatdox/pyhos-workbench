import 'server-only'
import { createGzip } from 'node:zlib'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { join, resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { coreKonDb } from '@/lib/db/core-kon'
import { coreKonConfig } from '@/lib/db/env'
import { activityLog } from '@/lib/db/schema/core-kon'

/**
 * ย้ายร่องรอยเก่าออกจากตารางไปเก็บเป็นไฟล์ แล้วลบออกจากฐาน
 *
 * ตาราง activity_log โตทุกคำขอที่เข้ามา ปล่อยไว้จะกลายเป็นตารางที่ใหญ่ที่สุดใน
 * ฐานภายในไม่กี่เดือน และหน้าจอที่คนใช้จริงจะช้าลงตามไปด้วย แต่ลบทิ้งเฉย ๆ ไม่ได้
 * เพราะเป็นเอกสารที่อาจต้องใช้สอบเหตุการณ์ย้อนหลัง — ต้องเขียนไฟล์ให้เสร็จก่อน
 * แล้วค่อยลบเสมอ
 *
 * รูปแบบไฟล์เป็น JSON บรรทัดละแถวแล้วบีบอัด (.jsonl.gz) ไม่ใช่ CSV เพราะไฟล์นี้
 * ไม่ได้มีไว้ให้คนเปิดอ่านเป็นปกติ แต่มีไว้ให้กู้กลับเข้าตารางได้ครบทุกคอลัมน์
 * ถ้าวันหนึ่งต้องใช้ — CSV จะทำให้ค่าว่างกับสตริงว่างแยกกันไม่ออก
 *
 * ไฟล์มี HN อยู่ข้างใน ต้องเก็บนอกโฟลเดอร์ที่เว็บเสิร์ฟได้เด็ดขาด ค่าตั้งต้นจึงอยู่
 * นอก public/ และควรตั้ง ACTIVITY_ARCHIVE_DIR ไปยังปลายทางสำรองข้อมูลจริงของ
 * โรงพยาบาล ไม่ใช่ปล่อยไว้ในเครื่องที่รันแอป
 */

/** เก็บไว้ในตารางอย่างน้อยเท่านี้เสมอ ต่อให้สั่งให้ตัดสั้นกว่านี้ */
export const ARCHIVE_MIN_KEEP_DAYS = 90

/** ค่าตั้งต้นเมื่อไม่ได้ระบุมา — ครึ่งปี */
export const ARCHIVE_DEFAULT_KEEP_DAYS = 180

/** อ่านทีละก้อนเท่านี้ ไม่ดึงทั้งหมดขึ้นหน่วยความจำ */
const CHUNK = 5_000

export type ArchiveResult = {
  /** จำนวนแถวที่ย้ายออกไป */
  moved: number
  /** เส้นทางไฟล์ที่เขียน — null เมื่อไม่มีแถวเก่าให้ย้าย */
  file: string | null
  bytes: number
  /** วันที่เก่าที่สุดที่ยังเหลืออยู่ในตารางหลังตัด */
  cutoff: string
}

export type ArchiveStatus = {
  rows: number
  /** ขนาดตารางรวมดัชนี อ่านง่าย เช่น '128 MB' */
  size: string
  oldest: string | null
  newest: string | null
  /** จำนวนแถวที่เก่ากว่าเกณฑ์ที่ตั้งไว้ตอนนี้ */
  archivable: number
  keepDays: number
  directory: string
}

function archiveDir(): string {
  // resolve เทียบกับ cwd ของโปรเซส — รองรับทั้งค่าที่เป็น path สัมบูรณ์และสัมพัทธ์
  return resolve(process.env.ACTIVITY_ARCHIVE_DIR ?? '.archive/activity')
}

function keepDaysFrom(input: number | null | undefined): number {
  const value = Number(input ?? ARCHIVE_DEFAULT_KEEP_DAYS)
  if (!Number.isFinite(value)) return ARCHIVE_DEFAULT_KEEP_DAYS
  return Math.max(ARCHIVE_MIN_KEEP_DAYS, Math.trunc(value))
}

const rows = (result: unknown) => result as unknown as Record<string, unknown>[]

/**
 * ชื่อตารางแบบเต็มสำหรับ pg_total_relation_size ซึ่งรับเป็นข้อความ ไม่ใช่ตัวระบุ
 *
 * ส่งเป็นพารามิเตอร์ปกติได้ ไม่ต้อง sql.raw — ค่ามาจากไฟล์ตั้งค่าของแอปเอง
 * ไม่ได้มาจากผู้ใช้ แต่การส่งเป็นพารามิเตอร์ปิดทางไว้ตั้งแต่ต้นโดยไม่มีต้นทุน
 */
const QUALIFIED_NAME = `${coreKonConfig.schema}.activity_log`

/** สถานะปัจจุบันของตาราง — หน้าจอใช้ตัดสินว่าถึงเวลาตัดหรือยัง */
export async function activityStatus(keepDaysInput?: number | null): Promise<ArchiveStatus> {
  const keepDays = keepDaysFrom(keepDaysInput)

  const [summary] = rows(
    await coreKonDb.execute(sql`
      SELECT COUNT(*)::bigint AS rows,
             MIN(created_at) AS oldest,
             MAX(created_at) AS newest,
             COUNT(*) FILTER (
               WHERE created_at < now() - (${keepDays} || ' days')::interval
             )::bigint AS archivable,
             pg_size_pretty(pg_total_relation_size(${QUALIFIED_NAME})) AS size
      FROM ${activityLog}`),
  )

  const iso = (value: unknown) => (value ? new Date(String(value)).toISOString() : null)

  return {
    rows: Number(summary?.rows ?? 0),
    size: String(summary?.size ?? '0 bytes'),
    oldest: iso(summary?.oldest),
    newest: iso(summary?.newest),
    archivable: Number(summary?.archivable ?? 0),
    keepDays,
    directory: archiveDir(),
  }
}

/**
 * ย้ายแถวที่เก่ากว่าเกณฑ์ออกไปเป็นไฟล์แล้วลบ
 *
 * ลำดับสำคัญมาก: เขียนไฟล์ชั่วคราวให้ครบ → ปิดไฟล์ → เปลี่ยนชื่อเป็นไฟล์จริง →
 * แล้วจึงลบจากฐาน ถ้าล้มตรงไหนก่อนขั้นสุดท้าย ข้อมูลยังอยู่ในตารางครบ เสียอย่างมาก
 * คือมีไฟล์ .part ค้างให้ลบทิ้ง ซึ่งดีกว่าลบไปแล้วพบทีหลังว่าไฟล์เขียนไม่สำเร็จ
 *
 * เลือกแถวด้วยเงื่อนไขสองชั้นเสมอ: created_at เก่ากว่าเส้นตาย **และ** id ไม่เกิน
 * ตัวสุดท้ายที่เขียนลงไฟล์ ต้องมีทั้งคู่ —
 *
 * - ลำพัง created_at ไม่พอ เพราะระหว่างเขียนไฟล์ (หลายวินาทีถ้าเป็นล้านแถว)
 *   มีแถวใหม่ไหลเข้ามาตลอด ถ้า now() ขยับ เส้นตายจะขยับตาม แล้วจะลบแถวที่ยัง
 *   ไม่ได้เขียนลงไฟล์ จึงตรึงเส้นตายเป็นค่าเดียวที่คำนวณครั้งเดียวตั้งแต่ต้น
 * - ลำพัง id ก็ไม่พอ เพราะ id เรียงตามลำดับที่ "เขียนลงตาราง" ไม่ใช่ลำดับของ
 *   created_at ปกติสองอย่างนี้เดินไปด้วยกัน แต่ถ้ามีแถวไหนถูกเติมย้อนหลัง
 *   (นำเข้าของเก่า หรือกู้ไฟล์สำรองกลับ) id ของแถวเก่าจะสูงกว่าแถวใหม่ แล้ว
 *   เงื่อนไข id อย่างเดียวจะกวาดแถวปัจจุบันไปด้วยทั้งหมด — ตอนทดสอบเกิดเคสนี้จริง
 *   และลบเกินไป 231 แถวที่ยังไม่ถึงกำหนด
 */
export async function archiveOldActivity(input: {
  keepDays?: number | null
}): Promise<ArchiveResult> {
  const keepDays = keepDaysFrom(input.keepDays)
  const dir = archiveDir()

  // ตรึงเส้นตายไว้ก่อนทำอะไรทั้งสิ้น ทุกคิวรีหลังจากนี้อ้างค่าเดียวกันหมด
  //
  // ส่งเป็นสตริง ISO แล้ว cast ในคิวรี ไม่ส่ง Date ตรง ๆ — ไดรเวอร์ postgres-js
  // รับ Date ในเทมเพลต sql ของ drizzle ไม่ได้ (โยน "must be of type string")
  const cutoff = new Date(Date.now() - keepDays * 86_400_000).toISOString()

  const [edge] = rows(
    await coreKonDb.execute(sql`
      SELECT MAX(id)::bigint AS max_id, COUNT(*)::bigint AS n
      FROM ${activityLog}
      WHERE created_at < ${cutoff}::timestamptz`),
  )

  const lastId = Number(edge?.max_id ?? 0)
  const total = Number(edge?.n ?? 0)

  if (!lastId || total === 0) return { moved: 0, file: null, bytes: 0, cutoff }

  await mkdir(dir, { recursive: true })

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const finalPath = join(dir, `activity-${stamp}-ถึงรหัส${lastId}.jsonl.gz`)
  const partPath = `${finalPath}.part`

  // ดึงทีละก้อนแล้วป้อนเข้าสตรีม — ตารางที่ค้างมาหลายเดือนมีได้เป็นล้านแถว
  // ถ้าดึงทั้งหมดมาต่อสตริงเดียวจะกินหน่วยความจำจนโปรเซสตาย
  async function* lines() {
    let after = 0
    for (;;) {
      const batch = rows(
        await coreKonDb.execute(sql`
          SELECT * FROM ${activityLog}
          WHERE id <= ${lastId} AND id > ${after} AND created_at < ${cutoff}::timestamptz
          ORDER BY id
          LIMIT ${CHUNK}`),
      )
      if (batch.length === 0) return
      yield batch.map(row => `${JSON.stringify(row)}\n`).join('')
      after = Number(batch[batch.length - 1].id)
    }
  }

  await pipeline(Readable.from(lines()), createGzip(), createWriteStream(partPath))
  await rename(partPath, finalPath)
  const written = await stat(finalPath)

  // ลบเป็นก้อน ไม่ใช่คำสั่งเดียว — การลบล้านแถวรวดเดียวจะล็อกตารางนานจนคำขอ
  // ที่กำลังเขียนล็อกอยู่ต้องรอ ซึ่งแปลว่าทั้งระบบช้าตามไปด้วย
  let moved = 0
  for (;;) {
    const result = await coreKonDb.execute(sql`
      DELETE FROM ${activityLog}
      WHERE id IN (
        SELECT id FROM ${activityLog}
        WHERE id <= ${lastId} AND created_at < ${cutoff}::timestamptz
        ORDER BY id LIMIT ${CHUNK}
      )`)
    const count = Number((result as unknown as { count?: number }).count ?? 0)
    moved += count
    if (count === 0) break
  }

  // Postgres ไม่คืนเนื้อที่ให้เองหลัง DELETE — แถวที่ลบยังกินที่อยู่จนกว่าจะ VACUUM
  // ตอนทดสอบลบ 12,000 แถวแล้วขนาดตารางยังเท่าเดิมทุกไบต์ ซึ่งขัดกับจุดประสงค์
  // ทั้งหมดของการตัดข้อมูล สั่งเองตรงนี้เลย ไม่รอ autovacuum ที่ไม่รู้ว่าจะมาเมื่อไร
  // ถ้าสั่งไม่ได้ (สิทธิ์ไม่พอ) ก็แค่ไม่ได้คืนที่ ข้อมูลยังถูกย้ายออกเรียบร้อยแล้ว
  try {
    await coreKonDb.execute(sql`VACUUM (ANALYZE) ${activityLog}`)
  } catch (error) {
    console.error('[activity-archive] VACUUM ไม่สำเร็จ (ข้อมูลถูกย้ายออกแล้ว):', error)
  }

  return { moved, file: finalPath, bytes: written.size, cutoff }
}

