import { cookies } from 'next/headers'
import { verifyAuthToken } from '@/lib/auth/jwt'
import { getHlaImage } from '@/lib/his/hla-b5801'
import { watermarkImage } from '@/lib/his/watermark'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// หนึ่งหน้าจออาจเปิดรูปหลายใบต่อกัน โควตาจึงสูงกว่ารายการ
const PER_IP = { limit: 300, windowSeconds: 300 }

export async function GET(request: Request) {
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  if (!claims?.sub) return new Response('กรุณาเข้าสู่ระบบใหม่', { status: 401 })

  const ip = clientIp(request)
  const limited = rateLimit(`his-hla-img:${claims.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'เรียกดูบ่อยเกินไป กรุณารอสักครู่')
  }

  const params = new URL(request.url).searchParams
  const labOrderNumber = Number((params.get('lab_order_number') ?? '').replace(/\D/g, ''))
  const index = Number((params.get('index') ?? '').replace(/\D/g, ''))
  if (!Number.isSafeInteger(labOrderNumber) || labOrderNumber <= 0) {
    return new Response('พารามิเตอร์ไม่ถูกต้อง', { status: 400 })
  }

  try {
    const found = await getHlaImage(labOrderNumber, index)
    if (!found) return new Response('ไม่พบรูปผลตรวจนี้', { status: 404 })

    // ใส่ลายน้ำชื่อโรงพยาบาลลงในไฟล์ก่อนส่งออก
    const image = await watermarkImage(found.data, found.mime)

    return new Response(new Uint8Array(image.data), {
      headers: {
        'Content-Type': image.mime,
        'Content-Length': String(image.data.length),
        // เป็นผลตรวจของผู้ป่วย ห้ามให้ proxy หรือ CDN เก็บไว้
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `inline; filename="hla-${labOrderNumber}-${index}.jpg"`,
      },
    })
  } catch (error) {
    console.error('[his/hla-b5801/image] ล้มเหลว:', error)
    return new Response('ดึงรูปผลตรวจไม่สำเร็จ', { status: 500 })
  }
}
