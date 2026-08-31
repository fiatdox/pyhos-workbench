import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'
import { getPatientConditions, type PatientCondition } from './conditions'
import { listHlaResults, type HlaResult } from './hla-b5801'
import { hasPatientImage } from './patient-image'
import { countLabCultures } from './lab-culture'

/**
 * ประวัติการได้รับยา — พอร์ตมาจากสคริปต์ PHP เดิม (hos1/MariaDB)
 *
 * ต่างจากของเดิมสองเรื่อง:
 * 1. ผูกค่า hn เป็น parameter ไม่ต่อสตริงลง SQL (ของเดิมยิง SQL injection ได้)
 * 2. ค่าในตาราง (จำนวน + วิธีใช้) ดึงมาเป็นชุดเดียว 3 คิวรี แล้วประกอบใน JS
 *    ของเดิมยิงคิวรีทีละช่อง = จำนวนยา × จำนวนคอลัมน์ ครั้ง
 *
 * วันที่ทุกตัวแปลงเป็นสตริง 'YYYY-MM-DD' ตั้งแต่ใน SQL — กันปัญหา timezone
 * ตอนจับคู่ช่องในตาราง และไม่ส่งข้อความไทยลงไปใน SQL (ชุดอักขระของ HIS ไม่ใช่ utf8)
 */

export type MedicationColumn = {
  key: string
  date: string
  type: 'OPD' | 'HME' | 'BCH'
  /** ข้อความใต้วันที่: OPD = ชื่อห้องตรวจ, HME = ยากลับบ้าน, BCH = ยาต่อเนื่อง */
  label: string
  an: string | null
  orderNo: string | null
  /** เลข visit — มีเฉพาะคอลัมน์ OPD ใช้เปิดดูรายละเอียดการมารับบริการครั้งนั้น */
  vn: string | null
  /** มารับบริการผ่านห้องฉุกเฉิน (มีระเบียนใน er_regist) */
  isEr: boolean
}

export type MedicationCell = {
  qty: string
  usage: string | null
  /** รหัสวิธีใช้ยา (drugusage) — ใบพิมพ์ทบทวนยาแสดงรหัสนำหน้าข้อความ */
  usageCode: string | null
}

/**
 * ดึงรหัสกับข้อความวิธีใช้ยาออกจากค่าที่คิวรีรวมมาเป็นสายเดียว (คั่นด้วย tab)
 * ที่ต้องรวมก่อนเพราะยาตัวเดียวกันวันเดียวกันอาจมีหลายแถว ถ้าใช้ MAX() แยกกัน
 * รหัสกับข้อความอาจมาจากคนละแถวจนไม่ตรงกัน
 */
function splitUsage(value: unknown): { usage: string | null; usageCode: string | null } {
  const raw = str(value)
  if (!raw) return { usage: null, usageCode: null }
  const tab = raw.indexOf('\t')
  if (tab < 0) return { usage: raw, usageCode: null }
  return {
    usageCode: raw.slice(0, tab) || null,
    usage: raw.slice(tab + 1) || null,
  }
}

export type MedicationRow = {
  icode: string
  drugName: string
  drugAccount: string | null
  /** รหัสรายได้ — '17' คือกลุ่มที่ของเดิมไฮไลต์สีน้ำเงิน */
  income: string | null
  lastDate: string | null
  cells: Record<string, MedicationCell>
}

export type PatientInfo = {
  hn: string
  name: string
  cid: string | null
  bloodGroup: string | null
  birthday: string | null
  age: number | null
  address: string
  homeTel: string | null
  informTel: string | null
}

/**
 * ข้อมูลผู้ป่วยเท่าที่ส่งออกไปฝั่งหน้าเว็บ
 * ตัดเลขบัตรประชาชน เบอร์โทร และที่อยู่ออก — หน้านี้ใช้ดูประวัติยา ไม่ต้องใช้ข้อมูลติดต่อ
 * และไม่ควรให้ข้อมูลระบุตัวตนหลุดไปกองอยู่ใน JSON ฝั่ง client โดยไม่จำเป็น
 */
export type PatientSummary = Pick<PatientInfo, 'hn' | 'name' | 'birthday' | 'age' | 'bloodGroup'>

/** ประวัติแพ้ยาหนึ่งรายการ (ตาราง opd_allergy) */
export type DrugAllergy = {
  agent: string
  symptom: string | null
  seriousness: string | null
  reportDate: string | null
  /** หมายเหตุที่เจ้าหน้าที่บันทึกไว้ (opd_allergy.note) */
  note: string | null
  /** ผู้บันทึก */
  reporter: string | null
}

