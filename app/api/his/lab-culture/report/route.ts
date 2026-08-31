import { cookies } from 'next/headers'
import { verifyAuthToken } from '@/lib/auth/jwt'
import { getLabCultureReport } from '@/lib/his/lab-culture'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// เปิดอ่านทีละใบ คนหนึ่งอาจไล่เปิดหลายใบต่อกัน โควตาจึงสูงกว่ารายการ
const PER_IP = { limit: 200, windowSeconds: 300 }
const HN_RE = /^\d{9}$/

export async function GET(request: Request) {
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  if (!claims?.sub) {
    return Response.json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 })
  }

  const ip = clientIp(request)
  const limited = rateLimit(`his-lab-rpt:${claims.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'เรียกดูบ่อยเกินไป กรุณารอสักครู่')
  }

  const params = new URL(request.url).searchParams
  const raw = (params.get('hn') ?? '').replace(/\D/g, '')
  const hn = raw.length > 0 && raw.length <= 9 ? raw.padStart(9, '0') : raw
  if (!HN_RE.test(hn)) {
    return Response.json({ success: false, message: 'HN ต้องเป็นตัวเลขไม่เกิน 9 หลัก' }, { status: 400 })
  }

  const labNo = Number((params.get('lab_no') ?? '').replace(/\D/g, ''))
  if (!Number.isSafeInteger(labNo) || labNo <= 0) {
    return Response.json({ success: false, message: 'เลขใบรายงานไม่ถูกต้อง' }, { status: 400 })
  }

  try {
    const report = await getLabCultureReport(hn, labNo)
    if (report == null) {
      return Response.json({ success: false, message: 'ไม่พบใบรายงานนี้' }, { status: 404 })
    }
    return Response.json({ success: true, labNo, report })
  } catch (error) {
    console.error('[his/lab-culture/report] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'ดึงผลแล็บไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
