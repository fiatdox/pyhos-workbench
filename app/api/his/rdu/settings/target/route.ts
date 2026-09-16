import { denyRduUser, requireRduUser } from '@/lib/auth/rdu-user'
import { isTargetSetting, listTargets, saveTarget } from '@/lib/his/rdu-settings'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * เกณฑ์เป้าหมายเป็นร้อยละของตัวชี้วัด RDU
 *
 * แยกเส้นทางจาก /settings/age เพราะเป็นค่าคนละชนิด — เกณฑ์อายุเปลี่ยนว่า
 * "นับใคร" ส่วนเกณฑ์เป้าหมายไม่เปลี่ยนตัวเลขของตัวชี้วัดเลย แค่เปลี่ยนเส้น
 * ที่ลากในกราฟกับคำว่าผ่าน/ไม่ผ่าน การแยกกันทำให้ผู้ใช้เห็นความต่างนี้ชัด
 *
 * value เป็น null ได้ = ล้างเกณฑ์กลับไปเป็น "ยังไม่ได้ตั้ง" ซึ่งกราฟจะไม่ลากเส้น
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
  const limited = rateLimit(`rdu-target:${user.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'เรียกบ่อยเกินไป กรุณารอสักครู่')
  }

  try {
    return Response.json({ success: true, targets: await listTargets() })
  } catch (error) {
    console.error('[his/rdu/settings/target] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'ดึงเกณฑ์เป้าหมายไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}

export async function PUT(request: Request) {
  const user = await requireRduUser()
  if (!user.ok) return denyRduUser(user.error)

  const ip = clientIp(request)
  const limited = rateLimit(
    `rdu-target-save:${user.sub}:${ip}`,
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
  if (!isTargetSetting(name)) {
    return Response.json({ success: false, message: 'ไม่พบเกณฑ์ที่ระบุ' }, { status: 404 })
  }

  // null = ล้างเกณฑ์ ต่างจากไม่ส่งค่ามาเลยซึ่งถือว่าคำขอผิดรูป
  const raw = body.value
  const value = raw == null ? null : Number(raw)
  if (value != null && !Number.isFinite(value)) return bad('เกณฑ์ต้องเป็นตัวเลข')

  try {
    await saveTarget(name, value)
    return Response.json({ success: true, targets: await listTargets() })
  } catch (error) {
    if (error instanceof RangeError) return bad(error.message)

    console.error('[his/rdu/settings/target] บันทึกไม่สำเร็จ:', error)
    return Response.json(
      { success: false, message: 'บันทึกเกณฑ์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
