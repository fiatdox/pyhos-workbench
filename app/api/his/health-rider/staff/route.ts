import { cookies } from 'next/headers'
import { verifyAuthToken } from '@/lib/auth/jwt'
import {
  createRiderStaff,
  isValidThaiCid,
  listRiderStaff,
  setRiderStaffActive,
} from '@/lib/his/health-rider'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

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
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  if (!claims?.sub) {
    return Response.json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 })
  }

  const ip = clientIp(request)
  const limited = rateLimit(
    `rider-staff-add:${claims.sub}:${ip}`,
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
 * ปิด/เปิดสถานะใช้งาน — รับได้เฉพาะคอลัมน์ active เท่านั้น
 *
 * ตั้งใจไม่ให้แก้ชื่อ เลขบัตร หรือประเภทผ่านช่องทางนี้ ถ้าวันหนึ่งต้องแก้ได้จริง
 * ค่อยเพิ่มทีละช่องพร้อมกติกาของมัน ไม่ใช่เปิดรับทั้งแถวไว้ก่อน
 */
export async function PATCH(request: Request) {
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  if (!claims?.sub) {
    return Response.json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 })
  }

  const ip = clientIp(request)
  const limited = rateLimit(
    `rider-staff-active:${claims.sub}:${ip}`,
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
  const active = body.active
  if (!Number.isInteger(id) || id <= 0) return bad('รหัสเจ้าหน้าที่ไม่ถูกต้อง')
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
