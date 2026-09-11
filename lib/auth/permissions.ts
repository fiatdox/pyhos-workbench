import 'server-only'
import { eq } from 'drizzle-orm'
import { coreKonDb } from '@/lib/db/core-kon'
import { users } from '@/lib/db/schema/core-kon'
import { canUseDue, canUseRdu } from '@/lib/auth/access'

/**
 * ถามสิทธิ์รายงานจากรหัสผู้ใช้ใน token
 *
 * หน้าเว็บกับ API ต้องได้คำตอบเดียวกัน — ถ้าซ่อนเมนูอย่างเดียวแล้วไม่กัน API
 * คนที่รู้ URL ก็ยังเรียกข้อมูลได้ตรง ๆ การซ่อนเมนูเป็นเรื่องความสะอาดของหน้าจอ
 * ส่วนการกันจริงอยู่ที่ฝั่งเซิร์ฟเวอร์ทุกทาง
 *
 * ตรวจทุกครั้งที่เรียก ไม่ฝังสิทธิ์ไว้ใน token — token มีอายุแปดชั่วโมง ถ้าฝังไว้
 * คนที่เพิ่งถูกถอดสิทธิ์จะใช้งานต่อได้จนกว่าจะหมดอายุ
 */
export async function userPositionOf(userId: string | number): Promise<number | null> {
  const id = Number(userId)
  if (!Number.isInteger(id)) return null

  const [row] = await coreKonDb
    .select({ positionId: users.userPositionId, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, id))
    .limit(1)

  if (!row || row.isActive !== 'Y') return null
  return row.positionId ?? null
}

/** ผู้ใช้คนนี้ใช้งานงาน DUE ได้หรือไม่ */
export async function userCanUseDue(userId: string | number): Promise<boolean> {
  return canUseDue(await userPositionOf(userId))
}

/** ผู้ใช้คนนี้ใช้งานงาน RDU ได้หรือไม่ — คนละรายการตำแหน่งกับ DUE */
export async function userCanUseRdu(userId: string | number): Promise<boolean> {
  return canUseRdu(await userPositionOf(userId))
}

/** ข้อความตอบกลับเมื่อเรียกข้อมูลของงานที่ไม่มีสิทธิ์ */
export const FEATURE_DENIED_MESSAGE = 'บัญชีนี้ไม่มีสิทธิ์ใช้งานส่วนนี้'
