import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'
import { diagnosisTable, drugTable } from '@/lib/his/rdu-registry'
import { loadAgeSettings } from '@/lib/his/rdu-settings'
import { DISPENSED_QTY, OPD_ONLY } from '@/lib/his/rdu-visit-report'

/**
 * ตัวชี้วัดสตรีตั้งครรภ์ที่ได้รับยาที่ห้ามใช้
 *
 * ยาบางกลุ่มทำให้ทารกในครรภ์พิการหรือเสียชีวิตได้ และไม่มีขนาดที่ปลอดภัย —
 * warfarin (ความพิการของกระดูกและจมูก เลือดออกในสมองทารก) · statins (ขัดขวาง
 * การสร้างคอเลสเตอรอลซึ่งทารกต้องใช้สร้างอวัยวะ) · ergots (บีบมดลูกและหดหลอด
 * เลือดที่ไปเลี้ยงรก) เกณฑ์ของข้อนี้จึงเป็นศูนย์ ไม่ใช่ "น้อยที่สุดเท่าที่ทำได้"
 *
 * ชื่อทางการนับเป็น "จำนวน" ราย ที่นี่ส่งทั้งจำนวนและร้อยละ — จำนวนล้วนเทียบ
 * ข้ามปีไม่ได้ถ้าจำนวนสตรีตั้งครรภ์ที่มารับบริการเปลี่ยนไป และหน้าสรุปสามปี
 * วาดกราฟด้วยร้อยละทุกข้อ ถ้าข้อนี้ส่งแต่จำนวนก็เข้ากราฟชุดเดียวกันไม่ได้
 *
 * ── สองเรื่องที่ทำให้ข้อนี้ต่างจากข้ออื่นทั้งหมด ──
 *
 * หนึ่ง ยาที่ได้รับไม่จำเป็นต้องอยู่ในครั้งเดียวกับที่ลงรหัสตั้งครรภ์ นี่คือหัวใจ
 * ของตัวชี้วัด: เคสที่อันตรายจริงคือสตรีตั้งครรภ์ที่ไปรับยาประจำจากคลินิกอื่น
 * ซึ่งวันนั้นไม่มีใครลงรหัสตั้งครรภ์ไว้ ถ้านับแต่ครั้งเดียวกันจะไม่เห็นเคสแบบนี้เลย
 * จึงต้องนับตามช่วงเวลา ไม่ใช่ตามครั้ง (ดูตัวเลขที่ PREGNANCY_WINDOW_DAYS)
 *
 * สอง ต้องกรองเพศและอายุเอง ทั้งที่ข้ออื่นไม่ต้อง — รหัสหมวดตั้งครรภ์ในฐานนี้
 * ถูกใช้ผิดเยอะมาก ดูรายละเอียดที่ PREGNANCY_MAX_AGE_SETTING ข้างล่าง
 */

/**
 * ช่วงเฝ้าระวังหลังพบรหัสตั้งครรภ์ครั้งแรก (วัน)
 *
 * 280 วันคืออายุครรภ์ครบกำหนด (40 สัปดาห์) ซึ่งเป็นเพดานบนของช่วงที่ยายังถึง
 * ตัวทารกได้ ใช้ตัวเลขนี้เพราะรหัส ICD-10 ไม่ได้บอกอายุครรภ์ จึงไม่มีทางรู้ว่า
 * วันที่มาฝากครรภ์ครั้งแรกนั้นตั้งครรภ์มาแล้วกี่สัปดาห์ และไม่มีทางรู้ว่าคลอดวันไหน
 * ถ้าคนไข้ไม่ได้มาคลอดที่นี่
 *
 * ผลของการเลือกเพดานแทนค่าจริง: คนที่ฝากครรภ์ตอนอายุครรภ์มากแล้วจะถูกเฝ้าระวัง
 * ยาวเกินจริงไปจนถึงหลังคลอด ซึ่งทำให้ตัวเลขสูงกว่าความจริงได้ — เลือกทางนี้
 * เพราะการพลาดเคสที่ทารกได้รับยาไปแล้วแก้อะไรไม่ได้อีก ส่วนเคสที่เกินมาแค่เปิดดู
 * แล้วตัดออกได้ในที่ประชุม (ทุกแถวมีวันที่ครบให้ตรวจสอบ)
 *
 * เทียบกับอีกสองแบบที่ลองแล้ว ในปีงบ 2568 จากสตรีตั้งครรภ์ 1,116 ราย: นับเฉพาะ
 * ครั้งเดียวกัน 0 ราย · นับจากครั้งแรกถึงครั้งสุดท้ายที่มาฝากครรภ์ 0 ราย ·
 * นับตามช่วงนี้ 3 ราย — สองแบบแรกแคบเกินจนตัวชี้วัดไม่เจออะไรเลยทุกปี
 */
