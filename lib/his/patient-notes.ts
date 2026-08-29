import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'

/**
 * Note View — พอร์ตจาก `SELECT * FROM ptnote WHERE hn=... ORDER BY ptnote_id DESC`
 *
 * คอลัมน์ `ptnote` เก็บเป็น RTF (มีโค้ด \\'b5\\'c3... ปนอยู่) จึงไม่เอามาแสดง
 * ใช้ `plain_text` ที่ HIS ถอดไว้ให้แล้วแทน และเผื่อ `prsc_note_text` ไว้เป็นตัวสำรอง
 */

export type PatientNote = {
  id: number
  /** ประเภทที่โน้ตนี้ไปโผล่ เช่น OPDCARD, DOCTOR, IPD (แตกจาก noteflag) */
  flags: string[]
  groupName: string | null
  text: string
  noteDateTime: string | null
  visitDate: string | null
  /** ชื่อผู้บันทึกจาก opduser — ถ้าหาไม่เจอจะตกมาเป็น login name ที่บันทึกไว้ */
  staff: string | null
  staffPosition: string | null
  isPublic: boolean
  expireDate: string | null
}

/** กันดึงทีเดียวหนักเกินไป — ในฐานจริงคนที่มีโน้ตเยอะสุดอยู่ราว 46 รายการ */
const MAX_NOTES = 200

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v))

export async function getPatientNotes(hn: string): Promise<PatientNote[]> {
  const [result] = await hisDb.execute(sql`
    SELECT a.ptnote_id, a.noteflag, a.groupname, a.plain_text, a.prsc_note_text,
           DATE_FORMAT(a.note_datetime, '%Y-%m-%d %H:%i') AS note_datetime,
           DATE_FORMAT(a.vstdate, '%Y-%m-%d') AS vstdate,
           a.note_staff, u.name AS staff_name, u.entryposition AS staff_position,
           a.public_note,
           DATE_FORMAT(a.expire_date, '%Y-%m-%d') AS expire_date
    FROM ptnote a
    LEFT OUTER JOIN opduser u ON u.loginname = a.note_staff
    WHERE a.hn = ${hn}
    ORDER BY a.ptnote_id DESC
    LIMIT ${MAX_NOTES}`)

  const rows = result as unknown as Record<string, unknown>[]

  return rows.map(row => ({
    id: Number(row.ptnote_id),
    // noteflag มาในรูป "[OPDCARD][REGIST][IPD]"
    flags: String(row.noteflag ?? '')
      .split(/[[\]]/)
      .map(s => s.trim())
      .filter(Boolean),
    groupName: str(row.groupname),
    // ตัด null byte ท้ายข้อความที่ติดมาจากฝั่ง HIS และช่องว่างส่วนเกิน
    text: String(row.plain_text ?? row.prsc_note_text ?? '')
      .replace(/\0/g, '')
      .trim(),
    noteDateTime: str(row.note_datetime),
    visitDate: str(row.vstdate),
    staff: str(row.staff_name) ?? str(row.note_staff),
    staffPosition: str(row.staff_position),
    isPublic: row.public_note === 'Y',
    expireDate: str(row.expire_date),
  }))
}
