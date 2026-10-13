import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'

/**
 * งานตรวจสุขภาพ — รายชื่อผู้ที่มารับบริการตามสิทธิที่เลือก ในช่วงวันที่ที่เลือก
 *
 * รับสองอย่าง: **ชื่อสิทธิ** กับ **ช่วงวันที่** แล้วคืนรายชื่อ ไม่มีเงื่อนไขอื่นซ่อนอยู่
 * สิทธิที่เลือกคือคำนิยามของรายงาน — ครั้งที่ใช้สิทธินั้นในช่วงนั้นเข้าทุกครั้ง
 *
 * ตั้งต้นให้หน้าจอเลือก 18 สิทธิที่ชื่อมีคำว่า "ตรวจสุขภาพ" ไว้ให้ (ดู
 * CheckupRight.checkupNamed) แต่เลือกสิทธิอื่นได้ทั้งหมด เพราะงานตรวจสุขภาพจริง
 * ไม่ได้ใช้แต่สิทธิที่ชื่อตรงคำ — วัดปีงบ 2569 ที่ศูนย์ตรวจสุขภาพ (Wellness Center)
 * กลุ่มใหญ่สุด 3,370 จาก 6,449 ครั้งใช้สิทธิ "00 ชำระเงิน (ไม่มีสิทธิการรักษา)"
 * คือคนจ่ายเงินมาตรวจเอง ซึ่งไม่อยู่ใน 18 สิทธินั้น ถ้าต้องการกลุ่มนี้ต้องเลือก
 * สิทธิ 00 เพิ่มเอง
 *
 * ## ข้อมูลที่ไม่ส่งออกไป
 *
 * ตาราง patient กับ vn_stat มีเลขบัตรประชาชน เบอร์โทร และที่อยู่อยู่ด้วย
 * คิวรีในไฟล์นี้ไม่หยิบคอลัมน์เหล่านั้นเลย — หน้าจอต้องการแค่ชื่อ เพศ และอายุ
 */

/** ช่วงวันที่ยาวสุดต่อการค้นหนึ่งครั้ง — เท่ากับรายงานอื่นของระบบ */
export const CHECKUP_MAX_RANGE_DAYS = 366

/**
 * จำนวนแถวสูงสุดที่ส่งกลับไปหน้าจอ
 *
 * เลือกสิทธิใหญ่ได้ และสิทธิใหญ่ที่สุดในฐานมีถึง 94,724 ครั้งต่อปี ("40 ผู้มีอายุ
 * เกิน 60 ปีบริบูรณ์") ถ้าไม่ปิดเพดานไว้ การเลือกสิทธินั้นจะลากทั้งก้อนลง
 * เบราว์เซอร์ เพดานนี้ตัดแถว แต่ยอดรวมกับจำนวนคนยังนับจากทั้งหมดจริง (ดู
 * totalVisits/totalPatients) จึงบอกได้ว่าตัดไปเท่าไรและตัวเลขรวมไม่ผิด
 */
export const CHECKUP_MAX_ROWS = 15_000

/** อ่านผลคิวรีเป็นแถวดิบ */
const rows = (result: unknown) => result as unknown as Record<string, unknown>[]

/**
 * อักขระควบคุมและอักขระเสียที่หลงมาในข้อมูล — ตัดออกก่อนส่งถึงเบราว์เซอร์
 *
 * ไล่ชื่อผู้ป่วยทั้งตาราง 628,461 ราย เจอ 1 รายที่มี U+001E (record separator)
 * ติดท้ายนามสกุล ตัวเดียวแต่ต้องตัด เพราะค่านี้ไปต่อสามทาง: ตารางบนจอ (มองไม่เห็น
 * แต่คัดลอกไปแล้วติดไปด้วย) ไฟล์ CSV (อักขระควบคุมในไฟล์ทำให้โปรแกรมบางตัวอ่าน
 * แถวเพี้ยน) และใบที่พิมพ์ (ฟอนต์ไม่มี glyph ให้ U+001E)
 *
 * ขึ้นบรรทัดกับแท็บก็ตัดด้วย — ทุกช่องที่ไฟล์นี้อ่านเป็นข้อความบรรทัดเดียวทั้งหมด
 * (ชื่อ สิทธิ ห้องตรวจ แพทย์) ไม่มีช่องไหนที่การขึ้นบรรทัดมีความหมาย
 */
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F�]/g

const str = (v: unknown): string | null =>
  v == null || v === '' ? null : String(v).replace(CONTROL_CHARS, '').trim() || null

/** สิทธิการรักษาหนึ่งรายการ สำหรับช่องเลือกสิทธิ */
export type CheckupRight = {
  /** รหัสสิทธิ (pttype.pttype) */
  code: string
  name: string
  /** ชื่อสิทธิมีคำว่า "ตรวจสุขภาพ" — หน้าจอใช้เลือกไว้ให้ตั้งต้น */
  checkupNamed: boolean
}