export const PREGNANCY_WINDOW_DAYS = 280

/** เกณฑ์เป้าหมาย (ร้อยละ) — ข้อนี้ต้องเป็นศูนย์ ไม่ใช่ "ต่ำไว้ก่อน" */
export const PREGNANCY_TARGET = 0

/** ช่วงวันที่ยาวสุดต่อการค้นหนึ่งครั้ง — เท่ากับตัวชี้วัดข้ออื่น */
export const PREGNANCY_MAX_RANGE_DAYS = 366

/**
 * รหัสเพศหญิงใน vn_stat — ฝังไว้ในโค้ด ไม่ได้ทำเป็นค่าตั้งค่า
 *
 * ต่างจากเกณฑ์อายุที่คณะกรรมการตั้งได้ ตรงที่นี่ไม่ใช่เส้นแบ่งที่ตกลงกันได้
 * แต่เป็นนิยามของตัวชี้วัด
 */
const FEMALE = '2'

/**
 * เกณฑ์อายุที่ใช้กรองตัวหาร
 *
 * ข้ออื่นไม่ต้องกรองเพศหรืออายุเลย เพราะทะเบียนรหัสวินิจฉัยคัดคนให้แล้ว
 * ข้อนี้ทำแบบนั้นไม่ได้ เพราะรหัสหมวดตั้งครรภ์ในฐานนี้ถูกใช้ผิดจนเชื่อไม่ได้:
 * ตรวจปีงบ 2568 พบ O223 (หลอดเลือดดำอุดตันขณะตั้งครรภ์) ถูกคลินิกความดันใช้
 * แทนรหัสหลอดเลือดดำอุดตันทั่วไป มีทั้งผู้ชายและผู้ป่วยอายุ 80–90 ปี
 * ส่วน O2441 (เบาหวานที่เกิดขณะตั้งครรภ์) ก็ถูกใช้กับชายอายุ 69 ปีที่คลินิกเบาหวาน
 *
 * ถ้าไม่กรอง ตัวชี้วัดจะรายงานว่ามีสตรีตั้งครรภ์ได้รับ warfarin สิบรายในปีเดียว
 * ทั้งที่ทุกรายเป็นการลงรหัสผิด แล้วคณะกรรมการจะเสียทั้งรอบประชุมไปกับเคสปลอม
 *
 * ฝั่งบนเป็นด้านที่กรองจริง ๆ ส่วนฝั่งล่างไม่ได้ตั้งไว้ — เด็กอายุสิบสามปี
 * ตั้งครรภ์มีจริงในฐานนี้ และเป็นกลุ่มที่ยิ่งต้องเห็น
 */
const PREGNANCY_MAX_AGE_SETTING = 'pregnancy-max-age' as const

/**
 * จำนวนแถวสูงสุดต่อการค้นหนึ่งครั้ง
 *
 * ตารางส่งเฉพาะรายที่ได้รับยา ซึ่งทั้งปีมีไม่กี่ราย เพดานนี้จึงไม่มีทางถึง
 * ในทางปฏิบัติ ใส่ไว้กันกรณีทะเบียนยาถูกตั้งกว้างเกินจนดึงยาทั่วไปเข้ามา
 */
const MAX_CASE_ROWS = 3000

const rows = (result: unknown) => result as unknown as Record<string, unknown>[]

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v).trim() || null)

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const value = Number(v)
  return Number.isFinite(value) ? value : null
}

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
 * รายการรหัสยาแบบผูกค่าเป็นพารามิเตอร์ ไม่ใช่คิวรีย่อย
 *
 * เหตุผลเดียวกับข้อ benzodiazepine และข้อ metformin — IN (SELECT ...) ทำให้
 * MariaDB เลิกใช้ดัชนีของ opitemrece.icode แล้วไล่อ่านทั้งตารางสามสิบล้านแถว
 */
const codeList = (icodes: string[]) =>
  sql.join(
    icodes.map(icode => sql`${icode}`),
    sql`, `,
  )

