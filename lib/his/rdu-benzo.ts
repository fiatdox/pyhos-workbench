import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'
import { drugTable } from '@/lib/his/rdu-registry'
import { loadAgeSettings } from '@/lib/his/rdu-settings'
import { DISPENSED_QTY, OPD_ONLY } from '@/lib/his/rdu-visit-report'

/**
 * ตัวชี้วัดการใช้ยากลุ่ม long-acting benzodiazepine ในผู้ป่วยนอกสูงอายุ
 *
 * ยากลุ่มนี้ตกค้างในร่างกายผู้สูงอายุนานกว่าคนหนุ่มสาวมาก เพราะไขมันในร่างกาย
 * มากขึ้นและตับกำจัดยาช้าลง ผลคือง่วงค้างถึงวันรุ่งขึ้น สับสน และล้ม ซึ่งใน
 * ผู้สูงอายุจบที่กระดูกสะโพกหักได้ — ยิ่งใช้น้อยยิ่งดี เกณฑ์คือไม่เกิน 5%
 *
 * ข้อนี้รูปทรงไม่เหมือนข้อไหนในระบบ: **ไม่มีทะเบียนรหัสวินิจฉัย** เพราะตัวหาร
 * คือผู้ป่วยนอกสูงอายุทุกคน ไม่เกี่ยงว่ามาด้วยโรคอะไร คำถามเป็นเรื่องของวัย
 * กับตัวยา ไม่ใช่เรื่องของโรค เป็นข้อเดียวที่ไม่ต้องตกลงรหัส ICD-10 กันก่อน
 *
 * ทะเบียนยาต้องตั้งเอง แยกจากชื่อสามัญไม่ได้ — การจะรู้ว่า clonazepam ออกฤทธิ์ยาว
 * ส่วน lorazepam ออกฤทธิ์สั้น ต้องรู้ค่าครึ่งชีวิตของยา ซึ่งไม่มีคอลัมน์ไหนใน
 * ฐาน HIS บอกไว้ (ต่างจากข้อ metformin ที่ชื่อสามัญบอกได้ในตัว)
 *
 * นับเป็น "คน" เป็นตัวเลขหลักตามนิยาม แต่ส่งจำนวนครั้งมาด้วย — สองวิธีนับให้
 * ตัวเลขต่างกันเกินสองเท่า (ปีงบ 2568: 4.47% ของคน เทียบกับ 1.89% ของครั้ง)
 * เพราะผู้สูงอายุมาโรงพยาบาลเฉลี่ยปีละเกือบหกครั้งแต่ไม่ได้รับยานอนหลับทุกครั้ง
 * ถ้าแสดงแค่ตัวเดียวแล้วมีคนไปเปิดอีกวิธีเจอ จะกลายเป็นข้อสงสัยว่าเลขไหนจริง
 */

/** เกณฑ์เป้าหมายของตัวชี้วัด (ร้อยละ) — ยิ่งต่ำยิ่งดี */
export const BENZO_TARGET = 5

/** ช่วงวันที่ยาวสุดต่อการค้นหนึ่งครั้ง — เท่ากับตัวชี้วัดข้ออื่น */
export const BENZO_MAX_RANGE_DAYS = 366

/**
 * จำนวนผู้ป่วยสูงสุดในรายการต่อการค้นหนึ่งครั้ง
 *
 * หนึ่งแถวคือผู้ป่วยหนึ่งคน ทั้งปีมีราว 1,200 คน เผื่อไว้ที่ 3,000 เท่าข้ออื่น
 * ที่ส่งเฉพาะเคสที่ต้องทบทวน
 */
const MAX_CASE_ROWS = 3000

const rows = (result: unknown) => result as unknown as Record<string, unknown>[]

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v).trim() || null)

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const value = Number(v)
  return Number.isFinite(value) ? value : null
}

/**
 * รายการรหัสยาแบบผูกค่าเป็นพารามิเตอร์ ไม่ใช่คิวรีย่อย
 *
 * เหตุผลเดียวกับข้อ RAS และข้อ metformin — IN (SELECT ...) ทำให้ MariaDB เลิกใช้
 * ดัชนีของ opitemrece.icode แล้วไล่อ่านทั้งตารางสามสิบล้านแถว
 */
const codeList = (icodes: string[]) =>
  sql.join(
    icodes.map(icode => sql`${icode}`),
    sql`, `,
  )

const split = (value: unknown, separator: string): string[] => {
  const text = str(value)
  return text == null
    ? []
    : text
        .split(separator)
        .map(item => item.trim())
        .filter(Boolean)
}

