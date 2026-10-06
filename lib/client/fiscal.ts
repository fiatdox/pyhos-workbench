import dayjs, { type Dayjs } from 'dayjs'

/**
 * ปีงบประมาณไทยและไตรมาส — ใช้ได้ทั้งฝั่งหน้าเว็บและฝั่งเซิร์ฟเวอร์
 *
 * อยู่ที่ lib/client ไม่ใช่ lib/his เพราะหน้าที่ใช้เป็น Client Component
 * โมดูลใน lib/his มี 'server-only' อยู่ด้วยจึง import เข้ามาไม่ได้
 *
 * ก่อนหน้านี้นิยามเดียวกันถูกเขียนไว้สองที่ (lib/his/rdu-yearly.ts สำหรับคิวรี
 * และในตัวหน้า RDU Dashboard เองอีกชุด) ซึ่งเป็นของที่ต้องตรงกันตลอด — ถ้าวันหนึ่ง
 * โรงพยาบาลเปลี่ยนนิยามปีงบแล้วแก้ไม่ครบทุกที่ ตัวเลขของสองหน้าจะไม่ตรงกัน
 * โดยไม่มีใครรู้ว่าที่ไหนผิด
 */

/** ปีงบประมาณไทยเริ่ม 1 ต.ค. — dayjs นับเดือนจาก 0 จึงเป็น 9 */
const FISCAL_START_MONTH = 9

/** จำนวนเดือนในหนึ่งไตรมาส */
const MONTHS_PER_QUARTER = 3

export type FiscalQuarter = 1 | 2 | 3 | 4

/** ปีงบประมาณที่วันนี้อยู่ — ตั้งแต่ 1 ต.ค. ถือว่าเข้าปีงบถัดไปแล้ว */
export function currentFiscalYear(now: Dayjs = dayjs()): number {
  return now.year() + 543 + (now.month() >= FISCAL_START_MONTH ? 1 : 0)
}

/** ตัวเลือกปีงบย้อนหลัง เรียงจากใหม่ไปเก่า */
export function fiscalYears(count = 5, now: Dayjs = dayjs()): number[] {
  const current = currentFiscalYear(now)
  return Array.from({ length: count }, (_, index) => current - index)
}

/**
 * ช่วงวันที่ของปีงบประมาณ พ.ศ. — 1 ต.ค. ปีก่อนหน้า ถึง 30 ก.ย. ของปีนั้น
 *
 * ปีงบ 2569 = 1 ต.ค. 2568 ถึง 30 ก.ย. 2569 (ค.ศ. 2025-10-01 ถึง 2026-09-30)
 * ยาว 365-366 วัน ซึ่งยังอยู่ในเพดานของ API ที่รับได้ไม่เกิน 366 วัน
 */
export function fiscalYearRange(buddhistYear: number): [Dayjs, Dayjs] {
  const endYear = buddhistYear - 543
  return [dayjs(`${endYear - 1}-10-01`), dayjs(`${endYear}-09-30`)]
}

/**
 * ช่วงวันที่ของไตรมาสในปีงบ — ไตรมาส 1 คือ ต.ค.-ธ.ค. ไม่ใช่ ม.ค.-มี.ค.
 *
 * นับต่อจากวันเริ่มปีงบทีละสามเดือน แล้วถอยหนึ่งวันจากต้นไตรมาสถัดไป วิธีนี้
 * ได้วันสิ้นเดือนถูกเองทุกกรณีรวมถึงเดือน ก.พ. ปีอธิกสุรทิน ไม่ต้องมีตารางวันที่
 */
export function fiscalQuarterRange(
  buddhistYear: number,
  quarter: FiscalQuarter,
): [Dayjs, Dayjs] {
  const start = fiscalYearRange(buddhistYear)[0].add((quarter - 1) * MONTHS_PER_QUARTER, 'month')
  return [start, start.add(MONTHS_PER_QUARTER, 'month').subtract(1, 'day')]
}

/** ช่วงเดือนของแต่ละไตรมาส ใช้เป็นคำขยายในตัวเลือก */
export const QUARTER_MONTHS: Record<FiscalQuarter, string> = {
  1: 'ต.ค.–ธ.ค.',
  2: 'ม.ค.–มี.ค.',
  3: 'เม.ย.–มิ.ย.',
  4: 'ก.ค.–ก.ย.',
}

/**
 * ตัดปลายช่วงไม่ให้เลยวันนี้
 *
 * ปีงบและไตรมาสที่ยังไม่จบมีวันที่ในอนาคตอยู่ด้วย ซึ่งไม่มีข้อมูลแน่นอน
 * ป้ายบอกช่วงที่เขียนว่าถึง 30 ก.ย. ปีหน้าจึงให้ความรู้สึกว่าครอบคลุมกว่าที่มีจริง
 * และตัวเลือกวันที่ของหน้าพวกนี้ก็กัน maxDate ไว้ที่วันนี้อยู่แล้ว ควรเป็นกติกาเดียวกัน
 */
export function clampToToday(range: [Dayjs, Dayjs], now: Dayjs = dayjs()): [Dayjs, Dayjs] {
  return [range[0], range[1].isAfter(now, 'day') ? now : range[1]]
}

/** ไตรมาสนั้นเริ่มแล้วหรือยัง — ที่ยังไม่เริ่มไม่มีข้อมูลให้ดูเลย */
export function quarterHasStarted(
  buddhistYear: number,
  quarter: FiscalQuarter,
  now: Dayjs = dayjs(),
): boolean {
  return !fiscalQuarterRange(buddhistYear, quarter)[0].isAfter(now, 'day')
}