/** สตรีตั้งครรภ์หนึ่งรายที่ได้รับยาที่ห้ามใช้ */
export type PregnancyCase = {
  hn: string
  patientName: string
  ageYears: number | null
  /** จำนวนครั้งที่มารับบริการด้วยรหัสตั้งครรภ์ในช่วงที่เลือก */
  visits: number
  /** วันที่พบรหัสตั้งครรภ์ครั้งแรก 'YYYY-MM-DD' — จุดเริ่มของช่วงเฝ้าระวัง */
  firstDate: string | null
  /** วันที่พบรหัสตั้งครรภ์ครั้งล่าสุด */
  lastDate: string | null
  /** วันสิ้นสุดช่วงเฝ้าระวังที่ใช้จริงกับรายนี้ */
  windowTo: string | null
  /** เลขที่การมารับบริการครั้งล่าสุดที่ลงรหัสตั้งครรภ์ — ใช้เปิดดูรายละเอียด */
  lastVn: string
  /** ห้องตรวจของครั้งล่าสุดที่ลงรหัสตั้งครรภ์ */
  department: string | null
  /** แพทย์ผู้ตรวจของครั้งล่าสุดที่ลงรหัสตั้งครรภ์ */
  doctor: string | null
  /** รหัสวินิจฉัยในทะเบียนที่บันทึกไว้ */
  icd10: string[]
  /** ชื่อยาที่ห้ามใช้ที่ได้รับในช่วงเฝ้าระวัง */
  drugs: string[]
  /** วันที่ได้รับยาที่ห้ามใช้ครั้งแรกในช่วงเฝ้าระวัง */
  drugDate: string | null
}

export type PregnancyReport = {
  cases: PregnancyCase[]
  /** ตัวหาร — สตรีตั้งครรภ์ที่มารับบริการในช่วงนี้ (ราย) */
  pregnantPatients: number
  /** ตัวตั้ง — ผู้ที่ได้รับยาที่ห้ามใช้อย่างน้อยหนึ่งรายการ (ราย) */
  exposedPatients: number
  /** จำนวนรหัสในทะเบียนวินิจฉัย — 0 แปลว่ายังไม่ได้ตั้งค่า รายงานจะว่างเสมอ */
  diagnosisCodes: number
  /** จำนวนรายการในทะเบียนยา — 0 แปลว่าทุกรายจะขึ้นว่าไม่ได้รับยาต้องห้าม */
  drugItems: number
  /** icode ของยาในทะเบียน ใช้ไฮไลต์บรรทัดยาตอนเปิดดูรายละเอียด */
  drugIcodes: string[]
  /** อายุสูงสุดที่นับเข้าตัวหาร ตามที่ตั้งค่าไว้ */
  maxAgeYears: number
  /** ความยาวของช่วงเฝ้าระวัง (วัน) */
  windowDays: number
  /** เกณฑ์เป้าหมาย (ร้อยละ) */
  target: number
  /** ถึงเพดานจำนวนแถวแล้วหรือยัง */
  truncated: boolean
}

/**
 * ชิ้นส่วนคิวรี "หนึ่งแถวคือสตรีตั้งครรภ์หนึ่งราย" พร้อมช่วงเฝ้าระวังของรายนั้น
 *
 * ทั้งคิวรีนับและคิวรีรายชื่อต้องนิยามตัวหารเหมือนกันเป๊ะ ถ้าเขียนแยกกันสองที่
 * แล้ววันหนึ่งมีใครแก้เงื่อนไขข้างเดียว ร้อยละบนการ์ดกับจำนวนแถวในตารางจะขัดกัน
 * โดยไม่มีใครเห็นว่าผิดตรงไหน
 *
 * window_to ตัดไม่ให้เลยปลายช่วงที่ค้น — ถ้าปล่อยให้ล้นออกไป ตัวเลขของปีงบที่
 * ปิดไปแล้วจะขยับได้อีกเมื่อมีข้อมูลใหม่เข้ามา ซึ่งทำให้กราฟเทียบสามปีไม่นิ่ง
 */
const pregnantWomen = (input: { from: string; to: string; maxAgeYears: number }) => {
  const dxTable = sql.raw(diagnosisTable('pregnancy'))
  return sql`
    SELECT v.hn,
           COUNT(DISTINCT v.vn) AS visits,
           MIN(v.vstdate) AS first_date,
           MAX(v.vstdate) AS last_date,
           LEAST(DATE_ADD(MIN(v.vstdate), INTERVAL ${PREGNANCY_WINDOW_DAYS} DAY),
                 ${input.to}) AS window_to,
           MAX(v.age_y) AS age_y,
           SUBSTRING_INDEX(
             GROUP_CONCAT(v.vn ORDER BY v.vstdate DESC SEPARATOR '|'), '|', 1) AS last_vn,
           GROUP_CONCAT(DISTINCT d.icd10 ORDER BY d.icd10 SEPARATOR ',') AS dx
      FROM vn_stat v
      JOIN ovstdiag d ON d.vn = v.vn
      JOIN ${dxTable} r ON r.icd10 = d.icd10
      LEFT OUTER JOIN ovst ov ON ov.vn = v.vn
     WHERE v.vstdate BETWEEN ${input.from} AND ${input.to}
       AND v.sex = ${FEMALE}
       AND v.age_y <= ${input.maxAgeYears}
       AND ${OPD_ONLY}
     GROUP BY v.hn`
}

