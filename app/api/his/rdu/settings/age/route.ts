import { denyRduUser, requireRduUser } from '@/lib/auth/rdu-user'
import { isAgeSetting, listAgeSettings, saveAgeSetting } from '@/lib/his/rdu-settings'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * เกณฑ์อายุของตัวชี้วัด RDU — อ่านทั้งชุด เขียนทีละข้อ
 *
 * ค่าที่ตั้งตรงนี้เปลี่ยนตัวหารของตัวชี้วัดโดยตรง จึงใช้ด่านตรวจของงาน RDU
 * ชุดเดียวกับหน้าทะเบียน (RDU_USER_POSITION_IDS)
 *
 * PUT รับทีละหนึ่งชื่อ ไม่ได้รับทั้งชุด — หน้าจอแก้ทีละช่องอยู่แล้ว และการรับ
 * ทั้งชุดแปลว่าคนที่เปิดหน้าไว้นานแล้วกดบันทึกจะเขียนทับค่าที่คนอื่นเพิ่งแก้
 * ในช่องอื่นไปด้วยโดยไม่รู้ตัว
 */

const PER_IP = { limit: 60, windowSeconds: 300 }
const PER_IP_WRITE = { limit: 60, windowSeconds: 300 }

function bad(message: string) {
  return Response.json({ success: false, message }, { status: 400 })
}

export async function GET(request: Request) {
  const user = await requireRduUser()
  if (!user.ok) return denyRduUser(user.error)

  const ip = clientIp(request)
  const limited = rateLimit(`rdu-age:${user.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'เรียกบ่อยเกินไป กรุณารอสักครู่')
  }

  try {
    return Response.json({ success: true, settings: await listAgeSettings() })
  } catch (error) {
    console.error('[his/rdu/settings/age] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'ดึงค่าเกณฑ์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}

export async function PUT(request: Request) {
  const user = await requireRduUser()
  if (!user.ok) return denyRduUser(user.error)

  const ip = clientIp(request)
  const limited = rateLimit(
    `rdu-age-save:${user.sub}:${ip}`,
    PER_IP_WRITE.limit,
    PER_IP_WRITE.windowSeconds,
  )
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'บันทึกถี่เกินไป กรุณารอสักครู่')
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return bad('รูปแบบข้อมูลไม่ถูกต้อง')
  }

  const name = String(body.name ?? '').trim()
  if (!isAgeSetting(name)) {
    return Response.json({ success: false, message: 'ไม่พบเกณฑ์ที่ระบุ' }, { status: 404 })
  }

  const value = Number(body.value)
  if (!Number.isInteger(value)) return bad('อายุต้องเป็นจำนวนเต็ม')

  try {
    await saveAgeSetting(name, value)
    // คืนค่าทั้งชุดหลังบันทึก ให้หน้าจอยึดค่าจากฐานแทนที่จะเดาเอาจากที่กรอกไป
    return Response.json({ success: true, settings: await listAgeSettings() })
  } catch (error) {
    // ค่านอกขอบเขตเป็นความผิดของคำขอ ไม่ใช่ของเซิร์ฟเวอร์ — ตอบ 400 พร้อมเหตุผล
    if (error instanceof RangeError) return bad(error.message)

    console.error('[his/rdu/settings/age] บันทึกไม่สำเร็จ:', error)
    return Response.json(
      { success: false, message: 'บันทึกค่าเกณฑ์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
