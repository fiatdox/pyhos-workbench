import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'

/**
 * ทะเบียนเกณฑ์การนับของตัวชี้วัด RDU — รหัสวินิจฉัยและรายการยา
 *
 * ตัวชี้วัดแต่ละข้อต้องรู้ก่อนว่า "นับจากรหัสอะไรบ้าง" ซึ่งไม่มีคอลัมน์ไหนในฐาน HIS
 * บอกไว้ตรง ๆ (atc_code กับ therapeuticgroup ว่างทั้งตาราง ส่วน dosageform บอกแค่
 * รูปแบบยา) คณะกรรมการจึงเลือกเองจากหน้าตั้งค่า แล้วเก็บเป็นรหัสล้วนในตาราง
 * pyhos_* ซึ่งสร้างเพิ่มไว้ในฐาน HIS ไม่ใช่ตารางของ HOSxP
 *
 * ทุกทะเบียนมีโครงเดียวกัน (คอลัมน์เดียว เป็นคีย์หลัก อ้างอิงตารางหลักของ HIS)
 * จึงเขียนเป็นโมดูลเดียวที่รับชื่อทะเบียนเข้ามา แทนที่จะมีไฟล์ซ้ำกันข้อละไฟล์ —
 * ตอนเพิ่มตัวชี้วัดข้อถัดไปจะได้เพิ่มแค่บรรทัดเดียวในตารางรายชื่อข้างล่าง
 */

/* ───────────── รายชื่อทะเบียนที่รู้จัก ─────────────
   ชื่อตารางมาจากค่าคงที่ในไฟล์นี้เท่านั้น ไม่เคยมาจากผู้เรียก — ชื่อตารางเป็น
   identifier ใส่เป็นพารามิเตอร์ของคิวรีไม่ได้ ต้องต่อเป็นข้อความ ถ้ารับชื่อจาก
   ข้างนอกตรง ๆ ก็เท่ากับเปิดช่อง SQL injection */

/** ทะเบียนรายการยา — คอลัมน์ icode อ้างอิง drugitems.icode */
const DRUG_TABLES = {
  /** ยาสูดพ่นคอร์ติโคสเตียรอยด์ (ตัวชี้วัดโรคหืด) */
  inhaler: 'pyhos_inhaler_drug',
  /** ยาปฏิชีวนะที่นับในตัวชี้วัดโรคติดเชื้อทางเดินหายใจส่วนบน */
  'ri-antibiotic': 'pyhos_ri_atb_icode',
  /** ยาต้านฮิสตามีนชนิด non-sedating (รุ่นที่สอง) */
  'nonsedating-antihist': 'pyhos_nonsedating_antihist_icode',
  /** ยาต้านการอักเสบที่ไม่ใช่สเตียรอยด์ (ตัวชี้วัด NSAIDs ในผู้ป่วยโรคไตเรื้อรัง) */
  nsaid: 'pyhos_nsaid_icode',
  /* ตัวชี้วัด RAS blockade ซ้ำซ้อนใช้สองทะเบียนคู่กัน แยกตามกลไกของยา —
     ต้องแยกเพราะคำถามคือ "ได้รับยาที่ออกฤทธิ์ซ้ำทางกันหรือไม่" ไม่ใช่ "ได้รับยา
     ในทะเบียนหรือไม่" เหมือนข้ออื่น (ดู lib/his/rdu-ras-duplicate.ts) */
  /** ยายับยั้งเอนไซม์แปลงแองจิโอเทนซิน (ACE inhibitor) */
  'ras-acei': 'pyhos_ras_acei_icode',
  /** ยาต้านตัวรับแองจิโอเทนซิน II รวม ARNI และยายับยั้งเรนินโดยตรง */
  'ras-arb': 'pyhos_ras_arb_icode',
  /** ยา glibenclamide — ซัลโฟนิลยูเรียที่ออกฤทธิ์ยาว เสี่ยงน้ำตาลต่ำในผู้สูงอายุ */
  glibenclamide: 'pyhos_glibenclamide_icode',
} as const

