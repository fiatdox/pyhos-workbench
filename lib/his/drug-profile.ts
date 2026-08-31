import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'
import { loadAllergies, type DrugAllergy } from './medication-history'
import { countLabCultures } from './lab-culture'

export type { DrugAllergy }

/**
 * Drug Profile ผู้ป่วยใน — ขั้นตอนเลือกผู้ป่วย
 *
 * ทุกอย่างในไฟล์นี้ทำหน้าที่เดียวคือหา "AN" ให้ได้ก่อน เพราะ Drug Profile
 * ผูกกับการนอนโรงพยาบาลครั้งหนึ่ง ๆ ไม่ใช่ผูกกับคน — คนเดียวกันนอนหลายครั้ง
 * คนละ AN คนละใบยา
 *
 * เข้าได้สองทาง
 *   1. เลือกตึก แล้วได้รายชื่อผู้ที่ยังนอนอยู่ในตึกนั้นตอนนี้
 *   2. ค้นด้วย ชื่อ-สกุล / HN / เลขบัตร / AN แล้วเลือก AN จากรายการที่เจอ
 *
 * ไม่ส่งเลขบัตรประชาชนกลับไปฝั่งหน้าเว็บ แม้จะใช้ค้นได้ก็ตาม
 */

/** ยังไม่จำหน่าย = ยังไม่มีวันจำหน่ายและยังไม่มีสถานะจำหน่าย */
const STILL_ADMITTED = sql`i.dchdate IS NULL AND (i.dchstts IS NULL OR i.dchstts = '')`

/** ชื่อผู้ป่วยประกอบจาก 3 คอลัมน์ ใช้ซ้ำหลายคิวรี */
const PATIENT_NAME = sql`CONCAT(p.pname, p.fname, ' ', p.lname)`

export type WardOption = {
  ward: string
  name: string
  /** จำนวนผู้ป่วยที่ยังนอนอยู่ตอนนี้ */
  admitted: number
}

export type AdmittedPatient = {
  an: string
  hn: string
  name: string
  age: number | null
  /** '1' = ชาย, '2' = หญิง ตามรหัสของ HIS */
  sex: string | null
  ward: string
  wardName: string | null
  admitDate: string | null
  /** จำนวนวันนอนถึงวันนี้ */
  los: number | null
}

export type AdmissionMatch = {
  an: string
  hn: string
  name: string
  age: number | null
  wardName: string | null
  admitDate: string | null
  dischargeDate: string | null
  /** true = ยังนอนอยู่ */
  admitted: boolean
}

export const MIN_NAME_SEARCH = 2

/** จำนวนรายการสูงสุดที่ให้เลือกจากการค้นหา */
const MAX_MATCHES = 30

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v).trim() || null)
const num = (v: unknown): number | null => (v == null ? null : Number(v))

type Row = Record<string, unknown>

const rows = (result: unknown): Row[] => result as unknown as Row[]

/** escape อักขระพิเศษของ LIKE ไม่ให้ % หรือ _ ที่ผู้ใช้พิมพ์กลายเป็น wildcard */
const like = (value: string) => value.replace(/[\\%_]/g, ch => `\\${ch}`)

/**
 * รายชื่อตึกที่เปิดใช้งาน พร้อมจำนวนผู้ป่วยที่นอนอยู่ตอนนี้
 *
 * ใช้ LEFT JOIN เพื่อให้ตึกที่ว่างอยู่ยังโผล่ในรายการ (แสดงเป็น 0)
 * ตึกที่ ward_active = 'N' คือตึกที่ปิดไปแล้ว ไม่ต้องเอามาให้เลือก
 */
export async function listWards(): Promise<WardOption[]> {
  const [result] = await hisDb.execute(sql`
    SELECT w.ward, w.name, COUNT(i.an) AS admitted
    FROM ward w
    LEFT OUTER JOIN ipt i ON i.ward = w.ward AND ${STILL_ADMITTED}
    WHERE w.ward_active = 'Y'
    GROUP BY w.ward, w.name
    ORDER BY w.ward`)

  return rows(result).map(row => ({
    ward: String(row.ward),
    name: String(row.name ?? '').trim(),
    admitted: Number(row.admitted ?? 0),
  }))
}

