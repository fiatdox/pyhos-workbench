import 'server-only'
import { sql, type SQL } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'
import { rtfToText } from '@/lib/his/rtf'
import { REPORT_CODES, type CheckupPrintout } from '@/lib/his/checkup-sheet'

/**
 * ข้อมูลของใบรายงานผลการตรวจสุขภาพหนึ่งครั้ง — อ่านอย่างเดียวจากฐาน HIS
 *
 * ยกตรรกะมาจาก getPrintout ของ pyhosweb (lib/checkup-results/his.ts) ต่างกันที่ตัวผูก:
 * ต้นแบบผูกกับเลขบัตรของคนที่ยืนยัน OTP ส่วนที่นี่ผูกกับ **hn + vn** — ทุกคิวรีมี hn
 * อยู่ด้วย เดา vn ของคนอื่นแล้วเปิดใบข้ามคนไม่ได้ (แบบเดียวกับ lib/his/visit-detail.ts)
 *
 * ไม่จำกัดสิทธิการรักษาเหมือนต้นแบบ — หน้าตรวจสุขภาพเลือกสิทธิอะไรก็ได้
 * (คนจ่ายเงินมาตรวจเองใช้สิทธิ 00 ซึ่งไม่ใช่สิทธิตรวจสุขภาพ) จึงเปิดใบของแถวที่
 * ขึ้นในรายชื่อได้ทุกแถว
 *
 * ไม่หยิบที่อยู่ เบอร์โทร และเลขบัตรประชาชนเลย ดูเหตุผลที่หัว lib/his/checkup-sheet.ts
 */

type Row = Record<string, unknown>

async function query(statement: SQL): Promise<Row[]> {
  const [result] = await hisDb.execute(statement)
  return result as unknown as Row[]
}

const list = (values: readonly (string | number)[]) =>
  sql.join(
    values.map(v => sql`${v}`),
    sql`, `,
  )

/**
 * ใบสั่งแล็บของครั้งที่มา: vn เดียวกัน หรือ HN เดียวกันที่สั่งในวันที่มาตรวจ (เหมือนรายงานเดิม)
 * — ตรวจสุขภาพบางครั้งสั่งแล็บไว้ใต้ vn อื่นของวันเดียวกัน (ปีงบล่าสุด 279 จาก 2,998 ครั้ง
 * ตามที่ต้นแบบวัดไว้)
 */
const labOfVisit = (hn: string, vn: string, date: string) =>
  sql`h.hn = ${hn} AND (h.vn = ${vn} OR h.order_date = ${date})`

/**
 * แบบบันทึกการตรวจสุขภาพ : อาชีวเวชกรรม (universal_form 43) — เจ้าหน้าที่เลือกข้อความแปลผลไว้ที่นี่
 * ช่องแบบ radio เก็บรหัสเดียว ("1"), แบบ check group เก็บหลายรหัส (";0,6") ชื่อจริงอยู่ใน
 * universal_item_value_list ส่วนช่องข้อความ (ตำแหน่ง ข้อสรุป คำแนะนำ ผลตรวจอื่น ๆ) และหน่วยงาน
 * เก็บข้อความตรง ๆ
 */
const CHECKUP_FORM = 43
const FORM_ITEMS = {
  unit: 1019,
  position: 1027,
  purpose: 1029,
  cbc: 1008,
  xray: 1009,
  kidney: 1010,
  liver: 1011,
  lipid: 1012,
  hepb: 1013,
  hepa: 1014,
  urine: 1015,
  uric: 1016,
  stoolParasite: 1017,
  stoolCulture: 1018,
  audiometry: 1003,
  spirometry: 1004,
  visionNear: 1005,
  vision: 1006,
  visionFar: 1007,
  other: 1020,
  conclusion: 1021,
  advice: 1022,
} as const
type FormKey = keyof typeof FORM_ITEMS

// อักขระควบคุม/อักขระเสียที่หลงมาในข้อมูล HIS — ตัดออกก่อนพิมพ์ (ฟอนต์ไม่มี glyph ให้)
const CONTROL_CHARS = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F�]/g
const str = (v: unknown) =>
  v == null ? undefined : String(v).replace(CONTROL_CHARS, '').trim() || undefined
