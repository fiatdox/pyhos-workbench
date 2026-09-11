import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'
import {
  diagnosisTable,
  drugTable,
  listRegisteredDrugs,
  type DiagnosisRegistry,
  type DrugRegistry,
} from '@/lib/his/rdu-registry'

/**
 * รายงานผู้ป่วยนอกตามตัวชี้วัด RDU — วินิจฉัยด้วยรหัสในทะเบียน แล้วได้รับยา
 * ในทะเบียนหรือไม่
 *
 * ตัวชี้วัดหลายข้อถามคำถามรูปเดียวกัน ต่างกันแค่ว่านับจากทะเบียนคู่ไหนและ
 * "ได้รับยา" เป็นเรื่องดีหรือไม่ดี — โรคหืดยิ่งได้รับยา ICS ยิ่งดี ส่วนโรคติดเชื้อ
 * ทางเดินหายใจส่วนบนยิ่งได้รับยาปฏิชีวนะยิ่งต้องทบทวน ทิศทางนั้นเป็นเรื่องของ
 * หน้าจอที่เอาไปแสดง คิวรีจึงเหมือนกันทุกข้อ
 *
 * เป็นรายการทำงาน ไม่ใช่แค่ตัวเลขสรุป — เภสัชกรต้องเปิดดูรายครั้งได้ว่าเคสนั้น
 * เป็นเพราะอะไร ตัวเลขอย่างเดียวตามไปแก้อะไรไม่ได้
 *
 * ไม่ดึงเลขบัตรประชาชน เบอร์โทร และที่อยู่ของผู้ป่วยมาด้วย ทั้งที่อยู่ในตาราง
 * patient และ vn_stat — งานนี้ใช้แค่ชื่อกับ HN ในการตามเคส ข้อมูลระบุตัวตน
 * ที่เหลือไม่ควรหลุดออกไปถึงเบราว์เซอร์
 */

/**
 * ตัวชี้วัดหนึ่งข้อ = ทะเบียนวินิจฉัยหนึ่งชุด คู่กับทะเบียนยาหนึ่งชุด
 *
 * maxAgeYears มีเฉพาะข้อที่นิยามจำกัดอายุไว้ — ตัวชี้วัดกลุ่มผู้ป่วยพิเศษของ
 * RUA-URI นับเฉพาะผู้ป่วยเด็กอายุ 0–12 ปี ถ้าไม่กรอง ตัวหารจะรวมผู้ใหญ่เข้ามา
 * แล้วร้อยละที่ได้จะไม่ใช่ตัวเลขของตัวชี้วัดข้อนั้น
 */
const REPORTS = {
  /** ผู้ป่วยโรคหืดที่ได้รับยาสูดพ่นคอร์ติโคสเตียรอยด์ */
  asthma: { diagnosis: 'asthma', drug: 'inhaler' },
  /** ผู้ป่วยโรคติดเชื้อทางเดินหายใจส่วนบนที่ได้รับยาปฏิชีวนะ */
  ri: { diagnosis: 'ri', drug: 'ri-antibiotic' },
  /** ผู้ป่วยเด็กโรคติดเชื้อทางเดินหายใจ (RUA-URI) ที่ได้รับยาต้านฮิสตามีน non-sedating */
  'ruauri-child': {
    diagnosis: 'ruauri',
    drug: 'nonsedating-antihist',
    maxAgeYears: 12,
  },
} as const satisfies Record<
  string,
  { diagnosis: DiagnosisRegistry; drug: DrugRegistry; maxAgeYears?: number }
>

export type VisitReportKind = keyof typeof REPORTS

export const isVisitReportKind = (value: string): value is VisitReportKind =>
  Object.hasOwn(REPORTS, value)

/** ช่วงวันที่ยาวสุดที่ยอมให้ค้นครั้งเดียว — ยาวกว่านี้ให้แบ่งเป็นหลายรอบ */
export const MAX_RANGE_DAYS = 366

/** จำนวนแถวสูงสุดต่อการค้นหนึ่งครั้ง */
const MAX_ROWS = 2000

/**
 * นับเฉพาะรายการที่จ่ายจริง (qty > 0)
 *
 * opitemrece เก็บแถวที่สั่งแล้วไม่ได้จ่ายไว้ด้วยโดยตั้ง qty เป็น 0 — ในรอบ 30 วัน
 * มี 22,215 จาก 475,685 แถว (4.7%) ถ้าไม่กรองออก ตัวชี้วัดจะนับคนที่หมอสั่งยาไว้
 * แต่ไม่ได้รับยาจริงว่า "ได้รับยาแล้ว"
 */
