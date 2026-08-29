import 'server-only'
import { coreKonDb } from '@/lib/db/core-kon'
import { authSettings } from '@/lib/db/schema/core-kon'

export type AuthSettings = {
  mfaEnabled: boolean
  /** users = เฉพาะรายชื่อใน auth_mfa_users | roles = เฉพาะ role ที่ระบุ | all = ทุกคน */
  mfaScope: 'users' | 'roles' | 'all'
  mfaRoles: string[]
  mfaOtpTtlSeconds: number
  mfaChallengeTtlSeconds: number
  mfaMaxAttempts: number
  mfaResendCooldownSeconds: number
}

const DEFAULTS: AuthSettings = {
  mfaEnabled: false,
  mfaScope: 'users',
  mfaRoles: [],
  mfaOtpTtlSeconds: 300,
  mfaChallengeTtlSeconds: 600,
  mfaMaxAttempts: 5,
  mfaResendCooldownSeconds: 60,
}

// แคชสั้น ๆ กันคิวรีตารางตั้งค่าซ้ำทุก request — ผู้ดูแลแก้ค่าแล้วมีผลภายใน 30 วินาที
const CACHE_TTL_MS = 30_000
let cache: { at: number; value: AuthSettings } | null = null

function num(raw: string | undefined, fallback: number): number {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export async function getAuthSettings(): Promise<AuthSettings> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value

  const rows = await coreKonDb
    .select({ name: authSettings.name, value: authSettings.value })
    .from(authSettings)
  const map = new Map(rows.map(r => [r.name, r.value ?? '']))

  const scope = map.get('mfa_scope')
  const value: AuthSettings = {
    mfaEnabled: map.get('mfa_enabled') === 'true',
    mfaScope: scope === 'roles' || scope === 'all' ? scope : 'users',
    mfaRoles: (map.get('mfa_roles') ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    mfaOtpTtlSeconds: num(map.get('mfa_otp_ttl_seconds'), DEFAULTS.mfaOtpTtlSeconds),
    mfaChallengeTtlSeconds: num(map.get('mfa_challenge_ttl_seconds'), DEFAULTS.mfaChallengeTtlSeconds),
    mfaMaxAttempts: num(map.get('mfa_max_attempts'), DEFAULTS.mfaMaxAttempts),
    mfaResendCooldownSeconds: num(
      map.get('mfa_resend_cooldown_seconds'),
      DEFAULTS.mfaResendCooldownSeconds,
    ),
  }

  cache = { at: Date.now(), value }
  return value
}
