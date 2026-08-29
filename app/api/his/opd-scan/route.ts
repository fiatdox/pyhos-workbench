import { cookies } from 'next/headers'
import { verifyAuthToken } from '@/lib/auth/jwt'
import { listOpdScans, MAX_SCAN_ITEMS } from '@/lib/his/opd-scan'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PER_IP = { limit: 60, windowSeconds: 300 }
const HN_RE = /^\d{9}$/
const VN_RE = /^\d{12}$/

export async function GET(request: Request) {
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  if (!claims?.sub) {
    return Response.json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 })
  }

  const ip = clientIp(request)
  const limited = rateLimit(`his-scan:${claims.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'เรียกดูบ่อยเกินไป กรุณารอสักครู่')
  }

  const params = new URL(request.url).searchParams
  const raw = (params.get('hn') ?? '').replace(/\D/g, '')
  const hn = raw.length > 0 && raw.length <= 9 ? raw.padStart(9, '0') : raw
  if (!HN_RE.test(hn)) {
    return Response.json({ success: false, message: 'HN ต้องเป็นตัวเลขไม่เกิน 9 หลัก' }, { status: 400 })
  }

  const vnParam = (params.get('vn') ?? '').replace(/\D/g, '')
  if (vnParam && !VN_RE.test(vnParam)) {
    return Response.json({ success: false, message: 'VN ไม่ถูกต้อง' }, { status: 400 })
  }

  try {
    const items = await listOpdScans({ hn, vn: vnParam || null }, MAX_SCAN_ITEMS)
    return Response.json({ success: true, hn, limit: MAX_SCAN_ITEMS, items })
  } catch (error) {
    console.error('[his/opd-scan] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'ดึงรายการภาพสแกนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
