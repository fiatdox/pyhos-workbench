import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'
import { labCodes } from '@/lib/his/lab-codes'
import { diagnosisTable, drugTable } from '@/lib/his/rdu-registry'
import { DISPENSED_QTY, OPD_ONLY } from '@/lib/his/rdu-visit-report'

/**
 * ตัวชี้วัดการใช้ยา NSAIDs ในผู้ป่วยโรคไตเรื้อรัง
 *
 * ทำไมข้อนี้ไม่ได้ใช้โครงเดียวกับตัวชี้วัดข้ออื่นใน rdu-visit-report.ts:
 * ข้ออื่นถามว่า "ครั้งที่วินิจฉัยด้วยรหัสนี้ ได้รับยาในทะเบียนหรือไม่" ตัวหารจึงหาได้
 * จาก ovstdiag ของครั้งนั้นตรง ๆ แต่ข้อนี้ตัวหารเป็น "ผู้ป่วยที่เป็นโรคไตเรื้อรัง
 * ระดับ 3 ขึ้นไปอยู่แล้ว" ซึ่งเป็นสถานะติดตัวผู้ป่วย ไม่ใช่สิ่งที่บันทึกซ้ำทุกครั้งที่มา
 *
 * เรื่องนี้สำคัญกับความถูกต้องของตัวเลขมาก — คนไข้ CKD ถูกลงรหัส N18 ที่คลินิกโรคไต
 * แต่ยา NSAIDs มักถูกสั่งที่ห้องตรวจกระดูกหรือห้องตรวจทั่วไปซึ่งไม่ได้ลงรหัส N18
 * ไว้ในครั้งนั้น ถ้าใช้ตัวหารแบบ "วินิจฉัยในครั้งนั้น" เคสที่ตัวชี้วัดตั้งใจจะจับ
 * จะหลุดออกไปเกือบทั้งหมด (วัดจากเดือน ส.ค. 2568: วินิจฉัยในครั้งนั้น 3,249 ครั้ง
 * เทียบกับสถานะติดตัว 7,436 ครั้ง)
 *
 * สถานะ "โรคไตเรื้อรังระดับ 3 ขึ้นไป" ณ วันที่มารับบริการ มาจากสองทาง
 *   1. เคยถูกวินิจฉัยด้วยรหัสในทะเบียน pyhos_ckd_icd10 ก่อนหรือในวันนั้น
 *   2. ผล eGFR ครั้งล่าสุดก่อนหรือในวันนั้นต่ำกว่า 60 (เส้นแบ่งระยะ 3)
 *
 * ทางที่สองดูค่า "ล่าสุด" ไม่ใช่ "เคยมี" ทั้งที่แบบหลังเขียนง่ายกว่าและเร็วกว่ามาก
 * เพราะผลต่างกันเยอะเกินจะมองข้าม — วัดจากปีงบ 2568 ผู้ป่วยที่ได้รับ NSAIDs
 * 799 คนที่เข้าเกณฑ์แบบ "เคยมี" มีถึง 302 คน (38%) ที่ค่าไตกลับขึ้นเกิน 60 แล้ว
 * และไม่เคยถูกลงรหัสโรคไตเลย ส่วนใหญ่เป็นไตวายเฉียบพลันที่หายแล้ว ไม่ใช่ไตเรื้อรัง
 * ถ้านับเข้าไปด้วย ตัวชี้วัดจะสูงกว่าความจริงหนึ่งในสาม
 *
 * ข้อจำกัดที่ยังเหลือ: นิยาม CKD จริงต้องมีค่าต่ำสองครั้งห่างกันอย่างน้อยสามเดือน
 * ซึ่งคิวรีนี้ยังไม่ได้ตรวจ ผู้ป่วยที่ค่าไตกำลังตกจากภาวะเฉียบพลันจึงเข้ามาได้
 * — จึงส่งค่า eGFR ล่าสุดพร้อมวันที่ตรวจไปแสดงทุกแถว ให้เภสัชกรตัดสินเองได้
 */

