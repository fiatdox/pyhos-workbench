import { denyRduUser, requireRduUser } from '@/lib/auth/rdu-user'
import { loadDashboardFacts } from '@/lib/his/rdu-dashboard'
import { isVisitReportKind, MAX_RANGE_DAYS } from '@/lib/his/rdu-visit-report'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * ข้อมูลดิบของหน้าวิเคราะห์ตัวชี้วัด RDU
 *
 * คืนข้อมูลรายครั้งแบบย่อ (ไม่มีชื่อผู้ป่วย HN หรือ VN) ให้เบราว์เซอร์กรองและ
 * รวมยอดเอง — เหตุผลเขียนไว้ที่ lib/his/rdu-dashboard.ts
 *
 * จำกัดอัตราต่ำกว่าเส้นทางรายงาน เพราะหนึ่งครั้งที่เรียกดึงข้อมูลทั้งช่วงมาเลย
 * และหน้าจอเรียกแค่ตอนเปลี่ยนช่วงวันที่ ไม่ได้เรียกตอนเปลี่ยนตัวกรอง
 */

const PER_IP = { limit: 20, windowSeconds: 300 }

/** 'YYYY-MM-DD' */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const MS_PER_DAY = 86_400_000

function bad(message: string) {
  return Response.json({ success: false, message }, { status: 400 })
}

export async function GET(request: Request, ctx: RouteContext<'/api/his/rdu/dashboard/[kind]'>) {
  const user = await requireRduUser()
  if (!user.ok) return denyRduUser(user.error)

  const { kind } = await ctx.params
  if (!isVisitReportKind(kind)) {
    return Response.json({ success: false, message: 'ไม่พบตัวชี้วัดที่ระบุ' }, { status: 404 })
  }

  const ip = clientIp(request)
  const limited = rateLimit(`rdu-dash:${user.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
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
  if ((end - start) / MS_PER_DAY + 1 > MAX_RANGE_DAYS) {
    return bad(`เลือกช่วงวันที่ได้ครั้งละไม่เกิน ${MAX_RANGE_DAYS} วัน`)
  }

  try {
    const facts = await loadDashboardFacts({ kind, from, to })
    return Response.json({ success: true, ...facts })
  } catch (error) {
    console.error(`[his/rdu/dashboard/${kind}] ล้มเหลว:`, error)
    return Response.json(
      { success: false, message: 'ดึงข้อมูลวิเคราะห์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
