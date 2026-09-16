import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'

/**
 * เกณฑ์ของตัวชี้วัด RDU ที่คณะกรรมการตั้งเองได้
 *
 * ค่าอย่าง "ผู้สูงอายุเริ่มที่กี่ปี" ไม่ใช่ข้อเท็จจริงที่หาจากฐาน HIS ได้ และไม่ใช่
 * ค่าที่ควรฝังตายในโค้ดด้วย — นิยามของแต่ละปีงบประมาณเปลี่ยนได้ และบางครั้ง
 * คณะกรรมการอยากลองดูตัวเลขที่เส้นอื่นก่อนตัดสินใจ ถ้าฝังไว้ในโค้ดก็ต้องรอ
 * รอบแก้โปรแกรมทุกครั้งที่อยากขยับเส้น
 *
 * เก็บเป็นตารางคู่ชื่อ/ค่าตารางเดียว ไม่ได้ทำตารางต่อหนึ่งค่า — ค่าพวกนี้เป็น
 * ค่าเดี่ยว ๆ ไม่กี่ตัว การมีตารางละค่าแปลว่าต้องสร้างตารางใหม่ทุกครั้งที่เพิ่ม
 * เกณฑ์หนึ่งข้อ ซึ่งไม่คุ้มกับอะไรเลย
 *
 * แถวที่ไม่มีในตาราง = ใช้ค่าตั้งต้นที่ประกาศไว้ข้างล่าง ไม่ใช่ error —
 * ระบบจึงทำงานได้ทันทีโดยไม่ต้องรอใครไปกดตั้งค่าก่อน
 */

/**
 * เกณฑ์อายุของตัวชี้วัดแต่ละข้อ
 *
 * แยกเป็นคนละค่าต่อข้อ แม้ตอนนี้ข้อผู้สูงอายุสองข้อจะใช้ 65 เท่ากัน — ตัวชี้วัด
 * คนละข้ออ้างอิงเอกสารคนละฉบับ ถ้ามัดเป็นค่าเดียว วันที่ข้อหนึ่งเปลี่ยนเกณฑ์
 * อีกข้อจะเปลี่ยนตามไปเงียบ ๆ ทั้งที่ไม่มีใครสั่ง
 *
 * bound กันค่าที่กรอกผิดจนตัวชี้วัดเพี้ยนแบบไม่มีใครเอะใจ (พิมพ์ 6 แทน 65
 * แล้วตัวหารกลายเป็นคนทั้งโรงพยาบาล) — ไม่ได้กันเรื่องความปลอดภัย
 * แต่กันความผิดพลาดที่มองไม่เห็นจากหน้าจอ
 */
export const AGE_SETTINGS = {
  'benzo-min-age': {
    label: 'อายุเริ่มต้นของ "ผู้สูงอายุ" — ตัวชี้วัด long-acting benzodiazepine',
    indicator: 'ผู้ป่วยนอกสูงอายุกับยา long-acting benzodiazepine',
    fallback: 65,
    min: 40,
    max: 100,
  },
  'glibenclamide-min-age': {
    label: 'อายุเริ่มต้นของ "ผู้สูงอายุ" — ตัวชี้วัด glibenclamide',
    indicator: 'ผู้ป่วยเบาหวานสูงอายุกับยา glibenclamide',
    fallback: 65,
    min: 40,
    max: 100,
  },
  'ruauri-max-age': {
    label: 'อายุสูงสุดของ "ผู้ป่วยเด็ก" — ตัวชี้วัด RUA-URI',
    indicator: 'ผู้ป่วยเด็ก RUA-URI กับยาต้านฮิสตามีน',
    fallback: 12,
    min: 1,
    max: 25,
  },
  /* ค่านี้ต่างจากสามค่าข้างบนตรงที่ไม่ได้มาจากนิยามของตัวชี้วัด แต่เป็นตัวกรอง
     ข้อมูลที่ลงรหัสผิด — รหัสหมวดตั้งครรภ์ถูกใช้กับผู้ป่วยอายุ 80–90 ปีจริง
     ในฐานนี้ (เหตุผลเต็มอยู่ที่ PREGNANCY_MAX_AGE_SETTING ใน rdu-pregnancy.ts)
     เปิดให้ตั้งเองเพราะเส้นของ "อายุที่ตั้งครรภ์ได้" ไม่ใช่ตัวเลขที่ตายตัว */
  'pregnancy-max-age': {
    label: 'อายุสูงสุดที่นับว่า "ตั้งครรภ์ได้" — ตัวชี้วัดยาที่ห้ามใช้ในสตรีตั้งครรภ์',
    indicator: 'สตรีตั้งครรภ์ที่ได้รับยาที่ห้ามใช้',
    fallback: 55,
    min: 40,
    max: 70,
  },
} as const satisfies Record<
  string,
  { label: string; indicator: string; fallback: number; min: number; max: number }
