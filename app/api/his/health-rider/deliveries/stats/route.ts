import { cookies } from 'next/headers'
import { verifyAuthToken } from '@/lib/auth/jwt'
import { getDeliveryStats } from '@/lib/his/delivery-stats'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PER_IP = { limit: 60, windowSeconds: 300 }

/** ช่วงสูงสุดต่อการเรียกหนึ่งครั้ง — กว้างกว่าหนึ่งปีทำให้คิวรีหนักโดยไม่ได้ใช้จริง */
const MAX_RANGE_DAYS = 366

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** ตัวเลขสรุปงานส่งยาถึงบ้านตามช่วงวันที่ — ไม่มีข้อมูลรายบุคคลของผู้ป่วย */
export async function GET(request: Request) {
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  if (!claims?.sub) {
    return Response.json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 })
  }

  const ip = clientIp(request)
  const limited = rateLimit(`rider-stats:${claims.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'เรียกบ่อยเกินไป กรุณารอสักครู่')
  }

  const params = new URL(request.url).searchParams
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''

  if (!DATE.test(from) || !DATE.test(to)) {
    return Response.json({ success: false, message: 'รูปแบบวันที่ไม่ถูกต้อง' }, { status: 400 })
  }
  if (from > to) {
    return Response.json({ success: false, message: 'ช่วงวันที่ไม่ถูกต้อง' }, { status: 400 })
  }
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_RANGE_DAYS) {
    return Response.json(
      { success: false, message: `ดูสรุปได้ครั้งละไม่เกิน ${MAX_RANGE_DAYS} วัน` },
      { status: 400 },
    )
  }

  try {
    return Response.json({ success: true, stats: await getDeliveryStats(from, to) })
  } catch (error) {
    console.error('[his/health-rider/deliveries/stats] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'ดึงข้อมูลสรุปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
