import { denyRduUser, requireRduUser } from '@/lib/auth/rdu-user'
import {
  comparedFiscalYears,
  computeYearly,
  isIndicator,
  listIndicators,
  loadYearly,
} from '@/lib/his/rdu-yearly'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * ผลตัวชี้วัด RDU รายปีงบประมาณ — ของหน้าสรุปเปรียบเทียบสามปี
 *
 * GET อ่านจากตารางแคชอย่างเดียว ไม่คำนวณอะไรเลย จึงตอบทันที
 * POST คำนวณทีละหนึ่งช่อง (ตัวชี้วัดหนึ่งข้อ × ปีงบหนึ่งปี) แล้วเก็บผล
 *
 * ที่ต้องแยกเป็นทีละช่องเพราะทั้งตารางใช้เวลาราวสองนาที ถ้ายัดไว้ในคำขอเดียว
 * จะชนเพดานเวลาของ proxy และผู้ใช้จะเห็นแต่หน้าค้างโดยไม่รู้ว่าคืบหน้าแค่ไหน —
 * ให้หน้าจอเป็นคนไล่เรียกทีละช่องแล้วแสดงความคืบหน้าเองดีกว่า
 */

const PER_IP = { limit: 60, windowSeconds: 300 }
/* คำนวณหนึ่งช่องใช้เวลาไม่กี่วินาทีถึงยี่สิบวินาที และการคำนวณทั้งตารางต้องยิง
   สามสิบครั้ง เพดานจึงต้องสูงพอให้กดคำนวณทั้งหมดได้หลายรอบในห้านาที */
const PER_IP_COMPUTE = { limit: 120, windowSeconds: 300 }

function bad(message: string) {
  return Response.json({ success: false, message }, { status: 400 })
}

export async function GET(request: Request) {
  const user = await requireRduUser()
  if (!user.ok) return denyRduUser(user.error)

  const ip = clientIp(request)
  const limited = rateLimit(`rdu-yearly:${user.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'เรียกบ่อยเกินไป กรุณารอสักครู่')
  }

  try {
    const years = comparedFiscalYears()
    const [results, indicators] = await Promise.all([loadYearly(years), listIndicators()])
    return Response.json({ success: true, years, results, indicators })
  } catch (error) {
    console.error('[his/rdu/yearly] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'ดึงผลตัวชี้วัดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  const user = await requireRduUser()
  if (!user.ok) return denyRduUser(user.error)

  const ip = clientIp(request)
  const limited = rateLimit(
    `rdu-yearly-run:${user.sub}:${ip}`,
    PER_IP_COMPUTE.limit,
    PER_IP_COMPUTE.windowSeconds,
  )
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'คำนวณถี่เกินไป กรุณารอสักครู่')
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return bad('รูปแบบข้อมูลไม่ถูกต้อง')
  }

  const indicator = String(body.indicator ?? '').trim()
  if (!isIndicator(indicator)) {
    return Response.json({ success: false, message: 'ไม่พบตัวชี้วัดที่ระบุ' }, { status: 404 })
  }

  const fiscalYear = Number(body.fiscalYear)
  // จำกัดไว้เฉพาะปีที่หน้าสรุปแสดง — ปีอื่นไม่มีที่ให้แสดงผล และการเปิดให้ระบุ
  // ปีอะไรก็ได้เท่ากับเปิดให้ยิงคิวรีหนักย้อนหลังไม่จำกัด
  const years = comparedFiscalYears()
  if (!years.includes(fiscalYear)) return bad('ปีงบประมาณอยู่นอกช่วงที่เปรียบเทียบ')

  try {
    const result = await computeYearly(indicator, fiscalYear)
    return Response.json({ success: true, result })
  } catch (error) {
    console.error(`[his/rdu/yearly] คำนวณ ${indicator} ปี ${fiscalYear} ล้มเหลว:`, error)
    return Response.json(
      { success: false, message: 'คำนวณไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
