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
  type FiscalQuarter,
  type PeriodQuery,
} from '@/lib/his/fiscal-period'

/* ช่วงเวลา ปีงบ ไตรมาส และความครบของการลงรหัส ใช้ของกลางร่วมกับหน้า Sepsis
   — ดูเหตุผลที่ lib/his/fiscal-period.ts */
export type { FiscalQuarter } from '@/lib/his/fiscal-period'
export { shownFiscalYears } from '@/lib/his/fiscal-period'

/** มุมมองที่หน้านี้ขอได้ — ชื่อเดิมของ PeriodQuery เก็บไว้ให้ผู้เรียกไม่ต้องแก้ */
export type StrokeQuery = PeriodQuery

/**
 * สถิติผู้ป่วยในโรคหลอดเลือดสมอง ย้อนหลังห้าปีงบประมาณ
 * (Service Plan สาขาโรคหลอดเลือดสมอง)
 *
 * สี่เรื่องจากฐานผู้ป่วยชุดเดียวกัน: อัตราตายเทียบเกณฑ์ · ภาวะแทรกซ้อนระหว่างนอน ·
 * วันนอนเฉลี่ย · ค่าบริการเฉลี่ยต่อราย
 *
 * นับจากการจำหน่ายผู้ป่วยใน: ตาราง ipt ประกบ iptdiag เฉพาะการวินิจฉัยหลัก
 * (diagtype = '1') ที่รหัสอยู่ในกลุ่มโรคหลอดเลือดสมอง แล้วถือว่าเสียชีวิตเมื่อ
 * ประเภทการจำหน่ายเป็น '08' หรือ '09' — วัดจากฐานจริงพบรหัสเหล่านี้ในกลุ่มโรคนี้
 * ช่วงห้าปี: 01 = 3,926 · 09 = 476 · 02 = 130 · 04 = 38 · 08 = 15 · 03 = 3
 *
 * สามกลุ่มรหัสในคิวรีเดียว ตามช่วงรหัสที่ตกลงกันไว้:
 *   all          I60-I68  ทั้งกลุ่มโรคหลอดเลือดสมองเฉียบพลัน (เกณฑ์ ≤ 7%)
 *   hemorrhagic  I60-I62  เลือดออก/แตก รวมรหัสลูกทุกตัว (เกณฑ์ ≤ 25%)
 *   ischemic     I63-I68  ตีบ/อุดตัน (เกณฑ์ ≤ 5%)
 *
 * **ช่วงรหัสหมายถึงรหัสลูกทุกตัว** จึงเขียนด้วยขอบบนแบบเปิด (>= 'I60' AND < 'I63')
 * ไม่ใช่ BETWEEN ที่เทียบสตริงแล้วตกรหัสลูกของขอบบนเงียบ ๆ สองเรื่องที่ตกลงกันแล้ว
 * และวัดจากฐานจริงทั้งคู่:
 *
 * 1. **I690-I699 อยู่นอกขอบเขตของหน้านี้โดยเจตนา** — เป็นอาการหลงเหลือจากโรค
 *    หลอดเลือดสมอง ไม่ใช่การเกิดโรคครั้งใหม่ เอาเข้ามาจะเจือจางอัตราตายของ stroke
 *    เฉียบพลัน ห้าปีมี 53 การนอน (I694 33 · I693 14 · I691 4 · I690 1 · I698 1)
 *    ขอบบนจึงเขียนเป็น < 'I69' ซึ่งตัดออกอย่างตั้งใจ ไม่ใช่ผลพลอยได้ของ BETWEEN
 *    (คอมเมนต์เดิมเคยเขียนว่าไม่มีแถวที่รหัส >= 'I68' เลย ซึ่งไม่ตรงกับฐาน)
 *
 * 2. **I620-I629 นับเข้ากลุ่มเลือดออก** — เลือดออกในกะโหลกศีรษะแบบที่ไม่ได้เกิดจาก
 *    อุบัติเหตุ (I620 ใต้เยื่อดูรา 212 · I621 เหนือเยื่อดูรา 12 · I629 ไม่ระบุ 2)
 *    เป็นชนิดเลือดออกเต็มตัว เดิม BETWEEN 'I60' AND 'I62' ตกรหัสลูกพวกนี้ไปหมด
 *    ทำให้ 226 การนอนไปโผล่เป็นกลุ่ม "อื่น ๆ" ตกลงแล้วว่าให้นับเข้ากลุ่มเลือดออก
 *    กลุ่มนี้จึงเพิ่มจาก 1,351 เป็น 1,577 ราย (+14%) และสองกลุ่มย่อยบวกกันได้
 *    เท่าทั้งกลุ่มพอดี — กลุ่ม "อื่น ๆ" กลายเป็นศูนย์โดยโครงสร้าง
 *
 *    **การแก้นี้ทำให้คำตัดสินเกณฑ์ ≤ 25% พลิกสองปีงบ** เพราะตัวหารโตขึ้นเร็วกว่า
 *    ตัวตั้ง (I62x 226 ราย เสียชีวิต 24 ราย = 10.6% ซึ่งต่ำกว่าอัตราของกลุ่มมาก):
 *      2565 21.86% ผ่าน    -> 20.69% ผ่าน
 *      2566 25.42% ไม่ผ่าน -> 22.97% **ผ่าน**
 *      2567 23.05% ผ่าน    -> 21.82% ผ่าน
 *      2568 25.35% ไม่ผ่าน -> 23.08% **ผ่าน**
 *      2569 23.45% ผ่าน    -> 21.17% ผ่าน
 *    สองปีที่พลิกเดิมเกินเกณฑ์อยู่แค่ 0.35-0.42 จุด ตัวเลขชุดใหม่คือชุดที่ตรงกับ
 *    นิยามที่ตกลงกันไว้ แต่ต้องรู้ไว้ว่ารายงานเดิมของสองปีนั้นบอกว่าไม่ผ่าน
 *
 *    ขอบเขตทั้งกลุ่ม (เกณฑ์ ≤ 7%) และกลุ่มตีบ/อุดตัน (≤ 5%) **ไม่ขยับเลย** เพราะ
 *    I62x อยู่ในขอบเขตรวมอยู่แล้วตั้งแต่เดิม ที่เปลี่ยนคือการจัดเข้ากลุ่มย่อยเท่านั้น
 *
 * รหัสที่พบจริงในห้าปี — I60 116 · I61 1,233 · I62x 226 · I63 2,935 · I64 9 ·
 * I65 10 · I66 3 · I67 56 · (I69x 53 อยู่นอกขอบเขต)
 *
 * ภาวะแทรกซ้อนระหว่างนอน (คิวรีที่สอง) นับจากโรคร่วม diagtype <> '1' ของผู้ป่วย
 * ที่โรคหลักเป็น stroke:
 *   pneumonia       J69x      ปอดอักเสบจากการสำลัก
 *   uti             N39x      ติดเชื้อทางเดินปัสสาวะ
 *   pneumoniaOther  J12-J18   ปอดอักเสบรหัสอื่น ไม่ใช่ตัวชี้วัด ดูเหตุผลที่ชนิดข้อมูล
 *
 * รหัสที่พบจริงในสองกลุ่มแรกมีแบบเดียวทั้งคู่ — N390 259 ราย · J690 92 ราย
 * ส่วน J12-J18 มี 311 ราย (J18 229 · J15 79 · J12 5 · J14 2) มากกว่า J69x สามเท่า
 * ตัวเลขปอดอักเสบจึงขึ้นกับนิยามอย่างแรง ต้องให้คณะกรรมการตัดสินว่านับแบบไหน
 *
 * ผลรวมของรายเดือนเท่ากับตัวเลขรายปีทุกตัว ยกเว้นยอดเงินที่อาจต่างกันหนึ่งถึง
 * สองบาท เพราะ ROUND ทำทีละช่วง (วัดแล้วปีงบ 2569 รายปี 42,877,292 รายเดือนรวม
 * 42,877,293) ไม่ได้ปัดที่ตัวเลขเดียวกัน
 *
 * ดูได้สองแบบ (ดู StrokeQuery): เทียบรายปีงบ — ห้าปีที่ปิดแล้วบวกปีที่กำลังเดินอยู่
 * ซึ่งติดธง partial ไว้ · หรือเจาะรายเดือนของปีงบเดียว เลือกทั้งปีหรือเฉพาะไตรมาส
 * ก็ได้ ทั้งสองแบบใช้คิวรีชุดเดียวกัน ต่างกันแค่ GROUP BY กับช่วงวันที่ จึงไม่มี
 * ทางที่ตัวเลขรายเดือนรวมแล้วไม่เท่ากับตัวเลขรายปี
 *
 * ที่อยู่ของผู้ป่วย (คิวรีที่สาม) จัดกลุ่มด้วยรหัสอำเภอ/ตำบลใน patient ล้วน ๆ
 * แล้วค่อยเอาชื่อมาประกบทีหลังจากคิวรีเล็กอีกตัว — ไม่ได้ JOIN thaiaddress เข้าไป
 * ในคิวรีรวมอย่างสำนวนตั้งต้น เพราะวัดแล้วการ JOIN ทำให้ช่วงหนึ่งปีกินเวลา
 * 4.9 วินาที ส่วนแบบจัดกลุ่มด้วยรหัสล้วนใช้ 0.15 วินาที (ห้าปี 0.77 วินาที)
 * ต่างกันสามสิบเท่าโดยได้ตัวเลขชุดเดียวกัน
 *
 * ส่งออกไปเป็นจำนวนรายต่ออำเภอและต่อตำบลเท่านั้น ไม่มี HN ไม่มีบ้านเลขที่ ไม่มี
 * หมู่ — ที่อยู่ถูกยุบเป็นตัวนับตั้งแต่ในฐานข้อมูล ไม่ได้ดึงรายคนออกมานับที่แอป
 *
 * วันนอนกับค่าบริการมาจาก an_stat ต่อตรงกับคิวรีหลัก ไม่ใช่คิวรีแยก เพราะ an_stat
 * มีแถวเดียวต่อ AN เสมอ (วัดแล้ว 4,588 แถว = 4,588 AN และครบทุก AN ของ stroke)
 * การ JOIN จึงไม่ทำให้แถวบาน และ AVG/SUM ใช้ได้ตรง ๆ — เวลาที่ใช้ไม่เพิ่มเลย
 *
 * ค่าบริการใช้ an_stat.item_money ไม่ได้ไล่รวม opitemrece.sum_price อย่างสำนวน
 * ตั้งต้น วัดเทียบกันห้าปีแล้วต่างกันไม่เกิน 0.05% (เช่น ปีงบ 2567 43,538,708
 * กับ 43,519,034) แต่เวลาต่างกันมาก — an_stat 0.15 วินาที ส่วนการไล่ opitemrece
 * ซึ่งมี 31 ล้านแถว ใช้ 8.7 วินาที ช้าเกินกว่าจะวางไว้ในเส้นทางที่เปิดหน้าแล้วรอ
 *
 * วัดเวลาจากฐานจริง: คิวรีรวมสามกลุ่มใช้ 1.0 วินาที (EXPLAIN: ipt full scan
 * 425,120 แถว + iptdiag ref ix_an_dxtype) ช่วงห้าปีกว้างเกินกว่าที่อินเดกซ์
 * dchdate จะช่วย ลองเขียนแบบตารางช่วงปีแล้ว join (สำนวนตั้งต้นที่ได้รับมา) ก็ได้
 * เวลาเท่ากัน จึงเลือกแบบพาสเดียวที่อ่านง่ายกว่าและได้สามกลุ่มพร้อมกัน
 */