/**
 * สิทธิการรักษาที่เปิดใช้งาน
 *
 * เอาเฉพาะ isuse = 'Y' (207 จาก 211 รายการ) — สี่รายการที่ปิดไปแล้วไม่ควรให้เลือก
 * ใหม่ แต่ถ้ามีครั้งเก่าที่ใช้สิทธินั้นอยู่ ชื่อสิทธิในตารางผลยังอ่านได้ปกติ
 * เพราะส่วนนั้น join ตรงกับ pttype ไม่ได้กรอง isuse
 */
export async function listCheckupRights(): Promise<CheckupRight[]> {
  const [result] = await hisDb.execute(sql`
    SELECT pttype, name
    FROM pttype
    WHERE isuse = 'Y'
    ORDER BY pttype`)

  return rows(result)
    .map(row => {
      const code = String(row.pttype ?? '').trim()
      const name = str(row.name) ?? code
      return { code, name, checkupNamed: name.includes('ตรวจสุขภาพ') }
    })
    .filter(right => right.code !== '')
}

/** การมารับบริการหนึ่งครั้ง */
export type CheckupVisit = {
  vn: string
  hn: string
  date: string | null
  patientName: string
  ageYears: number | null
  /** '1' ชาย '2' หญิง ตามรหัสของ HIS */
  sex: string | null
  pttype: string | null
  pttypeName: string | null
  department: string | null
  doctor: string | null
}

/** ยอดรวมของสิทธิหนึ่งรายการ */
export type CheckupRightSummary = {
  pttype: string | null
  name: string
  visits: number
  patients: number
}

export type CheckupReport = {
  from: string
  to: string
  /** สิทธิที่เลือก */
  pttypes: string[]
  /** รายชื่อ — ไม่เกิน CHECKUP_MAX_ROWS แถว เรียงวันใหม่สุดขึ้นก่อน */
  visits: CheckupVisit[]
  /** จำนวนครั้งทั้งหมดในช่วงนี้ตามสิทธิที่เลือก — นับจากทั้งหมด ไม่ใช่จากแถวที่ส่ง */
  totalVisits: number
  /** จำนวนคน (HN ไม่ซ้ำ) ทั้งหมดในช่วงนี้ — นับจากทั้งหมดเช่นกัน */
  totalPatients: number
  /** ยอดแยกตามสิทธิ — นับจากทั้งหมด ไม่ใช่จากแถวที่ส่ง */
  byRight: CheckupRightSummary[]
  /** เกิน CHECKUP_MAX_ROWS จึงตัดรายชื่อ ส่วนตัวเลขสรุปยังเป็นยอดจริงทั้งหมด */
  truncated: boolean
}

export type CheckupInput = {
  /** 'YYYY-MM-DD' */
  from: string
  to: string
  /** รหัสสิทธิที่ต้องการ — ต้องมีอย่างน้อยหนึ่งรหัส */
  pttypes: string[]
}

/**
 * ค้นรายชื่อผู้ที่มารับบริการตามสิทธิที่เลือก
 *
 * ขับจาก vn_stat ซึ่งมีดัชนีทั้งที่ vstdate และ pttype — วัดแล้ว 18 สิทธิตรวจสุขภาพ
 * ทั้งปีงบใช้ 0.54 วินาที และสิทธิที่ใหญ่ที่สุดในฐานก็ยังอยู่ที่ 0.92 วินาที
 * คิวรีเดียวได้ครบ ไม่ต้องคัดกรองแล้วค่อยอ่านรายละเอียดเป็นสองรอบ
 *
 * ยอดสรุปแยกเป็นคิวรีของตัวเอง ยิงพร้อมกัน ไม่ได้นับจากแถวที่คืนมา — เพราะแถวที่
 * คืนมาถูก LIMIT ตัดไว้ ถ้านับจากแถวที่เหลือ ยอดรวมจะต่ำกว่าความจริงโดยที่คนอ่าน
 * ไม่รู้ และยอดนี้เบามาก (GROUP BY บนดัชนีเดียวกัน ไม่ต้อง join อะไรเลย)
 */
