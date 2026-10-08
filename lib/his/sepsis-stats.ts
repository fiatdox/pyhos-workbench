import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'
import {
  bucketExpression,
  codingCompleteness,
  currentFiscalYear,
  planOf,
  thisMonth,
  type CodingCompleteness,
  type PeriodQuery,
} from '@/lib/his/fiscal-period'
import {
  SEPSIS_GROUPS,
  SEPSIS_ICU_BINS,
  SEPSIS_ICU_WARDS,
  type SepsisAreas,
  type SepsisAreaTotals,
  type SepsisCount,
  type SepsisDistrict,
  type SepsisGroup,
  type SepsisIcuBin,
  type SepsisIcuCounts,
  type SepsisIcuScope,
  type SepsisIcuWard,
  type SepsisPeriod,
  type SepsisReferral,
  type SepsisReferrals,
  type SepsisSplit,
  SEPSIS_SPLITS,
} from '@/lib/his/sepsis-groups'

/* ช่วงเวลา ปีงบ ไตรมาส ใช้ของกลางร่วมกับหน้า Stroke — ดู lib/his/fiscal-period.ts */
export type { FiscalQuarter } from '@/lib/his/fiscal-period'
export { shownFiscalYears } from '@/lib/his/fiscal-period'
export type SepsisQuery = PeriodQuery

/**
 * สถานการณ์ผู้ป่วย Sepsis / Septic shock และการเสียชีวิต
 * (Service Plan สาขา Sepsis)
 *
 * ขอบเขตคือการนอนโรงพยาบาลหนึ่งครั้ง (AN) ที่มีรหัส A40-A419 หรือ R572 เป็นการ
 * วินิจฉัยอันใดอันหนึ่ง (diagtype 1, 2 หรือ 3) — ไม่ได้จำกัดว่าต้องเป็นโรคหลัก
 * ต่างจากหน้า Stroke ที่นับเฉพาะการวินิจฉัยหลัก เพราะ sepsis มักเป็นภาวะที่เกิด
 * ตามมาจากโรคอื่น การนับเฉพาะโรคหลักจะทิ้งผู้ป่วยไปเกินครึ่ง
 *
 * ยี่สิบเก้าตัวนับ แบ่งเป็นห้ากลุ่มคำถาม:
 *
 *   ภาพรวม   A  ทั้งหมด (A40-A419 หรือ R572)
 *   ชนิด     B  Sepsis (A40-A419)        C  Septic shock (R572)
 *            D  CI — วินิจฉัยตั้งแต่แรกรับ (diagtype 1, 2)
 *            E  HI — เกิดระหว่างนอน (diagtype 3)
 *            D1 CI เฉพาะ Sepsis          D2 CI เฉพาะ Septic shock
 *   ตำแหน่ง  F  LRTI   G  UTI   H  BSI   I  GI   J  HBP
 *            K  Skin   L  Musculoskeletal   M  CNS   N  Tropical
 *   อวัยวะ   O1 ARF   O2 AKI   O3 DIC   O4 Septic encephalopathy
 *   ล้มเหลว  O5 Sepsis induced cholestasis
 *   โรคร่วม  P1 CKD   P2 DM   P3 Cirrhosis   P4 Chronic lung
 *            P5 Heart   P6 HIV   P7 Cancer   P8 Autoimmune
 *
 * และอีกชุดหนึ่งที่ไม่ได้แยกตามช่วงเวลาแต่แยกตามพื้นที่ที่อยู่ของผู้ป่วย — CI, HI
 * และ CI ที่ไม่ได้รับส่งต่อ รายอำเภอและรายตำบลของจังหวัดนี้ (ดู areas)
 *
 * กลุ่มย่อยทุกกลุ่มเป็น "ธง" ไม่ใช่การแบ่งส่วน — ผู้ป่วยหนึ่งรายติดธงได้หลายอัน
 * พร้อมกัน (เช่นมีทั้ง A40 และ R572 หรือมีทั้ง LRTI และ UTI) ผลรวมของกลุ่มย่อย
 * จึงมากกว่า A ได้ และเอามาวางเป็นแท่งซ้อนกันไม่ได้ ต้องวางเป็นแท่งแยก
 *
 * การเสียชีวิตนับจาก dchtype '02' (ตายในโรงพยาบาล) '08' และ '09' แต่ **ตัด
 * ผู้ป่วยประคับประคองออก** — AN ที่มีรหัส Z515 เป็นการวินิจฉัยร่วม (diagtype 2
 * หรือ 3) ไม่นับเป็นการเสียชีวิตของตัวชี้วัด ต่างจากนิยามที่หน้า Stroke ใช้
 * (ที่นั่นนับ 08/09 ล้วน) ตรงนี้เป็นไปตามคิวรีที่ได้รับมา
 *
 * วัดจากฐานจริง — ผลเท่ากับคิวรีต้นฉบับทุกตัวเลขในปีงบ 2566-2569 ทั้งสี่ชุด
 * (ภาพรวม/ตำแหน่ง · O1-O5 · P1-P8 · CI แยกชนิด) แต่รวบยี่สิบเก้ากลุ่มมาอยู่ใน
 * คิวรีเดียว: 2.6 วินาทีสำหรับห้าปี เทียบกับ 5.6 + 1.5 + 3.9 + 1.3 วินาทีของ
 * สี่คิวรีตั้งต้นรวมกัน (รายเดือนของปีเดียว 0.56 วินาที · ไตรมาส 0.14 วินาที)
 * ที่เร็วขึ้นมาจากสองอย่าง — หาชุด AN ที่เข้าขอบเขตก่อนแล้วค่อยไล่รหัสทั้งหมด
 * ของ AN เหล่านั้น (ไม่ต้องสแกน iptdiag ด้วยช่วงรหัสกว้างอย่าง C00-C96) และ
 * ดึง Z515 มาในชุดเดียวกันแล้วใช้ MAX แทน NOT EXISTS ต่อแถว
 *
 * สองกลุ่มที่วัดแล้วได้ศูนย์ ไม่ใช่เพราะคิวรีผิด — G9432 (O4 septic
 * encephalopathy) ไม่มีใช้ในฐานนี้เลยสักแถว เพราะเป็นรหัส ICD-10-CM ไม่ใช่
 * ICD-10 ที่ สปสช. ใช้ รหัสที่ลงจริงในผู้ป่วย sepsis คือ G934 (41 ราย)
 * G931 (40) G92 (38) · ส่วน K710 (O5 cholestasis) มีทั้งห้าปีรวมกันรายเดียว
 * ทั้งสองข้อเป็นเรื่องที่คณะกรรมการต้องตัดสินว่าจะเปลี่ยนรหัสหรือไม่ โค้ดนี้
 * จึงคงนิยามที่ได้รับมาไว้ตรง ๆ แล้วให้หน้าจอบอกคนอ่านว่าทำไมช่องถึงว่าง
 */

