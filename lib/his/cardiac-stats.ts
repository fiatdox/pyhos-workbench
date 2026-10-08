import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'
import {
  bucketExpression,
  codingCompleteness,
  currentFiscalYear,
  planOf,
  thisMonth,
  type CodingCompleteness,
  type PeriodQuery,
} from '@/lib/his/fiscal-period'
import {
  IHD_BLOCKS,
  MI_GROUPS,
  type CardiacCode,
  type CardiacCount,
  type CardiacPeriod,
  type IhdBlock,
  type MiGroup,
} from '@/lib/his/cardiac-groups'

/* ช่วงเวลา ปีงบ ไตรมาส ใช้ของกลางร่วมกับหน้า Stroke, Sepsis และ COPD */
export type { FiscalQuarter } from '@/lib/his/fiscal-period'
export { shownFiscalYears } from '@/lib/his/fiscal-period'
export type CardiacQuery = PeriodQuery

export {
  IHD_BLOCKS,
  MI_GROUPS,
  MI_PARTS,
  STEMI_MORTALITY_TARGET,
} from '@/lib/his/cardiac-groups'
export type {
  CardiacCode,
  CardiacCount,
  CardiacPeriod,
  IhdBlock,
  MiGroup,
} from '@/lib/his/cardiac-groups'

