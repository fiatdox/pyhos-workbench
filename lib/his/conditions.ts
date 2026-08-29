import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'

/**
 * กลุ่มโรคสำคัญของผู้ป่วย — ดูจากรหัส ICD-10 ที่เคยถูกวินิจฉัยไว้ทั้งหมด (ไม่จำกัดช่วงเวลา)
 * ใช้เป็นการแจ้งเตือนเบื้องต้นให้ผู้ใช้ทราบก่อนดูรายละเอียด ไม่ใช่ข้อสรุปทางการแพทย์
 *
 * ดึงรหัสที่ต่างกันมาก่อน (ผู้ป่วยหนึ่งคนมักมีไม่กี่สิบรหัส) แล้วค่อยจับกลุ่มฝั่ง JS
 * ทำให้กติกาการจับกลุ่มอ่านและแก้ได้ในที่เดียว ไม่ต้องเขียนเงื่อนไขยาว ๆ ลงใน SQL
 */

export type ConditionKey = 'stroke' | 'heart' | 'sepsis' | 'copd' | 'asthma' | 'cancer'

/** รหัสหนึ่งตัวที่ทำให้ผู้ป่วยเข้ากลุ่มโรคนั้น */
export type ConditionCode = {
  icd10: string
  name: string | null
  /** จำนวนครั้งที่ถูกวินิจฉัยด้วยรหัสนี้ */
  count: number
  lastDate: string | null
}

export type PatientCondition = {
  key: ConditionKey
  label: string
  codes: ConditionCode[]
  /** วันที่ล่าสุดที่ถูกวินิจฉัยในกลุ่มนี้ */
  lastDate: string | null
}

type Rule = {
  key: ConditionKey
  label: string
  /** ช่วงหมวด ICD-10 สามหลักแรก (รวมปลายทั้งสองด้าน) */
  ranges?: [string, string][]
  /** หมวดสามหลักแรกแบบระบุตรง ๆ */
  categories?: string[]
  /** รหัสเต็มที่ต้องขึ้นต้นด้วยข้อความนี้ */
  prefixes?: string[]
}

/**
 * เกณฑ์จับกลุ่ม อิงหมวดหมู่มาตรฐานของ ICD-10
 * ตั้งใจให้แคบไว้ก่อน — แจ้งเตือนผิดบ่อยจะทำให้ผู้ใช้เลิกสนใจป้ายเตือน
 */
const RULES: Rule[] = [
  {
    key: 'stroke',
    label: 'โรคหลอดเลือดสมอง (Stroke)',
    // I60-I69 = โรคหลอดเลือดสมองทั้งหมด รวมภาวะหลังเป็น (I69)
    ranges: [['I60', 'I69']],
  },
  {
    key: 'heart',
    label: 'โรคหัวใจ',
    // I05-I09 ลิ้นหัวใจจากไข้รูมาติก, I20-I25 หลอดเลือดหัวใจ, I30-I52 โรคหัวใจอื่นรวมหัวใจล้มเหลว
    ranges: [
      ['I05', 'I09'],
      ['I20', 'I25'],
      ['I30', 'I52'],
    ],
    // I11 = ความดันโลหิตสูงที่มีผลต่อหัวใจ (ต่างจาก I10 ที่เป็นความดันสูงเฉย ๆ)
    categories: ['I11'],
  },
  {
    key: 'sepsis',
    label: 'ติดเชื้อในกระแสเลือด (Sepsis)',
    categories: ['A40', 'A41', 'P36'],
    // R57.2 = ช็อกจากการติดเชื้อ
    prefixes: ['R572'],
  },
  {
    key: 'copd',
    label: 'ถุงลมโป่งพอง (COPD)',
    categories: ['J43', 'J44'],
  },
  {
    key: 'asthma',
    label: 'หอบหืด (Asthma)',
    categories: ['J45', 'J46'],
  },
  {
    key: 'cancer',
    label: 'มะเร็ง',
    // C00-C97 = เนื้องอกร้ายทุกตำแหน่ง
    ranges: [['C00', 'C97']],
  },
]

function matches(rule: Rule, icd10: string): boolean {
  const category = icd10.slice(0, 3).toUpperCase()
  if (rule.categories?.includes(category)) return true
  if (rule.ranges?.some(([from, to]) => category >= from && category <= to)) return true
  return rule.prefixes?.some(prefix => icd10.toUpperCase().startsWith(prefix)) ?? false
}

export async function getPatientConditions(hn: string): Promise<PatientCondition[]> {
  const [result] = await hisDb.execute(sql`
    SELECT a.icd10, MAX(b.name) AS icd_name, COUNT(*) AS n,
           DATE_FORMAT(MAX(a.vstdate), '%Y-%m-%d') AS last_date
    FROM ovstdiag a
    LEFT OUTER JOIN icd101 b ON b.code = a.icd10
    WHERE a.hn = ${hn} AND a.icd10 IS NOT NULL AND a.icd10 <> ''
    GROUP BY a.icd10`)

  const rows = result as unknown as Record<string, unknown>[]
  const conditions: PatientCondition[] = []

  for (const rule of RULES) {
    const codes: ConditionCode[] = []
    for (const row of rows) {
      const icd10 = String(row.icd10).trim()
      if (!matches(rule, icd10)) continue
      codes.push({
        icd10,
        name: row.icd_name == null || row.icd_name === '' ? null : String(row.icd_name),
        count: Number(row.n ?? 0),
        lastDate: row.last_date == null ? null : String(row.last_date),
      })
    }
    if (codes.length === 0) continue

    // รหัสที่เพิ่งถูกวินิจฉัยล่าสุดขึ้นก่อน
    codes.sort((a, b) => (b.lastDate ?? '').localeCompare(a.lastDate ?? ''))
    conditions.push({
      key: rule.key,
      label: rule.label,
      codes,
      lastDate: codes[0].lastDate,
    })
  }

  // กลุ่มที่มีการวินิจฉัยล่าสุดอยู่ซ้ายสุด
  return conditions.sort((a, b) => (b.lastDate ?? '').localeCompare(a.lastDate ?? ''))
}