/** ประเภทการจำหน่ายที่ถือว่าเสียชีวิต */
const DEAD_DISCHARGE_TYPES = "'02','08','09'"

/** รหัสการดูแลแบบประคับประคอง — ตัดออกจากตัวนับการเสียชีวิต */
const PALLIATIVE_CODE = 'Z515'

/** การวินิจฉัยทุกประเภทที่นับ (หลัก ร่วม และที่เกิดระหว่างนอน) */
const ALL_DIAGTYPES = "('1','2','3')"

/** การวินิจฉัยที่ถือว่าติดเชื้อมาก่อนเข้าโรงพยาบาล */
const COMMUNITY_DIAGTYPES = "('1','2')"

/** หัตถการฟอกเลือด/ใส่สายฟอกไต (ICD-9-CM) — ใช้เป็นหลักฐานของ CKD เพิ่มจากรหัสโรค */
const DIALYSIS_PROCEDURES = "'5498','3995'"

/**
 * เงื่อนไขรหัส ICD-10 ของแต่ละกลุ่ม
 *
 * เขียนเป็นสตริง SQL ตรง ๆ ไม่ได้ผูกพารามิเตอร์ เพราะเป็นค่าคงที่ของโปรแกรม
 * ล้วน ไม่มีอะไรมาจากผู้ใช้สักตัว และต้องใช้ซ้ำทั้งใน WHERE และในนิพจน์ธง
 * ถ้าทำเป็นพารามิเตอร์จะได้ placeholder หลายร้อยตัวในคิวรีเดียว
 */
const CODES = {
  /** Sepsis + Septic shock — ขอบเขตของทั้งรายงาน */
  sepsis: `((a.icd10 BETWEEN 'A40' AND 'A419') OR a.icd10 = 'R572')`,
  sepsisOnly: `(a.icd10 BETWEEN 'A40' AND 'A419')`,
  shockOnly: `(a.icd10 = 'R572')`,
  lrti: `((a.icd10 BETWEEN 'A15' AND 'A1699') OR a.icd10 LIKE 'A19%' OR a.icd10 LIKE 'A430%' OR a.icd10 LIKE 'J100%' OR a.icd10 LIKE 'J110%' OR (a.icd10 BETWEEN 'J12' AND 'J1699') OR (a.icd10 BETWEEN 'J170' AND 'J17399') OR a.icd10 LIKE 'J178%' OR (a.icd10 BETWEEN 'J18' AND 'J1899') OR a.icd10 LIKE 'J20%' OR a.icd10 LIKE 'J440%' OR a.icd10 LIKE 'J470%' OR a.icd10 LIKE 'J850%' OR (a.icd10 BETWEEN 'J851' AND 'J85299') OR a.icd10 IN ('J860','J869'))`,
  uti: `(a.icd10 IN ('N100','N136','N151','N3000','N3001','N390'))`,
  bsi: `(a.icd10 LIKE 'A40%' OR (a.icd10 BETWEEN 'A41' AND 'A41899') OR a.icd10 LIKE 'T802%')`,
  gi: `(a.icd10 LIKE 'K35%' OR (a.icd10 BETWEEN 'K40' AND 'K4199') OR a.icd10 LIKE 'K61%' OR (a.icd10 BETWEEN 'K650' AND 'K65199') OR a.icd10 = 'K659')`,
  hbp: `(a.icd10 IN ('K750','K800','K810','K803') OR a.icd10 LIKE 'K83%' OR (a.icd10 BETWEEN 'K85' AND 'K8699'))`,
  skin: `(a.icd10 IN ('A446','A480','M726') OR a.icd10 LIKE 'L02%' OR a.icd10 LIKE 'L03%')`,
  musculo: `(a.icd10 LIKE 'K681%' OR a.icd10 LIKE 'M00%' OR a.icd10 LIKE 'M86%')`,
  cns: `(a.icd10 LIKE 'A17%' OR a.icd10 LIKE 'B451%' OR (a.icd10 BETWEEN 'G00' AND 'G0799'))`,
  tropical: `(a.icd10 LIKE 'A01%' OR (a.icd10 BETWEEN 'A241' AND 'A24499') OR a.icd10 LIKE 'A27%' OR a.icd10 LIKE 'A753%' OR a.icd10 LIKE 'A90%' OR a.icd10 LIKE 'A91%' OR a.icd10 LIKE 'A97%' OR (a.icd10 BETWEEN 'B50' AND 'B5499'))`,

  /* ภาวะอวัยวะล้มเหลวและภาวะแทรกซ้อนรุนแรง (O1-O5) */
  arf: `(a.icd10 LIKE 'J960%' OR a.icd10 LIKE 'J80%')`,
  aki: `(a.icd10 LIKE 'N17%')`,
  dic: `(a.icd10 LIKE 'D65%')`,
  encephalopathy: `(a.icd10 LIKE 'G9432%')`,
  cholestasis: `(a.icd10 LIKE 'K710%')`,

  /* โรคประจำตัวที่เป็นปัจจัยเสี่ยง (P1-P8) */
  ckd: `(a.icd10 LIKE 'N18%' OR a.icd10 = 'E112')`,
  dm: `(a.icd10 BETWEEN 'E10' AND 'E1499')`,
  cirrhosis: `(a.icd10 IN ('K703','K746'))`,
  lung: `(a.icd10 IN ('J440','J441','J449','J471','J479') OR a.icd10 LIKE 'J45%' OR a.icd10 LIKE 'J84%')`,
  heart: `((a.icd10 BETWEEN 'I05' AND 'I0999') OR a.icd10 LIKE 'I25%' OR (a.icd10 BETWEEN 'I34' AND 'I3899') OR a.icd10 LIKE 'I42%' OR (a.icd10 BETWEEN 'Q22' AND 'Q2399'))`,
  hiv: `(a.icd10 BETWEEN 'B20' AND 'B2499')`,
  cancer: `(a.icd10 BETWEEN 'C00' AND 'C9699')`,
  autoimmune: `((a.icd10 BETWEEN 'M05' AND 'M0699') OR (a.icd10 BETWEEN 'M32' AND 'M3499'))`,
} as const

/* รายชื่อกลุ่มและชนิดข้อมูลอยู่ที่ lib/his/sepsis-groups.ts เพราะหน้าจอต้อง import
   ค่าพวกนี้มาใช้ และไฟล์นี้เป็น server-only ถ้าให้หน้าจอ import จากที่นี่ bundler
   จะลาก mysql2 เข้า client bundle แล้ว build ล้ม — re-export ไว้ให้ที่เรียกใช้ฝั่ง
   เซิร์ฟเวอร์ยัง import จากที่เดียวได้เหมือนเดิม */
