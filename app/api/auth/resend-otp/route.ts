import { eq } from 'drizzle-orm'
import { coreKonDb } from '@/lib/db/core-kon'
import { authOtpChallenges, users } from '@/lib/db/schema/core-kon'
import { issueNewOtp } from '@/lib/auth/mfa'
import { getAuthSettings } from '@/lib/auth/settings'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ยิงหมอพร้อมทุกครั้งที่ขอรหัสใหม่ — คุมให้แน่นกว่า endpoint อื่น
const PER_IP = { limit: 10, windowSeconds: 600 }
/** จำนวนครั้งสูงสุดที่ขอรหัสใหม่ได้ในหนึ่งรอบ */
const MAX_RESEND_PER_CHALLENGE = 3

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type ResendBody = { challenge_token?: unknown }

export async function POST(request: Request) {
  let body: ResendBody
  try {
    body = await request.json()
  } catch {
    return Response.json({ success: false, message: 'รูปแบบคำขอไม่ถูกต้อง' }, { status: 400 })
  }

  const token = typeof body.challenge_token === 'string' ? body.challenge_token : ''
  const ip = clientIp(request)

  const byIp = rateLimit(`resend-otp:ip:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!byIp.ok) {
    return tooManyRequests(byIp.retryAfterSeconds, 'ขอรหัสใหม่บ่อยเกินไป กรุณารอสักครู่')
  }

  if (!UUID_RE.test(token)) {
    return Response.json({ success: false, message: 'รอบยืนยันไม่ถูกต้อง' }, { status: 400 })
  }

  try {
    const [challenge] = await coreKonDb
      .select()
      .from(authOtpChallenges)
      .where(eq(authOtpChallenges.challengeToken, token))
      .limit(1)

    const now = new Date()
    if (
      !challenge ||
      challenge.consumedAt ||
      challenge.failedAt ||
      challenge.challengeExpiresAt <= now
    ) {
      return Response.json(
        { success: false, message: 'รอบยืนยันหมดอายุแล้ว กรุณาเข้าสู่ระบบใหม่' },
        { status: 400 },
      )
    }

    const settings = await getAuthSettings()

    // คูลดาวน์ตาม auth_settings — นับจากเวลาที่ส่งครั้งล่าสุด
    const elapsedSeconds = (now.getTime() - challenge.lastSentAt.getTime()) / 1000
    const waitSeconds = Math.ceil(settings.mfaResendCooldownSeconds - elapsedSeconds)
    if (waitSeconds > 0) {
      return tooManyRequests(waitSeconds, `กรุณารออีก ${waitSeconds} วินาทีก่อนขอรหัสใหม่`)
    }

    if (challenge.resendCount >= MAX_RESEND_PER_CHALLENGE) {
      return Response.json(
        { success: false, message: 'ขอรหัสใหม่ครบจำนวนที่กำหนดแล้ว กรุณาเข้าสู่ระบบใหม่' },
        { status: 429 },
      )
    }

    const [user] = await coreKonDb
      .select({ id: users.id, username: users.username, idCard: users.idCard, isActive: users.isActive })
      .from(users)
      .where(eq(users.id, challenge.userId))
      .limit(1)

    if (!user || user.isActive !== 'Y') {
      return Response.json({ success: false, message: 'บัญชีนี้ถูกระงับการใช้งาน' }, { status: 403 })
    }

    const result = await issueNewOtp({
      challengeId: challenge.id,
      userId: user.id,
      username: user.username,
      idCard: user.idCard,
      clientIp: ip,
    })

    if (!result.ok) {
      return Response.json(
        { success: false, message: 'ส่งรหัสยืนยันไปยัง Line หมอพร้อมไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
        { status: 502 },
      )
    }

    return Response.json({ success: true, resend_after_seconds: result.resendAfterSeconds })
  } catch (error) {
    console.error('[auth/resend-otp] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