/** ตัวเลขจาก HIS — ว่างหรือ 0 ถือว่าไม่ได้วัด */
const num = (v: unknown) => {
  const n = Number(v)
  return v != null && v !== '' && Number.isFinite(n) && n !== 0 ? n : undefined
}
/** วันที่ศูนย์ (0000-00-00) ถือว่าไม่มีวันที่ */
const day = (v: unknown) => {
  const s = str(v)
  return !s || s.startsWith('0000') ? undefined : s.slice(0, 10)
}

/** ค่าในแบบบันทึกของครั้งที่มา (vn เดียวกันก่อน ไม่มีจึงใช้ฉบับที่บันทึกวันเดียวกัน) */
async function checkupForm(
  hn: string,
  vn: string,
  date: string,
): Promise<Partial<Record<FormKey, string>>> {
  const [head] = await query(sql`
    SELECT universal_head_id FROM universal_head
    WHERE universal_form_id = ${CHECKUP_FORM} AND hn = ${hn} AND (vn = ${vn} OR entry_date = ${date})
    ORDER BY (vn = ${vn}) DESC, universal_head_id DESC
    LIMIT 1`)
  if (!head) return {}

  const items = Object.values(FORM_ITEMS)
  const [values, options] = await Promise.all([
    query(sql`
      SELECT universal_item_id AS item, universal_item_value_text AS v
      FROM universal_detail
      WHERE universal_head_id = ${head.universal_head_id} AND universal_item_id IN (${list(items)})`),
    query(sql`
      SELECT universal_item_id AS item, universal_item_value_code AS code,
             universal_item_value_name AS name
      FROM universal_item_value_list WHERE universal_item_id IN (${list(items)})`),
  ])

  const label = new Map(options.map(o => [`${o.item}:${String(o.code).trim()}`, str(o.name)]))
  const withOptions = new Set(options.map(o => Number(o.item)))
  const read = (item: number) => {
    const v = str(values.find(r => Number(r.item) === item)?.v)
    // ช่องข้อความ/หน่วยงาน — ใช้ตามที่บันทึก
    if (!v || !withOptions.has(item)) return v
    // ";0,6" → ข้อความของรหัส 0 และ 6 คนละบรรทัด
    const text = v
      .replace(/^;/, '')
      .split(',')
      .map(code => label.get(`${item}:${code.trim()}`))
      .filter(Boolean)
      .join('\n')
    return text || undefined
  }
  return Object.fromEntries(
    (Object.entries(FORM_ITEMS) as [FormKey, number][]).map(([key, item]) => [key, read(item)]),
  )
}

const PHYSICIAN = 1 // doctor.position_id = แพทย์ (doctor_position)

/**
 * แพทย์ผู้ตรวจ: ผู้บันทึกแบบบันทึกตรวจสุขภาพ (universal_head.staff → opduser.doctorcode → doctor)
 * ถ้าเป็นแพทย์ — บางฉบับพยาบาลเป็นผู้บันทึก จึงใช้แพทย์ของ visit (ovst.doctor) แทน
 */
async function checkupDoctor(hn: string, vn: string, date: string, visitDoctor?: string) {
  const rows = await query(sql`
    SELECT d.name, d.licenseno, 0 AS pri
      FROM universal_head h
      JOIN opduser u ON u.loginname = h.staff
      JOIN doctor d ON d.code = u.doctorcode
     WHERE h.universal_form_id = ${CHECKUP_FORM} AND h.hn = ${hn}
       AND (h.vn = ${vn} OR h.entry_date = ${date})
       AND d.position_id = ${PHYSICIAN}
    UNION ALL
    SELECT d.name, d.licenseno, 1 AS pri FROM doctor d WHERE d.code = ${visitDoctor ?? ''}
    ORDER BY pri
    LIMIT 1`)
  const name = str(rows[0]?.name)
  if (!name) return undefined
  // "ว12345" / "12345" → "ว.12345"
  const digits = str(rows[0].licenseno)?.replace(/^ว\.?\s*/, '')
  return { name, license: digits ? `ว.${digits}` : undefined }
}

