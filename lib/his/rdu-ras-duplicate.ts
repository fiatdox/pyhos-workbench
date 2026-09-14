import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'
import { drugTable } from '@/lib/his/rdu-registry'
import { DISPENSED_QTY, OPD_ONLY } from '@/lib/his/rdu-visit-report'

/**
 * ตัวชี้วัดการได้รับยากลุ่ม RAS blockade ซ้ำซ้อน
 *
 * ยาที่ยับยั้งระบบ renin-angiotensin มากกว่าหนึ่งชนิดพร้อมกันไม่ได้เพิ่มผลการรักษา
 * แต่เพิ่มความเสี่ยงโพแทสเซียมสูง ความดันตก และไตวายเฉียบพลัน เกณฑ์ของตัวชี้วัด
 * ข้อนี้จึงเป็นศูนย์ ไม่ใช่ตัวเลขที่ยอมรับได้ระดับหนึ่งเหมือนข้ออื่น
 *
 * ทำไมไม่ใช้โครงเดียวกับตัวชี้วัดข้ออื่นใน rdu-visit-report.ts:
 * ข้ออื่นถามว่า "ได้รับยาในทะเบียนหรือไม่" ซึ่งเป็นคำถามแบบมี/ไม่มี แต่ข้อนี้ถามว่า
 * "ได้รับยาที่ออกฤทธิ์ซ้ำทางกันกี่ชนิด" ซึ่งต้องนับ ไม่ใช่แค่ตรวจว่ามี และตัวหาร
 * ก็ไม่ได้มาจากรหัสวินิจฉัย แต่มาจากตัวยาเอง (ผู้ป่วยที่ได้รับยากลุ่มนี้อยู่)
 *
 * ทำไมนับด้วยชื่อสามัญ ไม่ได้นับด้วยรหัสยา:
 * ในบัญชียามี Enalapril-5 กับ Enalapril-20 เป็นคนละรหัส ผู้ป่วยที่ได้ทั้งสองรายการ
 * คือการปรับขนาดยาตัวเดียวกัน ไม่ใช่การใช้ยาซ้ำซ้อน ถ้านับด้วยรหัสจะฟ้องผิดทันที
 * (เกิดจริง 2 ครั้งในปีงบ 2568) — drugitems.generic_name เติมไว้ครบทั้ง 1,093
 * รายการที่เปิดใช้งาน และจัดให้ทั้งสองรหัสเป็น 'ENALAPRIL' เหมือนกัน จึงใช้ได้
 *
 * การนับด้วยชื่อสามัญยังจับกรณีซ้ำซ้อนภายในกลุ่มเดียวกันได้ด้วย (เช่น Losartan
 * คู่กับ Telmisartan ซึ่งเป็น ARB ทั้งคู่) ซึ่งการเทียบแค่ว่า "มาจากคนละทะเบียน"
 * จะมองไม่เห็น
 */

/** ช่วงวันที่ยาวสุดต่อการค้นหนึ่งครั้ง — เท่ากับตัวชี้วัดข้ออื่น */
export const RAS_MAX_RANGE_DAYS = 366

/** จำนวนเคสสูงสุดต่อการค้นหนึ่งครั้ง — เกณฑ์คือศูนย์ ปกติจึงไม่ควรใกล้เพดานนี้เลย */
const MAX_CASE_ROWS = 2000

/**
 * จำนวนชื่อสามัญที่ถือว่าซ้ำซ้อน — ตั้งแต่สองชนิดขึ้นไปในครั้งเดียวกัน
 *
 * เขียนเป็นค่าคงที่แทนเลข 1 ลอย ๆ ในคิวรี เพราะเป็นนิยามของตัวชี้วัด ไม่ใช่
 * รายละเอียดของการเขียนคิวรี
 */
const DUPLICATE_FROM = 2

const rows = (result: unknown) => result as unknown as Record<string, unknown>[]

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v).trim() || null)

/** หนึ่งครั้งที่ได้รับยากลุ่ม RAS ซ้ำซ้อน */
export type RasDuplicateCase = {
  vn: string
  hn: string
  /** 'YYYY-MM-DD' */
  date: string | null
  patientName: string
  ageYears: number | null
  /** '1' = ชาย, '2' = หญิง ตามรหัสของ HIS */
  sex: string | null
  department: string | null
  doctor: string | null
  /** ชื่อสามัญของยาที่ได้รับ — ความยาวของรายการนี้คือจำนวนชนิดที่ซ้ำกัน */
  generics: string[]
  /** ชื่อรายการยาตามบัญชีของโรงพยาบาล */
  drugs: string[]
}

