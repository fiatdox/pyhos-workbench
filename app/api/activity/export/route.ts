import { cookies } from 'next/headers'
import { after } from 'next/server'
import { describeDevice } from '@/lib/auth/notify'
import { verifyAuthToken } from '@/lib/auth/jwt'
import { featureOf, recordActivity } from '@/lib/audit/activity-log'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * หน้าจอแจ้งว่าเพิ่งส่งออกไฟล์
 *
 * ต้องมีเส้นทางนี้เพราะไฟล์ CSV ทุกใบในโปรเจกต์ถูกประกอบในเบราว์เซอร์จากข้อมูล
 * ที่โหลดไปก่อนหน้าแล้ว ไม่มีคำขอวิ่งกลับมาที่เซิร์ฟเวอร์ตอนกดปุ่ม — ถ้าไม่แจ้ง
 * เข้ามา การนำข้อมูลผู้ป่วยออกจากระบบจะไม่ทิ้งร่องรอยไว้เลยสักบรรทัด ซึ่งเป็น
 * ช่องโหว่ที่ใหญ่ที่สุดของการเฝ้าดูทั้งหมด
 *
 * ข้อจำกัดที่ต้องรู้: ร่องรอยนี้มาจากฝั่งหน้าเว็บ คนที่ตั้งใจเลี่ยงและเปิด devtools
 * เป็นสามารถกดดาวน์โหลดโดยไม่ให้แจ้งได้ ของจริงที่กันไม่ให้ดึงข้อมูลออกคือด่าน
 * ตรวจสิทธิ์กับ rate limit ที่อยู่หน้าเส้นทางข้อมูล ไม่ใช่บรรทัดนี้ — อันนี้มีไว้
 * ตอบว่า "ตามปกติแล้วใครเอาอะไรออกไปบ้าง" ไม่ใช่เครื่องมือจับคนตั้งใจโกง
 */

const PER_IP = { limit: 60, windowSeconds: 300 }

const MAX_LABEL = 200

export async function POST(request: Request) {
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  if (!claims?.sub) {
    return Response.json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 })
  }

  const ip = clientIp(request)
  const limited = rateLimit(`activity-export:${claims.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) return tooManyRequests(limited.retryAfterSeconds, 'เรียกบ่อยเกินไป')

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ success: false, message: 'รูปแบบข้อมูลไม่ถูกต้อง' }, { status: 400 })
  }

  const input = (body ?? {}) as Record<string, unknown>
  const page = typeof input.page === 'string' ? input.page.trim() : ''
  if (!page.startsWith('/')) {
    return Response.json({ success: false, message: 'ไม่ทราบหน้าที่ส่งออก' }, { status: 400 })
  }

  const label = typeof input.label === 'string' ? input.label.trim().slice(0, MAX_LABEL) : ''
  const rows = Number(input.rows)
  const userId = Number(claims.sub)

  // ตอบกลับทันที ไม่ให้ผู้ใช้รอการเขียนล็อก — ปุ่มส่งออกต้องรู้สึกว่ากดแล้วได้ไฟล์เลย
  after(() =>
    recordActivity({
      userId: Number.isInteger(userId) ? userId : null,
      username: claims.username,
      action: 'export',
      method: 'POST',
      path: page,
      feature: featureOf(page),
      detail: [label, Number.isFinite(rows) ? `${Math.trunc(rows)} แถว` : null]
        .filter(Boolean)
        .join(' · '),
      clientIp: ip,
      device: describeDevice(request.headers.get('user-agent')),
    }),
  )

  return Response.json({ success: true })
}