/**
 * เงื่อนไข "ได้รับยาที่ห้ามใช้ในช่วงเฝ้าระวังของรายนี้"
 *
 * ไล่จาก opitemrece.hn ไม่ได้ไล่จาก vn — ครั้งที่ได้รับยาเป็นคนละครั้งกับครั้ง
 * ที่ลงรหัสตั้งครรภ์ ซึ่งเป็นเหตุผลที่ตัวชี้วัดข้อนี้มีอยู่
 *
 * ไม่ตัดฝั่งผู้ป่วยในออก ต่างจากตัวหารที่นับเฉพาะผู้ป่วยนอก — คำถามคือทารก
 * ได้รับยาหรือไม่ ไม่ใช่ได้รับที่เคาน์เตอร์ไหน ยาที่ได้ระหว่างนอนโรงพยาบาลก็
 * ถึงตัวทารกเท่ากัน
 */
const exposed = (icodes: string[]) => sql`
  EXISTS (SELECT 1 FROM opitemrece o
           WHERE o.hn = pg.hn
             AND o.qty > ${DISPENSED_QTY}
             AND o.icode IN (${codeList(icodes)})
             AND o.vstdate BETWEEN pg.first_date AND pg.window_to)`

/**
 * สตรีตั้งครรภ์ที่ได้รับยาที่ห้ามใช้ในช่วงวันที่ที่เลือก
 *
 * ตารางส่งเฉพาะรายที่ได้รับยา ไม่ใช่ตัวหารทั้งชุด — ตัวหารทั้งปีมีราวพันราย
 * ซึ่งเป็นชื่อและ HN ของคนที่ไม่มีอะไรต้องตาม การขนลงเบราว์เซอร์จึงเป็นการส่ง
 * ข้อมูลผู้ป่วยออกไปโดยไม่ได้ใช้ ตัวหารมาเป็นตัวเลขบนการ์ดพอ
 */
