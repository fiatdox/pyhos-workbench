import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'
import { labCodes } from '@/lib/his/lab-codes'
import { diagnosisTable, drugTable } from '@/lib/his/rdu-registry'
import { DISPENSED_QTY, OPD_ONLY } from '@/lib/his/rdu-visit-report'

/**
 * ตัวชี้วัดการใช้ยา metformin ในผู้ป่วยเบาหวาน
 *
 * คำถามคือ "ผู้ป่วยเบาหวานที่ได้รับยาลดระดับน้ำตาล มีกี่คนที่ได้ metformin
 * ไม่ว่าจะเดี่ยว ๆ หรือร่วมกับยาอื่น" เกณฑ์เป้าหมายคือตั้งแต่ 80% ขึ้นไป —
 * metformin เป็นยาแรกของแนวทางการรักษาเบาหวานชนิดที่ 2 ทั้งเรื่องผลลัพธ์ระยะยาว
 * ราคา และความเสี่ยงน้ำตาลต่ำที่ต่ำกว่าซัลโฟนิลยูเรีย
 *
 * ทำไมไม่ใช้โครงของ rdu-visit-report.ts:
 *
 *   1. ตัวหารไม่ใช่ "ครั้งที่วินิจฉัยเบาหวาน" แต่เป็น "ผู้ป่วยเบาหวานที่ได้รับยา
 *      ลดน้ำตาล" — ครั้งที่ผู้ป่วยเบาหวานมาด้วยเรื่องอื่นแล้วไม่ได้รับยาเบาหวานเลย
 *      ไม่ควรอยู่ในตัวหาร วัดจากปีงบ 2568 ถ้านับทุกครั้งที่ลงรหัสเบาหวานจะได้
 *      ตัวหาร 30,108 ครั้ง ทั้งที่ครั้งที่มีการจ่ายยาลดน้ำตาลจริงมีแค่ 20,058 ครั้ง
 *      ตัวชี้วัดจะต่ำกว่าความจริงไปหนึ่งในสามทันที
 *
 *   2. นับเป็น "คน" ไม่ใช่ "ครั้ง" ตามนิยามของตัวชี้วัด — ผู้ป่วยคนหนึ่งมารับยา
 *      หลายรอบต่อปี ถ้านับรายครั้ง คนที่มาถี่จะมีน้ำหนักมากกว่าคนที่มาปีละสองครั้ง
 *      โดยไม่มีเหตุผลทางคลินิก (ปีงบ 2568: 6,595 คน จาก 20,058 ครั้ง)
 *
 *   3. ตัวหารต้องตัดคนที่มีข้อห้ามใช้ออก ซึ่งไม่ใช่เรื่องที่ทะเบียนรหัสตอบได้
 *      ต้องไปดูผลแล็บ (ดู METFORMIN_MIN_EGFR)
 *
 * สถานะ "เป็นเบาหวาน" ใช้แบบติดตัวผู้ป่วยเหมือนข้อ CKD ไม่ใช่ "ลงรหัสในครั้งนั้น" —
 * ครั้งที่มารับยาต่อเนื่องจำนวนมากไม่ได้ลงรหัสเบาหวานซ้ำ วัดจากปีงบ 2568 แบบติดตัว
 * ได้ 6,595 คน ส่วนแบบลงรหัสในครั้งนั้นได้ 6,386 คน หายไป 209 คน (3.2%)
 * ทั้งที่เป็นผู้ป่วยเบาหวานที่มารับยาเบาหวานชัด ๆ — และแบบติดตัวยังเร็วกว่าห้าเท่า
 */

