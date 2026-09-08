import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'
import { hisScanPool } from '@/lib/db/his-scan'
import { labCodes } from '@/lib/his/lab-codes'

/**
 * ผลตรวจ HLA-B*5801 (ชื่อรายการในระบบคือ "HLA B 5801")
 *
 * ผลของรายการนี้ไม่ได้เก็บเป็นตัวเลข — ช่อง lab_order_result เขียนว่า "ดูผลที่ image"
 * ตัวผลจริงเป็นรูปที่สแกนไว้ในตาราง lab_order_image ของฐานภาพ (คนละเครื่องกับ HIS)
 * หน้าจอจึงต้องเปิดรูปให้ดูได้ ไม่ใช่แค่แสดงข้อความ
 */

/** รหัสรายการตรวจใน lab_items — อ่านจาก .env (ดู lib/his/lab-codes.ts) */
const LAB_ITEMS_CODE = labCodes.hlaB5801

/** ช่องเก็บรูปในหนึ่งใบรายงาน */
export const IMAGE_SLOTS = [1, 2, 3, 4, 5] as const

export type HlaResult = {
  labOrderNumber: number
  hn: string
  patientName: string | null
  age: number | null
  orderDate: string | null
  orderTime: string | null
  reportDate: string | null
  reportTime: string | null
  result: string | null
  doctor: string | null
  formName: string | null
  /** ลำดับช่องรูปที่มีข้อมูลจริง เช่น [1, 2] */
  images: number[]
}

/** จำนวนรายงานสูงสุดต่อการค้นหนึ่งครั้ง */
export const MAX_RESULTS = 500

type Row = Record<string, unknown>

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v).trim() || null)

/** ชนิดรูปดูจากไบต์ต้นไฟล์ ฐานไม่ได้เก็บบอกไว้ (ที่เจอทั้งหมดเป็น JPEG) */
export function detectImageType(data: Buffer): string {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.length >= 8 && data.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png'
  if (data.length >= 3 && data.subarray(0, 3).toString('ascii') === 'GIF') return 'image/gif'
  if (data.length >= 2 && data.subarray(0, 2).toString('ascii') === 'BM') return 'image/bmp'
  return 'application/octet-stream'
}

/**
 * รายงานผลที่ยืนยันแล้ว ค้นได้สองแบบ
 * - ตามช่วงวันที่รายงาน (report_date) — ใช้ดูว่าช่วงนี้มีใครรายงานผลบ้าง
 * - ตาม HN หรือชื่อ-สกุล — ค้นทั้งหมดไม่จำกัดช่วงวันที่ เพราะผู้ใช้มักหาคนที่รู้ชื่อ
 *   แต่ไม่รู้ว่าผลออกวันไหน (ทั้งฐานมีรายการที่ยืนยันแล้ว 875 รายการ ค้นทีละครั้งไม่หนัก)
 */