>

/**
 * เกณฑ์เป้าหมายเป็นร้อยละของแต่ละตัวชี้วัด
 *
 * fallback เป็น null สำหรับข้อที่ยังไม่มีการยืนยันตัวเลขในระบบนี้ — ตั้งใจให้ว่าง
 * ไม่ได้เดาใส่ไว้ เพราะเกณฑ์ที่ผิดอันตรายกว่าไม่มีเกณฑ์: กราฟจะลากเส้นเป้าหมาย
 * ผิดที่แล้วคนอ่านจะสรุปว่าผ่านหรือไม่ผ่านจากเส้นนั้น ข้อที่ยังว่างจะไม่มีเส้น
 * เป้าหมายในกราฟจนกว่าคณะกรรมการจะกรอกจากเอกสารจริง
 *
 * goal บอกว่าเกณฑ์เป็นเพดานหรือพื้น — 'low' คือห้ามเกิน (ยาปฏิชีวนะ)
 * 'high' คือต้องไม่ต่ำกว่า (metformin, ยาสูดพ่นในโรคหืด) ใช้ตัดสินว่าแท่งไหน
 * ผ่านเกณฑ์ และใช้เลือกสีในกราฟ
 */
export const TARGET_SETTINGS = {
  'ri-target': { indicator: 'โรคติดเชื้อทางเดินหายใจส่วนบน (RI)', goal: 'low', fallback: null },
  'ad-target': { indicator: 'โรคอุจจาระร่วงเฉียบพลัน (AD)', goal: 'low', fallback: null },
  'apl-target': { indicator: 'บาดแผลสดจากอุบัติเหตุ (APL)', goal: 'low', fallback: null },
  'delivery-target': {
    indicator: 'ยาปฏิชีวนะในสตรีคลอดปกติ (NL)',
    goal: 'low',
    fallback: null,
  },
  'asthma-target': { indicator: 'ผู้ป่วยโรคหืดที่ได้รับยา ICS', goal: 'high', fallback: null },
  'ckd-nsaid-target': {
    indicator: 'NSAIDs ในผู้ป่วยโรคไตเรื้อรัง',
    goal: 'low',
    fallback: null,
  },
  'metformin-target': {
    indicator: 'การใช้ metformin ในผู้ป่วยเบาหวาน',
    goal: 'high',
    fallback: 80,
  },
  'glibenclamide-elderly-target': {
    indicator: 'glibenclamide ในผู้สูงอายุ',
    goal: 'low',
    fallback: null,
  },
  'ras-duplicate-target': {
    indicator: 'การได้รับยากลุ่ม RAS blockade ซ้ำซ้อน',
    goal: 'low',
    fallback: 0,
  },
  'ruauri-child-target': {
    indicator: 'ผู้ป่วยเด็ก RUA-URI กับยาต้านฮิสตามีน',
    goal: 'low',
    fallback: 20,
  },
  'benzo-target': {
    indicator: 'long-acting benzodiazepine ในผู้สูงอายุ',
    goal: 'low',
    fallback: 5,
  },
  /* ศูนย์เป็นเกณฑ์จริงของข้อนี้ ไม่ใช่ค่าที่ตั้งไว้ก่อนเพราะยังไม่มีเลข —
     ยากลุ่มนี้ไม่มีขนาดที่ปลอดภัยต่อทารก การได้รับแม้รายเดียวจึงคือไม่ผ่าน */
  'pregnancy-contra-target': {
    indicator: 'สตรีตั้งครรภ์ที่ได้รับยาที่ห้ามใช้',
    goal: 'low',
    fallback: 0,
  },
  /* แยกเกณฑ์ผู้ป่วยนอกกับผู้ป่วยในคนละค่า ไม่ได้มัดเป็นค่าเดียว — วัดจริงแล้ว
     ต่างกันเกือบหกจุด (86.53% กับ 92.39%) เพราะยานอกบัญชีส่วนใหญ่เป็นยากิน
     ที่สั่งกลับบ้าน ถ้าใช้เกณฑ์เดียวกันจะมีฝั่งหนึ่งผ่านหรือไม่ผ่านโดยอัตโนมัติ */
  'ed-opd-target': {
    indicator: 'การสั่งใช้ยาในบัญชียาหลัก — ผู้ป่วยนอก',
    goal: 'high',
    fallback: null,
  },
  'ed-ipd-target': {
    indicator: 'การสั่งใช้ยาในบัญชียาหลัก — ผู้ป่วยใน',
    goal: 'high',
    fallback: null,
  },
} as const satisfies Record<
  string,
  { indicator: string; goal: 'low' | 'high'; fallback: number | null }