/**
 * เส้นแบ่งข้อห้ามใช้ metformin (eGFR, mL/min/1.73m²)
 *
 * ต่ำกว่า 30 เป็นข้อห้ามใช้ตามฉลากยาและแนวทางการรักษา เพราะ metformin ขับออก
 * ทางไตทั้งหมด เมื่อไตเสื่อมมากยาจะคั่งจนเสี่ยงภาวะเลือดเป็นกรดแลกติก
 *
 * นิยามของตัวชี้วัดเขียนว่า "โดยไม่มีข้อห้ามใช้" ตัวหารจึงต้องตัดคนกลุ่มนี้ออก
 * ไม่ใช่แค่หมายเหตุไว้ — ผลต่างมากเกินกว่าจะละไว้ วัดจากปีงบ 2568: ผู้ป่วย 6,595 คน
 * ในนั้น 716 คนมี eGFR ล่าสุดต่ำกว่า 30 ถ้านับรวมตัวชี้วัดได้ 71.7% ถ้าตัดออก
 * ตามนิยามได้ 79.6% ซึ่งคนละฝั่งของเกณฑ์ 80% กันเลย
 *
 * ใช้ค่า eGFR ครั้งล่าสุดไม่เกินวันสุดท้ายของช่วงที่เลือก ไม่ใช่ "เคยต่ำกว่า 30" —
 * เหตุผลเดียวกับข้อ CKD (ดู lib/his/rdu-ckd-nsaid.ts) ค่าไตที่เคยตกตอนป่วย
 * เฉียบพลันแล้วกลับมาปกติ ไม่ใช่ข้อห้ามใช้ถาวร
 */
export const METFORMIN_MIN_EGFR = 30

/**
 * ชื่อสามัญที่ใช้ชี้ว่ารายการยานั้นมี metformin
 *
 * ข้อนี้ไม่มีทะเบียนของตัวเองแบบตัวชี้วัดข้ออื่น เพราะฐาน HIS มีคำตอบอยู่แล้ว —
 * drugitems.generic_name เติมไว้ครบทั้ง 2,935 รายการ ไม่มีแถวว่างแม้แถวเดียว
 * และค้นด้วยคำนี้ได้ตรงกับที่ไล่เลือกเองทุกรหัส (21 รายการ ไม่ขาดไม่เกิน)
 *
 * ข้อดีที่สำคัญกว่าการไม่ต้องสร้างตารางเพิ่ม คือทะเบียนที่ตั้งไว้ครั้งเดียวจะเก่า
 * ทันทีที่โรงพยาบาลรับยาสูตรผสมตัวใหม่เข้าบัญชี (ปีที่แล้วรับ JARDIANCE DUO
 * เข้ามา ปีก่อนหน้ารับ SIDAPVIA) ถ้าไม่มีใครไปเพิ่มรหัสใหม่เข้าทะเบียน คนที่
 * เปลี่ยนไปใช้ยาตัวนั้นจะหายจากตัวตั้งเงียบ ๆ แล้วตัวชี้วัดจะตกโดยไม่มีสาเหตุ
 * — การอ่านจากชื่อสามัญตามของใหม่ได้เองตั้งแต่วันที่เภสัชกรตั้งรายการยา
 *
 * ค้นแบบมีคำนี้อยู่ในชื่อ ไม่ใช่เท่ากับพอดี — ยาสูตรผสมเขียนเป็น
 * 'EMPAGLIFLOZIN+METFORMIN' ซึ่งต้องนับด้วยตามนิยาม "เดี่ยวหรือร่วมกับยาอื่น"
 * (ตรวจแล้วไม่มีชื่อสามัญอื่นในฐานที่มีคำนี้เป็นส่วนหนึ่งโดยไม่ใช่ metformin)
 */
export const METFORMIN_GENERIC = 'METFORMIN'

/** เกณฑ์เป้าหมายของตัวชี้วัด (ร้อยละ) — ยิ่งสูงยิ่งดี */
export const METFORMIN_TARGET = 80

/** ช่วงวันที่ยาวสุดต่อการค้นหนึ่งครั้ง — เท่ากับตัวชี้วัดข้ออื่น */
export const METFORMIN_MAX_RANGE_DAYS = 366

/**
 * จำนวนผู้ป่วยสูงสุดในรายการที่ต้องทบทวนต่อการค้นหนึ่งครั้ง
 *
 * หนึ่งแถวคือผู้ป่วยหนึ่งคน ไม่ใช่หนึ่งครั้ง รายการจึงสั้นกว่าตัวชี้วัดข้ออื่นมาก
 * ทั้งปีมีราว 1,900 คน เผื่อไว้ที่ 3,000 เท่ากับข้อ CKD
 */