export {
  SEPSIS_GROUPS,
  SEPSIS_ORGANS,
  SEPSIS_SITES,
  SEPSIS_UNDERLYING,
} from '@/lib/his/sepsis-groups'
export type {
  SepsisArea,
  SepsisAreas,
  SepsisAreaTotals,
  SepsisCount,
  SepsisDistrict,
  SepsisGroup,
  SepsisIcuBin,
  SepsisIcuCounts,
  SepsisIcuScope,
  SepsisIcuThreshold,
  SepsisIcuWard,
  SepsisPeriod,
  SepsisReferral,
  SepsisReferrals,
  SepsisSplit,
} from '@/lib/his/sepsis-groups'
export {
  SEPSIS_ICU_BINS,
  SEPSIS_ICU_SCOPES,
  SEPSIS_ICU_THRESHOLDS,
  SEPSIS_ICU_WARDS,
  SEPSIS_ICU_WITHIN,
  SEPSIS_SPLITS,
} from '@/lib/his/sepsis-groups'

export type SepsisStats = {
  by: 'fiscalYear' | 'month'
  from: string
  to: string
  currentFiscalYear: number
  fiscalYear: number | null
  quarter: 1 | 2 | 3 | 4 | null
  periods: SepsisPeriod[]
  areas: SepsisAreas
  referrals: SepsisReferrals
  /**
   * หอ ICU แห่งแรกที่ผู้ป่วยเข้า รวมทั้งช่วงที่ขอ (ไม่ได้แยกตามช่วงย่อย)
   *
   * แยกตามตัวหารสองแบบเหมือนตัวนับรายช่วง เพื่อให้กราฟรายหอเปลี่ยนตามปุ่ม
   * ตัวหารที่หน้าจอเลือกไว้ ไม่ใช่ค้างอยู่ที่ "ทั้งหมด" ตัวเดียว
   */
  icuWards: Record<SepsisIcuScope, SepsisIcuWard[]>
  coding: CodingCompleteness
}

/**
 * นิพจน์ธงของกลุ่มหนึ่ง — MAX เพราะหนึ่ง AN มีได้หลายแถววินิจฉัย
 *
 * diagtypes = null คือไม่สนว่าลงเป็นการวินิจฉัยประเภทไหน ใช้กับกลุ่มโรคประจำตัว
 * (P1-P8) ตามนิยามที่ได้รับมา — ต่างจากกลุ่มอื่นที่จำกัด diagtype ไว้
 */
const flag = (codes: string, diagtypes: string | null = ALL_DIAGTYPES) =>
  `MAX(CASE WHEN ${codes}${diagtypes == null ? '' : ` AND a.diagtype IN ${diagtypes}`} THEN 1 ELSE 0 END)`

/** คอลัมน์ธงทั้งหมดในชั้นกลาง — ชื่อตรงกับคีย์ของ SepsisGroup */
const FLAG_COLUMNS = `
  ${flag(CODES.sepsisOnly)} AS sepsisOnly,
  ${flag(CODES.shockOnly)} AS shockOnly,
  ${flag(CODES.sepsis, COMMUNITY_DIAGTYPES)} AS communityInfection,
  ${flag(CODES.sepsis, "('3')")} AS hospitalInfection,
  ${flag(CODES.sepsisOnly, COMMUNITY_DIAGTYPES)} AS ciSepsis,
  ${flag(CODES.shockOnly, COMMUNITY_DIAGTYPES)} AS ciShock,
  ${flag(CODES.lrti)} AS lrti,
  ${flag(CODES.uti)} AS uti,
  ${flag(CODES.bsi, "('1')")} AS bsi,
  ${flag(CODES.gi)} AS gi,
  ${flag(CODES.hbp)} AS hbp,
  ${flag(CODES.skin)} AS skin,
  ${flag(CODES.musculo)} AS musculo,
  ${flag(CODES.cns)} AS cns,
  ${flag(CODES.tropical)} AS tropical,
  ${flag(CODES.arf)} AS arf,
  ${flag(CODES.aki)} AS aki,
  ${flag(CODES.dic)} AS dic,
  ${flag(CODES.encephalopathy)} AS encephalopathy,
  ${flag(CODES.cholestasis)} AS cholestasis,
  /* CKD นับรหัสโรค หรือมีหัตถการฟอกเลือดใน iptoprt อย่างใดอย่างหนึ่ง */
  GREATEST(${flag(CODES.ckd, null)}, MAX(CASE WHEN o.an IS NULL THEN 0 ELSE 1 END)) AS ckd,
  ${flag(CODES.dm, null)} AS dm,
  ${flag(CODES.cirrhosis, null)} AS cirrhosis,
  ${flag(CODES.lung, null)} AS lung,
  ${flag(CODES.heart, null)} AS heart,
  ${flag(CODES.hiv, null)} AS hiv,
  ${flag(CODES.cancer, null)} AS cancer,
  ${flag(CODES.autoimmune, null)} AS autoimmune
`

/**
 * เงื่อนไขขอบเขตในชั้นในสุด — เหมือน CODES.sepsis แต่อ่านจาก alias d
 *
 * ชั้นในกรองจาก iptdiag ที่ตั้งชื่อ d (เพื่อไม่ชนกับ a ของชั้นกลางที่ไล่รหัส
 * ทั้งหมด) เงื่อนไขเดียวกันจึงต้องมีสองสำนวน เขียนคู่กันไว้ที่นี่ให้แก้พร้อมกัน
 */
const SCOPE_CODES = `((d.icd10 BETWEEN 'A40' AND 'A419') OR d.icd10 = 'R572')`

/** คู่ของ "จำนวน" กับ "จำนวนที่เสียชีวิต" ของกลุ่มหนึ่งในชั้นนอก */
const pair = (group: string) =>
  `SUM(${group}) AS ${group}_total, SUM(${group} * is_dead) AS ${group}_dead`

type Row = Record<string, string | number>

/** แถวของคิวรีพื้นที่ — amppart เป็น null เมื่อทะเบียนบ้านอยู่นอกจังหวัด */
type AreaRow = {
  district: string | null
  tambon: string | null
  ci_total: string | number
  ci_dead: string | number
  hi_total: string | number
  hi_dead: string | number
  nr_total: string | number
  nr_dead: string | number
  referred_in: string | number
}

type NameRow = { amppart: string; tmbpart: string; name: string }

/** แถวของคิวรี ICU — หนึ่งแถวต่อ (ช่วงเวลา × CI × ถังเวลา × หอ ICU) */
type IcuRow = {
  bucket: string
  ci: string | number
  bin: string
  /** รหัสหอ ICU แห่งแรกที่เข้า — สตริงว่างเมื่อไม่เคยเข้า ICU */
  ward: string | null
  n: string | number
}

/** แถวของคิวรีสถานพยาบาลต้นทาง */
type ReferralRow = {
  code: string | null
  name: string | null
  ci_total: string | number
  ci_dead: string | number
  shock_total: string | number
  shock_dead: string | number
}

