import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'
import { labCodes } from '@/lib/his/lab-codes'
import { CKD_STAGE3_EGFR } from '@/lib/his/rdu-ckd-nsaid'
import { countDeliveryPair } from '@/lib/his/rdu-delivery'
import { countEdPair } from '@/lib/his/rdu-ed'
import { METFORMIN_GENERIC, METFORMIN_MIN_EGFR } from '@/lib/his/rdu-metformin'
import { countPregnancyPair } from '@/lib/his/rdu-pregnancy'
import { diagnosisTable, drugTable } from '@/lib/his/rdu-registry'
import {
  loadAgeSettings,
  loadTargets,
  TARGET_SETTINGS,
  type TargetSetting,
} from '@/lib/his/rdu-settings'
import {
  ANTIBIOTIC_FLAG_VALUE,
  DISPENSED_QTY,
  OPD_ONLY,
} from '@/lib/his/rdu-visit-report'

/**
 * ผลตัวชี้วัด RDU รายปีงบประมาณ — ข้อมูลของหน้าสรุปเปรียบเทียบสามปี
 *
 * ทำไมต้องมีตารางแคช ไม่คำนวณสดเหมือนหน้าอื่น:
 * หน้ารายงานแต่ละข้อคำนวณสดได้เพราะดูทีละข้อทีละช่วง แต่หน้าสรุปถามพร้อมกัน
 * สิบสองข้อคูณสามปี = สามสิบหกช่อง วัดจากฐานจริงแล้วหนึ่งปีของทุกข้อใช้เวลา
 * ราว 45 วินาที (ข้อ NSAIDs ในโรคไตเรื้อรังข้อเดียวกินไป 17 วินาที เพราะต้อง
 * ไล่ค่าไตล่าสุดของทุกครั้งที่ผู้ป่วยมา) สามปีจึงเกินสองนาที ซึ่งเปิดหน้ารอไม่ได้
 *
 * ปีงบที่ปิดไปแล้วตัวเลขไม่เปลี่ยนอีก การเก็บไว้จึงถูกต้องโดยธรรมชาติ —
 * ยกเว้นกรณีเดียวคือมีคนแก้ทะเบียนหรือเกณฑ์อายุ ซึ่งทำให้ตัวเลขย้อนหลังเปลี่ยน
 * ด้วย จึงต้องเก็บ computed_at ไว้ให้เห็นว่าเลขที่เห็นคำนวณเมื่อไร และเปิดให้
 * กดคำนวณใหม่ได้เสมอ
 *
 * คิวรีในไฟล์นี้เป็นแบบ "นับอย่างเดียว" ไม่ดึงรายชื่อผู้ป่วย — ตั้งใจให้ต่างจาก
 * โมดูลรายงานที่ต้องส่งรายเคส เพราะหน้านี้ไม่ได้ใช้รายละเอียดเลยแม้แต่แถวเดียว
 * และการไม่แตะตาราง patient ทำให้เร็วขึ้นมากในช่วงที่ยาวเป็นปี
 */

/** จำนวนปีงบที่หน้าสรุปเปรียบเทียบ */
export const YEARS_COMPARED = 3

/** ปีงบประมาณไทยเริ่ม 1 ต.ค. — ตั้งแต่เดือนนี้ถือว่าเข้าปีงบถัดไปแล้ว */
const FISCAL_START_MONTH = 9

/** ช่วงวันที่ของปีงบประมาณ พ.ศ. — 1 ต.ค. ปีก่อนหน้า ถึง 30 ก.ย. ของปีนั้น */
export function fiscalRange(buddhistYear: number): { from: string; to: string } {
  const endYear = buddhistYear - 543
  return { from: `${endYear - 1}-10-01`, to: `${endYear}-09-30` }
}

/** ปีงบประมาณที่วันนี้อยู่ */
export function currentFiscalYear(now = new Date()): number {
  return now.getFullYear() + 543 + (now.getMonth() >= FISCAL_START_MONTH ? 1 : 0)
}