/* เกณฑ์ (ไม่เกิน 7% ทั้งกลุ่ม · 25% ชนิดเลือดออก · 5% ชนิดตีบ/อุดตัน) อยู่ที่หน้าจอ ไม่ได้อยู่
   ในไฟล์นี้ — โมดูลนี้เป็น server-only หน้าจอที่เป็น client component นำเข้าค่า
   จากที่นี่ไม่ได้ และเกณฑ์ไม่มีผลต่อการนับเลย มีผลแต่กับการระบายสีผ่าน/ไม่ผ่าน */

/** ประเภทการจำหน่ายที่ถือว่าเสียชีวิต */
const DEAD_DISCHARGE_TYPES = ['08', '09']

/** การวินิจฉัยหลัก */
const PRINCIPAL_DIAGNOSIS = '1'

/**
 * จังหวัดของโรงพยาบาล — ใช้กรองที่อยู่ผู้ป่วยในกราฟรายอำเภอ
 *
 * ฮาร์ดโค้ดไว้ตรงนี้ที่เดียว ถ้าระบบถูกนำไปใช้ที่อื่นต้องแก้ค่านี้ — ไม่ได้ทำเป็น
 * ค่าตั้งใน .env เพราะยังไม่มีผู้ใช้ที่สอง และค่าตั้งที่ไม่มีใครตั้งก็เป็นที่ซ่อน
 * ของค่าผิดได้พอกัน
 */
