import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'
import { labCodes } from '@/lib/his/lab-codes'
import { countLabCultures } from '@/lib/his/lab-culture'
import { loadAllergies, type DrugAllergy } from '@/lib/his/medication-history'
import { getPatientConditions, type PatientCondition } from '@/lib/his/conditions'

export type { DrugAllergy, PatientCondition }

/**
 * DUE — ข้อมูลผู้ป่วยสำหรับหน้าสั่งยา
 *
 * ขั้นนี้ทำแค่ส่วนกรอก HN แล้วดึงข้อมูลผู้ป่วยมาแสดง ยังไม่มีการบันทึกคำขอ
 *
 * "ประเภทผู้ป่วย" ดูจากการมารับบริการครั้งล่าสุด เทียบระหว่างการนอนโรงพยาบาล
 * ครั้งล่าสุด (ipt) กับการมาตรวจผู้ป่วยนอกครั้งล่าสุด (ovst) ว่าอันไหนใหม่กว่า
 * ถ้ายังนอนอยู่ตอนนี้ถือเป็น IPD ทันทีโดยไม่ต้องเทียบ
 *
 * ovst ของการ admit จะมี an ผูกไว้ด้วย จึงต้องกรอง an IS NULL ออก
 * ไม่งั้นวันที่ admit จะถูกนับเป็นการมาตรวจผู้ป่วยนอกไปด้วย
 *
 * ทั้งสองคิวรีตัดวันที่ในอนาคตทิ้ง — ovst มีแถวปีเพี้ยนอยู่ 2 แถวจาก 7.48 ล้าน
 * (ปี 2115 กับวันในอนาคต) น้อยมากก็จริง แต่ ORDER BY วันที่ DESC จะดึงแถวเพี้ยน
 * ขึ้นมาเป็นอันดับแรกของผู้ป่วยรายนั้นเสมอ ทำให้ประเภทผู้ป่วยผิดไปทั้งหน้า
 */

/**
 * รหัสรายการแล็บของ Creatinine กับ eGFR อ่านจาก .env (ดู lib/his/lab-codes.ts)
 *
 * ในฐานมีรายการที่ชื่อคล้าย Creatinine อีกหลายตัว (Urine Creatinine,
 * Creatinine(fluid), Creatinine(DM)/eGFR ฯลฯ) ซึ่งคนละอย่างกัน จึงยึดรหัสเดียว
 * ตามที่ตกลงไว้ ไม่ได้ค้นจากชื่อรายการ
 *
 * eGFR เป็นคนละรายการแต่ห้องแล็บออกผลมาในใบเดียวกันเสมอ — ตรวจย้อนหลัง 30 วัน
 * ใบที่มี Creatinine จำนวน 6,563 ใบ มี eGFR อยู่ด้วยครบทุกใบ จึงดึงพร้อมกัน
 * จาก lab_order_number เดียวกันได้ ไม่ต้องคิวรีแยก
 */
const LAB_ITEM_CREATININE = labCodes.creatinine
const LAB_ITEM_EGFR = labCodes.egfr

/**
 * ยาที่ต้องขออนุมัติ DUE — ดูจากป้าย [DUE] ในชื่อยา
 *
 * ต้องเป็นคำเดี่ยวในวงเล็บเหลี่ยม ไม่ใช่แค่ค้นคำว่า DUE ในชื่อ เพราะจะไปโดน
 * ยาชื่อ CADUET (Amlodipine+Atorvastatin) เข้าด้วย 2 รายการ
 *
 * และต้องไม่ใช่ '%[DUE]%' ตรง ๆ เพราะบางรายการมีป้ายอื่นอยู่ในวงเล็บเดียวกัน
 * เช่น [เบิกได้,DUE] และ [สปสช,DUE] ของ Ceftazidime+Avibactam ซึ่งจะตกหล่นไป
 * — เขียนแบบ regexp ได้ 52 รายการ, แบบ '%[DUE]%' ได้ 50, แบบค้นหลวม ๆ ได้ 54
 */