/**
 * ผู้ป่วยที่ยังนอนอยู่ในตึกที่เลือก
 *
 * ipt มี index (dchstts, ward) อยู่แล้ว การกรองจึงไม่ไล่ทั้งตาราง
 * ไม่มีคอลัมน์เลขเตียงในผลลัพธ์ — ตาราง iptbedmove ของโรงพยาบาลนี้มีข้อมูล
 * ไม่ถึงครึ่งของผู้ป่วยที่นอนอยู่ ส่วน ipt_bed_stat ว่างเปล่า ถ้าแสดงไปจะเป็น
 * ช่องว่างเสียส่วนใหญ่และทำให้เข้าใจผิดว่าไม่มีเตียง
 */
export async function listAdmittedInWard(ward: string): Promise<AdmittedPatient[]> {
  const [result] = await hisDb.execute(sql`
    SELECT i.an, i.hn, ${PATIENT_NAME} AS ptname,
           TIMESTAMPDIFF(YEAR, p.birthday, CURDATE()) AS age, p.sex,
           i.ward, w.name AS ward_name,
           DATE_FORMAT(i.regdate, '%Y-%m-%d') AS regdate,
           DATEDIFF(CURDATE(), i.regdate) AS los
    FROM ipt i
    INNER JOIN patient p ON p.hn = i.hn
    LEFT OUTER JOIN ward w ON w.ward = i.ward
    WHERE i.ward = ${ward} AND ${STILL_ADMITTED}
    ORDER BY i.regdate, i.an`)

  return rows(result).map(row => ({
    an: String(row.an),
    hn: String(row.hn ?? ''),
    name: String(row.ptname ?? '').trim(),
    age: num(row.age),
    sex: str(row.sex),
    ward: String(row.ward ?? ''),
    wardName: str(row.ward_name),
    admitDate: str(row.regdate),
    los: num(row.los),
  }))
}

/** คิวรีร่วมของการค้นหา — ต่างกันแค่เงื่อนไข WHERE */
async function findAdmissions(where: ReturnType<typeof sql>): Promise<AdmissionMatch[]> {
  const [result] = await hisDb.execute(sql`
    SELECT i.an, i.hn, ${PATIENT_NAME} AS ptname,
           TIMESTAMPDIFF(YEAR, p.birthday, CURDATE()) AS age,
           w.name AS ward_name,
           DATE_FORMAT(i.regdate, '%Y-%m-%d') AS regdate,
           DATE_FORMAT(i.dchdate, '%Y-%m-%d') AS dchdate,
           (${STILL_ADMITTED}) AS still_here
    FROM ipt i
    INNER JOIN patient p ON p.hn = i.hn
    LEFT OUTER JOIN ward w ON w.ward = i.ward
    WHERE ${where}
    ORDER BY i.regdate DESC, i.an DESC
    LIMIT ${MAX_MATCHES}`)

  return rows(result).map(row => ({
    an: String(row.an),
    hn: String(row.hn ?? ''),
    name: String(row.ptname ?? '').trim(),
    age: num(row.age),
    wardName: str(row.ward_name),
    admitDate: str(row.regdate),
    dischargeDate: str(row.dchdate),
    admitted: Number(row.still_here ?? 0) === 1,
  }))
}

/**
 * ค้นการนอนโรงพยาบาลจากคำค้นเดียว — รับได้ทั้ง AN, HN, เลขบัตร และชื่อ-สกุล
 *
 * AN กับ HN ยาว 9 หลักเท่ากันจนแยกจากกันด้วยรูปแบบไม่ได้ ตัวเลขล้วนจึงยิง
 * ทั้งสองทางแล้วรวมผล (ทั้งคู่มี index) ปกติจะเจอทางเดียวอยู่แล้ว
 */
