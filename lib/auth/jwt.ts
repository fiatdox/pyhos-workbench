import 'server-only'
import { SignJWT, jwtVerify, type JWTPayload } from 'jose'

/** อายุ token — ต้องตรงกับอายุ cookie ที่ฝั่งหน้าเว็บตั้งไว้ (8 ชม.) */
export const TOKEN_TTL = '8h'

function secret(): Uint8Array {
  const value = process.env.JWT_SECRET
  if (!value) throw new Error('ไม่พบค่า environment variable: JWT_SECRET (ตรวจสอบไฟล์ .env)')
  return new TextEncoder().encode(value)
}

export type AuthClaims = {
  /** users.id */
  sub: string
  username: string
  user_type_id: number | null
}

export async function signAuthToken(claims: AuthClaims): Promise<string> {
  return new SignJWT({ username: claims.username, user_type_id: claims.user_type_id })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(secret())
}

export async function verifyAuthToken(token: string): Promise<(JWTPayload & AuthClaims) | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] })
    return payload as JWTPayload & AuthClaims
  } catch {
    return null
  }
}
