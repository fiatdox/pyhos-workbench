import { cookies } from 'next/headers'
import { verifyAuthToken } from '@/lib/auth/jwt'
import { MIN_NAME_SEARCH, searchAdmissions } from '@/lib/his/drug-profile'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PER_IP = { limit: 120, windowSeconds: 300 }
const MAX_TERM = 60

export async function GET(request: Request) {
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  if (!claims?.sub) {
    return Response.json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 })
  }

  const ip = clientIp(request)
  const limited = rateLimit(`his-dp-search:${claims.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'ค้นบ่อยเกินไป กรุณารอสักครู่')
  }

  const term = (new URL(request.url).searchParams.get('q') ?? '').slice(0, MAX_TERM).trim()
  if (term.length < MIN_NAME_SEARCH) {
    return Response.json(
      { success: false, message: `พิมพ์อย่างน้อย ${MIN_NAME_SEARCH} ตัวอักษร` },
      { status: 400 },
    )
  }

  try {
    const matches = await searchAdmissions(term)
    return Response.json({ success: true, matches })
  } catch (error) {
    console.error('[his/drug-profile/search] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'ค้นหาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