const DISPENSED_QTY = 0

const rows = (result: unknown) => result as unknown as Record<string, unknown>[]

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v).trim() || null)

/** ผู้ป่วยนอกหนึ่งครั้งที่มารับบริการ */
export type ReportVisit = {
  /** เลขที่การมารับบริการ — คีย์ของแถวนี้ ใช้เปิดดูรายละเอียดต่อ */
  vn: string
  hn: string
  /** 'YYYY-MM-DD' */
  date: string | null
  patientName: string
  ageYears: number | null
  /** '1' = ชาย, '2' = หญิง ตามรหัสของ HIS */
  sex: string | null
  /** ห้องตรวจหลักของครั้งนั้น (ovst.main_dep → kskdepartment.department) */
  department: string | null
  /** แพทย์ผู้ตรวจ (ovst.doctor → doctor.name) */
  doctor: string | null
  /** รหัสวินิจฉัยในทะเบียนที่บันทึกไว้ในครั้งนี้ — หนึ่งครั้งมีได้หลายรหัส */
  icd10: string[]
  /** ชื่อยาในทะเบียนที่ได้รับในครั้งนี้ — ว่าง = ไม่ได้รับ */
  drugs: string[]
}

export type VisitReport = {
  visits: ReportVisit[]
  /** จำนวนรหัสในทะเบียนวินิจฉัย — 0 แปลว่ายังไม่ได้ตั้งค่า รายงานจะว่างเสมอ */
  diagnosisCodes: number
  /** จำนวนรายการยาในทะเบียน — 0 แปลว่าทุกแถวจะขึ้นว่าไม่ได้รับยา */
  drugItems: number
  /** icode ของยาในทะเบียน ใช้ไฮไลต์บรรทัดยาตอนเปิดดูรายละเอียดครั้งนั้น */
  drugIcodes: string[]
  /** อายุสูงสุดที่นับ (ปี) — null = ไม่จำกัดอายุ หน้าจอใช้บอกว่าตัวเลขนี้ของใคร */
  maxAgeYears: number | null
  /** ถึงเพดานจำนวนแถวแล้วหรือยัง — ถ้าถึง แปลว่ารายการถูกตัด ต้องบอกผู้ใช้ */
  truncated: boolean
}

/** แยกค่าที่ GROUP_CONCAT ต่อกันมาเป็นรายการ */
const split = (value: unknown, separator: string): string[] => {
  const text = str(value)
  return text == null
    ? []
    : text
        .split(separator)
        .map(item => item.trim())
        .filter(Boolean)
}

/**
 * ผู้ป่วยนอกที่วินิจฉัยด้วยรหัสในทะเบียน ในช่วงวันที่ที่เลือก
 *
 * ovstdiag มีได้หลายแถวต่อหนึ่ง vn (โรคหลัก โรคร่วม ฯลฯ) และหนึ่งครั้งอาจบันทึก
 * รหัสในทะเบียนไว้มากกว่าหนึ่งรหัส จึงต้อง GROUP BY vn ไม่งั้นแถวเดียวจะซ้ำหลายรอบ
 * แล้วตัวหารของตัวชี้วัดจะเกินจริง
 *
 * ยาดูด้วยคิวรีย่อยที่ผูก vn ไม่ใช่ JOIN — ถ้า JOIN opitemrece เข้ามาตรง ๆ
 * จำนวนแถวจะคูณกับจำนวนรายการยาก่อนจะยุบด้วย GROUP BY ซึ่งแพงโดยไม่จำเป็น
 *
 * ห้องตรวจกับแพทย์ผู้ตรวจอยู่ใน ovst ไม่ใช่ vn_stat จึง join เพิ่มอีกชั้น —
 * ovst มีแถวเดียวต่อหนึ่ง vn (ตรวจแล้ว 37,709 แถว = 37,709 vn ในหนึ่งเดือน)
 * การ join จึงไม่ทำให้จำนวนแถวบานปลาย
 *
 * patient / ovst / kskdepartment / doctor ใช้ LEFT JOIN ไม่ใช่ INNER — visit ที่หา
 * แฟ้มผู้ป่วยหรือห้องตรวจไม่เจอต้องยังขึ้นในรายงาน ไม่ใช่หายไปเงียบ ๆ จนตัวเลข
 * ไม่ตรงกับที่นับจาก ovstdiag (รอบทดสอบหนึ่งเดือนมีห้องตรวจว่าง 1 จาก 264 แถว)
 */
