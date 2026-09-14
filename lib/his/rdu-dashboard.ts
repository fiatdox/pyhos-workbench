import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'
import { diagnosisTable, drugTable } from '@/lib/his/rdu-registry'
import {
  ANTIBIOTIC_FLAG,
  ANTIBIOTIC_FLAG_VALUE,
  ageFilterOf,
  DISPENSED_QTY,
  OPD_ONLY,
  reportSpec,
  type VisitReportKind,
} from '@/lib/his/rdu-visit-report'

/**
 * ข้อมูลดิบสำหรับหน้าวิเคราะห์ตัวชี้วัด RDU
 *
 * ต่างจากหน้ารายงานตรงเจตนา — หน้ารายงานเป็นรายการทำงานรายเคส ส่วนหน้านี้
 * ตอบคำถามว่า "ตัวเลขที่ออกมามาจากไหน" แยกตามห้องตรวจ แพทย์ รหัสโรค และตัวยา
 *
 * ทำไมส่งข้อมูลรายครั้งลงไปให้เบราว์เซอร์รวมเอง แทนที่จะรวมด้วย SQL:
 * คิวรีรวมข้อมูลหนึ่งชุดใช้เวลาราวสองวินาทีเมื่อดูทั้งปีงบประมาณ (วัดจากตัวชี้วัด RI
 * ปีงบ 2568 ซึ่งมี 10,483 ครั้ง) ถ้าให้เซิร์ฟเวอร์รวมแล้วกรองทีละมุม การกดเปลี่ยน
 * ตัวกรองหนึ่งครั้งจะรอสองวินาทีทุกครั้ง — ดึงครั้งเดียวแล้วให้เบราว์เซอร์กรองเอง
 * ทำให้กดแล้วเปลี่ยนทันที ซึ่งเป็นสิ่งที่คนวิเคราะห์ข้อมูลต้องการ
 *
 * ข้อความยาว ๆ (ชื่อห้องตรวจ ชื่อแพทย์ ชื่อยา) ส่งเป็นพจนานุกรมชุดเดียว แล้วให้
 * แต่ละแถวอ้างด้วยหมายเลข — ถ้าส่งข้อความซ้ำทุกแถว ข้อมูลปีงบประมาณหนึ่งชุด
 * จะใหญ่กว่านี้หลายเท่าโดยไม่ได้อะไรเพิ่ม
 *
 * ไม่มีชื่อผู้ป่วย HN และ VN อยู่ในชุดนี้เลย — หน้านี้ดูภาพรวม ไม่ได้ตามรายเคส
 * (ตามรายเคสไปดูที่หน้ารายงานซึ่งมีด่านตรวจของตัวเอง)
 */

/** จำนวนครั้งสูงสุดที่ดึงมาวิเคราะห์ — ปีงบประมาณของตัวชี้วัดที่ใหญ่สุดอยู่ราวหนึ่งหมื่น */
const MAX_VISITS = 30000

const rows = (result: unknown) => result as unknown as Record<string, unknown>[]

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v).trim() || null)

/** หนึ่งครั้งที่มารับบริการ — อ้างพจนานุกรมด้วยหมายเลข */
export type DashboardVisit = {
  /** 'YYYY-MM-DD' */
  d: string
  /** หมายเลขห้องตรวจในพจนานุกรม — -1 คือไม่มีข้อมูล */
  dep: number
  /** หมายเลขแพทย์ในพจนานุกรม — -1 คือไม่มีข้อมูล */
  doc: number
  /** หมายเลขรหัสวินิจฉัยที่อยู่ในทะเบียน (หนึ่งครั้งมีได้หลายรหัส) */
  dx: number[]
  /** หมายเลขยาที่นับ — ว่าง = ครั้งนั้นไม่ได้รับยา */
  rx: number[]
}

