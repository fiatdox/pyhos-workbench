import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'
import { diagnosisTable } from '@/lib/his/rdu-registry'
import {
  ANTIBIOTIC_FLAG_VALUE,
  DISPENSED_QTY,
} from '@/lib/his/rdu-visit-report'

/**
 * ตัวชี้วัดการใช้ยาปฏิชีวนะในสตรีคลอดปกติครบกำหนดทางช่องคลอด (NL)
 *
 * การคลอดปกติที่ไม่มีภาวะแทรกซ้อนไม่ต้องให้ยาปฏิชีวนะ การให้จึงเป็นการใช้ยา
 * โดยไม่มีข้อบ่งชี้ ยิ่งต่ำยิ่งดี
 *
 * ข้อนี้เป็นข้อเดียวในระบบที่นับจากฝั่งผู้ป่วยใน ทุกข้อที่เหลือเป็นผู้ป่วยนอก
 * ทั้งหมด — การคลอดเป็นเหตุการณ์ที่เกิดตอนนอนโรงพยาบาล ตัวหารจึงเป็นการรับไว้
 * เป็นผู้ป่วยใน (an) ไม่ใช่ครั้งที่มารับบริการ (vn) และต้องไปอ่านจากคู่ตาราง
 * คนละชุด: an_stat/iptdiag/ipt แทน vn_stat/ovstdiag/ovst
 *
 * ผลที่ตามมาที่สำคัญ: เงื่อนไข OPD_ONLY ที่ข้ออื่นใช้ตัดผู้ป่วยในออก ใช้กับข้อนี้
 * ไม่ได้เลย — ที่นี่ผู้ป่วยในคือคนที่เรานับ ไม่ใช่คนที่เราตัดออก
 *
 * ยาปฏิชีวนะดูจากธง drugitems.antibiotic เหมือนข้อ AD และ APL ไม่ได้ทำทะเบียน
 * แยก และดูจาก opitemrece เหมือนกัน — ตารางนั้นเก็บทั้งฝั่งผู้ป่วยนอกและใน
 * (ตรวจแล้วในหนึ่งเดือนมีแถวที่มี an อยู่ 248,981 จาก 449,615 แถว) ต่างกันแค่
 * ผูกด้วย an แทน vn
 */

/** ช่วงวันที่ยาวสุดต่อการค้นหนึ่งครั้ง — เท่ากับตัวชี้วัดข้ออื่น */
export const DELIVERY_MAX_RANGE_DAYS = 366

/**
 * จำนวนแถวสูงสุดต่อการค้นหนึ่งครั้ง
 *
 * ต่ำกว่าข้ออื่นได้เพราะตัวหารเล็กมาก — การคลอดปกติทั้งปีมีราวสามร้อยราย
 * ต่างจากตัวชี้วัดผู้ป่วยนอกที่ตัวหารเป็นหมื่น เพดานนี้จึงไม่มีทางถึงในทางปฏิบัติ
 * แต่ยังใส่ไว้กันกรณีทะเบียนถูกตั้งกว้างเกินจนดึงการคลอดทุกแบบเข้ามา
 */
const MAX_ROWS = 2000

const rows = (result: unknown) => result as unknown as Record<string, unknown>[]

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v).trim() || null)

const split = (value: unknown, separator: string): string[] => {
  const text = str(value)
  return text == null
    ? []
    : text
        .split(separator)
        .map(item => item.trim())
        .filter(Boolean)
}

/** การคลอดหนึ่งราย */
export type DeliveryCase = {
  /** เลขที่ผู้ป่วยใน — คีย์ของแถวนี้ */
  an: string
  hn: string
  /** วันที่รับไว้ 'YYYY-MM-DD' */
  admitDate: string | null
  /** วันที่จำหน่าย 'YYYY-MM-DD' — null = ยังไม่จำหน่าย */
  dischargeDate: string | null
  patientName: string
  ageYears: number | null
  /** หอผู้ป่วย */
  ward: string | null
  /** แพทย์ผู้รับไว้ */
  doctor: string | null
  /** รหัสวินิจฉัยในทะเบียนที่บันทึกไว้ในการนอนครั้งนี้ */
  icd10: string[]
  /** ชื่อยาปฏิชีวนะที่ได้รับระหว่างนอนโรงพยาบาล */
  drugs: string[]
}

export type DeliveryReport = {
  cases: DeliveryCase[]
  /** จำนวนรหัสในทะเบียน — 0 แปลว่ายังไม่ได้ตั้งค่า รายงานจะว่างเสมอ */
  diagnosisCodes: number
  /** icode ของยาที่ติดธงปฏิชีวนะ ใช้ไฮไลต์บรรทัดยาตอนเปิดดูรายละเอียด */
  drugIcodes: string[]
  /** ถึงเพดานจำนวนแถวแล้วหรือยัง */
  truncated: boolean
}

/**
 * การคลอดปกติทุกรายในช่วงที่เลือก พร้อมว่าได้รับยาปฏิชีวนะหรือไม่
 *
 * ส่งมาทั้งตัวหาร ไม่ได้ส่งแต่เคสที่ต้องทบทวนแบบข้อ CKD หรือ metformin —
 * ตัวหารทั้งปีมีราวสามร้อยราย ซึ่งเล็กพอที่จะขนมาทั้งชุดให้เบราว์เซอร์กรองเอง
 * และการเห็นทั้งหมดมีประโยชน์จริงเพราะคณะกรรมการทบทวนการคลอดทีละรายอยู่แล้ว
 *
 * ยาดูด้วยคิวรีย่อยที่ผูก an ไม่ใช่ JOIN — ถ้า JOIN opitemrece เข้ามาตรง ๆ
 * จำนวนแถวจะคูณกับจำนวนรายการยาก่อนจะยุบด้วย GROUP BY ซึ่งแพงโดยไม่จำเป็น
 * (การนอนหนึ่งครั้งมีรายการยาหลายสิบแถว)
 */
