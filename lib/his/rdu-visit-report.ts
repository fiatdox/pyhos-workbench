import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'
import {
  diagnosisTable,
  drugTable,
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
 * แหล่งของ "ยาที่ตัวชี้วัดนับ" นอกเหนือจากทะเบียนที่ตั้งเอง
 *
 * บางข้อไม่ต้องมีทะเบียนของตัวเอง เพราะฐาน HIS มีคำตอบอยู่แล้ว —
 * drugitems.antibiotic เป็นคอลัมน์ที่เภสัชกรติดธงไว้ว่ารายการไหนเป็นยาปฏิชีวนะ
 * (ติดไว้ 249 รายการ เปิดใช้งานอยู่ 89) ใช้ธงนี้แล้วไม่ต้องมาไล่เลือกซ้ำ
 * และไม่ต้องคอยตามให้ทะเบียนตรงกับที่ตั้งไว้ในโปรแกรม HIS
 *
 * ข้อเสียที่ต้องรู้: ธงนี้แคบกว่าการจัดกลุ่มแบบ BNF ที่งาน DUE ใช้ — ยาในบทที่ 5
 * (Infections) ที่เปิดใช้งานมี 236 รายการ ติดธงไว้แค่ 81 รายการ ถ้าวันหนึ่ง
 * คณะกรรมการอยากได้ชุดที่คุมเอง ให้เปลี่ยนมาใช้ทะเบียนแบบข้ออื่นแทน
 */
export const ANTIBIOTIC_FLAG = 'antibiotic-flag'

/** ธงในตาราง drugitems ที่ถือว่า "เป็นยาปฏิชีวนะ" */
export const ANTIBIOTIC_FLAG_VALUE = 'Y'

/**
 * ตัวชี้วัดหนึ่งข้อ = ทะเบียนวินิจฉัยหนึ่งชุด คู่กับแหล่งยาหนึ่งแหล่ง
 *
 * maxAgeYears / minAgeYears มีเฉพาะข้อที่นิยามจำกัดอายุไว้ — ตัวชี้วัดกลุ่มผู้ป่วย
 * พิเศษของ RUA-URI นับเฉพาะผู้ป่วยเด็กอายุ 0–12 ปี ส่วนข้อ glibenclamide นับเฉพาะ
 * ผู้สูงอายุตั้งแต่ 65 ปีขึ้นไป ถ้าไม่กรอง ตัวหารจะรวมคนนอกนิยามเข้ามา
 * แล้วร้อยละที่ได้จะไม่ใช่ตัวเลขของตัวชี้วัดข้อนั้น
 *
 * countContinued เปิดเฉพาะข้อที่เป็นยาใช้ต่อเนื่อง — ดูคำอธิบายที่ CONTINUED_QTY
 */
const REPORTS = {
  /** ผู้ป่วยโรคหืดที่ได้รับยาสูดพ่นคอร์ติโคสเตียรอยด์ */
  asthma: { diagnosis: 'asthma', drug: 'inhaler', countContinued: true },
  /** ผู้ป่วยโรคติดเชื้อทางเดินหายใจส่วนบนที่ได้รับยาปฏิชีวนะ */
  ri: { diagnosis: 'ri', drug: 'ri-antibiotic' },
  /** ผู้ป่วยโรคอุจจาระร่วงเฉียบพลันที่ได้รับยาปฏิชีวนะ — ใช้ธงใน drugitems */
  ad: { diagnosis: 'ad', drug: ANTIBIOTIC_FLAG },
  /** ผู้ป่วยบาดแผลสดจากอุบัติเหตุที่ได้รับยาปฏิชีวนะ — ใช้ธงใน drugitems เช่นเดียวกับ AD */
  apl: { diagnosis: 'apl', drug: ANTIBIOTIC_FLAG },
  /** ผู้ป่วยเด็กโรคติดเชื้อทางเดินหายใจ (RUA-URI) ที่ได้รับยาต้านฮิสตามีน non-sedating */
  'ruauri-child': {
    diagnosis: 'ruauri',
    drug: 'nonsedating-antihist',
    maxAgeYears: 12,
  },
  /** ผู้ป่วยเบาหวานสูงอายุที่ได้รับยา glibenclamide */
  'glibenclamide-elderly': {
    diagnosis: 'dm',
    drug: 'glibenclamide',
    minAgeYears: 65,
  },
} as const satisfies Record<
  string,
  {
    diagnosis: DiagnosisRegistry
    drug: DrugRegistry | typeof ANTIBIOTIC_FLAG
    maxAgeYears?: number
    minAgeYears?: number
    countContinued?: boolean
  }
>

export type VisitReportKind = keyof typeof REPORTS

export const isVisitReportKind = (value: string): value is VisitReportKind =>
  Object.hasOwn(REPORTS, value)

/** รายชื่อตัวชี้วัดที่เปิดใช้งานแล้ว — หน้าวิเคราะห์ใช้ทำรายการให้เลือก */
export const VISIT_REPORT_KINDS = Object.keys(REPORTS) as VisitReportKind[]

/**
 * สเปกของตัวชี้วัดหนึ่งข้อ — เปิดให้โมดูลวิเคราะห์ใช้คิวรีชุดเดียวกัน
 *
 * คืนเป็นรูปแบบเดียวกันทุกข้อ (maxAgeYears เป็น undefined เมื่อไม่จำกัดอายุ)
 * ผู้เรียกจะได้ไม่ต้องรู้ว่าข้อไหนมีฟิลด์นั้นบ้าง
 */
export function reportSpec(kind: VisitReportKind): {
  diagnosis: DiagnosisRegistry
  drug: DrugRegistry | typeof ANTIBIOTIC_FLAG
  maxAgeYears?: number
  minAgeYears?: number
  countContinued?: boolean
} {
  return REPORTS[kind]
}

/**
 * ชิ้นส่วนเงื่อนไขอายุของตัวชี้วัด — ว่างเปล่าเมื่อข้อนั้นไม่จำกัดอายุ
 *
 * แยกออกมาเป็นฟังก์ชันเพราะทั้งโมดูลรายงานและโมดูลวิเคราะห์ต้องใช้เหมือนกันเป๊ะ ๆ
 * ถ้าเขียนแยกกันสองที่แล้ววันหนึ่งมีข้อที่จำกัดทั้งสองด้าน จะพลาดไปแก้ที่เดียว
 * แล้วสองหน้าจะให้ตัวเลขคนละอย่างโดยหาต้นเหตุยาก
 *
 * (vn_stat.age_y เติมครบทุกแถว ตรวจแล้ว 37,709 จาก 37,709 แถวในหนึ่งเดือน
 * จึงไม่ต้องเผื่อค่าว่าง)
 */
export function ageFilterOf(spec: {
  maxAgeYears?: number | null
  minAgeYears?: number | null
}) {
  const parts = []
  if (spec.minAgeYears != null) parts.push(sql`AND v.age_y >= ${spec.minAgeYears}`)
  if (spec.maxAgeYears != null) parts.push(sql`AND v.age_y <= ${spec.maxAgeYears}`)
  return parts.length === 0 ? sql`` : sql.join(parts, sql` `)
}

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
export const DISPENSED_QTY = 0

/**
 * รายการที่สั่งไว้แต่ไม่ได้จ่าย (qty = 0) = ผู้ป่วยใช้ยาเดิมที่มีอยู่ต่อ
 *
 * เภสัชกรชี้ว่าในกลุ่มยาใช้ต่อเนื่อง แถวแบบนี้ไม่ได้แปลว่า "ไม่ได้รับยา" —
 * ผู้ป่วยโรคหืดที่ยังมียาสูดพ่นเหลืออยู่ แพทย์จะลงรายการยาไว้ในใบสั่งเพื่อยืนยัน
 * ว่ายังใช้ยาตัวนั้นอยู่ แต่ห้องยาไม่ได้จ่ายซ้ำ ตัวชี้วัดถามว่าผู้ป่วยได้ใช้ยา
 * คอร์ติโคสเตียรอยด์ชนิดสูดอยู่หรือไม่ คนกลุ่มนี้จึงต้องนับเป็น "ใช้ยาอยู่"
 *
 * เปิดเป็นรายตัวชี้วัด ไม่ได้เปิดทั้งระบบ — เหตุผลเดียวกันใช้กับยาปฏิชีวนะไม่ได้
 * เพราะยาปฏิชีวนะเป็นยาใช้ครั้งคราว ไม่มี "ยาเดิมที่บ้าน" ให้ใช้ต่อ แถว qty = 0
 * ของข้อเหล่านั้นคือสั่งแล้วยกเลิกจริง ๆ ถ้านับเข้าไปตัวชี้วัดจะแย่ลงโดยไม่มีเหตุ
 *
 * ผลต่อตัวเลข (โรคหืด ปีงบ 2568): 3,512 ครั้ง จ่ายยาจริง 1,297 ครั้ง และมีอีก
 * 106 ครั้งที่สั่งไว้แต่ไม่ได้จ่าย — ตัวชี้วัดขยับจาก 36.9% เป็น 39.9%
 */
export const CONTINUED_QTY = 0

/**
 * ตัดครั้งที่รับไว้เป็นผู้ป่วยในออก — ตัวชี้วัดกลุ่มนี้เป็นของผู้ป่วยนอกทั้งหมด
 *
 * ovst มีคอลัมน์ an ที่เติมเลขที่ผู้ป่วยในไว้เมื่อครั้งนั้นถูกรับ admit ต่อ
 * เภสัชกรให้ตัดออก เพราะยาที่ผู้ป่วยในได้รับเป็นการรักษาในหอผู้ป่วยซึ่งมีเกณฑ์
 * และผู้สั่งคนละชุดกับที่ตัวชี้วัดผู้ป่วยนอกถาม
 *
 * ต้องเทียบทั้ง NULL และข้อความว่าง — ในหนึ่งเดือนฝั่งผู้ป่วยนอกเป็น NULL
 * 35,428 แถว แต่มีอีก 12 แถวที่เป็นข้อความว่าง ถ้าเทียบแต่ IS NULL จะตัดแถว
 * เหล่านั้นทิ้งไปทั้งที่เป็นผู้ป่วยนอก (ฝั่ง admit จริงมี 2,269 แถว)
 *
 * ใช้กับคิวรีที่ LEFT JOIN ovst ไว้ในชื่อ ov แล้วเท่านั้น — เป็น LEFT JOIN
 * ได้เพราะแถวที่หา ovst ไม่เจอต้องไม่หายไปเงียบ ๆ (ตรวจแล้วในหนึ่งเดือน
 * vn_stat ทุกแถวมี ovst ครบ แต่เงื่อนไขนี้ไม่ควรไปผูกกับความบังเอิญของข้อมูล)
 *
 * ผลต่อจำนวนครั้ง ปีงบ 2568: โรคหืด 3,512 → 3,380 · ผู้ป่วยเด็ก RUA-URI 1,885 → 1,807
 */
export const OPD_ONLY = sql`(ov.an IS NULL OR ov.an = '')`

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
  /** ชื่อยาในทะเบียนที่จ่ายจริงในครั้งนี้ */
  drugs: string[]
  /**
   * ชื่อยาในทะเบียนที่สั่งไว้แต่ไม่ได้จ่าย = ใช้ยาเดิมต่อ (ดู CONTINUED_QTY)
   * ว่างเสมอสำหรับตัวชี้วัดที่ไม่ได้เปิด countContinued
   */
  continuedDrugs: string[]
}