const DUE_NAME_PATTERN = '\\[[^]]*\\bDUE\\b[^]]*\\]'

/**
 * istatus = 'Y' คือยาที่ยังเปิดใช้งาน
 *
 * ยืนยันจากการสั่งใช้จริง: ยา [DUE] ที่ istatus='Y' มี 20 รายการ ในนั้นถูกสั่งใช้
 * ในรอบ 1 ปี 19 รายการ ส่วนที่ istatus='N' มี 30 รายการ ไม่ถูกสั่งเลยสักรายการ
 */
const ACTIVE_ITEM_STATUS = 'Y'

/** ยาหนึ่งรายการในกลุ่ม DUE */
export type DueDrug = {
  icode: string
  name: string
  strength: string | null
  units: string | null
}

/**
 * ยาต้านจุลชีพ = ยาในบทที่ 5 (Infections) ของการจัดกลุ่มแบบ BNF ในตาราง
 * pharmacology_group ยกเว้น 5.6 Antiseptics ซึ่งเป็นน้ำยาฆ่าเชื้อภายนอก
 * ไม่ใช่ยาที่ผู้ป่วย "ได้รับ" ในความหมายของใบคำขอนี้ (รวม 20 กลุ่ม)
 *
 * ใช้ pharmacology_group1 ของ drugitems ซึ่งเติมไว้ 1,052 จาก 1,089 รายการ
 * ที่ยังเปิดใช้งาน (96.6%) ส่วน atc_code กับ therapeuticgroup ว่างทั้งตาราง
 * ใช้ไม่ได้เลย
 *
 * ตรวจความถูกต้องจากยา [DUE] ที่เปิดใช้งาน 22 รายการ — ยาต้านจุลชีพ 15 รายการ
 * เข้ากลุ่ม '5 Infections' ครบทุกตัว ส่วน PRADAXA, FORXIGA, ARICEPT, Albumin,
 * Esomeprazole, Teriparatide, Poractant ไปอยู่กลุ่มอื่นตามที่ควรเป็น
 */
const ANTIMICROBIAL_GROUPS = sql`
  SELECT g.pharmacology_group_id FROM pharmacology_group g
  WHERE g.pharmacology_group_name LIKE '5%'
    AND g.pharmacology_group_name NOT LIKE '5.6%'`

/** ย้อนหลังไม่เกินเท่านี้ — ประวัติยาต้านที่เก่ากว่านี้ไม่มีผลต่อการเลือกยาครั้งนี้ */
const PRIOR_ABX_DAYS = 365

/** จำนวนรายการยาต้านสูงสุดที่ดึงมา */
const MAX_PRIOR_ABX = 40

/** ยาต้านจุลชีพที่ผู้ป่วยเคยได้รับ (สรุปเป็นรายตัวยา ไม่ใช่รายครั้ง) */
export type PriorAntimicrobial = {
  icode: string
  name: string
  /** วันแรกที่ได้รับ 'YYYY-MM-DD' */
  firstDay: string | null
  /** วันล่าสุดที่ได้รับ */
  lastDay: string | null
  /** จำนวนวันที่มีการจ่ายยาตัวนี้ (นับวันที่ไม่ซ้ำ) */
  days: number
  /** จ่ายระหว่างนอนโรงพยาบาล */
  inpatient: boolean
}

/**
 * ขอบเขตน้ำหนักที่ยอมรับ (กก.) — opdscreen มีค่าที่กรอกผิดปนอยู่
 *
 * ด้านบน: รอบ 3 เดือนมี bw > 200 อยู่ 74 แถว ในนั้นเป็นเลข 500 ถ้วน 58 แถว
 * (ค่าที่ถูกกรอกซ้ำ ๆ แบบไม่ตั้งใจ) และมีสุดโต่งถึง 1,508 กก.
 *
 * ด้านล่าง: bw ต่ำกว่า 2 กก. มี 13 แถว อายุเฉลี่ย 15.6 ปี — เป็นการกรอกผิดชัดเจน
 * ส่วนช่วง 2–20 กก. อายุเฉลี่ย 2.0 และ 3.7 ปี คือเด็กจริง จึงต้องรับไว้
 */