/** ผู้ป่วยสูงอายุหนึ่งคนที่ได้รับยากลุ่มนี้ในช่วงที่เลือก */
export type BenzoCase = {
  hn: string
  patientName: string
  ageYears: number | null
  /** '1' = ชาย, '2' = หญิง ตามรหัสของ HIS */
  sex: string | null
  /** จำนวนครั้งที่ได้รับยาในกลุ่มนี้ในช่วงที่เลือก */
  visits: number
  /** วันที่ได้รับครั้งล่าสุด 'YYYY-MM-DD' */
  lastDate: string | null
  /** เลขที่การมารับบริการครั้งล่าสุด — ใช้เปิดดูรายละเอียดครั้งนั้น */
  lastVn: string
  /** ห้องตรวจของครั้งล่าสุด */
  department: string | null
  /** แพทย์ผู้ตรวจของครั้งล่าสุด */
  doctor: string | null
  /** ชื่อยาในทะเบียนที่ได้รับในช่วงนี้ (ทุกครั้งรวมกัน) */
  drugs: string[]
}

export type BenzoReport = {
  cases: BenzoCase[]
  /** ตัวหาร — ผู้ป่วยนอกสูงอายุทั้งหมดในช่วงนี้ (คน) */
  elderlyPatients: number
  /** ตัวหารแบบนับครั้ง — ครั้งที่ผู้ป่วยนอกสูงอายุมารับบริการ */
  elderlyVisits: number
  /** ตัวตั้ง — ผู้สูงอายุที่ได้รับยาในกลุ่มนี้อย่างน้อยหนึ่งครั้ง (คน) */
  benzoPatients: number
  /** ตัวตั้งแบบนับครั้ง */
  benzoVisits: number
  /** อายุเริ่มต้นที่นับว่าเป็นผู้สูงอายุ ตามที่ตั้งค่าไว้ */
  minAgeYears: number
  /** จำนวนรายการในทะเบียนยา — 0 แปลว่ายังไม่ได้ตั้งค่า รายงานจะว่างเสมอ */
  drugItems: number
  /** icode ของยาในทะเบียน ใช้ไฮไลต์บรรทัดยาตอนเปิดดูรายละเอียดครั้งนั้น */
  drugIcodes: string[]
  /** เกณฑ์เป้าหมาย (ร้อยละ) */
  target: number
  /** ถึงเพดานจำนวนแถวแล้วหรือยัง */
  truncated: boolean
}

/**
 * ผู้ป่วยนอกสูงอายุที่ได้รับยากลุ่ม long-acting benzodiazepine ในช่วงที่เลือก
 *
 * แบ่งเป็นสองคิวรีเหมือนข้อ CKD และข้อ metformin — ตัวหารทั้งปีมีแสนห้าหมื่นครั้ง
 * ขนลงเบราว์เซอร์มาเพื่อกรองก็เท่ากับขนข้อมูลผู้ป่วยมาโดยไม่ได้ใช้ ตัวหารจึงนับ
 * ที่ฐานแล้วส่งมาแต่ตัวเลข ส่วนรายละเอียดส่งเฉพาะคนที่ได้รับยาจริง
 *
 * คิวรีตัวหารไล่จาก vn_stat เพราะตัวหารคือทุกคนที่มา ไม่มีอะไรให้แคบกว่านั้น
 * ส่วนคิวรีรายชื่อไล่จาก opitemrece เข้ามา เพราะการสั่งยากลุ่มนี้เป็นเหตุการณ์
 * ที่หายาก (สองพันกว่าครั้งจากแสนห้า) เริ่มจากฝั่งที่แคบกว่าจึงเร็วกว่ามาก
 */
