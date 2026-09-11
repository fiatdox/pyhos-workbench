import { denyRduUser, requireRduUser } from '@/lib/auth/rdu-user'
import { isVisitReportKind, listReportVisits, MAX_RANGE_DAYS } from '@/lib/his/rdu-visit-report'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * รายงานผู้ป่วยนอกตามตัวชี้วัด RDU ตามช่วงวันที่ — เส้นทางเดียวรับทุกตัวชี้วัด
 *
 * [kind] คือชื่อตัวชี้วัด (asthma, ri) ตรวจกับรายชื่อที่รู้จักใน rdu-visit-report.ts
 * ก่อนเสมอ — ชื่อนี้ถูกแปลงเป็นชื่อตารางทะเบียนในคิวรีโดยตรง
 *
 * คิวรีหลักกวาด vn_stat ตามช่วงวันที่ จึงจำกัดความยาวช่วงไว้ ไม่ใช่ปล่อยให้ขอ
 * ย้อนหลังสิบปีในคำขอเดียว — และจำกัดอัตราต่ำกว่าเส้นทางตั้งค่า เพราะหนึ่งครั้ง
 * ที่เรียกหนักกว่ากันมาก
 */

const PER_IP = { limit: 30, windowSeconds: 300 }

/** 'YYYY-MM-DD' */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const MS_PER_DAY = 86_400_000

function bad(message: string) {
  return Response.json({ success: false, message }, { status: 400 })
}

export async function GET(request: Request, ctx: RouteContext<'/api/his/rdu/visits/[kind]'>) {
  const user = await requireRduUser()
  if (!user.ok) return denyRduUser(user.error)

  const { kind } = await ctx.params
  if (!isVisitReportKind(kind)) {
    return Response.json({ success: false, message: 'ไม่พบรายงานที่ระบุ' }, { status: 404 })
  }

  const ip = clientIp(request)
  const limited = rateLimit(`rdu-visits:${user.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
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
    const report = await listReportVisits({ kind, from, to })
    return Response.json({ success: true, ...report })
  } catch (error) {
    console.error(`[his/rdu/visits/${kind}] ล้มเหลว:`, error)
    return Response.json(
      { success: false, message: 'ดึงรายงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
