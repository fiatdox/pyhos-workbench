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
  /**
   * ยาปฏิชีวนะที่นับในตัวชี้วัดบาดแผลสดจากอุบัติเหตุ
   *
   * แยกทะเบียนของตัวเอง ไม่ได้ใช้ธง drugitems.antibiotic เหมือนข้อ AD —
   * เภสัชกรขอปรับชุดยาของข้อนี้เอง เพราะคำถามของแต่ละข้อไม่เหมือนกัน:
   * แผลสดถามถึงยาที่ให้เพื่อป้องกันการติดเชื้อที่แผล ซึ่งเป็นชุดที่แคบกว่า
   * "ยาปฏิชีวนะทุกตัวในโรงพยาบาล" ที่ธงนั้นติดไว้ (249 รายการ)
   *
   * ใส่ไว้ตั้งต้นครบทั้ง 249 รายการตามธงเดิม ตัวเลขย้อนหลังจึงไม่ขยับในวันที่
   * เปลี่ยนมาใช้ทะเบียน — จากนั้นเภสัชกรค่อยตัดออกทีละตัวตามที่ตกลงกัน
   *
   * แยกจากทะเบียนของข้อ RI ด้วย ทั้งที่เป็นยาปฏิชีวนะเหมือนกัน — สองข้อนี้
   * คนละนิยาม ถ้ามัดเป็นทะเบียนเดียว วันที่ข้อหนึ่งตัดยาออก อีกข้อจะเปลี่ยน
   * ตามไปเงียบ ๆ ทั้งที่ไม่มีใครสั่ง (เหตุผลเดียวกับที่เกณฑ์อายุแยกต่อข้อ)
   */
  'apl-antibiotic': 'pyhos_apl_atb_icode',
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
  /* ตัวชี้วัดการใช้ metformin ใช้ทะเบียนนี้เป็น "ตัวหาร" ไม่ใช่ตัวตั้งเหมือนข้ออื่น
     ส่วนตัวตั้ง (ยาที่มี metformin) ไม่ต้องมีทะเบียน เพราะหาจาก drugitems.generic_name
     ได้ตรง ๆ (ดู METFORMIN_GENERIC ใน lib/his/rdu-metformin.ts) */
  /** ยาลดระดับน้ำตาลในเลือดทุกกลุ่ม รวมอินซูลิน — ตัวหารของตัวชี้วัด metformin */
  antidiabetic: 'pyhos_antidiabetic_icode',
  /**
   * ยา benzodiazepine ที่ออกฤทธิ์ยาว (ตัวชี้วัดการใช้ยาในผู้ป่วยนอกสูงอายุ)
   *
   * ต้องเป็นทะเบียนที่ตั้งเอง แยกด้วยชื่อสามัญไม่ได้เหมือนข้อ metformin — เส้นแบ่ง
   * คือค่าครึ่งชีวิตของยา ซึ่งไม่มีคอลัมน์ไหนในฐานบอก (clonazepam กับ lorazepam
   * ชื่อลงท้ายเหมือนกันแต่คนละฝั่งของเส้น)
   */
  'long-acting-benzo': 'pyhos_long_acting_benzo_icode',
  /**
   * ยาที่ห้ามใช้ในสตรีตั้งครรภ์ — warfarin, statins, ergots
   *
   * ต้องเป็นทะเบียนที่ตั้งเอง ทั้งที่ฐานมีคอลัมน์ drugitems.pregnancy เก็บหมวด
   * ความเสี่ยงต่อการตั้งครรภ์ไว้แล้ว เพราะคอลัมน์นั้นเชื่อไม่ได้สองชั้น:
   * กรอกไม่ครบ (ยาที่เปิดใช้งาน 1,092 รายการ มีค่าแค่ 233) และไม่สม่ำเสมอ
   * — atorvastatin รหัสที่ใช้อยู่ตอนนี้เป็นค่าว่าง ส่วนรหัสเก่าของยาตัวเดียวกัน
   * ติดหมวด X ไว้ ถ้านับตามคอลัมน์นี้ ยาตัวเดียวกันจะถูกนับบ้างไม่ถูกนับบ้าง
   *
   * และหมวด D/X ก็ไม่ใช่คำตอบอยู่ดีถึงจะกรอกครบ — ที่ติดหมวด X ไว้มี oxytocin
   * กับ misoprostol ซึ่งเป็นยาที่ใช้ "ตอนคลอด" ไม่ใช่ยาที่ห้ามใช้ขณะตั้งครรภ์
   *
   * ส่วนชื่อสามัญก็แยกไม่ได้เหมือนข้อ metformin เพราะคำว่า statin ไปตรงกับ
   * NYSTATIN, IMIPENEM+CILASTATIN, SOMATOSTATIN ส่วน ergo ไปตรงกับ
   * ERGOCALCIFEROL (วิตามินดี) และ NICERGOLINE
   */
  'preg-contra': 'pyhos_preg_contra_icode',
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
  /**
   * โรคติดเชื้อทางเดินหายใจส่วนบนและหลอดลมอักเสบเฉียบพลัน
   *
   * ยกหมวดหูชั้นกลางอักเสบ (H65–H72) มาด้วยเหมือนทะเบียน RUA-URI — หูชั้นกลาง
   * อักเสบเป็นโรคที่ตัวชี้วัดกลุ่มนี้นับรวมอยู่แล้ว แต่รหัสอยู่คนละบทกับทางเดินหายใจ
   * ถ้ายกมาแต่หมวด J คนตั้งค่าจะไม่เห็นรหัสเหล่านั้นจนกว่าจะเดาได้เองว่าต้องพิมพ์ค้น
   */
  ri: {
    table: 'pyhos_ri_icd10',
    chapters: [
      { from: 'J00', to: 'J99' },
      { from: 'H65', to: 'H72' },
    ],
  },
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
  /** โรคเบาหวาน — ใช้เป็นตัวหารทั้งข้อ glibenclamide ในผู้สูงอายุ และข้อการใช้ metformin */
  dm: { table: 'pyhos_dm_icd10', chapters: [{ from: 'E10', to: 'E14' }] },
  /**
   * การคลอดปกติครบกำหนดทางช่องคลอด — ตัวหารของตัวชี้วัด NL
   *
   * ยกหมวด O80–O84 มาทั้งหมด 32 รหัส ไม่ได้ยกมาแต่ O800 ที่ใส่ไว้ตั้งต้น เพราะ
   * คณะกรรมการต้องตัดสินเองว่าการคลอดที่ใช้เครื่องช่วย (O81 คีมและเครื่องดูด)
   * นับเป็น "คลอดปกติ" ด้วยหรือไม่ ซึ่งแต่ละที่ตีความไม่เหมือนกัน
   *
   * ข้อจำกัดที่ต้องรู้: รหัส ICD-10 ไม่ได้บอกอายุครรภ์ คำว่า "ครบกำหนด" ในชื่อ
   * ตัวชี้วัดจึงยังไม่ได้ถูกกรองด้วยคิวรี — การคลอดก่อนกำหนดที่ลงรหัส O800 ไว้
   * จะเข้าตัวหารด้วย (ตามปกติการคลอดก่อนกำหนดลงรหัส O60 ซึ่งไม่อยู่ในหมวดนี้)
   */
  nl: { table: 'pyhos_nl_icd10', chapters: [{ from: 'O80', to: 'O84' }] },
  /**
   * รหัสที่แปลว่า "กำลังตั้งครรภ์" — ตัวหารของตัวชี้วัดยาที่ห้ามใช้ในสตรีตั้งครรภ์
   *
   * ยกหมวด O00–O99 กับ Z32–Z36 มาให้เลือก แต่ใส่ไว้ตั้งต้นแค่ Z33–Z36 (25 รหัส)
   * ซึ่งเป็นรหัสฝากครรภ์และตรวจครรภ์ — ตรวจแล้วเป็นชุดที่ลงรหัสตรงกับความจริง
   * ในฐานนี้ ส่วนหมวด O ถูกใช้ผิดเยอะจนเอามาเป็นตัวหารตรง ๆ ไม่ได้: O223
   * (หลอดเลือดดำอุดตันขณะตั้งครรภ์) ถูกคลินิกความดันใช้แทนรหัสหลอดเลือดดำ
   * อุดตันทั่วไป จนมีทั้งผู้ชายและผู้ป่วยอายุ 80–90 ปีติดมาด้วย
   *
   * ที่ไม่ใส่ Z32 ไว้ให้เพราะ Z320 คือ "ตรวจแล้วยังไม่ยืนยันว่าตั้งครรภ์"
   * ซึ่งอยู่รหัสสามหลักเดียวกับ Z321 ที่ยืนยันแล้ว
   *
   * คนที่คลอดหรือแท้งไปแล้ว (O80–O84, O00–O08) ก็ไม่ได้ใส่ไว้ — ตัวชี้วัดถาม
   * ถึงยาที่ถึงตัวทารกในครรภ์ ซึ่งจบไปแล้วตั้งแต่วันที่รหัสเหล่านั้นถูกบันทึก
   */
  pregnancy: {
    table: 'pyhos_pregnancy_icd10',
    chapters: [
      { from: 'O00', to: 'O99' },
      { from: 'Z32', to: 'Z36' },
    ],
  },
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