/**
 * ทะเบียนรหัสวินิจฉัย — คอลัมน์ icd10 อ้างอิง icd101.code
 *
 * chapters คือหมวดที่ยกมาแสดงตั้งต้นในหน้าตั้งค่า (เทียบกับคอลัมน์ code3)
 * ต้องตั้งต่อทะเบียน ไม่ใช่ค่าเดียวทั้งระบบ — ตัวชี้วัด RUA-URI นับรหัสหูชั้นกลาง
 * อักเสบ (H65–H72) รวมอยู่ด้วย 14 รหัส ถ้ายกมาแต่หมวด J คนตั้งค่าจะไม่เห็น
 * รหัสเหล่านั้นเลยจนกว่าจะเดาได้เองว่าต้องพิมพ์ค้น ส่วนโรคอุจจาระร่วงอยู่คนละ
 * บทไปเลย (A00–A09 ลำไส้ติดเชื้อ)
 */
const DIAGNOSIS_TABLES = {
  /** โรคหอบหืด */
  asthma: { table: 'pyhos_asthma_icd10', chapters: [{ from: 'J00', to: 'J99' }] },
  /** โรคติดเชื้อทางเดินหายใจส่วนบนและหลอดลมอักเสบเฉียบพลัน */
  ri: { table: 'pyhos_ri_icd10', chapters: [{ from: 'J00', to: 'J99' }] },
  /** โรคอุจจาระร่วงเฉียบพลัน (ลำไส้ติดเชื้อ A00–A09) */
  ad: { table: 'pyhos_ad_icd10', chapters: [{ from: 'A00', to: 'A09' }] },
  /**
   * บาดแผลสดจากอุบัติเหตุ (การบาดเจ็บ S00–T14)
   *
   * ยกมาทั้งบทการบาดเจ็บ 1,709 รหัส ไม่ได้ยกมาเฉพาะรหัส "แผลเปิด" (S_1 กับ T01
   * ซึ่งมี 106 รหัส) — นิยามของแต่ละโรงพยาบาลไม่เหมือนกัน บางแห่งนับแผลถลอกและ
   * แผลไฟไหม้ด้วย ถ้ากรองมาให้ก่อนคณะกรรมการจะเลือกรหัสที่ต้องการไม่ได้เลย
   */
  apl: { table: 'pyhos_apl_icd10', chapters: [{ from: 'S00', to: 'T14' }] },
  /**
   * โรคไตเรื้อรังระดับ 3 ขึ้นไป — ตัวหารของตัวชี้วัด NSAIDs
   *
   * ยกหมวด N17–N19 มาทั้งหมด ไม่ได้ยกมาแต่ N183–N185 ที่เป็นระยะ 3 ขึ้นไปตรง ๆ
   * เพราะในฐานมี N189 (ไตวายเรื้อรังไม่ระบุระยะ) ใช้อยู่ 774 ครั้งต่อปี ซึ่งคณะกรรมการ
   * ต้องตัดสินเองว่านับหรือไม่นับ
   */
  ckd: { table: 'pyhos_ckd_icd10', chapters: [{ from: 'N17', to: 'N19' }] },
  /** โรคเบาหวาน — ตัวหารของตัวชี้วัด glibenclamide ในผู้สูงอายุ */
  dm: { table: 'pyhos_dm_icd10', chapters: [{ from: 'E10', to: 'E14' }] },
  /** โรคติดเชื้อทางเดินหายใจตามนิยาม RUA-URI (รวมหูชั้นกลางอักเสบ) */
  ruauri: {
    table: 'pyhos_ruauri_icd10',
    chapters: [
      { from: 'J00', to: 'J99' },
      { from: 'H65', to: 'H72' },
    ],
  },
} as const

export type DrugRegistry = keyof typeof DRUG_TABLES
export type DiagnosisRegistry = keyof typeof DIAGNOSIS_TABLES

export const DRUG_REGISTRIES = Object.keys(DRUG_TABLES) as DrugRegistry[]
export const DIAGNOSIS_REGISTRIES = Object.keys(DIAGNOSIS_TABLES) as DiagnosisRegistry[]

export const isDrugRegistry = (value: string): value is DrugRegistry =>
  Object.hasOwn(DRUG_TABLES, value)

export const isDiagnosisRegistry = (value: string): value is DiagnosisRegistry =>
  Object.hasOwn(DIAGNOSIS_TABLES, value)

/** ชื่อตารางของทะเบียน — ใช้ภายในโมดูลนี้และโมดูลรายงานเท่านั้น */
export const drugTable = (kind: DrugRegistry) => DRUG_TABLES[kind]
export const diagnosisTable = (kind: DiagnosisRegistry) => DIAGNOSIS_TABLES[kind].table

/* ───────────── ตัวช่วยร่วม ───────────── */

