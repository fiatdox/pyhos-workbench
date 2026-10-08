import { cookies } from 'next/headers'
import { verifyAuthToken } from '@/lib/auth/jwt'
import {
  getCardiacStats,
  shownFiscalYears,
  type CardiacQuery,
  type FiscalQuarter,
} from '@/lib/his/cardiac-stats'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* คิวรีเบา — กรองด้วยดัชนีวันจำหน่ายแล้วต่อเข้าหาโรคหลักด้วยช่วงรหัสแคบ
   ช่วงห้าปีใช้ 1.0 วินาที (รายเดือนของปีเดียว 0.22 วินาที · ไตรมาส 0.06 วินาที)
   ยิงพร้อมกับคิวรีตัวหารที่นับการนอนทั้งหมด (0.07 วินาที) จึงไม่บวกเวลาเพิ่ม —
   ทั้งสองตัวชี้วัดมาจากการเรียกครั้งเดียว และการสลับกลุ่มชนิด STEMI/NSTEMI
   ทำที่ฝั่งหน้าจอ ไม่ได้ยิงใหม่ */
const PER_IP = { limit: 40, windowSeconds: 300 }

/**
 * กล้ามเนื้อหัวใจตายและโรคหัวใจขาดเลือด — Service Plan สาขาโรคหัวใจ
 *
 * คืนทั้งสองตัวชี้วัดในคำตอบเดียว (อัตราตาย STEMI ขอบเขต I21-I23 และอัตราป่วย
 * โรคหัวใจขาดเลือดขอบเขต I20-I25 ที่ครอบอันแรกไว้) เพราะมาจากคิวรีเดียวกัน
 *
 * ไม่ใส่พารามิเตอร์ = เทียบรายปีงบ · ใส่ year = รายเดือนของปีงบนั้น ·
 * ใส่ quarter ด้วย = เฉพาะสามเดือนของไตรมาสนั้น (เหมือนหน้า Stroke และ Sepsis)
 *
 * กันแค่ว่าต้องเข้าสู่ระบบ ไม่ผูกสิทธิ์ตามตำแหน่ง เพราะที่ส่งออกไปเป็นตัวเลขรวม
 * รายช่วงล้วน ไม่มี HN ไม่มีชื่อ ไม่มี AN แม้แต่รายการเดียว — ถ้าวันหนึ่งเพิ่ม
 * การเจาะลงรายเคส ต้องย้ายมากันด้วยสิทธิ์ก่อนทำ
 */
export async function GET(request: Request) {
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  if (!claims?.sub) {
    return Response.json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 })
  }

  const ip = clientIp(request)
  const limited = rateLimit(`sp-cardiac:${claims.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'เรียกบ่อยเกินไป กรุณารอสักครู่')
  }

  const params = new URL(request.url).searchParams
  const yearParam = params.get('year')
  const quarterParam = params.get('quarter')

  let query: CardiacQuery = { by: 'fiscalYear' }
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
    return Response.json({ success: true, stats: await getCardiacStats(query) })
  } catch (error) {
    console.error('[his/service-plan/cardiac] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'ดึงข้อมูลสถิติไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