const MIN_WEIGHT_KG = 2
const MAX_WEIGHT_KG = 250

/** น้ำหนักจากการคัดกรองครั้งล่าสุด ใช้คำนวณ CrCl */
export type ScreenWeight = {
  /** วันที่ชั่ง 'YYYY-MM-DD' */
  date: string | null
  /** กิโลกรัม */
  bw: number
  /** เซนติเมตร — ไม่ได้ใช้ใน Cockcroft-Gault แต่ติดมาให้เห็นบริบท */
  height: number | null
}

/** ผลค่าไตครั้งล่าสุดของผู้ป่วย */
export type CreatinineResult = {
  /** วันที่สั่งเจาะ 'YYYY-MM-DD' */
  orderDate: string | null
  /** วันที่รายงานผล 'YYYY-MM-DD' */
  reportDate: string | null
  /** ค่า Creatinine (mg/dL) — เก็บเป็นข้อความตามที่ห้องแล็บบันทึก ไม่แปลงเป็นตัวเลข */
  cr: string
  /** eGFR ของใบเดียวกัน — อาจไม่มีในใบเก่า */
  egfr: string | null
}

export type DuePatient = {
  hn: string
  name: string
  age: number | null
  /** '1' = ชาย, '2' = หญิง ตามรหัสของ HIS */
  sex: string | null
  visitType: 'IPD' | 'OPD'
  /** วันที่ของการมารับบริการครั้งที่ใช้ตัดสินประเภท */
  visitDate: string | null
  /** ยังนอนโรงพยาบาลอยู่ตอนนี้ (เฉพาะ IPD) */
  admitted: boolean
  /** AN ของการนอนครั้งล่าสุด — มีเมื่อ visitType เป็น IPD */
  an: string | null
  /** ชื่อหอผู้ป่วย — มีเมื่อ visitType เป็น IPD */
  wardName: string | null
  /** ชื่อห้องตรวจ — มีเมื่อ visitType เป็น OPD */
  departmentName: string | null
  /** ผลค่าไตครั้งล่าสุด — null เมื่อยังไม่เคยเจาะหรือยังไม่รายงานผล */
  creatinine: CreatinineResult | null
  /** น้ำหนักที่ชั่งครั้งล่าสุด — null เมื่อไม่เคยชั่งหรือค่าที่มีอยู่นอกช่วงที่รับได้ */
  weight: ScreenWeight | null
  /** จำนวนใบรายงานผลเพาะเชื้อ — 0 แปลว่าไม่ต้องขึ้นปุ่มให้กด */
  labCultureCount: number
  /** ประวัติแพ้ยาทั้งหมด — ไม่จำกัดช่วงเวลา เพราะการแพ้ยาไม่หมดอายุ */
  allergies: DrugAllergy[]
  /** กลุ่มโรคสำคัญจากรหัส ICD-10 ที่เคยได้รับการวินิจฉัย */
  conditions: PatientCondition[]
  /** ยาต้านจุลชีพที่เคยได้รับในรอบ 1 ปี */
  priorAntimicrobials: PriorAntimicrobial[]
}

type Row = Record<string, unknown>

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v).trim() || null)

const rows = (result: unknown): Row[] => result as unknown as Row[]