/** istatus = 'Y' คือยาที่ยังเปิดใช้งาน (ใช้เกณฑ์เดียวกับ lib/his/due.ts) */
const ACTIVE_ITEM_STATUS = 'Y'

/** active_status = 'Y' คือรหัสวินิจฉัยที่ยังใช้ได้ (ในฐานมี 'N' อยู่ 613 จาก 43,825) */
const ACTIVE_CODE_STATUS = 'Y'

/**
 * เงื่อนไขหมวดตั้งต้นของทะเบียนหนึ่ง — ต่อ OR เข้าด้วยกันเมื่อมีหลายช่วง
 *
 * ยกทั้งตารางมาไม่ได้ (43,825 รหัส) จะกลายเป็นข้อมูลหลายเมกะไบต์ต่อการเปิดหน้า
 * หนึ่งครั้ง และ Transfer จะอืดจนพิมพ์ค้นไม่ทัน — หมวด J มีแค่ 294 รหัส
 * ส่วนรหัสนอกหมวดหาได้จากช่องค้นซึ่งค้นถึงทั้งตาราง
 *
 * เทียบกับ code3 ก่อน ถ้าว่างค่อยตัดสามตัวแรกของรหัสเอง — code3 ว่างอยู่ 220 แถว
 * และในนั้นมี N181–N185 (โรคไตเรื้อรังแยกตามระยะ) ซึ่งเป็นรหัสที่ตัวชี้วัด NSAIDs
 * ต้องใช้พอดี ถ้าเทียบแต่ code3 หน้าตั้งค่าจะไม่ยกรหัสเหล่านั้นมาให้เลือกเลย
 * ส่วนแถวที่ code3 มีค่าใช้ค่านั้นตามเดิม เพราะมีอยู่ 430 แถวที่ code3 ไม่ตรงกับ
 * สามตัวแรกของรหัส ซึ่งเป็นการจัดหมวดที่ตั้งใจของตาราง ไม่ใช่ข้อมูลผิด
 */
const chapterFilter = (kind: DiagnosisRegistry) =>
  sql.join(
    DIAGNOSIS_TABLES[kind].chapters.map(
      range => sql`COALESCE(c.code3, LEFT(c.code, 3)) BETWEEN ${range.from} AND ${range.to}`,
    ),
    sql` OR `,
  )

/** จำนวนผลค้นสูงสุดต่อครั้ง — กันคำค้นสั้น ๆ อย่าง 'a' ลากมาทั้งตาราง */
const MAX_SEARCH_RESULTS = 200

const rows = (result: unknown) => result as unknown as Record<string, unknown>[]

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v).trim() || null)

const codeList = (codes: string[]) =>
  sql.join(
    codes.map(code => sql`${code}`),
    sql`, `,
  )

/* ───────────── ทะเบียนรายการยา ───────────── */

/** ยาหนึ่งรายการที่ยกไปเลือกในหน้าตั้งค่า */
export type DrugOption = {
  icode: string
  name: string
  strength: string | null
  units: string | null
  dosageform: string | null
  /** ยังเปิดใช้งานอยู่ใน drugitems หรือไม่ — ของที่ปิดไปแล้วยังค้างอยู่ในทะเบียนได้ */
  active: boolean
}

/**
 * รายการยาทั้งหมดที่ยกไปให้เลือก
 *
 * ไม่ได้กรองด้วย dosageform หรือชื่อยามาให้ก่อน เพราะรูปแบบยาในฐานไม่ได้กรอก
 * ตรงกันทุกแถว — PULMICORT Respules ซึ่งเป็น ICS แท้ ๆ ลงไว้เป็น 'Dilute Solution'
 * ส่วน 'MDI'/'DPI' ก็มียาขยายหลอดลมที่ไม่ใช่ ICS ปนอยู่ กรองมาให้แล้วจะเลือกของที่
 * ต้องการไม่ได้เลยโดยไม่รู้ตัว — ให้หน้าจอค้นจากรายการเต็มแทน (ราว 1,090 รายการ)
 *
 * รวมยาที่ปิดใช้งานไปแล้วด้วย ถ้ามันอยู่ในทะเบียน ไม่งั้นรายการที่เคยเลือกไว้จะ
 * หายไปจากหน้าจอเงียบ ๆ ทั้งที่ยังอยู่ในตารางและยังถูกนับในข้อมูลย้อนหลัง
 */