/** แปลงแถวดิบของคิวรีพื้นที่เป็นตัวนับที่หน้าจอใช้ — SUM ของ MariaDB คืนมาเป็นสตริง */
const countsOf = (row: AreaRow) => ({
  ci: { total: Number(row.ci_total), dead: Number(row.ci_dead) },
  hi: { total: Number(row.hi_total), dead: Number(row.hi_dead) },
  ciNonReferred: { total: Number(row.nr_total), dead: Number(row.nr_dead) },
  referredIn: Number(row.referred_in),
})

/** บวกตัวนับหนึ่งเข้ากับอีกตัวในที่เดิม — ใช้ไล่รวมตำบลขึ้นเป็นอำเภอและเป็นจังหวัด */
const add = (into: SepsisCount, from: SepsisCount) => {
  into.total += from.total
  into.dead += from.dead
}

/** จังหวัดและอำเภอที่โรงพยาบาลตั้งอยู่ — รหัสตามทะเบียนราษฎร */
const HOSPITAL_PROVINCE = '56'
const HOSPITAL_DISTRICT = '01'

/** รหัสหอผู้ป่วยหนักสำหรับใส่ใน IN (...) — รายชื่ออยู่ที่ sepsis-groups.ts */
const ICU_WARDS = SEPSIS_ICU_WARDS.map(({ ward }) => `'${ward}'`).join(',')

/**
 * สถิติ Sepsis ตามช่วงที่ขอ — ไม่มีข้อมูลรายบุคคลออกจากฟังก์ชันนี้เลย
 *
 * คิวรีหลักมีสามชั้น: ชั้นในหาชุด AN ที่เข้าขอบเขต (มีรหัส sepsis อย่างน้อยหนึ่ง
 * รหัส) พร้อมสถานะจำหน่าย · ชั้นกลางไล่รหัสวินิจฉัยทั้งหมดของ AN เหล่านั้นแล้ว
 * ยุบเป็นธงหนึ่งแถวต่อ AN · ชั้นนอกรวมตามช่วงเวลา
 *
 * ที่ต้องแยกชั้นในกับชั้นกลางออกจากกัน เพราะขอบเขตกับธงถามจาก iptdiag ต่างมุม —
 * ขอบเขตอยากรู้ว่า "AN นี้มีรหัส sepsis ไหม" ซึ่งกรองด้วยดัชนีรหัสได้ ส่วนธง
 * อยากรู้ "AN นี้มีรหัสอะไรอีก" ซึ่งต้องอ่านทุกแถวของ AN นั้น ถ้ารวมเป็นชั้นเดียว
 * ต้องเอาช่วงรหัสของทุกธงไปต่อกันใน WHERE ซึ่งกว้างจนดัชนีช่วยไม่ได้ (P7 อย่างเดียว
 * คือ C00-C96 ทั้งช่วง) วัดแล้วช้ากว่ากันราวสองเท่าครึ่ง
 */
