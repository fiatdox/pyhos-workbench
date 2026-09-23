import { denyAuditUser, requireAuditUser } from '@/lib/auth/audit-user'
import { ACTIONS, type ActivityAction } from '@/lib/audit/activity-log'
import {
  ACTIVITY_MAX_RANGE_DAYS,
  listActivityUsers,
  loadActivity,
  summariseActivity,
} from '@/lib/audit/activity-report'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * อ่านร่องรอยการใช้งาน — เฉพาะผู้ที่ถือ role ดูแลระบบ
 *
 * เส้นทางนี้อยู่ใต้ /api/activity ซึ่ง proxy.ts ไม่ดัก ตั้งใจให้เป็นแบบนั้น:
 * ถ้าดักด้วย การเปิดหน้าดูล็อกหนึ่งครั้งแล้วกดกรองสิบครั้งจะสร้างล็อกใหม่สิบแถว
 * ไล่ดูของเก่าไม่เจอ ส่วนการเปิดหน้า /home/admin/activity ยังถูกบันทึกตามปกติ
 * เพราะเป็นเส้นทางหน้าเว็บ — ตอบได้อยู่ว่าใครเข้ามาดูล็อกเมื่อไร
 */

const PER_IP = { limit: 120, windowSeconds: 300 }

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MS_PER_DAY = 86_400_000

const isAction = (value: string): value is ActivityAction =>
  (ACTIONS as readonly string[]).includes(value)

function bad(message: string) {
  return Response.json({ success: false, message }, { status: 400 })
}

export async function GET(request: Request) {
  const user = await requireAuditUser()
  if (!user.ok) return denyAuditUser(user.error)

  const ip = clientIp(request)
  const limited = rateLimit(`activity-list:${user.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) return tooManyRequests(limited.retryAfterSeconds, 'เรียกบ่อยเกินไป')

  const params = new URL(request.url).searchParams
  const from = (params.get('from') ?? '').trim()
  const to = (params.get('to') ?? '').trim()

  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) return bad('รูปแบบวันที่ไม่ถูกต้อง')

  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return bad('วันที่ไม่ถูกต้อง')
  if (end < start) return bad('วันที่เริ่มต้นต้องไม่หลังวันที่สิ้นสุด')
  if ((end - start) / MS_PER_DAY + 1 > ACTIVITY_MAX_RANGE_DAYS) {
    return bad(`เลือกช่วงวันที่ได้ครั้งละไม่เกิน ${ACTIVITY_MAX_RANGE_DAYS} วัน`)
  }

  const actionParam = (params.get('action') ?? '').trim()
  if (actionParam && !isAction(actionParam)) return bad('ประเภทเหตุการณ์ไม่ถูกต้อง')

  const userIdParam = Number(params.get('userId'))
  const beforeParam = Number(params.get('before'))

  try {
    const filter = {
      from,
      to,
      userId: Number.isInteger(userIdParam) && userIdParam > 0 ? userIdParam : null,
      action: actionParam ? (actionParam as ActivityAction) : null,
      feature: (params.get('feature') ?? '').trim() || null,
      targetHn: (params.get('hn') ?? '').trim() || null,
      before: Number.isInteger(beforeParam) && beforeParam > 0 ? beforeParam : null,
    }

    // หน้าถัดไปขอแค่ตาราง ไม่ต้องคิดสรุปกับรายชื่อผู้ใช้ใหม่ทั้งชุด
    const [page, summary, people] = await Promise.all([
      loadActivity(filter),
      filter.before ? null : summariseActivity({ from, to }),
      filter.before ? null : listActivityUsers({ from, to }),
    ])

    return Response.json({ success: true, ...page, summary, people })
  } catch (error) {
    console.error('[activity/list] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'ดึงร่องรอยการใช้งานไม่สำเร็จ' },
      { status: 500 },
    )
  }
}