/** เส้นแบ่งระยะ 3 ของโรคไตเรื้อรัง (mL/min/1.73m²) — ต่ำกว่านี้ถือว่าระยะ 3 ขึ้นไป */
export const CKD_STAGE3_EGFR = 60

/** ช่วงวันที่ยาวสุดต่อการค้นหนึ่งครั้ง — เท่ากับตัวชี้วัดข้ออื่น */
export const CKD_MAX_RANGE_DAYS = 366

/**
 * จำนวนเคสสูงสุดต่อการค้นหนึ่งครั้ง
 *
 * สูงกว่าตัวชี้วัดข้ออื่น (2,000) เพราะที่นี่หนึ่งแถวคือเคสที่ต้องทบทวนจริง ๆ
 * ไม่ใช่ทั้งตัวหาร — ทั้งปีมีราว 2,700 เคส ถ้าตัดที่ 2,000 การดูทั้งปีงบประมาณ
 * ซึ่งเป็นสิ่งที่คณะกรรมการต้องทำจะไม่ครบ
 */
const MAX_CASE_ROWS = 3000

const rows = (result: unknown) => result as unknown as Record<string, unknown>[]

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v).trim() || null)

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const value = Number(v)
  return Number.isFinite(value) ? value : null
}

/** ผลแล็บที่กรอกเป็นข้อความ นับเฉพาะแถวที่เป็นตัวเลขล้วน (มี 'ดูผลที่ image' ปนอยู่) */
const NUMERIC_RESULT = '^[0-9]+(\\.[0-9]+)?$'

/** หนึ่งเคสที่ต้องทบทวน — ผู้ป่วย CKD ระดับ 3 ขึ้นไปที่ได้รับ NSAIDs ในครั้งนั้น */
export type CkdNsaidCase = {
  vn: string
  hn: string
  /** 'YYYY-MM-DD' */
  date: string | null
  patientName: string
  ageYears: number | null
  /** '1' = ชาย, '2' = หญิง ตามรหัสของ HIS */
  sex: string | null
  department: string | null
  doctor: string | null
  /** eGFR ล่าสุดก่อนหรือในวันที่มารับบริการ — null = ไม่เคยมีผลแล็บ */
  egfr: number | null
  /** วันที่ของผล eGFR ที่ยกมา 'YYYY-MM-DD' */
  egfrDate: string | null
  /** รหัสในทะเบียน CKD ที่ผู้ป่วยเคยถูกวินิจฉัย (ก่อนหรือในวันที่มา) */
  ckdCodes: string[]
  /** ชื่อยา NSAIDs ที่ได้รับในครั้งนั้น */
  drugs: string[]
}

export type CkdNsaidReport = {
  cases: CkdNsaidCase[]
  /** ครั้งที่มารับบริการของผู้ป่วย CKD ระดับ 3 ขึ้นไปทั้งหมด — ตัวหารแบบนับครั้ง */
  denominatorVisits: number
  /** จำนวนผู้ป่วย (HN) ในตัวหาร — ตัวหารตามนิยามของตัวชี้วัด */
  denominatorPatients: number
  /** จำนวนผู้ป่วย (HN) ที่ได้รับ NSAIDs อย่างน้อยหนึ่งครั้ง — ตัวตั้ง */
  casePatients: number
  /** จำนวนรหัสในทะเบียน CKD — 0 = ตัวหารมาจากผล eGFR อย่างเดียว */
  diagnosisCodes: number
  /** จำนวนรายการยาในทะเบียน NSAIDs — 0 = รายงานจะว่างเสมอ */
  drugItems: number
  /** icode ของยาในทะเบียน ใช้ไฮไลต์บรรทัดยาตอนเปิดดูรายละเอียดครั้งนั้น */
  drugIcodes: string[]
  /** เส้นแบ่ง eGFR ที่ใช้ */
  egfrThreshold: number
  /** ถึงเพดานจำนวนเคสแล้วหรือยัง */
  truncated: boolean
}

