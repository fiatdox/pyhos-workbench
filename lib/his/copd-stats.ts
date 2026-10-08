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
  COPD_AGE_BANDS,
  COPD_DISEASES,
  COPD_DRUG_TIERS,
  PNEUMONIA_SCOPES,
  type CopdAgeBand,
  type CopdCount,
  type CopdDisease,
  type CopdDiseaseStats,
  type CopdDrugs,
  type CopdDrugTier,
  type CopdDrugTierCount,
  type CopdPeriod,
  type PneumoniaScope,
} from '@/lib/his/copd-groups'

/* ช่วงเวลา ปีงบ ไตรมาส ใช้ของกลางร่วมกับหน้า Stroke และ Sepsis */
export type { FiscalQuarter } from '@/lib/his/fiscal-period'
export { shownFiscalYears } from '@/lib/his/fiscal-period'
export type CopdQuery = PeriodQuery

export {
  COPD_AGE_BANDS,
  COPD_DISEASES,
  COPD_DRUG_TIERS,
  PNEUMONIA_SCOPES,
} from '@/lib/his/copd-groups'
export type {
  CopdAgeBand,
  CopdCount,
  CopdDisease,
  CopdDiseaseStats,
  CopdDrugs,
  CopdDrugTier,
  CopdDrugTierCount,
  CopdPeriod,
  PneumoniaScope,
} from '@/lib/his/copd-groups'

/**
 * Service Plan สาขาโรคปอดอุดกั้นเรื้อรัง — ปอดบวมและ COPD
 *
 * สี่ตัวชี้วัดที่ได้รับมา:
 *
 *   1  ร้อยละการเสียชีวิตในโรงพยาบาลของผู้ป่วยปอดบวม
 *      ตัวหาร: การนอนที่มีรหัสปอดบวมอยู่ · ตัวตั้ง: ที่จำหน่ายด้วยสถานะเสียชีวิต
 *   2  ผู้ป่วยในโรคปอดอุดกั้นเรื้อรัง (J44 เป็นโรคหลัก) แยกตามช่วงอายุ
 *   3  ผู้ป่วยในโรคหืด (J45-J46 เป็นโรคหลัก) แยกตามช่วงอายุ — คิวรีรูปเดียวกับ
 *      ข้อ 2 ต่างแค่ช่วงรหัส จึงรวมมาเป็นคิวรีเดียวที่ติดชื่อโรคให้แต่ละแถว
 *   4  การใช้ยาสูดพ่นของผู้ป่วยนอก COPD จำแนกตามขั้นของยา
 *
 * **แก้สามเรื่องจากคิวรีที่ได้รับมา ทุกเรื่องวัดผลต่างไว้แล้ว**
 *
 * หนึ่ง — รายการรหัสปอดบวมในคิวรีต้นฉบับเขียนจุดทศนิยมไว้
 * (`icd10 IN ('J10.0','J11.0','J18','J85.0','J85.1')`) แต่ฐานนี้เก็บรหัสแบบไม่มีจุด
 * (J100, J110, J180, J850, J851) เงื่อนไขนั้นจึงจับไม่ได้เลยสักแถว — วัดแล้วได้ศูนย์
 * ผลคือกลุ่ม J18 ทั้งก้อน (ปอดบวมไม่ระบุเชื้อ ซึ่งเป็นรหัสที่ลงมากที่สุด 419 + 128
 * แถว) หายไปทั้งหมด เหลือแต่ J12-J17 ที่เขียนด้วย LEFT(icd10,3) ซึ่งทำงานได้
 * ตัวเลขต่างกันราวสี่เท่า: ปีงบ 2569 ได้ 379 ราย เทียบกับ 1,977 รายเมื่อแก้รหัสแล้ว
 * โค้ดนี้ใช้ชุดที่แก้แล้ว แต่ยังนับชุดเดิมคู่ไว้ให้เทียบ (pneumoniaAsWritten)
 *
 * สอง — หัวคอลัมน์ของคิวรีนั้นเขียนว่า “PDx หรือ SDx” แต่ตัว EXISTS ไม่ได้กรอง
 * diagtype เลย จึงนับการวินิจฉัยทุกประเภทรวมทั้งที่เกิดระหว่างนอน (diagtype 3)
 * ด้วย ไม่ได้เดาแทนว่าอันไหนถูก — คืนทั้งสองขอบเขตให้เลือกดู (PNEUMONIA_SCOPES)
 * วัดแล้วต่างกันราว 11% (ปีงบ 2569: 1,977 เทียบ 1,761)
 *
 * สาม — การนับผู้ป่วยปอดบวมของคิวรีต้นฉบับใช้ COUNT(p.an) บนผลของ LEFT JOIN
 * ซึ่งถูกเพราะชั้นในยุบเป็นหนึ่งแถวต่อ AN อยู่แล้ว แต่ของ J44 ใช้ COUNT(*) บน
 * ipt × iptdiag โดยที่ช่วงอายุใช้ COUNT(DISTINCT an) — สองอย่างในคิวรีเดียวกัน
 * นับคนละหน่วย วัดแล้วกรณีนี้ไม่ต่างกัน (J44 ที่เป็นโรคหลักมีหนึ่งแถวต่อ AN พอดี
 * 2,877 แถว = 2,877 AN) แต่โค้ดนี้ยุบเป็นหนึ่งแถวต่อ AN ทุกตัวนับ ไม่พึ่งโชค
 *
 * **การเสียชีวิตนับจาก dchtype '08' และ '09' เท่านั้น** ตามที่คิวรีทั้งสองใช้ และ
 * ตรงกับทะเบียน dchtype ของ HIS (08 = Dead Autopsy · 09 = Dead Non Autopsy)
 * ส่วน '02' คือ Against Advice (กลับบ้านโดยไม่สมัครใจ) ไม่ใช่การเสียชีวิต —
 * ตรงนี้**ต่างจากหน้า Sepsis** ที่นับ 02 เป็นการเสียชีวิตด้วยตามคิวรีที่ได้รับมา
 * สำหรับหน้านั้น ผลต่างของปอดบวมอยู่ที่ราว 17% (ปีงบ 2569: 386 เทียบ 433 ราย)
 * สองหน้าจึงใช้นิยามการตายไม่ตรงกันอยู่ เป็นเรื่องที่คณะกรรมการต้องตัดสิน
 */

