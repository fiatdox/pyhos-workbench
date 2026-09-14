import { denyRduUser, requireRduUser } from '@/lib/auth/rdu-user'
import { loadRasDuplicateReport, RAS_MAX_RANGE_DAYS } from '@/lib/his/rdu-ras-duplicate'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * ตัวชี้วัดการได้รับยากลุ่ม RAS blockade ซ้ำซ้อน
 *
 * แยกเส้นทางออกจาก /api/his/rdu/visits/[kind] เพราะตัวหารไม่ได้มาจากรหัสวินิจฉัย
 * และรูปคำตอบต่างกัน (ดู lib/his/rdu-ras-duplicate.ts)
 */

const PER_IP = { limit: 30, windowSeconds: 300 }

/** 'YYYY-MM-DD' */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const MS_PER_DAY = 86_400_000

function bad(message: string) {
  return Response.json({ success: false, message }, { status: 400 })
}

export async function GET(request: Request) {
  const user = await requireRduUser()
  if (!user.ok) return denyRduUser(user.error)

  const ip = clientIp(request)
  const limited = rateLimit(`rdu-ras:${user.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'เรียกบ่อยเกินไป กรุณารอสักครู่')
  }

  const params = new URL(request.url).searchParams
  const from = (params.get('from') ?? '').trim()
  const to = (params.get('to') ?? '').trim()

  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) return bad('รูปแบบวันที่ไม่ถูกต้อง')

  // เทียบเป็นเวลา UTC ทั้งคู่ ทั้งสองฝั่งจึงไม่มีเรื่องเขตเวลามาเกี่ยว
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return bad('วันที่ไม่ถูกต้อง')
  if (end < start) return bad('วันที่เริ่มต้นต้องไม่หลังวันที่สิ้นสุด')
  if ((end - start) / MS_PER_DAY + 1 > RAS_MAX_RANGE_DAYS) {
    return bad(`เลือกช่วงวันที่ได้ครั้งละไม่เกิน ${RAS_MAX_RANGE_DAYS} วัน`)
  }

  try {
    const report = await loadRasDuplicateReport({ from, to })
    return Response.json({ success: true, ...report })
  } catch (error) {
    console.error('[his/rdu/ras-duplicate] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'ดึงรายงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
