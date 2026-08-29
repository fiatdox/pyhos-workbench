import { cookies } from 'next/headers'
import { verifyAuthToken } from '@/lib/auth/jwt'
import { MIN_USAGE_SEARCH, searchDrugUsage } from '@/lib/his/drug-usage'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ค้นบ่อยกว่าหน้าอื่นเพราะพิมพ์ทีละคำ จึงให้โควตาสูงกว่า
const PER_IP = { limit: 240, windowSeconds: 300 }
const MAX_TERM = 60

export async function GET(request: Request) {
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  if (!claims?.sub) {
    return Response.json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 })
  }

  const ip = clientIp(request)
  const limited = rateLimit(`his-usage:${claims.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'ค้นบ่อยเกินไป กรุณารอสักครู่')
  }

  const term = (new URL(request.url).searchParams.get('q') ?? '').slice(0, MAX_TERM)
  if (term.trim().length < MIN_USAGE_SEARCH) {
    return Response.json(
      { success: false, message: `พิมพ์อย่างน้อย ${MIN_USAGE_SEARCH} ตัวอักษร` },
      { status: 400 },
    )
  }

  try {
    const options = await searchDrugUsage(term)
    return Response.json({ success: true, options })
  } catch (error) {
    console.error('[his/drug-usage] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'ค้นวิธีใช้ยาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