export async function loadDeliveryReport(input: {
  from: string
  to: string
}): Promise<DeliveryReport> {
  const dxTable = sql.raw(diagnosisTable('nl'))

  const [registry] = await hisDb.execute(sql`SELECT COUNT(*) AS n FROM ${dxTable}`)
  const diagnosisCodes = Number(rows(registry)[0]?.n ?? 0)

  /* ธงปฏิชีวนะติดไว้ 249 รายการ ส่งลงเบราว์เซอร์ทั้งชุดยังเบากว่าการถามกลับ
     ทีละครั้งตอนเปิดดูรายละเอียด (เหตุผลเดียวกับข้อ AD และ APL) */
  const [icodeRows] = await hisDb.execute(sql`
    SELECT icode FROM drugitems WHERE antibiotic = ${ANTIBIOTIC_FLAG_VALUE}`)
  const drugIcodes = rows(icodeRows)
    .map(row => String(row.icode ?? '').trim())
    .filter(Boolean)

  // ทะเบียนว่าง = ไม่มีเกณฑ์ให้นับ ข้ามไปเลยดีกว่ากวนฐานด้วยคิวรีที่รู้คำตอบอยู่แล้ว
  if (diagnosisCodes === 0) {
    return { cases: [], diagnosisCodes, drugIcodes, truncated: false }
  }

  const [result] = await hisDb.execute(sql`
    SELECT a.an, a.hn,
           DATE_FORMAT(a.regdate, '%Y-%m-%d') AS admit_date,
           DATE_FORMAT(a.dchdate, '%Y-%m-%d') AS discharge_date,
           a.age_y,
           CONCAT_WS(' ', p.pname, p.fname, p.lname) AS patient_name,
           w.name AS ward_name,
           doc.name AS doctor_name,
           GROUP_CONCAT(DISTINCT d.icd10 ORDER BY d.icd10 SEPARATOR ',') AS dx,
           (SELECT GROUP_CONCAT(DISTINCT di.name ORDER BY di.name SEPARATOR ' | ')
              FROM opitemrece o
              JOIN drugitems di ON di.icode = o.icode
                 AND di.antibiotic = ${ANTIBIOTIC_FLAG_VALUE}
             WHERE o.an = a.an AND o.qty > ${DISPENSED_QTY}) AS drug_names
    FROM an_stat a
    JOIN iptdiag d ON d.an = a.an
    JOIN ${dxTable} r ON r.icd10 = d.icd10
    LEFT OUTER JOIN patient p ON p.hn = a.hn
    LEFT OUTER JOIN ipt i ON i.an = a.an
    LEFT OUTER JOIN ward w ON w.ward = i.ward
    LEFT OUTER JOIN doctor doc ON doc.code = i.admdoctor
    WHERE a.regdate BETWEEN ${input.from} AND ${input.to}
    GROUP BY a.an, a.hn, a.regdate, a.dchdate, a.age_y, patient_name, ward_name, doctor_name
    ORDER BY a.regdate DESC, a.an DESC
    LIMIT ${MAX_ROWS + 1}`)

  const all = rows(result)

  return {
    cases: all.slice(0, MAX_ROWS).map(row => ({
      an: String(row.an ?? '').trim(),
      hn: String(row.hn ?? '').trim(),
      admitDate: str(row.admit_date),
      dischargeDate: str(row.discharge_date),
      patientName: str(row.patient_name) ?? '—',
      ageYears: row.age_y == null ? null : Number(row.age_y),
      ward: str(row.ward_name),
      doctor: str(row.doctor_name),
      icd10: split(row.dx, ','),
      drugs: split(row.drug_names, '|'),
    })),
    diagnosisCodes,
    drugIcodes,
    truncated: all.length > MAX_ROWS,
  }
}

/**
 * ตัวตั้ง/ตัวหารของช่วงหนึ่ง — สำหรับหน้าสรุปรายปี ไม่ดึงรายชื่อมาด้วย
 *
 * แยกจากฟังก์ชันข้างบนเพราะหน้าสรุปไม่ได้ใช้รายละเอียดเลย และการไม่แตะตาราง
 * patient กับ ward ทำให้เร็วกว่ามากเมื่อช่วงยาวเป็นปี
 */
export async function countDeliveryPair(input: { from: string; to: string }): Promise<{
  numerator: number
  denominator: number
}> {
  const dxTable = sql.raw(diagnosisTable('nl'))

  const [registry] = await hisDb.execute(sql`SELECT COUNT(*) AS n FROM ${dxTable}`)
  if (Number(rows(registry)[0]?.n ?? 0) === 0) return { numerator: 0, denominator: 0 }

  const [result] = await hisDb.execute(sql`
    SELECT COUNT(*) AS denom, SUM(x.got) AS numer FROM (
      SELECT a.an,
             EXISTS (SELECT 1 FROM opitemrece o
                       JOIN drugitems di ON di.icode = o.icode
                          AND di.antibiotic = ${ANTIBIOTIC_FLAG_VALUE}
                      WHERE o.an = a.an AND o.qty > ${DISPENSED_QTY}) AS got
        FROM an_stat a
        JOIN iptdiag d ON d.an = a.an
        JOIN ${dxTable} r ON r.icd10 = d.icd10
       WHERE a.regdate BETWEEN ${input.from} AND ${input.to}
       GROUP BY a.an) x`)

  const row = rows(result)[0] ?? {}
  return { numerator: Number(row.numer ?? 0), denominator: Number(row.denom ?? 0) }
}
