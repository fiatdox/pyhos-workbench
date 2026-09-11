import 'server-only'
import { cookies } from 'next/headers'
import { verifyAuthToken } from '@/lib/auth/jwt'
import { FEATURE_DENIED_MESSAGE, userCanUseDue } from '@/lib/auth/permissions'

/**
 * ด่านตรวจร่วมของ API ในกลุ่ม DUE
 *
 * อยู่ในไฟล์นี้ไม่ใช่ในไฟล์ route เพราะ route ของ Next ส่งออกได้เฉพาะตัวจัดการ
 * ตามเมธอด (GET/POST/...) จะ export ตัวช่วยให้ route อื่นใช้ต่อไม่ได้
 *
 * เข้าระบบได้ไม่ได้แปลว่าใช้ DUE ได้ — เมนูนี้จำกัดตามตำแหน่ง (ดู userCanUseDue)
 * จึงต้องเช็คทั้งสองชั้นทุกเส้นทาง ไม่ใช่เช็คแค่ตอนเรนเดอร์หน้า
 */
export type DueUser = { ok: true; sub: string } | { ok: false; error: 'unauthorized' | 'forbidden' }

export async function requireDueUser(): Promise<DueUser> {
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  if (!claims?.sub) return { ok: false, error: 'unauthorized' }
  if (!(await userCanUseDue(claims.sub))) return { ok: false, error: 'forbidden' }
  return { ok: true, sub: claims.sub }
}

export function denyDueUser(kind: 'unauthorized' | 'forbidden') {
  return kind === 'unauthorized'
    ? Response.json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 })
    : Response.json({ success: false, message: FEATURE_DENIED_MESSAGE }, { status: 403 })
}