export async function listHlaResults(filter: {
  from?: string
  to?: string
  keyword?: string
  /** ผลของผู้ป่วยรายเดียว ไม่จำกัดช่วงวันที่ — ใช้ในหน้าประวัติยา */
  hn?: string
}): Promise<HlaResult[]> {
  const keyword = filter.keyword?.trim()
  // escape อักขระพิเศษของ LIKE ไม่ให้ % หรือ _ ที่ผู้ใช้พิมพ์กลายเป็น wildcard
  const pattern = keyword ? `%${keyword.replace(/[\\%_]/g, ch => `\\${ch}`)}%` : ''

  const scope = filter.hn
    ? sql`b.hn = ${filter.hn}`
    : keyword
      ? sql`(b.hn LIKE ${pattern} OR CONCAT(p.pname, p.fname, ' ', p.lname) LIKE ${pattern})`
      : sql`b.report_date BETWEEN ${filter.from} AND ${filter.to}`

  const [result] = await hisDb.execute(sql`
    SELECT b.lab_order_number, b.hn,
           DATE_FORMAT(b.order_date, '%Y-%m-%d') AS order_date, b.order_time,
           DATE_FORMAT(b.report_date, '%Y-%m-%d') AS report_date, b.report_time,
           a.lab_order_result,
           CONCAT(p.pname, p.fname, ' ', p.lname) AS ptname,
           TIMESTAMPDIFF(YEAR, p.birthday, CURDATE()) AS age,
           doc.name AS doctor_name, b.form_name
    FROM lab_order a
    INNER JOIN lab_head b ON b.lab_order_number = a.lab_order_number
    LEFT OUTER JOIN patient p ON p.hn = b.hn
    LEFT OUTER JOIN doctor doc ON doc.code = b.doctor_code
    WHERE a.lab_items_code = ${LAB_ITEMS_CODE} AND a.confirm = 'Y'
      AND ${scope}
    ORDER BY b.report_date DESC, b.report_time DESC
    LIMIT ${MAX_RESULTS}`)

  const rows = result as unknown as Row[]
  if (rows.length === 0) return []

  const images = await loadImageSlots(rows.map(row => Number(row.lab_order_number)))

  return rows.map(row => {
    const labOrderNumber = Number(row.lab_order_number)
    return {
      labOrderNumber,
      hn: String(row.hn ?? ''),
      patientName: str(row.ptname),
      age: row.age == null ? null : Number(row.age),
      orderDate: str(row.order_date),
      orderTime: str(row.order_time)?.slice(0, 5) ?? null,
      reportDate: str(row.report_date),
      reportTime: str(row.report_time)?.slice(0, 5) ?? null,
      result: str(row.lab_order_result),
      doctor: str(row.doctor_name),
      formName: str(row.form_name),
      images: images.get(labOrderNumber) ?? [],
    }
  })
}

/**
 * ดูว่าแต่ละใบรายงานมีรูปช่องไหนบ้าง — เช็คแค่ว่า NULL หรือไม่ ไม่ดึงตัวรูปมา
 * (ตัวรูปหลักหลายร้อย KB ถ้าดึงมาทั้งหน้าจะช้าและเปลืองโดยไม่จำเป็น)
 */
async function loadImageSlots(orderNumbers: number[]): Promise<Map<number, number[]>> {
  const slots = new Map<number, number[]>()
  if (orderNumbers.length === 0) return slots

  const placeholders = orderNumbers.map(() => '?').join(',')
  const [rows] = await hisScanPool.query(
    `SELECT lab_order_number,
            (image1 IS NOT NULL) AS h1, (image2 IS NOT NULL) AS h2, (image3 IS NOT NULL) AS h3,
            (image4 IS NOT NULL) AS h4, (image5 IS NOT NULL) AS h5
     FROM lab_order_image
     WHERE lab_order_number IN (${placeholders})`,
    orderNumbers,
  )

  for (const row of rows as unknown as Row[]) {
    const found = IMAGE_SLOTS.filter(index => Number(row[`h${index}`]) === 1)
    if (found.length > 0) slots.set(Number(row.lab_order_number), found)
  }
  return slots
}

/**
 * รูปหนึ่งใบ — ตรวจก่อนว่า lab_order_number นี้เป็นรายการ HLA-B*5801 ที่ยืนยันผลแล้วจริง
 * กันเปิดดูรูปของรายการตรวจอื่นด้วยการเดาเลข
 */
export async function getHlaImage(
  labOrderNumber: number,
  index: number,
): Promise<{ data: Buffer; mime: string } | null> {
  if (!IMAGE_SLOTS.includes(index as (typeof IMAGE_SLOTS)[number])) return null

  const [check] = await hisDb.execute(sql`
    SELECT 1 AS ok FROM lab_order
    WHERE lab_order_number = ${labOrderNumber} AND lab_items_code = ${LAB_ITEMS_CODE} AND confirm = 'Y'
    LIMIT 1`)
  if ((check as unknown as Row[]).length === 0) return null

  // ชื่อคอลัมน์มาจาก IMAGE_SLOTS ที่ตรวจแล้ว ไม่ใช่ค่าที่ผู้ใช้ส่งมาตรง ๆ
  const [rows] = await hisScanPool.query(
    `SELECT image${index} AS data FROM lab_order_image WHERE lab_order_number = ? LIMIT 1`,
    [labOrderNumber],
  )

  const row = (rows as unknown as Row[])[0]
  if (!row || !Buffer.isBuffer(row.data) || row.data.length === 0) return null

  return { data: row.data, mime: detectImageType(row.data) }
}