export async function loadPregnancyReport(input: {
  from: string
  to: string
}): Promise<PregnancyReport> {
  const ages = await loadAgeSettings()
  const maxAgeYears = ages[PREGNANCY_MAX_AGE_SETTING]
  const scope = { ...input, maxAgeYears }

  const [registry] = await hisDb.execute(sql`
    SELECT COUNT(*) AS dx_count FROM ${sql.raw(diagnosisTable('pregnancy'))}`)
  const diagnosisCodes = Number(rows(registry)[0]?.dx_count ?? 0)

  const [icodeRows] = await hisDb.execute(
    sql`SELECT icode FROM ${sql.raw(drugTable('preg-contra'))}`,
  )
  const drugIcodes = rows(icodeRows)
    .map(row => String(row.icode ?? '').trim())
    .filter(Boolean)

  const base = {
    diagnosisCodes,
    drugItems: drugIcodes.length,
    drugIcodes,
    maxAgeYears,
    windowDays: PREGNANCY_WINDOW_DAYS,
    target: PREGNANCY_TARGET,
  }

  // ทะเบียนวินิจฉัยว่าง = ไม่มีเกณฑ์ว่ารหัสไหนแปลว่าตั้งครรภ์ ตัวหารจะเป็นศูนย์
  // อยู่แล้ว ข้ามไปเลยดีกว่ากวนฐานด้วยคิวรีที่รู้คำตอบล่วงหน้า
  if (diagnosisCodes === 0) {
    return { ...base, cases: [], pregnantPatients: 0, exposedPatients: 0, truncated: false }
  }

  const pair = await countPregnancyPair(input)
  const totals = { pregnantPatients: pair.denominator, exposedPatients: pair.numerator }

  // ทะเบียนยาว่างก็ไม่มีตัวตั้ง และ IN () ที่ไม่มีค่าเลยเป็น syntax error
  if (drugIcodes.length === 0) {
    return { ...base, ...totals, cases: [], truncated: false }
  }

  /* ชื่อยากับวันที่ได้รับแยกเป็นสองคิวรีย่อยของแถวเดียวกัน — คิวรีย่อยแบบ scalar
     คืนได้คอลัมน์เดียว และสองค่านี้ใช้คนละฟังก์ชันรวม (GROUP_CONCAT กับ MIN) */
  const drugNames = sql`
    SELECT GROUP_CONCAT(DISTINCT di.name ORDER BY di.name SEPARATOR ' | ')
      FROM opitemrece o
      JOIN drugitems di ON di.icode = o.icode
     WHERE o.hn = pg.hn AND o.qty > ${DISPENSED_QTY}
       AND o.icode IN (${codeList(drugIcodes)})
       AND o.vstdate BETWEEN pg.first_date AND pg.window_to`

  const drugDate = sql`
    SELECT DATE_FORMAT(MIN(o.vstdate), '%Y-%m-%d')
      FROM opitemrece o
     WHERE o.hn = pg.hn AND o.qty > ${DISPENSED_QTY}
       AND o.icode IN (${codeList(drugIcodes)})
       AND o.vstdate BETWEEN pg.first_date AND pg.window_to`

  const [result] = await hisDb.execute(sql`
    SELECT pg.hn, pg.visits, pg.age_y, pg.last_vn, pg.dx,
           DATE_FORMAT(pg.first_date, '%Y-%m-%d') AS first_date,
           DATE_FORMAT(pg.last_date, '%Y-%m-%d') AS last_date,
           DATE_FORMAT(pg.window_to, '%Y-%m-%d') AS window_to,
           CONCAT_WS(' ', p.pname, p.fname, p.lname) AS patient_name,
           dep.department AS dep_name,
           doc.name AS doctor_name,
           (${drugNames}) AS drug_names,
           (${drugDate}) AS drug_date
      FROM (${pregnantWomen(scope)}) pg
      LEFT OUTER JOIN patient p ON p.hn = pg.hn
      LEFT OUTER JOIN ovst lov ON lov.vn = pg.last_vn
      LEFT OUTER JOIN kskdepartment dep ON dep.depcode = lov.main_dep
      LEFT OUTER JOIN doctor doc ON doc.code = lov.doctor
     WHERE ${exposed(drugIcodes)}
     ORDER BY drug_date DESC, pg.hn
     LIMIT ${MAX_CASE_ROWS + 1}`)

  const all = rows(result)

  return {
    ...base,
    ...totals,
    cases: all.slice(0, MAX_CASE_ROWS).map(row => ({
      hn: String(row.hn ?? '').trim(),
      patientName: str(row.patient_name) ?? '—',
      ageYears: num(row.age_y),
      visits: Number(row.visits ?? 0),
      firstDate: str(row.first_date),
      lastDate: str(row.last_date),
      windowTo: str(row.window_to),
      lastVn: String(row.last_vn ?? '').trim(),
      department: str(row.dep_name),
      doctor: str(row.doctor_name),
      icd10: split(row.dx, ','),
      drugs: split(row.drug_names, '|'),
      drugDate: str(row.drug_date),
    })),
    truncated: all.length > MAX_CASE_ROWS,
  }
}

/**
 * ตัวตั้ง/ตัวหารของช่วงหนึ่ง — ใช้ทั้งในหน้ารายงานและหน้าสรุปรายปี
 *
 * นับที่ฐานทั้งคู่ ไม่ได้นับจากรายการที่ส่งไป — ถ้าเจอเคสเกินเพดาน รายการจะถูกตัด
 * แต่ร้อยละต้องยังถูกต้อง ไม่งั้นตัวเลขจะต่ำกว่าความจริงโดยไม่มีใครเห็น
 */
export async function countPregnancyPair(input: { from: string; to: string }): Promise<{
  numerator: number
  denominator: number
}> {
  const ages = await loadAgeSettings()
  const scope = { ...input, maxAgeYears: ages[PREGNANCY_MAX_AGE_SETTING] }

  const [icodeRows] = await hisDb.execute(
    sql`SELECT icode FROM ${sql.raw(drugTable('preg-contra'))}`,
  )
  const drugIcodes = rows(icodeRows)
    .map(row => String(row.icode ?? '').trim())
    .filter(Boolean)

  const [result] = await hisDb.execute(sql`
    SELECT COUNT(*) AS denom,
           ${drugIcodes.length === 0 ? sql`0` : sql`SUM(${exposed(drugIcodes)})`} AS numer
      FROM (${pregnantWomen(scope)}) pg`)

  const row = rows(result)[0] ?? {}
  return { numerator: Number(row.numer ?? 0), denominator: Number(row.denom ?? 0) }
}