export async function loadBenzoReport(input: {
  from: string
  to: string
}): Promise<BenzoReport> {
  const rxTable = sql.raw(drugTable('long-acting-benzo'))
  const ages = await loadAgeSettings()
  const minAgeYears = ages['benzo-min-age']

  const [icodeRows] = await hisDb.execute(sql`SELECT icode FROM ${rxTable}`)
  const drugIcodes = rows(icodeRows)
    .map(row => String(row.icode ?? '').trim())
    .filter(Boolean)

  const elderly = sql`v.age_y >= ${minAgeYears}`

  const [denominator] = await hisDb.execute(sql`
    SELECT COUNT(DISTINCT v.vn) AS visits, COUNT(DISTINCT v.hn) AS patients
    FROM vn_stat v
    LEFT OUTER JOIN ovst ov ON ov.vn = v.vn
    WHERE v.vstdate BETWEEN ${input.from} AND ${input.to}
      AND ${elderly} AND ${OPD_ONLY}`)

  const denom = rows(denominator)[0] ?? {}
  const base = {
    elderlyVisits: Number(denom.visits ?? 0),
    elderlyPatients: Number(denom.patients ?? 0),
    minAgeYears,
    drugItems: drugIcodes.length,
    drugIcodes,
    target: BENZO_TARGET,
  }

  // ทะเบียนยาว่าง = ไม่มีเกณฑ์ว่ารายการไหนออกฤทธิ์ยาว คิวรีรายชื่อจะได้ศูนย์แถว
  // อยู่แล้ว และ IN () ที่ไม่มีค่าเลยเป็น syntax error จึงต้องคืนก่อนถึงคิวรี
  if (drugIcodes.length === 0) {
    return { ...base, cases: [], benzoPatients: 0, benzoVisits: 0, truncated: false }
  }

  const codes = codeList(drugIcodes)

  /* ห้องตรวจกับแพทย์เอาของครั้งล่าสุด ไม่ใช่ทุกครั้งรวมกัน — GROUP_CONCAT
     เรียงย้อนวันที่แล้วตัดเอาตัวแรก ได้ค่าของครั้งล่าสุดโดยไม่ต้อง join ซ้ำ
     อีกรอบเพื่อหาว่าครั้งล่าสุดคือ vn ไหน (วิธีเดียวกับข้อ metformin) */
  const [result] = await hisDb.execute(sql`
    SELECT v.hn,
           COUNT(DISTINCT v.vn) AS visits,
           DATE_FORMAT(MAX(v.vstdate), '%Y-%m-%d') AS last_date,
           MAX(v.age_y) AS age_y,
           MAX(v.sex) AS sex,
           SUBSTRING_INDEX(
             GROUP_CONCAT(v.vn ORDER BY v.vstdate DESC SEPARATOR '|'), '|', 1) AS last_vn,
           SUBSTRING_INDEX(
             GROUP_CONCAT(dep.department ORDER BY v.vstdate DESC SEPARATOR '|'), '|', 1)
             AS dep_name,
           SUBSTRING_INDEX(
             GROUP_CONCAT(doc.name ORDER BY v.vstdate DESC SEPARATOR '|'), '|', 1) AS doctor_name,
           GROUP_CONCAT(DISTINCT di.name ORDER BY di.name SEPARATOR ' | ') AS drug_names,
           CONCAT_WS(' ', p.pname, p.fname, p.lname) AS patient_name
    FROM opitemrece o
    JOIN drugitems di ON di.icode = o.icode
    JOIN vn_stat v ON v.vn = o.vn
    LEFT OUTER JOIN patient p ON p.hn = v.hn
    LEFT OUTER JOIN ovst ov ON ov.vn = v.vn
    LEFT OUTER JOIN kskdepartment dep ON dep.depcode = ov.main_dep
    LEFT OUTER JOIN doctor doc ON doc.code = ov.doctor
    WHERE o.vstdate BETWEEN ${input.from} AND ${input.to}
      AND o.qty > ${DISPENSED_QTY}
      AND o.icode IN (${codes})
      AND ${elderly} AND ${OPD_ONLY}
    GROUP BY v.hn, patient_name
    ORDER BY last_date DESC, v.hn
    LIMIT ${MAX_CASE_ROWS + 1}`)

  const all = rows(result)

  const cases: BenzoCase[] = all.slice(0, MAX_CASE_ROWS).map(row => ({
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
  }))

  /* ตัวตั้งนับที่ฐาน ไม่ได้นับจากรายการที่ส่งไป — ถ้าเจอเคสเกินเพดาน รายการจะถูก
     ตัด แต่ร้อยละต้องยังถูกต้อง ไม่งั้นตัวเลขจะต่ำกว่าความจริงโดยไม่มีใครเห็น */
  const [numerator] = await hisDb.execute(sql`
    SELECT COUNT(DISTINCT v.vn) AS visits, COUNT(DISTINCT v.hn) AS patients
    FROM opitemrece o
    JOIN vn_stat v ON v.vn = o.vn
    LEFT OUTER JOIN ovst ov ON ov.vn = v.vn
    WHERE o.vstdate BETWEEN ${input.from} AND ${input.to}
      AND o.qty > ${DISPENSED_QTY}
      AND o.icode IN (${codes})
      AND ${elderly} AND ${OPD_ONLY}`)

  const numer = rows(numerator)[0] ?? {}

  return {
    ...base,
    cases,
    benzoPatients: Number(numer.patients ?? 0),
    benzoVisits: Number(numer.visits ?? 0),
    truncated: all.length > MAX_CASE_ROWS,
  }
}