export async function searchCheckups(input: CheckupInput): Promise<CheckupReport> {
  const pttypes = [...new Set(input.pttypes.filter(code => code !== ''))]
  if (pttypes.length === 0) throw new Error('กรุณาเลือกสิทธิอย่างน้อยหนึ่งรายการ')

  const codeList = sql.join(
    pttypes.map(code => sql`${code}`),
    sql`, `,
  )

  const [listResult, summaryResult] = await Promise.all([
    hisDb.execute(sql`
      SELECT v.vn, v.hn,
             DATE_FORMAT(v.vstdate, '%Y-%m-%d') AS vstdate,
             v.age_y, v.sex, v.pttype,
             pt.name AS pttype_name,
             dep.department AS dep_name,
             doc.name AS doctor_name,
             CONCAT_WS(' ', p.pname, p.fname, p.lname) AS patient_name
      FROM vn_stat v
      LEFT OUTER JOIN ovst ov ON ov.vn = v.vn
      LEFT OUTER JOIN pttype pt ON pt.pttype = v.pttype
      LEFT OUTER JOIN kskdepartment dep ON dep.depcode = ov.main_dep
      LEFT OUTER JOIN doctor doc ON doc.code = ov.doctor
      LEFT OUTER JOIN patient p ON p.hn = v.hn
      WHERE v.vstdate BETWEEN ${input.from} AND ${input.to}
        AND v.pttype IN (${codeList})
      ORDER BY v.vstdate DESC, v.vn DESC
      LIMIT ${CHECKUP_MAX_ROWS}`),
    /* ห้องตรวจกับชื่อผู้ป่วยไม่ต้องใช้ตรงนี้ จึงไม่ join — ยอดแยกตามสิทธิอ่านชื่อ
       สิทธิจาก pttype ตารางเดียว ส่วน COUNT(DISTINCT hn) ของทุกสิทธิรวมกันต้องนับ
       แยกอีกแถว เพราะคนเดียวใช้ได้หลายสิทธิในช่วงเดียวกัน ผลบวกของแต่ละสิทธิจึง
       ไม่เท่ากับจำนวนคนทั้งหมด (WITH ROLLUP ให้แถวรวมนั้นมาในคิวรีเดียวกัน)

       GROUP BY ต้องมี v.pttype คอลัมน์เดียว ชื่อสิทธิหยิบด้วย MAX() —
       ถ้าใส่ชื่อสิทธิเข้าไปใน GROUP BY ด้วย ROLLUP จะสร้างแถวรวม**สองชั้น**
       (ชั้นของ pttype+ชื่อ และชั้นของ pttype เฉย ๆ ที่ชื่อเป็น NULL) ทุกสิทธิ
       จะออกมาสองแถว ยอดรวมของตารางสรุปเลยเบิ้ลเป็นสองเท่า ชื่อสิทธิขึ้นกับรหัส
       อยู่แล้ว MAX() จึงได้ชื่อเดียวที่ถูกต้องเสมอ */
    hisDb.execute(sql`
      SELECT v.pttype, MAX(pt.name) AS pttype_name,
             COUNT(*) AS visits, COUNT(DISTINCT v.hn) AS patients
      FROM vn_stat v
      LEFT OUTER JOIN pttype pt ON pt.pttype = v.pttype
      WHERE v.vstdate BETWEEN ${input.from} AND ${input.to}
        AND v.pttype IN (${codeList})
      GROUP BY v.pttype WITH ROLLUP`),
  ])

  const visits: CheckupVisit[] = []
  for (const row of rows(listResult[0])) {
    const vn = String(row.vn ?? '').trim()
    if (vn === '') continue
    visits.push({
      vn,
      hn: String(row.hn ?? '').trim(),
      date: str(row.vstdate),
      patientName: str(row.patient_name) ?? '—',
      ageYears: row.age_y == null ? null : Number(row.age_y),
      sex: str(row.sex),
      pttype: str(row.pttype),
      pttypeName: str(row.pttype_name),
      department: str(row.dep_name),
      doctor: str(row.doctor_name),
    })
  }

  let totalVisits = 0
  let totalPatients = 0
  const byRight: CheckupRightSummary[] = []
  for (const row of rows(summaryResult[0])) {
    const visitCount = Number(row.visits ?? 0)
    const patientCount = Number(row.patients ?? 0)
    // แถวรวมของ ROLLUP มี pttype เป็น NULL — ต่างจากสิทธิว่างในข้อมูลจริงซึ่ง
    // เป็นสตริงว่าง ไม่ใช่ NULL จึงแยกกันได้
    if (row.pttype == null) {
      totalVisits = visitCount
      totalPatients = patientCount
      continue
    }
    const code = String(row.pttype).trim()
    byRight.push({
      pttype: code === '' ? null : code,
      name: str(row.pttype_name) ?? (code === '' ? 'ไม่ระบุสิทธิ' : code),
      visits: visitCount,
      patients: patientCount,
    })
  }
  byRight.sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name))

  return {
    from: input.from,
    to: input.to,
    pttypes,
    visits,
    totalVisits,
    totalPatients,
    byRight,
    truncated: totalVisits > visits.length,
  }
}