export async function listReportVisits(input: {
  kind: VisitReportKind
  from: string
  to: string
}): Promise<VisitReport> {
  const report = REPORTS[input.kind]
  const dxTable = sql.raw(diagnosisTable(report.diagnosis))
  const rxTable = sql.raw(drugTable(report.drug))
  // ข้อที่ไม่จำกัดอายุต่อชิ้นส่วนว่างเข้าไป จะได้ใช้คิวรีหลักชุดเดียวกันทั้งหมด
  // ไม่ต้องเขียนซ้ำสองแบบ (vn_stat.age_y เติมครบทุกแถว ตรวจแล้ว 37,709 จาก
  // 37,709 แถวในหนึ่งเดือน จึงไม่ต้องเผื่อค่าว่าง)
  const maxAgeYears = 'maxAgeYears' in report ? report.maxAgeYears : null
  const ageFilter = maxAgeYears == null ? sql`` : sql`AND v.age_y <= ${maxAgeYears}`

  const [registry] = await hisDb.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM ${dxTable}) AS dx_count,
      (SELECT COUNT(*) FROM ${rxTable}) AS drug_count`)

  const counts = rows(registry)[0] ?? {}
  const diagnosisCodes = Number(counts.dx_count ?? 0)
  const drugItems = Number(counts.drug_count ?? 0)
  const drugIcodes = await listRegisteredDrugs(report.drug)

  // ทะเบียนวินิจฉัยว่าง = ไม่มีเกณฑ์ให้นับ คิวรีหลักจะได้ศูนย์แถวอยู่แล้ว
  // ข้ามไปเลยดีกว่าไปกวนฐานด้วยคิวรีที่รู้คำตอบล่วงหน้า
  if (diagnosisCodes === 0) {
    return { visits: [], diagnosisCodes, drugItems, drugIcodes, maxAgeYears, truncated: false }
  }

  const [result] = await hisDb.execute(sql`
    SELECT v.vn, v.hn,
           DATE_FORMAT(v.vstdate, '%Y-%m-%d') AS vstdate,
           v.age_y, v.sex,
           CONCAT_WS(' ', p.pname, p.fname, p.lname) AS patient_name,
           dep.department AS dep_name, doc.name AS doctor_name,
           GROUP_CONCAT(DISTINCT d.icd10 ORDER BY d.icd10 SEPARATOR ',') AS dx,
           (SELECT GROUP_CONCAT(DISTINCT di.name ORDER BY di.name SEPARATOR ' | ')
              FROM opitemrece o
              JOIN ${rxTable} r ON r.icode = o.icode
              LEFT OUTER JOIN drugitems di ON di.icode = o.icode
             WHERE o.vn = v.vn AND o.qty > ${DISPENSED_QTY}) AS drug_names
    FROM vn_stat v
    JOIN ovstdiag d ON d.vn = v.vn
    JOIN ${dxTable} a ON a.icd10 = d.icd10
    LEFT OUTER JOIN patient p ON p.hn = v.hn
    LEFT OUTER JOIN ovst ov ON ov.vn = v.vn
    LEFT OUTER JOIN kskdepartment dep ON dep.depcode = ov.main_dep
    LEFT OUTER JOIN doctor doc ON doc.code = ov.doctor
    WHERE v.vstdate BETWEEN ${input.from} AND ${input.to} ${ageFilter}
    GROUP BY v.vn, v.hn, v.vstdate, v.age_y, v.sex, patient_name, dep_name, doctor_name
    ORDER BY v.vstdate DESC, v.vn DESC
    LIMIT ${MAX_ROWS + 1}`)

  const all = rows(result)

  return {
    visits: all.slice(0, MAX_ROWS).map(row => ({
      vn: String(row.vn ?? '').trim(),
      hn: String(row.hn ?? '').trim(),
      date: str(row.vstdate),
      patientName: str(row.patient_name) ?? '—',
      ageYears: row.age_y == null ? null : Number(row.age_y),
      sex: str(row.sex),
      department: str(row.dep_name),
      doctor: str(row.doctor_name),
      icd10: split(row.dx, ','),
      drugs: split(row.drug_names, '|'),
    })),
    diagnosisCodes,
    drugItems,
    drugIcodes,
    maxAgeYears,
    truncated: all.length > MAX_ROWS,
  }
}
