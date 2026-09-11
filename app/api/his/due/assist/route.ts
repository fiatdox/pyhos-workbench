import { denyDueUser, requireDueUser } from '@/lib/auth/due-user'
import { summarizeDueCase } from '@/lib/his/due-assist'
import { getDuePatient } from '@/lib/his/due'
import { probe } from '@/lib/llm/client'
import { llmConfig, llmConfigured } from '@/lib/llm/config'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// หนักกว่าคิวรีธรรมดามาก (โมเดลกินเวลาเป็นสิบวินาทีต่อครั้ง) จึงคุมให้ถี่น้อยกว่า
const PER_IP = { limit: 20, windowSeconds: 300 }

const HN_RE = /^\d{9}$/

/**
 * ผู้ช่วยสรุปข้อมูลประกอบใบคำขอ DUE
 *
 * GET  = ถามว่าเปิดใช้ได้ไหม หน้าจอเรียกก่อนเพื่อตัดสินใจว่าจะขึ้นปุ่มหรือไม่
 * POST = ขอบทสรุปของ HN นั้น
 *
 * เมื่อยังไม่ได้ตั้งค่าโมเดลใน .env ทั้งสองทางตอบ 200 พร้อม available: false
 * ไม่ใช่ error — เครื่องที่ไม่มีโมเดลถือว่าปิดฟีเจอร์นี้ ไม่ใช่ระบบพัง
 */
export async function GET() {
  const user = await requireDueUser()
  if (!user.ok) return denyDueUser(user.error)

  if (!llmConfigured()) return Response.json({ success: true, available: false, model: null })

  // ตั้งค่าไว้ยังไม่พอ ต้องติดต่อได้จริงด้วย — เครื่องที่ปิด LM Studio ไว้ไม่ควรเห็น
  // ปุ่มที่กดแล้วรอจนหมดเวลาเปล่า ๆ
  const { reachable, models } = await probe()

  // เตือนเมื่อชื่อโมเดลใน .env ไม่ตรงกับที่โหลดไว้จริง ซึ่งเป็นสาเหตุที่พบบ่อยที่สุด
  // เวลาต่อกับ LM Studio แล้วเรียกไม่ผ่าน
  const loaded = models.length === 0 || models.includes(llmConfig.model)

  return Response.json({
    success: true,
    available: reachable,
    // ชื่อโมเดลบอกไว้เพื่อให้ผู้ใช้รู้ว่าข้อความมาจากตัวไหน ไม่ใช่กล่องดำ
    model: llmConfig.model,
    modelLoaded: loaded,
    availableModels: loaded ? undefined : models.slice(0, 10),
  })
}

export async function POST(request: Request) {
  const user = await requireDueUser()
  if (!user.ok) return denyDueUser(user.error)

  if (!llmConfigured()) {
    return Response.json({ success: true, available: false })
  }

  const ip = clientIp(request)
  const limited = rateLimit(`due-assist:${user.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'ขอบทสรุปถี่เกินไป กรุณารอสักครู่')
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return Response.json({ success: false, message: 'รูปแบบข้อมูลไม่ถูกต้อง' }, { status: 400 })
  }

  const hn = typeof body.hn === 'string' ? body.hn.trim() : ''
  const drugName = typeof body.drugName === 'string' ? body.drugName.trim().slice(0, 200) : null
  if (!HN_RE.test(hn)) {
    return Response.json({ success: false, message: 'HN ไม่ถูกต้อง' }, { status: 400 })
  }

  try {
    // ดึงข้อมูลใหม่ฝั่งเซิร์ฟเวอร์ ไม่รับชุดข้อมูลจากเบราว์เซอร์ — สิ่งที่โมเดลเห็น
    // ต้องมาจากฐานเท่านั้น ไม่ใช่ค่าที่ฝั่งหน้าจอส่งมาได้ตามใจ
    const patient = await getDuePatient(hn)
    if (!patient) {
      return Response.json({ success: false, message: 'ไม่พบผู้ป่วยตาม HN นี้' }, { status: 404 })
    }

    const result = await summarizeDueCase(patient, drugName)
    if (!result.ok) {
      const message =
        result.reason === 'timeout'
          ? 'โมเดลใช้เวลานานเกินกำหนด ลองใหม่อีกครั้งหรือข้ามส่วนนี้ไปก่อน'
          : result.reason === 'unreachable'
            ? 'ติดต่อเครื่องที่รันโมเดลไม่ได้ ส่วนนี้จึงยังใช้ไม่ได้'
            : 'โมเดลตอบกลับไม่สมบูรณ์ ลองใหม่อีกครั้ง'
      // 503 ไม่ใช่ 500 — ระบบที่เหลือปกติดี ขาดแค่บริการเสริมตัวนี้
      return Response.json({ success: false, available: true, message }, { status: 503 })
    }

    return Response.json({
      success: true,
      available: true,
      summary: result.text,
      model: result.model,
      elapsedMs: result.elapsedMs,
    })
  } catch (error) {
    console.error('[his/due/assist] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'สรุปข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