const MAX_CASE_ROWS = 3000

const rows = (result: unknown) => result as unknown as Record<string, unknown>[]

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v).trim() || null)

/**
 * รายการรหัสยาแบบผูกค่าเป็นพารามิเตอร์ ไม่ใช่คิวรีย่อย
 *
 * เขียน IN (SELECT icode FROM ทะเบียน) ตรง ๆ ไม่ได้ — MariaDB จะเลิกใช้ดัชนีของ
 * opitemrece.icode แล้วไล่อ่านทั้งตารางสามสิบล้านแถว (เจอมาแล้วกับข้อ RAS
 * ที่ทำให้คิวรีเดียวกันใช้เวลา 104 วินาทีแทนที่จะเป็น 2 วินาที) ดึงรหัสมาก่อน
 * แล้วส่งเป็นค่าผูกจึงเร็วกว่ามาก และได้ผลลัพธ์เหมือนกันทุกแถว
 */
const codeList = (icodes: string[]) =>
  sql.join(
    icodes.map(icode => sql`${icode}`),
    sql`, `,
  )

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const value = Number(v)
  return Number.isFinite(value) ? value : null
}

/** ผลแล็บที่กรอกเป็นข้อความ นับเฉพาะแถวที่เป็นตัวเลขล้วน (มี 'ดูผลที่ image' ปนอยู่) */
const NUMERIC_RESULT = '^[0-9]+(\\.[0-9]+)?$'

/**
 * เหตุที่ผู้ป่วยคนนี้อยู่ในรายการทบทวน
 *
 * แยกสามแบบเพราะสิ่งที่ต้องทำต่อไม่เหมือนกัน — 'gap' คือช่องว่างของตัวชี้วัด
 * ที่ตามแก้ได้จริง ส่วน 'excluded' แค่แสดงให้เห็นว่าถูกตัดออกจากตัวหารเพราะอะไร
 * และ 'unsafe' เป็นเรื่องความปลอดภัย ไม่ใช่เรื่องตัวเลขของตัวชี้วัด
 */
export type MetforminCaseKind =
  /** ไม่มีข้อห้ามใช้ แต่ไม่ได้รับ metformin — กลุ่มที่ทำให้ตัวชี้วัดไม่ถึงเกณฑ์ */
  | 'gap'
  /** ไม่ได้รับ metformin และมีข้อห้ามใช้ — ถูกตัดออกจากตัวหารแล้ว ถูกต้องตามนิยาม */
  | 'excluded'
  /** ได้รับ metformin ทั้งที่ eGFR ต่ำกว่าเส้นแบ่ง — ต้องทบทวนเรื่องความปลอดภัย */
  | 'unsafe'

/** ผู้ป่วยหนึ่งคนในรายการที่ต้องทบทวน */
export type MetforminCase = {
  hn: string
  patientName: string
  ageYears: number | null
  /** '1' = ชาย, '2' = หญิง ตามรหัสของ HIS */
  sex: string | null
  /** จำนวนครั้งที่ได้รับยาลดน้ำตาลในช่วงที่เลือก */
  visits: number
  /** วันที่รับยาครั้งล่าสุดในช่วงที่เลือก 'YYYY-MM-DD' */
  lastDate: string | null
  /** เลขที่การมารับบริการครั้งล่าสุด — ใช้เปิดดูรายละเอียดครั้งนั้น */
  lastVn: string
  /** ห้องตรวจของครั้งล่าสุด */
  department: string | null
  /** แพทย์ผู้ตรวจของครั้งล่าสุด */
  doctor: string | null
  /** ชื่อยาลดน้ำตาลที่ได้รับในช่วงนี้ (ทุกครั้งรวมกัน) */
  drugs: string[]
  /** eGFR ครั้งล่าสุดไม่เกินวันสุดท้ายของช่วง — null = ไม่เคยมีผลแล็บ */
  egfr: number | null
  /** วันที่ของผล eGFR ที่ยกมา 'YYYY-MM-DD' */
  egfrDate: string | null
  kind: MetforminCaseKind
}

