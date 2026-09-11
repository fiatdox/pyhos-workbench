import 'server-only'
import { cookies } from 'next/headers'
import { verifyAuthToken } from '@/lib/auth/jwt'
import { FEATURE_DENIED_MESSAGE, userCanUseRdu } from '@/lib/auth/permissions'

/**
 * ด่านตรวจร่วมของ API ในกลุ่ม RDU
 *
 * แยกไฟล์จาก due-user.ts ไม่ได้เรียกใช้ซ้ำ เพราะทั้งสองงานใช้คนละรายการตำแหน่ง
 * (DUE_USER_POSITION_IDS กับ RDU_USER_POSITION_IDS) ถ้าเรียกข้ามกัน การแก้สิทธิ์
 * ของงานหนึ่งจะไปเปลี่ยนสิทธิ์ของอีกงานโดยไม่มีใครตั้งใจ
 *
 * อยู่ในไฟล์นี้ไม่ใช่ในไฟล์ route เพราะ route ของ Next ส่งออกได้เฉพาะตัวจัดการ
 * ตามเมธอด (GET/POST/...) จะ export ตัวช่วยให้ route อื่นใช้ต่อไม่ได้
 */
export type RduUser = { ok: true; sub: string } | { ok: false; error: 'unauthorized' | 'forbidden' }

export async function requireRduUser(): Promise<RduUser> {
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  if (!claims?.sub) return { ok: false, error: 'unauthorized' }
  if (!(await userCanUseRdu(claims.sub))) return { ok: false, error: 'forbidden' }
  return { ok: true, sub: claims.sub }
}

export function denyRduUser(kind: 'unauthorized' | 'forbidden') {
  return kind === 'unauthorized'
    ? Response.json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 })
    : Response.json({ success: false, message: FEATURE_DENIED_MESSAGE }, { status: 403 })
}