/** ประเภทการจำหน่ายที่ถือว่าเสียชีวิต — ตรงกับทะเบียน dchtype ของ HIS */
const DEAD_DISCHARGE_TYPES = "'08','09'"

/** โรคหลักหรือโรคร่วมแรกรับ — ที่หัวคอลัมน์ของคิวรีต้นฉบับเรียกว่า PDx หรือ SDx */
const PRIMARY_DIAGTYPES = "('1','2')"

/**
 * รหัสปอดบวมตามเจตนาของรายการที่ได้รับมา — ตัดจุดทศนิยมออกแล้ว
 *
 * J100/J110 ปอดบวมจากไข้หวัดใหญ่ · J12-J17 ปอดบวมแยกตามเชื้อ · J18 ปอดบวมไม่ระบุ
 * เชื้อ · J850/J851 ฝีในปอด — ใช้ LIKE กับกลุ่มที่ต้องครอบรหัสลูก และ LEFT(,3)
 * กับช่วงที่ต่อเนื่องกัน
 */
const PNEUMONIA_CODES = `(
  dx.icd10 LIKE 'J100%' OR dx.icd10 LIKE 'J110%'
  OR LEFT(dx.icd10, 3) BETWEEN 'J12' AND 'J17'
  OR dx.icd10 LIKE 'J18%'
  OR dx.icd10 LIKE 'J850%' OR dx.icd10 LIKE 'J851%'
)`

/** รายการรหัสเดิมแบบที่คิวรีต้นฉบับเขียนไว้ — เก็บไว้เทียบ ไม่ได้ใช้คิดอัตรา */
const PNEUMONIA_AS_WRITTEN = `(
  dx.icd10 IN ('J10.0', 'J11.0', 'J18', 'J85.0', 'J85.1')
  OR LEFT(dx.icd10, 3) BETWEEN 'J12' AND 'J16'
  OR LEFT(dx.icd10, 3) = 'J17'
)`

