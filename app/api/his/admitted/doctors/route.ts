import { cookies } from 'next/headers'
import { verifyAuthToken } from '@/lib/auth/jwt'
import { listAdmittingDoctors } from '@/lib/his/admitted'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PER_IP = { limit: 60, windowSeconds: 300 }

export async function GET(request: Request) {
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  if (!claims?.sub) {
    return Response.json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 })
  }

  const ip = clientIp(request)
  const limited = rateLimit(`his-adm-docs:${claims.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'เรียกดูบ่อยเกินไป กรุณารอสักครู่')
  }

  try {
    const doctors = await listAdmittingDoctors()
    return Response.json({ success: true, doctors })
  } catch (error) {
    console.error('[his/admitted/doctors] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'ดึงรายชื่อแพทย์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