/** ปีงบที่หน้าสรุปแสดง เรียงจากเก่าไปใหม่ */
export function comparedFiscalYears(now = new Date()): number[] {
  const current = currentFiscalYear(now)
  return Array.from({ length: YEARS_COMPARED }, (_, i) => current - YEARS_COMPARED + 1 + i)
}

/**
 * ตัวชี้วัดหนึ่งข้อในหน้าสรุป
 *
 * shape บอกว่าตัวเลขคำนวณด้วยคิวรีแบบไหน ซึ่งแบ่งตามรูปของตัวหาร ไม่ได้แบ่ง
 * ตามกลุ่มโรค — 'framework' คือข้อที่ตัวหารเป็นครั้งที่วินิจฉัยด้วยรหัสในทะเบียน
 * ส่วนที่เหลือมีตัวหารเฉพาะตัวจนต้องเขียนคิวรีของใครของมัน
 */
type Indicator = {
  label: string
  short: string
  group: 'antibiotic' | 'chronic' | 'special' | 'prescribing'
  /** หน่วยของตัวตั้งและตัวหาร — มีผลกับคำที่ขึ้นบนกราฟ */
  unit: 'visits' | 'patients' | 'admissions' | 'items'
  target: TargetSetting
  reportHref: string
}

export const INDICATORS = {
  ri: {
    label: 'โรคติดเชื้อทางเดินหายใจส่วนบนที่ได้รับยาปฏิชีวนะ',
    short: 'RI',
    group: 'antibiotic',
    unit: 'visits',
    target: 'ri-target',
    reportHref: '/home/rdu/reports/ri',
  },
  ad: {
    label: 'โรคอุจจาระร่วงเฉียบพลันที่ได้รับยาปฏิชีวนะ',
    short: 'AD',
    group: 'antibiotic',
    unit: 'visits',
    target: 'ad-target',
    reportHref: '/home/rdu/reports/ad',
  },
  apl: {
    label: 'บาดแผลสดจากอุบัติเหตุที่ได้รับยาปฏิชีวนะ',
    short: 'APL',
    group: 'antibiotic',
    unit: 'visits',
    target: 'apl-target',
    reportHref: '/home/rdu/reports/apl',
  },
  delivery: {
    label: 'สตรีคลอดปกติครบกำหนดทางช่องคลอดที่ได้รับยาปฏิชีวนะ',
    short: 'คลอดปกติ (NL)',
    group: 'antibiotic',
    unit: 'admissions',
    target: 'delivery-target',
    reportHref: '/home/rdu/reports/delivery',
  },
  asthma: {
    label: 'ผู้ป่วยโรคหืดที่ได้รับยาสูดพ่นคอร์ติโคสเตียรอยด์',
    short: 'โรคหืด',
    group: 'chronic',
    unit: 'visits',
    target: 'asthma-target',
    reportHref: '/home/rdu/reports/asthma',
  },
  'ckd-nsaid': {
    label: 'ผู้ป่วยโรคไตเรื้อรังระดับ 3 ขึ้นไปที่ได้รับยา NSAIDs',
    short: 'NSAIDs ใน CKD',
    group: 'chronic',
    unit: 'patients',
    target: 'ckd-nsaid-target',
    reportHref: '/home/rdu/reports/ckd-nsaid',
  },
  metformin: {
    label: 'ผู้ป่วยเบาหวานที่ใช้ยา metformin',
    short: 'metformin',
    group: 'chronic',
    unit: 'patients',
    target: 'metformin-target',
    reportHref: '/home/rdu/reports/metformin',
  },
  'glibenclamide-elderly': {
    label: 'ผู้ป่วยเบาหวานสูงอายุที่ได้รับยา glibenclamide',
    short: 'glibenclamide',
    group: 'chronic',
    unit: 'visits',
    target: 'glibenclamide-elderly-target',
    reportHref: '/home/rdu/reports/glibenclamide-elderly',
  },
  'ras-duplicate': {
    label: 'การได้รับยากลุ่ม RAS blockade ซ้ำซ้อน',
    short: 'RAS ซ้ำซ้อน',
    group: 'chronic',
    unit: 'visits',
    target: 'ras-duplicate-target',
    reportHref: '/home/rdu/reports/ras-duplicate',
  },
  'ruauri-child': {
    label: 'ผู้ป่วยเด็ก RUA-URI ที่ได้รับยาต้านฮิสตามีน non-sedating',
    short: 'เด็ก RUA-URI',
    group: 'special',
    unit: 'visits',
    target: 'ruauri-child-target',
    reportHref: '/home/rdu/reports/ruauri-child',
  },
  benzo: {
    label: 'ผู้ป่วยนอกสูงอายุที่ได้รับยา long-acting benzodiazepine',
    short: 'benzodiazepine',
    group: 'special',
    unit: 'patients',
    target: 'benzo-target',
    reportHref: '/home/rdu/reports/benzo',
  },
  pregnancy: {
    label: 'สตรีตั้งครรภ์ที่ได้รับยาที่ห้ามใช้',
    short: 'ยาห้ามใช้ในสตรีตั้งครรภ์',
    group: 'special',
    unit: 'patients',
    target: 'pregnancy-contra-target',
    reportHref: '/home/rdu/reports/pregnancy',
  },
  /* แยกสองข้อ ไม่ได้รวมเป็นข้อเดียวแล้วเลือกฝั่งใดฝั่งหนึ่งมาขึ้นกราฟ — สองฝั่ง
     ต่างกันเกือบหกจุดและใช้เกณฑ์คนละตัว การเลือกฝั่งเดียวเท่ากับซ่อนอีกครึ่ง */
  'ed-opd': {
    label: 'รายการยาที่สั่งจากบัญชียาหลักแห่งชาติ — ผู้ป่วยนอก',
    short: 'บัญชียาหลัก (OPD)',
    group: 'prescribing',
    unit: 'items',
    target: 'ed-opd-target',
    reportHref: '/home/rdu/reports/ed',
  },
  'ed-ipd': {
    label: 'รายการยาที่สั่งจากบัญชียาหลักแห่งชาติ — ผู้ป่วยใน',
    short: 'บัญชียาหลัก (IPD)',
    group: 'prescribing',
    unit: 'items',
    target: 'ed-ipd-target',
    reportHref: '/home/rdu/reports/ed',
  },
} as const satisfies Record<string, Indicator>

