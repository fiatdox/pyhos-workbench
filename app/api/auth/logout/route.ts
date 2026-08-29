import { after } from 'next/server'
import { cookies } from 'next/headers'
import { eq } from 'drizzle-orm'
import { coreKonDb } from '@/lib/db/core-kon'
import { users } from '@/lib/db/schema/core-kon'
import { verifyAuthToken } from '@/lib/auth/jwt'
import { describeDevice, notifyLogout } from '@/lib/auth/notify'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ทุกครั้งที่ออกจากระบบจะยิงหมอพร้อมหนึ่งครั้ง — คุมไม่ให้ถูกกดรัวจนกลายเป็นช่องทางสแปม
const PER_IP = { limit: 15, windowSeconds: 300 }

export async function POST(request: Request) {
  const ip = clientIp(request)
  const byIp = rateLimit(`logout:ip:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!byIp.ok) {
    return tooManyRequests(byIp.retryAfterSeconds, 'ทำรายการบ่อยเกินไป กรุณารอสักครู่')
  }

  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null

  // ไม่มี token หรือ token หมดอายุ ก็ถือว่าออกจากระบบสำเร็จ — ฝั่งหน้าเว็บล้าง cookie อยู่แล้ว
  if (!claims?.sub) return Response.json({ success: true, notified: false })

  try {
    const [user] = await coreKonDb
      .select({ id: users.id, username: users.username, idCard: users.idCard })
      .from(users)
      .where(eq(users.id, Number(claims.sub)))
      .limit(1)

    if (!user) return Response.json({ success: true, notified: false })

    const device = describeDevice(request.headers.get('user-agent'))
    after(() =>
      notifyLogout({
        userId: user.id,
        idCard: user.idCard,
        info: { username: user.username, clientIp: ip, device },
      }),
    )

    return Response.json({ success: true, notified: Boolean(user.idCard) })
  } catch (error) {
    console.error('[auth/logout] ล้มเหลว:', error)
    // ออกจากระบบต้องสำเร็จเสมอในสายตาผู้ใช้ แม้แจ้งเตือนหรือฐานข้อมูลจะมีปัญหา
    return Response.json({ success: true, notified: false })
  }
}