/**
 * ช่วงรหัสของโรคที่รายงานผู้ป่วยในแยกตามช่วงอายุ
 *
 * ตรวจกับฐานแล้วทั้งสองช่วง — J44 มีรหัสลูกจึงใช้ LIKE · ส่วนหืดใช้ BETWEEN
 * 'J45' AND 'J46' ตามคิวรีที่ได้รับมา ซึ่งวัดแล้วจับได้ครบ 3,915 แถวเท่ากับ
 * LEFT(icd10,3) IN ('J45','J46') พอดี เพราะ J46 (status asthmaticus) ไม่มีรหัสลูก
 * ในฐานนี้ ถ้าวันหนึ่งมี J46x โผล่มา BETWEEN จะจับไม่ได้ แต่ ณ วันนี้ไม่มีปัญหา
 * (ต่างจากรายการรหัสปอดบวมที่พลาดเพราะเขียนจุดทศนิยม)
 *
 * กติกาที่ตกลงกันไว้คือ**ช่วงรหัสในตัวชี้วัดหมายถึงรหัสย่อยทุกตัว** ที่นี่จึงยัง
 * ถูกเพราะวัดแล้วจับครบพอดี ไม่ใช่เพราะ BETWEEN เป็นวิธีที่ถูก — J46 ไม่มีรหัสลูก
 * จึงรอดไปโดยบังเอิญ
 */
const DISEASE_CODES: Record<CopdDisease, string> = {
  copd: `a.icd10 LIKE 'J44%'`,
  asthma: `a.icd10 BETWEEN 'J45' AND 'J46'`,
}

/** เงื่อนไขรวมของทั้งสองโรค — ใช้กรองชุด AN ในคิวรีเดียว */
const ANY_DISEASE = COPD_DISEASES.map(disease => `(${DISEASE_CODES[disease]})`).join(' OR ')

/**
 * นิพจน์ติดชื่อโรคให้แต่ละแถว
 *
 * ปลอดภัยที่จะไล่ CASE ตามลำดับ เพราะหนึ่งการนอนมีโรคหลักได้รหัสเดียว สองโรค
 * จึงไม่ซ้อนกันเลย — ไม่เหมือนธงของหน้า Sepsis ที่ซ้อนกันได้
 */
const DISEASE_TAG = `CASE ${COPD_DISEASES.map(
  disease => `WHEN ${DISEASE_CODES[disease]} THEN '${disease}'`,
).join(' ')} END`

/**
 * รหัสยาสูดพ่นของแต่ละขั้น ตามที่ได้รับมา
 *
 * ตรวจชื่อยาในทะเบียน drugitems แล้วทุกรหัส — 1000235 SYMBICORT Turbuhaler
 * (budesonide + formoterol) · 1001156 SERETIDE Accuhaler, 1580006 และ 1670134
 * SERETIDE-250 Evohaler (salmeterol + fluticasone 250) · 1670106 และ 1000938
 * EVOFLO-125 Evohaler (salmeterol + fluticasone 125 คนละผู้ผลิต) · 1001112
 * SPIRIVA Powder Inh. Capsule (tiotropium)
 *
 * ลำดับขั้น D > C > B > A มาจากคิวรีที่ได้รับมา ไม่ได้จัดเอง — และสังเกตว่า
 * EVOFLO-125 มี fluticasone น้อยกว่า SERETIDE-250 แต่อยู่ขั้นต่ำกว่า ส่วน
 * SYMBICORT เป็นยาคนละโมเลกุล การเรียงนี้จึงเป็นข้อตกลงของบัญชียาโรงพยาบาล
 * ไม่ใช่ลำดับความแรงทางเภสัชวิทยา เป็นเรื่องที่คณะกรรมการต้องยืนยัน
 */
const DRUG_TIER_CODES: Record<CopdDrugTier, string> = {
  symbicort: `'1000235'`,
  seretide: `'1001156','1580006','1670134'`,
  evoflo: `'1670106','1000938'`,
  spiriva: `'1001112'`,
}

/** รหัสของ Spiriva เอง — ใช้ตรวจว่าชื่อขั้นที่อ่านว่า "Spiriva_X" เป็นจริงไหม */
const SPIRIVA_CODE = `'1001112'`