/**
 * Service Plan สาขาโรคหัวใจ — กล้ามเนื้อหัวใจตายเฉียบพลันและโรคหัวใจขาดเลือด
 *
 * สองตัวชี้วัด:
 *   1. **อัตราตายของผู้ป่วย STEMI ไม่เกินร้อยละ 9**
 *   2. **อัตราป่วยโรคหัวใจขาดเลือด (I20-I25)** — ไม่มีเกณฑ์มาด้วย
 *
 * ตัวชี้วัดที่สองครอบตัวชี้วัดที่หนึ่งไว้ทั้งหมด (I21-I23 อยู่ใน I20-I25) จึงอ่าน
 * จากคิวรีเดียวกัน ไม่ได้ยิงสองรอบ และยอด MI ของสองส่วนขัดกันเองไม่ได้
 *
 * **คิวรีที่ได้รับมานับกว้างกว่าชื่อตัวชี้วัดอยู่มาก** — ชื่อบอกว่า STEMI แต่
 * `icd10 BETWEEN 'I21' AND 'I23'` รวม NSTEMI (I214) เข้ามาด้วย ซึ่งในฐานนี้มี
 * มากกว่า STEMI สามเท่ากว่า วัดห้าปีงบจากฐานจริง (โรคหลัก วันจำหน่าย 2564-10-01
 * ถึง 2569-09-30):
 *
 *   STEMI  I210 122 · I211 166 · I212 15 · I213 39   รวม 342 ราย ตาย 24 = 7.02%
 *   NSTEMI I214 1,148 ราย ตาย 83 = 7.23%
 *   อื่น   I219 7 ราย ตาย 1 · ไม่มี I22 หรือ I23 ที่ลงเป็นโรคหลักเลย
 *   รวม    1,497 ราย ตาย 108 = 7.21%  ← ตัวเลขที่คิวรีที่ได้รับมาคืนมา
 *
 * ร้อยละของสองกลุ่มใกล้กันโดยบังเอิญ (7.02 เทียบ 7.23) แต่**ตัวหารต่างกัน 4.4 เท่า**
 * การรายงาน 1,497 รายว่าเป็น STEMI จึงผิดแม้ร้อยละจะดูใกล้เคียง โค้ดนี้แยกกลุ่ม
 * ให้เลือกดู ตั้งต้นที่ STEMI ตามชื่อตัวชี้วัด และยังคืนยอดรวมไว้ให้เทียบกับ
 * รายงานเดิมได้
 *
 * **เกณฑ์ร้อยละ 9 ใช้ได้กับกลุ่ม STEMI เท่านั้น** ไม่ได้นิยามไว้สำหรับ NSTEMI
 * หรือยอดรวม หน้าจอจึงไม่ลากเส้นเกณฑ์เมื่อดูกลุ่มอื่น
 *
 * อีกเรื่องที่แก้ — `BETWEEN 'I21' AND 'I23'` เทียบสตริง จึงได้ 'I23' ตัวเปล่าแต่
 * ไม่ได้ 'I230' ถึง 'I239' (เพราะ 'I230' มากกว่า 'I23') วัดแล้วทั้งตารางมีแถวที่
 * ตกไป 23 แถว และในขอบเขตโรคหลักของช่วงนี้ไม่มีเลยสักแถว ผลจึงไม่เปลี่ยนวันนี้
 * โค้ดนี้ใช้ LEFT(icd10,3) IN ('I21','I22','I23') ซึ่งเป็นสิ่งที่คิวรีต้องการจริง
 * เพื่อให้วันที่มีการลง I23x โผล่มา ตัวเลขจะไม่หายไปเงียบ ๆ
 *
 * **คิวรีของตัวชี้วัดที่สองตกบล็อก I25 ไปทั้งบล็อก** — `BETWEEN 'I20' AND 'I25'`
 * เทียบสตริง จึงได้ 'I25' ตัวเปล่าแต่ไม่ได้ 'I250' ถึง 'I259' (เพราะ 'I250'
 * มากกว่า 'I25') ซึ่งคือโรคหัวใจขาดเลือดเรื้อรังทั้งบล็อก วัดห้าปีงบจากฐานจริง:
 *
 *   I251 103 · I259 32 · I255 6 · I252 3 · I250 1 · I258 1 · I254 1
 *   รวม 147 การนอน เสียชีวิต 4 ราย — **หายไป 7.8% ของขอบเขตที่ชื่อตัวชี้วัดบอก**
 *
 * ต่างจากกรณี I23x ของตัวชี้วัดแรกที่วัดแล้วไม่กระทบอะไรเลย อันนี้กระทบจริงทุกปีงบ
 * (ปีงบ 2565-2569 หายไป 37 · 33 · 31 · 19 · 27 การนอน) โค้ดนี้ใช้สามหลักแรก
 * จึงได้ครบทั้งบล็อก และยังคืนยอดแบบที่คิวรีเขียนไว้ให้เทียบกับรายงานเดิมได้
 *
 * **ยืนยันแล้วว่านี่คือเจตนาของตัวชี้วัด** — ช่วง I20-I25 หมายถึงรหัสย่อยทุกตัว
 * (I20X ถึง I25X) ไม่ใช่แค่รหัสสามหลักเปล่า จึงไม่ใช่การตีความของโค้ดนี้เอง
 * ยอด as-written ที่เก็บไว้มีไว้กระทบยอดกับรายงานเดิมอย่างเดียว
 *
 * **"อัตราป่วย" ที่นี่คิดต่อผู้ป่วยในหนึ่งพันราย ไม่ใช่ต่อแสนประชากร** — ตัวชี้วัด
 * ระดับชาติคิดต่อประชากร ซึ่ง HIS ไม่มีตัวหารนั้น (ไม่มีทะเบียนประชากรที่มีมิติปี)
 * การแทนตัวหารประกาศไว้ทุกที่ที่แสดงอัตรา ไม่ได้เรียกว่าอัตราต่อประชากรเฉย ๆ
 *
 * **การเสียชีวิตนับจาก dchtype '08' และ '09'** ตามคิวรีที่ได้รับมา และตรงกับ
 * ทะเบียนของ HIS (08 = Dead Autopsy · 09 = Dead Non Autopsy) ส่วน '02' คือ
 * Against Advice ไม่ใช่การเสียชีวิต — เหมือนหน้า COPD และ Stroke แต่ต่างจาก
 * หน้า Sepsis ที่นับ 02 ด้วยตามคิวรีที่ได้รับมาสำหรับหน้านั้น
 */

