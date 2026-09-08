import { eq, sql } from 'drizzle-orm'
import { verify } from '@node-rs/argon2'
import { coreKonDb } from '@/lib/db/core-kon'
import { authOtpChallenges, users } from '@/lib/db/schema/core-kon'
import { isPositionAllowed, POSITION_DENIED_MESSAGE } from '@/lib/auth/access'
import { auditMfa } from '@/lib/auth/mfa'
import { buildLoginSuccess } from '@/lib/auth/session'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// เพดานการยิงตรวจ OTP ต่อ IP — จำนวนครั้งต่อ "รอบ" คุมด้วย attempts/max_attempts ในฐานข้อมูลอีกชั้น
const PER_IP = { limit: 30, windowSeconds: 300 }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type VerifyBody = { challenge_token?: unknown; otp?: unknown }

export async function POST(request: Request) {
  let body: VerifyBody
  try {
    body = await request.json()
  } catch {
    return Response.json({ success: false, message: 'รูปแบบคำขอไม่ถูกต้อง' }, { status: 400 })
  }

  const token = typeof body.challenge_token === 'string' ? body.challenge_token : ''
  const otp = typeof body.otp === 'string' ? body.otp.trim() : ''
  const ip = clientIp(request)

  const byIp = rateLimit(`verify-otp:ip:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!byIp.ok) {
    return tooManyRequests(byIp.retryAfterSeconds, 'ยืนยันรหัสบ่อยเกินไป กรุณารอสักครู่')
  }

  // token ผิดรูป uuid จะทำให้ postgres error — ตัดทิ้งตั้งแต่ต้นทาง
  if (!UUID_RE.test(token) || !/^\d{6}$/.test(otp)) {
    return Response.json(
      { success: false, message: 'รหัสยืนยันไม่ถูกต้อง', can_resend: true },
      { status: 400 },
    )
  }

  try {
    const [challenge] = await coreKonDb
      .select()
      .from(authOtpChallenges)
      .where(eq(authOtpChallenges.challengeToken, token))
      .limit(1)

    const now = new Date()
    // รอบใช้ไปแล้ว / ถูกตัด / หมดอายุ → ต้องเริ่มล็อกอินใหม่ (can_resend = false บอกหน้าเว็บให้ย้อนกลับ)
    if (
      !challenge ||
      challenge.consumedAt ||
      challenge.failedAt ||
      challenge.challengeExpiresAt <= now
    ) {
      return Response.json(
        { success: false, message: 'รอบยืนยันหมดอายุแล้ว กรุณาเข้าสู่ระบบใหม่', can_resend: false },
        { status: 400 },
      )
    }

    if (challenge.attempts >= challenge.maxAttempts) {
      await coreKonDb
        .update(authOtpChallenges)
        .set({ failedAt: now })
        .where(eq(authOtpChallenges.id, challenge.id))
      return Response.json(
        { success: false, message: 'กรอกรหัสผิดเกินจำนวนที่กำหนด กรุณาเข้าสู่ระบบใหม่', can_resend: false },
        { status: 400 },
      )
    }

    // รหัสชุดปัจจุบันหมดอายุ แต่รอบยังอยู่ → ให้ขอรหัสใหม่ได้
    if (challenge.expiresAt <= now) {
      return Response.json(
        { success: false, message: 'รหัสยืนยันหมดอายุแล้ว กรุณากดขอรหัสใหม่', can_resend: true },
        { status: 400 },
      )
    }

    const matched = await verify(challenge.otpHash, otp).catch(() => false)

    if (!matched) {
      const [updated] = await coreKonDb
        .update(authOtpChallenges)
        .set({ attempts: sql`${authOtpChallenges.attempts} + 1` })
        .where(eq(authOtpChallenges.id, challenge.id))
        .returning({ attempts: authOtpChallenges.attempts })

      const remaining = Math.max(0, challenge.maxAttempts - (updated?.attempts ?? challenge.attempts + 1))
      await auditMfa({
        userId: challenge.userId,
        event: 'otp_wrong',
        detail: `เหลือโอกาสอีก ${remaining} ครั้ง`,
        clientIp: ip,
      })

      if (remaining <= 0) {
        await coreKonDb
          .update(authOtpChallenges)
          .set({ failedAt: now })
          .where(eq(authOtpChallenges.id, challenge.id))
        return Response.json(
          { success: false, message: 'กรอกรหัสผิดเกินจำนวนที่กำหนด กรุณาเข้าสู่ระบบใหม่', can_resend: false },
          { status: 400 },
        )
      }

      return Response.json(
        { success: false, message: `รหัสยืนยันไม่ถูกต้อง (เหลืออีก ${remaining} ครั้ง)`, can_resend: true },
        { status: 400 },
      )
    }

    // ตัดรอบทิ้งทันทีแบบมีเงื่อนไข — กันการยิงซ้ำพร้อมกันแล้วได้ token สองใบ
    const consumed = await coreKonDb
      .update(authOtpChallenges)
      .set({ consumedAt: now })
      .where(sql`${authOtpChallenges.id} = ${challenge.id} and ${authOtpChallenges.consumedAt} is null`)
      .returning({ id: authOtpChallenges.id })

    if (consumed.length === 0) {
      return Response.json(
        { success: false, message: 'รอบยืนยันนี้ถูกใช้ไปแล้ว กรุณาเข้าสู่ระบบใหม่', can_resend: false },
        { status: 400 },
      )
    }

    // ดึงข้อมูลผู้ใช้ ณ ตอนยืนยัน — เผื่อถูกระงับระหว่างรอกรอก OTP
    const [user] = await coreKonDb
      .select({
        id: users.id,
        username: users.username,
        idCard: users.idCard,
        isActive: users.isActive,
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
      .where(eq(users.id, challenge.userId))
      .limit(1)

    if (!user || user.isActive !== 'Y') {
      return Response.json(
        { success: false, message: 'บัญชีนี้ถูกระงับการใช้งาน', can_resend: false },
        { status: 403 },
      )
    }

    // ตรวจซ้ำอีกครั้งตรงนี้ ไม่ได้เชื่อผลจากตอนกรอกรหัสผ่าน — ตำแหน่งอาจถูกแก้
    // ระหว่างรอกรอก OTP และขั้นนี้เป็นด่านสุดท้ายก่อนออก token
    if (!isPositionAllowed(user.userPositionId)) {
      return Response.json(
        { success: false, message: POSITION_DENIED_MESSAGE, can_resend: false },
        { status: 403 },
      )
    }

    await auditMfa({ userId: user.id, username: user.username, event: 'otp_verified', clientIp: ip })
    return await buildLoginSuccess(user, { request, viaMfa: true })
  } catch (error) {
    console.error('[auth/verify-otp] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง', can_resend: true },
      { status: 500 },
    )
  }
}