/**
 * รายการยากลุ่ม DUE ทั้งหมดที่ยังเปิดใช้งาน — ใช้เป็นตัวเลือกในใบคำขอ
 *
 * รายการนี้ไม่ได้มีแต่ยาต้านจุลชีพ ยังมี Human Albumin, SMOFKABIVEN, Poractant,
 * Esomeprazole, FORXIGA, PRADAXA, Teriparatide และ ARICEPT ปนอยู่ด้วย
 * เพราะโรงพยาบาลใช้ป้าย [DUE] กับยาที่ต้องขออนุมัติทุกกลุ่ม ไม่เฉพาะยาต้านจุลชีพ
 */
export async function listDueDrugs(): Promise<DueDrug[]> {
  const [result] = await hisDb.execute(sql`
    SELECT d.icode, d.name, d.strength, d.units
    FROM drugitems d
    WHERE d.name REGEXP ${DUE_NAME_PATTERN}
      AND d.istatus = ${ACTIVE_ITEM_STATUS}
    ORDER BY d.name`)

  return rows(result).map(row => ({
    icode: String(row.icode ?? '').trim(),
    name: String(row.name ?? '').trim(),
    strength: str(row.strength),
    units: str(row.units),
  }))
}

/**
 * ค่าไตครั้งล่าสุด — เอาใบที่สั่งเจาะล่าสุดที่ "มีผลออกแล้ว"
 *
 * ใบที่ยังไม่รายงานผลมี lab_order_result เป็น NULL (ในรอบ 3 เดือนมี 242 ใบ
 * จาก 19,488 ใบ) ถ้าไม่กรองออก ใบที่เพิ่งสั่งเช้านี้จะบังผลจริงของเมื่อวาน
 * แล้วหน้าจอจะขึ้นช่องว่างทั้งที่มีค่าเดิมอยู่
 *
 * ค่าที่รายงานแล้วเป็นตัวเลขล้วนทั้งหมด (19,246 จาก 19,246 ใบ) ไม่มีข้อความ
 * แบบ 'no specimen' ปนมา จึงส่งต่อเป็นข้อความตามที่บันทึกไว้ได้เลย
 */
async function getLatestCreatinine(hn: string): Promise<CreatinineResult | null> {
  const [result] = await hisDb.execute(sql`
    SELECT DATE_FORMAT(h.order_date, '%Y-%m-%d') AS order_date,
           DATE_FORMAT(h.report_date, '%Y-%m-%d') AS report_date,
           MAX(CASE WHEN o.lab_items_code = ${LAB_ITEM_CREATININE} THEN o.lab_order_result END) AS cr,
           MAX(CASE WHEN o.lab_items_code = ${LAB_ITEM_EGFR} THEN o.lab_order_result END) AS egfr
    FROM lab_head h
    JOIN lab_order o ON o.lab_order_number = h.lab_order_number
    WHERE h.hn = ${hn}
      AND o.lab_items_code IN (${LAB_ITEM_CREATININE}, ${LAB_ITEM_EGFR})
      AND o.lab_order_result IS NOT NULL
      AND o.lab_order_result <> ''
      AND h.order_date <= CURDATE()
    GROUP BY h.lab_order_number, h.order_date, h.report_date
    HAVING cr IS NOT NULL
    ORDER BY h.order_date DESC, h.lab_order_number DESC
    LIMIT 1`)

  const row = rows(result)[0]
  const cr = row ? str(row.cr) : null
  if (!cr) return null

  return {
    orderDate: str(row.order_date),
    reportDate: str(row.report_date),
    cr,
    egfr: str(row.egfr),
  }
}

