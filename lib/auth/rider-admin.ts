import 'server-only'
import { cookies } from 'next/headers'
import { and, eq, or } from 'drizzle-orm'
import { verifyAuthToken } from '@/lib/auth/jwt'
import { coreKonDb } from '@/lib/db/core-kon'
import { submajors, userMUsersRoles, userRoles, users } from '@/lib/db/schema/core-kon'

/**
 * ด่านตรวจของการตั้งค่า Health Rider — เพิ่มเจ้าหน้าที่ และจัดพื้นที่รับผิดชอบ
 *
 * สองหน้านี้กำหนดว่าใครออกไปส่งยาที่ไหนได้บ้าง ซึ่งเป็นการมอบหมายงานของหน่วยงาน
 * ไม่ใช่การใช้งานประจำวัน เส้นทางหลักของสิทธิ์จึงผูกกับ "หัวหน้างาน" ในกลุ่มงาน
 * เภสัชกรรม ตามที่บันทึกไว้ใน core_kon.submajors.supervisor_id ของงานย่อยที่
 * อยู่ใต้ major_id 37
 *
 * ระวังอย่าสับสนกับ core_kon.majors.supervisor_id ซึ่งเป็นคนละชั้นกัน — ตารางนั้น
 * เก็บ "หัวหน้ากลุ่มงาน" (role CHIEF_GROUP) ทั้งกลุ่ม ส่วนตารางนี้เก็บ "หัวหน้างาน"
 * (role CHIEF_UNIT) รายงานย่อย ผู้ใช้ต้องการชั้นหลัง หัวหน้ากลุ่มงานจึงไม่ได้สิทธิ์
 * จากเส้นทางนี้
 *
 * ไม่ผูกกับ role CHIEF_UNIT ตรง ๆ แม้จะเป็นชื่อเดียวกัน — ในกลุ่มงานเภสัชกรรมมีคน
 * ถือ role นั้นอยู่แปดคน แต่ที่ลงทะเบียนเป็นหัวหน้างานย่อยจริงมีสามคน ผู้ใช้เลือก
 * ชุดหลัง เพราะการถือ role บอกแค่ระดับ ส่วนช่องหัวหน้าบอกว่ารับผิดชอบงานไหนจริง
 *
 * นับผู้รักษาการด้วย (acting_supervisor_id) — คอลัมน์นั้นมีไว้สำหรับช่วงที่หัวหน้า
 * ตัวจริงไม่อยู่ ตอนนี้ยังว่างทุกงานย่อย ใส่เมื่อไรก็ทำงานทันทีโดยไม่ต้องแก้โค้ด
 *
 * ผู้ดูแลระบบ (role ADMIN) เข้าได้เท่าหัวหน้างานทุกอย่าง รวมถึงแก้ไข — เป็นทางออก
 * เมื่อช่องหัวหน้าในทะเบียนว่างหรือชี้ผิดคน ซึ่งถ้าไม่มีใครเข้าได้เลยจะต้องไปแก้
 * ฐานข้อมูลตรง ๆ เท่านั้น ไม่นับ role ฝั่ง IT อื่น (IT_STAFF, หัวหน้ากลุ่ม IT)
 * ต่างจากหน้าร่องรอยการใช้งาน เพราะที่นี่คือการมอบหมายงานของหน่วยงาน ไม่ใช่
 * การตรวจสอบระบบ
 */

/** กลุ่มงานเภสัชกรรมใน core_kon.majors — ใช้จำกัดขอบเขตของงานย่อยที่นับ */
export const PHARMACY_MAJOR_ID = 37

/** role ที่เข้าได้เท่าหัวหน้างาน — ชื่อตรงกับค่าใน core_kon.user_roles.role_name */
const ADMIN_ROLE = 'ADMIN'

export const RIDER_ADMIN_DENIED_MESSAGE =
  'เฉพาะหัวหน้างานในกลุ่มงานเภสัชกรรมหรือผู้ดูแลระบบเท่านั้นที่ตั้งค่าส่วนนี้ได้'

export type RiderAdmin =
  | { ok: true; sub: string }
  | { ok: false; error: 'unauthorized' | 'forbidden' }

/**
 * ผู้ใช้คนนี้ตั้งค่า Health Rider ได้ไหม
 *
 * ผ่านได้สองทาง: เป็นหัวหน้า (หรือผู้รักษาการ) ของงานย่อยใดก็ได้ในกลุ่มงาน
 * เภสัชกรรม หรือถือ role ADMIN — ทั้งสองทางให้สิทธิ์เท่ากันทุกอย่างรวมถึงแก้ไข
 *
 * ตรวจสดทุกครั้ง ไม่ฝังไว้ใน token ด้วยเหตุผลเดียวกับ lib/auth/permissions.ts —
 * token อายุแปดชั่วโมง คนที่เพิ่งพ้นตำแหน่งต้องหมดสิทธิ์ทันที
 */
export async function userIsRiderAdmin(userId: string | number): Promise<boolean> {
  const id = Number(userId)
  if (!Number.isInteger(id)) return false

  // บัญชีที่ถูกระงับไปแล้วไม่นับ แม้ชื่อยังค้างอยู่ในช่องหัวหน้าของทะเบียนหน่วยงาน
  const [account] = await coreKonDb
    .select({ isActive: users.isActive })
    .from(users)
    .where(eq(users.id, id))
    .limit(1)

  if (account?.isActive !== 'Y') return false

  // ต้องตรึง major_id ไว้ในเงื่อนไขเดียวกันเสมอ — ถ้าแยกออกไปถามทีหลัง
  // หัวหน้างานของกลุ่มงานอื่นทั้งโรงพยาบาลจะผ่านด่านนี้ไปด้วย
  const [supervisor] = await coreKonDb
    .select({ submajorId: submajors.submajorId })
    .from(submajors)
    .where(
      and(
        eq(submajors.majorId, PHARMACY_MAJOR_ID),
        or(eq(submajors.supervisorId, id), eq(submajors.actingSupervisorId, id)),
      ),
    )
    .limit(1)

  if (supervisor) return true

  // ถามเรื่อง role ต่อเมื่อไม่ใช่หัวหน้างาน — ทางที่คนใช้จริงทุกวันคือทางบน
  // จึงให้จบตั้งแต่คิวรีแรก ไม่ต้องยิงสองครั้งทุกคำขอ
  const [admin] = await coreKonDb
    .select({ roleId: userMUsersRoles.roleId })
    .from(userMUsersRoles)
    .innerJoin(userRoles, eq(userRoles.id, userMUsersRoles.roleId))
    .where(and(eq(userMUsersRoles.userId, id), eq(userRoles.roleName, ADMIN_ROLE)))
    .limit(1)

  return Boolean(admin)
}

export async function requireRiderAdmin(): Promise<RiderAdmin> {
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  if (!claims?.sub) return { ok: false, error: 'unauthorized' }
  if (!(await userIsRiderAdmin(claims.sub))) return { ok: false, error: 'forbidden' }
  return { ok: true, sub: claims.sub }
}

export function denyRiderAdmin(kind: 'unauthorized' | 'forbidden') {
  return kind === 'unauthorized'
    ? Response.json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 })
    : Response.json({ success: false, message: RIDER_ADMIN_DENIED_MESSAGE }, { status: 403 })
}