/**
 * ยาสูดพ่นที่ผู้ป่วย COPD ได้รับจริงแต่ไม่อยู่ในรายการเจ็ดรหัส
 *
 * 1610055 Spiolto Respimat (tiotropium + olodaterol) — วัดแล้วมีผู้ป่วย COPD
 * ได้รับเพิ่มขึ้นทุกปี (8 → 17 → 66 → 104 ราย) และบางรายไม่ได้ยาในรายการเลย
 * จึงหายไปจากรายงานทั้งหมดถ้านับตามรายการเดิม นับแยกไว้ให้เห็น ไม่จัดขั้นให้เอง
 * เพราะเป็น LAMA + LABA ที่ไม่มีในลำดับขั้นที่ได้รับมา
 *
 * รหัสที่อยู่ในทะเบียนแต่ไม่มีการจ่ายให้ผู้ป่วย COPD เลยในห้าปี (1550119 และ
 * 1001177 SPIRIVA รหัสเก่า · 1550198 SE-RE-TIDE · 1630147 RELVAR Ellipta)
 * ไม่ได้ใส่ไว้ เพราะใส่แล้วก็ได้ศูนย์
 */
const OUTSIDE_DRUG_CODES = `'1610055'`

/** รหัสยาทั้งหมดที่คิวรีต้องดึงมา — ในรายการบวกที่อยู่นอกรายการ */
const ALL_DRUG_CODES = [...Object.values(DRUG_TIER_CODES), OUTSIDE_DRUG_CODES].join(',')

/**
 * เงื่อนไขไล่ขั้นของยา — เรียงตาม COPD_DRUG_TIERS ซึ่งเรียงจากขั้นสูงสุดลงไป
 *
 * ลำดับของ WHEN คือลำดับความสำคัญ ตัวแรกที่เข้าเงื่อนไขชนะ จึงได้ "ขั้นสูงสุดที่
 * ผู้ป่วยได้รับในช่วงนั้น" ตามที่คิวรีต้นฉบับทำ — ถ้าสลับลำดับในรายการ ความหมาย
 * ของตัวเลขจะเปลี่ยนทันที
 */
const tierCase = COPD_DRUG_TIERS.map(
  tier =>
    `WHEN MAX(CASE WHEN o.icode IN (${DRUG_TIER_CODES[tier]}) THEN 1 ELSE 0 END) = 1 THEN '${tier}'`,
).join(' ')

/**
 * กลุ่มผู้ป่วย COPD ของตัวชี้วัดการใช้ยา — คนที่**เคย**มีรหัส J44 เป็นโรคหลัก
 * ของผู้ป่วยนอก ไม่จำกัดปี ตามคิวรีที่ได้รับมา
 *
 * อ่าน hn จาก ovstdiag ตรง ๆ ไม่ต้องต่อ vn_stat เข้ามาเหมือนคิวรีต้นฉบับ —
 * ตารางนั้นมีคอลัมน์ hn อยู่แล้ว การต่อเพิ่มได้ผลเท่ากันแต่ทำให้ช้าลง และวัดแล้ว
 * ทำให้ผู้ป่วยตกหายไปหนึ่งรายด้วย (6,227 เทียบ 6,228 คน) เพราะมี visit ที่ไม่มี
 * แถวใน vn_stat
 *
 * ขอบเขตนี้นับแต่การวินิจฉัยฝั่งผู้ป่วยนอก ถ้ารวมโรคหลักของผู้ป่วยในด้วยกลุ่มจะ
 * ใหญ่ขึ้นเป็น 7,200 คน และตัวเลขสุดท้ายเพิ่มราว 5% (ปีงบ 2569: 987 เป็น 1,036)
 * โค้ดนี้คงขอบเขตที่ได้รับมาไว้ เป็นอีกข้อที่คณะกรรมการตัดสินได้
 */
const COPD_COHORT = `
  SELECT DISTINCT od.hn
  FROM ovstdiag od
  WHERE od.icd10 LIKE 'J44%' AND od.diagtype = '1'
`

/** ขอบล่างของช่วงอายุแต่ละช่วง — ใช้สร้างทั้งนิพจน์ SQL และป้ายที่หน้าจอ */
const AGE_BREAKS: Record<CopdAgeBand, number> = {
  under15: 0,
  age15to39: 15,
  age40to49: 40,
  age50to59: 50,
  age60up: 60,
}

/** นิพจน์จัดช่วงอายุ — อายุที่ไม่มีในทะเบียนได้ NULL แล้วไปลงถัง ageUnknown */
const AGE_BAND = `CASE
  WHEN s.age_y IS NULL THEN NULL
  WHEN s.age_y < ${AGE_BREAKS.age15to39} THEN 'under15'
  WHEN s.age_y < ${AGE_BREAKS.age40to49} THEN 'age15to39'
  WHEN s.age_y < ${AGE_BREAKS.age50to59} THEN 'age40to49'
  WHEN s.age_y < ${AGE_BREAKS.age60up} THEN 'age50to59'
  ELSE 'age60up'
END`