/**
 * ยาต้านจุลชีพที่ผู้ป่วยเคยได้รับในรอบ 1 ปี
 *
 * อ่านจาก opitemrece ซึ่งเป็นรายการ "จ่ายจริง" ไม่ใช่ medplan_ipd ที่เป็น "คำสั่ง"
 * — คำถามในใบคำขอถามว่าได้รับยามาก่อนหรือไม่ คำสั่งที่สั่งแล้วไม่ได้จ่ายจึงไม่นับ
 * และ opitemrece ครอบคลุมทั้งผู้ป่วยนอกและผู้ป่วยใน จึงไม่ต้องรวมสองตาราง
 * แล้วมานั่งกันข้อมูลซ้ำกันเอง (ยา IPD ตัวเดียวปรากฏทั้งสองที่)
 *
 * qty > 0 คัดแถวที่สั่งแล้วยกเลิกออก — ในตัวอย่างที่ตรวจมีแถว qty = 0 ปนอยู่จริง
 *
 * สรุปเป็นรายตัวยา ไม่ใช่รายครั้ง เพราะช่องในใบคำขอถามแค่ชื่อยา วันที่เริ่ม
 * และจำนวนวันที่ได้ — นับวันด้วย COUNT(DISTINCT vstdate) ไม่ใช่ผลต่างของวันแรก
 * กับวันสุดท้าย เพราะการให้ยาอาจไม่ต่อเนื่องกัน
 */
async function listPriorAntimicrobials(hn: string): Promise<PriorAntimicrobial[]> {
  const [result] = await hisDb.execute(sql`
    SELECT o.icode,
           CONCAT(s.name, ' ', s.strength, ' ', s.units) AS drug_name,
           DATE_FORMAT(MIN(o.vstdate), '%Y-%m-%d') AS first_day,
           DATE_FORMAT(MAX(o.vstdate), '%Y-%m-%d') AS last_day,
           COUNT(DISTINCT o.vstdate) AS days,
           MAX(o.an IS NOT NULL AND o.an <> '') AS has_an
    FROM opitemrece o
    JOIN drugitems d ON d.icode = o.icode
    LEFT OUTER JOIN s_drugitems s ON s.icode = o.icode
    WHERE o.hn = ${hn}
      AND d.pharmacology_group1 IN (${ANTIMICROBIAL_GROUPS})
      AND o.qty > 0
      AND o.vstdate BETWEEN DATE_SUB(CURDATE(), INTERVAL ${PRIOR_ABX_DAYS} DAY) AND CURDATE()
    GROUP BY o.icode, drug_name
    ORDER BY last_day DESC, days DESC
    LIMIT ${MAX_PRIOR_ABX}`)

  return rows(result).map(row => ({
    icode: String(row.icode ?? '').trim(),
    name: String(row.drug_name ?? '').trim(),
    firstDay: str(row.first_day),
    lastDay: str(row.last_day),
    days: Number(row.days ?? 0),
    inpatient: Number(row.has_an ?? 0) === 1,
  }))
}

/**
 * น้ำหนักที่ชั่งครั้งล่าสุดจากใบคัดกรอง (opdscreen) ใช้เป็นตัวตั้งของ Cockcroft-Gault
 *
 * ใช้ opdscreen แทน ipt.bw เพราะ ipt.bw กรอกไว้แค่ 28% ส่วน opdscreen ครอบคลุมกว่ามาก
 * — ผู้ป่วยที่มีผล Creatinine ในรอบ 7 วัน 1,296 คน มีน้ำหนักในรอบ 2 ปีอยู่ 1,191 คน (92%)
 *
 * ไม่ได้จำกัดว่าต้องเป็นน้ำหนักของ visit เดียวกับที่เจาะเลือด เพราะจะตกไปเยอะ
 * — ส่งวันที่ชั่งกลับไปด้วย ให้หน้าจอแสดงให้เภสัชกรตัดสินเองว่าเก่าเกินไปไหม
 */
async function getLatestWeight(hn: string): Promise<ScreenWeight | null> {
  const [result] = await hisDb.execute(sql`
    SELECT DATE_FORMAT(s.vstdate, '%Y-%m-%d') AS vstdate, s.bw, s.height
    FROM opdscreen s
    WHERE s.hn = ${hn}
      AND s.bw BETWEEN ${MIN_WEIGHT_KG} AND ${MAX_WEIGHT_KG}
      AND s.vstdate <= CURDATE()
    ORDER BY s.vstdate DESC, s.vsttime DESC
    LIMIT 1`)

  const row = rows(result)[0]
  if (!row || row.bw == null) return null

  const height = row.height == null ? null : Number(row.height)
  return {
    date: str(row.vstdate),
    bw: Number(row.bw),
    // ส่วนสูง 0 ในฐานแปลว่า "ไม่ได้วัด" ไม่ใช่ศูนย์เซนติเมตร
    height: height && height > 0 ? height : null,
  }
}