const HOSPITAL_PROVINCE = '56'



export type StrokeCount = {
  /** ผู้ป่วยในที่จำหน่ายในปีงบนั้น */
  total: number
  dead: number
}



export type StrokeStatsPeriod = {
  /**
   * คีย์ของช่วง — ปีงบเป็น '2569' เดือนเป็น '2026-01'
   *
   * เป็นสตริงทั้งสองแบบเพื่อให้หน้าจอใช้โครงเดียวกันได้ทั้งสองมุมมอง ปีงบที่เป็น
   * ตัวเลขจะทำให้ต้องมีสองเส้นทางในทุกที่ที่เรียงหรือทำคีย์ของแถว
   */
  key: string
  /**
   * ช่วงที่ยังไม่จบ — ตัวเลขยังไม่ครบและเทียบกับช่วงอื่นตรง ๆ ไม่ได้
   *
   * หน้าจอต้องทำเครื่องหมายไว้เสมอ ไม่ใช่แค่แสดงเฉย ๆ เพราะนอกจากจะยังไม่ครบช่วง
   * แล้ว การลงรหัสโรคหลักยังตามหลังวันจำหน่ายอีกหลายสัปดาห์ ตัวเลขของช่วงที่กำลัง
   * เดินอยู่จึงต่ำกว่าความจริงเสมอ ไม่ใช่แค่ "ครบตามสัดส่วนเวลาที่ผ่านไป"
   */
  partial: boolean
  /** ทั้งกลุ่ม I60-I68 — ไม่รวม I69x ที่เป็นอาการหลงเหลือ ดูหมายเหตุหัวไฟล์ */
  all: StrokeCount
  /** เลือดออก I60-I62 รวมรหัสลูกทุกตัว (I62x นับเข้ากลุ่มนี้แล้ว) */
  hemorrhagic: StrokeCount
  /** ตีบ/อุดตัน I63-I68 */
  ischemic: StrokeCount
  /** ปอดอักเสบจากการสำลัก J69x เป็นโรคร่วม */
  pneumonia: StrokeCount
  /** ติดเชื้อทางเดินปัสสาวะ N39x เป็นโรคร่วม */
  uti: StrokeCount
  /**
   * ปอดอักเสบรหัสอื่น J12-J18 เป็นโรคร่วม
   *
   * ไม่ใช่ตัวชี้วัด แต่เป็นหลักฐานประกอบตัวชี้วัดปอดอักเสบข้างบน — J69x จับเฉพาะ
   * ที่ลงรหัสว่าสำลัก ส่วนที่ลงเป็นปอดอักเสบธรรมดามีมากกว่านั้นหลายเท่า ถ้าไม่
   * แสดงไว้ด้วย คนอ่านจะเข้าใจว่าผู้ป่วย stroke ปอดอักเสบปีละสิบกว่าราย
   */
  pneumoniaOther: StrokeCount
  /** วันนอนรวมของผู้ป่วยทั้งกลุ่มในช่วงนั้น — หน้าจอหารด้วย all.total เอง */
  stayDays: number
  /** วันนอนที่มากที่สุดในช่วงนั้น ใช้เตือนว่าค่าเฉลี่ยถูกดึงด้วยรายที่นอนยาว */
  stayMax: number
  /** จำนวนรายที่นอนเกิน 30 วัน */
  stayOver30: number
  /** ค่าบริการรวมของผู้ป่วยทั้งกลุ่มในช่วงนั้น (บาท) */
  charge: number
}

