import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'

/**
 * รายละเอียดการมารับบริการผู้ป่วยนอกหนึ่งครั้ง (หนึ่ง vn)
 *
 * ทุกคิวรีผูกทั้ง vn และ hn — ผู้ใช้ที่รู้เลข vn ของคนอื่นจึงเปิดดูข้ามคนไม่ได้
 * วันที่แปลงเป็นสตริงตั้งแต่ใน SQL เหมือนหน้าอื่น กันปัญหา timezone ของไดรเวอร์
 */

export type VisitHeader = {
  vn: string
  date: string | null
  time: string | null
  /** ห้องตรวจหลัก */
  department: string | null
  /** แผนก/สาขาที่ตรวจ */
  clinic: string | null
  /** มาด้วยวิธีใด เช่น มาเอง (ห้องบัตร) */
  arrival: string | null
  doctor: string | null
  /** สิทธิการรักษา */
  payment: string | null
}

/** ค่าที่วัดได้จากห้องคัดกรอง — ประกอบเป็นคู่ชื่อ/ค่าฝั่ง JS แล้วส่งมาเลย */
export type VisitVital = { label: string; value: string }

export type VisitDiagnosis = {
  icd10: string
  name: string | null
  /** ชนิดการวินิจฉัย เช่น โรคหลัก / โรคร่วม */
  typeName: string | null
  doctor: string | null
}

export type VisitOrder = {
  key: string
  name: string
  qty: string
  price: string | null
  /** หมวดค่าใช้จ่าย เช่น ค่ายาในบัญชียาหลักแห่งชาติ */
  incomeName: string | null
}

export type VisitLab = {
  key: string
  /** ใบสั่งตรวจ เช่น LAB OPD */
  form: string | null
  name: string
  result: string
  unit: string | null
  normal: string | null
  /** ผลผิดปกติ (abnormal_result = 'Y') */
  abnormal: boolean
}

export type VisitDetail = {
  header: VisitHeader
  chiefComplaint: string | null
  /** ผลตรวจร่างกาย/บันทึกของแพทย์ (opdscreen.pe) เป็นข้อความหลายบรรทัด */
  physicalExam: string | null
  vitals: VisitVital[]
  diagnoses: VisitDiagnosis[]
  orders: VisitOrder[]
  labs: VisitLab[]
}

type Row = Record<string, unknown>

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v).trim() || null)

/** ค่าตัวเลขจาก HIS ที่ว่าง จะถูกเก็บเป็น 0 พอ ๆ กับ null — ทั้งสองแบบถือว่า "ไม่ได้วัด" */
const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n !== 0 ? n : null
}

async function query(statement: ReturnType<typeof sql>): Promise<Row[]> {
  const [rows] = await hisDb.execute(statement)
  return rows as unknown as Row[]
}

async function loadHeader(vn: string, hn: string): Promise<VisitHeader | null> {
  const rows = await query(sql`
    SELECT o.vn, DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS vstdate, o.vsttime,
           dep.department, sp.name AS spclty_name, ist.name AS arrival_name,
           d.name AS doctor_name, p.name AS pttype_name
    FROM ovst o
    LEFT OUTER JOIN kskdepartment dep ON dep.depcode = o.main_dep
    LEFT OUTER JOIN spclty sp ON sp.spclty = o.spclty
    LEFT OUTER JOIN ovstist ist ON ist.ovstist = o.ovstist
    LEFT OUTER JOIN doctor d ON d.code = o.doctor
    LEFT OUTER JOIN pttype p ON p.pttype = o.pttype
    WHERE o.vn = ${vn} AND o.hn = ${hn}
    LIMIT 1`)

  const row = rows[0]
  if (!row) return null
  return {
    vn,
    date: str(row.vstdate),
    // vsttime เก็บเป็น HH:mm:ss — แสดงแค่ชั่วโมงกับนาทีก็พอ
    time: str(row.vsttime)?.slice(0, 5) ?? null,
    department: str(row.department),
    clinic: str(row.spclty_name),
    arrival: str(row.arrival_name),
    doctor: str(row.doctor_name),
    payment: str(row.pttype_name),
  }
}