export async function getDuePatient(hn: string): Promise<DuePatient | null> {
  const [patientResult] = await hisDb.execute(sql`
    SELECT CONCAT(p.pname, p.fname, ' ', p.lname) AS ptname,
           TIMESTAMPDIFF(YEAR, p.birthday, CURDATE()) AS age,
           p.sex
    FROM patient p
    WHERE p.hn = ${hn}
    LIMIT 1`)

  const patient = rows(patientResult)[0]
  if (!patient) return null

  // ดึงคู่ขนาน — ทุกคิวรีในชุดนี้ไม่ได้พึ่งผลของกันและกัน
  const [
    [admissionResult],
    [visitResult],
    creatinine,
    weight,
    labCultureCount,
    allergies,
    conditions,
    priorAntimicrobials,
  ] = await Promise.all([
    hisDb.execute(sql`
      SELECT i.an, i.ward, w.name AS ward_name,
             DATE_FORMAT(i.regdate, '%Y-%m-%d') AS regdate,
             (i.dchdate IS NULL AND (i.dchstts IS NULL OR i.dchstts = '')) AS still_here
      FROM ipt i
      LEFT OUTER JOIN ward w ON w.ward = i.ward
      WHERE i.hn = ${hn} AND i.regdate <= CURDATE()
      ORDER BY i.regdate DESC, i.an DESC
      LIMIT 1`),
    hisDb.execute(sql`
      SELECT DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS vstdate,
             dep.department
      FROM ovst o
      LEFT OUTER JOIN kskdepartment dep ON dep.depcode = o.main_dep
      WHERE o.hn = ${hn} AND o.an IS NULL AND o.vstdate <= CURDATE()
      ORDER BY o.vstdate DESC, o.vn DESC
      LIMIT 1`),
    getLatestCreatinine(hn),
    getLatestWeight(hn),
    countLabCultures(hn),
    loadAllergies(hn),
    getPatientConditions(hn),
    listPriorAntimicrobials(hn),
  ])

  const admission = rows(admissionResult)[0]
  const visit = rows(visitResult)[0]

  const admitDate = admission ? str(admission.regdate) : null
  const visitDate = visit ? str(visit.vstdate) : null
  const admitted = Number(admission?.still_here ?? 0) === 1

  // ยังนอนอยู่ = IPD แน่นอน ไม่ต้องเทียบวัน
  // ไม่งั้นเทียบว่าอันไหนใหม่กว่า — วันเดียวกันให้ IPD ชนะ เพราะการ admit
  // เกิดต่อจากการมาตรวจในวันนั้น จึงเป็นสถานะที่ใหม่กว่า
  const useIpd =
    admitted || (admitDate != null && (visitDate == null || admitDate >= visitDate))

  const base = {
    hn,
    name: String(patient.ptname ?? '').trim(),
    age: patient.age == null ? null : Number(patient.age),
    sex: str(patient.sex),
    creatinine,
    weight,
    labCultureCount,
    allergies,
    conditions,
    priorAntimicrobials,
  }

  if (useIpd && admission) {
    return {
      ...base,
      visitType: 'IPD',
      visitDate: admitDate,
      admitted,
      an: str(admission.an),
      wardName: str(admission.ward_name),
      departmentName: null,
    }
  }

  return {
    ...base,
    visitType: 'OPD',
    visitDate,
    admitted: false,
    an: null,
    wardName: null,
    departmentName: visit ? str(visit.department) : null,
  }
}
