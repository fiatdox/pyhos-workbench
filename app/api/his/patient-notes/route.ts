import { cookies } from 'next/headers'
import { verifyAuthToken } from '@/lib/auth/jwt'
import { getPatientNotes } from '@/lib/his/patient-notes'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PER_IP = { limit: 60, windowSeconds: 300 }
const HN_RE = /^\d{9}$/

export async function GET(request: Request) {
  // ต้องล็อกอินก่อน — บันทึกผู้ป่วยไม่เปิดสาธารณะ
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  if (!claims?.sub) {
    return Response.json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 })
  }

  const ip = clientIp(request)
  const limited = rateLimit(`his-notes:${claims.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'เรียกดูบ่อยเกินไป กรุณารอสักครู่')
  }

  const raw = (new URL(request.url).searchParams.get('hn') ?? '').replace(/\D/g, '')
  const hn = raw.length > 0 && raw.length <= 9 ? raw.padStart(9, '0') : raw
  if (!HN_RE.test(hn)) {
    return Response.json({ success: false, message: 'HN ต้องเป็นตัวเลขไม่เกิน 9 หลัก' }, { status: 400 })
  }

  try {
    const notes = await getPatientNotes(hn)
    return Response.json({ success: true, hn, notes })
  } catch (error) {
    console.error('[his/patient-notes] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'ดึงข้อมูลจากฐาน HIS ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