export async function listDrugCandidates(kind: DrugRegistry): Promise<DrugOption[]> {
  const table = sql.raw(drugTable(kind))
  const [result] = await hisDb.execute(sql`
    SELECT d.icode, d.name, d.strength, d.units, d.dosageform, d.istatus
    FROM drugitems d
    WHERE d.istatus = ${ACTIVE_ITEM_STATUS}
       OR d.icode IN (SELECT r.icode FROM ${table} r)
    ORDER BY d.name`)

  return rows(result).map(row => ({
    icode: String(row.icode ?? '').trim(),
    name: String(row.name ?? '').trim(),
    strength: str(row.strength),
    units: str(row.units),
    dosageform: str(row.dosageform),
    active: String(row.istatus ?? '').trim() === ACTIVE_ITEM_STATUS,
  }))
}

/** รหัสยาที่อยู่ในทะเบียนตอนนี้ */
export async function listRegisteredDrugs(kind: DrugRegistry): Promise<string[]> {
  const table = sql.raw(drugTable(kind))
  const [result] = await hisDb.execute(sql`SELECT icode FROM ${table} ORDER BY icode`)

  return rows(result)
    .map(row => String(row.icode ?? '').trim())
    .filter(Boolean)
}

/**
 * เพิ่มยาเข้าทะเบียน
 *
 * เขียนเป็น INSERT ... SELECT จาก drugitems ไม่ใช่ INSERT VALUES ตรง ๆ —
 * รหัสที่ไม่มีอยู่จริงจะถูกทิ้งไปเองโดยไม่ต้องคิวรีตรวจแยกอีกรอบ (ตารางทะเบียน
 * ไม่มี foreign key ผูกไว้ ถ้าไม่ตรวจก็เก็บรหัสผิดได้เงียบ ๆ แล้วตัวชี้วัดจะนับ
 * ไม่ครบโดยไม่มีใครรู้)
 *
 * INSERT IGNORE กันชนคีย์หลักเมื่อมีคนเพิ่มรหัสเดียวกันไปก่อนแล้ว — กรณีนี้ถือว่า
 * สำเร็จ เพราะผลลัพธ์ที่ผู้ใช้ต้องการ (รหัสนี้อยู่ในทะเบียน) เป็นจริงอยู่แล้ว
 *
 * คืนจำนวนแถวที่เพิ่มได้จริง ซึ่งน้อยกว่าที่ส่งมาได้ถ้ามีรหัสซ้ำหรือรหัสที่ไม่มีในฐาน
 */
export async function addDrugs(kind: DrugRegistry, icodes: string[]): Promise<number> {
  if (icodes.length === 0) return 0

  const table = sql.raw(drugTable(kind))
  const [result] = await hisDb.execute(sql`
    INSERT IGNORE INTO ${table} (icode)
    SELECT d.icode FROM drugitems d WHERE d.icode IN (${codeList(icodes)})`)

  return Number((result as unknown as { affectedRows?: number }).affectedRows ?? 0)
}

/**
 * เอายาออกจากทะเบียน — ลบทั้งชุดในคำสั่งเดียว ไม่วนลบทีละแถว
 *
 * คืนจำนวนแถวที่ถูกลบจริง อาจน้อยกว่าที่ส่งมาถ้ามีคนอื่นเอาออกไปก่อนแล้ว
 */
export async function removeDrugs(kind: DrugRegistry, icodes: string[]): Promise<number> {
  if (icodes.length === 0) return 0

  const table = sql.raw(drugTable(kind))
  const [result] = await hisDb.execute(sql`
    DELETE FROM ${table} WHERE icode IN (${codeList(icodes)})`)

  return Number((result as unknown as { affectedRows?: number }).affectedRows ?? 0)
}

/* ───────────── ทะเบียนรหัสวินิจฉัย ───────────── */

/** รหัสวินิจฉัยหนึ่งรายการที่ยกไปเลือกในหน้าตั้งค่า */
export type Icd10Option = {
  code: string
  /** ชื่อโรคภาษาอังกฤษ — เติมไว้ครบทุกแถวในหมวด J */
  name: string
  /** ชื่อโรคภาษาไทย — ว่างมากกว่าครึ่งของตาราง (185 จาก 294 แถวในหมวด J) */
  tname: string | null
  /** ยังใช้ได้อยู่หรือไม่ — รหัสที่ถูกยกเลิกยังค้างอยู่ในทะเบียนได้ */
  active: boolean
}