export type StrokeTambon = {
  /** รหัสตำบลสองหลัก */
  id: string
  name: string
  patients: number
}

export type StrokeDistrict = {
  /** รหัสอำเภอสองหลัก */
  id: string
  name: string
  patients: number
  /** ตำบลในอำเภอนี้ เรียงจากมากไปน้อย */
  tambons: StrokeTambon[]
}

export type StrokeAreas = {
  districts: StrokeDistrict[]
  /** ผู้ป่วยที่ทะเบียนบ้านอยู่นอกจังหวัด — ไม่อยู่ในกราฟรายอำเภอ */
  outside: number
  /** ผู้ป่วยทั้งหมดในช่วง ใช้เป็นตัวหารของสัดส่วน */
  total: number
}

export type StrokeStats = {
  /** มุมมองที่ตอบกลับมา — ตรงกับที่ขอเสมอ */
  by: 'fiscalYear' | 'month'
  from: string
  to: string
  /** ปีงบที่กำลังเดินอยู่ — ในมุมมองรายปี แถวของปีนี้มี partial = true */
  currentFiscalYear: number
  /** ปีงบที่เจาะดู — null ในมุมมองรายปี */
  fiscalYear: number | null
  /** ไตรมาสที่เจาะดู — null คือทั้งปีงบ */
  quarter: FiscalQuarter | null
  periods: StrokeStatsPeriod[]
  /**
   * ผู้ป่วยแยกตามอำเภอและตำบลที่อยู่ ตลอดช่วงที่ดู (ไม่ได้แยกตามช่วงย่อย)
   *
   * ไม่แยกรายปี/รายเดือนเพราะคำถามของกราฟนี้คือ "คนไข้มาจากไหน" ซึ่งเป็นภาพรวม
   * ของช่วง ไม่ใช่แนวโน้ม — และการแยกจะทำให้ตำบลเล็ก ๆ เหลือช่องละศูนย์หรือหนึ่ง
   * จนอ่านอะไรไม่ได้
   */
  areas: StrokeAreas
  /**
   * ความครบของการลงรหัสโรคในเดือนที่กำลังเดินอยู่
   *
   * ต้องส่งไปให้หน้าจอบอกคนอ่านด้วย เพราะการลงรหัสโรคหลักตามหลังวันจำหน่าย
   * วัดจากฐานจริงวันที่ 7 ต.ค. 2569: ส.ค. 2,282/2,282 · ก.ย. 2,123/2,356 (90%)
   * ส่วนเดือน ต.ค. ที่กำลังเดินอยู่ 20/482 (4%) — และผลของมันคือผู้ป่วย stroke
   * ของปีงบ 2570 นับได้ศูนย์ราย ทั้งที่ช่วงเดียวกันของห้าปีก่อนมี 12-25 ราย
   * ตัวเลขนี้คือคำอธิบายว่าทำไมปีที่กำลังเดินอยู่ถึงยังว่าง
   */
  coding: CodingCompleteness
}