export type DashboardFacts = {
  departments: string[]
  doctors: string[]
  /** รหัสวินิจฉัยพร้อมชื่อโรค */
  codes: { code: string; name: string }[]
  drugs: { icode: string; name: string }[]
  visits: DashboardVisit[]
  /** อายุสูงสุดที่นับ (ปี) — null = ไม่จำกัด */
  maxAgeYears: number | null
  /** อายุต่ำสุดที่นับ (ปี) — null = ไม่จำกัด */
  minAgeYears: number | null
  /** ถึงเพดานจำนวนครั้งแล้วหรือยัง */
  truncated: boolean
}

/** ตัวสะสมพจนานุกรม — คืนหมายเลขของค่าที่ให้มา เพิ่มเข้าไปถ้ายังไม่เคยเจอ */
function indexer<T>(key: (item: T) => string) {
  const seen = new Map<string, number>()
  const list: T[] = []
  return {
    list,
    of(item: T | null): number {
      if (item == null) return -1
      const id = key(item)
      const found = seen.get(id)
      if (found != null) return found
      seen.set(id, list.length)
      list.push(item)
      return list.length - 1
    },
  }
}

/**
 * ดึงข้อมูลรายครั้งของตัวชี้วัดหนึ่งข้อในช่วงวันที่ที่เลือก
 *
 * โครงคิวรีเหมือนหน้ารายงานทุกอย่าง (GROUP BY vn, LEFT JOIN ห้องตรวจ/แพทย์,
 * นับเฉพาะ qty > 0, กรองอายุตามนิยาม) ต่างกันแค่เลือกคอลัมน์น้อยกว่าและดึงยา
 * มาเป็น icode แทนชื่อ — ชื่อยายาวและซ้ำกันทุกแถว ส่งเป็นพจนานุกรมทีหลังคุ้มกว่า
 *
 * ชื่อยาตามมาด้วยคิวรีที่สองซึ่งถามเฉพาะรหัสที่พบจริงในช่วงนั้น ไม่ใช่ทั้งทะเบียน
 */
