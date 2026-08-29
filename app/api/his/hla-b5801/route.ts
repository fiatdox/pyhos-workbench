import { cookies } from 'next/headers'
import { verifyAuthToken } from '@/lib/auth/jwt'
import { listHlaResults, MAX_RESULTS } from '@/lib/his/hla-b5801'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PER_IP = { limit: 60, windowSeconds: 300 }
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
/** ช่วงค้นสูงสุด กันดึงทีเดียวทั้งฐาน */
const MAX_RANGE_DAYS = 366
const MIN_KEYWORD = 2
const MAX_KEYWORD = 50

export async function GET(request: Request) {
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  if (!claims?.sub) {
    return Response.json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 })
  }

  const ip = clientIp(request)
  const limited = rateLimit(`his-hla:${claims.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'เรียกดูบ่อยเกินไป กรุณารอสักครู่')
  }

  const params = new URL(request.url).searchParams

  // ค้นด้วย HN หรือชื่อ-สกุล — ข้ามช่วงวันที่ไปเลย เพราะไม่รู้ว่าผลออกวันไหน
  const keyword = (params.get('q') ?? '').trim().slice(0, MAX_KEYWORD)
  if (keyword) {
    if (keyword.length < MIN_KEYWORD) {
      return Response.json(
        { success: false, message: `พิมพ์อย่างน้อย ${MIN_KEYWORD} ตัวอักษร` },
        { status: 400 },
      )
    }
    try {
      const results = await listHlaResults({ keyword })
      return Response.json({ success: true, keyword, limit: MAX_RESULTS, results })
    } catch (error) {
      console.error('[his/hla-b5801] ค้นด้วยคำค้นล้มเหลว:', error)
      return Response.json(
        { success: false, message: 'ค้นหาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
        { status: 500 },
      )
    }
  }

  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
    return Response.json({ success: false, message: 'ช่วงวันที่ไม่ถูกต้อง' }, { status: 400 })
  }

  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
  if (days > MAX_RANGE_DAYS) {
    return Response.json(
      { success: false, message: `เลือกช่วงได้ไม่เกิน ${MAX_RANGE_DAYS} วัน` },
      { status: 400 },
    )
  }

  try {
    const results = await listHlaResults({ from, to })
    return Response.json({ success: true, from, to, limit: MAX_RESULTS, results })
  } catch (error) {
    console.error('[his/hla-b5801] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'ดึงผลตรวจไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
