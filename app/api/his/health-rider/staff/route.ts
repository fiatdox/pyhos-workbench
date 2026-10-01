import { cookies } from 'next/headers'
import { verifyAuthToken } from '@/lib/auth/jwt'
import {
  createRiderStaff,
  isValidThaiCid,
  listRiderStaff,
  setRiderStaffActive,
  setRiderStaffRole,
} from '@/lib/his/health-rider'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'
import { denyRiderAdmin, requireRiderAdmin } from '@/lib/auth/rider-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PER_IP = { limit: 60, windowSeconds: 300 }
// การเพิ่มข้อมูลคุมเข้มกว่าการอ่าน — เขียนลงฐานจริงและลบเองไม่ได้จากหน้านี้
const PER_IP_WRITE = { limit: 20, windowSeconds: 300 }

/** ความยาวสูงสุดตามที่คอลัมน์ในฐานรับได้ ตัดตั้งแต่ชั้นนี้ ไม่ปล่อยให้ฐานตัดเงียบ ๆ */
const MAX = { pname: 25, fname: 150, lname: 100 }

function bad(message: string) {
  return Response.json({ success: false, message }, { status: 400 })
}

export async function GET(request: Request) {
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  if (!claims?.sub) {
    return Response.json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 })
  }

  const ip = clientIp(request)
  const limited = rateLimit(`rider-staff:${claims.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'เรียกบ่อยเกินไป กรุณารอสักครู่')
  }

  try {
    const staff = await listRiderStaff()
    return Response.json({ success: true, staff })
  } catch (error) {
    console.error('[his/health-rider/staff] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'ดึงรายชื่อเจ้าหน้าที่ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}

/** เพิ่มเจ้าหน้าที่หนึ่งคน — active เป็น 'Y' เสมอ ไม่รับค่ามาจากฟอร์ม */
export async function POST(request: Request) {
  // เฉพาะหัวหน้ากลุ่มงานเภสัชกรรม — ส่วนนี้คือการมอบหมายงานของหน่วยงาน
  const admin = await requireRiderAdmin()
  if (!admin.ok) return denyRiderAdmin(admin.error)

  const ip = clientIp(request)
  const limited = rateLimit(
    `rider-staff-add:${admin.sub}:${ip}`,
    PER_IP_WRITE.limit,
    PER_IP_WRITE.windowSeconds,
  )
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'เพิ่มข้อมูลถี่เกินไป กรุณารอสักครู่')
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return bad('รูปแบบข้อมูลไม่ถูกต้อง')
  }

  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
  const pname = text(body.pname)
  const fname = text(body.fname)
  const lname = text(body.lname)
  // เผื่อผู้ใช้พิมพ์ขีดคั่นแบบบนบัตร (x-xxxx-xxxxx-xx-x)
  const cid = text(body.cid).replace(/\D/g, '')
  const role = Number(body.role)

  if (!fname || !lname) return bad('กรุณากรอกชื่อและนามสกุล')
  if (pname.length > MAX.pname || fname.length > MAX.fname || lname.length > MAX.lname) {
    return bad('ชื่อหรือนามสกุลยาวเกินกว่าที่ระบบรับได้')
  }
  if (!isValidThaiCid(cid)) return bad('เลขบัตรประชาชนไม่ถูกต้อง')
  if (!Number.isInteger(role)) return bad('กรุณาเลือกประเภทเจ้าหน้าที่')

  try {
    const result = await createRiderStaff({ pname, fname, lname, cid, role })
    if (!result.ok) {
      return bad(
        result.reason === 'duplicate_cid'
          ? 'เลขบัตรประชาชนนี้มีอยู่ในทะเบียนแล้ว'
          : 'ไม่พบประเภทเจ้าหน้าที่ที่เลือก',
      )
    }
    // ไม่ส่ง cid กลับไป — ฝั่งหน้าจอไม่ได้ใช้ และไม่ควรมีเลขบัตรค้างอยู่ในเบราว์เซอร์
    return Response.json({ success: true, id: result.id })
  } catch (error) {
    // เผื่อมีคนเพิ่มเลขบัตรเดียวกันพร้อมกันจนหลุดการเช็คก่อนหน้าไปชน unique key
    if ((error as { errno?: number }).errno === 1062) {
      return bad('เลขบัตรประชาชนนี้มีอยู่ในทะเบียนแล้ว')
    }
    console.error('[his/health-rider/staff] เพิ่มไม่สำเร็จ:', error)
    return Response.json(
      { success: false, message: 'เพิ่มเจ้าหน้าที่ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}

/**
 * แก้ไขเจ้าหน้าที่หนึ่งคน — รับได้เฉพาะสถานะใช้งาน หรือประเภทเจ้าหน้าที่
 *
 * รับทีละอย่าง ไม่ใช่ทั้งแถว ชื่อกับเลขบัตรยังแก้จากหน้านี้ไม่ได้ตั้งใจ — สองค่านั้น
 * เป็นตัวตนของคน กรอกผิดตั้งแต่แรกควรไปแก้ที่ต้นทางพร้อมหลักฐาน ไม่ใช่พิมพ์ทับ
 * ในตารางงาน ส่วนประเภทคือหน้าที่ที่ได้รับมอบหมาย ซึ่งย้ายกันได้จริงจึงเปิดให้แก้
 */
export async function PATCH(request: Request) {
  // เฉพาะหัวหน้ากลุ่มงานเภสัชกรรม — ส่วนนี้คือการมอบหมายงานของหน่วยงาน
  const admin = await requireRiderAdmin()
  if (!admin.ok) return denyRiderAdmin(admin.error)

  const ip = clientIp(request)
  const limited = rateLimit(
    `rider-staff-edit:${admin.sub}:${ip}`,
    PER_IP_WRITE.limit,
    PER_IP_WRITE.windowSeconds,
  )
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'แก้ไขข้อมูลถี่เกินไป กรุณารอสักครู่')
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return bad('รูปแบบข้อมูลไม่ถูกต้อง')
  }

  const id = Number(body.id)
  if (!Number.isInteger(id) || id <= 0) return bad('รหัสเจ้าหน้าที่ไม่ถูกต้อง')

  const wantsActive = body.active !== undefined
  const wantsRole = body.role !== undefined
  // บังคับให้ส่งมาอย่างเดียว ไม่ใช่เพราะฐานทำพร้อมกันไม่ได้ แต่เพราะสองเรื่องนี้
  // มีข้อความยืนยันคนละแบบในหน้าจอ ถ้าปนกันมาจะไม่รู้ว่าควรตอบกลับว่าอะไรสำเร็จ
  if (wantsActive === wantsRole) return bad('ระบุสิ่งที่ต้องการแก้มาอย่างเดียว')

  if (wantsRole) {
    const role = Number(body.role)
    // ไม่กัน 0 ออก — ประเภท admin ในตารางอ้างอิงใช้รหัส 0 จริง การเช็คว่ามีอยู่จริง
    // เป็นหน้าที่ของชั้นฐานข้อมูล ไม่ใช่การเดาจากค่าของตัวเลข
    if (!Number.isInteger(role)) return bad('กรุณาเลือกประเภทเจ้าหน้าที่')

    try {
      const result = await setRiderStaffRole({ id, role })
      if (result === 'not_found') {
        return Response.json({ success: false, message: 'ไม่พบเจ้าหน้าที่คนนี้' }, { status: 404 })
      }
      if (result === 'unknown_role') return bad('ไม่พบประเภทเจ้าหน้าที่ที่เลือก')
      return Response.json({ success: true })
    } catch (error) {
      console.error('[his/health-rider/staff] แก้ประเภทไม่สำเร็จ:', error)
      return Response.json(
        { success: false, message: 'แก้ประเภทเจ้าหน้าที่ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
        { status: 500 },
      )
    }
  }

  const active = body.active
  if (active !== 'Y' && active !== 'N') return bad('สถานะไม่ถูกต้อง')

  try {
    const changed = await setRiderStaffActive({ id, active })
    if (!changed) {
      return Response.json(
        { success: false, message: 'ไม่พบเจ้าหน้าที่คนนี้ หรือสถานะเป็นค่านี้อยู่แล้ว' },
        { status: 404 },
      )
    }
    return Response.json({ success: true })
  } catch (error) {
    console.error('[his/health-rider/staff] แก้สถานะไม่สำเร็จ:', error)
    return Response.json(
      { success: false, message: 'แก้สถานะไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
