import { denyRduUser, requireRduUser } from '@/lib/auth/rdu-user'
import { CKD_MAX_RANGE_DAYS, loadCkdNsaidReport } from '@/lib/his/rdu-ckd-nsaid'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * ตัวชี้วัดการใช้ยา NSAIDs ในผู้ป่วยโรคไตเรื้อรัง
 *
 * แยกเส้นทางออกจาก /api/his/rdu/visits/[kind] เพราะรูปคำตอบต่างกัน —
 * ข้อนี้ส่งตัวหารมาเป็นตัวเลข แล้วส่งรายละเอียดเฉพาะเคสที่ต้องทบทวน
 * (เหตุผลเต็มอยู่ที่ lib/his/rdu-ckd-nsaid.ts)
 *
 * จำกัดอัตราต่ำกว่าเส้นทางตัวชี้วัดข้ออื่น เพราะคิวรีตัวหารกวาด vn_stat ทั้งช่วง
 * แล้วยังต้องประกอบชุดผู้ป่วย CKD จาก ovstdiag และ lab_order อีกสองตาราง
 */

const PER_IP = { limit: 20, windowSeconds: 300 }

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
  const limited = rateLimit(`rdu-ckd:${user.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
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
  if ((end - start) / MS_PER_DAY + 1 > CKD_MAX_RANGE_DAYS) {
    return bad(`เลือกช่วงวันที่ได้ครั้งละไม่เกิน ${CKD_MAX_RANGE_DAYS} วัน`)
  }

  try {
    const report = await loadCkdNsaidReport({ from, to })
    return Response.json({ success: true, ...report })
  } catch (error) {
    console.error('[his/rdu/ckd-nsaid] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'ดึงรายงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