export async function searchAdmissions(term: string): Promise<AdmissionMatch[]> {
  const keyword = term.trim()
  if (!keyword) return []

  const digits = keyword.replace(/\D/g, '')

  // เลขบัตรประชาชน 13 หลัก — ตรงตัวเท่านั้น
  if (/^\d{13}$/.test(keyword)) {
    return findAdmissions(sql`p.cid = ${digits}`)
  }

  // ตัวเลขล้วน = AN หรือ HN (เติมศูนย์นำหน้าให้ทั้งคู่ตามที่ HIS เก็บ)
  if (/^\d{1,9}$/.test(keyword)) {
    const padded = digits.padStart(9, '0')
    return findAdmissions(sql`i.an = ${padded} OR i.hn = ${padded}`)
  }

  if (keyword.length < MIN_NAME_SEARCH) return []

  // ชื่อ-สกุล: คำเดียวค้นทั้งชื่อและสกุล, สองคำขึ้นไปถือว่าคำแรกเป็นชื่อ ที่เหลือเป็นสกุล
  // ค้นแบบขึ้นต้นเท่านั้นเพื่อให้ใช้ index ix_fname / ix_lname ของตาราง patient
  const parts = keyword.split(/\s+/).filter(Boolean)
  if (parts.length === 1) {
    const prefix = `${like(parts[0])}%`
    return findAdmissions(sql`(p.fname LIKE ${prefix} OR p.lname LIKE ${prefix})`)
  }

  const first = `${like(parts[0])}%`
  const last = `${like(parts.slice(1).join(' '))}%`
  return findAdmissions(sql`p.fname LIKE ${first} AND p.lname LIKE ${last}`)
}

/* ────────────────────────── แผนการใช้ยา (medplan_ipd) ────────────────────────── */

export type DrugPlanItem = {
  planNumber: number
  icode: string
  /** '1' = ยา, '3' = เวชภัณฑ์/ค่าบริการ (ค่าเตียง ค่าอาหาร ค่าบริการพยาบาล ฯลฯ) */
  itemType: string
  name: string
  /**
   * วิธีใช้ยาแบบเต็ม ประกอบจาก name1 + name2 + name3
   * มาจาก sp_use ถ้าคำสั่งนั้นมี ไม่งั้นใช้ของ drugusage
   */
  usage: string | null
  /** วิธีใช้แบบย่อจาก drugusage.shortlist — ใช้เป็นคำอธิบายกำกับ ไม่ใช่ตัวหลักแล้ว */
  usageShort: string | null
  /** รหัสวิธีใช้ที่คนอ่านได้ เช่น '11pt ท' (drugusage.code) ไม่ใช่เลข id ภายใน */
  usageCode: string | null
  /** วิธีใช้มาจาก sp_use = แพทย์พิมพ์ข้อความสั่งเอง ไม่ได้เลือกจากรายการวิธีใช้มาตรฐาน */
  usageTyped: boolean
  intervalName: string | null
  doctorName: string | null
  /** 'C' = Continue, 'S' = STAT */
  status: string | null
  statusName: string | null
  qty: number | null
  note: string | null
  /** วันแรกที่สั่ง 'YYYY-MM-DD' */
  startDate: string
  /** วันสุดท้ายที่ยังให้ยา (รวมวันนั้น) */
  endDate: string
  /** วันที่มีคำสั่งหยุด — วันนี้ไม่ได้ให้ยาแล้ว, null = ยังไม่สั่งหยุด */
  offDate: string | null
  /** ยังไม่มีคำสั่งหยุด = ยังให้อยู่จนถึงวันล่าสุดของตาราง */
  ongoing: boolean
}

export type DrugPlan = {
  admission: AdmissionMatch | null
  /**
   * ประวัติแพ้ยาของผู้ป่วยรายนี้ (ทุกช่วงเวลา)
   * ต้องดึงมาด้วยเพราะใบยาที่พิมพ์ออกไปมีบรรทัด "การแพ้ยา" อยู่ ถ้าไม่ดึงแล้วพิมพ์
   * ว่าไม่พบประวัติแพ้ยา จะกลายเป็นบอกข้อมูลผิดบนกระดาษที่คนเอาไปใช้ต่อ
   */
  allergies: DrugAllergy[]
  /** จำนวนผลแล็บแบบเอกสารที่มีเนื้อความจริง — 0 คือไม่ต้องขึ้นปุ่มให้กด */
  labCultureCount: number
  /** ทุกวันในช่วง เรียงจากเก่าไปใหม่ ('YYYY-MM-DD') */
  days: string[]
  items: DrugPlanItem[]
}

