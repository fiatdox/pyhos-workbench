import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'
import { DISPENSED_QTY, OPD_ONLY } from '@/lib/his/rdu-visit-report'

/**
 * ตัวชี้วัดร้อยละการสั่งใช้ยาในบัญชียาหลักแห่งชาติ (ED)
 *
 * ข้อนี้ไม่เกี่ยงโรคเลย ต่างจากทุกข้อที่มีอยู่ — ไม่มีทะเบียนรหัสวินิจฉัย ไม่มี
 * ทะเบียนยา ไม่มีเกณฑ์อายุ ตัวหารคือ "ทุกบรรทัดยาที่จ่ายออกไป" แล้วถามว่ากี่
 * เปอร์เซ็นต์อยู่ในบัญชียาหลัก หน่วยจึงเป็นรายการยา ไม่ใช่ครั้งที่มารับบริการ
 * และไม่ใช่จำนวนคน
 *
 * ผลที่ตามมาอย่างหนึ่งคือหน้ารายงานของข้อนี้ไม่ต้องดึงข้อมูลผู้ป่วยเลยสักฟิลด์ —
 * สิ่งที่คณะกรรมการต้องเห็นคือ "ยานอกบัญชีตัวไหนถูกสั่งมากที่สุด" ซึ่งเป็นรายการ
 * ยา ไม่ใช่รายชื่อคน
 *
 * ── ED/NED ดูจากไหน ──
 *
 * ใช้ drugitems.income ซึ่งเป็นหมวดค่าใช้จ่ายที่โรงพยาบาลใช้เบิกจริง:
 * '03' = ค่ายาในบัญชียาหลักแห่งชาติ · '17' = ค่ายานอกบัญชี
 *
 * เลือกคอลัมน์นี้แทน drugitems.drugaccount (ที่เก็บบัญชี ก/ข/ค/ง/จ1/จ2) เพราะ
 * income ไม่มีแถวว่างเลยในยาที่เปิดใช้งาน ส่วน drugaccount ว่างอยู่ 158 รายการ
 * ซึ่งต้องตีความเอาเองว่าว่าง = นอกบัญชี หรือ = ยังไม่ได้กรอก
 *
 * แต่สองคอลัมน์นี้ตรงกันแทบสมบูรณ์ ซึ่งเป็นการยืนยันซึ่งกันและกัน: ยาที่เปิด
 * ใช้งาน 1,092 รายการ ขัดกันแค่ 1 รายการ (Lidocaine 2% ที่ income เป็น '03'
 * แต่ drugaccount ว่าง) และวัดทั้งเดือนแล้วได้ร้อยละเท่ากันเป๊ะทั้งสองทาง
 * (70,512 จาก 81,486 = 86.53%) หน้ารายงานจึงรายงานจำนวนที่ขัดกันไว้ด้วย
 * เพื่อให้เห็นตั้งแต่วันที่บัญชียาเริ่มไม่ตรงกันเอง
 */

/** หมวดค่าใช้จ่าย: ค่ายาในบัญชียาหลักแห่งชาติ */
export const ED_INCOME = '03'

/** หมวดค่าใช้จ่าย: ค่ายานอกบัญชียาหลักแห่งชาติ */
export const NED_INCOME = '17'

/** ช่วงวันที่ยาวสุดต่อการค้นหนึ่งครั้ง — เท่ากับตัวชี้วัดข้ออื่น */
export const ED_MAX_RANGE_DAYS = 366

/**
 * จำนวนรายการยานอกบัญชีสูงสุดที่ส่งไปแสดง
 *
 * ทั้งเดือนมียานอกบัญชีถูกสั่งจริง 96 รายการ ทั้งปีก็ไม่น่าเกินสองร้อย
 * เพดานนี้จึงไม่มีทางถึง ใส่ไว้กันกรณีบัญชียาถูกแก้จนยาเกือบทั้งโรงพยาบาล
 * กลายเป็นนอกบัญชี
 */
const MAX_ITEM_ROWS = 500

/** ฝั่งที่นับ — ผู้ป่วยนอกกับผู้ป่วยในแยกกันคนละตัวชี้วัด */
export type EdScope = 'opd' | 'ipd'

const rows = (result: unknown) => result as unknown as Record<string, unknown>[]

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v).trim() || null)

/** ยานอกบัญชีหนึ่งรายการที่ถูกสั่งในช่วงที่เลือก */
export type EdItem = {
  icode: string
  name: string
  /** ชื่อสามัญ — ใช้ดูว่ามียาในบัญชีที่ใช้แทนกันได้หรือไม่ */
  generic: string | null
  /**
   * บัญชีย่อยตาม drugitems.drugaccount — ว่างเป็นเรื่องปกติของยานอกบัญชี
   * ถ้ามีค่า แปลว่าสองคอลัมน์ขัดกัน และแถวนั้นควรถูกทบทวน
   */
  account: string | null
  /** จำนวนบรรทัดที่ถูกสั่งจ่ายจริง */
  lines: number
  /** จำนวนผู้ป่วยที่ได้รับ — ยาตัวเดียวสั่งซ้ำให้คนเดิมกับกระจายหลายคนต่างกันมาก */
  patients: number
}

