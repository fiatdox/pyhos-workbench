import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'

/**
 * ช่วงเวลาของรายงาน Service Plan — ปีงบประมาณ ไตรมาส และเดือน
 *
 * แยกออกมาจาก stroke-stats เพราะหน้า Sepsis ต้องการตัวเลือกช่วงเวลาชุดเดียวกัน
 * เป๊ะ ๆ (เทียบห้าปีงบ หรือเจาะรายเดือนของปีงบเดียว เลือกไตรมาสได้) ถ้าคัดลอกไป
 * วันหนึ่งสองหน้าจะนิยาม "ปีงบที่ยังไม่จบ" ไม่ตรงกัน แล้วตัวเลขสองหน้าจะเถียงกันเอง
 * โดยไม่มีใครรู้ว่าอันไหนถูก
 *
 * ทุกหน้าที่ใช้โมดูลนี้ได้ช่วงวันที่ชุดเดียวกัน จึงเอาตัวเลขมาวางข้างกันได้จริง
 */

/** จำนวนปีงบที่มุมมองเทียบรายปีแสดง (ไม่นับปีที่กำลังเดินอยู่) */
export const FISCAL_YEARS_SHOWN = 5

/** ปีงบประมาณไทยเริ่ม 1 ต.ค. — ตั้งแต่เดือนนี้ถือว่าเข้าปีงบถัดไปแล้ว */
const FISCAL_START_MONTH = 9

/** จำนวนเดือนในหนึ่งไตรมาส */
const MONTHS_PER_QUARTER = 3

/** ไตรมาสของปีงบประมาณ — Q1 คือ ต.ค.-ธ.ค. */
export type FiscalQuarter = 1 | 2 | 3 | 4

/** มุมมองที่ขอได้ — เทียบรายปีงบ หรือเจาะรายเดือนของปีงบเดียว */
export type PeriodQuery =
  | { by: 'fiscalYear' }
  | { by: 'month'; fiscalYear: number; quarter?: FiscalQuarter | null }

/** ช่วงย่อยหนึ่งช่วงที่ต้องแสดงบนกราฟ */
export type PeriodSlot = {
  /** คีย์ของช่วง — ปีงบเป็น '2569' เดือนเป็น '2026-01' */
  key: string
  /** ช่วงที่ยังไม่จบ ตัวเลขยังไม่ครบและเทียบกับช่วงอื่นตรง ๆ ไม่ได้ */
  partial: boolean
}

export type PeriodPlan = {
  by: 'fiscalYear' | 'month'
  from: string
  to: string
  fiscalYear: number | null
  quarter: FiscalQuarter | null
  periods: PeriodSlot[]
}

/** ความครบของการลงรหัสโรคหลักในเดือนหนึ่ง */
export type CodingCompleteness = {
  month: string
  discharged: number
  coded: number
} | null

/** ช่วงวันที่ของปีงบประมาณ พ.ศ. — 1 ต.ค. ปีก่อนหน้า ถึง 30 ก.ย. ของปีนั้น */
export function fiscalRange(buddhistYear: number): { from: string; to: string } {
  const endYear = buddhistYear - 543
  return { from: `${endYear - 1}-10-01`, to: `${endYear}-09-30` }
}

/** ปีงบประมาณที่วันนี้อยู่ (ยังไม่จบ) */
export function currentFiscalYear(now: Date): number {
  return now.getFullYear() + 543 + (now.getMonth() >= FISCAL_START_MONTH ? 1 : 0)
}

/**
 * ปีงบที่หน้ารายงานแสดง — ห้าปีที่ปิดแล้ว บวกปีที่กำลังเดินอยู่ เรียงจากเก่าไปใหม่
 *
 * ปีที่กำลังเดินอยู่ต้องอยู่ในรายการเสมอ ถึงจะยังไม่มีข้อมูลสักแถว เพราะการหายไป
 * เงียบ ๆ ทำให้คนอ่านเข้าใจว่าระบบยังไม่ได้อัปเดต ซึ่งคนละเรื่องกับความจริงที่ว่า
 * เวชระเบียนยังลงรหัสไม่ทัน — แต่ต้องติดธง partial ไว้ ไม่ใช่วางปนกับปีที่ครบแล้ว
 * เหมือนเทียบกันได้
 *
 * ห้าปีที่ปิดแล้วยังเป็นห้าปีเท่าเดิม ปีที่เดินอยู่เป็นของแถม ไม่ได้ไปเบียดปีเก่าสุด
 * ออกจากรายการ การเปรียบเทียบห้าปีจึงยังครบห้าปี
 */
export function shownFiscalYears(now = new Date()): { year: number; partial: boolean }[] {
  const current = currentFiscalYear(now)
  const closed = Array.from(
    { length: FISCAL_YEARS_SHOWN },
    (_, i) => current - FISCAL_YEARS_SHOWN + i,
  ).map(year => ({ year, partial: false }))
  return [...closed, { year: current, partial: true }]
}

const pad2 = (value: number) => String(value).padStart(2, '0')

/** วันที่วันนี้แบบ 'YYYY-MM-DD' ตามเวลาเครื่อง ไม่ใช่ UTC */
export function today(now: Date): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}

/** เดือนของวันนี้แบบ 'YYYY-MM' */
export const thisMonth = (now: Date) => `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`