export type IndicatorName = keyof typeof INDICATORS

export const INDICATOR_NAMES = Object.keys(INDICATORS) as IndicatorName[]

export const isIndicator = (value: string): value is IndicatorName =>
  Object.hasOwn(INDICATORS, value)

/** ตัวชี้วัดหนึ่งข้อพร้อมเกณฑ์ที่ใช้อยู่ — รูปที่หน้าสรุปรับไปวาดกราฟ */
export type IndicatorView = Omit<Indicator, 'target'> & {
  name: IndicatorName
  goal: 'low' | 'high'
  /** เกณฑ์เป็นร้อยละ — null = ยังไม่ได้ตั้ง กราฟจะไม่ลากเส้นและไม่ตัดสินผ่าน/ไม่ผ่าน */
  target: number | null
}

/**
 * รายการตัวชี้วัดพร้อมเกณฑ์ที่ตั้งไว้
 *
 * รวมเกณฑ์เข้ามาที่นี่เลย ไม่ได้ให้หน้าจอไปดึงเองอีกรอบ — กราฟทุกใบต้องใช้เกณฑ์
 * ตัดสินสีของแท่ง ถ้าสองอย่างนี้มาคนละคำขอแล้วอันหนึ่งช้ากว่า กราฟจะวาดด้วยสี
 * ที่ยังไม่รู้เกณฑ์ก่อนแล้วค่อยกระพริบเปลี่ยนสี ซึ่งอ่านผิดได้ในจังหวะนั้น
 */
export async function listIndicators(): Promise<IndicatorView[]> {
  const targets = await loadTargets()
  return INDICATOR_NAMES.map(name => {
    const { target, ...rest } = INDICATORS[name]
    return {
      ...rest,
      name,
      goal: TARGET_SETTINGS[target].goal,
      target: targets[target],
    }
  })
}

