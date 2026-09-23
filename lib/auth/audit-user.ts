import 'server-only'
import { cookies } from 'next/headers'
import { and, eq, inArray } from 'drizzle-orm'
import { verifyAuthToken } from '@/lib/auth/jwt'
import { coreKonDb } from '@/lib/db/core-kon'
import { userMUsersRoles, userRoles, users } from '@/lib/db/schema/core-kon'

/**
 * ด่านตรวจของหน้าและ API ที่อ่านร่องรอยการใช้งาน
 *
 * ตารางล็อกเก็บ HN ที่แต่ละคนเปิดดู ตัวมันจึงเป็นข้อมูลอ่อนไหวเสียเอง — คนที่อ่าน
 * ตารางนี้ได้ จะเห็นพฤติกรรมของเพื่อนร่วมงานทุกคน สิทธิ์จึงคุมด้วย role ไม่ใช่
 * ตำแหน่งแบบงาน DUE/RDU เพราะงานสองอันนั้นถามว่า "ทำงานสายไหน" ส่วนอันนี้ถามว่า
 * "ได้รับมอบหมายให้ดูแลระบบหรือไม่" ซึ่งเป็นคนละคำถามกัน
 *
 * ตรวจสดทุกครั้งไม่ฝังไว้ใน token ด้วยเหตุผลเดียวกับ lib/auth/permissions.ts —
 * token อายุแปดชั่วโมง คนที่เพิ่งถูกถอด role ต้องหมดสิทธิ์ทันที ไม่ใช่รอหมดอายุ
 */
const AUDIT_ROLES = ['ADMIN', 'IT_STAFF', 'CHIEF_GROUP_IT', 'CHIEF_MISSION_IT']

export const AUDIT_DENIED_MESSAGE = 'บัญชีนี้ไม่มีสิทธิ์ดูร่องรอยการใช้งาน'

export type AuditUser =
  | { ok: true; sub: string; username: string }
  | { ok: false; error: 'unauthorized' | 'forbidden' }

/** ผู้ใช้คนนี้ถือ role ที่ดูร่องรอยได้หรือไม่ — และต้องยังเปิดใช้งานอยู่ */
export async function userCanAudit(userId: string | number): Promise<boolean> {
  const id = Number(userId)
  if (!Number.isInteger(id)) return false

  const [account] = await coreKonDb
    .select({ isActive: users.isActive })
    .from(users)
    .where(eq(users.id, id))
    .limit(1)

  if (account?.isActive !== 'Y') return false

  const [row] = await coreKonDb
    .select({ roleId: userMUsersRoles.roleId })
    .from(userMUsersRoles)
    .innerJoin(userRoles, eq(userRoles.id, userMUsersRoles.roleId))
    .where(and(eq(userMUsersRoles.userId, id), inArray(userRoles.roleName, AUDIT_ROLES)))
    .limit(1)

  return Boolean(row)
}

export async function requireAuditUser(): Promise<AuditUser> {
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  if (!claims?.sub) return { ok: false, error: 'unauthorized' }
  if (!(await userCanAudit(claims.sub))) return { ok: false, error: 'forbidden' }
  return { ok: true, sub: claims.sub, username: claims.username }
}

export function denyAuditUser(kind: 'unauthorized' | 'forbidden') {
  return kind === 'unauthorized'
    ? Response.json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 })
    : Response.json({ success: false, message: AUDIT_DENIED_MESSAGE }, { status: 403 })
}
