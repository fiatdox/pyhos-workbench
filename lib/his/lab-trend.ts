import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'
import { labTrendCodes } from './lab-codes'

/**
 * ค่าแล็บประกอบการพิจารณาใบคำขอ DUE — การอักเสบและการทำงานของตับ
 *
 * ส่งกลับเป็นตารางไหล (แถว = ค่า, คอลัมน์ = วันที่) ไม่ใช่รายการผลทีละใบ
 * เพราะค่าพวกนี้อ่านเป็นแนวโน้มเท่านั้น — WBC 14,000 ไม่ได้บอกอะไรถ้าไม่รู้ว่า
 * เมื่อวานคือ 22,000 (ตอบสนองต่อยา) หรือ 9,000 (แย่ลง) ซึ่งเป็นข้อสรุปตรงข้ามกัน
 * จากตัวเลขเดียวกัน
 *
 * ไม่รวมอยู่ใน getDuePatient เพราะใบคำขอส่วนใหญ่ไม่ได้เปิดดูค่าชุดนี้ ดึงตอนกดเปิด
 * จึงไม่ต้องลากมาทุกครั้งที่คีย์ HN
 */

const LAB_TREND_DAYS = 365
/** จำนวนวันที่ย้อนหลังที่เอามาแสดง — คนไข้ที่เจาะทุกวันปีเดียวได้เป็นร้อยคอลัมน์ */
const LAB_TREND_MAX_DATES = 24

/** เพศตามรหัสของ HIS */
const SEX_MALE = '1'

export type LabAnalyteKey =
  | 'wbc'
  | 'neutrophilPercent'
  | 'anc'
  | 'crp'
  | 'alt'
  | 'ast'
  | 'bilirubin'
  | 'albumin'

export type LabTrendCell = {
  /** ค่าตัวเลขที่ใช้ทั้งในตารางและบนกราฟ — null = วันนั้นไม่ได้ตรวจค่านี้ */
  value: number | null
  /**
   * เครื่องหมายที่ห้องแล็บติดมากับค่า เช่น '>' ของผล ">30.0"
   *
   * เก็บแยกไว้เพื่อให้ตารางแสดงตามที่ห้องแล็บรายงานจริง การตัดทิ้งแล้วโชว์ 30
   * เฉย ๆ คือเปลี่ยน "มากกว่า 30" ให้กลายเป็น "เท่ากับ 30" ซึ่งคนละความหมาย
   */
  qualifier: '>' | '<' | null
  /** 0 = อยู่ในช่วงอ้างอิง · 1 = ผิดปกติ · 2 = ผิดปกติมาก */
  level: 0 | 1 | 2
  /**
   * ค่าที่ต่ำกว่าระดับที่เป็นไปได้ทางสรีรวิทยา — แสดงไว้แต่ไม่เตือนและไม่พลอตกราฟ
   *
   * วัดแล้วพบ albumin ต่ำกว่า 1.0 g/dL อยู่ 93 จาก 30,500 ผลในหนึ่งปี (0.3%)
   * ต่ำสุด 0.09 ซึ่งคนมีชีวิตอยู่ไม่ได้ ออกมาจากฟอร์มเคมีคลินิกปกติ จึงน่าจะเป็น
   * การคีย์ผิดหรือเป็นผลของสิ่งส่งตรวจอื่นที่วิ่งบนเครื่องเดียวกัน (เช่นน้ำในช่องเยื่อ)
   *
   * ไม่ตัดทิ้งเพราะการซ่อนข้อมูลที่ห้องแล็บออกมาจริงแย่กว่าการแสดงพร้อมหมายเหตุ
   * แต่ไม่ย้อมแดงและไม่ลากเส้น — ถ้าปล่อยไว้ albumin 0.27 จะกดสเกลกราฟจนค่าอื่น
   * ทั้งเส้นแบนติดกัน และเภสัชกรที่เห็นแดงจะเสียเวลากับค่าที่ไม่ใช่ของคนไข้
   */
  suspect: boolean
}