/**
 * รหัสวินิจฉัยที่ยกไปให้เลือก
 *
 * ไม่มีคำค้น = หมวดโรคระบบหายใจ, มีคำค้น = ค้นทั้งตารางแบบจำกัดจำนวนผล
 * ค้นได้ทั้งรหัส ชื่ออังกฤษ และชื่อไทย — คำว่า 'หอบหืด' หารหัสท้องถิ่นเจอ
 * ส่วนคำว่า 'asthma' หารหัสมาตรฐานเจอ คนละชุดกัน จึงต้องค้นทั้งสองคอลัมน์
 *
 * ฝั่งรหัสค้นแบบขึ้นต้น ไม่ใช่ LIKE '%...%' — รหัสเป็นลำดับชั้น การพิมพ์ J45
 * หมายถึงอยากได้รหัสในกลุ่ม J45 ไม่ใช่รหัสที่มี J45 อยู่ตรงกลาง
 *
 * รวมรหัสที่อยู่ในทะเบียนแล้วเข้ามาด้วยเสมอ แม้จะไม่เข้าเงื่อนไขค้นหรือถูกยกเลิกไป
 * — ถ้าไม่รวม ช่องขวาของ Transfer จะว่างเปล่าทั้งที่ทะเบียนมีข้อมูลอยู่
 */
export async function listIcd10Candidates(
  kind: DiagnosisRegistry,
  keyword: string,
): Promise<Icd10Option[]> {
  const table = sql.raw(diagnosisTable(kind))
  const search = keyword.trim()

  const [result] = await hisDb.execute(
    search === ''
      ? sql`
        SELECT c.code, c.name, c.tname, c.active_status
        FROM icd101 c
        WHERE (c.active_status = ${ACTIVE_CODE_STATUS} AND (${chapterFilter(kind)}))
           OR c.code IN (SELECT r.icd10 FROM ${table} r)
        ORDER BY c.code`
      : sql`
        SELECT c.code, c.name, c.tname, c.active_status
        FROM icd101 c
        WHERE (c.active_status = ${ACTIVE_CODE_STATUS}
               AND (c.code LIKE ${`${search}%`}
                    OR c.name LIKE ${`%${search}%`}
                    OR c.tname LIKE ${`%${search}%`}))
           OR c.code IN (SELECT r.icd10 FROM ${table} r)
        ORDER BY c.code
        LIMIT ${MAX_SEARCH_RESULTS}`,
  )

  return rows(result).map(row => ({
    code: String(row.code ?? '').trim(),
    name: String(row.name ?? '').trim(),
    // ชื่อไทยในฐานมีช่องว่างต่อท้ายหลายแถว ('โรคหอบหืด   ') ตัดทิ้งก่อนส่งออกไป
    tname: str(row.tname),
    active: String(row.active_status ?? '').trim() === ACTIVE_CODE_STATUS,
  }))
}

/** รหัสวินิจฉัยที่อยู่ในทะเบียนตอนนี้ */
export async function listRegisteredIcd10(kind: DiagnosisRegistry): Promise<string[]> {
  const table = sql.raw(diagnosisTable(kind))
  const [result] = await hisDb.execute(sql`SELECT icd10 FROM ${table} ORDER BY icd10`)

  return rows(result)
    .map(row => String(row.icd10 ?? '').trim())
    .filter(Boolean)
}

/** เพิ่มรหัสวินิจฉัยเข้าทะเบียน — เหตุผลของ INSERT ... SELECT ดูที่ addDrugs */
export async function addIcd10(kind: DiagnosisRegistry, codes: string[]): Promise<number> {
  if (codes.length === 0) return 0

  const table = sql.raw(diagnosisTable(kind))
  const [result] = await hisDb.execute(sql`
    INSERT IGNORE INTO ${table} (icd10)
    SELECT c.code FROM icd101 c WHERE c.code IN (${codeList(codes)})`)

  return Number((result as unknown as { affectedRows?: number }).affectedRows ?? 0)
}

/** เอารหัสวินิจฉัยออกจากทะเบียน */
export async function removeIcd10(kind: DiagnosisRegistry, codes: string[]): Promise<number> {
  if (codes.length === 0) return 0

  const table = sql.raw(diagnosisTable(kind))
  const [result] = await hisDb.execute(sql`
    DELETE FROM ${table} WHERE icd10 IN (${codeList(codes)})`)

  return Number((result as unknown as { affectedRows?: number }).affectedRows ?? 0)
}