export type EdReport = {
  scope: EdScope
  /** ตัวหาร — บรรทัดยาที่จ่ายจริงทั้งหมดในช่วงนี้ */
  totalLines: number
  /** ตัวตั้ง — บรรทัดที่เป็นยาในบัญชียาหลัก */
  edLines: number
  /** ยานอกบัญชีที่ถูกสั่ง เรียงจากที่สั่งมากที่สุด */
  nedItems: EdItem[]
  /**
   * จำนวนรายการยาที่เปิดใช้งานอยู่แต่ income กับ drugaccount บอกไม่ตรงกัน
   *
   * ไม่ได้กระทบตัวเลขในทางปฏิบัติ (ตรวจแล้วมี 1 รายการ) แต่ต้องเห็น เพราะถ้า
   * วันหนึ่งตัวเลขนี้โตขึ้น แปลว่าบัญชียากำลังถูกกรอกไม่สม่ำเสมอ และตัวชี้วัด
   * จะเริ่มเพี้ยนโดยไม่มีอะไรเตือน
   */
  mismatchedItems: number
  /** ถึงเพดานจำนวนแถวแล้วหรือยัง */
  truncated: boolean
}

/**
 * ต้องบังคับลำดับ join ทุกคิวรีที่ใช้ scopeOf — ห้ามลืม
 *
 * ข้อนี้ไม่ได้จำกัดรายการยาเลย ดัชนี opitemrece.icode ที่ตัวชี้วัดข้ออื่นได้ใช้
 * จึงช่วยอะไรไม่ได้ และตัวเลือกแผนคิวรีของ MariaDB พลิกไปอ่าน opitemrece ทั้งตาราง
 * ทันทีที่ช่วงวันที่ยาวเกินหนึ่งเดือน วัดแล้วเห็นหน้าผาชัดมาก:
 *
 *   1 เดือน  2.6 วินาที · 2 เดือน 138 วินาที · 3 เดือน 135 วินาที
 *
 * สองกับสามเดือนเท่ากันเพราะเป็นค่าคงที่ของการอ่านทั้งตาราง ไม่ได้ขึ้นกับช่วงแล้ว
 * ใส่ STRAIGHT_JOIN บังคับให้ไล่จากซ้ายไปขวาตามที่เขียนไว้ สามเดือนลงมาเหลือ
 * 7.5 วินาที และได้ตัวเลขเท่ากันเป๊ะ (254,471 บรรทัด / ในบัญชี 220,750)
 * ทั้งปีจึงราวสามสิบวินาที ซึ่งพอสำหรับการคำนวณลงแคชรายปี
 */
const STRAIGHT = sql`STRAIGHT_JOIN`

/**
 * ชิ้นส่วน FROM/WHERE ของฝั่งที่นับ
 *
 * ทั้งสองฝั่งไล่จากตารางสรุปการมารับบริการ (vn_stat / an_stat) เข้าหา opitemrece
 * ไม่ได้ไล่จาก opitemrece ด้วยเงื่อนไขวันที่ของมันเอง — วัดแล้วต่างกันสี่สิบเท่า
 * (2.5 วินาที เทียบกับ 101 วินาที ต่อหนึ่งเดือน) ทั้งที่ได้ตัวเลขเท่ากันเป๊ะ
 *
 * ฝั่งผู้ป่วยนอกตัดครั้งที่ถูกรับไว้เป็นผู้ป่วยในออก ด้วยเหตุผลที่ต่างจากข้ออื่น
 * เล็กน้อย: ที่นี่ไม่ได้ตัดเพราะเกณฑ์ของตัวชี้วัด แต่ตัดเพื่อไม่ให้ยาของการนอน
 * ครั้งเดียวกันถูกนับทั้งสองฝั่ง เพราะแถวใน opitemrece ของครั้งที่ admit มีทั้ง
 * vn และ an
 */
const scopeOf = (scope: EdScope, input: { from: string; to: string }) =>
  scope === 'opd'
    ? sql`
      FROM vn_stat v
      JOIN opitemrece o ON o.vn = v.vn
      JOIN drugitems di ON di.icode = o.icode
      LEFT OUTER JOIN ovst ov ON ov.vn = v.vn
     WHERE v.vstdate BETWEEN ${input.from} AND ${input.to}
       AND o.qty > ${DISPENSED_QTY}
       AND ${OPD_ONLY}`
    : sql`
      FROM an_stat a
      JOIN opitemrece o ON o.an = a.an
      JOIN drugitems di ON di.icode = o.icode
     WHERE a.regdate BETWEEN ${input.from} AND ${input.to}
       AND o.qty > ${DISPENSED_QTY}`