/** ประเภทการจำหน่ายที่ถือว่าเสียชีวิต — ตรงกับทะเบียน dchtype ของ HIS */
const DEAD_DISCHARGE_TYPES = "'08','09'"

/**
 * ขอบเขตของรายงาน — โรคหัวใจขาดเลือดที่ลงเป็นโรคหลัก
 *
 * กว้างเป็นช่วง I20-I25 ของตัวชี้วัดที่สอง ซึ่งครอบ I21-I23 ของตัวชี้วัดแรกไว้แล้ว
 * คิวรีเดียวจึงตอบทั้งสองส่วน และยอด MI ของสองส่วนขัดกันเองไม่ได้
 *
 * ใช้สามหลักแรกไม่ใช่ BETWEEN เพราะ BETWEEN ตกรหัสที่ยาวกว่าขอบบน — I23x ของ
 * ตัวชี้วัดแรก (วัดแล้วไม่กระทบ) และ I25x ของตัวชี้วัดที่สอง (กระทบ 147 การนอน)
 * ดูคำอธิบายด้านบน
 */
const IHD_CODES = `LEFT(a.icd10, 3) IN ('I20', 'I21', 'I22', 'I23', 'I24', 'I25')`

/**
 * ขอบเขตแบบที่คิวรีของตัวชี้วัดที่สองเขียนไว้ — มีไว้เทียบกับรายงานเดิมเท่านั้น
 *
 * นับแล้วได้น้อยกว่าความจริงเพราะตก I25x ทั้งบล็อก เก็บไว้ให้หน้าจอบอกได้ว่า
 * ส่วนต่างมาจากไหน ไม่ได้ใช้เป็นตัวเลขหลักของรายงาน
 */
const IHD_AS_WRITTEN = `a.icd10 BETWEEN 'I20' AND 'I25'`

/**
 * กลุ่มของรหัสหนึ่งรหัส — ตัดสินจากสี่อักขระแรก
 *
 * ทำที่ฝั่ง TypeScript ไม่ใช่ใน SQL เพราะคิวรีคืนมาเป็นรายรหัสอยู่แล้ว (ตารางรายรหัส
 * ต้องใช้) การจัดกลุ่มซ้ำใน SQL จึงไม่ได้อะไรเพิ่ม และการมีนิยามกลุ่มอยู่ที่เดียว
 * ทำให้ตารางรายรหัสกับยอดรายกลุ่มขัดกันเองไม่ได้
 */
export function groupOfCode(code: string): MiGroup | null {
  // นอกขอบเขตกล้ามเนื้อหัวใจตาย (I20 เจ็บเค้นหัวใจ · I24 · I25 เรื้อรัง) ต้องคืน
  // null ไม่ใช่ 'other' — ไม่อย่างนั้นยอด MI จะบวมด้วยผู้ป่วยที่ไม่ใช่ MI เงียบ ๆ
  const block = code.slice(0, 3)
  if (block !== 'I21' && block !== 'I22' && block !== 'I23') return null
  const head = code.slice(0, 4)
  if (head === 'I210' || head === 'I211' || head === 'I212' || head === 'I213') return 'stemi'
  if (head === 'I214') return 'nstemi'
  return 'other'
}

/** บล็อกโรคหัวใจขาดเลือดของรหัสหนึ่ง — ทุกรหัสในขอบเขตของคิวรีเข้าได้บล็อกเดียว */
export function blockOfCode(code: string): IhdBlock {
  const block = code.slice(0, 3)
  if (block === 'I20') return 'angina'
  if (block === 'I24') return 'otherAcute'
  if (block === 'I25') return 'chronic'
  return 'mi'
}

