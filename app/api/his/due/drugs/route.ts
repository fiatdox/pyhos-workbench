import { cookies } from 'next/headers'
import { verifyAuthToken } from '@/lib/auth/jwt'
import { FEATURE_DENIED_MESSAGE, userCanUseDue } from '@/lib/auth/permissions'
import { listDueDrugs } from '@/lib/his/due'
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

  // งาน DUE จำกัดตามตำแหน่ง ซ่อนเมนูอย่างเดียวไม่พอ ต้องกันที่ API ด้วย
  if (!(await userCanUseDue(claims.sub))) {
    return Response.json({ success: false, message: FEATURE_DENIED_MESSAGE }, { status: 403 })
  }

  const ip = clientIp(request)
  const limited = rateLimit(`his-due-drug:${claims.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'เรียกบ่อยเกินไป กรุณารอสักครู่')
  }

  try {
    const drugs = await listDueDrugs()
    return Response.json({ success: true, drugs })
  } catch (error) {
    console.error('[his/due/drugs] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'ดึงรายการยาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