/**
 * ผู้ป่วยนอกที่เป็นโรคไตเรื้อรังระดับ 3 ขึ้นไป และได้รับยา NSAIDs ในช่วงที่เลือก
 *
 * แบ่งเป็นสองคิวรีโดยตั้งใจ เพราะตัวหารกับตัวตั้งต่างกันเป็นร้อยเท่า —
 * ตัวหารทั้งปีมีแสนกว่าครั้ง ส่วนตัวตั้งมีสองพันกว่าเคส ถ้าดึงตัวหารมาทั้งชุด
 * เพื่อจะกรองในเบราว์เซอร์ก็เท่ากับขนข้อมูลผู้ป่วยมาโดยไม่ได้ใช้ ตัวหารจึงนับ
 * ที่ฐานแล้วส่งมาแต่ตัวเลข ส่วนรายละเอียดรายเคสส่งเฉพาะเคสที่ต้องทบทวนจริง
 *
 * คิวรีเคสไล่จาก opitemrece เข้ามา ไม่ได้ไล่จาก vn_stat ออกไป — การสั่ง NSAIDs
 * เป็นเหตุการณ์ที่หายาก การเริ่มจากฝั่งที่แคบกว่าแล้วค่อยขยายทำให้ทั้งปีใช้เวลา
 * ราวหกวินาที ส่วนการเริ่มจาก vn_stat แล้วถาม EXISTS ทีละครั้งใช้เวลาสามสิบวินาที
 */
