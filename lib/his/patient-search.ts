import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'

/**
 * ค้นหาผู้ป่วยเพื่อหา HN — รับได้ทั้ง HN, เลขบัตรประชาชน และชื่อ-สกุล
 *
 * ตาราง patient มีราว 627,000 แถว การค้นจึงยึด index ที่มีอยู่เป็นหลัก
 * (ix_cid สำหรับเลขบัตร, ix_fname / ix_lname สำหรับชื่อ — ค้นแบบขึ้นต้นเท่านั้น
 * ถ้าใช้ LIKE '%คำ%' จะไล่ทั้งตาราง)
 *
 * ผลลัพธ์ไม่ส่งเลขบัตรประชาชนกลับไป แม้จะใช้ค้นได้ก็ตาม
 */

export type PatientMatch = {
  hn: string
  name: string
  age: number | null
  /** วันที่มารับบริการล่าสุด ใช้ช่วยแยกคนชื่อซ้ำกัน */
  lastVisit: string | null
}

/** จำนวนรายชื่อสูงสุดที่ให้เลือก */
const MAX_MATCHES = 20

export const MIN_NAME_SEARCH = 2

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v).trim() || null)

type Row = Record<string, unknown>

async function run(where: ReturnType<typeof sql>): Promise<PatientMatch[]> {
  const [result] = await hisDb.execute(sql`
    SELECT a.hn, CONCAT(a.pname, a.fname, ' ', a.lname) AS ptname,
           TIMESTAMPDIFF(YEAR, a.birthday, CURDATE()) AS age,
           DATE_FORMAT(a.last_visit, '%Y-%m-%d') AS last_visit
    FROM patient a
    WHERE ${where}
    ORDER BY a.last_visit DESC
    LIMIT ${MAX_MATCHES}`)

  return (result as unknown as Row[]).map(row => ({
    hn: String(row.hn),
    name: String(row.ptname ?? '').trim(),
    age: row.age == null ? null : Number(row.age),
    lastVisit: str(row.last_visit),
  }))
}

/** escape อักขระพิเศษของ LIKE ไม่ให้ % หรือ _ ที่ผู้ใช้พิมพ์กลายเป็น wildcard */
const like = (value: string) => value.replace(/[\\%_]/g, ch => `\\${ch}`)

export async function searchPatients(term: string): Promise<PatientMatch[]> {
  const keyword = term.trim()
  if (!keyword) return []

  const digits = keyword.replace(/\D/g, '')

  // เลขบัตรประชาชน 13 หลัก — ตรงตัวเท่านั้น
  if (/^\d{13}$/.test(keyword)) return run(sql`a.cid = ${digits}`)

  // ตัวเลขล้วนไม่เกิน 9 หลัก = HN (เติมศูนย์นำหน้าให้)
  if (/^\d{1,9}$/.test(keyword)) return run(sql`a.hn = ${digits.padStart(9, '0')}`)

  if (keyword.length < MIN_NAME_SEARCH) return []

  // ชื่อ-สกุล: คำเดียวค้นทั้งชื่อและสกุล, สองคำขึ้นไปถือว่าคำแรกเป็นชื่อ ที่เหลือเป็นสกุล
  const parts = keyword.split(/\s+/).filter(Boolean)
  if (parts.length === 1) {
    const prefix = `${like(parts[0])}%`
    return run(sql`(a.fname LIKE ${prefix} OR a.lname LIKE ${prefix})`)
  }

  const first = `${like(parts[0])}%`
  const last = `${like(parts.slice(1).join(' '))}%`
  return run(sql`a.fname LIKE ${first} AND a.lname LIKE ${last}`)
}
