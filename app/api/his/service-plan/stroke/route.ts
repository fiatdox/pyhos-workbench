import { cookies } from 'next/headers'
import { verifyAuthToken } from '@/lib/auth/jwt'
import {
  getStrokeStats,
  shownFiscalYears,
  type FiscalQuarter,
  type StrokeQuery,
} from '@/lib/his/stroke-stats'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* คิวรีใช้เวลาราวหนึ่งวินาทีและสแกน ipt ทั้งตาราง (425,120 แถว) เพดานจึงต่ำกว่า
   เส้น API ที่อ่านของผู้ป่วยรายคน — แต่หน้านี้มีตัวเลือกปีงบและไตรมาสแล้ว คนกด
   สลับไปมาได้หลายครั้งในการนั่งดูรอบเดียว 60 ครั้งใน 5 นาทีจึงพอดี ไม่ถึงกับ
   เปิดให้ยิงคิวรีหนักรัว ๆ */
const PER_IP = { limit: 60, windowSeconds: 300 }

/**
 * สถิติผู้ป่วยในโรคหลอดเลือดสมอง — Service Plan สาขา Stroke
 *
 * ไม่ใส่พารามิเตอร์ = เทียบรายปีงบ (ห้าปีที่ปิดแล้ว บวกปีที่กำลังเดินอยู่)
 * ใส่ year = รายเดือนของปีงบนั้น · ใส่ quarter ด้วย = เฉพาะสามเดือนของไตรมาสนั้น
 *
 * กันแค่ว่าต้องเข้าสู่ระบบ ไม่ผูกสิทธิ์ตามตำแหน่งเหมือน DUE/RDU เพราะที่ส่งออกไป
 * เป็นตัวเลขรวมรายช่วงล้วน ไม่มี HN ไม่มีชื่อ ไม่มี AN แม้แต่รายการเดียว — ถ้าวันหนึ่ง
 * เพิ่มการเจาะลงรายเคส ต้องย้ายมากันด้วยสิทธิ์ก่อนทำ
 */
export async function GET(request: Request) {
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  if (!claims?.sub) {
    return Response.json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 })
  }

  const ip = clientIp(request)
  const limited = rateLimit(`sp-stroke:${claims.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'เรียกบ่อยเกินไป กรุณารอสักครู่')
  }

  const params = new URL(request.url).searchParams
  const yearParam = params.get('year')
  const quarterParam = params.get('quarter')

  let query: StrokeQuery = { by: 'fiscalYear' }
  if (yearParam != null && yearParam !== '') {
    const fiscalYear = Number(yearParam)
    // จำกัดไว้เฉพาะปีที่หน้าจอมีให้เลือก — เปิดให้ระบุปีอะไรก็ได้เท่ากับเปิดให้
    // ยิงคิวรีที่สแกนทั้งตารางย้อนหลังไม่จำกัด
    if (!shownFiscalYears().some(year => year.year === fiscalYear)) {
      return Response.json(
        { success: false, message: 'ปีงบประมาณอยู่นอกช่วงที่ดูได้' },
        { status: 400 },
      )
    }
    let quarter: FiscalQuarter | null = null
    if (quarterParam != null && quarterParam !== '' && quarterParam !== '0') {
      const value = Number(quarterParam)
      if (![1, 2, 3, 4].includes(value)) {
        return Response.json({ success: false, message: 'ไตรมาสไม่ถูกต้อง' }, { status: 400 })
      }
      quarter = value as FiscalQuarter
    }
    query = { by: 'month', fiscalYear, quarter }
  }

  try {
    return Response.json({ success: true, stats: await getStrokeStats(query) })
  } catch (error) {
    console.error('[his/service-plan/stroke] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'ดึงข้อมูลสถิติไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
