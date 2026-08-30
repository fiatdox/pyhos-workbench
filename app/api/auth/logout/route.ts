import { after } from 'next/server'
import { cookies } from 'next/headers'
import { eq } from 'drizzle-orm'
import { coreKonDb } from '@/lib/db/core-kon'
import { users } from '@/lib/db/schema/core-kon'
import { verifyAuthToken } from '@/lib/auth/jwt'
import { describeDevice, notifyLogout } from '@/lib/auth/notify'
import { AUTH_COOKIE } from '@/lib/auth/session'
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

  const cookieStore = await cookies()
  const token = cookieStore.get(AUTH_COOKIE)?.value
  const claims = token ? await verifyAuthToken(token) : null

  // ล้างทันทีและล้างทุกเส้นทางออกจากฟังก์ชันนี้ — cookie เป็น httpOnly แล้ว
  // ฝั่งหน้าเว็บลบเองไม่ได้อีก ถ้าตรงนี้พลาดจะกลายเป็น "กดออกแล้วไม่ออกจริง"
  cookieStore.delete(AUTH_COOKIE)
  // cookie ชุดเดิมที่เคยเก็บข้อมูลผู้ใช้ไว้ให้ JS อ่าน — เก็บกวาดของเก่าให้ด้วย
  cookieStore.delete('user_data')
  cookieStore.delete('user_type_id')

  // ไม่มี token หรือ token หมดอายุ ก็ถือว่าออกจากระบบสำเร็จ (cookie ถูกล้างไปแล้ว)
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