type Row = {
  bucket: string
  total: number
  dead: number
  h_total: number
  h_dead: number
  i_total: number
  i_dead: number
  stay_days: number
  stay_max: number
  stay_over_30: number
  charge: number
}

type ComplicationRow = {
  bucket: string
  pneu_total: number
  pneu_dead: number
  uti_total: number
  uti_dead: number
  other_pneu_total: number
  other_pneu_dead: number
}



/**
 * สถิติตามช่วงที่ขอ — ไม่มีข้อมูลรายบุคคลออกจากฟังก์ชันนี้เลย
 *
 * นับด้วย COUNT(DISTINCT an) ไม่ใช่ COUNT(*) ทั้งที่วัดจากฐานจริงแล้วหนึ่ง an
 * มีแถว diagtype = '1' แถวเดียวเสมอ (4,588 แถว = 4,588 an ในห้าปี) — เวลาที่ใช้
 * เท่ากัน และถ้าวันหนึ่งมีการลงรหัสหลักซ้ำ ตัวเลขจะยังเป็นจำนวนผู้ป่วยอยู่
 */
export async function getStrokeStats(
  query: StrokeQuery = { by: 'fiscalYear' },
  now = new Date(),
): Promise<StrokeStats> {
  const plan = planOf(query, now)
  const { from, to } = plan

  const bucket = sql.raw(bucketExpression(plan.by, 'b.dchdate'))

  const dead = sql`b.dchtype IN (${sql.join(
    DEAD_DISCHARGE_TYPES.map(type => sql`${type}`),
    sql`, `,
  )})`
  /**
   * ช่วงรหัสเขียนด้วยขอบบนแบบเปิด (>= ... AND < ...) ไม่ใช่ BETWEEN
   *
   * BETWEEN เทียบสตริง ขอบบนที่เป็นรหัสสามหลักจึงตกรหัสลูกเงียบ ๆ — เดิมเขียน
   * `BETWEEN 'I60' AND 'I62'` ซึ่งได้ I60x I61x แต่ไม่ได้ I620-I629 เลย วัดแล้ว
   * ห้าปีมี **226 การนอน** ที่ตกช่องว่างนี้ ไปโผล่เป็นกลุ่ม "อื่น ๆ" ทั้งที่
   * I62x คือเลือดออกในกะโหลกศีรษะแบบที่ไม่ได้เกิดจากอุบัติเหตุ ซึ่งเป็นชนิด
   * เลือดออกเต็มตัว ตกลงกันแล้วว่าให้นับเข้ากลุ่มเลือดออก กลุ่มนี้จึงเพิ่มจาก
   * 1,351 เป็น 1,577 ราย และกลุ่ม "อื่น ๆ" กลายเป็นศูนย์โดยโครงสร้าง
   *
   * เลือกขอบบนแบบเปิดเพราะอ่านแล้วเห็นเจตนาตรง ๆ ว่าตัดที่ไหน ไม่ใช่เพราะเร็วกว่า —
   * วัดแล้วสามรูป (BETWEEN เดิม · ขอบบนแบบเปิด · LEFT(icd10,3)) ใช้เวลาเท่ากันหมด
   * ราว 0.73 วินาที เพราะแผนคิวรีไล่จากดัชนีวันจำหน่ายของ ipt แล้วต่อ iptdiag ด้วย
   * an กับ diagtype เงื่อนไข icd10 เป็นตัวกรองท้ายทั้งสามรูป ไม่ได้เป็นตัวเลือกดัชนี
   */
  const hemorrhagic = sql`(a.icd10 >= 'I60' AND a.icd10 < 'I63')`
  const ischemic = sql`(a.icd10 >= 'I63' AND a.icd10 < 'I69')`
  const otherPneumonia = sql`(cdx.icd10 >= 'J12' AND cdx.icd10 < 'J19')`

  /**
   * ภาวะแทรกซ้อนระหว่างนอนโรงพยาบาลของผู้ป่วยที่โรคหลักเป็น stroke
   *
   * ต่อ iptdiag รอบที่สองด้วย diagtype <> '1' — หนึ่ง an มีโรคร่วมได้หลายแถว
   * (วัดแล้วในห้าปี: diagtype 2 = 13,583 · 3 = 2,579 · 5 = 364 · 4 = 205 แถว)
   * การ JOIN จึงทำให้แถวบานออก ตัวนับทุกตัวเป็น COUNT(DISTINCT an) ด้วยเหตุนี้
   * ไม่ใช่เพื่อความปลอดภัยเฉย ๆ อย่างคิวรีหลัก
   *
   * แยกเป็นคนละคิวรีกับคิวรีหลัก ไม่ยัดรวมเป็นอันเดียว เพราะคิวรีหลักนับผู้ป่วย
   * ทั้งหมดซึ่งต้องไม่ถูกเงื่อนไขโรคร่วมมาตัดทิ้ง และยิงพร้อมกันด้วย Promise.all
   * วัดแล้วพร้อมกัน 1.2 วินาที ทีละตัว 1.86 วินาที
   */
  const complications = sql`
    SELECT ${bucket} AS bucket,
           COUNT(DISTINCT CASE WHEN ${sql.raw("cdx.icd10 LIKE 'J69%'")} THEN b.an END) AS pneu_total,
           COUNT(DISTINCT CASE WHEN ${sql.raw("cdx.icd10 LIKE 'J69%'")} AND ${dead} THEN b.an END) AS pneu_dead,
           COUNT(DISTINCT CASE WHEN ${sql.raw("cdx.icd10 LIKE 'N39%'")} THEN b.an END) AS uti_total,
           COUNT(DISTINCT CASE WHEN ${sql.raw("cdx.icd10 LIKE 'N39%'")} AND ${dead} THEN b.an END) AS uti_dead,
           COUNT(DISTINCT CASE WHEN ${otherPneumonia} THEN b.an END) AS other_pneu_total,
           COUNT(DISTINCT CASE WHEN ${otherPneumonia} AND ${dead} THEN b.an END) AS other_pneu_dead
    FROM ipt b
    JOIN iptdiag pdx ON pdx.an = b.an AND pdx.diagtype = ${PRINCIPAL_DIAGNOSIS}
    JOIN iptdiag cdx ON cdx.an = b.an AND cdx.diagtype <> ${PRINCIPAL_DIAGNOSIS}
    WHERE b.dchdate BETWEEN ${from} AND ${to}
      AND (pdx.icd10 >= 'I60' AND pdx.icd10 < 'I69')
      AND (${sql.raw("cdx.icd10 LIKE 'J69%'")} OR ${sql.raw("cdx.icd10 LIKE 'N39%'")} OR ${otherPneumonia})
    GROUP BY bucket
    ORDER BY bucket
  `

  /**
   * ที่อยู่ของผู้ป่วย — จัดกลุ่มด้วยรหัสอำเภอ/ตำบล ไม่ต่อตารางชื่อ
   *
   * นับ DISTINCT an เหมือนคิวรีอื่น คนไข้คนเดียวที่นอนสองครั้งในช่วงเดียวกันจึง
   * นับสองครั้ง ตรงกับตัวหารของกราฟอื่นในหน้านี้ที่นับการนอน ไม่ใช่นับหัวคน
   */
  const areaRows = sql`
    SELECT pt.amppart AS amppart, pt.tmbpart AS tmbpart, COUNT(DISTINCT ip.an) AS n
    FROM ipt ip
    JOIN iptdiag dx ON dx.an = ip.an AND dx.diagtype = ${PRINCIPAL_DIAGNOSIS}
    JOIN patient pt ON pt.hn = ip.hn
    WHERE ip.dchdate BETWEEN ${from} AND ${to}
      AND (dx.icd10 >= 'I60' AND dx.icd10 < 'I69')
      AND pt.chwpart = ${HOSPITAL_PROVINCE}
    GROUP BY pt.amppart, pt.tmbpart
  `

  /** ชื่ออำเภอ (tmbpart = '00') และชื่อตำบลของจังหวัดนี้ — 86 แถว ใช้เวลา 3 ms */
  const areaNames = sql`
    SELECT amppart, tmbpart, name
    FROM thaiaddress
    WHERE chwpart = ${HOSPITAL_PROVINCE} AND codetype IN ('2', '3')
  `

  const [result, complicationResult, areaResult, nameResult] = await Promise.all([
    hisDb.execute(sql`
    SELECT ${bucket} AS bucket,
           COUNT(DISTINCT b.an) AS total,
           COUNT(DISTINCT CASE WHEN ${dead} THEN b.an END) AS dead,
           COUNT(DISTINCT CASE WHEN ${hemorrhagic} THEN b.an END) AS h_total,
           COUNT(DISTINCT CASE WHEN ${hemorrhagic} AND ${dead} THEN b.an END) AS h_dead,
           COUNT(DISTINCT CASE WHEN ${ischemic} THEN b.an END) AS i_total,
           COUNT(DISTINCT CASE WHEN ${ischemic} AND ${dead} THEN b.an END) AS i_dead,
           SUM(s.admdate) AS stay_days,
           MAX(s.admdate) AS stay_max,
           SUM(s.admdate > 30) AS stay_over_30,
           ROUND(SUM(s.item_money)) AS charge
    FROM ipt b
    JOIN iptdiag a ON a.an = b.an
    JOIN an_stat s ON s.an = b.an
    WHERE b.dchdate BETWEEN ${from} AND ${to}
      AND a.diagtype = ${PRINCIPAL_DIAGNOSIS}
      AND (a.icd10 >= 'I60' AND a.icd10 < 'I69')
    GROUP BY bucket
    ORDER BY bucket
  `),
    hisDb.execute(complications),
    hisDb.execute(areaRows),
    hisDb.execute(areaNames),
  ])

  const found = new Map<string, Row>()
  for (const row of (result as unknown as Row[][])[0]) {
    found.set(String(row.bucket), row)
  }

  const foundComplications = new Map<string, ComplicationRow>()
  for (const row of (complicationResult as unknown as ComplicationRow[][])[0]) {
    foundComplications.set(String(row.bucket), row)
  }

  const nameOf = new Map<string, string>()
  for (const row of (nameResult as unknown as { amppart: string; tmbpart: string; name: string }[][])[0]) {
    nameOf.set(`${row.amppart}${row.tmbpart}`, String(row.name).trim())
  }

  const districtOf = new Map<string, StrokeDistrict>()
  for (const row of (areaResult as unknown as { amppart: string; tmbpart: string; n: number }[][])[0]) {
    const amp = String(row.amppart)
    const tmb = String(row.tmbpart)
    const patients = Number(row.n)
    let district = districtOf.get(amp)
    if (district == null) {
      district = {
        id: amp,
        // อำเภอที่ไม่มีชื่อในทะเบียนยังต้องขึ้นกราฟ ไม่ใช่หายไปพร้อมผู้ป่วยของมัน
        name: nameOf.get(`${amp}00`) ?? `อำเภอรหัส ${amp}`,
        patients: 0,
        tambons: [],
      }
      districtOf.set(amp, district)
    }
    district.patients += patients
    district.tambons.push({
      id: tmb,
      name: nameOf.get(`${amp}${tmb}`) ?? 'ไม่ระบุตำบล',
      patients,
    })
  }

  const districts = [...districtOf.values()].sort((a, b) => b.patients - a.patients)
  for (const district of districts) district.tambons.sort((a, b) => b.patients - a.patients)

  const periods = plan.periods.map(({ key }) => found.get(key))
  const totalPatients = periods.reduce((sum, row) => sum + Number(row?.total ?? 0), 0)
  const inProvince = districts.reduce((sum, district) => sum + district.patients, 0)

  // ไล่จากรายการช่วงที่ต้องการ ไม่ใช่จากแถวที่ฐานคืนมา — ช่วงที่ไม่มีผู้ป่วยเลยจะ
  // ไม่มีแถว แต่ต้องยังขึ้นบนกราฟเป็นศูนย์ ไม่ใช่หายไปเงียบ ๆ จนคนนับแท่งผิด
  return {
    by: plan.by,
    from,
    to,
    currentFiscalYear: currentFiscalYear(now),
    fiscalYear: plan.fiscalYear,
    quarter: plan.quarter,
    periods: plan.periods.map(({ key, partial }) => {
      const row = found.get(key)
      const comp = foundComplications.get(key)
      return {
        key,
        partial,
        all: { total: Number(row?.total ?? 0), dead: Number(row?.dead ?? 0) },
        hemorrhagic: { total: Number(row?.h_total ?? 0), dead: Number(row?.h_dead ?? 0) },
        ischemic: { total: Number(row?.i_total ?? 0), dead: Number(row?.i_dead ?? 0) },
        pneumonia: { total: Number(comp?.pneu_total ?? 0), dead: Number(comp?.pneu_dead ?? 0) },
        uti: { total: Number(comp?.uti_total ?? 0), dead: Number(comp?.uti_dead ?? 0) },
        pneumoniaOther: {
          total: Number(comp?.other_pneu_total ?? 0),
          dead: Number(comp?.other_pneu_dead ?? 0),
        },
        stayDays: Number(row?.stay_days ?? 0),
        stayMax: Number(row?.stay_max ?? 0),
        stayOver30: Number(row?.stay_over_30 ?? 0),
        charge: Number(row?.charge ?? 0),
      }
    }),
    // เดือนที่กำลังเดินอยู่จริง ๆ ไม่ใช่เดือนสุดท้ายของช่วงที่เลือก — ตัวเลขนี้
    // อธิบายว่าทำไมข้อมูลล่าสุดถึงยังไม่ขึ้น ซึ่งเป็นเรื่องของวันนี้ ไม่ใช่ของช่วงที่ดู
    areas: {
      districts,
      // คิดจากผลต่าง ไม่ได้ยิงคิวรีอีกตัว — ทั้งสองจำนวนมาจากช่วงวันที่เดียวกัน
      // และตัวหารเดียวกัน ผลต่างจึงเป็นผู้ป่วยที่ทะเบียนบ้านอยู่นอกจังหวัดพอดี
      outside: Math.max(totalPatients - inProvince, 0),
      total: totalPatients,
    },
    coding: await codingCompleteness(thisMonth(now)),
  }
}