/** คนที่ได้รับยา — คนละคอลัมน์กันสองฝั่ง แต่ทั้งคู่คือ HN */
const patientColumn = (scope: EdScope) => (scope === 'opd' ? sql`v.hn` : sql`a.hn`)

/**
 * ร้อยละการสั่งใช้ยาในบัญชียาหลัก พร้อมรายการยานอกบัญชีที่ถูกสั่ง
 *
 * ไม่มีข้อมูลผู้ป่วยออกไปถึงเบราว์เซอร์แม้แต่ฟิลด์เดียว — ตารางเป็นรายการยา
 * ส่วนจำนวนผู้ป่วยเป็นแค่ตัวเลขนับต่อรายการยา ไม่ใช่รายชื่อ
 */
export async function loadEdReport(input: {
  from: string
  to: string
  scope: EdScope
}): Promise<EdReport> {
  const scope = scopeOf(input.scope, input)

  const [totals] = await hisDb.execute(sql`
    SELECT ${STRAIGHT} COUNT(*) AS total_lines,
           SUM(di.income = ${ED_INCOME}) AS ed_lines
    ${scope}`)

  const total = rows(totals)[0] ?? {}

  /* นับความไม่ตรงกันของสองคอลัมน์จากบัญชียา ไม่ได้นับจากรายการที่จ่าย —
     รายการที่ตั้งค่าขัดกันแต่ยังไม่มีใครสั่งก็ต้องเห็น ก่อนที่จะมีคนสั่ง */
  const [mismatch] = await hisDb.execute(sql`
    SELECT COUNT(*) AS n FROM drugitems
     WHERE istatus = 'Y'
       AND ((income = ${ED_INCOME} AND (drugaccount IS NULL OR drugaccount IN ('', '-')))
         OR (income = ${NED_INCOME} AND drugaccount IS NOT NULL
             AND drugaccount NOT IN ('', '-')))`)

  /* ชื่อคอลัมน์เป็น line_count ไม่ใช่ lines — LINES เป็นคำสงวนของ MariaDB
     (ใช้ใน LOAD DATA) ตั้งชื่อว่า lines แล้วคิวรีพังทั้งข้อด้วย syntax error */
  const [items] = await hisDb.execute(sql`
    SELECT ${STRAIGHT} o.icode, di.name, di.generic_name, di.drugaccount,
           COUNT(*) AS line_count,
           COUNT(DISTINCT ${patientColumn(input.scope)}) AS patients
    ${scope}
       AND di.income = ${NED_INCOME}
     GROUP BY o.icode, di.name, di.generic_name, di.drugaccount
     ORDER BY line_count DESC, di.name
     LIMIT ${MAX_ITEM_ROWS + 1}`)

  const all = rows(items)

  return {
    scope: input.scope,
    totalLines: Number(total.total_lines ?? 0),
    edLines: Number(total.ed_lines ?? 0),
    mismatchedItems: Number(rows(mismatch)[0]?.n ?? 0),
    nedItems: all.slice(0, MAX_ITEM_ROWS).map(row => ({
      icode: String(row.icode ?? '').trim(),
      name: String(row.name ?? '').trim(),
      generic: str(row.generic_name),
      account: str(row.drugaccount),
      lines: Number(row.line_count ?? 0),
      patients: Number(row.patients ?? 0),
    })),
    truncated: all.length > MAX_ITEM_ROWS,
  }
}

/**
 * ตัวตั้ง/ตัวหารของช่วงหนึ่ง — สำหรับหน้าสรุปรายปี ไม่ดึงรายการยามาด้วย
 *
 * ทิศทางของข้อนี้กลับกับข้ออื่นเกือบทั้งหมด: ยิ่งสูงยิ่งดี ตัวตั้งจึงเป็นบรรทัด
 * ที่ "อยู่ในบัญชี" ไม่ใช่บรรทัดที่ต้องทบทวน
 */
export async function countEdPair(input: {
  from: string
  to: string
  scope: EdScope
}): Promise<{ numerator: number; denominator: number }> {
  const [result] = await hisDb.execute(sql`
    SELECT ${STRAIGHT} COUNT(*) AS denom,
           SUM(di.income = ${ED_INCOME}) AS numer
    ${scopeOf(input.scope, input)}`)

  const row = rows(result)[0] ?? {}
  return { numerator: Number(row.numer ?? 0), denominator: Number(row.denom ?? 0) }
}
