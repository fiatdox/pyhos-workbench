import { cookies } from 'next/headers'
import { verifyAuthToken } from '@/lib/auth/jwt'
import { listAdmittedInWard } from '@/lib/his/drug-profile'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PER_IP = { limit: 120, windowSeconds: 300 }
// รหัสตึกใน HIS เป็น varchar(4) และเป็นตัวเลข/ตัวอักษรล้วน
const WARD_RE = /^[A-Za-z0-9]{1,4}$/

export async function GET(request: Request) {
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  if (!claims?.sub) {
    return Response.json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 })
  }

  const ip = clientIp(request)
  const limited = rateLimit(`his-dp-adm:${claims.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'เรียกดูบ่อยเกินไป กรุณารอสักครู่')
  }

  const ward = (new URL(request.url).searchParams.get('ward') ?? '').trim()
  if (!WARD_RE.test(ward)) {
    return Response.json({ success: false, message: 'ไม่พบรหัสตึกที่ระบุ' }, { status: 400 })
  }

  try {
    const patients = await listAdmittedInWard(ward)
    return Response.json({ success: true, ward, patients })
  } catch (error) {
    console.error('[his/drug-profile/admitted] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'ดึงรายชื่อผู้ป่วยในตึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
