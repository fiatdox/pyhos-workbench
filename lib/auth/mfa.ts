import 'server-only'
import { randomInt, randomUUID } from 'node:crypto'
import { hash } from '@node-rs/argon2'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { coreKonDb } from '@/lib/db/core-kon'
import {
  authMfaAudit,
  authMfaUsers,
  authOtpChallenges,
  userMUsersRoles,
  userRoles,
} from '@/lib/db/schema/core-kon'
import { sendOtpAlert } from './moph'
import { getAuthSettings, type AuthSettings } from './settings'

// พารามิเตอร์แฮช OTP — เบากว่ารหัสผ่านเพราะเป็นเลข 6 หลักอายุสั้นและต้องตรวจบ่อย
// ไม่ระบุ algorithm เพราะค่าเริ่มต้นของ @node-rs/argon2 คือ argon2id อยู่แล้ว
// (enum Algorithm เป็น const enum ใช้ไม่ได้ภายใต้ isolatedModules ของโปรเจกต์นี้)
const OTP_HASH_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 }

export type MfaEvent =
  | 'otp_sent'
  | 'otp_verified'
  | 'otp_wrong'
  | 'otp_resent'
  | 'otp_failed'
  // เหตุการณ์แจ้งเตือนเข้า/ออกระบบ — ตารางนี้ไม่มี CHECK บน event จึงเพิ่มชนิดใหม่ได้
  | 'login_notified'
  | 'logout_notified'

/** บันทึกร่องรอยลง auth_mfa_audit — ห้ามทำให้ flow ล้มถ้าเขียน log ไม่ได้ */
export async function auditMfa(entry: {
  userId?: number | null
  username?: string | null
  event: MfaEvent
  detail?: string | null
  sendMs?: number | null
  clientIp?: string | null
}): Promise<void> {
  try {
    await coreKonDb.insert(authMfaAudit).values({
      userId: entry.userId ?? null,
      username: entry.username?.slice(0, 100) ?? null,
      event: entry.event,
      detail: entry.detail?.slice(0, 400) ?? null,
      sendMs: entry.sendMs ?? null,
      clientIp: entry.clientIp?.slice(0, 64) ?? null,
    })
  } catch (error) {
    console.error('[mfa] เขียน audit ไม่สำเร็จ:', error)
  }
}

/** ผู้ใช้รายนี้ต้องยืนยัน MFA หรือไม่ ตามค่าใน auth_settings */
export async function isMfaRequired(userId: number, settings: AuthSettings): Promise<boolean> {
  if (!settings.mfaEnabled) return false

  switch (settings.mfaScope) {
    case 'all':
      return true

    case 'users': {
      const [row] = await coreKonDb
        .select({ userId: authMfaUsers.userId })
        .from(authMfaUsers)
        .where(eq(authMfaUsers.userId, userId))
        .limit(1)
      return Boolean(row)
    }

    case 'roles': {
      if (settings.mfaRoles.length === 0) return false
      const [row] = await coreKonDb
        .select({ roleId: userMUsersRoles.roleId })
        .from(userMUsersRoles)
        .innerJoin(userRoles, eq(userRoles.id, userMUsersRoles.roleId))
        .where(and(eq(userMUsersRoles.userId, userId), inArray(userRoles.roleName, settings.mfaRoles)))
        .limit(1)
      return Boolean(row)
    }
  }
}

/** สุ่มรหัส 6 หลักด้วย CSPRNG (randomInt ไม่มี modulo bias) */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export type StartChallengeResult =
  | { ok: true; challengeToken: string; resendAfterSeconds: number }
  | { ok: false; reason: 'no_id_card' | 'send_failed' }

/**
 * เปิดรอบยืนยันตัวตนใหม่: สุ่ม OTP → ส่งเข้าหมอพร้อม → บันทึกแฮชลง auth_otp_challenges
 * ส่งไม่สำเร็จจะไม่สร้างรอบค้างไว้
 */
export async function startOtpChallenge(params: {
  userId: number
  username: string
  idCard: string | null
  clientIp: string
}): Promise<StartChallengeResult> {
  const { userId, username, idCard, clientIp } = params
  if (!idCard) {
    await auditMfa({ userId, username, event: 'otp_sent', detail: 'ไม่มีเลขบัตรประชาชนในระบบ', clientIp })
    return { ok: false, reason: 'no_id_card' }
  }

  const settings = await getAuthSettings()
  const otp = generateOtp()

  const sent = await sendOtpAlert(idCard, otp, settings.mfaOtpTtlSeconds)
  await auditMfa({
    userId,
    username,
    event: 'otp_sent',
    detail: sent.detail,
    sendMs: sent.ms,
    clientIp,
  })
  if (!sent.ok) return { ok: false, reason: 'send_failed' }

  const now = Date.now()
  const challengeToken = randomUUID()
  await coreKonDb.insert(authOtpChallenges).values({
    challengeToken,
    userId,
    otpHash: await hash(otp, OTP_HASH_OPTS),
    maxAttempts: settings.mfaMaxAttempts,
    expiresAt: new Date(now + settings.mfaOtpTtlSeconds * 1000),
    challengeExpiresAt: new Date(now + settings.mfaChallengeTtlSeconds * 1000),
    lastSentAt: new Date(now),
    clientIp,
  })

  return { ok: true, challengeToken, resendAfterSeconds: settings.mfaResendCooldownSeconds }
}

/** ออกรหัสใหม่ให้รอบเดิม (ไม่ต่ออายุรอบ — challenge_expires_at คงเดิม) */
export async function issueNewOtp(params: {
  challengeId: number
  userId: number
  username: string
  idCard: string | null
  clientIp: string
}): Promise<{ ok: boolean; resendAfterSeconds: number }> {
  const settings = await getAuthSettings()
  if (!params.idCard) return { ok: false, resendAfterSeconds: settings.mfaResendCooldownSeconds }

  const otp = generateOtp()
  const sent = await sendOtpAlert(params.idCard, otp, settings.mfaOtpTtlSeconds)
  await auditMfa({
    userId: params.userId,
    username: params.username,
    event: 'otp_resent',
    detail: sent.detail,
    sendMs: sent.ms,
    clientIp: params.clientIp,
  })
  if (!sent.ok) return { ok: false, resendAfterSeconds: settings.mfaResendCooldownSeconds }

  const now = Date.now()
  await coreKonDb
    .update(authOtpChallenges)
    .set({
      otpHash: await hash(otp, OTP_HASH_OPTS),
      expiresAt: new Date(now + settings.mfaOtpTtlSeconds * 1000),
      lastSentAt: new Date(now),
      // นับครั้งที่ขอใหม่ และล้างจำนวนครั้งที่กรอกผิดของรหัสชุดเดิม
      resendCount: sql`${authOtpChallenges.resendCount} + 1`,
      attempts: 0,
    })
    .where(eq(authOtpChallenges.id, params.challengeId))

  return { ok: true, resendAfterSeconds: settings.mfaResendCooldownSeconds }
}
