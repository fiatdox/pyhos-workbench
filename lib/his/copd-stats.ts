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
  PNEUMONIA_SCOPES,
  type CopdAgeBand,
  type CopdCount,
  type CopdPeriod,
  type PneumoniaScope,
} from '@/lib/his/copd-groups'

/* ช่วงเวลา ปีงบ ไตรมาส ใช้ของกลางร่วมกับหน้า Stroke และ Sepsis */
export type { FiscalQuarter } from '@/lib/his/fiscal-period'
export { shownFiscalYears } from '@/lib/his/fiscal-period'
export type CopdQuery = PeriodQuery

export {
  COPD_AGE_BANDS,
  PNEUMONIA_SCOPES,
} from '@/lib/his/copd-groups'
export type {
  CopdAgeBand,
  CopdCount,
  CopdPeriod,
  PneumoniaScope,
} from '@/lib/his/copd-groups'

/**
 * Service Plan สาขาโรคปอดอุดกั้นเรื้อรัง — ปอดบวมและ COPD
 *
 * สองตัวชี้วัดที่ได้รับมา:
 *
 *   1  ร้อยละการเสียชีวิตในโรงพยาบาลของผู้ป่วยปอดบวม
 *      ตัวหาร: การนอนที่มีรหัสปอดบวมอยู่ · ตัวตั้ง: ที่จำหน่ายด้วยสถานะเสียชีวิต
 *   2  ผู้ป่วยในโรคปอดอุดกั้นเรื้อรัง (J44 เป็นโรคหลัก) แยกตามช่วงอายุ
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

/** โรคปอดอุดกั้นเรื้อรังที่เป็นโรคหลัก */
const COPD_CODES = `(a.icd10 LIKE 'J44%')`

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
  const copd = `
    SELECT bucket,
           COALESCE(band, '') AS band,
           COUNT(*) AS total,
           SUM(is_dead) AS dead
    FROM (
      SELECT ${bucket} AS bucket,
             i.an,
             ${dead} AS is_dead,
             ${AGE_BAND} AS band
      FROM ipt i
      JOIN iptdiag a ON a.an = i.an AND a.diagtype = '1' AND ${COPD_CODES}
      LEFT JOIN an_stat s ON s.an = i.an
      WHERE i.dchdate BETWEEN '${plan.from}' AND '${plan.to}'
      GROUP BY bucket, i.an, band
    ) AS x
    GROUP BY bucket, band
  `

  const [pneumoniaResult, copdResult, coding] = await Promise.all([
    hisDb.execute(sql.raw(pneumonia)),
    hisDb.execute(sql.raw(copd)),
    codingCompleteness(thisMonth(now)),
  ])

  const pneumoniaOf = new Map<string, Row>()
  for (const row of (pneumoniaResult as unknown as Row[][])[0]) {
    pneumoniaOf.set(String(row.bucket), row)
  }

  /** ยอด COPD รายช่วง และยอดแยกช่วงอายุ — มาจากแถวเดียวกัน ไล่รวมทีเดียว */
  const copdOf = new Map<
    string,
    { copd: CopdCount; ages: Record<CopdAgeBand, CopdCount>; ageUnknown: CopdCount }
  >()
  for (const row of (copdResult as unknown as Row[][])[0]) {
    const key = String(row.bucket)
    let entry = copdOf.get(key)
    if (entry == null) {
      entry = {
        copd: zeroCount(),
        ages: Object.fromEntries(COPD_AGE_BANDS.map(band => [band, zeroCount()])) as Record<
          CopdAgeBand,
          CopdCount
        >,
        ageUnknown: zeroCount(),
      }
      copdOf.set(key, entry)
    }
    const count = { total: Number(row.total), dead: Number(row.dead) }
    entry.copd.total += count.total
    entry.copd.dead += count.dead
    // band ว่างคือไม่มีอายุในทะเบียน — ต้องยังบวกเข้ายอด COPD แล้วแยกถังไว้
    const band = String(row.band ?? '')
    const target = (COPD_AGE_BANDS as readonly string[]).includes(band)
      ? entry.ages[band as CopdAgeBand]
      : entry.ageUnknown
    target.total += count.total
    target.dead += count.dead
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
      const entry = copdOf.get(key)
      return {
        key,
        partial,
        pneumonia: Object.fromEntries(
          PNEUMONIA_SCOPES.map(scope => [scope, countOf(row, scope)]),
        ) as Record<PneumoniaScope, CopdCount>,
        pneumoniaAsWritten: countOf(row, 'written'),
        copd: entry?.copd ?? zeroCount(),
        ages:
          entry?.ages ??
          (Object.fromEntries(COPD_AGE_BANDS.map(band => [band, zeroCount()])) as Record<
            CopdAgeBand,
            CopdCount
          >),
        ageUnknown: entry?.ageUnknown ?? zeroCount(),
        admissions: Number(row?.admissions ?? 0),
      }
    }),
    coding,
  }
}