/** สัญญาณชีพ + อาการสำคัญจาก opdscreen (บาง visit ไม่ผ่านห้องคัดกรอง จึงไม่มีข้อมูล) */
async function loadScreen(vn: string, hn: string) {
  const rows = await query(sql`
    SELECT bps, bpd, pulse, rr, temperature, bw, height, bmi, o2sat, waist, pain_score, cc, pe
    FROM opdscreen
    WHERE vn = ${vn} AND hn = ${hn}
    LIMIT 1`)

  const row = rows[0]
  if (!row) return { chiefComplaint: null, physicalExam: null, vitals: [] as VisitVital[] }

  const bps = num(row.bps)
  const bpd = num(row.bpd)
  const vitals: VisitVital[] = []
  const push = (label: string, value: number | null, unit: string, digits = 0) => {
    if (value != null) vitals.push({ label, value: `${value.toFixed(digits)} ${unit}`.trim() })
  }

  if (bps != null && bpd != null) vitals.push({ label: 'ความดันโลหิต', value: `${bps}/${bpd} mmHg` })
  push('ชีพจร', num(row.pulse), 'ครั้ง/นาที')
  push('การหายใจ', num(row.rr), 'ครั้ง/นาที')
  push('อุณหภูมิ', num(row.temperature), '°C', 1)
  push('น้ำหนัก', num(row.bw), 'กก.', 1)
  push('ส่วนสูง', num(row.height), 'ซม.')
  push('BMI', num(row.bmi), '', 2)
  push('ออกซิเจนปลายนิ้ว', num(row.o2sat), '%')
  push('รอบเอว', num(row.waist), 'ซม.')
  push('ระดับความปวด', num(row.pain_score), '')

  // pe ขึ้นบรรทัดด้วย \r\n ตัด \r ทิ้งให้เหลือ \n อย่างเดียว จะได้แสดงผลตรงกับที่แพทย์พิมพ์
  const physicalExam = str(row.pe)?.replace(/\r\n?/g, '\n') ?? null

  return { chiefComplaint: str(row.cc), physicalExam, vitals }
}

async function loadDiagnoses(vn: string, hn: string): Promise<VisitDiagnosis[]> {
  const rows = await query(sql`
    SELECT a.icd10, b.name AS icd_name, t.name AS diagtype_name, d.name AS doctor_name
    FROM ovstdiag a
    LEFT OUTER JOIN icd101 b ON b.code = a.icd10
    LEFT OUTER JOIN diagtype t ON t.diagtype = a.diagtype
    LEFT OUTER JOIN doctor d ON d.code = a.doctor
    WHERE a.vn = ${vn} AND a.hn = ${hn}
    ORDER BY a.diagtype, a.diag_no`)

  return rows.map(row => ({
    icd10: String(row.icd10 ?? '').trim(),
    name: str(row.icd_name),
    typeName: str(row.diagtype_name),
    doctor: str(row.doctor_name),
  }))
}

/** รายการที่สั่ง/เรียกเก็บใน visit นี้ ทั้งยาและค่าบริการ */
async function loadOrders(vn: string, hn: string): Promise<VisitOrder[]> {
  const rows = await query(sql`
    SELECT a.icode, MAX(s.name) AS iname, SUM(a.qty) AS qty, SUM(a.sum_price) AS sum_price,
           MAX(i.name) AS income_name
    FROM opitemrece a
    LEFT OUTER JOIN s_drugitems s ON s.icode = a.icode
    LEFT OUTER JOIN income i ON i.income = a.income
    WHERE a.vn = ${vn} AND a.hn = ${hn}
    GROUP BY a.icode
    ORDER BY MAX(a.income), MAX(s.name)`)

  return rows.map(row => ({
    key: String(row.icode),
    name: str(row.iname) ?? String(row.icode),
    qty: String(row.qty ?? ''),
    price: row.sum_price == null ? null : Number(row.sum_price).toFixed(2),
    incomeName: str(row.income_name),
  }))
}

/** ผลแล็บของ visit นี้ — เอาเฉพาะรายการที่มีผลออกแล้ว (ที่เหลือเป็นแถวเปล่าของแบบฟอร์ม) */
async function loadLabs(vn: string, hn: string): Promise<VisitLab[]> {
  const rows = await query(sql`
    SELECT h.lab_order_number, h.form_name, o.lab_items_code,
           o.lab_items_name_ref AS item_name, o.lab_order_result AS result,
           o.lab_items_normal_value_ref AS normal_value, o.abnormal_result,
           i.lab_items_unit AS unit
    FROM lab_head h
    INNER JOIN lab_order o ON o.lab_order_number = h.lab_order_number
    LEFT OUTER JOIN lab_items i ON i.lab_items_code = o.lab_items_code
    WHERE h.vn = ${vn} AND h.hn = ${hn}
      AND o.lab_order_result IS NOT NULL AND o.lab_order_result <> ''
    ORDER BY h.lab_order_number, i.display_order`)

  return rows.map((row, index) => ({
    key: `${String(row.lab_order_number)}-${String(row.lab_items_code)}-${index}`,
    form: str(row.form_name),
    name: str(row.item_name) ?? String(row.lab_items_code),
    result: String(row.result).trim(),
    unit: str(row.unit),
    normal: str(row.normal_value),
    abnormal: row.abnormal_result === 'Y',
  }))
}

export async function getVisitDetail(vn: string, hn: string): Promise<VisitDetail | null> {
  const header = await loadHeader(vn, hn)
  // ไม่มีหัว visit = vn ไม่ใช่ของ hn นี้ ไม่ต้องยิงคิวรีที่เหลือ
  if (!header) return null

  const [screen, diagnoses, orders, labs] = await Promise.all([
    loadScreen(vn, hn),
    loadDiagnoses(vn, hn),
    loadOrders(vn, hn),
    loadLabs(vn, hn),
  ])

  return { header, ...screen, diagnoses, orders, labs }
}