export type VisitReport = {
  visits: ReportVisit[]
  /** จำนวนรหัสในทะเบียนวินิจฉัย — 0 แปลว่ายังไม่ได้ตั้งค่า รายงานจะว่างเสมอ */
  diagnosisCodes: number
  /** จำนวนรายการยาในทะเบียน — 0 แปลว่าทุกแถวจะขึ้นว่าไม่ได้รับยา */
  drugItems: number
  /** icode ของยาในทะเบียน ใช้ไฮไลต์บรรทัดยาตอนเปิดดูรายละเอียดครั้งนั้น */
  drugIcodes: string[]
  /** อายุสูงสุดที่นับ (ปี) — null = ไม่จำกัด หน้าจอใช้บอกว่าตัวเลขนี้ของใคร */
  maxAgeYears: number | null
  /** อายุต่ำสุดที่นับ (ปี) — null = ไม่จำกัด */
  minAgeYears: number | null
  /** นับแถวที่สั่งแต่ไม่ได้จ่ายเป็นการใช้ยาต่อเนื่องด้วยหรือไม่ (ดู CONTINUED_QTY) */
  countsContinued: boolean
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

  /* ยาที่นับมาได้สองทาง — จากทะเบียนที่ตั้งเอง หรือจากธงใน drugitems
     เขียนเป็นชิ้นส่วนคิวรีแยก ทั้งสองทางจะได้ใช้คิวรีหลักชุดเดียวกัน */
  const byFlag = report.drug === ANTIBIOTIC_FLAG
  const rxTable = byFlag ? null : sql.raw(drugTable(report.drug))

  /** ชื่อยาในทะเบียนของครั้งนั้น เลือกได้ว่าเอาแถวที่จ่ายจริงหรือแถวที่สั่งแต่ไม่จ่าย */
  const drugNamesWhere = (qtyFilter: ReturnType<typeof sql>) =>
    byFlag
      ? sql`
        SELECT GROUP_CONCAT(DISTINCT di.name ORDER BY di.name SEPARATOR ' | ')
          FROM opitemrece o
          JOIN drugitems di ON di.icode = o.icode
             AND di.antibiotic = ${ANTIBIOTIC_FLAG_VALUE}
         WHERE o.vn = v.vn AND ${qtyFilter}`
      : sql`
        SELECT GROUP_CONCAT(DISTINCT di.name ORDER BY di.name SEPARATOR ' | ')
          FROM opitemrece o
          JOIN ${rxTable} r ON r.icode = o.icode
          LEFT OUTER JOIN drugitems di ON di.icode = o.icode
         WHERE o.vn = v.vn AND ${qtyFilter}`

  const drugNames = drugNamesWhere(sql`o.qty > ${DISPENSED_QTY}`)

  /* ข้อที่ไม่ได้เปิด countContinued ส่ง NULL เข้ามาแทนคิวรีย่อย — จะได้ไม่ต้อง
     เขียนคิวรีหลักสองแบบ และไม่ต้องจ่ายค่าคิวรีย่อยที่รู้อยู่แล้วว่าไม่ได้ใช้ */
  const countsContinued = 'countContinued' in report && report.countContinued === true
  const continuedNames = countsContinued
      ? drugNamesWhere(sql`o.qty <= ${CONTINUED_QTY}`)
      : sql`SELECT NULL`
  // ข้อที่ไม่จำกัดอายุต่อชิ้นส่วนว่างเข้าไป จะได้ใช้คิวรีหลักชุดเดียวกันทั้งหมด
  const maxAgeYears = 'maxAgeYears' in report ? report.maxAgeYears : null
  const minAgeYears = 'minAgeYears' in report ? report.minAgeYears : null
  const ageFilter = ageFilterOf({ maxAgeYears, minAgeYears })

  const drugSource = byFlag
    ? sql`SELECT icode FROM drugitems WHERE antibiotic = ${ANTIBIOTIC_FLAG_VALUE}`
    : sql`SELECT icode FROM ${rxTable}`

  const [registry] = await hisDb.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM ${dxTable}) AS dx_count,
      (SELECT COUNT(*) FROM (${drugSource}) src) AS drug_count`)

  const counts = rows(registry)[0] ?? {}
  const diagnosisCodes = Number(counts.dx_count ?? 0)
  const drugItems = Number(counts.drug_count ?? 0)

  // icode ของยาที่นับ — หน้าจอใช้ไฮไลต์บรรทัดยาตอนเปิดดูรายละเอียดครั้งนั้น
  // ฝั่งธงมี 249 รหัส ส่งลงเบราว์เซอร์ทั้งชุดยังเบากว่าการถามกลับทีละครั้ง
  const [icodeRows] = await hisDb.execute(drugSource)
  const drugIcodes = rows(icodeRows)
    .map(row => String(row.icode ?? '').trim())
    .filter(Boolean)

  // ทะเบียนวินิจฉัยว่าง = ไม่มีเกณฑ์ให้นับ คิวรีหลักจะได้ศูนย์แถวอยู่แล้ว
  // ข้ามไปเลยดีกว่าไปกวนฐานด้วยคิวรีที่รู้คำตอบล่วงหน้า
  if (diagnosisCodes === 0) {
    return {
      visits: [],
      diagnosisCodes,
      drugItems,
      drugIcodes,
      maxAgeYears,
      minAgeYears,
      countsContinued,
      truncated: false,
    }
  }

  const [result] = await hisDb.execute(sql`
    SELECT v.vn, v.hn,
           DATE_FORMAT(v.vstdate, '%Y-%m-%d') AS vstdate,
           v.age_y, v.sex,
           CONCAT_WS(' ', p.pname, p.fname, p.lname) AS patient_name,
           dep.department AS dep_name, doc.name AS doctor_name,
           GROUP_CONCAT(DISTINCT d.icd10 ORDER BY d.icd10 SEPARATOR ',') AS dx,
           (${drugNames}) AS drug_names,
           (${continuedNames}) AS continued_names
    FROM vn_stat v
    JOIN ovstdiag d ON d.vn = v.vn
    JOIN ${dxTable} a ON a.icd10 = d.icd10
    LEFT OUTER JOIN patient p ON p.hn = v.hn
    LEFT OUTER JOIN ovst ov ON ov.vn = v.vn
    LEFT OUTER JOIN kskdepartment dep ON dep.depcode = ov.main_dep
    LEFT OUTER JOIN doctor doc ON doc.code = ov.doctor
    WHERE v.vstdate BETWEEN ${input.from} AND ${input.to} ${ageFilter}
      AND ${OPD_ONLY}
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
      continuedDrugs: split(row.continued_names, '|'),
    })),
    diagnosisCodes,
    drugItems,
    drugIcodes,
    maxAgeYears,
    minAgeYears,
    countsContinued,
    truncated: all.length > MAX_ROWS,
  }
}
