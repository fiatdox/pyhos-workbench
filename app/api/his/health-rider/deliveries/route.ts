import { cookies } from 'next/headers'
import { verifyAuthToken } from '@/lib/auth/jwt'
import { listDrugDeliveryDays, listDrugDeliveryPatients } from '@/lib/his/drug-delivery'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PER_IP = { limit: 60, windowSeconds: 300 }

/** ช่วงสรุปรายวันสูงสุด — กว้างกว่านี้เป็นการรวบข้อมูลผู้ป่วยเกินกว่างานที่ใช้จริง */
const MAX_RANGE_DAYS = 62

const DATE = /^\d{4}-\d{2}-\d{2}$/

function bad(message: string) {
  return Response.json({ success: false, message }, { status: 400 })
}

/**
 * รายชื่อผู้ป่วยที่ต้องส่งยาถึงบ้านในวันที่เลือก
 *
 * - `?date=YYYY-MM-DD` คืนรายชื่อของวันนั้น
 * - `?from=&to=` คืนจำนวนผู้ป่วยรายวัน ใช้บอกว่าวันไหนมีงาน ไม่มีข้อมูลรายบุคคล
 */
export async function GET(request: Request) {
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  if (!claims?.sub) {
    return Response.json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 })
  }

  const ip = clientIp(request)
  const limited = rateLimit(`rider-delivery:${claims.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'เรียกบ่อยเกินไป กรุณารอสักครู่')
  }

  const params = new URL(request.url).searchParams
  const date = params.get('date') ?? ''
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''

  try {
    if (from || to) {
      if (!DATE.test(from) || !DATE.test(to)) return bad('รูปแบบวันที่ไม่ถูกต้อง')
      if (from > to) return bad('ช่วงวันที่ไม่ถูกต้อง')
      const span = (Date.parse(to) - Date.parse(from)) / 86_400_000
      if (span > MAX_RANGE_DAYS) return bad(`ดูสรุปได้ครั้งละไม่เกิน ${MAX_RANGE_DAYS} วัน`)
      return Response.json({ success: true, days: await listDrugDeliveryDays(from, to) })
    }

    if (!DATE.test(date)) return bad('รูปแบบวันที่ไม่ถูกต้อง')
    return Response.json({ success: true, patients: await listDrugDeliveryPatients(date) })
  } catch (error) {
    console.error('[his/health-rider/deliveries] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'ดึงรายชื่อผู้ป่วยไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