/** ชื่อไทยของรหัสที่พบในฐานนี้ — รหัสที่ไม่มีในตารางแสดงเป็นรหัสเปล่า */
const CODE_NAMES: Record<string, string> = {
  I200: 'เจ็บเค้นหัวใจไม่คงที่ (unstable angina)',
  I201: 'เจ็บเค้นหัวใจจากหลอดเลือดหดเกร็ง',
  I208: 'เจ็บเค้นหัวใจแบบอื่น',
  I209: 'เจ็บเค้นหัวใจ ไม่ระบุชนิด',
  I210: 'STEMI ผนังหัวใจด้านหน้า',
  I211: 'STEMI ผนังหัวใจด้านล่าง',
  I212: 'STEMI ตำแหน่งอื่น',
  I213: 'STEMI ไม่ระบุตำแหน่ง',
  I214: 'NSTEMI (กล้ามเนื้อหัวใจตายชั้นใน)',
  I219: 'กล้ามเนื้อหัวใจตายเฉียบพลัน ไม่ระบุชนิด',
  I220: 'กล้ามเนื้อหัวใจตายซ้ำ ผนังด้านหน้า',
  I221: 'กล้ามเนื้อหัวใจตายซ้ำ ผนังด้านล่าง',
  I228: 'กล้ามเนื้อหัวใจตายซ้ำ ตำแหน่งอื่น',
  I229: 'กล้ามเนื้อหัวใจตายซ้ำ ไม่ระบุตำแหน่ง',
  I23: 'ภาวะแทรกซ้อนหลังกล้ามเนื้อหัวใจตาย',
  I240: 'ลิ่มเลือดหลอดเลือดหัวใจที่ไม่เกิดกล้ามเนื้อหัวใจตาย',
  I248: 'โรคหัวใจขาดเลือดเฉียบพลันแบบอื่น',
  I249: 'โรคหัวใจขาดเลือดเฉียบพลัน ไม่ระบุชนิด',
  I250: 'หลอดเลือดแดงแข็งของหัวใจและหลอดเลือด',
  I251: 'โรคหลอดเลือดหัวใจแข็ง (atherosclerotic heart disease)',
  I252: 'กล้ามเนื้อหัวใจตายเก่า',
  I253: 'หัวใจโป่งพอง (aneurysm)',
  I254: 'หลอดเลือดหัวใจโป่งพอง',
  I255: 'กล้ามเนื้อหัวใจผิดปกติจากการขาดเลือด',
  I256: 'กล้ามเนื้อหัวใจขาดเลือดแบบไม่มีอาการ',
  I258: 'โรคหัวใจขาดเลือดเรื้อรังแบบอื่น',
  I259: 'โรคหัวใจขาดเลือดเรื้อรัง ไม่ระบุชนิด',
}

export type CardiacStats = {
  by: 'fiscalYear' | 'month'
  from: string
  to: string
  currentFiscalYear: number
  fiscalYear: number | null
  quarter: 1 | 2 | 3 | 4 | null
  periods: CardiacPeriod[]
  /**
   * รายรหัสที่ลงเป็นโรคหลัก ตลอดช่วงที่ดู เรียงจากพบมากไปน้อย
   *
   * ไม่แยกตามช่วงย่อย เพราะคำถามของตารางนี้คือ "ยอดที่เห็นมาจากรหัสอะไร"
   * ซึ่งเป็นภาพรวมของช่วง และการแยกจะทำให้รหัสที่พบน้อยเหลือช่องละศูนย์หรือหนึ่ง
   */
  codes: CardiacCode[]
  /**
   * ยอดโรคหัวใจขาดเลือดของทั้งช่วง นับแบบที่คิวรีที่ได้รับมาเขียนไว้
   *
   * มีไว้เทียบกับรายงานเดิมอย่างเดียว — ต่ำกว่าความจริงเพราะ BETWEEN ตก I25x
   * ทั้งบล็อก หน้าจอใช้บอกคนอ่านว่าส่วนต่างมาจากไหน ไม่ได้ใช้เป็นตัวเลขหลัก
   */
  asWritten: CardiacCount
  coding: CodingCompleteness
}

type Row = Record<string, string | number | null>