export type MetforminReport = {
  cases: MetforminCase[]
  /** ผู้ป่วยเบาหวานที่ได้รับยาลดน้ำตาลทั้งหมดในช่วงนี้ (คน) — ก่อนตัดข้อห้ามใช้ */
  totalPatients: number
  /** ในนั้นเป็นคนที่มีข้อห้ามใช้ metformin (คน) */
  contraindicatedPatients: number
  /** ตัวหารตามนิยาม = totalPatients − contraindicatedPatients */
  denominatorPatients: number
  /** ตัวตั้ง = คนในตัวหารที่ได้รับ metformin อย่างน้อยหนึ่งครั้ง */
  metforminPatients: number
  /** คนที่ได้รับ metformin ทั้งที่มีข้อห้ามใช้ — ไม่อยู่ในตัวตั้งและตัวหาร */
  metforminDespiteContraindication: number
  /** จำนวนครั้งที่ได้รับยาลดน้ำตาลทั้งหมด — ไว้เทียบว่าหนึ่งคนมากี่รอบ */
  totalVisits: number
  /** จำนวนรหัสในทะเบียนเบาหวาน — 0 แปลว่ายังไม่ได้ตั้งค่า รายงานจะว่างเสมอ */
  diagnosisCodes: number
  /** จำนวนรายการในทะเบียนยาลดน้ำตาล — 0 แปลว่าไม่มีตัวหาร */
  antidiabeticItems: number
  /** จำนวนรายการยาที่มี metformin ในฐาน — 0 แปลว่าทุกคนจะขึ้นว่าไม่ได้รับ */
  metforminItems: number
  /** icode ของยา metformin ใช้ไฮไลต์บรรทัดยาตอนเปิดดูรายละเอียดครั้งนั้น */
  metforminIcodes: string[]
  /** เส้นแบ่ง eGFR ที่ใช้ตัดสินข้อห้ามใช้ */
  egfrThreshold: number
  /** เกณฑ์เป้าหมาย (ร้อยละ) */
  target: number
  /** ถึงเพดานจำนวนแถวแล้วหรือยัง */
  truncated: boolean
}

const split = (value: unknown, separator: string): string[] => {
  const text = str(value)
  return text == null
    ? []
    : text
        .split(separator)
        .map(item => item.trim())
        .filter(Boolean)
}

const empty = (
  base: Pick<
    MetforminReport,
    'diagnosisCodes' | 'antidiabeticItems' | 'metforminItems' | 'metforminIcodes'
  >,
): MetforminReport => ({
  cases: [],
  totalPatients: 0,
  contraindicatedPatients: 0,
  denominatorPatients: 0,
  metforminPatients: 0,
  metforminDespiteContraindication: 0,
  totalVisits: 0,
  egfrThreshold: METFORMIN_MIN_EGFR,
  target: METFORMIN_TARGET,
  truncated: false,
  ...base,
})

/**
 * ร้อยละของผู้ป่วยเบาหวานที่ใช้ metformin ในช่วงวันที่ที่เลือก
 *
 * แบ่งเป็นสองคิวรีด้วยเหตุผลเดียวกับข้อ CKD — ตัวหารเป็นแค่ตัวเลขสรุปที่นับ
 * ที่ฐานแล้วส่งมาเฉพาะผลรวม ส่วนรายละเอียดรายคนส่งมาเฉพาะคนที่ต้องทบทวนจริง
 * (ปีงบ 2568: ตัวหาร 6,595 คน แต่รายการทบทวนมี 1,914 คน) การขนข้อมูลผู้ป่วย
 * ที่ผ่านเกณฑ์อยู่แล้วลงเบราว์เซอร์ไม่มีใครได้ใช้
 *
 * ทั้งสองคิวรีไล่จาก opitemrece เข้ามา ไม่ได้ไล่จาก vn_stat ออกไป — เหตุผลเดียว
 * กับข้อ CKD คือเริ่มจากฝั่งที่แคบกว่า ทั้งปีใช้เวลาราวห้าวินาทีต่อคิวรี
 */
