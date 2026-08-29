import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'

/**
 * วิธีใช้ยามาตรฐานจากตาราง drugusage
 *
 * `code` คือข้อความที่เจ้าหน้าที่ใช้ค้น (เช่น 1x3pc เช้า-กลางวัน-เย็น)
 * `shortlist` คือข้อความเต็มที่จะถูกพิมพ์ลงฉลากยา — เป็นค่าที่เอาไปใช้จริงเมื่อเลือกแล้ว
 */

export type DrugUsageOption = {
  code: string
  shortlist: string
}

/** ต้องพิมพ์อย่างน้อยเท่านี้ถึงจะค้น — ตารางมีกว่า 5,000 แถว ค้นสั้นกว่านี้ได้ผลกว้างเกินใช้งาน */
export const MIN_USAGE_SEARCH = 3

/** จำนวนตัวเลือกสูงสุดต่อการค้นหนึ่งครั้ง */
const MAX_OPTIONS = 50

export async function searchDrugUsage(term: string): Promise<DrugUsageOption[]> {
  const keyword = term.trim()
  if (keyword.length < MIN_USAGE_SEARCH) return []

  // escape อักขระพิเศษของ LIKE ก่อน ไม่ให้ % หรือ _ ที่ผู้ใช้พิมพ์กลายเป็น wildcard
  const pattern = `%${keyword.replace(/[\\%_]/g, ch => `\\${ch}`)}%`

  const [result] = await hisDb.execute(sql`
    SELECT code, shortlist
    FROM drugusage
    WHERE status = 'Y' AND code LIKE ${pattern} AND shortlist IS NOT NULL AND shortlist <> ''
    ORDER BY code
    LIMIT ${MAX_OPTIONS}`)

  const rows = result as unknown as Record<string, unknown>[]

  // ข้อความวิธีใช้เดียวกันถูกบันทึกซ้ำได้หลายรหัส — เก็บอันแรกพอ ไม่งั้นตัวเลือกซ้ำกันเต็มรายการ
  const seen = new Set<string>()
  const options: DrugUsageOption[] = []
  for (const row of rows) {
    const shortlist = String(row.shortlist).trim()
    if (!shortlist || seen.has(shortlist)) continue
    seen.add(shortlist)
    options.push({ code: String(row.code ?? '').trim(), shortlist })
  }
  return options
}