>

export type TargetSetting = keyof typeof TARGET_SETTINGS

export const TARGET_SETTING_NAMES = Object.keys(TARGET_SETTINGS) as TargetSetting[]

export const isTargetSetting = (value: string): value is TargetSetting =>
  Object.hasOwn(TARGET_SETTINGS, value)

/** ร้อยละอยู่ระหว่าง 0–100 เสมอ ไม่ว่าเป็นเกณฑ์ของข้อไหน */
const TARGET_MIN = 0
const TARGET_MAX = 100

export type AgeSetting = keyof typeof AGE_SETTINGS

export const AGE_SETTING_NAMES = Object.keys(AGE_SETTINGS) as AgeSetting[]

export const isAgeSetting = (value: string): value is AgeSetting =>
  Object.hasOwn(AGE_SETTINGS, value)

/** ค่าเกณฑ์อายุหนึ่งข้อพร้อมขอบเขต — หน้าตั้งค่าใช้สร้างฟอร์ม */
export type AgeSettingValue = {
  name: AgeSetting
  label: string
  indicator: string
  /** ค่าที่ใช้อยู่จริงตอนนี้ */
  value: number
  /** ค่าตั้งต้นตามเอกสารตัวชี้วัด */
  fallback: number
  min: number
  max: number
  /** ตั้งค่าเองไว้หรือยังใช้ค่าตั้งต้นอยู่ */
  custom: boolean
}

const rows = (result: unknown) => result as unknown as Record<string, unknown>[]

/**
 * ค่าที่ตั้งไว้ในฐาน — ชื่อที่ไม่รู้จักหรือค่าที่อ่านเป็นตัวเลขไม่ได้จะถูกข้าม
 *
 * ค่านอกขอบเขตก็ข้ามด้วย ไม่ใช่ปัดเข้ามาให้พอดี — ถ้าในฐานมีค่าที่หน้าจอไม่ยอม
 * ให้กรอก แปลว่ามีคนแก้ตารางตรง ๆ ซึ่งควรกลับไปใช้ค่าตั้งต้นที่รู้ที่มา
 * ดีกว่าคำนวณด้วยค่าที่ไม่มีใครตั้งใจ
 */