export async function loadCkdNsaidReport(input: {
  from: string
  to: string
}): Promise<CkdNsaidReport> {
  const dxTable = sql.raw(diagnosisTable('ckd'))
  const rxTable = sql.raw(drugTable('nsaid'))
  const egfrCode = labCodes.egfr

  /* ผู้ป่วยที่เคยถูกลงรหัสในทะเบียน พร้อมวันแรกที่ถูกลง
     ต้องมี since ไว้เทียบกับวันที่มารับบริการ ไม่งั้นครั้งที่มาก่อนจะเป็นโรค
     จะถูกนับเข้าตัวหารด้วย ซึ่งไม่ใช่สิ่งที่ตัวชี้วัดถาม */
  const diagnosedPatients = sql`
    SELECT d.hn, MIN(d.vstdate) AS since
      FROM ovstdiag d
      JOIN ${dxTable} r ON r.icd10 = d.icd10
     GROUP BY d.hn`

  /* ผู้ป่วยที่เคยมีผล eGFR ต่ำกว่าเส้นแบ่ง — ใช้เป็นตะแกรงหยาบชั้นแรกเท่านั้น
     ไม่ใช่คำตอบสุดท้าย เพราะยังไม่ได้บอกว่า "ตอนนี้" ยังต่ำอยู่หรือไม่
     มีไว้ตัดผู้ป่วยส่วนใหญ่ออกก่อน คิวรีค่าล่าสุดซึ่งแพงกว่าจะได้ไม่ต้องวิ่งทุกแถว */
  const everLowEgfr = sql`
    SELECT h.hn, MIN(h.order_date) AS since
      FROM lab_head h
      JOIN lab_order o ON o.lab_order_number = h.lab_order_number
     WHERE o.lab_items_code = ${egfrCode}
       AND o.lab_order_result REGEXP ${NUMERIC_RESULT}
       AND CAST(o.lab_order_result AS DECIMAL(10, 2)) < ${CKD_STAGE3_EGFR}
     GROUP BY h.hn`

  /** ค่า eGFR ครั้งล่าสุดก่อนหรือในวันที่มารับบริการของแถวที่กำลังพิจารณา */
  const latestEgfr = sql`
    (SELECT CAST(lo.lab_order_result AS DECIMAL(10, 2))
       FROM lab_head lh
       JOIN lab_order lo ON lo.lab_order_number = lh.lab_order_number
      WHERE lh.hn = v.hn
        AND lo.lab_items_code = ${egfrCode}
        AND lo.lab_order_result REGEXP ${NUMERIC_RESULT}
        AND lh.order_date <= v.vstdate
      ORDER BY lh.order_date DESC
      LIMIT 1)`

  /* เข้าเกณฑ์เมื่อ "เคยลงรหัสไว้" หรือ "ค่าไตล่าสุดยังต่ำอยู่"
     บรรทัดแรกเป็นตะแกรงหยาบ บรรทัดที่สองเป็นเกณฑ์จริง — เขียนแยกกันเพื่อให้
     ฐานตัดแถวส่วนใหญ่ทิ้งด้วยการ join ก่อน แล้วค่อยวิ่งคิวรีย่อยกับที่เหลือ */
  const isCkdStage3 = sql`
    (cd.hn IS NOT NULL OR cl.hn IS NOT NULL)
    AND (cd.hn IS NOT NULL OR ${latestEgfr} < ${CKD_STAGE3_EGFR})`

  const ckdJoins = sql`
    LEFT OUTER JOIN (${diagnosedPatients}) cd ON cd.hn = v.hn AND cd.since <= v.vstdate
    LEFT OUTER JOIN (${everLowEgfr}) cl ON cl.hn = v.hn AND cl.since <= v.vstdate`

  /* ตัวหารต้อง join ovst ด้วยทั้งที่ไม่ได้ใช้ชื่อห้องตรวจ — ใช้แค่คอลัมน์ an
     เพื่อตัดครั้งที่ถูกรับเป็นผู้ป่วยในออกตาม OPD_ONLY (คิวรีเคสมี join นี้อยู่แล้ว
     เพราะต้องใช้ชื่อห้องตรวจกับชื่อแพทย์) */
  const admissionJoin = sql`LEFT OUTER JOIN ovst ov ON ov.vn = v.vn`

  const [registry] = await hisDb.execute(sql`
    SELECT (SELECT COUNT(*) FROM ${dxTable}) AS dx_count,
           (SELECT COUNT(*) FROM ${rxTable}) AS rx_count`)

  const counts = rows(registry)[0] ?? {}
  const diagnosisCodes = Number(counts.dx_count ?? 0)
  const drugItems = Number(counts.rx_count ?? 0)

  const [icodeRows] = await hisDb.execute(sql`SELECT icode FROM ${rxTable}`)
  const drugIcodes = rows(icodeRows)
    .map(row => String(row.icode ?? '').trim())
    .filter(Boolean)

  const [denominator] = await hisDb.execute(sql`
    SELECT COUNT(*) AS visits, COUNT(DISTINCT v.hn) AS patients
    FROM vn_stat v ${ckdJoins} ${admissionJoin}
    WHERE v.vstdate BETWEEN ${input.from} AND ${input.to}
      AND ${OPD_ONLY} AND ${isCkdStage3}`)

  const denomRow = rows(denominator)[0] ?? {}
  const denominatorVisits = Number(denomRow.visits ?? 0)
  const denominatorPatients = Number(denomRow.patients ?? 0)

  // ทะเบียนยาว่าง = ไม่มีเกณฑ์ว่าตัวไหนคือ NSAIDs คิวรีเคสจะได้ศูนย์แถวอยู่แล้ว
  if (drugItems === 0) {
    return {
      cases: [],
      denominatorVisits,
      denominatorPatients,
      casePatients: 0,
      diagnosisCodes,
      drugItems,
      drugIcodes,
      egfrThreshold: CKD_STAGE3_EGFR,
      truncated: false,
    }
  }

  const [result] = await hisDb.execute(sql`
    SELECT v.vn, v.hn,
           DATE_FORMAT(v.vstdate, '%Y-%m-%d') AS vstdate,
           v.age_y, v.sex,
           CONCAT_WS(' ', p.pname, p.fname, p.lname) AS patient_name,
           dep.department AS dep_name, doc.name AS doctor_name,
           GROUP_CONCAT(DISTINCT di.name ORDER BY di.name SEPARATOR ' | ') AS drug_names,
           (SELECT CONCAT(lo.lab_order_result, '@', DATE_FORMAT(lh.order_date, '%Y-%m-%d'))
              FROM lab_head lh
              JOIN lab_order lo ON lo.lab_order_number = lh.lab_order_number
             WHERE lh.hn = v.hn
               AND lo.lab_items_code = ${egfrCode}
               AND lo.lab_order_result REGEXP ${NUMERIC_RESULT}
               AND lh.order_date <= v.vstdate
             ORDER BY lh.order_date DESC
             LIMIT 1) AS egfr_latest,
           (SELECT GROUP_CONCAT(DISTINCT cd.icd10 ORDER BY cd.icd10)
              FROM ovstdiag cd
              JOIN ${dxTable} cr ON cr.icd10 = cd.icd10
             WHERE cd.hn = v.hn AND cd.vstdate <= v.vstdate) AS ckd_codes
    FROM opitemrece o
    JOIN ${rxTable} rx ON rx.icode = o.icode
    JOIN drugitems di ON di.icode = o.icode
    JOIN vn_stat v ON v.vn = o.vn ${ckdJoins}
    LEFT OUTER JOIN patient p ON p.hn = v.hn
    LEFT OUTER JOIN ovst ov ON ov.vn = v.vn
    LEFT OUTER JOIN kskdepartment dep ON dep.depcode = ov.main_dep
    LEFT OUTER JOIN doctor doc ON doc.code = ov.doctor
    WHERE o.vstdate BETWEEN ${input.from} AND ${input.to}
      AND o.qty > ${DISPENSED_QTY}
      AND ${OPD_ONLY} AND ${isCkdStage3}
    GROUP BY v.vn, v.hn, v.vstdate, v.age_y, v.sex, patient_name, dep_name, doctor_name
    ORDER BY v.vstdate DESC, v.vn DESC
    LIMIT ${MAX_CASE_ROWS + 1}`)

  const all = rows(result)

  /* ค่ากับวันที่ของผล eGFR ยัดมาในช่องเดียวคั่นด้วย @ เพราะคิวรีย่อยแบบ
     ORDER BY ... LIMIT 1 คืนได้คอลัมน์เดียว ถ้าแยกเป็นสองช่องต้องเขียนคิวรีย่อย
     ซ้ำสองรอบ ซึ่งแพงเป็นสองเท่าเพื่อข้อมูลชุดเดียวกัน */
  const splitEgfr = (value: unknown): { egfr: number | null; egfrDate: string | null } => {
    const text = str(value)
    if (text == null) return { egfr: null, egfrDate: null }
    const at = text.lastIndexOf('@')
    if (at < 0) return { egfr: num(text), egfrDate: null }
    return { egfr: num(text.slice(0, at)), egfrDate: str(text.slice(at + 1)) }
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

  const cases: CkdNsaidCase[] = all.slice(0, MAX_CASE_ROWS).map(row => ({
    vn: String(row.vn ?? '').trim(),
    hn: String(row.hn ?? '').trim(),
    date: str(row.vstdate),
    patientName: str(row.patient_name) ?? '—',
    ageYears: num(row.age_y),
    sex: str(row.sex),
    department: str(row.dep_name),
    doctor: str(row.doctor_name),
    ...splitEgfr(row.egfr_latest),
    ckdCodes: split(row.ckd_codes, ','),
    drugs: split(row.drug_names, '|'),
  }))

  return {
    cases,
    denominatorVisits,
    denominatorPatients,
    casePatients: new Set(cases.map(item => item.hn)).size,
    diagnosisCodes,
    drugItems,
    drugIcodes,
    egfrThreshold: CKD_STAGE3_EGFR,
    truncated: all.length > MAX_CASE_ROWS,
  }
}