/** ตัวตั้ง/ตัวหารของตัวชี้วัดหนึ่งข้อในปีงบหนึ่งปี */
export type YearlyResult = {
  indicator: IndicatorName
  fiscalYear: number
  numerator: number
  denominator: number
  /** ปีงบยังไม่จบ ตัวเลขจึงยังไม่ครบปี */
  partial: boolean
  /** คำนวณเมื่อไร 'YYYY-MM-DD HH:mm' — null = ยังไม่เคยคำนวณ */
  computedAt: string | null
}

const rows = (result: unknown) => result as unknown as Record<string, unknown>[]

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v).trim() || null)

const codeList = (icodes: string[]) =>
  sql.join(
    icodes.map(icode => sql`${icode}`),
    sql`, `,
  )

const icodesOf = async (kind: Parameters<typeof drugTable>[0]) => {
  const [result] = await hisDb.execute(sql`SELECT icode FROM ${sql.raw(drugTable(kind))}`)
  return rows(result)
    .map(row => String(row.icode ?? '').trim())
    .filter(Boolean)
}

/** ตัวเลขคู่เดียวที่ทุกคิวรีในไฟล์นี้คืนกลับมา */
const pairOf = (result: unknown): { numerator: number; denominator: number } => {
  const row = rows(result)[0] ?? {}
  return { numerator: Number(row.numer ?? 0), denominator: Number(row.denom ?? 0) }
}

/* ───────────── คิวรีของแต่ละรูปตัวชี้วัด ───────────── */

/**
 * ข้อที่ตัวหารเป็น "ครั้งที่วินิจฉัยด้วยรหัสในทะเบียน"
 *
 * ใช้ EXISTS ไม่ใช่ GROUP_CONCAT ชื่อยาเหมือนหน้ารายงาน — ที่นี่ต้องการแค่
 * จริง/เท็จว่าได้รับยาหรือไม่ การต่อชื่อยาเป็นข้อความแล้วทิ้งเป็นงานเปล่า
 */
async function frameworkPair(input: {
  kind: 'ri' | 'ad' | 'apl' | 'asthma' | 'ruauri-child' | 'glibenclamide-elderly'
  from: string
  to: string
}) {
  const SPECS = {
    ri: { dx: 'ri', rx: 'ri-antibiotic' },
    ad: { dx: 'ad', rx: null },
    // ข้อ APL ใช้ทะเบียนของตัวเอง ไม่ใช่ธง drugitems.antibiotic เหมือนข้อ AD
    apl: { dx: 'apl', rx: 'apl-antibiotic' },
    asthma: { dx: 'asthma', rx: 'inhaler', continued: true },
    'ruauri-child': { dx: 'ruauri', rx: 'nonsedating-antihist', maxAge: 'ruauri-max-age' },
    'glibenclamide-elderly': {
      dx: 'dm',
      rx: 'glibenclamide',
      minAge: 'glibenclamide-min-age',
    },
  } as const

  const spec = SPECS[input.kind]
  const dxTable = sql.raw(diagnosisTable(spec.dx))

  // ข้อที่นับการใช้ยาต่อเนื่องต้องเอาแถว qty = 0 มาด้วย ไม่งั้นเลขจะไม่ตรงกับ
  // หน้ารายงานของข้อเดียวกัน (เหตุผลอยู่ที่ CONTINUED_QTY ใน rdu-visit-report.ts)
  const qty = 'continued' in spec ? sql`` : sql`AND o.qty > ${DISPENSED_QTY}`

  const got =
    spec.rx == null
      ? sql`EXISTS (SELECT 1 FROM opitemrece o
                      JOIN drugitems di ON di.icode = o.icode
                       AND di.antibiotic = ${ANTIBIOTIC_FLAG_VALUE}
                     WHERE o.vn = v.vn ${qty})`
      : sql`EXISTS (SELECT 1 FROM opitemrece o
                      JOIN ${sql.raw(drugTable(spec.rx))} r ON r.icode = o.icode
                     WHERE o.vn = v.vn ${qty})`

  const ages = await loadAgeSettings()
  const age =
    'maxAge' in spec
      ? sql`AND v.age_y <= ${ages[spec.maxAge]}`
      : 'minAge' in spec
        ? sql`AND v.age_y >= ${ages[spec.minAge]}`
        : sql``

  const [result] = await hisDb.execute(sql`
    SELECT COUNT(*) AS denom, SUM(x.got) AS numer FROM (
      SELECT v.vn, ${got} AS got
        FROM vn_stat v
        JOIN ovstdiag d ON d.vn = v.vn
        JOIN ${dxTable} a ON a.icd10 = d.icd10
        LEFT OUTER JOIN ovst ov ON ov.vn = v.vn
       WHERE v.vstdate BETWEEN ${input.from} AND ${input.to} ${age} AND ${OPD_ONLY}
       GROUP BY v.vn) x`)

  return pairOf(result)
}