export async function loadDashboardFacts(input: {
  kind: VisitReportKind
  from: string
  to: string
}): Promise<DashboardFacts> {
  const spec = reportSpec(input.kind)
  const dxTable = sql.raw(diagnosisTable(spec.diagnosis))
  // เทียบตรงนี้ ไม่ผ่านตัวแปรกลาง — TypeScript จะได้แคบชนิดของ spec.drug ให้เอง
  // ในกิ่งที่ไม่ใช่ธง แล้ว drugTable() รับค่าได้โดยไม่ต้อง cast
  /* ข้อที่นับการใช้ยาต่อเนื่องด้วย (โรคหืด) ต้องเอาแถว qty = 0 มาด้วย ไม่งั้น
     ตัวเลขบนหน้าวิเคราะห์จะไม่ตรงกับหน้ารายงานของข้อเดียวกัน ซึ่งเป็นความ
     ไม่ตรงกันที่หาต้นเหตุยากที่สุดเวลาคนสองคนเปิดคนละหน้าแล้วได้คนละเลข
     (เหตุผลของกฎนี้อยู่ที่ CONTINUED_QTY ใน rdu-visit-report.ts) */
  const qtyFilter = spec.countContinued ? sql`` : sql`AND o.qty > ${DISPENSED_QTY}`

  const rxCodes =
    spec.drug === ANTIBIOTIC_FLAG
      ? sql`
        SELECT GROUP_CONCAT(DISTINCT o.icode)
          FROM opitemrece o
          JOIN drugitems di ON di.icode = o.icode AND di.antibiotic = ${ANTIBIOTIC_FLAG_VALUE}
         WHERE o.vn = v.vn ${qtyFilter}`
      : sql`
        SELECT GROUP_CONCAT(DISTINCT o.icode)
          FROM opitemrece o
          JOIN ${sql.raw(drugTable(spec.drug))} r ON r.icode = o.icode
         WHERE o.vn = v.vn ${qtyFilter}`

  const maxAgeYears = spec.maxAgeYears ?? null
  const minAgeYears = spec.minAgeYears ?? null
  const ageFilter = ageFilterOf(spec)

  const [result] = await hisDb.execute(sql`
    SELECT DATE_FORMAT(v.vstdate, '%Y-%m-%d') AS d,
           dep.department AS dep_name,
           doc.name AS doc_name,
           GROUP_CONCAT(DISTINCT d.icd10 ORDER BY d.icd10) AS dx,
           (${rxCodes}) AS rx
    FROM vn_stat v
    JOIN ovstdiag d ON d.vn = v.vn
    JOIN ${dxTable} a ON a.icd10 = d.icd10
    LEFT OUTER JOIN ovst ov ON ov.vn = v.vn
    LEFT OUTER JOIN kskdepartment dep ON dep.depcode = ov.main_dep
    LEFT OUTER JOIN doctor doc ON doc.code = ov.doctor
    WHERE v.vstdate BETWEEN ${input.from} AND ${input.to} ${ageFilter}
      AND ${OPD_ONLY}
    GROUP BY v.vn, v.vstdate, dep_name, doc_name
    ORDER BY v.vstdate
    LIMIT ${MAX_VISITS + 1}`)

  const all = rows(result)
  const truncated = all.length > MAX_VISITS

  const departments = indexer<string>(name => name)
  const doctors = indexer<string>(name => name)
  const codes = indexer<{ code: string; name: string }>(item => item.code)
  const drugs = indexer<{ icode: string; name: string }>(item => item.icode)

  const split = (value: unknown): string[] => {
    const text = str(value)
    return text == null
      ? []
      : text
          .split(',')
          .map(item => item.trim())
          .filter(Boolean)
  }

  const visits: DashboardVisit[] = all.slice(0, MAX_VISITS).map(row => ({
    d: String(row.d ?? '').trim(),
    dep: departments.of(str(row.dep_name)),
    doc: doctors.of(str(row.doc_name)),
    // ชื่อโรคเติมทีหลัง ตอนนี้ยังไม่รู้ชื่อ ใส่รหัสไว้ก่อนแล้วค่อยเขียนทับ
    dx: split(row.dx).map(code => codes.of({ code, name: '' })),
    rx: split(row.rx).map(icode => drugs.of({ icode, name: '' })),
  }))

  // เติมชื่อโรคกับชื่อยาให้เฉพาะรหัสที่พบจริงในช่วงนี้ ไม่ใช่ทั้งทะเบียน —
  // ทะเบียนอาจมีรหัสที่ไม่มีใครใช้เลยในช่วงที่ดู ส่งไปก็ไม่ได้ใช้
  if (codes.list.length > 0) {
    const [named] = await hisDb.execute(sql`
      SELECT code, name, tname FROM icd101
      WHERE code IN (${sql.join(
        codes.list.map(item => sql`${item.code}`),
        sql`, `,
      )})`)
    const byCode = new Map(
      rows(named).map(row => [
        String(row.code ?? '').trim(),
        // ชื่อไทยว่างมากกว่าครึ่งของตาราง จึงยึดชื่ออังกฤษเป็นหลัก
        str(row.name) ?? str(row.tname) ?? '',
      ]),
    )
    for (const item of codes.list) item.name = byCode.get(item.code) ?? ''
  }

  if (drugs.list.length > 0) {
    const [named] = await hisDb.execute(sql`
      SELECT icode, name FROM drugitems
      WHERE icode IN (${sql.join(
        drugs.list.map(item => sql`${item.icode}`),
        sql`, `,
      )})`)
    const byIcode = new Map(
      rows(named).map(row => [String(row.icode ?? '').trim(), str(row.name) ?? '']),
    )
    for (const item of drugs.list) item.name = byIcode.get(item.icode) ?? item.icode
  }

  return {
    departments: departments.list,
    doctors: doctors.list,
    codes: codes.list,
    drugs: drugs.list,
    visits,
    maxAgeYears,
    minAgeYears,
    truncated,
  }
}