export type LabTrendRow = {
  key: LabAnalyteKey
  label: string
  unit: string
  /** ช่วงอ้างอิงตามทะเบียนของห้องแล็บ ใช้แสดงใต้ชื่อค่า */
  normal: string
  group: 'inflammation' | 'liver'
  /** true = คำนวณเอง ไม่ใช่ค่าที่ห้องแล็บออกมา */
  derived: boolean
  /** ตรงตำแหน่งกับ dates ทุกช่อง */
  cells: LabTrendCell[]
}

export type LabTrend = {
  /** 'YYYY-MM-DD' เรียงจากเก่าไปใหม่ ให้ตรงทิศทางกับกราฟค่าไต */
  dates: string[]
  rows: LabTrendRow[]
  /** รหัสที่ไม่ได้ตั้งใน .env จึงไม่มีข้อมูลมาให้ดูเลย */
  missingCodes: LabAnalyteKey[]
}

/**
 * แปลงผลที่ห้องแล็บพิมพ์มาเป็นตัวเลข
 *
 * ค่าที่เจอจริงในฐานนอกจากตัวเลขล้วน: " 6,470" (มีจุลภาคและเว้นวรรคนำ),
 * "1708 (Dilute 1:10)", "9.28 (Icteric Serum2+)", ">30.0", "2.0."
 * และค่าที่ไม่ใช่ตัวเลขเลยอย่าง "Turbid 4+" หรือ "." ซึ่งต้องตกไปทั้งช่อง
 * ไม่ใช่กลายเป็น NaN บนกราฟ
 *
 * หมายเหตุเรื่องวงเล็บท้ายค่า: "(Dilute 1:10)" คือห้องแล็บบอกว่าเจือจางมาเท่าไร
 * ตัวเลขหน้าวงเล็บคือผลที่คูณกลับแล้ว ไม่ต้องคูณเพิ่ม
 *
 * จุลภาคสำคัญกว่าที่คิด — ห้องแล็บเริ่มใส่คั่นหลักพันกับผล WBC ตั้งแต่ 23 ก.ค. 2569
 * ("15,030" แทน "15030") ถ้าตัวแปลงไม่ลอกจุลภาคออกก่อน ผลหลังวันนั้นจะตกไปทั้งหมด
 * และกราฟจะว่างเปล่าในช่วงที่ใหม่ที่สุด ซึ่งเป็นช่วงที่ต้องใช้ตัดสินใจที่สุด
 * (ที่เปลี่ยนคือรูปแบบการพิมพ์เท่านั้น หน่วยยังเป็น cell/cu.mm เหมือนเดิมทุกเดือน)
 */
function parseResult(raw: string): { value: number; qualifier: '>' | '<' | null } | null {
  const text = raw.replace(/,/g, '').trim()
  const match = /^([<>]?)\s*(\d+(?:\.\d+)?)/.exec(text)
  if (!match) return null
  const value = Number(match[2])
  if (!Number.isFinite(value)) return null
  const mark = match[1]
  return { value, qualifier: mark === '>' || mark === '<' ? mark : null }
}

/**
 * ช่วงอ้างอิงและเกณฑ์ "ผิดปกติมาก" ของแต่ละค่า
 *
 * ช่วงอ้างอิงลอกจากทะเบียน lab_items ของห้องแล็บเอง ไม่ได้ตั้งเอง — ค่าที่หน้าจอ
 * บอกว่าปกติต้องตรงกับที่พิมพ์อยู่บนใบผลแล็บที่เภสัชกรถืออยู่ ไม่งั้นจะเถียงกัน
 *
 * ระดับ 2 ใช้เกณฑ์ที่เปลี่ยนการตัดสินใจเรื่องยาจริง ไม่ใช่แค่ "ผิดปกติกว่า":
 *   ANC < 500      ภาวะนิวโทรฟิลต่ำรุนแรง เปลี่ยนทั้งการเลือกยาและความเร่งด่วน
 *   ALT/AST > 3×   เกณฑ์ที่ใช้พิจารณาหยุดยาที่เป็นพิษต่อตับโดยทั่วไป
 *   T-BILI > 2×    ตัวเหลืองที่เห็นได้ทางคลินิก
 *   Albumin < 2.5  ระดับที่กระทบการจับโปรตีนของยาจนต้องคิดถึงขนาดยาอิสระ
 *
 * NE% ไม่มีระดับ 2 — นิวโทรฟิลสูงคือสิ่งที่คาดไว้แล้วในคนที่กำลังติดเชื้อ
 * ย้อมสีแดงให้มันคือการเตือนเรื่องที่ไม่ได้เป็นเรื่อง
 */