export type MedicationHistory = {
  months: number
  patient: PatientSummary | null
  /** ประวัติแพ้ยาทั้งหมดของผู้ป่วย — ไม่จำกัดช่วงเวลา เพราะการแพ้ยาไม่หมดอายุ */
  allergies: DrugAllergy[]
  /** กลุ่มโรคสำคัญจากประวัติการวินิจฉัยทั้งหมด (stroke, หัวใจ, sepsis, COPD, หืด, มะเร็ง) */
  conditions: PatientCondition[]
  /** ผลตรวจ HLA-B*5801 ของผู้ป่วยรายนี้ (ทุกช่วงเวลา) — ว่างแปลว่าไม่เคยตรวจ */
  hlaResults: HlaResult[]
  /** มีรูปผู้ป่วยในระบบหรือไม่ (ตัวรูปโหลดแยกผ่าน /api/his/patient-image) */
  hasPhoto: boolean
  /** จำนวนผลแล็บแบบเอกสารที่มีเนื้อความจริง — 0 คือไม่ต้องขึ้นปุ่มให้กด */
  labCultureCount: number
  columns: MedicationColumn[]
  rows: MedicationRow[]
}

type Row = Record<string, unknown>

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v))

/** ทำรายการค่าให้เป็น placeholder คั่นจุลภาค สำหรับ IN (...) — ยังผูกค่าเป็น parameter ตามปกติ */
function list(values: string[]) {
  return sql.join(values.map(v => sql`${v}`), sql`, `)
}

async function query(statement: ReturnType<typeof sql>): Promise<Row[]> {
  // execute() คืน [rows, fields] — type ฝั่ง drizzle ครอบคลุมทั้ง SELECT และ INSERT
  // ที่นี่เป็น SELECT ล้วน จึงเป็นอาเรย์ของแถวเสมอ
  const [rows] = await hisDb.execute(statement)
  return rows as unknown as Row[]
}

async function loadPatient(hn: string): Promise<PatientInfo | null> {
  const rows = await query(sql`
    SELECT CONCAT(a.pname, a.fname, ' ', a.lname) AS ptname,
           a.cid, a.bloodgrp, a.hometel, a.informtel,
           DATE_FORMAT(a.birthday, '%Y-%m-%d') AS birthday,
           TIMESTAMPDIFF(YEAR, a.birthday, CURDATE()) AS cnt_year,
           a.addrpart, a.moopart, b.full_name
    FROM patient a
    LEFT OUTER JOIN thaiaddress b
      ON b.addressid = CONCAT(a.chwpart, a.amppart, a.tmbpart)
    WHERE a.hn = ${hn}
    LIMIT 1`)

  const row = rows[0]
  if (!row) return null

  // ประกอบที่อยู่ฝั่ง JS — ส่งคำว่า "หมู่" ลงไปใน SQL แล้วได้อักขระเพี้ยน
  const address = [
    str(row.addrpart),
    str(row.moopart) ? `หมู่ ${str(row.moopart)}` : null,
    str(row.full_name),
  ]
    .filter(Boolean)
    .join(' ')

  return {
    hn,
    name: String(row.ptname ?? '').trim(),
    cid: str(row.cid),
    bloodGroup: str(row.bloodgrp),
    birthday: str(row.birthday),
    age: row.cnt_year == null ? null : Number(row.cnt_year),
    address,
    homeTel: str(row.hometel),
    informTel: str(row.informtel),
  }
}

/**
 * ประวัติแพ้ยาจาก opd_allergy — ดึงทั้งหมดไม่จำกัดช่วงเวลา
 * ตัวยาเดียวกันถูกบันทึกซ้ำได้หลายครั้ง จึงเก็บเฉพาะรายการล่าสุดของแต่ละตัวยา
 */
export async function loadAllergies(hn: string): Promise<DrugAllergy[]> {
  const rows = await query(sql`
    SELECT a.agent, a.symptom, s.seiousness_name AS seriousness, a.note, a.reporter,
           DATE_FORMAT(a.report_date, '%Y-%m-%d') AS report_date
    FROM opd_allergy a
    LEFT OUTER JOIN allergy_seriousness s ON s.seriousness_id = a.seriousness_id
    WHERE a.hn = ${hn} AND a.agent IS NOT NULL AND a.agent <> ''
    ORDER BY a.report_date DESC`)

  const seen = new Set<string>()
  const allergies: DrugAllergy[] = []
  for (const row of rows) {
    const agent = String(row.agent).trim()
    const key = agent.toUpperCase()
    if (seen.has(key)) continue
    seen.add(key)
    allergies.push({
      agent,
      symptom: str(row.symptom),
      seriousness: str(row.seriousness),
      reportDate: str(row.report_date),
      note: str(row.note),
      reporter: str(row.reporter),
    })
  }
  return allergies
}

