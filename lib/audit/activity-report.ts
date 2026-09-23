import 'server-only'
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { coreKonDb } from '@/lib/db/core-kon'
import { activityLog, users } from '@/lib/db/schema/core-kon'
import type { ActivityAction } from './activity-log'

/**
 * อ่านร่องรอยการใช้งานสำหรับหน้าผู้ดูแลระบบ
 *
 * แยกไฟล์จาก activity-log.ts ที่ทำหน้าที่เขียน เพราะฝั่งเขียนถูก import เข้าไปใน
 * proxy.ts ซึ่งรันทุกคำขอ ยิ่งไฟล์นั้นเบายิ่งดี ไม่ควรลากคิวรีรายงานติดไปด้วย
 */

/** ช่วงเวลาที่ขอได้สูงสุดต่อครั้ง — กันการกวาดทั้งตารางในคำขอเดียว */
export const ACTIVITY_MAX_RANGE_DAYS = 92

/** จำนวนแถวสูงสุดต่อหน้า */
export const ACTIVITY_PAGE_SIZE = 200

export type ActivityRow = {
  id: number
  at: string
  userId: number | null
  username: string | null
  /** ชื่อ-สกุลจากทะเบียนผู้ใช้ — null ถ้าบัญชีถูกลบไปแล้วแต่ล็อกยังอยู่ */
  fullName: string | null
  action: string
  method: string | null
  path: string
  feature: string | null
  targetHn: string | null
  detail: string | null
  clientIp: string | null
  device: string | null
}

export type ActivityFilter = {
  from: string
  to: string
  userId?: number | null
  action?: ActivityAction | null
  feature?: string | null
  targetHn?: string | null
  /** เลื่อนหน้าด้วย id ของแถวสุดท้ายที่ได้ไป ไม่ใช้ OFFSET */
  before?: number | null
}

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v).trim() || null)

/**
 * เลื่อนหน้าด้วย id ไม่ใช่ OFFSET
 *
 * ตารางนี้มีแถวใหม่เข้ามาตลอดเวลาที่คนกำลังอ่านอยู่ ถ้าใช้ OFFSET แถวจะเลื่อนลง
 * ระหว่างกดหน้าถัดไป แล้วผู้อ่านจะเห็นบางแถวซ้ำและข้ามบางแถวไปโดยไม่รู้ตัว ซึ่ง
 * เป็นสิ่งที่ยอมไม่ได้ในเอกสารที่ใช้สอบเหตุการณ์ — id เรียงตามเวลาเขียนอยู่แล้ว
 */
export async function loadActivity(filter: ActivityFilter): Promise<{
  rows: ActivityRow[]
  hasMore: boolean
}> {
  const conditions = [
    gte(activityLog.createdAt, new Date(`${filter.from}T00:00:00`)),
    lte(activityLog.createdAt, new Date(`${filter.to}T23:59:59.999`)),
  ]

  if (filter.userId) conditions.push(eq(activityLog.userId, filter.userId))
  if (filter.action) conditions.push(eq(activityLog.action, filter.action))
  if (filter.feature) conditions.push(eq(activityLog.feature, filter.feature))
  if (filter.targetHn) conditions.push(eq(activityLog.targetHn, filter.targetHn))
  if (filter.before) conditions.push(sql`${activityLog.id} < ${filter.before}`)

  const rows = await coreKonDb
    .select({
      id: activityLog.id,
      at: activityLog.createdAt,
      userId: activityLog.userId,
      username: activityLog.username,
      pname: users.pname,
      fname: users.fname,
      lname: users.lname,
      action: activityLog.action,
      method: activityLog.method,
      path: activityLog.path,
      feature: activityLog.feature,
      targetHn: activityLog.targetHn,
      detail: activityLog.detail,
      clientIp: activityLog.clientIp,
      device: activityLog.device,
    })
    .from(activityLog)
    .leftJoin(users, eq(users.id, activityLog.userId))
    .where(and(...conditions))
    .orderBy(desc(activityLog.id))
    .limit(ACTIVITY_PAGE_SIZE + 1)

  const page = rows.slice(0, ACTIVITY_PAGE_SIZE)

  return {
    hasMore: rows.length > ACTIVITY_PAGE_SIZE,
    rows: page.map(row => ({
      id: Number(row.id),
      at: row.at.toISOString(),
      userId: row.userId,
      username: str(row.username),
      fullName: [row.pname, row.fname, row.lname].filter(Boolean).join(' ') || null,
      action: String(row.action),
      method: str(row.method),
      path: String(row.path),
      feature: str(row.feature),
      targetHn: str(row.targetHn),
      detail: str(row.detail),
      clientIp: str(row.clientIp),
      device: str(row.device),
    })),
  }
}