async function storedAges(): Promise<Partial<Record<AgeSetting, number>>> {
  const [result] = await hisDb.execute(sql`SELECT name, value FROM pyhos_rdu_setting`)

  const stored: Partial<Record<AgeSetting, number>> = {}
  for (const row of rows(result)) {
    const name = String(row.name ?? '').trim()
    if (!isAgeSetting(name)) continue

    const value = Number(String(row.value ?? '').trim())
    if (!Number.isInteger(value)) continue

    const spec = AGE_SETTINGS[name]
    if (value < spec.min || value > spec.max) continue

    stored[name] = value
  }
  return stored
}

/**
 * ค่าเกณฑ์อายุที่ใช้จริงทุกข้อ
 *
 * อ่านทีเดียวทั้งชุดแม้ผู้เรียกจะใช้ค่าเดียว — ตารางมีไม่กี่แถว การอ่านทั้งตาราง
 * ถูกกว่าการวิ่งไปถามทีละชื่อ และทำให้คิวรีที่ต้องใช้หลายค่าไม่ต้องรอหลายรอบ
 */
export async function loadAgeSettings(): Promise<Record<AgeSetting, number>> {
  const stored = await storedAges()
  return Object.fromEntries(
    AGE_SETTING_NAMES.map(name => [name, stored[name] ?? AGE_SETTINGS[name].fallback]),
  ) as Record<AgeSetting, number>
}

/** ค่าเกณฑ์อายุทุกข้อพร้อมขอบเขตและที่มา — สำหรับหน้าตั้งค่า */
export async function listAgeSettings(): Promise<AgeSettingValue[]> {
  const stored = await storedAges()
  return AGE_SETTING_NAMES.map(name => {
    const spec = AGE_SETTINGS[name]
    return {
      name,
      label: spec.label,
      indicator: spec.indicator,
      value: stored[name] ?? spec.fallback,
      fallback: spec.fallback,
      min: spec.min,
      max: spec.max,
      custom: stored[name] != null,
    }
  })
}

/**
 * ตั้งค่าเกณฑ์อายุหนึ่งข้อ
 *
 * ตรวจขอบเขตอีกรอบที่นี่ ไม่ได้เชื่อฝั่งเรียก — เส้นทาง API ตรวจไว้แล้วก็จริง
 * แต่ฟังก์ชันนี้เป็นด่านสุดท้ายก่อนเขียนลงฐาน และเป็นที่เดียวที่รู้ขอบเขตของ
 * แต่ละชื่อแน่นอน
 *
 * ค่าที่เท่ากับค่าตั้งต้นจะลบแถวออกแทนที่จะเขียนทับ — แถวที่ไม่มีแปลว่า
 * "ใช้ตามเอกสาร" ซึ่งเป็นสถานะที่ต่างจาก "ตั้งเองให้เท่ากับเอกสารพอดี"
 * ถ้าวันหนึ่งเอกสารเปลี่ยนเกณฑ์ ข้อที่ไม่เคยตั้งเองจะขยับตามให้เอง
 */
export async function saveAgeSetting(name: AgeSetting, value: number): Promise<number> {
  const spec = AGE_SETTINGS[name]
  if (!Number.isInteger(value) || value < spec.min || value > spec.max) {
    throw new RangeError(`ค่าเกณฑ์ ${name} ต้องเป็นจำนวนเต็ม ${spec.min}–${spec.max}`)
  }

  if (value === spec.fallback) {
    await hisDb.execute(sql`DELETE FROM pyhos_rdu_setting WHERE name = ${name}`)
    return value
  }

  await hisDb.execute(sql`
    INSERT INTO pyhos_rdu_setting (name, value) VALUES (${name}, ${String(value)})
    ON DUPLICATE KEY UPDATE value = VALUES(value)`)

  return value
}

/* ───────────── เกณฑ์เป้าหมายเป็นร้อยละ ───────────── */

/** เกณฑ์เป้าหมายหนึ่งข้อ — หน้าตั้งค่าและหน้าสรุปใช้ร่วมกัน */
export type TargetSettingValue = {
  name: TargetSetting
  indicator: string
  goal: 'low' | 'high'
  /** ค่าที่ใช้อยู่ — null = ยังไม่ได้ตั้งเกณฑ์ กราฟจะไม่ลากเส้นเป้าหมาย */
  value: number | null
  fallback: number | null
  custom: boolean
}