/** คอลัมน์ของตาราง = ครั้งที่รับยา (OPD ราย visit, HME ราย order, BCH เอาครั้งล่าสุดครั้งเดียว) */
async function loadColumns(hn: string, months: number): Promise<MedicationColumn[]> {
  const rows = await query(sql`
    SELECT * FROM (
      ( SELECT DATE_FORMAT(a.vstdate, '%Y-%m-%d') AS dd, 'OPD' AS ee, 'OPD' AS order_type,
               a.an, MAX(a.vn) AS vn, MAX(dep.department) AS dep_name,
               -- er_regist มี vn เป็น primary key — มีระเบียน = ผ่านห้องฉุกเฉิน
               -- คอลัมน์รวมทั้งวัน ถ้าวันนั้นมี visit ER ปนอยู่ถือว่าเป็น ER
               MAX(IF(er.vn IS NULL, 'N', 'Y')) AS is_er
        FROM ovst a
        LEFT OUTER JOIN kskdepartment dep ON dep.depcode = a.main_dep
        LEFT OUTER JOIN er_regist er ON er.vn = a.vn
        WHERE a.hn = ${hn}
          AND a.vstdate BETWEEN DATE_SUB(CURDATE(), INTERVAL ${months} MONTH) AND CURDATE()
          AND a.an IS NULL
          AND (SELECT COUNT(*) FROM opitemrece aa WHERE aa.vn = a.vn AND aa.icode LIKE '1%') > 0
        GROUP BY a.vstdate )
      UNION ALL
      ( SELECT DATE_FORMAT(a.rxdate, '%Y-%m-%d') AS dd, a.order_no AS ee, 'HME' AS order_type,
               a.an, b.vn, NULL AS dep_name, 'N' AS is_er
        FROM ipt_order_no a
        LEFT OUTER JOIN ipt b ON b.an = a.an
        WHERE b.hn = ${hn} AND a.order_type = 'Hme'
          AND a.rxdate BETWEEN DATE_SUB(CURDATE(), INTERVAL ${months} MONTH) AND CURDATE() )
      UNION ALL
      ( SELECT DATE_FORMAT(MAX(b.rxdate), '%Y-%m-%d') AS dd, MAX(b.order_no) AS ee,
               b.order_type, a.an, a.vn, NULL AS dep_name, 'N' AS is_er
        FROM ipt a
        LEFT OUTER JOIN ipt_order_no b ON b.an = a.an
        WHERE a.hn = ${hn} AND b.order_type = 'BCH'
          AND b.rxdate BETWEEN DATE_SUB(CURDATE(), INTERVAL ${months} MONTH) AND CURDATE()
        GROUP BY a.an
        ORDER BY MAX(b.rxdate) DESC
        LIMIT 1 )
    ) qq
    ORDER BY dd DESC`)

  return rows.map(row => {
    const type = String(row.order_type ?? 'OPD').toUpperCase() as MedicationColumn['type']
    const an = str(row.an)
    const orderNo = str(row.ee)
    const label =
      type === 'OPD' ? (str(row.dep_name) ?? 'ผู้ป่วยนอก')
      : type === 'HME' ? 'ยากลับบ้าน'
      : 'ยาต่อเนื่อง'
    return {
      key: `${type}|${String(row.dd)}|${an ?? ''}|${orderNo ?? ''}`,
      date: String(row.dd),
      type,
      label,
      an,
      orderNo: type === 'OPD' ? null : orderNo,
      // ปุ่มดูรายละเอียด visit เปิดได้เฉพาะผู้ป่วยนอก — HME/BCH ผูกกับ an ไม่ใช่ vn
      vn: type === 'OPD' ? str(row.vn) : null,
      isEr: row.is_er === 'Y',
    }
  })
}