/**
 * จำนวนผลค้นสูงสุดต่อครั้ง — กันคำค้นสั้น ๆ อย่าง 'a' ลากมาทั้งตาราง
 *
 * จำกัดเฉพาะฝั่งที่ค้นเจอ ไม่รวมรหัสที่อยู่ในทะเบียน — ทะเบียน APL มี 441 รหัส
 * ถ้านับรวมกันแล้วตัดที่ 200 พอพิมพ์ค้นอะไรก็ตาม กล่องขวาจะเหลือแค่รหัสต้น ๆ
 * ตามลำดับตัวอักษร (ตัดขาดกลางหมวด S) แล้วหมวด T หายไปทั้งหมวดทั้งที่ยังอยู่ครบ
 * ในฐาน ทะเบียนจะโตเกิน 200 ได้เสมอ ขีดจำกัดจึงต้องอยู่แค่กับผลค้น
 */
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
  /**
   * ชื่อสามัญ — ตัวเดียวในตารางที่มัดยาคนละรหัสแต่ตัวเดียวกันเข้าด้วยกัน
   *
   * ชื่อในคอลัมน์ name เป็นชื่อการค้าปนรหัสภายในปนชื่อบริษัท ("(ง)Atorvastatin-40
   * Tablet [ช,ต](LIPITOR, บ.ทีโอ)") การไล่หายาตัวเดียวกันให้ครบทุกรหัสจากชื่อนั้น
   * ต้องรู้ชื่อการค้าทุกยี่ห้อที่โรงพยาบาลเคยซื้อ ซึ่งเป็นงานที่พลาดง่ายมาก —
   * ชื่อสามัญตัดปัญหานั้นทิ้ง (เติมไว้ครบทั้ง 2,935 รายการ ไม่มีแถวว่าง)
   *
   * แต่เชื่อเป็นกลุ่มยาไม่ได้ ใช้ได้แค่เป็นตัวช่วยค้น — ค่าในคอลัมน์นี้มีทั้งที่
   * สะกดผิด (SAXAGLIOTIN) และที่เป็นชื่อการค้าล้วน (BeSTATIN40MG.E*TAB.(ONCALL))
   * การเลือกเข้าทะเบียนจึงยังต้องให้คนดูทีละรายการอยู่ดี
   */
  generic: string | null
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
    SELECT d.icode, d.name, d.strength, d.units, d.dosageform, d.generic_name, d.istatus
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
    generic: str(row.generic_name),
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
  /**
   * ครั้งที่รหัสนี้ถูกลงจริงใน 12 เดือนล่าสุด — ผู้ป่วยนอก / ผู้ป่วยใน
   *
   * เป็นตัวแยก "รหัสที่หมอลงจริง" ออกจาก "รหัสหมวดที่ไม่มีใครลง" ซึ่งอยู่ปนกัน
   * ในตาราง icd101 และแยกจากหน้าตาไม่ออก (S00 กับ S000 ต่างกันแค่ตัวเดียว
   * แต่ตัวแรกมีคนใช้ 0 ครั้ง ส่วนตัวหลัง 504 ครั้ง) ดู lib/his/rdu-icd10-usage.ts
   */
  opdUses: number
  ipdUses: number
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

  /* จำนวนการใช้มาจากตารางแคช ไม่ได้นับสดตรงนี้ — การนับสดต้องกวาด ovstdiag
     ทั้งปีซึ่งใช้เวลาห้าวินาที ทำให้พิมพ์ค้นไม่ได้ (ดู lib/his/rdu-icd10-usage.ts)
     LEFT JOIN เพราะรหัสที่ไม่มีใครใช้ต้องยังขึ้นในรายการ ไม่ใช่หายไป —
     รหัสเหล่านั้นคือรหัสที่ต้องมองเห็นที่สุด */
  const [result] = await hisDb.execute(
    search === ''
      ? sql`
        SELECT c.code, c.name, c.tname, c.active_status, u.opd_uses, u.ipd_uses
        FROM icd101 c
        LEFT OUTER JOIN pyhos_icd10_usage u ON u.icd10 = c.code
        WHERE (c.active_status = ${ACTIVE_CODE_STATUS} AND (${chapterFilter(kind)}))
           OR c.code IN (SELECT r.icd10 FROM ${table} r)
        ORDER BY c.code`
      : sql`
        SELECT c.code, c.name, c.tname, c.active_status, u.opd_uses, u.ipd_uses
        FROM icd101 c
        LEFT OUTER JOIN pyhos_icd10_usage u ON u.icd10 = c.code
        WHERE c.code IN (
                SELECT m.code FROM (
                  SELECT s.code FROM icd101 s
                   WHERE s.active_status = ${ACTIVE_CODE_STATUS}
                     AND (s.code LIKE ${`${search}%`}
                          OR s.name LIKE ${`%${search}%`}
                          OR s.tname LIKE ${`%${search}%`})
                   ORDER BY s.code
                   LIMIT ${MAX_SEARCH_RESULTS}) m)
           OR c.code IN (SELECT r.icd10 FROM ${table} r)
        ORDER BY c.code`,
  )

  return rows(result).map(row => ({
    code: String(row.code ?? '').trim(),
    name: String(row.name ?? '').trim(),
    // ชื่อไทยในฐานมีช่องว่างต่อท้ายหลายแถว ('โรคหอบหืด   ') ตัดทิ้งก่อนส่งออกไป
    tname: str(row.tname),
    opdUses: Number(row.opd_uses ?? 0),
    ipdUses: Number(row.ipd_uses ?? 0),
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
