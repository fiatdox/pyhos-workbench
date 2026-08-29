import { cookies } from 'next/headers'
import { verifyAuthToken } from '@/lib/auth/jwt'
import { getPatientImage } from '@/lib/his/patient-image'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PER_IP = { limit: 120, windowSeconds: 300 }
const HN_RE = /^\d{9}$/

export async function GET(request: Request) {
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  if (!claims?.sub) return new Response('กรุณาเข้าสู่ระบบใหม่', { status: 401 })

  const ip = clientIp(request)
  const limited = rateLimit(`his-ptimg:${claims.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'เรียกดูบ่อยเกินไป กรุณารอสักครู่')
  }

  const raw = (new URL(request.url).searchParams.get('hn') ?? '').replace(/\D/g, '')
  const hn = raw.length > 0 && raw.length <= 9 ? raw.padStart(9, '0') : raw
  if (!HN_RE.test(hn)) return new Response('พารามิเตอร์ไม่ถูกต้อง', { status: 400 })

  try {
    const image = await getPatientImage(hn)
    if (!image) return new Response('ไม่พบรูปผู้ป่วยรายนี้', { status: 404 })

    return new Response(new Uint8Array(image), {
      headers: {
        // ทั้งตารางเป็น JPEG
        'Content-Type': 'image/jpeg',
        'Content-Length': String(image.length),
        // เป็นภาพใบหน้าผู้ป่วย ห้ามให้ proxy หรือ CDN เก็บไว้
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `inline; filename="patient-${hn}.jpg"`,
      },
    })
  } catch (error) {
    console.error('[his/patient-image] ล้มเหลว:', error)
    return new Response('ดึงรูปผู้ป่วยไม่สำเร็จ', { status: 500 })
  }
}
