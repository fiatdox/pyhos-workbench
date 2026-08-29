import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'

/**
 * ประวัติผลตรวจร่างกาย/บันทึกแพทย์ (opdscreen.pe) ของผู้ป่วยหนึ่งราย
 * ดูรวมทุกครั้งที่มารับบริการเหมือนหน้า Note ไม่จำกัดช่วงเดือนที่เลือกไว้
 */

export type PhysicalExam = {
  vn: string
  date: string | null
  time: string | null
  department: string | null
  doctor: string | null
  pe: string
}

/** กันดึงทีเดียวหนักเกินไป — ผู้ป่วยที่มาบ่อยสุดที่ทดสอบมีราว 138 ครั้ง */
const MAX_RECORDS = 200

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v).trim() || null)

export async function getPatientPhysicalExams(hn: string): Promise<PhysicalExam[]> {
  const [result] = await hisDb.execute(sql`
    SELECT a.vn, DATE_FORMAT(a.vstdate, '%Y-%m-%d') AS vstdate, a.vsttime, a.pe,
           dep.department, d.name AS doctor_name
    FROM opdscreen a
    LEFT OUTER JOIN ovst o ON o.vn = a.vn
    LEFT OUTER JOIN kskdepartment dep ON dep.depcode = o.main_dep
    LEFT OUTER JOIN doctor d ON d.code = o.doctor
    WHERE a.hn = ${hn} AND a.pe IS NOT NULL AND a.pe <> ''
    ORDER BY a.vstdate DESC, a.vsttime DESC
    LIMIT ${MAX_RECORDS}`)

  const rows = result as unknown as Record<string, unknown>[]

  return rows.map(row => ({
    vn: String(row.vn),
    date: str(row.vstdate),
    time: str(row.vsttime)?.slice(0, 5) ?? null,
    department: str(row.department),
    doctor: str(row.doctor_name),
    // HIS เก็บขึ้นบรรทัดแบบ \r\n — ตัด \r ทิ้งให้เหลือ \n อย่างเดียว
    pe: String(row.pe).replace(/\r\n?/g, '\n').trim(),
  }))
}
