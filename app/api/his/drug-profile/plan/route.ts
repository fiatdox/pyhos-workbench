import { cookies } from 'next/headers'
import { verifyAuthToken } from '@/lib/auth/jwt'
import { getDrugPlan } from '@/lib/his/drug-profile'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PER_IP = { limit: 120, windowSeconds: 300 }
const AN_RE = /^\d{9}$/

export async function GET(request: Request) {
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  if (!claims?.sub) {
    return Response.json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 })
  }

  const ip = clientIp(request)
  const limited = rateLimit(`his-dp-plan:${claims.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'เรียกดูบ่อยเกินไป กรุณารอสักครู่')
  }

  const raw = (new URL(request.url).searchParams.get('an') ?? '').replace(/\D/g, '')
  const an = raw.length > 0 && raw.length <= 9 ? raw.padStart(9, '0') : raw
  if (!AN_RE.test(an)) {
    return Response.json({ success: false, message: 'AN ต้องเป็นตัวเลขไม่เกิน 9 หลัก' }, { status: 400 })
  }

  try {
    const plan = await getDrugPlan(an)
    if (!plan.admission) {
      return Response.json({ success: false, message: 'ไม่พบ AN นี้ในระบบ' }, { status: 404 })
    }
    return Response.json({ success: true, plan })
  } catch (error) {
    console.error('[his/drug-profile/plan] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'ดึงแผนการใช้ยาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