/** แถวของตาราง = รายการยา (หนึ่งแถวต่อ icode) เรียงตามวันที่ได้รับล่าสุด */
async function loadDrugRows(hn: string, months: number): Promise<Omit<MedicationRow, 'cells'>[]> {
  const rows = await query(sql`
    SELECT dod.icode,
           MAX(dod.drugname) AS drugname,
           MAX(dod.drugaccount) AS drugaccount,
           MAX(dod.inc) AS inc,
           MAX(dod.vstdate) AS ddd
    FROM (
      ( SELECT a.icode, CONCAT(b.name, b.strength, b.units) AS drugname,
               b.drugaccount, a.income AS inc, DATE_FORMAT(a.vstdate, '%Y-%m-%d') AS vstdate
        FROM opitemrece a
        INNER JOIN drugitems b ON b.icode = a.icode
        WHERE a.hn = ${hn}
          AND a.vstdate BETWEEN DATE_SUB(CURDATE(), INTERVAL ${months} MONTH) AND CURDATE()
          AND a.order_no IS NULL )
      UNION ALL
      ( SELECT b.icode, CONCAT(c.name, c.strength, c.units) AS drugname,
               c.drugaccount, b.income AS inc, DATE_FORMAT(b.vstdate, '%Y-%m-%d') AS vstdate
        FROM ipt_order_no a
        LEFT OUTER JOIN opitemrece b ON b.order_no = a.order_no AND b.an = a.an
        INNER JOIN drugitems c ON c.icode = b.icode
        WHERE b.hn = ${hn} AND a.order_type = 'Hme'
          AND a.rxdate BETWEEN DATE_SUB(CURDATE(), INTERVAL ${months} MONTH) AND CURDATE()
        GROUP BY b.icode )
      UNION ALL
      ( SELECT b.icode, CONCAT(b.name, b.strength, b.units) AS drugname,
               b.drugaccount, a.income AS inc, DATE_FORMAT(a.vstdate, '%Y-%m-%d') AS vstdate
        FROM opitemrece a
        INNER JOIN drugitems b ON b.icode = a.icode
        WHERE a.hn = ${hn}
          AND a.order_no = (
            SELECT MAX(aa.order_no) FROM ipt_order_no aa
            INNER JOIN ipt bb ON bb.an = aa.an
            WHERE aa.order_type = 'BCH' AND bb.hn = ${hn}
              AND aa.rxdate BETWEEN DATE_SUB(CURDATE(), INTERVAL ${months} MONTH) AND CURDATE()) )
    ) dod
    GROUP BY dod.icode
    ORDER BY MAX(dod.vstdate) DESC`)

  return rows.map(row => ({
    icode: String(row.icode),
    drugName: String(row.drugname ?? '').trim(),
    drugAccount: str(row.drugaccount),
    income: str(row.inc),
    lastDate: str(row.ddd),
  }))
}