/** NSAIDs ในผู้ป่วยโรคไตเรื้อรัง — นับเป็นคน (ดู lib/his/rdu-ckd-nsaid.ts) */
async function ckdNsaidPair(input: { from: string; to: string }) {
  const nsaid = await icodesOf('nsaid')
  if (nsaid.length === 0) return { numerator: 0, denominator: 0 }

  const dxTable = sql.raw(diagnosisTable('ckd'))
  const egfr = labCodes.egfr
  const numeric = '^[0-9]+(\\.[0-9]+)?$'

  const joins = sql`
    LEFT OUTER JOIN (SELECT d.hn, MIN(d.vstdate) AS since FROM ovstdiag d
                       JOIN ${dxTable} r ON r.icd10 = d.icd10 GROUP BY d.hn) cd
      ON cd.hn = v.hn AND cd.since <= v.vstdate
    LEFT OUTER JOIN (SELECT h.hn, MIN(h.order_date) AS since FROM lab_head h
                       JOIN lab_order o2 ON o2.lab_order_number = h.lab_order_number
                      WHERE o2.lab_items_code = ${egfr}
                        AND o2.lab_order_result REGEXP ${numeric}
                        AND CAST(o2.lab_order_result AS DECIMAL(10, 2)) < ${CKD_STAGE3_EGFR}
                      GROUP BY h.hn) cl
      ON cl.hn = v.hn AND cl.since <= v.vstdate`

  const latest = sql`
    (SELECT CAST(lo.lab_order_result AS DECIMAL(10, 2))
       FROM lab_head lh JOIN lab_order lo ON lo.lab_order_number = lh.lab_order_number
      WHERE lh.hn = v.hn AND lo.lab_items_code = ${egfr}
        AND lo.lab_order_result REGEXP ${numeric} AND lh.order_date <= v.vstdate
      ORDER BY lh.order_date DESC LIMIT 1)`

  const isCkd = sql`
    (cd.hn IS NOT NULL OR cl.hn IS NOT NULL)
    AND (cd.hn IS NOT NULL OR ${latest} < ${CKD_STAGE3_EGFR})`

  const [denominator] = await hisDb.execute(sql`
    SELECT COUNT(DISTINCT v.hn) AS denom, 0 AS numer
      FROM vn_stat v ${joins} LEFT OUTER JOIN ovst ov ON ov.vn = v.vn
     WHERE v.vstdate BETWEEN ${input.from} AND ${input.to} AND ${OPD_ONLY} AND ${isCkd}`)

  const [numerator] = await hisDb.execute(sql`
    SELECT 0 AS denom, COUNT(DISTINCT v.hn) AS numer
      FROM opitemrece o
      JOIN vn_stat v ON v.vn = o.vn ${joins}
      LEFT OUTER JOIN ovst ov ON ov.vn = v.vn
     WHERE o.vstdate BETWEEN ${input.from} AND ${input.to}
       AND o.qty > ${DISPENSED_QTY} AND o.icode IN (${codeList(nsaid)})
       AND ${OPD_ONLY} AND ${isCkd}`)

  return {
    denominator: pairOf(denominator).denominator,
    numerator: pairOf(numerator).numerator,
  }
}

