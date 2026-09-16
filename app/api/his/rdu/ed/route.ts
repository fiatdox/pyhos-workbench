import { denyRduUser, requireRduUser } from '@/lib/auth/rdu-user'
import { ED_MAX_RANGE_DAYS, loadEdReport, type EdScope } from '@/lib/his/rdu-ed'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * ตัวชี้วัดร้อยละการสั่งใช้ยาในบัญชียาหลักแห่งชาติ (ED)
 *
 * รับ scope มาเลือกฝั่งที่นับ เพราะผู้ป่วยนอกกับผู้ป่วยในเป็นคนละตัวชี้วัด
 * และใช้เกณฑ์คนละตัว (ดู lib/his/rdu-ed.ts)
 *
 * เป็นเส้นทางเดียวในกลุ่ม RDU ที่ไม่ส่งข้อมูลผู้ป่วยออกไปเลย — คำตอบเป็นรายการยา
 * กับตัวเลขนับ ไม่มีชื่อและไม่มี HN
 */

const PER_IP = { limit: 30, windowSeconds: 300 }

/** 'YYYY-MM-DD' */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const MS_PER_DAY = 86_400_000

const isScope = (value: string): value is EdScope => value === 'opd' || value === 'ipd'

function bad(message: string) {
  return Response.json({ success: false, message }, { status: 400 })
}

export async function GET(request: Request) {
  const user = await requireRduUser()
  if (!user.ok) return denyRduUser(user.error)

  const ip = clientIp(request)
  const limited = rateLimit(`rdu-ed:${user.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'เรียกบ่อยเกินไป กรุณารอสักครู่')
  }

  const params = new URL(request.url).searchParams
  const from = (params.get('from') ?? '').trim()
  const to = (params.get('to') ?? '').trim()
  const scope = (params.get('scope') ?? 'opd').trim()

  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) return bad('รูปแบบวันที่ไม่ถูกต้อง')
  if (!isScope(scope)) return bad('ฝั่งที่นับไม่ถูกต้อง')

  // เทียบเป็นเวลา UTC ทั้งคู่ ทั้งสองฝั่งจึงไม่มีเรื่องเขตเวลามาเกี่ยว
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return bad('วันที่ไม่ถูกต้อง')
  if (end < start) return bad('วันที่เริ่มต้นต้องไม่หลังวันที่สิ้นสุด')
  if ((end - start) / MS_PER_DAY + 1 > ED_MAX_RANGE_DAYS) {
    return bad(`เลือกช่วงวันที่ได้ครั้งละไม่เกิน ${ED_MAX_RANGE_DAYS} วัน`)
  }

  try {
    const report = await loadEdReport({ from, to, scope })
    return Response.json({ success: true, ...report })
  } catch (error) {
    console.error('[his/rdu/ed] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'ดึงรายงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