export type CopdStats = {
  by: 'fiscalYear' | 'month'
  from: string
  to: string
  currentFiscalYear: number
  fiscalYear: number | null
  quarter: 1 | 2 | 3 | 4 | null
  periods: CopdPeriod[]
  coding: CodingCompleteness
}

type Row = Record<string, string | number | null>

const zeroCount = (): CopdCount => ({ total: 0, dead: 0 })

const countOf = (row: Row | undefined, prefix: string): CopdCount => ({
  total: Number(row?.[`${prefix}_total`] ?? 0),
  dead: Number(row?.[`${prefix}_dead`] ?? 0),
})

/**
 * สถิติปอดบวมและ COPD ตามช่วงที่ขอ — ไม่มีข้อมูลรายบุคคลออกจากฟังก์ชันนี้เลย
 *
 * สองคิวรียิงขนานกัน เพราะถามจากชุด AN ที่ต่างกันคนละขอบเขต: ตัวแรกต้องไล่
 * **ผู้ป่วยในทุกคน** (เพื่อให้ได้ทั้งธงปอดบวมและตัวหารจำนวนผู้ป่วยในทั้งหมด
 * ในรอบเดียว) ตัวที่สองจำกัดแค่ AN ที่มี J44 เป็นโรคหลัก ซึ่งกรองด้วยดัชนีรหัส
 * ได้ตั้งแต่ต้น การรวมสองอย่างเข้าด้วยกันจะบังคับให้ชุดที่แคบไปไล่ตามชุดที่กว้าง
 *
 * วัดจากฐานจริง: ห้าปีงบ 3.0 วินาที · รายเดือนของปีเดียว 0.70 · ไตรมาส 0.21
 */
