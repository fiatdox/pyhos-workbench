import { COOKIE_PATH, withBase } from '@/lib/base-path'
import 'server-only'
import { after } from 'next/server'
import { cookies } from 'next/headers'
import { signAuthToken } from './jwt'
import { describeDevice, notifyLoginSuccess } from './notify'
import { clientIp } from '@/lib/rate-limit'
import { recordActivity } from '@/lib/audit/activity-log'

/** ชื่อ cookie ที่เก็บ JWT — ทุกฝั่งเซิร์ฟเวอร์อ่านจากตัวนี้ */
export const AUTH_COOKIE = 'auth_token'

/**
 * รหัสรอบยืนยัน OTP (challenge_token) — ใครถือค่านี้คู่กับรหัส 6 หลักก็ได้ session
 * จึงเก็บเป็นคุกกี้ httpOnly ให้สคริปต์ในหน้าอ่านไม่ได้ เดิมส่งใน JSON แล้วหน้าเว็บ
 * เก็บใน state ส่งกลับมาเอง ซึ่งสคริปต์ใดก็ตามที่รันในหน้า login อ่านได้
 *
 * path จำกัดแค่ /api/auth (ใต้ basePath) — ส่งไปเฉพาะ login/verify-otp/resend-otp/logout
 * ไม่ติดไปกับคำขออื่นของระบบ
 */
export const MFA_COOKIE = 'mfa_challenge'
const MFA_COOKIE_PATH = withBase('/api/auth')

/** อายุ cookie (วินาที) ต้องเท่ากับ TOKEN_TTL ใน jwt.ts */
const COOKIE_MAX_AGE = 8 * 60 * 60

/** ตั้งคุกกี้รอบ OTP — อายุเท่ากับอายุของรอบในฐานข้อมูล (challenge_expires_at) */
export async function setMfaChallengeCookie(
  request: Request,
  challengeToken: string,
  maxAgeSeconds: number,
): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(MFA_COOKIE, challengeToken, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isSecureRequest(request),
    path: MFA_COOKIE_PATH,
    maxAge: Math.max(1, Math.trunc(maxAgeSeconds)),
  })
}

/** รหัสรอบ OTP จากคุกกี้ — ว่าง = ไม่มีรอบค้างอยู่ */
export async function readMfaChallengeCookie(): Promise<string> {
  return (await cookies()).get(MFA_COOKIE)?.value ?? ''
}

/** ล้างคุกกี้รอบ OTP — เรียกเมื่อรอบจบ (สำเร็จ ถูกตัด หมดอายุ) หรือออกจากระบบ */
export async function clearMfaChallengeCookie(): Promise<void> {
  ;(await cookies()).delete({ name: MFA_COOKIE, path: MFA_COOKIE_PATH })
}

/**
 * ต่อ TLS อยู่หรือไม่ — ตั้ง flag Secure ตามจริงแทนการเดาจาก NODE_ENV
 *
 * ถ้าตั้ง Secure ทั้งที่ยังวิ่ง HTTP เบราว์เซอร์จะไม่ยอมเก็บ cookie เลย
 * แล้วจะล็อกอินไม่ได้ทั้งระบบ ตรวจจากคำขอจริงจึงเปิดใช้เองอัตโนมัติ
 * วันที่ WAF เริ่ม terminate TLS โดยไม่ต้องกลับมาแก้โค้ด
 *
 * x-forwarded-proto ปลอมได้ถ้าไม่มี proxy คั่น แต่การปลอมทำให้ cookie ของ
 * ผู้ปลอมเองเข้มขึ้น (หรือเก็บไม่ได้) ไม่กระทบผู้ใช้คนอื่น จึงไม่ใช่ช่องโจมตี
 */
function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-proto')
  if (forwarded) return forwarded.split(',')[0].trim() === 'https'
  try {
    return new URL(request.url).protocol === 'https:'
  } catch {
    return false
  }
}

/** ฟิลด์ผู้ใช้ที่จำเป็นต่อการออก session — ใช้ร่วมกันระหว่างเส้นทางปกติและเส้นทาง MFA */
export type SessionUser = {
  id: number
  username: string
  idCard: string | null
  pname: string | null
  fname: string
  lname: string
  userTypeId: number | null
  userPositionId: number | null
  userLevelId: number | null
  userStatusId: number | null
  missionId: number | null
  majorId: number | null
  submajorId: number | null
  hospitalLcPid: number | null
  passwordChangedAt: Date | null
}