/** บวก/ลบวันบนสตริง 'YYYY-MM-DD' โดยยึด UTC — ไม่ให้ timezone ของเครื่องมาขยับวัน */
function shiftDay(day: string, delta: number): string {
  const at = new Date(`${day}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() + delta)
  return at.toISOString().slice(0, 10)
}

/**
 * ต่อ name1 + name2 + name3 ของตารางวิธีใช้ให้เป็นข้อความเดียว
 * ทั้ง drugusage และ sp_use ใช้จุดเดี่ยว ๆ เป็นตัวเติมช่องที่ไม่ได้กรอก ต้องคัดทิ้ง
 * ไม่งั้นวิธีใช้จะกลายเป็น "รับประทาน 30 ซีซี . ." บนใบยา
 */
function joinUsageLines(...lines: unknown[]): string | null {
  const text = lines
    .map(line => str(line))
    .filter((line): line is string => line != null && line !== '.' && line !== '-')
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return text || null
}

/** ไล่วันจาก from ถึง to (รวมทั้งสองวัน) — กันไว้ไม่ให้ยาวเกินจริงถ้าข้อมูลเพี้ยน */
function daysBetween(from: string, to: string, max = 400): string[] {
  const out: string[] = []
  let cursor = from
  while (cursor <= to && out.length < max) {
    out.push(cursor)
    cursor = shiftDay(cursor, 1)
  }
  return out
}

/**
 * แผนการใช้ยาของการนอนหนึ่งครั้ง แตกเป็นรายวัน
 *
 * medplan_ipd เก็บเป็น "ช่วง" ไม่ได้เก็บรายวัน — หนึ่งแถวคือคำสั่งใช้ยาหนึ่งคำสั่ง
 * มี orderdate (วันสั่ง) กับ offdate (วันสั่งหยุด) ตารางรายวันจึงคำนวณจากช่วงนี้
 *
 * offdate เป็นวัน "หยุด" ไม่ใช่วันสุดท้ายที่ได้ยา — ตรวจจากคำสั่งที่หมอเขียนโน้ต
 * ไว้ว่า "x N day" แล้ว DATEDIFF(offdate, orderdate) ออกมาเท่ากับ N พอดี
 * (x 3 day → diff 3, x 5 day → diff 5, x 7 day → diff 7) วันสุดท้ายที่ได้ยาจึงเป็น
 * offdate - 1 วัน ยกเว้นคำสั่งแบบ STAT ที่ offdate = orderdate ซึ่งได้ยาวันเดียว
 *
 * ตาราง medplan_ipd_check ที่น่าจะเก็บการเช็คยารายวัน ว่างเปล่าทั้งระบบ
 * จึงบอกได้แค่ว่า "แผนครอบคลุมวันไหน" ไม่ใช่ "พยาบาลให้ยาจริงวันไหน"
 */
export async function getDrugPlan(an: string): Promise<DrugPlan> {
  const [found] = await findAdmissions(sql`i.an = ${an}`)
  if (!found) return { admission: null, allergies: [], labCultureCount: 0, days: [], items: [] }

  // สองอย่างนี้ผูกกับ hn ไม่ใช่ an และไม่พึ่งกัน ยิงพร้อมกันได้
  const [allergies, labCultureCount] = await Promise.all([
    loadAllergies(found.hn),
    countLabCultures(found.hn),
  ])

  const [result] = await hisDb.execute(sql`
    SELECT o.med_plan_number, o.icode, o.icode_type, o.qty, o.note, o.orderstatus,
           DATE_FORMAT(o.orderdate, '%Y-%m-%d') AS order_day,
           DATE_FORMAT(o.offdate, '%Y-%m-%d') AS off_day,
           CONCAT(s.name, ' ', s.strength, ' ', s.units) AS drug_name,
           d.shortlist AS usage_short,
           d.code AS usage_code,
           d.name1 AS du1, d.name2 AS du2, d.name3 AS du3,
           sp.name1 AS sp1, sp.name2 AS sp2, sp.name3 AS sp3, sp.sp_name,
           t.interval_name,
           st.name AS status_name,
           r.name AS doctor_name
    FROM medplan_ipd o
    LEFT OUTER JOIN s_drugitems s ON s.icode = o.icode
    LEFT OUTER JOIN drugusage d ON d.drugusage = o.drugusage
    LEFT OUTER JOIN sp_use sp ON sp.sp_use = o.sp_use
    LEFT OUTER JOIN med_interval_type t ON t.med_interval_type_id = o.med_interval_type_id
    LEFT OUTER JOIN medplan_orderstatus st ON st.orderstatus = o.orderstatus
    LEFT OUTER JOIN doctor r ON r.code = o.doctor
    WHERE o.an = ${an}
    -- เรียงให้ยาที่ยังให้อยู่ขึ้นก่อน แล้วจึงยาที่มีการจ่ายจริง (qty > 0)
    -- ต่างจาก ORDER BY ของสคริปต์เดิมที่เรียงตามวันสั่ง เพราะคำสั่งที่หยุดไปแล้ว
    -- หรือสั่งไว้แต่ไม่ได้จ่าย ไม่ใช่สิ่งที่คนตรวจสอบยาต้องเห็นเป็นอย่างแรก
    ORDER BY (o.offdate IS NULL) DESC,
             (o.qty > 0) DESC,
             o.orderdate DESC,
             o.icode_type,
             o.med_plan_number DESC`)

  // วันสุดท้ายของตาราง: จำหน่ายแล้วก็จบที่วันจำหน่าย ยังนอนอยู่ก็ถึงวันนี้
  const today = new Date().toISOString().slice(0, 10)
  const lastDay = found.dischargeDate ?? today

  const items: DrugPlanItem[] = rows(result).map(row => {
    // sp_use คือข้อความที่แพทย์พิมพ์สั่งเอง ส่วน drugusage เป็นรายการวิธีใช้มาตรฐาน
    // ที่เลือกจากระบบ ของจริงต่างกันได้ เช่น รายการมาตรฐานว่า "ทุก 4 ชั่วโมง"
    // แต่ที่แพทย์พิมพ์สั่งจริงเป็น "ทุก 3 ชั่วโมง" — sp_use จึงต้องชนะเสมอ
    // ไม่งั้นจะแสดงความถี่ผิดไปจากคำสั่งที่แพทย์เขียน
    const spUsage = joinUsageLines(row.sp1, row.sp2, row.sp3) ?? str(row.sp_name)
    const duUsage = joinUsageLines(row.du1, row.du2, row.du3)
    const startDate = String(row.order_day)
    const offDate = str(row.off_day)
    const ongoing = offDate == null
    // offdate เป็นวันที่หยุด จึงถอยหนึ่งวัน — เว้นคำสั่งวันเดียว (STAT) ที่ถอยแล้วจะติดลบ
    const endDate =
      ongoing ? lastDay
      : offDate > startDate ? shiftDay(offDate, -1)
      : startDate

    return {
      planNumber: Number(row.med_plan_number),
      icode: String(row.icode ?? ''),
      itemType: String(row.icode_type ?? ''),
      name: String(row.drug_name ?? '').trim(),
      usage: spUsage ?? duUsage,
      usageShort: str(row.usage_short),
      usageCode: str(row.usage_code),
      usageTyped: spUsage != null,
      intervalName: str(row.interval_name),
      doctorName: str(row.doctor_name),
      status: str(row.orderstatus),
      statusName: str(row.status_name),
      qty: num(row.qty),
      note: str(row.note),
      startDate,
      endDate,
      offDate,
      ongoing,
    }
  })

  if (items.length === 0)
    return { admission: found, allergies, labCultureCount, days: [], items: [] }

  // ช่วงของตาราง = ตั้งแต่คำสั่งแรกสุด (หรือวันรับไว้ ถ้ารับไว้ก่อน) ถึงวันสุดท้าย
  const firstOrder = items.reduce((min, item) => (item.startDate < min ? item.startDate : min), items[0].startDate)
  const from = found.admitDate && found.admitDate < firstOrder ? found.admitDate : firstOrder
  const latest = items.reduce((max, item) => (item.endDate > max ? item.endDate : max), from)
  const to = latest > lastDay ? latest : lastDay

  return { admission: found, allergies, labCultureCount, days: daysBetween(from, to), items }
}