/** ค่าทุกช่องในตาราง ดึงเป็นชุดเดียวแล้วค่อยจับคู่กับคอลัมน์ */
async function loadCells(
  hn: string,
  months: number,
  columns: MedicationColumn[],
): Promise<Map<string, MedicationCell>> {
  const cells = new Map<string, MedicationCell>()
  const ans = [...new Set(columns.filter(c => c.an).map(c => c.an as string))]
  const bchOrders = [...new Set(columns.filter(c => c.type === 'BCH' && c.orderNo).map(c => c.orderNo as string))]

  // ── OPD: จับคู่ด้วย (วันที่, icode) ──
  if (columns.some(c => c.type === 'OPD')) {
    const rows = await query(sql`
      SELECT DATE_FORMAT(a.vstdate, '%Y-%m-%d') AS vstdate, a.icode,
             SUM(a.qty) AS sum_qty,
             MAX(IF(a.drugusage <> '',
                    CONCAT(a.drugusage, '\t', COALESCE(c.shortlist, '')),
                    CONCAT('\t', COALESCE(d.sp_name, '')))) AS usage_text
      FROM opitemrece a
      INNER JOIN drugitems b ON b.icode = a.icode
      LEFT OUTER JOIN drugusage c ON c.drugusage = a.drugusage
      LEFT OUTER JOIN sp_use d ON d.sp_use = a.sp_use
      WHERE a.hn = ${hn}
        AND a.vstdate BETWEEN DATE_SUB(CURDATE(), INTERVAL ${months} MONTH) AND CURDATE()
      GROUP BY a.vstdate, a.icode`)

    for (const row of rows) {
      cells.set(`OPD|${String(row.vstdate)}|${String(row.icode)}`, {
        qty: String(row.sum_qty ?? ''),
        ...splitUsage(row.usage_text),
      })
    }
  }

  // ── HME: จับคู่ด้วย (an, icode) ──
  if (ans.length > 0) {
    const rows = await query(sql`
      SELECT b.an, b.icode, SUM(b.qty) AS sum_qty,
             MAX(CONCAT(COALESCE(b.drugusage, ''), '\t', COALESCE(c.shortlist, ''))) AS usage_text
      FROM ipt_order_no a
      LEFT OUTER JOIN opitemrece b ON b.order_no = a.order_no
      LEFT OUTER JOIN drugusage c ON c.drugusage = b.drugusage
      WHERE a.order_type = 'Hme' AND b.an IN (${list(ans)})
      GROUP BY b.an, b.icode`)

    for (const row of rows) {
      cells.set(`HME|${String(row.an)}|${String(row.icode)}`, {
        qty: String(row.sum_qty ?? ''),
        ...splitUsage(row.usage_text),
      })
    }
  }

  // ── BCH: จับคู่ด้วย (order_no, an, icode) ──
  if (bchOrders.length > 0 && ans.length > 0) {
    const rows = await query(sql`
      SELECT a.order_no, b.an, b.icode, SUM(b.qty) AS sum_qty,
             MAX(IF(b.sp_use <> '',
                    CONCAT('\t', COALESCE(d.name1, ''), COALESCE(d.name2, ''), COALESCE(d.name3, '')),
                    CONCAT(COALESCE(b.drugusage, ''), '\t', COALESCE(c.shortlist, '')))) AS usage_text
      FROM ipt_order_no a
      INNER JOIN opitemrece b ON b.order_no = a.order_no
      LEFT OUTER JOIN drugusage c ON c.drugusage = b.drugusage
      LEFT OUTER JOIN sp_use d ON d.sp_use = b.sp_use
      WHERE a.order_type = 'BCH' AND a.order_no IN (${list(bchOrders)}) AND b.an IN (${list(ans)})
      GROUP BY a.order_no, b.an, b.icode`)

    for (const row of rows) {
      cells.set(`BCH|${String(row.order_no)}|${String(row.an)}|${String(row.icode)}`, {
        qty: String(row.sum_qty ?? ''),
        ...splitUsage(row.usage_text),
      })
    }
  }

  return cells
}

/** ค้นหาช่องของยาหนึ่งตัวในคอลัมน์หนึ่ง */
function cellKey(column: MedicationColumn, icode: string): string {
  switch (column.type) {
    case 'OPD':
      return `OPD|${column.date}|${icode}`
    case 'HME':
      return `HME|${column.an ?? ''}|${icode}`
    case 'BCH':
      return `BCH|${column.orderNo ?? ''}|${column.an ?? ''}|${icode}`
  }
}

export async function getMedicationHistory(hn: string, months = 6): Promise<MedicationHistory> {
  const patient = await loadPatient(hn)
  if (!patient) {
    return {
      months, patient: null, allergies: [], conditions: [], hlaResults: [],
      hasPhoto: false, labCultureCount: 0, columns: [], rows: [],
    }
  }

  const [columns, drugs, allergies, conditions, hlaResults, hasPhoto, labCultureCount] =
    await Promise.all([
    loadColumns(hn, months),
    loadDrugRows(hn, months),
    loadAllergies(hn),
    getPatientConditions(hn),
    // ผลตรวจ HLA-B*5801 ไม่จำกัดช่วงเวลา ตรวจครั้งเดียวใช้ได้ตลอดชีวิต
    listHlaResults({ hn }),
    hasPatientImage(hn),
    // นับไว้ตั้งแต่ตอนโหลดหน้า เพื่อให้รู้ว่าจะขึ้นปุ่ม Lab Culture หรือไม่
    countLabCultures(hn),
  ])
  const cells = await loadCells(hn, months, columns)

  // ส่งออกเฉพาะฟิลด์ที่หน้าเว็บใช้จริง
  const summary: PatientSummary = {
    hn: patient.hn,
    name: patient.name,
    birthday: patient.birthday,
    age: patient.age,
    bloodGroup: patient.bloodGroup,
  }

  const rows: MedicationRow[] = drugs.map(drug => {
    const own: Record<string, MedicationCell> = {}
    for (const column of columns) {
      const cell = cells.get(cellKey(column, drug.icode))
      if (cell) own[column.key] = cell
    }
    return { ...drug, cells: own }
  })

  return {
    months, patient: summary, allergies, conditions, hlaResults,
    hasPhoto, labCultureCount, columns, rows,
  }
}
