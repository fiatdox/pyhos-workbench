import { cookies } from 'next/headers'
import { verifyAuthToken } from '@/lib/auth/jwt'
import { FEATURE_DENIED_MESSAGE, userCanUseDue } from '@/lib/auth/permissions'
import { getDuePatient } from '@/lib/his/due'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PER_IP = { limit: 120, windowSeconds: 300 }
const HN_RE = /^\d{9}$/

export async function GET(request: Request) {
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  if (!claims?.sub) {
    return Response.json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 })
  }

  // งาน DUE จำกัดตามตำแหน่ง ซ่อนเมนูอย่างเดียวไม่พอ ต้องกันที่ API ด้วย
  if (!(await userCanUseDue(claims.sub))) {
    return Response.json({ success: false, message: FEATURE_DENIED_MESSAGE }, { status: 403 })
  }

  const ip = clientIp(request)
  const limited = rateLimit(`his-due-pt:${claims.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'ค้นบ่อยเกินไป กรุณารอสักครู่')
  }

  // หน้าจอบังคับให้กรอก 9 หลักอยู่แล้ว แต่เติมศูนย์ให้ด้วยเผื่อพิมพ์มาสั้นกว่า
  const raw = (new URL(request.url).searchParams.get('hn') ?? '').replace(/\D/g, '')
  const hn = raw.length > 0 && raw.length <= 9 ? raw.padStart(9, '0') : raw
  if (!HN_RE.test(hn)) {
    return Response.json({ success: false, message: 'HN ต้องเป็นตัวเลขไม่เกิน 9 หลัก' }, { status: 400 })
  }

  try {
    const patient = await getDuePatient(hn)
    if (!patient) {
      return Response.json({ success: false, message: `ไม่พบผู้ป่วย HN ${hn}` }, { status: 404 })
    }
    return Response.json({ success: true, patient })
  } catch (error) {
    console.error('[his/due/patient] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'ดึงข้อมูลผู้ป่วยไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