const zeroCount = (): CardiacCount => ({ total: 0, dead: 0 })

const zeroGroups = (): Record<MiGroup, CardiacCount> =>
  Object.fromEntries(MI_GROUPS.map(group => [group, zeroCount()])) as Record<
    MiGroup,
    CardiacCount
  >

const zeroBlocks = (): Record<IhdBlock, CardiacCount> =>
  Object.fromEntries(IHD_BLOCKS.map(block => [block, zeroCount()])) as Record<
    IhdBlock,
    CardiacCount
  >

const add = (into: CardiacCount, from: CardiacCount) => {
  into.total += from.total
  into.dead += from.dead
}

/**
 * สถิติกล้ามเนื้อหัวใจตายเฉียบพลันตามช่วงที่ขอ — ไม่มีข้อมูลรายบุคคลออกจากฟังก์ชันนี้
 *
 * คิวรีเดียว คืนมาที่ระดับ (ช่วงเวลา × รหัส) แล้วให้ TypeScript ไล่รวมเป็นทั้ง
 * ยอดรายกลุ่มรายช่วง และยอดรายรหัสของทั้งช่วง — สองอย่างมาจากแถวชุดเดียวกัน
 * ไม่มีเหตุให้ยิงสองรอบ และทำให้สองตารางขัดกันเองไม่ได้
 *
 * ยุบเป็นหนึ่งแถวต่อ AN ก่อนนับ ไม่ได้ COUNT(*) บนผล join ตรง ๆ เหมือนคิวรีที่
 * ได้รับมา — วัดแล้วกรณีนี้ไม่ต่างกัน (โรคหลักมีหนึ่งแถวต่อ AN พอดี 1,497 แถว
 * = 1,497 AN) แต่ถ้าวันหนึ่งมีการลงซ้ำ ตัวเลขจะไม่บวมขึ้นเงียบ ๆ
 *
 * วัดจากฐานจริง 0.98 วินาทีสำหรับห้าปีงบ · 0.23 รายเดือนของปีเดียว · 0.10 ไตรมาส
 */
