import 'server-only'
import { hisScanPool } from '@/lib/db/his-scan'

/**
 * รูปผู้ป่วย (ตาราง patient_image ของฐานภาพ)
 *
 * หนึ่ง HN มีได้รูปเดียว (ในฐานจริง 40,613 แถว = 40,613 HN) เป็น JPEG ขนาดราว 5 KB
 * จึงดึงตรง ๆ ได้โดยไม่ต้องย่อหรือทำแคช
 */

type Row = Record<string, unknown>

/** มีรูปหรือไม่ — ใช้ตัดสินว่าจะแสดงกรอบรูปในหน้าจอไหม โดยไม่ต้องโหลดตัวรูป */
export async function hasPatientImage(hn: string): Promise<boolean> {
  const [rows] = await hisScanPool.execute(
    `SELECT 1 AS ok FROM patient_image WHERE hn = ? LIMIT 1`,
    [hn],
  )
  return (rows as unknown as Row[]).length > 0
}

export async function getPatientImage(hn: string): Promise<Buffer | null> {
  const [rows] = await hisScanPool.execute(
    `SELECT image FROM patient_image WHERE hn = ? LIMIT 1`,
    [hn],
  )
  const row = (rows as unknown as Row[])[0]
  if (!row || !Buffer.isBuffer(row.image) || row.image.length === 0) return null
  return row.image
}
