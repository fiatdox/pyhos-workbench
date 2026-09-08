import { cookies } from 'next/headers'
import { verifyAuthToken } from '@/lib/auth/jwt'
import { assignDelivery, cancelDelivery } from '@/lib/his/drug-delivery'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// จ่ายงานทีละราย วันหนึ่งมีหลายสิบราย เพดานจึงต้องสูงกว่าการเขียนอย่างอื่น
const PER_IP_WRITE = { limit: 120, windowSeconds: 300 }

function bad(message: string) {
  return Response.json({ success: false, message }, { status: 400 })
}

/**
 * บันทึกว่าใครเป็นผู้ส่งยาและใครเป็นผู้จัดการของการมารับบริการหนึ่งครั้ง
 *
 * ส่ง vn เดิมซ้ำได้ ถือเป็นการเปลี่ยนตัวผู้ส่ง ไม่ใช่การเพิ่มรายการใหม่
 */
export async function POST(request: Request) {
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  if (!claims?.sub) {
    return Response.json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 })
  }

  const ip = clientIp(request)
  const limited = rateLimit(
    `rider-assign:${claims.sub}:${ip}`,
    PER_IP_WRITE.limit,
    PER_IP_WRITE.windowSeconds,
  )
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'จ่ายงานถี่เกินไป กรุณารอสักครู่')
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return bad('รูปแบบข้อมูลไม่ถูกต้อง')
  }

  const vn = typeof body.vn === 'string' ? body.vn.trim() : ''
  const rider = Number(body.rider)
  const manager = Number(body.manager)

  // vn ในฐานเป็นตัวเลขล้วน ยาวไม่เกิน 15 หลัก
  if (!/^\d{1,15}$/.test(vn)) return bad('รหัสการมารับบริการไม่ถูกต้อง')
  if (!Number.isInteger(rider) || rider <= 0) return bad('กรุณาเลือกผู้ส่งยา')
  if (!Number.isInteger(manager) || manager <= 0) return bad('กรุณาเลือกผู้จัดการ')

  try {
    const result = await assignDelivery({ vn, rider, manager })
    if (!result.ok) {
      return bad(
        result.reason === 'unknown_vn'
          ? 'ไม่พบรายการส่งยาของการมารับบริการนี้'
          : 'ไม่พบเจ้าหน้าที่ที่เลือก',
      )
    }
    return Response.json({ success: true })
  } catch (error) {
    console.error('[his/health-rider/deliveries/assign] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'บันทึกการจ่ายงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}

/** ยกเลิกการจ่ายงาน — เอาทั้งผู้ส่งยาและผู้จัดการออก กลับเป็นยังไม่ได้จ่าย */
export async function DELETE(request: Request) {
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  if (!claims?.sub) {
    return Response.json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 })
  }

  const ip = clientIp(request)
  const limited = rateLimit(
    `rider-assign-del:${claims.sub}:${ip}`,
    PER_IP_WRITE.limit,
    PER_IP_WRITE.windowSeconds,
  )
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'ยกเลิกถี่เกินไป กรุณารอสักครู่')
  }

  const vn = (new URL(request.url).searchParams.get('vn') ?? '').trim()
  if (!/^\d{1,15}$/.test(vn)) return bad('รหัสการมารับบริการไม่ถูกต้อง')

  try {
    const result = await cancelDelivery(vn)
    if (!result.ok) {
      return result.reason === 'not_found'
        ? Response.json(
            { success: false, message: 'รายการนี้ยังไม่ได้จ่ายงาน' },
            { status: 404 },
          )
        : bad('รายการนี้บันทึกการรับหรือส่งไปแล้ว ยกเลิกจากหน้านี้ไม่ได้')
    }
    return Response.json({ success: true })
  } catch (error) {
    console.error('[his/health-rider/deliveries/assign] ยกเลิกไม่สำเร็จ:', error)
    return Response.json(
      { success: false, message: 'ยกเลิกการจ่ายงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
