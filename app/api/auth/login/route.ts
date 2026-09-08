import { and, eq, sql } from 'drizzle-orm'
import { coreKonDb } from '@/lib/db/core-kon'
import { users } from '@/lib/db/schema/core-kon'
import { isPositionAllowed, POSITION_DENIED_MESSAGE } from '@/lib/auth/access'
import { fakeVerify, verifyPassword } from '@/lib/auth/password'
import { getAuthSettings } from '@/lib/auth/settings'
import { isMfaRequired, startOtpChallenge } from '@/lib/auth/mfa'
import { buildLoginSuccess } from '@/lib/auth/session'
import { clientIp, rateLimit, resetRateLimit, tooManyRequests } from '@/lib/rate-limit'

// ต้องรันบน Node.js runtime — ใช้ไดรเวอร์ postgres และ argon2 (native)
export const runtime = 'nodejs'
// เป็น POST อยู่แล้วจึงไม่ถูกแคช แต่ประกาศไว้ให้ชัด
export const dynamic = 'force-dynamic'

// ข้อความเดียวสำหรับทุกกรณีที่เข้าไม่ได้ — ไม่บอกว่าผิดที่ชื่อผู้ใช้ รหัสผ่าน หรือถูกระงับ
const INVALID_CREDENTIALS = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'

// เพดานการลองล็อกอิน: ต่อ (IP + ชื่อผู้ใช้) เข้มกว่า เพื่อกันเดารหัสรายบัญชี
// ส่วนต่อ IP ล้วนไว้กันกวาดหลายบัญชีจากเครื่องเดียว
const PER_ACCOUNT = { limit: 5, windowSeconds: 300 }
const PER_IP = { limit: 30, windowSeconds: 300 }

type LoginBody = { username?: unknown; password?: unknown }

export async function POST(request: Request) {
  let body: LoginBody
  try {
    body = await request.json()
  } catch {
    return Response.json({ success: false, message: 'รูปแบบคำขอไม่ถูกต้อง' }, { status: 400 })
  }

  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!username || !password) {
    return Response.json(
      { success: false, message: 'กรุณากรอกชื่อผู้ใช้งานและรหัสผ่าน' },
      { status: 400 },
    )
  }

  const ip = clientIp(request)
  const accountKey = `login:${ip}:${username.toLowerCase()}`

  const byIp = rateLimit(`login:ip:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!byIp.ok) {
    return tooManyRequests(byIp.retryAfterSeconds, 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่')
  }
  const byAccount = rateLimit(accountKey, PER_ACCOUNT.limit, PER_ACCOUNT.windowSeconds)
  if (!byAccount.ok) {
    return tooManyRequests(
      byAccount.retryAfterSeconds,
      `กรอกรหัสผ่านผิดหลายครั้งเกินไป กรุณาลองใหม่ใน ${Math.ceil(byAccount.retryAfterSeconds / 60)} นาที`,
    )
  }

  try {
    // ค้นแบบไม่สนตัวพิมพ์ใหญ่-เล็ก แต่ยังเทียบ is_active ในคิวรีเดียว
    const [user] = await coreKonDb
      .select({
        id: users.id,
        username: users.username,
        password: users.password,
        idCard: users.idCard,
        pname: users.pname,
        fname: users.fname,
        lname: users.lname,
        userTypeId: users.userTypeId,
        userPositionId: users.userPositionId,
        userLevelId: users.userLevelId,
        userStatusId: users.userStatusId,
        missionId: users.missionId,
        majorId: users.majorId,
        submajorId: users.submajorId,
        hospitalLcPid: users.hospitalLcPid,
        passwordChangedAt: users.passwordChangedAt,
      })
      .from(users)
      .where(and(eq(sql`lower(${users.username})`, username.toLowerCase()), eq(users.isActive, 'Y')))
      .limit(1)

    if (!user) {
      // ไม่พบผู้ใช้ (หรือถูกระงับ) — ยังคงเผาเวลาให้ใกล้เคียงเส้นทางปกติ
      await fakeVerify(password)
      return Response.json({ success: false, message: INVALID_CREDENTIALS }, { status: 401 })
    }

    const ok = await verifyPassword(user.password, password)
    if (!ok) {
      return Response.json({ success: false, message: INVALID_CREDENTIALS }, { status: 401 })
    }

    // รหัสผ่านถูกต้องแล้ว — ปลดตัวนับรายบัญชี ไม่ให้การล็อกอินสำเร็จไปกินโควตา
    resetRateLimit(accountKey)

    // ตรวจสิทธิ์ตามตำแหน่งก่อนเริ่มขั้น OTP — ไม่งั้นจะส่งรหัสไปหาคนที่ยังไง
    // ก็เข้าไม่ได้ เปลืองโควตาหมอพร้อมและทำให้ผู้ใช้เข้าใจผิดว่ากำลังจะเข้าได้
    if (!isPositionAllowed(user.userPositionId)) {
      return Response.json({ success: false, message: POSITION_DENIED_MESSAGE }, { status: 403 })
    }

    const settings = await getAuthSettings()
    if (await isMfaRequired(user.id, settings)) {
      const challenge = await startOtpChallenge({
        userId: user.id,
        username: user.username,
        idCard: user.idCard,
        clientIp: ip,
      })

      if (!challenge.ok) {
        const message =
          challenge.reason === 'no_id_card'
            ? 'บัญชีนี้ต้องยืนยันตัวตน แต่ไม่พบเลขบัตรประชาชนในระบบ กรุณาติดต่อผู้ดูแลระบบ'
            : 'ส่งรหัสยืนยันไปยัง Line หมอพร้อมไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
        return Response.json({ success: false, message }, { status: 502 })
      }

      // ยังไม่ออก token — ต้องผ่าน /api/auth/verify-otp ก่อน
      return Response.json({
        success: true,
        mfa_required: true,
        challenge_token: challenge.challengeToken,
        resend_after_seconds: challenge.resendAfterSeconds,
      })
    }

    return await buildLoginSuccess(user, { request, viaMfa: false })
  } catch (error) {
    console.error('[auth/login] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