/** RAS blockade ซ้ำซ้อน — ครั้งที่ได้รับยาสองชื่อสามัญขึ้นไป */
async function rasDuplicatePair(input: { from: string; to: string }) {
  const codes = [...(await icodesOf('ras-acei')), ...(await icodesOf('ras-arb'))]
  if (codes.length === 0) return { numerator: 0, denominator: 0 }

  const [result] = await hisDb.execute(sql`
    SELECT COUNT(*) AS denom, SUM(x.generics >= 2) AS numer FROM (
      SELECT v.vn, COUNT(DISTINCT di.generic_name) AS generics
        FROM opitemrece o
        JOIN drugitems di ON di.icode = o.icode
        JOIN vn_stat v ON v.vn = o.vn
        LEFT OUTER JOIN ovst ov ON ov.vn = v.vn
       WHERE o.icode IN (${codeList(codes)}) AND o.qty > ${DISPENSED_QTY}
         AND o.vstdate BETWEEN ${input.from} AND ${input.to} AND ${OPD_ONLY}
       GROUP BY v.vn) x`)

  return pairOf(result)
}

/** การใช้ metformin — นับเป็นคน ตัดผู้มีข้อห้ามใช้ออกจากตัวหาร */
async function metforminPair(input: { from: string; to: string }) {
  const antidiabetic = await icodesOf('antidiabetic')
  if (antidiabetic.length === 0) return { numerator: 0, denominator: 0 }

  const dxTable = sql.raw(diagnosisTable('dm'))
  const egfr = labCodes.egfr
  const numeric = '^[0-9]+(\\.[0-9]+)?$'

  const [result] = await hisDb.execute(sql`
    SELECT SUM(NOT z.contra) AS denom, SUM(z.mfm > 0 AND NOT z.contra) AS numer FROM (
      SELECT y.mfm,
             (CAST(SUBSTRING_INDEX(y.egfr_latest, '@', 1) AS DECIMAL(10, 2))
              < ${METFORMIN_MIN_EGFR}) IS TRUE AS contra
      FROM (
        SELECT x.mfm,
               (SELECT CONCAT(lo.lab_order_result, '@', lh.order_date)
                  FROM lab_head lh
                  JOIN lab_order lo ON lo.lab_order_number = lh.lab_order_number
                 WHERE lh.hn = x.hn AND lo.lab_items_code = ${egfr}
                   AND lo.lab_order_result REGEXP ${numeric}
                   AND lh.order_date <= ${input.to}
                 ORDER BY lh.order_date DESC LIMIT 1) AS egfr_latest
        FROM (
          SELECT v.hn,
                 COUNT(DISTINCT CASE
                   WHEN di.generic_name LIKE ${`%${METFORMIN_GENERIC}%`} THEN v.vn
                 END) AS mfm
            FROM opitemrece o
            JOIN drugitems di ON di.icode = o.icode
            JOIN vn_stat v ON v.vn = o.vn
            LEFT OUTER JOIN ovst ov ON ov.vn = v.vn
            JOIN (SELECT d.hn, MIN(d.vstdate) AS since FROM ovstdiag d
                    JOIN ${dxTable} a ON a.icd10 = d.icd10 GROUP BY d.hn) dm
              ON dm.hn = v.hn AND dm.since <= v.vstdate
           WHERE o.vstdate BETWEEN ${input.from} AND ${input.to}
             AND o.qty > ${DISPENSED_QTY} AND o.icode IN (${codeList(antidiabetic)})
             AND ${OPD_ONLY}
           GROUP BY v.hn) x) y) z`)

  return pairOf(result)
}

/** long-acting benzodiazepine ในผู้สูงอายุ — นับเป็นคน */
async function benzoPair(input: { from: string; to: string }) {
  const codes = await icodesOf('long-acting-benzo')
  const ages = await loadAgeSettings()
  const elderly = sql`v.age_y >= ${ages['benzo-min-age']}`

  const [denominator] = await hisDb.execute(sql`
    SELECT COUNT(DISTINCT v.hn) AS denom, 0 AS numer
      FROM vn_stat v LEFT OUTER JOIN ovst ov ON ov.vn = v.vn
     WHERE v.vstdate BETWEEN ${input.from} AND ${input.to} AND ${elderly} AND ${OPD_ONLY}`)

  const denom = pairOf(denominator).denominator
  if (codes.length === 0) return { numerator: 0, denominator: denom }

  const [numerator] = await hisDb.execute(sql`
    SELECT 0 AS denom, COUNT(DISTINCT v.hn) AS numer
      FROM opitemrece o
      JOIN vn_stat v ON v.vn = o.vn
      LEFT OUTER JOIN ovst ov ON ov.vn = v.vn
     WHERE o.vstdate BETWEEN ${input.from} AND ${input.to}
       AND o.qty > ${DISPENSED_QTY} AND o.icode IN (${codeList(codes)})
       AND ${elderly} AND ${OPD_ONLY}`)

  return { numerator: pairOf(numerator).numerator, denominator: denom }
}