export type RasDuplicateReport = {
  cases: RasDuplicateCase[]
  /** ครั้งที่ได้รับยากลุ่ม RAS อย่างน้อยหนึ่งชนิด — ตัวหาร */
  denominatorVisits: number
  /** จำนวนผู้ป่วย (HN) ในตัวหาร */
  denominatorPatients: number
  /** จำนวนผู้ป่วย (HN) ที่ได้รับซ้ำซ้อนอย่างน้อยหนึ่งครั้ง */
  casePatients: number
  /** จำนวนรายการยาในทะเบียน ACEI — 0 แปลว่ายังไม่ได้ตั้งค่า */
  aceiItems: number
  /** จำนวนรายการยาในทะเบียน ARB */
  arbItems: number
  /** icode ของยาทั้งสองทะเบียน ใช้ไฮไลต์บรรทัดยาตอนเปิดดูรายละเอียด */
  drugIcodes: string[]
  /** ถึงเพดานจำนวนเคสแล้วหรือยัง */
  truncated: boolean
}

/**
 * ครั้งที่ผู้ป่วยนอกได้รับยากลุ่ม RAS ซ้ำซ้อน ในช่วงวันที่ที่เลือก
 *
 * ไล่จาก opitemrece เข้ามาเหมือนรายงาน NSAIDs+CKD ไม่ได้ไล่จาก vn_stat ออกไป —
 * ยากลุ่มนี้ถูกจ่ายราว 26,000 ครั้งต่อปี ซึ่งน้อยกว่าจำนวนครั้งที่มารับบริการทั้งหมด
 * หลายเท่า การเริ่มจากฝั่งที่แคบกว่าทำให้ทั้งปีใช้เวลาราวสองวินาที
 *
 * ตัวหารกับตัวตั้งมาจากคิวรีเดียวกัน ต่างกันแค่เงื่อนไข HAVING — ทั้งสองอย่าง
 * ต้องจัดกลุ่มตาม vn เหมือนกันอยู่แล้ว แยกคิวรีก็ได้แต่จะทำงานซ้ำสองรอบเปล่า ๆ
 */
