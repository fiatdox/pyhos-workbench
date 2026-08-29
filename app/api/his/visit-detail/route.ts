import { cookies } from 'next/headers'
import { verifyAuthToken } from '@/lib/auth/jwt'
import { getVisitDetail } from '@/lib/his/visit-detail'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PER_IP = { limit: 60, windowSeconds: 300 }
const HN_RE = /^\d{9}$/
/** vn ของ HIS เป็นเลข 12 หลัก (yymmdd + เวลา) */
const VN_RE = /^\d{12}$/

export async function GET(request: Request) {
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  if (!claims?.sub) {
    return Response.json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 })
  }

  const ip = clientIp(request)
  const limited = rateLimit(`his-visit:${claims.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'เรียกดูบ่อยเกินไป กรุณารอสักครู่')
  }

  const params = new URL(request.url).searchParams
  const rawHn = (params.get('hn') ?? '').replace(/\D/g, '')
  const hn = rawHn.length > 0 && rawHn.length <= 9 ? rawHn.padStart(9, '0') : rawHn
  const vn = (params.get('vn') ?? '').replace(/\D/g, '')
  if (!HN_RE.test(hn) || !VN_RE.test(vn)) {
    return Response.json({ success: false, message: 'HN หรือ VN ไม่ถูกต้อง' }, { status: 400 })
  }

  try {
    // getVisitDetail ผูก hn ไว้ในทุกคิวรี — เปิด visit ของผู้ป่วยคนอื่นด้วยการเดา vn ไม่ได้
    const visit = await getVisitDetail(vn, hn)
    if (!visit) {
      return Response.json({ success: false, message: 'ไม่พบข้อมูลการมารับบริการครั้งนี้' }, { status: 404 })
    }
    return Response.json({ success: true, hn, visit })
  } catch (error) {
    console.error('[his/visit-detail] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'ดึงข้อมูลจากฐาน HIS ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
