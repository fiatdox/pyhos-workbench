import { cookies } from 'next/headers'
import { verifyAuthToken } from '@/lib/auth/jwt'
import { getOpdScanImage, scanMimeType } from '@/lib/his/opd-scan'
import { watermarkImage } from '@/lib/his/watermark'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// หน้าเดียวเปิดได้หลายสิบภาพ โควตาจึงสูงกว่ารายการอื่น
const PER_IP = { limit: 300, windowSeconds: 300 }
const HN_RE = /^\d{9}$/

export async function GET(request: Request) {
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  if (!claims?.sub) {
    return new Response('กรุณาเข้าสู่ระบบใหม่', { status: 401 })
  }

  const ip = clientIp(request)
  const limited = rateLimit(`his-scan-img:${claims.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'เรียกดูบ่อยเกินไป กรุณารอสักครู่')
  }

  const params = new URL(request.url).searchParams
  const raw = (params.get('hn') ?? '').replace(/\D/g, '')
  const hn = raw.length > 0 && raw.length <= 9 ? raw.padStart(9, '0') : raw
  const scanId = Number((params.get('scan_id') ?? '').replace(/\D/g, ''))
  if (!HN_RE.test(hn) || !Number.isSafeInteger(scanId) || scanId <= 0) {
    return new Response('พารามิเตอร์ไม่ถูกต้อง', { status: 400 })
  }

  try {
    // คิวรีผูก scan_id คู่กับ hn — เดาเลข scan_id ของผู้ป่วยคนอื่นแล้วเปิดดูไม่ได้
    const found = await getOpdScanImage(scanId, hn)
    if (!found) return new Response('ไม่พบภาพสแกนนี้', { status: 404 })

    // ใส่ลายน้ำชื่อโรงพยาบาลลงในไฟล์ก่อนส่งออก
    const image = await watermarkImage(found.data, scanMimeType(found.imageType))

    return new Response(new Uint8Array(image.data), {
      headers: {
        'Content-Type': image.mime,
        'Content-Length': String(image.data.length),
        // เป็นเวชระเบียนของผู้ป่วย ห้ามให้ proxy หรือ CDN เก็บไว้
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `inline; filename="scan-${scanId}.jpg"`,
      },
    })
  } catch (error) {
    console.error('[his/opd-scan/image] ล้มเหลว:', error)
    return new Response('ดึงภาพสแกนไม่สำเร็จ', { status: 500 })
  }
}