/** ข้อมูลของใบหนึ่งใบ — null = ไม่พบครั้งที่มานี้ของ HN นี้ */
export async function getCheckupPrintout(hn: string, vn: string): Promise<CheckupPrintout | null> {
  const [p] = await query(sql`
    SELECT o.hn, DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS vstdate,
           CONCAT(COALESCE(p.pname, ''), COALESCE(p.fname, ''), ' ', COALESCE(p.lname, '')) AS name,
           TIMESTAMPDIFF(YEAR, p.birthday, o.vstdate) AS age, p.sex,
           pt.name AS program, o.doctor
    FROM ovst o
    JOIN patient p ON p.hn = o.hn
    LEFT JOIN pttype pt ON pt.pttype = o.pttype
    WHERE o.vn = ${vn} AND o.hn = ${hn}
    LIMIT 1`)
  const visitDate = day(p?.vstdate)
  if (!p || !visitDate) return null

  const [screens, labs, form, xrays, doctor] = await Promise.all([
    query(sql`
      SELECT bw, height, bmi, bps, bpd, pulse, waist
      FROM opdscreen WHERE vn = ${vn} AND hn = ${hn} LIMIT 1`),
    query(sql`
      SELECT o.lab_items_code, o.lab_order_result, o.lab_items_normal_value_ref, o.abnormal_result,
             i.lab_items_unit
      FROM lab_head h
      JOIN lab_order o ON o.lab_order_number = h.lab_order_number
      LEFT JOIN lab_items i ON i.lab_items_code = o.lab_items_code
      WHERE ${labOfVisit(hn, vn, visitDate)} AND h.confirm_report = 'Y'
        AND o.lab_order_result IS NOT NULL AND o.lab_order_result <> ''
        AND o.lab_items_code IN (${list(REPORT_CODES)})
      ORDER BY h.lab_order_number`),
    checkupForm(hn, vn, visitDate),
    // รายงานรังสีที่ยืนยันแล้ว — ใช้เมื่อแบบบันทึกไม่ได้เลือกผลเอกซเรย์ไว้ (ภาพทรวงอกขึ้นก่อน)
    query(sql`
      SELECT x.report_rtf, x.report_text
      FROM xray_report x
      LEFT JOIN xray_items xi ON xi.xray_items_code = x.xray_items_code
      WHERE x.vn = ${vn} AND x.hn = ${hn} AND x.confirm = 'Y'
      ORDER BY (xi.xray_items_name LIKE '%chest%' OR xi.xray_items_name LIKE '%CXR%'
                OR xi.xray_items_name LIKE '%ทรวงอก%') DESC, x.xn DESC`),
    checkupDoctor(hn, vn, visitDate, str(p.doctor)),
  ])

  const sc = screens[0] ?? {}
  const labMap: CheckupPrintout['labs'] = {}
  for (const r of labs) {
    const value = str(r.lab_order_result)
    if (!value) continue
    // ครั้งเดียวกันสั่งซ้ำ — ใช้ใบหลังสุด (เรียงตามเลขใบสั่งแล้ว ตัวหลังทับตัวหน้า)
    labMap[Number(r.lab_items_code)] = {
      value,
      unit: str(r.lab_items_unit),
      normal: str(r.lab_items_normal_value_ref),
      abnormal: r.abnormal_result === 'Y',
    }
  }

  const xrayReport = xrays
    .map(
      x =>
        rtfToText((x.report_rtf as Buffer | string | null) ?? null) ||
        rtfToText(str(x.report_text) ?? null),
    )
    .find(text => text.length > 0)

  return {
    patient: {
      name: str(p.name) ?? '',
      age: p.age == null ? undefined : Number(p.age),
      sex: str(p.sex),
      hn,
      unit: form.unit,
      position: form.position,
      purpose: form.purpose,
    },
    visitDate,
    program: str(p.program),
    doctor,
    vitals: {
      weight: num(sc.bw),
      height: num(sc.height),
      bmi: num(sc.bmi),
      bps: num(sc.bps),
      bpd: num(sc.bpd),
      pulse: num(sc.pulse),
      waist: num(sc.waist),
    },
    labs: labMap,
    notes: {
      ...form,
      // แบบบันทึกไม่ได้เลือกผลเอกซเรย์ไว้ — ใช้รายงานรังสีที่ยืนยันแล้ว (ถ้ามี)
      xray: form.xray ?? xrayReport,
    },
  }
}