/**
 * สร้าง response ตอบกลับตอนล็อกอินสำเร็จ (รูปทรงเดียวกับที่หน้า login ใช้)
 * และสั่งแจ้งเตือนเข้า Line หมอพร้อมหลังส่ง response ออกไปแล้ว
 */
export async function buildLoginSuccess(
  user: SessionUser,
  context: { request: Request; viaMfa: boolean },
): Promise<Response> {
  const token = await signAuthToken({
    sub: String(user.id),
    username: user.username,
    user_type_id: user.userTypeId,
  })

  // ตั้ง cookie ฝั่งเซิร์ฟเวอร์เป็น httpOnly — JS ในหน้าเว็บอ่านไม่ได้อีก
  // ทั้งระบบอ่าน token จาก cookie ทางเซิร์ฟเวอร์อยู่แล้ว (ทุก route ใน api/his
  // และ home/layout.tsx) จึงไม่ต้องส่ง token กลับไปให้หน้าเว็บเก็บเองอีกต่อไป
  const cookieStore = await cookies()
  cookieStore.set(AUTH_COOKIE, token, {
    httpOnly: true,
    // ระบบใช้ภายในล้วน ไม่มีลิงก์เข้าจากเว็บอื่น จึงตัด cross-site ทิ้งได้หมด
    sameSite: 'strict',
    secure: isSecureRequest(context.request),
    path: COOKIE_PATH,
    maxAge: COOKIE_MAX_AGE,
  })

  // ล้าง cookie ชุดเดิมที่เคยเก็บข้อมูลผู้ใช้ไว้ให้ JS อ่าน — ตอนนี้ส่งผ่าน
  // prop จาก home/layout แทนแล้ว เครื่องที่เคยล็อกอินไว้จะได้ไม่มีค้าง
  cookieStore.delete('user_data')
  cookieStore.delete('user_type_id')
  // รอบ OTP จบแล้ว (หรือไม่ได้ใช้) — ไม่ปล่อยรหัสรอบค้างในเบราว์เซอร์
  await clearMfaChallengeCookie()

  // after() ให้การยิง API หมอพร้อม (~1 วินาที) ไม่ไปหน่วงหน้าล็อกอิน
  const ip = clientIp(context.request)
  const device = describeDevice(context.request.headers.get('user-agent'))
  after(() =>
    notifyLoginSuccess({
      userId: user.id,
      idCard: user.idCard,
      info: { username: user.username, clientIp: ip, device, viaMfa: context.viaMfa },
    }),
  )

  // บันทึกการเข้าระบบจากตรงนี้ ไม่ใช่จาก proxy — ตอนคำขอล็อกอินวิ่งผ่าน proxy
  // ยังไม่มี cookie จึงไม่รู้ว่าเป็นใคร ที่นี่รู้แล้วทั้งรหัสและชื่อผู้ใช้
  after(() =>
    recordActivity({
      userId: user.id,
      username: user.username,
      action: 'login',
      method: 'POST',
      path: '/api/auth/login',
      feature: 'auth',
      detail: context.viaMfa ? 'รหัสผ่าน + OTP' : 'รหัสผ่าน',
      clientIp: ip,
      device,
    }),
  )

  // ไม่มีฟิลด์ token ใน body อีกแล้ว — ถ้าส่งกลับไป JS ก็อ่านได้ ผิดวัตถุประสงค์
  return Response.json({
    success: true,
    data: {
      id: user.id,
      username: user.username,
      pname: user.pname,
      fname: user.fname,
      lname: user.lname,
      full_name: [user.pname, user.fname, user.lname].filter(Boolean).join(' '),
      user_type_id: user.userTypeId,
      user_position_id: user.userPositionId,
      user_level_id: user.userLevelId,
      user_status_id: user.userStatusId,
      mission_id: user.missionId,
      major_id: user.majorId,
      submajor_id: user.submajorId,
      hospital_lc_pid: user.hospitalLcPid,
      password_changed_at: user.passwordChangedAt,
    },
  })
}