type Reference = {
  label: string
  unit: string
  normal: string
  group: 'inflammation' | 'liver'
  low: number | null
  high: number | null
  /** ต่ำกว่านี้ = ระดับ 2 */
  criticalLow?: number
  /** สูงกว่านี้ = ระดับ 2 */
  criticalHigh?: number
  /** ต่ำกว่านี้ = เป็นไปไม่ได้ทางสรีรวิทยา ไม่ใช่ค่าวิกฤติ */
  implausibleBelow?: number
}

/** ขอบบนของ ALT/AST ต่างกันตามเพศตามทะเบียนห้องแล็บ (M 0-50, F 0-35) */
const TRANSAMINASE_HIGH = { male: 50, female: 35 }

function referenceOf(sex: string | null): Record<LabAnalyteKey, Reference> {
  const male = sex === SEX_MALE
  const alt = male ? TRANSAMINASE_HIGH.male : TRANSAMINASE_HIGH.female
  return {
    wbc: {
      label: 'WBC',
      unit: 'cell/µL',
      normal: '4,000-10,000',
      group: 'inflammation',
      low: 4000,
      high: 10000,
      criticalLow: 1000,
      criticalHigh: 30000,
      // ปีที่วัดมีค่าต่ำกว่านี้ 8 ผลจากทั้งฐาน — เม็ดเลือดขาวหลักสิบไม่มีจริง
      implausibleBelow: 100,
    },
    neutrophilPercent: {
      label: 'NE%',
      unit: '%',
      normal: '50-70',
      group: 'inflammation',
      low: 50,
      high: 70,
    },
    anc: {
      label: 'ANC',
      unit: 'cell/µL',
      normal: '≥ 1,500',
      group: 'inflammation',
      low: 1500,
      high: null,
      criticalLow: 500,
    },
    crp: {
      label: 'hs-CRP',
      unit: 'mg/L',
      normal: '0-1',
      group: 'inflammation',
      low: null,
      high: 1,
      criticalHigh: 10,
    },
    alt: {
      label: 'ALT',
      unit: 'U/L',
      normal: male ? '0-50 (ช)' : '0-35 (ญ)',
      group: 'liver',
      low: null,
      high: alt,
      criticalHigh: alt * 3,
    },
    ast: {
      label: 'AST',
      unit: 'U/L',
      normal: male ? '0-50 (ช)' : '0-35 (ญ)',
      group: 'liver',
      low: null,
      high: alt,
      criticalHigh: alt * 3,
    },
    bilirubin: {
      label: 'Total bilirubin',
      unit: 'mg/dL',
      normal: '0.3-1.2',
      group: 'liver',
      low: null,
      high: 1.2,
      criticalHigh: 2.4,
    },
    albumin: {
      label: 'Albumin',
      unit: 'g/dL',
      normal: '3.5-5.2',
      group: 'liver',
      low: 3.5,
      high: 5.2,
      criticalLow: 2.5,
      implausibleBelow: 1,
    },
  }
}

function levelOf(value: number, ref: Reference): 0 | 1 | 2 {
  if (ref.implausibleBelow != null && value < ref.implausibleBelow) return 0
  if (ref.criticalLow != null && value < ref.criticalLow) return 2
  if (ref.criticalHigh != null && value > ref.criticalHigh) return 2
  if (ref.low != null && value < ref.low) return 1
  if (ref.high != null && value > ref.high) return 1
  return 0
}