export async function getCopdStats(
  query: CopdQuery = { by: 'fiscalYear' },
  now = new Date(),
): Promise<CopdStats> {
  const plan = planOf(query, now)
  const bucket = bucketExpression(plan.by, 'i.dchdate')

  const dead = `MAX(CASE WHEN i.dchtype IN (${DEAD_DISCHARGE_TYPES}) THEN 1 ELSE 0 END)`

  /**
   * ปอดบวมและจำนวนผู้ป่วยในทั้งหมด รายช่วงเวลา
   *
   * ชั้นในยุบเป็นหนึ่งแถวต่อ AN แล้วติดธงสามอัน (ชุดรหัสที่แก้แล้ว ชุดเดิม และ
   * ชุดที่แก้แล้วแต่จำกัด PDx/SDx) ชั้นนอกรวมตามช่วง — COUNT(*) ของชั้นนอกจึง
   * เป็นจำนวนผู้ป่วยในทั้งหมด ไม่ใช่จำนวนผู้ป่วยปอดบวม
   *
   * ใช้ LEFT JOIN ไม่ใช่ JOIN เพราะการนอนที่ยังไม่ได้ลงรหัสอะไรเลยก็ยังต้องนับ
   * เข้าตัวหารของอัตราผู้ป่วยใน ไม่ใช่หายไปจนตัวหารเล็กกว่าความจริง
   */
  const pneumonia = `
    SELECT bucket,
           COUNT(*) AS admissions,
           SUM(pn) AS any_total,
           SUM(pn * is_dead) AS any_dead,
           SUM(pnp) AS primary_total,
           SUM(pnp * is_dead) AS primary_dead,
           SUM(old) AS written_total,
           SUM(old * is_dead) AS written_dead
    FROM (
      SELECT ${bucket} AS bucket,
             i.an,
             ${dead} AS is_dead,
             MAX(CASE WHEN ${PNEUMONIA_CODES} THEN 1 ELSE 0 END) AS pn,
             MAX(CASE WHEN ${PNEUMONIA_CODES} AND dx.diagtype IN ${PRIMARY_DIAGTYPES} THEN 1 ELSE 0 END) AS pnp,
             MAX(CASE WHEN ${PNEUMONIA_AS_WRITTEN} THEN 1 ELSE 0 END) AS old
      FROM ipt i
      LEFT JOIN iptdiag dx ON dx.an = i.an
      WHERE i.dchdate BETWEEN '${plan.from}' AND '${plan.to}'
      GROUP BY bucket, i.an
    ) AS admissions
    GROUP BY bucket
    ORDER BY bucket
  `

  /**
   * ผู้ป่วยใน COPD แยกช่วงอายุ รายช่วงเวลา
   *
   * ยุบเป็นหนึ่งแถวต่อ AN ก่อนนับ ไม่ได้ COUNT(*) บนผล join ตรง ๆ — วัดแล้วกรณีนี้
   * ไม่ต่างกันเพราะโรคหลักมีรหัสเดียวต่อ AN แต่ถ้าวันหนึ่งมีการลงซ้ำ ตัวเลขจะไม่
   * บวมขึ้นเงียบ ๆ
   *
   * อายุอ่านจาก an_stat.age_y ซึ่งเป็นอายุ ณ วันรับเข้านอนที่ HIS คำนวณไว้แล้ว
   * ไม่ได้คิดจากวันเกิดเอง เพื่อให้ตรงกับคิวรีที่ได้รับมาและกับรายงานอื่นของ HIS
   */
  const inpatient = `
    SELECT bucket,
           disease,
           COALESCE(band, '') AS band,
           COUNT(*) AS total,
           SUM(is_dead) AS dead
    FROM (
      SELECT ${bucket} AS bucket,
             i.an,
             ${dead} AS is_dead,
             ${DISEASE_TAG} AS disease,
             ${AGE_BAND} AS band
      FROM ipt i
      JOIN iptdiag a ON a.an = i.an AND a.diagtype = '1' AND (${ANY_DISEASE})
      LEFT JOIN an_stat s ON s.an = i.an
      WHERE i.dchdate BETWEEN '${plan.from}' AND '${plan.to}'
      GROUP BY bucket, i.an, disease, band
    ) AS x
    GROUP BY bucket, disease, band
  `

  /**
   * การใช้ยาสูดพ่นของผู้ป่วย COPD จำแนกตามขั้นของยา
   *
   * ชั้นในยุบเป็นหนึ่งแถวต่อ (ช่วงเวลา × ผู้ป่วย) แล้วตัดสินขั้นสูงสุดที่ได้รับ
   * ในช่วงนั้น ชั้นนอกรวมเป็นจำนวนผู้ป่วยต่อขั้น — หน่วยนับจึงเป็นคน ไม่ใช่ใบสั่งยา
   *
   * ดึงยานอกรายการมาในคิวรีเดียวกันด้วย แถวที่ tier เป็น NULL คือผู้ป่วยที่ได้
   * ยานอกรายการอย่างเดียว ซึ่งคิวรีต้นฉบับตัดออกด้วย HAVING จนมองไม่เห็นว่ามีอยู่
   *
   * ไม่ต้องมี HAVING กันค่า NULL เหมือนคิวรีต้นฉบับ เพราะ WHERE จำกัด icode ไว้
   * ในรายการอยู่แล้ว ทุกกลุ่มจึงเข้าเงื่อนไขใดเงื่อนไขหนึ่งแน่นอน ยกเว้นกลุ่มที่
   * ได้ยานอกรายการอย่างเดียวซึ่งที่นี่ตั้งใจเก็บไว้
   *
   * วัดจากฐานจริง 0.84 วินาทีสำหรับห้าปีงบ
   */
  const drugs = `
    SELECT bucket,
           COALESCE(tier, '') AS tier,
           COUNT(*) AS patients,
           SUM(has_spiriva) AS with_spiriva,
           SUM(has_outside) AS with_outside
    FROM (
      SELECT ${bucketExpression(plan.by, 'o.vstdate')} AS bucket,
             o.hn,
             MAX(CASE WHEN o.icode IN (${SPIRIVA_CODE}) THEN 1 ELSE 0 END) AS has_spiriva,
             MAX(CASE WHEN o.icode IN (${OUTSIDE_DRUG_CODES}) THEN 1 ELSE 0 END) AS has_outside,
             CASE ${tierCase} ELSE NULL END AS tier
      FROM opitemrece o
      JOIN (${COPD_COHORT}) AS cohort ON cohort.hn = o.hn
      WHERE o.vstdate BETWEEN '${plan.from}' AND '${plan.to}'
        AND o.icode IN (${ALL_DRUG_CODES})
      GROUP BY bucket, o.hn
    ) AS x
    GROUP BY bucket, tier
  `

  const [pneumoniaResult, inpatientResult, drugResult, coding] = await Promise.all([
    hisDb.execute(sql.raw(pneumonia)),
    hisDb.execute(sql.raw(inpatient)),
    hisDb.execute(sql.raw(drugs)),
    codingCompleteness(thisMonth(now)),
  ])

  const pneumoniaOf = new Map<string, Row>()
  for (const row of (pneumoniaResult as unknown as Row[][])[0]) {
    pneumoniaOf.set(String(row.bucket), row)
  }

  const zeroDisease = (): CopdDiseaseStats => ({
    total: zeroCount(),
    ages: Object.fromEntries(COPD_AGE_BANDS.map(band => [band, zeroCount()])) as Record<
      CopdAgeBand,
      CopdCount
    >,
    ageUnknown: zeroCount(),
  })

  const zeroInpatient = (): Record<CopdDisease, CopdDiseaseStats> =>
    Object.fromEntries(COPD_DISEASES.map(disease => [disease, zeroDisease()])) as Record<
      CopdDisease,
      CopdDiseaseStats
    >

  /** ยอดรายโรครายช่วง และยอดแยกช่วงอายุ — มาจากแถวเดียวกัน ไล่รวมทีเดียว */
  const inpatientOf = new Map<string, Record<CopdDisease, CopdDiseaseStats>>()
  for (const row of (inpatientResult as unknown as Row[][])[0]) {
    const key = String(row.bucket)
    let entry = inpatientOf.get(key)
    if (entry == null) {
      entry = zeroInpatient()
      inpatientOf.set(key, entry)
    }
    const disease = String(row.disease ?? '')
    if (!(COPD_DISEASES as readonly string[]).includes(disease)) continue
    const stats = entry[disease as CopdDisease]
    const count = { total: Number(row.total), dead: Number(row.dead) }
    stats.total.total += count.total
    stats.total.dead += count.dead
    // band ว่างคือไม่มีอายุในทะเบียน — ต้องยังบวกเข้ายอดรวม แล้วแยกถังไว้
    const band = String(row.band ?? '')
    const target = (COPD_AGE_BANDS as readonly string[]).includes(band)
      ? stats.ages[band as CopdAgeBand]
      : stats.ageUnknown
    target.total += count.total
    target.dead += count.dead
  }

  const zeroDrugs = (): CopdDrugs => ({
    tiers: Object.fromEntries(
      COPD_DRUG_TIERS.map(tier => [tier, { patients: 0, withSpiriva: 0, withOutside: 0 }]),
    ) as Record<CopdDrugTier, CopdDrugTierCount>,
    outside: 0,
    outsideOnly: 0,
  })

  const drugsOf = new Map<string, CopdDrugs>()
  for (const row of (drugResult as unknown as Row[][])[0]) {
    const key = String(row.bucket)
    let entry = drugsOf.get(key)
    if (entry == null) {
      entry = zeroDrugs()
      drugsOf.set(key, entry)
    }
    const patients = Number(row.patients)
    const withOutside = Number(row.with_outside)
    entry.outside += withOutside
    const tier = String(row.tier ?? '')
    // tier ว่างคือได้ยานอกรายการอย่างเดียว — ไม่เข้าขั้นไหน แต่ต้องรายงานไว้
    if (!(COPD_DRUG_TIERS as readonly string[]).includes(tier)) {
      entry.outsideOnly += patients
      continue
    }
    const target = entry.tiers[tier as CopdDrugTier]
    target.patients += patients
    target.withSpiriva += Number(row.with_spiriva)
    target.withOutside += withOutside
  }

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
      const row = pneumoniaOf.get(key)
      return {
        key,
        partial,
        pneumonia: Object.fromEntries(
          PNEUMONIA_SCOPES.map(scope => [scope, countOf(row, scope)]),
        ) as Record<PneumoniaScope, CopdCount>,
        pneumoniaAsWritten: countOf(row, 'written'),
        inpatient: inpatientOf.get(key) ?? zeroInpatient(),
        admissions: Number(row?.admissions ?? 0),
        drugs: drugsOf.get(key) ?? zeroDrugs(),
      }
    }),
    coding,
  }
}