export async function getSepsisStats(
  query: SepsisQuery = { by: 'fiscalYear' },
  now = new Date(),
): Promise<SepsisStats> {
  const plan = planOf(query, now)
  const bucket = bucketExpression(plan.by, 'i.dchdate')

  /** AN ที่เข้าขอบเขต พร้อมช่วงเวลาและสถานะจำหน่าย — ใช้ซ้ำทั้งสองคิวรี */
  const scope = (diagtypes: string) => `
    SELECT ${bucket} AS bucket,
           i.an,
           i.hn,
           MAX(CASE WHEN i.dchtype IN (${DEAD_DISCHARGE_TYPES}) THEN 1 ELSE 0 END) AS dead_discharge
    FROM ipt i
    JOIN iptdiag d ON d.an = i.an
    WHERE i.dchdate BETWEEN '${plan.from}' AND '${plan.to}'
      AND ${SCOPE_CODES}
      AND d.diagtype IN ${diagtypes}
    GROUP BY bucket, i.an, i.hn
  `

  /**
   * เสียชีวิตตามตัวชี้วัด = จำหน่ายด้วยสถานะตาย และไม่ได้ลงรหัสประคับประคองไว้
   * เป็นการวินิจฉัยร่วม — Z515 อ่านได้จากแถวที่ชั้นกลางไล่อยู่แล้ว ไม่ต้อง
   * NOT EXISTS แยกต่อ AN
   *
   * รับนิพจน์สถานะจำหน่ายเข้ามา เพราะบางคิวรีอ่านจากชั้นที่ยุบมาแล้ว
   * (s.dead_discharge) บางคิวรีคิดสดจาก ipt ในชั้นเดียวกัน
   */
  const isDeadWith = (discharged: string) =>
    `${discharged} * (1 - MAX(CASE WHEN a.icd10 = '${PALLIATIVE_CODE}' AND a.diagtype IN ('2','3') THEN 1 ELSE 0 END))`

  /** จำหน่ายด้วยสถานะตาย คิดสดจาก ipt */
  const deadDischarge = `MAX(CASE WHEN i.dchtype IN (${DEAD_DISCHARGE_TYPES}) THEN 1 ELSE 0 END)`

  const isDead = isDeadWith('s.dead_discharge')

  const main = `
    SELECT bucket,
           COUNT(*) AS all_total,
           SUM(is_dead) AS all_dead,
           ${SEPSIS_GROUPS.filter(group => group !== 'all').map(pair).join(',\n           ')}
    FROM (
      SELECT s.bucket,
             s.an,
             ${isDead} AS is_dead,
             ${FLAG_COLUMNS}
      FROM (${scope(ALL_DIAGTYPES)}) s
      JOIN iptdiag a ON a.an = s.an
      LEFT JOIN iptoprt o ON o.an = s.an AND o.icd9 IN (${DIALYSIS_PROCEDURES})
      GROUP BY s.bucket, s.an, s.dead_discharge
    ) AS admissions
    GROUP BY bucket
    ORDER BY bucket
  `

  /**
   * ผู้ป่วยแยกตามอำเภอและตำบลที่อยู่ — CI, HI และ CI ที่ไม่ได้รับส่งต่อ ในคิวรีเดียว
   *
   * ทั้งสามตัวนับอ่านจากชุด AN เดียวกัน จึงไม่มีเหตุให้ยิงสามรอบ ผู้ป่วยนอกจังหวัด
   * ยุบรวมเป็นแถวเดียว (amppart เป็น NULL) เพราะกราฟรายอำเภอแสดงแต่ในจังหวัด
   * แต่ยอดรวมต้องยังบวกกันได้เท่ากับยอด CI/HI ของกราฟตามเวลา — วัดแล้วตรง:
   * CI 6,507 ในจังหวัด + 307 นอกจังหวัด = 6,814 เท่ากับผลรวมห้าปีงบพอดี
   *
   * "ไม่รับส่งต่อ" ตัด AN ทั้งใบถ้ามี visit ใดของ AN นั้นปรากฏในทะเบียน referin
   * ไม่ใช่ตัดเฉพาะ visit นั้น — สำนวน LEFT JOIN … WHERE r.vn IS NULL ของคิวรี
   * ตั้งต้นเก็บ AN ที่มีทั้ง visit ที่รับส่งต่อและไม่รับไว้ด้วย ซึ่งอ่านว่า
   * "ไม่ได้รับส่งต่อ" ไม่ได้ (วัดแล้วต่างกัน 4 AN ใน 2,359)
   *
   * จัดกลุ่มด้วยรหัสอำเภอ/ตำบลดิบ ไม่ต่อตาราง thaiaddress เข้าไปในคิวรีนับ แล้ว
   * เอาชื่อมาประกบทีหลัง — แบบเดียวกับหน้า Stroke ที่วัดแล้วเร็วกว่าสามสิบเท่า
   *
   * ใช้ 2.5 วินาที แต่ยิงขนานกับคิวรีหลักที่ใช้ 2.6 วินาที เวลารวมจึงไม่ขยับ
   */
  const areas = `
    SELECT CASE WHEN p.chwpart = '${HOSPITAL_PROVINCE}' THEN p.amppart END AS district,
           CASE WHEN p.chwpart = '${HOSPITAL_PROVINCE}' THEN p.tmbpart END AS tambon,
           SUM(x.ci) AS ci_total,
           SUM(x.ci * x.is_dead) AS ci_dead,
           SUM(x.hi) AS hi_total,
           SUM(x.hi * x.is_dead) AS hi_dead,
           SUM(x.ci * (1 - x.referred_in)) AS nr_total,
           SUM(x.ci * (1 - x.referred_in) * x.is_dead) AS nr_dead,
           SUM(x.ci * x.referred_in) AS referred_in
    FROM (
      SELECT s.an,
             s.hn,
             ${isDead} AS is_dead,
             MAX(CASE WHEN ${CODES.sepsis} AND a.diagtype IN ${COMMUNITY_DIAGTYPES} THEN 1 ELSE 0 END) AS ci,
             MAX(CASE WHEN ${CODES.sepsis} AND a.diagtype = '3' THEN 1 ELSE 0 END) AS hi,
             MAX(CASE WHEN r.vn IS NULL THEN 0 ELSE 1 END) AS referred_in
      FROM (${scope(ALL_DIAGTYPES)}) s
      JOIN iptdiag a ON a.an = s.an
      LEFT JOIN ovst v ON v.an = s.an
      LEFT JOIN referin r ON r.vn = v.vn
      GROUP BY s.an, s.hn, s.dead_discharge
    ) AS x
    LEFT JOIN patient p ON p.hn = x.hn
    /* จัดกลุ่มด้วยนิพจน์เต็ม ไม่ใช่ชื่อย่อ — ถ้าเขียน GROUP BY amppart, tmbpart
       ชื่อจะชนกับคอลัมน์ p.amppart/p.tmbpart ของตาราง patient แล้ว MariaDB
       จัดกลุ่มด้วยคอลัมน์ดิบโดยไม่สนจังหวัด ผู้ป่วยจังหวัดอื่นที่รหัสอำเภอ/ตำบล
       ตรงกันจะถูกนับรวมเข้าอำเภอของจังหวัดนี้ (วัดแล้วเกินมา 5 ราย ในตำบลเดียว)
       ยอดรวมยังถูกเพราะทุก AN ถูกนับครั้งเดียว แต่การกระจายรายพื้นที่ผิด */
    GROUP BY
      CASE WHEN p.chwpart = '${HOSPITAL_PROVINCE}' THEN p.amppart END,
      CASE WHEN p.chwpart = '${HOSPITAL_PROVINCE}' THEN p.tmbpart END
  `

  /**
   * ผู้ป่วย CI Sepsis ที่รับส่งต่อมา แยกตามสถานพยาบาลต้นทาง
   *
   * ธงต่อ AN เหมือนคิวรีอื่น: CI คือ A40-A419 หรือ R572 เป็นโรคหลัก/โรคร่วมแรกรับ
   * ส่วน shock คือ R572 ที่ลงเป็น **โรคร่วมแรกรับ (diagtype 2) เท่านั้น** ตามนิยาม
   * ที่ได้รับมา — แคบกว่ากลุ่ม ciShock ของกราฟตามเวลาที่นับ diagtype 1 ด้วย
   * วัดแล้วต่างกัน 83 AN จาก 2,434 ในห้าปีงบ
   *
   * MIN(refer_hospcode) ไม่ได้เลือกอะไรทิ้ง — วัดแล้วไม่มี AN ไหนในขอบเขตนี้ที่มี
   * สถานพยาบาลต้นทางมากกว่าหนึ่งแห่ง ใส่ MIN ไว้ให้ค่าแน่นอนถ้าวันหนึ่งมี
   */
  const referralFlags = (discharged: string) => `
             MIN(r.refer_hospcode) AS source,
             ${isDeadWith(discharged)} AS is_dead,
             ${flag(CODES.sepsis, COMMUNITY_DIAGTYPES)} AS ci,
             MAX(CASE WHEN ${CODES.shockOnly} AND a.diagtype = '2' THEN 1 ELSE 0 END) AS shock`

  /**
   * ขอบเขตของรายงานนี้ — ทะเบียนบ้านอยู่ในจังหวัดแต่นอกอำเภอที่โรงพยาบาลตั้งอยู่
   * และการนอนครั้งนั้นมีรหัส CI sepsis อยู่
   *
   * EXISTS จำกัด**ชุด AN** แต่ไม่จำกัดแถว iptdiag ที่ชั้นในเห็น ต่างจากการใส่
   * เงื่อนไขรหัสไว้ใน WHERE ตรง ๆ — ต้องเห็นรหัสทั้งหมดของ AN เพื่ออ่าน Z515
   * ด้วย MAX แทนที่จะยิง NOT EXISTS ต่อแถวอย่างคิวรีตั้งต้น
   */
  const referralWhere = `
        AND p.chwpart = '${HOSPITAL_PROVINCE}'
        AND p.amppart <> '${HOSPITAL_DISTRICT}'
        AND EXISTS (
          SELECT 1 FROM iptdiag d
          WHERE d.an = i.an AND ${SCOPE_CODES} AND d.diagtype IN ${COMMUNITY_DIAGTYPES}
        )`

  /**
   * สองสำนวนของชั้นใน เลือกตามความกว้างของช่วงที่ขอ
   *
   * ไม่ได้ทำเพราะอยากมีสองทาง แต่เพราะแผนที่ MariaDB เลือกพลิกตามช่วงวันที่ แล้ว
   * พลิกไปผิดทางทั้งสองฝั่ง วัดจากฐานจริง ตัวเลขของทั้งสองสำนวนตรงกันทุกช่อง:
   *
   *                 ห้าปีงบ   ไตรมาส
   *   ปล่อยอิสระ     1.06 s   2.88 s
   *   บังคับลำดับ    5.47 s   0.13 s
   *
   * สำนวน "ปล่อยอิสระ" ให้ตัวเพิ่มประสิทธิภาพเลือกเอง ซึ่งในช่วงห้าปีมันไล่จาก
   * iptdiag แล้วใช้ FirstMatch — ถูกทาง แต่ในช่วงแคบมันไปไล่ดัชนีของ referin
   * 242,572 แถวโดยไม่แตะดัชนีวันจำหน่ายเลย
   *
   * สำนวน "บังคับลำดับ" ใส่ GROUP BY ในตารางซ้อนชั้นในสุด บังคับให้ materialize
   * ชุด AN ที่กรองด้วยวันจำหน่ายและพื้นที่ก่อน ตัวขับจึงเป็น ipt เสมอ — ดีมากใน
   * ช่วงแคบ (ไตรมาสเหลือราว 9,000 แถว) แต่ในช่วงห้าปีกลายเป็นยิง EXISTS ทีละแถว
   * ให้ ipt ราว 180,000 แถว ซึ่งแพงกว่าสแกน iptdiag รอบเดียว
   */
  const referralSource =
    plan.by === 'fiscalYear'
      ? `
      SELECT i.an,${referralFlags(deadDischarge)}
      FROM ipt i
      JOIN patient p ON p.hn = i.hn
      JOIN iptdiag a ON a.an = i.an
      JOIN ovst v ON v.an = i.an
      JOIN referin r ON r.vn = v.vn
      WHERE i.dchdate BETWEEN '${plan.from}' AND '${plan.to}'${referralWhere}
      GROUP BY i.an`
      : `
      SELECT s.an,${referralFlags('s.dead_discharge')}
      FROM (
        SELECT i.an, ${deadDischarge} AS dead_discharge
        FROM ipt i
        JOIN patient p ON p.hn = i.hn
        WHERE i.dchdate BETWEEN '${plan.from}' AND '${plan.to}'${referralWhere}
        GROUP BY i.an
      ) s
      JOIN iptdiag a ON a.an = s.an
      JOIN ovst v ON v.an = s.an
      JOIN referin r ON r.vn = v.vn
      GROUP BY s.an, s.dead_discharge`

  const referrals = `
    SELECT x.source AS code,
           h.name AS name,
           SUM(x.ci) AS ci_total,
           SUM(x.ci * x.is_dead) AS ci_dead,
           SUM(x.shock) AS shock_total,
           SUM(x.shock * x.is_dead) AS shock_dead
    FROM (${referralSource}
    ) AS x
    LEFT JOIN hospcode h ON h.hospcode = x.source
    WHERE x.ci = 1
    GROUP BY x.source, h.name
  `

  /**
   * CI/HI คูณกับการรับส่งต่อ รายช่วงเวลา พร้อมจำนวนที่เสียชีวิตของทุกชุด
   *
   * คิวรีพื้นที่อีกตัวตอบคำถามนี้ไม่ได้ เพราะมันรวมทั้งช่วงเป็นก้อนเดียวเพื่อให้
   * ตำบลเล็กมีตัวเลขพออ่าน ส่วนชุดนี้ต้องการแนวโน้มตามเวลา จึงต้องแยกคิวรี
   *
   * own + referred ของแต่ละฝั่งบวกกันได้เท่ากับยอดของฝั่งนั้นพอดี เพราะทุก AN
   * ตอบได้แน่นอนว่ารับส่งต่อมาหรือไม่ ต่างจาก ci กับ hi ที่ซ้อนกันได้
   *
   * ตัวนับของอำเภอที่โรงพยาบาลตั้งอยู่ (home) อยู่ในคิวรีเดียวกัน ไม่ต้องยิงแยก —
   * ใช้ชุด AN ชุดเดียวกัน ต่างแค่เงื่อนไขที่เอามาคูณ
   *
   * วัดจากฐานจริง: 2.56 วินาทีสำหรับห้าปี · 0.52 สำหรับหนึ่งปีงบรายเดือน ·
   * 0.12 สำหรับไตรมาส ยิงขนานกับคิวรีอื่น เวลารวมของหน้าจึงไม่ขยับ
   *
   * ตรวจแล้ว ci กับ hi ของคิวรีนี้เท่ากับกลุ่ม communityInfection และ
   * hospitalInfection ของคิวรีหลักทุกช่อง ทั้งที่คนละคิวรีและคนละเส้นทาง
   */
  const splits = `
    SELECT bucket,
           SUM(ci) AS ci_total,
           SUM(ci * is_dead) AS ci_dead,
           SUM(ci * (1 - referred)) AS ciOwn_total,
           SUM(ci * (1 - referred) * is_dead) AS ciOwn_dead,
           SUM(ci * referred) AS ciReferred_total,
           SUM(ci * referred * is_dead) AS ciReferred_dead,
           SUM(hi) AS hi_total,
           SUM(hi * is_dead) AS hi_dead,
           SUM(hi * (1 - referred)) AS hiOwn_total,
           SUM(hi * (1 - referred) * is_dead) AS hiOwn_dead,
           SUM(hi * referred) AS hiReferred_total,
           SUM(hi * referred * is_dead) AS hiReferred_dead,
           SUM(ci * home) AS home_ci,
           SUM(ci * home * referred) AS home_referred
    FROM (
      SELECT s.bucket,
             s.an,
             ${isDead} AS is_dead,
             ${flag(CODES.sepsis, COMMUNITY_DIAGTYPES)} AS ci,
             ${flag(CODES.sepsis, "('3')")} AS hi,
             MAX(CASE WHEN r.vn IS NULL THEN 0 ELSE 1 END) AS referred,
             MAX(CASE WHEN p.chwpart = '${HOSPITAL_PROVINCE}' AND p.amppart = '${HOSPITAL_DISTRICT}' THEN 1 ELSE 0 END) AS home
      FROM (${scope(ALL_DIAGTYPES)}) s
      JOIN iptdiag a ON a.an = s.an
      LEFT JOIN patient p ON p.hn = s.hn
      LEFT JOIN ovst v ON v.an = s.an
      LEFT JOIN referin r ON r.vn = v.vn
      GROUP BY s.bucket, s.an, s.dead_discharge
    ) AS x
    GROUP BY bucket
  `

  /**
   * การเข้าถึง ICU — ระยะเวลาจากแรกรับถึงการเข้าหอผู้ป่วยหนักครั้งแรก
   *
   * หอ ICU แห่งแรกของการนอนครั้งนั้นหาจากสามทางตามลำดับ: หอแรกรับ
   * (ipt.first_ward) ถ้าเป็น ICU อยู่แล้ว · ถ้าไม่ใช่ก็หาแถวย้ายเตียงเข้า ICU
   * ที่เร็วที่สุดใน iptbedmove · ถ้าไม่มีทั้งสองแต่จำหน่ายจากหอ ICU ก็นับว่า
   * เข้า ICU แต่ไม่รู้เวลา (ถัง unknownTime)
   *
   * วัดแล้ว ipt.first_ward มีค่าทุกแถวในขอบเขตนี้ (7,983 AN ห้าปีงบ ไม่มีว่าง
   * สักแถว) และในกลุ่มที่มีแถวย้ายเตียง หอต้นทางของแถวแรกตรงกับ first_ward
   * 4,393 จาก 4,884 AN — ใช้เป็นหอแรกรับได้
   *
   * เวลารับเข้านอนอ่านจาก ipt.regdate + regtime ไม่ใช่เวลาที่วินิจฉัย sepsis
   * ซึ่ง HIS ไม่ได้บันทึกไว้เลย นี่เป็นข้อจำกัดของนิยาม ไม่ใช่ของคิวรี — หน้าจอ
   * ต้องบอกคนอ่านไว้ว่านาฬิกาเริ่มที่แรกรับ
   *
   * คืนมาเป็นถังดิบที่ระดับ (ช่วงเวลา × CI × ถัง × หอ) แล้วให้ TypeScript ไล่รวม
   * เอง ทั้งอัตราทุกเกณฑ์เวลา ตัวหารสองแบบ และการแยกตามหอ ICU จึงมาจากคิวรี
   * เดียว ไม่ต้องยิงใหม่เมื่อคนอ่านเปลี่ยนเกณฑ์
   *
   * วัดจากฐานจริง 1.64 วินาทีสำหรับห้าปีงบ ยิงขนานกับคิวรีอื่น
   */
  const icu = `
    SELECT bucket, ci, bin, COALESCE(icu_ward, '') AS ward, COUNT(*) AS n
    FROM (
      SELECT y.bucket,
             y.ci,
             y.icu_ward,
             CASE
               WHEN y.adm_icu = 1 THEN 'atAdmission'
               WHEN y.icu_at IS NULL
                 THEN CASE WHEN y.dch_icu = 1 THEN 'unknownTime' ELSE 'never' END
               /* GREATEST กันเวลาย้ายที่บันทึกไว้ก่อนเวลารับเข้านอน — มีจริงหนึ่ง
                  รายในห้าปี นับเป็นทันเวลาแทนที่จะทำให้ถังติดลบ */
               WHEN GREATEST(TIMESTAMPDIFF(MINUTE, y.adm, y.icu_at), 0) <= 180 THEN 'h3'
               WHEN TIMESTAMPDIFF(MINUTE, y.adm, y.icu_at) <= 360 THEN 'h6'
               WHEN TIMESTAMPDIFF(MINUTE, y.adm, y.icu_at) <= 720 THEN 'h12'
               WHEN TIMESTAMPDIFF(MINUTE, y.adm, y.icu_at) <= 1440 THEN 'h24'
               ELSE 'later'
             END AS bin
      FROM (
        SELECT c.bucket,
               c.ci,
               CASE WHEN i.first_ward IN (${ICU_WARDS}) THEN 1 ELSE 0 END AS adm_icu,
               CASE WHEN i.ward IN (${ICU_WARDS}) THEN 1 ELSE 0 END AS dch_icu,
               TIMESTAMP(i.regdate, i.regtime) AS adm,
               (SELECT MIN(TIMESTAMP(b.movedate, b.movetime)) FROM iptbedmove b
                 WHERE b.an = i.an AND b.nward IN (${ICU_WARDS})) AS icu_at,
               CASE
                 WHEN i.first_ward IN (${ICU_WARDS}) THEN i.first_ward
                 ELSE COALESCE(
                   (SELECT b.nward FROM iptbedmove b
                     WHERE b.an = i.an AND b.nward IN (${ICU_WARDS})
                     ORDER BY b.movedate, b.movetime LIMIT 1),
                   CASE WHEN i.ward IN (${ICU_WARDS}) THEN i.ward END)
               END AS icu_ward
        FROM (
          SELECT s.bucket, s.an, ${flag(CODES.sepsis, COMMUNITY_DIAGTYPES)} AS ci
          FROM (${scope(ALL_DIAGTYPES)}) s
          JOIN iptdiag a ON a.an = s.an
          GROUP BY s.bucket, s.an
        ) c
        JOIN ipt i ON i.an = c.an
      ) y
    ) z
    GROUP BY bucket, ci, bin, ward
  `

  /** ชื่ออำเภอ (tmbpart = '00') และชื่อตำบลของจังหวัดนี้ — 86 แถว ใช้เวลา 3 ms */
  const areaNames = sql`
    SELECT amppart, tmbpart, name
    FROM thaiaddress
    WHERE chwpart = ${HOSPITAL_PROVINCE} AND codetype IN ('2', '3')
  `

  const [result, areaResult, referralResult, homeResult, icuResult, nameResult, coding] =
    await Promise.all([
      hisDb.execute(sql.raw(main)),
      hisDb.execute(sql.raw(areas)),
      hisDb.execute(sql.raw(referrals)),
      hisDb.execute(sql.raw(splits)),
      hisDb.execute(sql.raw(icu)),
      hisDb.execute(areaNames),
      codingCompleteness(thisMonth(now)),
    ])

  const found = new Map<string, Row>()
  for (const row of (result as unknown as Row[][])[0]) found.set(String(row.bucket), row)

  const splitOf = new Map<string, Row>()
  for (const row of (homeResult as unknown as Row[][])[0]) splitOf.set(String(row.bucket), row)

  const nameOf = new Map<string, string>()
  for (const row of (nameResult as unknown as NameRow[][])[0]) {
    nameOf.set(`${row.amppart}${row.tmbpart}`, String(row.name).trim())
  }

  const districtOf = new Map<string, SepsisDistrict>()
  const outside: SepsisAreaTotals = { ci: { total: 0, dead: 0 }, hi: { total: 0, dead: 0 } }
  const inProvince: SepsisAreaTotals = { ci: { total: 0, dead: 0 }, hi: { total: 0, dead: 0 } }

  for (const row of (areaResult as unknown as AreaRow[][])[0]) {
    const counts = countsOf(row)
    // district เป็น NULL คือทะเบียนบ้านอยู่นอกจังหวัด (หรือไม่มีทะเบียน) — ไม่เข้า
    // กราฟรายอำเภอ แต่ต้องรายงานไว้ ไม่ใช่หายไปจนผลรวมไม่ตรงกับกราฟตามเวลา
    if (row.district == null) {
      add(outside.ci, counts.ci)
      add(outside.hi, counts.hi)
      continue
    }
    add(inProvince.ci, counts.ci)
    add(inProvince.hi, counts.hi)

    const amp = String(row.district)
    const tmb = String(row.tambon ?? '')
    let district = districtOf.get(amp)
    if (district == null) {
      district = {
        id: amp,
        // อำเภอที่ไม่มีชื่อในทะเบียนยังต้องขึ้นกราฟ ไม่ใช่หายไปพร้อมผู้ป่วยของมัน
        name: nameOf.get(`${amp}00`) ?? `อำเภอรหัส ${amp}`,
        ci: { total: 0, dead: 0 },
        hi: { total: 0, dead: 0 },
        ciNonReferred: { total: 0, dead: 0 },
        referredIn: 0,
        tambons: [],
      }
      districtOf.set(amp, district)
    }
    add(district.ci, counts.ci)
    add(district.hi, counts.hi)
    add(district.ciNonReferred, counts.ciNonReferred)
    district.referredIn += counts.referredIn
    district.tambons.push({
      id: tmb,
      name: nameOf.get(`${amp}${tmb}`) ?? 'ไม่ระบุตำบล',
      ...counts,
    })
  }

  const districts = [...districtOf.values()].sort((a, b) => b.ci.total - a.ci.total)
  for (const district of districts) district.tambons.sort((a, b) => b.ci.total - a.ci.total)

  const hospitals: SepsisReferral[] = []
  const referralTotals = { ci: { total: 0, dead: 0 }, shock: { total: 0, dead: 0 } }
  for (const row of (referralResult as unknown as ReferralRow[][])[0]) {
    const ci = { total: Number(row.ci_total), dead: Number(row.ci_dead) }
    const shock = { total: Number(row.shock_total), dead: Number(row.shock_dead) }
    add(referralTotals.ci, ci)
    add(referralTotals.shock, shock)
    const code = String(row.code ?? '').trim()
    hospitals.push({
      code,
      // ทะเบียนส่งต่อมีแถวที่รหัสต้นทางว่างอยู่จริง (วัดแล้วหนึ่ง AN ในห้าปี)
      // ต้องขึ้นตารางในฐานะ "ไม่ระบุ" ไม่ใช่หายไปจนผลรวมไม่ตรง
      name: row.name == null || row.name === '' ? (code === '' ? 'ไม่ระบุต้นทาง' : `รหัส ${code}`) : String(row.name).trim(),
      ci,
      shock,
    })
  }
  hospitals.sort((a, b) => b.ci.total - a.ci.total)

  const zeroBins = (): Record<SepsisIcuBin, number> =>
    Object.fromEntries(SEPSIS_ICU_BINS.map(bin => [bin, 0])) as Record<SepsisIcuBin, number>

  const zeroIcu = (): Record<SepsisIcuScope, SepsisIcuCounts> => ({
    all: { admissions: 0, bins: zeroBins() },
    ci: { admissions: 0, bins: zeroBins() },
  })

  // หอ ICU ทั้งห้าตั้งไว้ล่วงหน้าแม้ไม่มีผู้ป่วย — หอที่ว่างในช่วงนั้นต้องยังขึ้น
  // กราฟเป็นแท่งศูนย์ ไม่ใช่หายไป เพราะตำแหน่งแท่งที่ขยับทำให้เทียบช่วงกันผิด
  const icuWardOf: Record<SepsisIcuScope, Map<string, SepsisIcuWard>> = {
    all: new Map(SEPSIS_ICU_WARDS.map(w => [w.ward, { ...w, patients: 0, bins: zeroBins() }])),
    ci: new Map(SEPSIS_ICU_WARDS.map(w => [w.ward, { ...w, patients: 0, bins: zeroBins() }])),
  }

  const icuOf = new Map<string, Record<SepsisIcuScope, SepsisIcuCounts>>()
  for (const row of (icuResult as unknown as IcuRow[][])[0]) {
    const bin = String(row.bin) as SepsisIcuBin
    const count = Number(row.n)
    const key = String(row.bucket)
    let period = icuOf.get(key)
    if (period == null) {
      period = zeroIcu()
      icuOf.set(key, period)
    }
    // AN ที่เป็น CI นับเข้าทั้งสองตัวหาร — 'all' คือทุกราย ไม่ใช่ "ที่ไม่ใช่ CI"
    const which: SepsisIcuScope[] = Number(row.ci) === 1 ? ['all', 'ci'] : ['all']
    const ward = String(row.ward ?? '')
    for (const name of which) {
      period[name].admissions += count
      period[name].bins[bin] += count
      // ward ว่างคือไม่เคยเข้า ICU — ไม่เข้ากราฟรายหอ แต่ยังอยู่ในตัวหาร
      if (ward === '') continue
      const entry = icuWardOf[name].get(ward)
      if (entry == null) continue
      entry.patients += count
      entry.bins[bin] += count
    }
  }

  const zero = (): Record<SepsisGroup, SepsisCount> =>
    Object.fromEntries(SEPSIS_GROUPS.map(group => [group, { total: 0, dead: 0 }])) as Record<
      SepsisGroup,
      SepsisCount
    >

  return {
    by: plan.by,
    from: plan.from,
    to: plan.to,
    currentFiscalYear: currentFiscalYear(now),
    fiscalYear: plan.fiscalYear,
    quarter: plan.quarter,
    // ไล่จากรายการช่วงที่ต้องการ ไม่ใช่จากแถวที่ฐานคืนมา — ช่วงที่ไม่มีผู้ป่วยเลย
    // ต้องยังขึ้นบนกราฟเป็นศูนย์ ไม่ใช่หายไปเงียบ ๆ จนคนนับแท่งผิด
    periods: plan.periods.map(({ key, partial }) => {
      const row = found.get(key)
      const groups = zero()
      if (row != null) {
        for (const group of SEPSIS_GROUPS) {
          groups[group] = {
            total: Number(row[`${group}_total`] ?? 0),
            dead: Number(row[`${group}_dead`] ?? 0),
          }
        }
      }
      const split = splitOf.get(key)
      return {
        key,
        partial,
        groups,
        splits: Object.fromEntries(
          SEPSIS_SPLITS.map(name => [
            name,
            {
              total: Number(split?.[`${name}_total`] ?? 0),
              dead: Number(split?.[`${name}_dead`] ?? 0),
            },
          ]),
        ) as Record<SepsisSplit, SepsisCount>,
        homeReferral: {
          ci: Number(split?.home_ci ?? 0),
          referredIn: Number(split?.home_referred ?? 0),
        },
        icu: icuOf.get(key) ?? zeroIcu(),
      }
    }),
    areas: { districts, outside, inProvince, homeDistrict: HOSPITAL_DISTRICT },
    referrals: { hospitals, ci: referralTotals.ci, shock: referralTotals.shock },
    icuWards: {
      all: [...icuWardOf.all.values()],
      ci: [...icuWardOf.ci.values()],
    },
    coding,
  }
}