/** ลำดับแถวบนหน้าจอ — ไล่จากเรื่องการอักเสบไปเรื่องตับ */
const ROW_ORDER: LabAnalyteKey[] = [
  'wbc',
  'neutrophilPercent',
  'anc',
  'crp',
  'alt',
  'ast',
  'bilirubin',
  'albumin',
]

/** ANC คำนวณจากสองค่า ไม่ได้มาจากห้องแล็บ จึงไม่มีรหัสของตัวเอง */
const CODE_OF: Record<Exclude<LabAnalyteKey, 'anc'>, number | null> = {
  wbc: labTrendCodes.wbc,
  neutrophilPercent: labTrendCodes.neutrophilPercent,
  crp: labTrendCodes.crp,
  alt: labTrendCodes.alt,
  ast: labTrendCodes.ast,
  bilirubin: labTrendCodes.bilirubin,
  albumin: labTrendCodes.albumin,
}

type Row = Record<string, unknown>
const rows = (result: unknown): Row[] => result as unknown as Row[]

export async function getLabTrend(hn: string): Promise<LabTrend> {
  const configured = Object.entries(CODE_OF).filter(([, code]) => code != null) as [
    Exclude<LabAnalyteKey, 'anc'>,
    number,
  ][]
  const missingCodes = (Object.keys(CODE_OF) as Exclude<LabAnalyteKey, 'anc'>[]).filter(
    key => CODE_OF[key] == null,
  )
  if (configured.length === 0) return { dates: [], rows: [], missingCodes }

  const [sexResult] = await hisDb.execute(sql`SELECT sex FROM patient WHERE hn = ${hn} LIMIT 1`)
  const sex = rows(sexResult)[0]?.sex
  const reference = referenceOf(sex == null ? null : String(sex))

  /**
   * ดึงทุกค่าในคิวรีเดียว แล้วพลิกเป็นตารางฝั่ง JS
   *
   * เรียงตาม lab_order_number ขึ้น เพื่อให้ "ใบหลังสุดของวันนั้นชนะ" ตอนวนเก็บ
   * — วันหนึ่งเจาะได้หลายใบ ตารางไหลแสดงวันละคอลัมน์ จึงต้องเลือกใบใดใบหนึ่ง
   * และใบที่ออกหลังสุดคือค่าที่ใช้ตัดสินใจจริงในวันนั้น (ไม่ใช่ค่าสูงสุดของวัน
   * ซึ่งจะทำให้แนวโน้มดูแย่กว่าความจริงเสมอ)
   */
  const codes = configured.map(([, code]) => code)
  const [result] = await hisDb.execute(sql`
    SELECT DATE_FORMAT(h.order_date, '%Y-%m-%d') AS order_date,
           o.lab_items_code AS code, o.lab_order_result AS result
    FROM lab_head h
    JOIN lab_order o ON o.lab_order_number = h.lab_order_number
    WHERE h.hn = ${hn}
      AND o.lab_items_code IN (${sql.join(codes, sql`, `)})
      AND o.lab_order_result IS NOT NULL
      AND o.lab_order_result <> ''
      AND h.order_date <= CURDATE()
      AND h.order_date >= DATE_SUB(CURDATE(), INTERVAL ${sql.raw(String(LAB_TREND_DAYS))} DAY)
    ORDER BY h.order_date, h.lab_order_number`)

  const byCode = new Map<number, Exclude<LabAnalyteKey, 'anc'>>(
    configured.map(([key, code]) => [code, key]),
  )
  /** วันที่ -> ค่า -> ผลที่แปลงแล้ว */
  type Hit = { value: number; qualifier: '>' | '<' | null; suspect: boolean }
  const table = new Map<string, Map<LabAnalyteKey, Hit>>()

  for (const row of rows(result)) {
    const key = byCode.get(Number(row.code))
    if (!key) continue
    const date = String(row.order_date)
    const parsed = parseResult(String(row.result))
    if (!parsed) continue
    const bound = reference[key].implausibleBelow
    const suspect = bound != null && parsed.value < bound
    const day = table.get(date) ?? new Map<LabAnalyteKey, Hit>()
    /**
     * "ใบหลังสุดชนะ" ต้องยกเว้นค่าที่เป็นไปไม่ได้ทางสรีรวิทยา
     *
     * เจอเคสจริง: 18 ก.ย. 2569 ผู้ป่วยรายหนึ่งมี albumin สองใบ ใบแรก 1.65
     * (ใช้ได้) ใบหลัง 0.27 (เป็นไปไม่ได้) ถ้าใบหลังชนะแบบไม่มีเงื่อนไข
     * ช่องของวันนั้นจะโชว์ค่าที่เชื่อไม่ได้ทั้งที่มีค่าที่ใช้ได้อยู่ในวันเดียวกัน
     *
     * ที่ถูกคือ "ใบหลังสุดที่ค่าใช้ได้ชนะ" — ยังเป็นค่าที่สดที่สุดที่เชื่อได้
     */
    const existing = day.get(key)
    if (existing && !existing.suspect && suspect) continue
    day.set(key, { value: parsed.value, qualifier: parsed.qualifier, suspect })
    table.set(date, day)
  }

  /**
   * ANC = WBC × NE% — ตัวเลขที่ใช้ตัดสินภาวะนิวโทรฟิลต่ำจริง ๆ
   *
   * ห้องแล็บไม่ได้ออก ANC มาให้ (รายการ CBC(+ANC) มีอยู่แต่ไม่ได้ออกเป็นค่า)
   * คิดเองได้เพราะมีทั้ง WBC และ NE% อยู่ในใบเดียวกันเกือบทุกใบ — แต่คิดได้
   * เฉพาะวันที่มีทั้งสองค่า วันที่ขาดตัวใดตัวหนึ่งต้องเว้นว่าง ไม่ใช่เดาเติม
   *
   * WBC หน่วย cell/µL × NE% ÷ 100 ได้ cell/µL เท่ากัน — ตรวจแล้วว่าห้องแล็บ
   * รายงาน WBC เป็น cell/cu.mm สม่ำเสมอทุกเดือน ไม่ต้องแปลงหน่วยก่อนคูณ
   */
  for (const day of table.values()) {
    const wbc = day.get('wbc')
    const ne = day.get('neutrophilPercent')
    if (!wbc || !ne) continue
    // WBC ที่เป็นไปไม่ได้ทางสรีรวิทยาคิด ANC ต่อไม่ได้ ต้องเว้นว่างไม่ใช่คิดให้ผิด
    if (wbc.suspect) continue
    day.set('anc', {
      value: Math.round((wbc.value * ne.value) / 100),
      qualifier: null,
      suspect: false,
    })
  }

  // เอาวันที่ล่าสุดตามจำนวนที่กำหนด แล้วเรียงเก่าไปใหม่ให้ตรงทิศกับกราฟค่าไต
  const dates = [...table.keys()].sort().slice(-LAB_TREND_MAX_DATES)

  const built = ROW_ORDER.filter(key => key === 'anc' || CODE_OF[key] != null).map(key => {
    const ref = reference[key]
    const cells: LabTrendCell[] = dates.map(date => {
      const hit = table.get(date)?.get(key)
      if (!hit) return { value: null, qualifier: null, level: 0, suspect: false }
      return {
        value: hit.value,
        qualifier: hit.qualifier,
        level: levelOf(hit.value, ref),
        suspect: hit.suspect,
      }
    })
    return {
      key,
      label: ref.label,
      unit: ref.unit,
      normal: ref.normal,
      group: ref.group,
      derived: key === 'anc',
      cells,
    }
  })

  // แถวที่คนไข้คนนี้ไม่เคยตรวจเลยไม่ต้องแสดง — แถวว่างทั้งแถวอ่านเป็น "ปกติ" ได้
  return { dates, rows: built.filter(row => row.cells.some(cell => cell.value != null)), missingCodes }
}