export type ActivitySummary = {
  /** คนที่เคลื่อนไหวมากที่สุดในช่วงนั้น */
  topUsers: { userId: number | null; name: string; count: number }[]
  byAction: { action: string; count: number }[]
  byFeature: { feature: string; count: number }[]
  total: number
  /** จำนวนครั้งที่มีการส่งออกไฟล์ และจำนวน HN ที่ถูกเปิดดูไม่ซ้ำ */
  exports: number
  patientsTouched: number
}

/** ตัวเลขสรุปของช่วงเวลาเดียวกับตาราง — ตอบภาพรวมก่อนลงไปอ่านทีละแถว */
export async function summariseActivity(filter: {
  from: string
  to: string
}): Promise<ActivitySummary> {
  const from = new Date(`${filter.from}T00:00:00`)
  const to = new Date(`${filter.to}T23:59:59.999`)
  const window = and(gte(activityLog.createdAt, from), lte(activityLog.createdAt, to))

  const [totals] = await coreKonDb
    .select({
      total: sql<number>`COUNT(*)`,
      exports: sql<number>`COUNT(*) FILTER (WHERE ${activityLog.action} = 'export')`,
      patients: sql<number>`COUNT(DISTINCT ${activityLog.targetHn})`,
    })
    .from(activityLog)
    .where(window)

  const topUsers = await coreKonDb
    .select({
      userId: activityLog.userId,
      username: activityLog.username,
      fname: users.fname,
      lname: users.lname,
      count: sql<number>`COUNT(*)`,
    })
    .from(activityLog)
    .leftJoin(users, eq(users.id, activityLog.userId))
    .where(window)
    .groupBy(activityLog.userId, activityLog.username, users.fname, users.lname)
    .orderBy(desc(sql`COUNT(*)`))
    .limit(10)

  const byAction = await coreKonDb
    .select({ action: activityLog.action, count: sql<number>`COUNT(*)` })
    .from(activityLog)
    .where(window)
    .groupBy(activityLog.action)
    .orderBy(desc(sql`COUNT(*)`))

  const byFeature = await coreKonDb
    .select({ feature: activityLog.feature, count: sql<number>`COUNT(*)` })
    .from(activityLog)
    .where(window)
    .groupBy(activityLog.feature)
    .orderBy(desc(sql`COUNT(*)`))
    .limit(15)

  return {
    total: Number(totals?.total ?? 0),
    exports: Number(totals?.exports ?? 0),
    patientsTouched: Number(totals?.patients ?? 0),
    topUsers: topUsers.map(row => ({
      userId: row.userId,
      name:
        [row.fname, row.lname].filter(Boolean).join(' ') ||
        str(row.username) ||
        (row.userId == null ? 'ไม่ระบุตัวตน' : `รหัส ${row.userId}`),
      count: Number(row.count),
    })),
    byAction: byAction.map(row => ({ action: String(row.action), count: Number(row.count) })),
    byFeature: byFeature.map(row => ({
      feature: str(row.feature) ?? 'ไม่ระบุ',
      count: Number(row.count),
    })),
  }
}

/** รายชื่อผู้ใช้ที่เคยมีร่องรอยในช่วงนั้น — ใช้เป็นตัวเลือกในช่องกรอง */
export async function listActivityUsers(filter: { from: string; to: string }): Promise<
  { userId: number; name: string }[]
> {
  const rows = await coreKonDb
    .selectDistinct({
      userId: activityLog.userId,
      username: activityLog.username,
      fname: users.fname,
      lname: users.lname,
    })
    .from(activityLog)
    .leftJoin(users, eq(users.id, activityLog.userId))
    .where(
      and(
        gte(activityLog.createdAt, new Date(`${filter.from}T00:00:00`)),
        lte(activityLog.createdAt, new Date(`${filter.to}T23:59:59.999`)),
        sql`${activityLog.userId} IS NOT NULL`,
      ),
    )

  return rows
    .filter(row => row.userId != null)
    .map(row => ({
      userId: row.userId as number,
      name:
        [row.fname, row.lname].filter(Boolean).join(' ') ||
        str(row.username) ||
        `รหัส ${row.userId}`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'th'))
}
