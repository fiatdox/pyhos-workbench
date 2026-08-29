import { cookies } from 'next/headers'
import { verifyAuthToken } from '@/lib/auth/jwt'
import { getMedicationHistory } from '@/lib/his/medication-history'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** ช่วงเวลาที่ค้นย้อนหลังได้ (เดือน) — จำกัดเป็นรายการปิด ไม่รับค่าอิสระจาก client
 *  เพราะค่านี้ถูกใส่ลง INTERVAL ของ SQL โดยตรง */
const ALLOWED_MONTHS = [6, 9, 12] as const
const DEFAULT_MONTHS = 6
// คิวรีชุดนี้กินแรงฐาน HIS พอสมควร — จำกัดการค้นต่อผู้ใช้หนึ่งคน
const PER_IP = { limit: 60, windowSeconds: 300 }

const HN_RE = /^\d{9}$/

export async function GET(request: Request) {
  // ต้องล็อกอินก่อน — ข้อมูลผู้ป่วยไม่เปิดสาธารณะ
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  if (!claims?.sub) {
    return Response.json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 })
  }

  const ip = clientIp(request)
  const limited = rateLimit(`his-med:${claims.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'ค้นหาบ่อยเกินไป กรุณารอสักครู่')
  }

  const params = new URL(request.url).searchParams

  // HIS เก็บ hn เป็นสตริง 9 หลักเติมศูนย์หน้า — เติมให้เองถ้าผู้ใช้พิมพ์มาสั้นกว่า
  const raw = (params.get('hn') ?? '').replace(/\D/g, '')
  const hn = raw.length > 0 && raw.length <= 9 ? raw.padStart(9, '0') : raw

  if (!HN_RE.test(hn)) {
    return Response.json({ success: false, message: 'HN ต้องเป็นตัวเลขไม่เกิน 9 หลัก' }, { status: 400 })
  }

  const requested = Number(params.get('months'))
  const months = ALLOWED_MONTHS.find(m => m === requested) ?? DEFAULT_MONTHS

  try {
    const data = await getMedicationHistory(hn, months)
    if (!data.patient) {
      return Response.json({ success: false, message: `ไม่พบผู้ป่วย HN ${hn}` }, { status: 404 })
    }
    return Response.json({ success: true, ...data })
  } catch (error) {
    console.error('[his/medication-history] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'ดึงข้อมูลจากฐาน HIS ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