export async function loadMetforminReport(input: {
  from: string
  to: string
}): Promise<MetforminReport> {
  const dxTable = sql.raw(diagnosisTable('dm'))
  const rxTable = sql.raw(drugTable('antidiabetic'))
  const egfrCode = labCodes.egfr

  const [dxRows] = await hisDb.execute(sql`SELECT COUNT(*) AS n FROM ${dxTable}`)
  const [rxRows] = await hisDb.execute(sql`SELECT icode FROM ${rxTable}`)
  const [mfmRows] = await hisDb.execute(sql`
    SELECT icode FROM drugitems WHERE generic_name LIKE ${`%${METFORMIN_GENERIC}%`}`)

  const icodesOf = (result: unknown) =>
    rows(result)
      .map(row => String(row.icode ?? '').trim())
      .filter(Boolean)

  const antidiabeticIcodes = icodesOf(rxRows)
  const metforminIcodes = icodesOf(mfmRows)

  const base = {
    diagnosisCodes: Number(rows(dxRows)[0]?.n ?? 0),
    antidiabeticItems: antidiabeticIcodes.length,
    metforminItems: metforminIcodes.length,
    metforminIcodes,
  }

  // ไม่มีทะเบียนเบาหวานหรือไม่มีทะเบียนยาลดน้ำตาล = ไม่มีตัวหาร
  // ต้องคืนก่อนถึงคิวรีด้วย เพราะ IN () ที่ไม่มีค่าเลยเป็น syntax error
  if (base.diagnosisCodes === 0 || base.antidiabeticItems === 0) return empty(base)

  /* ผู้ป่วยที่เคยถูกลงรหัสเบาหวาน พร้อมวันแรกที่ถูกลง — ต้องมี since ไว้เทียบ
     กับวันที่มารับบริการ ไม่งั้นครั้งที่มาก่อนจะถูกวินิจฉัยก็จะเข้าตัวหารด้วย */
  const diabeticPatients = sql`
    JOIN (SELECT d.hn, MIN(d.vstdate) AS since
            FROM ovstdiag d
            JOIN ${dxTable} a ON a.icd10 = d.icd10
           GROUP BY d.hn) dm
      ON dm.hn = v.hn AND dm.since <= v.vstdate`

  /** ครั้งที่ผู้ป่วยเบาหวานได้รับยาลดน้ำตาลจริงในช่วงที่เลือก — ฐานของทั้งสองคิวรี */
  const dispensedWhere = sql`
    WHERE o.vstdate BETWEEN ${input.from} AND ${input.to}
      AND o.qty > ${DISPENSED_QTY}
      AND o.icode IN (${codeList(antidiabeticIcodes)})
      AND ${OPD_ONLY}`

  /* ไม่มีรายการยา metformin ในฐานเลยเป็นไปได้ในทางทฤษฎี ซึ่ง IN () เปล่า ๆ
     เป็น syntax error กรณีนั้นให้เป็นศูนย์ไปเลย ทุกคนจะนับว่าไม่ได้รับ */
  const metforminVisits =
    metforminIcodes.length === 0
      ? sql`0`
      : sql`COUNT(DISTINCT CASE WHEN o.icode IN (${codeList(metforminIcodes)}) THEN v.vn END)`

  /**
   * eGFR ครั้งล่าสุดของผู้ป่วย ไม่เกินวันสุดท้ายของช่วงที่เลือก
   *
   * ผูกกับ hn ของคิวรีชั้นนอก (ชื่อ x) ไม่ได้ผูกกับแต่ละครั้งที่มา เพราะที่นี่
   * หนึ่งแถวคือผู้ป่วยหนึ่งคนตลอดช่วง ไม่ใช่หนึ่งครั้ง — ข้อห้ามใช้จึงต้องตัดสิน
   * ด้วยค่าล่าสุดค่าเดียวของคนนั้น
   *
   * ค่ากับวันที่ต่อกันมาในช่องเดียวคั่นด้วย @ เพราะคิวรีย่อยแบบ ORDER BY ... LIMIT 1
   * คืนได้คอลัมน์เดียว (เหมือนข้อ CKD) — และสำคัญกว่านั้นคือคิวรีย่อยนี้แพง
   * ถ้าเรียกซ้ำเพื่อเอาค่ากับเอาวันที่แยกกัน ก็จ่ายค่าเดิมสองรอบเพื่อข้อมูลชุดเดียว
   */
  const latestEgfr = sql`
    (SELECT CONCAT(lo.lab_order_result, '@', DATE_FORMAT(lh.order_date, '%Y-%m-%d'))
       FROM lab_head lh
       JOIN lab_order lo ON lo.lab_order_number = lh.lab_order_number
      WHERE lh.hn = x.hn
        AND lo.lab_items_code = ${egfrCode}
        AND lo.lab_order_result REGEXP ${NUMERIC_RESULT}
        AND lh.order_date <= ${input.to}
      ORDER BY lh.order_date DESC
      LIMIT 1)`

  /**
   * "มีข้อห้ามใช้หรือไม่" จากช่องที่ต่อค่ากับวันที่ไว้ด้วย @
   *
   * แกะค่ากลับออกมาเทียบ แทนที่จะเรียกคิวรีย่อยของ eGFR ซ้ำอีกรอบ — คิวรีย่อยนั้น
   * แพงที่สุดในทั้งคิวรี (วิ่งหนึ่งรอบต่อผู้ป่วยหนึ่งคน) ส่วน SUBSTRING_INDEX
   * ทำงานกับข้อความในมือแล้วจึงแทบไม่มีต้นทุน
   */
  const contraindicated = (column: string) =>
    sql`(CAST(SUBSTRING_INDEX(${sql.raw(column)}, '@', 1) AS DECIMAL(10, 2))
         < ${METFORMIN_MIN_EGFR}) IS TRUE`

  /** ยอดรวมของผู้ป่วยทุกคนในตัวหาร — แยกตามว่าได้ metformin และมีข้อห้ามใช้หรือไม่ */
  const [summary] = await hisDb.execute(sql`
    SELECT COUNT(*) AS patients,
           SUM(z.visits) AS visits,
           SUM(z.contra) AS contra,
           SUM(z.mfm > 0 AND NOT z.contra) AS mfm_ok,
           SUM(z.mfm > 0 AND z.contra) AS mfm_contra
    FROM (
      SELECT y.visits, y.mfm, ${contraindicated('y.egfr_latest')} AS contra
      FROM (
        SELECT x.visits, x.mfm, ${latestEgfr} AS egfr_latest
        FROM (
          SELECT v.hn, COUNT(DISTINCT v.vn) AS visits, ${metforminVisits} AS mfm
          FROM opitemrece o
          JOIN vn_stat v ON v.vn = o.vn
          LEFT OUTER JOIN ovst ov ON ov.vn = v.vn
          ${diabeticPatients}
          ${dispensedWhere}
          GROUP BY v.hn
        ) x
      ) y
    ) z`)

  const summaryRow = rows(summary)[0] ?? {}
  const totalPatients = Number(summaryRow.patients ?? 0)
  const contraindicatedPatients = Number(summaryRow.contra ?? 0)
  const metforminPatients = Number(summaryRow.mfm_ok ?? 0)
  const metforminDespiteContraindication = Number(summaryRow.mfm_contra ?? 0)

  const totals = {
    totalPatients,
    contraindicatedPatients,
    denominatorPatients: totalPatients - contraindicatedPatients,
    metforminPatients,
    metforminDespiteContraindication,
    totalVisits: Number(summaryRow.visits ?? 0),
  }

  // ไม่มีรายการยา metformin ในฐาน = รายการทบทวนจะกลายเป็นตัวหารทั้งชุดซึ่งไม่มีประโยชน์
  // ส่งแต่ตัวเลขสรุปไปให้หน้าจอเตือนว่าฐานข้อมูลยามีปัญหา
  if (base.metforminItems === 0) return { ...empty(base), ...totals }

  /* รายการทบทวน — ผู้ป่วยที่ไม่ได้รับ metformin (ทุกคน) บวกคนที่ได้รับทั้งที่
     มีข้อห้ามใช้ กรองที่ชั้นนอกเพราะ eGFR เป็นคิวรีย่อยที่ชั้นในยังไม่รู้จัก

     ห้องตรวจกับแพทย์เอาของครั้งล่าสุด ไม่ใช่ทุกครั้งรวมกัน — ใช้ GROUP_CONCAT
     เรียงย้อนวันที่แล้วตัดเอาตัวแรก ซึ่งได้ค่าของครั้งล่าสุดโดยไม่ต้อง join ซ้ำ
     อีกรอบเพื่อหาว่าครั้งล่าสุดคือ vn ไหน */
  const [result] = await hisDb.execute(sql`
    SELECT y.* FROM (
    SELECT x.hn, x.visits, x.mfm, x.last_date, x.last_vn, x.dep_name, x.doctor_name, x.drug_names,
           CONCAT_WS(' ', p.pname, p.fname, p.lname) AS patient_name,
           x.age_y, x.sex,
           ${latestEgfr} AS egfr_latest
    FROM (
      SELECT v.hn,
             COUNT(DISTINCT v.vn) AS visits,
             ${metforminVisits} AS mfm,
             DATE_FORMAT(MAX(v.vstdate), '%Y-%m-%d') AS last_date,
             MAX(v.age_y) AS age_y,
             MAX(v.sex) AS sex,
             SUBSTRING_INDEX(
               GROUP_CONCAT(v.vn ORDER BY v.vstdate DESC SEPARATOR '|'), '|', 1) AS last_vn,
             SUBSTRING_INDEX(
               GROUP_CONCAT(dep.department ORDER BY v.vstdate DESC SEPARATOR '|'), '|', 1)
               AS dep_name,
             SUBSTRING_INDEX(
               GROUP_CONCAT(doc.name ORDER BY v.vstdate DESC SEPARATOR '|'), '|', 1)
               AS doctor_name,
             GROUP_CONCAT(DISTINCT di.name ORDER BY di.name SEPARATOR ' | ') AS drug_names
      FROM opitemrece o
      JOIN drugitems di ON di.icode = o.icode
      JOIN vn_stat v ON v.vn = o.vn
      LEFT OUTER JOIN ovst ov ON ov.vn = v.vn
      LEFT OUTER JOIN kskdepartment dep ON dep.depcode = ov.main_dep
      LEFT OUTER JOIN doctor doc ON doc.code = ov.doctor
      ${diabeticPatients}
      ${dispensedWhere}
      GROUP BY v.hn
    ) x
    LEFT OUTER JOIN patient p ON p.hn = x.hn
    ) y
    WHERE y.mfm = 0 OR ${contraindicated('y.egfr_latest')}
    ORDER BY y.last_date DESC, y.hn
    LIMIT ${MAX_CASE_ROWS + 1}`)

  const all = rows(result)

  const splitEgfr = (value: unknown): { egfr: number | null; egfrDate: string | null } => {
    const text = str(value)
    if (text == null) return { egfr: null, egfrDate: null }
    const at = text.lastIndexOf('@')
    if (at < 0) return { egfr: num(text), egfrDate: null }
    return { egfr: num(text.slice(0, at)), egfrDate: str(text.slice(at + 1)) }
  }

  const cases: MetforminCase[] = all.slice(0, MAX_CASE_ROWS).map(row => {
    const { egfr, egfrDate } = splitEgfr(row.egfr_latest)
    const hasContraindication = egfr != null && egfr < METFORMIN_MIN_EGFR
    const onMetformin = Number(row.mfm ?? 0) > 0
    return {
      hn: String(row.hn ?? '').trim(),
      patientName: str(row.patient_name) ?? '—',
      ageYears: num(row.age_y),
      sex: str(row.sex),
      visits: Number(row.visits ?? 0),
      lastDate: str(row.last_date),
      lastVn: String(row.last_vn ?? '').trim(),
      department: str(row.dep_name),
      doctor: str(row.doctor_name),
      drugs: split(row.drug_names, '|'),
      egfr,
      egfrDate,
      kind: onMetformin ? 'unsafe' : hasContraindication ? 'excluded' : 'gap',
    }
  })

  return {
    ...empty(base),
    ...totals,
    cases,
    truncated: all.length > MAX_CASE_ROWS,
  }
}