/**
 * เดือนของปีงบ (หรือของไตรมาสเดียว) เรียงจากเก่าไปใหม่
 *
 * ตัดเดือนที่ยังมาไม่ถึงออก ไม่ได้วางไว้เป็นแท่งศูนย์ — เดือนในอนาคตไม่ใช่
 * "เดือนที่ไม่มีผู้ป่วย" และการวางมันไว้ทำให้กราฟของปีที่กำลังเดินอยู่มีหางศูนย์
 * ยาวเก้าเดือนจนแท่งจริงถูกบีบจนอ่านไม่ออก (ต่างจากปีงบที่ต้องคงไว้ให้ครบห้าปี
 * เพราะปีที่ไม่มีผู้ป่วยเลยคือข้อมูล ส่วนเดือนที่ยังไม่มาถึงไม่ใช่)
 */
function monthsOf(fiscalYear: number, quarter: FiscalQuarter | null, now: Date): string[] {
  const startYear = fiscalYear - 543 - 1
  const offset = quarter == null ? 0 : (quarter - 1) * MONTHS_PER_QUARTER
  const count = quarter == null ? 12 : MONTHS_PER_QUARTER
  const limit = thisMonth(now)
  const months: string[] = []
  for (let i = 0; i < count; i += 1) {
    // ให้ Date คิดการข้ามปีเอง — เดือนที่ 12 ของ 9 (ต.ค.) คือ ก.ย. ปีถัดไป
    const date = new Date(startYear, FISCAL_START_MONTH + offset + i, 1)
    const key = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`
    if (key > limit) break
    months.push(key)
  }
  return months
}

/** วันสุดท้ายของเดือน 'YYYY-MM' */
function endOfMonth(month: string): string {
  const [year, index] = month.split('-').map(Number)
  return `${month}-${pad2(new Date(year, index, 0).getDate())}`
}

/** ช่วงที่ต้องดึง และรายการช่วงย่อยที่ต้องแสดง */
export function planOf(query: PeriodQuery, now: Date): PeriodPlan {
  if (query.by === 'fiscalYear') {
    const years = shownFiscalYears(now)
    return {
      by: 'fiscalYear',
      from: fiscalRange(years[0].year).from,
      // ปลายช่วงคือวันนี้ ไม่ใช่ 30 ก.ย. ของปีงบที่เดินอยู่ — วันในอนาคตไม่มีข้อมูล
      // และป้ายบอกช่วงบนหน้าจอจะกลายเป็นคำสัญญาที่ข้อมูลยังไปไม่ถึง
      to: today(now),
      fiscalYear: null,
      quarter: null,
      periods: years.map(({ year, partial }) => ({ key: String(year), partial })),
    }
  }
  const quarter = query.quarter ?? null
  const months = monthsOf(query.fiscalYear, quarter, now)
  const current = thisMonth(now)
  return {
    by: 'month',
    from: months.length > 0 ? `${months[0]}-01` : fiscalRange(query.fiscalYear).from,
    to:
      months.length > 0
        ? // เดือนที่กำลังเดินอยู่ตัดปลายที่วันนี้ เดือนที่ผ่านไปแล้วใช้วันสุดท้ายของเดือน
          months[months.length - 1] === current
          ? today(now)
          : endOfMonth(months[months.length - 1])
        : fiscalRange(query.fiscalYear).from,
    fiscalYear: query.fiscalYear,
    quarter,
    periods: months.map(month => ({ key: month, partial: month === current })),
  }
}

/**
 * นิพจน์ SQL ที่ใช้จัดกลุ่มตามช่วง — ปีงบเป็นตัวเลข พ.ศ. ส่วนรายเดือนเป็น 'YYYY-MM'
 *
 * ต้องเป็นสตริงทั้งคู่เพราะผลถูกใส่ Map เดียวกัน ถ้าปล่อยให้ปีงบเป็นตัวเลข
 * การค้นด้วยคีย์สตริงจะพลาดเงียบ ๆ แล้วทุกช่องกลายเป็นศูนย์โดยไม่มี error
 *
 * column คือคอลัมน์วันจำหน่ายของตารางที่เรียกใช้ (แต่ละคิวรีตั้งชื่อ alias ต่างกัน)
 */
export function bucketExpression(by: 'fiscalYear' | 'month', column: string): string {
  return by === 'month'
    ? `DATE_FORMAT(${column}, '%Y-%m')`
    : `CAST(YEAR(${column}) + IF(MONTH(${column}) >= 10, 1, 0) + 543 AS CHAR)`
}

/**
 * ความครบของการลงรหัสโรคหลักในเดือนหนึ่ง — ตัวหารคือจำนวนที่จำหน่ายทั้งหมด
 *
 * ทุกหน้าที่นับจากการวินิจฉัยต้องบอกเรื่องนี้ได้ เพราะการลงรหัสตามหลังวันจำหน่าย
 * หลายสัปดาห์ ตัวเลขของเดือนที่กำลังเดินอยู่จึงต่ำกว่าความจริงเสมอ
 */
export async function codingCompleteness(month: string): Promise<CodingCompleteness> {
  const rows = await hisDb.execute(sql`
    SELECT COUNT(*) AS discharged, COUNT(a.an) AS coded
    FROM ipt b
    LEFT JOIN iptdiag a ON a.an = b.an AND a.diagtype = '1'
    WHERE b.dchdate BETWEEN ${`${month}-01`} AND LAST_DAY(${`${month}-01`})
  `)
  const row = (rows as unknown as { discharged: number; coded: number }[][])[0]?.[0]
  if (row == null) return null
  return { month, discharged: Number(row.discharged), coded: Number(row.coded) }
}