/**
 * เกณฑ์ที่ตั้งไว้ในฐาน — ค่าที่อ่านเป็นตัวเลขไม่ได้หรืออยู่นอก 0–100 จะถูกข้าม
 *
 * ร้อยละมีทศนิยมได้ ต่างจากเกณฑ์อายุที่ต้องเป็นจำนวนเต็ม — เกณฑ์บางข้อของ
 * เอกสารเขียนเป็นทศนิยม และการปัดให้เป็นจำนวนเต็มจะทำให้เส้นเป้าหมายเพี้ยน
 */
async function storedTargets(): Promise<Partial<Record<TargetSetting, number>>> {
  const [result] = await hisDb.execute(sql`SELECT name, value FROM pyhos_rdu_setting`)

  const stored: Partial<Record<TargetSetting, number>> = {}
  for (const row of rows(result)) {
    const name = String(row.name ?? '').trim()
    if (!isTargetSetting(name)) continue

    const value = Number(String(row.value ?? '').trim())
    if (!Number.isFinite(value) || value < TARGET_MIN || value > TARGET_MAX) continue

    stored[name] = value
  }
  return stored
}

/** เกณฑ์เป้าหมายที่ใช้จริงทุกข้อ — null แปลว่ายังไม่ได้ตั้ง */
export async function loadTargets(): Promise<Record<TargetSetting, number | null>> {
  const stored = await storedTargets()
  return Object.fromEntries(
    TARGET_SETTING_NAMES.map(name => [name, stored[name] ?? TARGET_SETTINGS[name].fallback]),
  ) as Record<TargetSetting, number | null>
}

/** เกณฑ์เป้าหมายทุกข้อพร้อมที่มา — สำหรับหน้าตั้งค่า */
export async function listTargets(): Promise<TargetSettingValue[]> {
  const stored = await storedTargets()
  return TARGET_SETTING_NAMES.map(name => {
    const spec = TARGET_SETTINGS[name]
    return {
      name,
      indicator: spec.indicator,
      goal: spec.goal,
      value: stored[name] ?? spec.fallback,
      fallback: spec.fallback,
      custom: stored[name] != null,
    }
  })
}

/**
 * ตั้งเกณฑ์เป้าหมายหนึ่งข้อ — ส่ง null เพื่อกลับไปเป็น "ยังไม่ได้ตั้งเกณฑ์"
 *
 * ต่างจากเกณฑ์อายุตรงที่ค่าเท่ากับค่าตั้งต้นยังเก็บแถวไว้ ไม่ได้ลบทิ้ง — ข้อที่
 * ค่าตั้งต้นเป็น null การลบแถวแปลว่า "ไม่มีเกณฑ์" ซึ่งเป็นคนละเรื่องกับการยืนยัน
 * ว่าเกณฑ์คือเท่านี้ การกดยืนยันจึงต้องทิ้งร่องรอยไว้ว่ามีคนตั้งใจตั้งค่านี้
 */
export async function saveTarget(name: TargetSetting, value: number | null): Promise<number | null> {
  if (value == null) {
    await hisDb.execute(sql`DELETE FROM pyhos_rdu_setting WHERE name = ${name}`)
    return TARGET_SETTINGS[name].fallback
  }

  if (!Number.isFinite(value) || value < TARGET_MIN || value > TARGET_MAX) {
    throw new RangeError(`เกณฑ์เป้าหมายต้องอยู่ระหว่าง ${TARGET_MIN}–${TARGET_MAX}`)
  }

  await hisDb.execute(sql`
    INSERT INTO pyhos_rdu_setting (name, value) VALUES (${name}, ${String(value)})
    ON DUPLICATE KEY UPDATE value = VALUES(value)`)

  return value
}