export async function getCardiacStats(
  query: CardiacQuery = { by: 'fiscalYear' },
  now = new Date(),
): Promise<CardiacStats> {
  const plan = planOf(query, now)
  const bucket = bucketExpression(plan.by, 'i.dchdate')

  const statement = `
    SELECT bucket,
           icd10,
           as_written,
           COUNT(*) AS total,
           SUM(is_dead) AS dead
    FROM (
      SELECT ${bucket} AS bucket,
             i.an,
             MAX(a.icd10) AS icd10,
             MAX(CASE WHEN ${IHD_AS_WRITTEN} THEN 1 ELSE 0 END) AS as_written,
             MAX(CASE WHEN i.dchtype IN (${DEAD_DISCHARGE_TYPES}) THEN 1 ELSE 0 END) AS is_dead
      FROM ipt i
      JOIN iptdiag a ON a.an = i.an AND a.diagtype = '1' AND ${IHD_CODES}
      WHERE i.dchdate BETWEEN '${plan.from}' AND '${plan.to}'
      GROUP BY bucket, i.an
    ) AS x
    GROUP BY bucket, icd10, as_written
  `

  /**
   * ตัวหารของ "อัตราป่วย" — การนอนโรงพยาบาลทั้งหมดในแต่ละช่วง ไม่เฉพาะโรคหัวใจ
   *
   * แยกคิวรีเพราะนับจากตาราง ipt ล้วน ไม่ต้องแตะ iptdiag เลย วัดแล้ว 0.07 วินาที
   * ถ้าเอาไปรวมในคิวรีเดียวด้วย LEFT JOIN จะต้องสแกนการวินิจฉัยของผู้ป่วยในทุกราย
   * ทั้งที่ต้องการแค่จำนวนแถว — ช้ากว่าโดยไม่ได้อะไรเพิ่ม
   */
  const admissionsStatement = `
    SELECT ${bucketExpression(plan.by, 'dchdate')} AS bucket, COUNT(*) AS admissions
    FROM ipt
    WHERE dchdate BETWEEN '${plan.from}' AND '${plan.to}'
    GROUP BY bucket
  `

  const [result, admissionsResult, coding] = await Promise.all([
    hisDb.execute(sql.raw(statement)),
    hisDb.execute(sql.raw(admissionsStatement)),
    codingCompleteness(thisMonth(now)),
  ])

  const groupsOf = new Map<string, Record<MiGroup, CardiacCount>>()
  const blocksOf = new Map<string, Record<IhdBlock, CardiacCount>>()
  const codeOf = new Map<string, CardiacCode>()
  const asWritten = zeroCount()

  const admissionsOf = new Map<string, number>()
  for (const row of (admissionsResult as unknown as Row[][])[0]) {
    admissionsOf.set(String(row.bucket), Number(row.admissions))
  }

  for (const row of (result as unknown as Row[][])[0]) {
    const key = String(row.bucket)
    const code = String(row.icd10 ?? '').trim()
    const count = { total: Number(row.total), dead: Number(row.dead) }

    // โรคหัวใจขาดเลือดทั้งช่วง — ทุกแถวเข้าบล็อกเดียว สี่บล็อกบวกกันได้เท่ายอดรวม
    let blocks = blocksOf.get(key)
    if (blocks == null) {
      blocks = zeroBlocks()
      blocksOf.set(key, blocks)
    }
    const block = blockOfCode(code)
    add(blocks[block], count)

    // กล้ามเนื้อหัวใจตาย — เฉพาะรหัสในขอบเขตของตัวชี้วัดแรก รหัสอื่นได้ null
    // และต้องไม่เข้ายอด MI เลย ไม่ใช่ตกไปอยู่กลุ่ม other
    const group = groupOfCode(code)
    if (group != null) {
      let groups = groupsOf.get(key)
      if (groups == null) {
        groups = zeroGroups()
        groupsOf.set(key, groups)
      }
      add(groups[group], count)
      add(groups.all, count)
    }

    if (Number(row.as_written) === 1) add(asWritten, count)

    let entry = codeOf.get(code)
    if (entry == null) {
      entry = {
        code,
        name: CODE_NAMES[code] ?? `รหัส ${code}`,
        group,
        block,
        count: zeroCount(),
      }
      codeOf.set(code, entry)
    }
    add(entry.count, count)
  }

  return {
    by: plan.by,
    from: plan.from,
    to: plan.to,
    currentFiscalYear: currentFiscalYear(now),
    fiscalYear: plan.fiscalYear,
    quarter: plan.quarter,
    // ไล่จากรายการช่วงที่ต้องการ ไม่ใช่จากแถวที่ฐานคืนมา — ช่วงที่ไม่มีผู้ป่วยเลย
    // ต้องยังขึ้นบนกราฟเป็นศูนย์ ไม่ใช่หายไปเงียบ ๆ จนคนนับแท่งผิด
    periods: plan.periods.map(({ key, partial }) => {
      const blocks = blocksOf.get(key) ?? zeroBlocks()
      return {
        key,
        partial,
        groups: groupsOf.get(key) ?? zeroGroups(),
        ihd: blocks,
        // ยอดรวมคิดจากผลบวกของสี่บล็อก ไม่ได้นับแยกอีกรอบ — สองตัวเลขจึงขัดกันไม่ได้
        ihdTotal: IHD_BLOCKS.reduce<CardiacCount>(
          (acc, block) => ({
            total: acc.total + blocks[block].total,
            dead: acc.dead + blocks[block].dead,
          }),
          zeroCount(),
        ),
        admissions: admissionsOf.get(key) ?? 0,
      }
    }),
    codes: [...codeOf.values()].sort((a, b) => b.count.total - a.count.total),
    asWritten,
    coding,
  }
}