/* ───────────── คำนวณและเก็บผล ───────────── */

/**
 * คำนวณตัวชี้วัดหนึ่งข้อของปีงบหนึ่งปี แล้วเก็บลงตารางแคช
 *
 * ปีที่ยังไม่จบจะตัดปลายช่วงไว้ที่วันนี้ แล้วติดธง partial — ถ้าปล่อยให้ค้นถึง
 * 30 ก.ย. ที่ยังมาไม่ถึง ตัวเลขก็เท่ากันก็จริง แต่คนอ่านจะไม่รู้ว่ากราฟแท่ง
 * สุดท้ายเป็นของครึ่งปี ไม่ใช่ทั้งปี แล้วเอาไปเทียบกับปีก่อน ๆ ตรง ๆ
 */
export async function computeYearly(
  indicator: IndicatorName,
  fiscalYear: number,
  now = new Date(),
): Promise<YearlyResult> {
  const range = fiscalRange(fiscalYear)
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`
  const partial = today < range.to
  const to = partial ? today : range.to
  const input = { from: range.from, to }

  const pair =
    indicator === 'delivery'
      ? await countDeliveryPair(input)
      : indicator === 'ed-opd'
      ? await countEdPair({ ...input, scope: 'opd' })
      : indicator === 'ed-ipd'
      ? await countEdPair({ ...input, scope: 'ipd' })
      : indicator === 'pregnancy'
      ? await countPregnancyPair(input)
      : indicator === 'ckd-nsaid'
      ? await ckdNsaidPair(input)
      : indicator === 'ras-duplicate'
        ? await rasDuplicatePair(input)
        : indicator === 'metformin'
          ? await metforminPair(input)
          : indicator === 'benzo'
            ? await benzoPair(input)
            : await frameworkPair({ kind: indicator, ...input })

  await hisDb.execute(sql`
    INSERT INTO pyhos_rdu_yearly (indicator, fiscal_year, numerator, denominator, partial)
    VALUES (${indicator}, ${fiscalYear}, ${pair.numerator}, ${pair.denominator}, ${partial ? 1 : 0})
    ON DUPLICATE KEY UPDATE
      numerator = VALUES(numerator),
      denominator = VALUES(denominator),
      partial = VALUES(partial)`)

  return {
    indicator,
    fiscalYear,
    ...pair,
    partial,
    computedAt: null,
  }
}

/** ผลที่คำนวณไว้แล้วทั้งหมดในช่วงปีที่หน้าสรุปแสดง */
export async function loadYearly(years: number[]): Promise<YearlyResult[]> {
  if (years.length === 0) return []

  const [result] = await hisDb.execute(sql`
    SELECT indicator, fiscal_year, numerator, denominator, partial,
           DATE_FORMAT(computed_at, '%Y-%m-%d %H:%i') AS computed_at
      FROM pyhos_rdu_yearly
     WHERE fiscal_year IN (${sql.join(
       years.map(year => sql`${year}`),
       sql`, `,
     )})`)

  // แถวของตัวชี้วัดที่ถูกถอดออกไปแล้วยังค้างในตารางได้ กรองทิ้งตอนอ่าน
  return rows(result)
    .filter(row => isIndicator(String(row.indicator ?? '')))
    .map(row => ({
      indicator: String(row.indicator) as IndicatorName,
      fiscalYear: Number(row.fiscal_year ?? 0),
      numerator: Number(row.numerator ?? 0),
      denominator: Number(row.denominator ?? 0),
      partial: Number(row.partial ?? 0) === 1,
      computedAt: str(row.computed_at),
    }))
}
