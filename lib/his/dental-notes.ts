import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'

/**
 * บันทึกทันตกรรมรายครั้ง (ตาราง dt_list — หนึ่งแถวต่อหนึ่ง vn)
 *
 * `dt_list` เก็บชื่อหัตถการทั้งครั้งไว้ในสตริงเดียว คั่นด้วยจุลภาค
 * `dental_note` เป็นข้อความธรรมดา (ไม่ใช่ RTF) ขึ้นบรรทัดด้วย \r\n
 *
 * `dental_in_datetime` ที่ระบุไว้ยังไม่มีการบันทึกจริงสักแถวในฐานนี้
 * จึงใช้เป็นวันที่หลักเมื่อมีค่า และตกมาที่ ovst.vstdate เมื่อไม่มี
 */

export type DentalNote = {
  vn: string
  /** 'YYYY-MM-DD' — จาก dental_in_datetime ถ้ามี ไม่งั้นใช้วันที่ของ visit */
  date: string | null
  time: string | null
  /** เวลาออกจากห้องทันตกรรม (มีเฉพาะกรณีที่บันทึกไว้) */
  outTime: string | null
  department: string | null
  doctor: string | null
  /** ชื่อหัตถการที่แตกจาก dt_list แล้ว */
  treatments: string[]
  note: string | null
}

/** จำนวนครั้งสูงสุดที่ดึงมา — ผู้ป่วยที่มาบ่อยสุดที่ทดสอบมี 22 ครั้งในหนึ่งปี */
const MAX_NOTES = 200

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v).trim() || null)

/** จำนวนครั้งที่มีบันทึกทันตกรรม — ต้อง join ovst เหมือนกัน เพราะ hn อยู่ที่ ovst */
export async function countDentalNotes(hn: string): Promise<number> {
  const [result] = await hisDb.execute(sql`
    SELECT COUNT(*) AS n
    FROM dt_list l
    INNER JOIN ovst o ON o.vn = l.vn
    WHERE o.hn = ${hn}`)
  const row = (result as unknown as Record<string, unknown>[])[0]
  return Number(row?.n ?? 0)
}

export async function getDentalNotes(hn: string): Promise<DentalNote[]> {
  const [result] = await hisDb.execute(sql`
    SELECT l.vn, l.dt_list, l.dental_note,
           DATE_FORMAT(l.dental_in_datetime, '%Y-%m-%d') AS in_date,
           DATE_FORMAT(l.dental_in_datetime, '%H:%i') AS in_time,
           DATE_FORMAT(l.dental_out_datetime, '%H:%i') AS out_time,
           DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS vstdate, o.vsttime,
           dep.department, doc.name AS doctor_name
    FROM dt_list l
    INNER JOIN ovst o ON o.vn = l.vn
    LEFT OUTER JOIN kskdepartment dep ON dep.depcode = o.main_dep
    LEFT OUTER JOIN doctor doc ON doc.code = o.doctor
    WHERE o.hn = ${hn}
    ORDER BY o.vstdate DESC, o.vsttime DESC
    LIMIT ${MAX_NOTES}`)

  const rows = result as unknown as Record<string, unknown>[]

  return rows.map(row => ({
    vn: String(row.vn),
    date: str(row.in_date) ?? str(row.vstdate),
    time: str(row.in_time) ?? str(row.vsttime)?.slice(0, 5) ?? null,
    outTime: str(row.out_time),
    department: str(row.department),
    doctor: str(row.doctor_name),
    // dt_list เป็น varchar(250) รายการยาว ๆ จะถูกตัดท้าย — ตัดชิ้นที่ขาดครึ่งทิ้งไม่ได้
    // เพราะแยกไม่ออกจากชื่อสั้นจริง จึงแสดงตามที่เก็บไว้
    treatments: String(row.dt_list ?? '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean),
    note: str(row.dental_note)?.replace(/\r\n?/g, '\n') ?? null,
  }))
}