export async function loadRasDuplicateReport(input: {
  from: string
  to: string
}): Promise<RasDuplicateReport> {
  const aceiTable = sql.raw(drugTable('ras-acei'))
  const arbTable = sql.raw(drugTable('ras-arb'))

  /* รหัสยาที่นับ = ทั้งสองทะเบียนรวมกัน ใช้ UNION ไม่ใช่ UNION ALL เผื่อกรณีที่
     คณะกรรมการเผลอใส่รหัสเดียวกันไว้ทั้งสองฝั่ง (ยาผสมอย่าง ENTRESTO ตีความได้
     ทั้งสองทาง) — ถ้านับซ้ำ ตัวหารจะไม่เปลี่ยนแต่จะดูสับสนตอนไล่ตรวจ */
  const rasCodes = sql`
    SELECT icode FROM ${aceiTable}
    UNION
    SELECT icode FROM ${arbTable}`

  const [registry] = await hisDb.execute(sql`
    SELECT (SELECT COUNT(*) FROM ${aceiTable}) AS acei_count,
           (SELECT COUNT(*) FROM ${arbTable}) AS arb_count`)

  const counts = rows(registry)[0] ?? {}
  const aceiItems = Number(counts.acei_count ?? 0)
  const arbItems = Number(counts.arb_count ?? 0)

  const [icodeRows] = await hisDb.execute(rasCodes)
  const drugIcodes = rows(icodeRows)
    .map(row => String(row.icode ?? '').trim())
    .filter(Boolean)

  /**
   * รายการรหัสยาที่นับ ส่งเป็นค่าคงที่เข้าไปในคิวรี ไม่ได้ฝัง rasCodes ไว้ใน IN
   *
   * ต่างกันสองอย่างชัดเจนในเชิงเวลา: เขียนเป็น IN (SELECT ... UNION SELECT ...)
   * ฐานไม่ใช้ดัชนี opitemrece.icode แล้วกวาดทั้งตาราง 30 ล้านแถว ทั้งปีใช้เวลา
   * 104 วินาที ส่วนการดึงรหัสมาก่อนแล้วส่งเป็นรายการค่า (มีแค่ 8 รหัส) ใช้เวลา
   * 1.8 วินาที ได้ผลลัพธ์เท่ากันทุกตัว
   *
   * ปลอดภัยเพราะค่ามาจากตารางทะเบียนของเราเอง และส่งเป็นพารามิเตอร์ ไม่ใช่ต่อสตริง
   */
  const codeListOf = (icodes: string[]) =>
    sql.join(
      icodes.map(icode => sql`${icode}`),
      sql`, `,
    )

  // ทะเบียนว่างทั้งคู่ = ไม่มีเกณฑ์ให้นับ ข้ามไปเลยดีกว่าไปกวนฐานด้วยคิวรีที่รู้คำตอบ
  // (ต้องกันไว้ก่อนสร้างรายการรหัสด้วย เพราะ IN () ที่ว่างเปล่าเป็นคิวรีที่ผิดไวยากรณ์)
  if (drugIcodes.length === 0) {
    return {
      cases: [],
      denominatorVisits: 0,
      denominatorPatients: 0,
      casePatients: 0,
      aceiItems,
      arbItems,
      drugIcodes,
      truncated: false,
    }
  }

  const codeList = codeListOf(drugIcodes)

  /* หนึ่งแถวต่อหนึ่งครั้งที่ได้รับยากลุ่มนี้ พร้อมจำนวนชื่อสามัญที่ต่างกัน
     ใช้เป็นฐานของทั้งตัวหารและตัวตั้ง */
  const rasVisits = sql`
    SELECT v.vn, v.hn,
           COUNT(DISTINCT di.generic_name) AS generics
      FROM opitemrece o
      JOIN drugitems di ON di.icode = o.icode
      JOIN vn_stat v ON v.vn = o.vn
      LEFT OUTER JOIN ovst ov ON ov.vn = v.vn
     WHERE o.icode IN (${codeList})
       AND o.qty > ${DISPENSED_QTY}
       AND o.vstdate BETWEEN ${input.from} AND ${input.to}
       AND ${OPD_ONLY}
     GROUP BY v.vn, v.hn`

  const [denominator] = await hisDb.execute(sql`
    SELECT COUNT(*) AS visits, COUNT(DISTINCT x.hn) AS patients,
           COUNT(DISTINCT CASE WHEN x.generics >= ${DUPLICATE_FROM} THEN x.hn END) AS case_patients
    FROM (${rasVisits}) x`)

  const denomRow = rows(denominator)[0] ?? {}

  const [result] = await hisDb.execute(sql`
    SELECT v.vn, v.hn,
           DATE_FORMAT(v.vstdate, '%Y-%m-%d') AS vstdate,
           v.age_y, v.sex,
           CONCAT_WS(' ', p.pname, p.fname, p.lname) AS patient_name,
           dep.department AS dep_name, doc.name AS doctor_name,
           GROUP_CONCAT(DISTINCT di.generic_name ORDER BY di.generic_name SEPARATOR ' | ')
             AS generics,
           GROUP_CONCAT(DISTINCT di.name ORDER BY di.name SEPARATOR ' | ') AS drug_names
    FROM opitemrece o
    JOIN drugitems di ON di.icode = o.icode
    JOIN vn_stat v ON v.vn = o.vn
    LEFT OUTER JOIN ovst ov ON ov.vn = v.vn
    LEFT OUTER JOIN patient p ON p.hn = v.hn
    LEFT OUTER JOIN kskdepartment dep ON dep.depcode = ov.main_dep
    LEFT OUTER JOIN doctor doc ON doc.code = ov.doctor
    WHERE o.icode IN (${codeList})
      AND o.qty > ${DISPENSED_QTY}
      AND o.vstdate BETWEEN ${input.from} AND ${input.to}
      AND ${OPD_ONLY}
    GROUP BY v.vn, v.hn, v.vstdate, v.age_y, v.sex, patient_name, dep_name, doctor_name
    HAVING COUNT(DISTINCT di.generic_name) >= ${DUPLICATE_FROM}
    ORDER BY v.vstdate DESC, v.vn DESC
    LIMIT ${MAX_CASE_ROWS + 1}`)

  const all = rows(result)

  const split = (value: unknown): string[] => {
    const text = str(value)
    return text == null
      ? []
      : text
          .split('|')
          .map(item => item.trim())
          .filter(Boolean)
  }

  return {
    cases: all.slice(0, MAX_CASE_ROWS).map(row => ({
      vn: String(row.vn ?? '').trim(),
      hn: String(row.hn ?? '').trim(),
      date: str(row.vstdate),
      patientName: str(row.patient_name) ?? '—',
      ageYears: row.age_y == null ? null : Number(row.age_y),
      sex: str(row.sex),
      department: str(row.dep_name),
      doctor: str(row.doctor_name),
      generics: split(row.generics),
      drugs: split(row.drug_names),
    })),
    denominatorVisits: Number(denomRow.visits ?? 0),
    denominatorPatients: Number(denomRow.patients ?? 0),
    casePatients: Number(denomRow.case_patients ?? 0),
    aceiItems,
    arbItems,
    drugIcodes,
    truncated: all.length > MAX_CASE_ROWS,
  }
}
