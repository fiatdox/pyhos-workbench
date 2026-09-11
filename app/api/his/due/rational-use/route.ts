import { denyDueUser, requireDueUser } from '@/lib/auth/due-user'
import { parseRduCase, reviewRationalDrugUse } from '@/lib/his/rdu-review'
import { llmConfigured } from '@/lib/llm/config'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * วิเคราะห์ความสมเหตุผลของการใช้ยาในแบบประเมินของเภสัชกร
 *
 * ยิงอัตโนมัติทุกครั้งที่เปิดแบบประเมิน ไม่ใช่ตอนกดปุ่มเหมือนแผงในหน้าคำขอ
 * โควตาจึงตั้งสูงกว่า — เภสัชกรเปิดปิดยาทีละตัวรวดเดียวหลายตัวเป็นเรื่องปกติ
 *
 * ส่ง request.signal ต่อไปให้ตัวเรียกโมเดลด้วย ปิดหน้าจอแล้วคำขอที่ค้างอยู่
 * ต้องหยุดจริง ไม่ใช่ปล่อยให้โมเดลคิดต่อจนจบทั้งที่ไม่มีใครรออ่านแล้ว
 */
const PER_USER = { limit: 60, windowSeconds: 300 }

export async function POST(request: Request) {
  const user = await requireDueUser()
  if (!user.ok) return denyDueUser(user.error)

  // ยังไม่ได้ตั้งค่าโมเดล = ปิดฟีเจอร์ ไม่ใช่ระบบพัง หน้าจอจะไม่ขึ้นแท็บให้เลย
  if (!llmConfigured()) return Response.json({ success: true, available: false })

  const ip = clientIp(request)
  const limited = rateLimit(`due-rdu:${user.sub}:${ip}`, PER_USER.limit, PER_USER.windowSeconds)
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'วิเคราะห์ถี่เกินไป กรุณารอสักครู่')
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return Response.json({ success: false, message: 'รูปแบบข้อมูลไม่ถูกต้อง' }, { status: 400 })
  }

  const input = parseRduCase(body)
  if (!input) {
    return Response.json({ success: false, message: 'ไม่มีรายการยาที่จะวิเคราะห์' }, { status: 400 })
  }

  const result = await reviewRationalDrugUse(input, request.signal)
  if (!result.ok) {
    // ผู้ใช้ปิดหน้าจอไปแล้ว ไม่มีใครรออ่านคำตอบ ตอบสั้น ๆ พอ
    if (result.reason === 'aborted') {
      return Response.json({ success: false, message: 'ยกเลิกแล้ว' }, { status: 499 })
    }
    const message =
      result.reason === 'timeout'
        ? 'โมเดลใช้เวลานานเกินกำหนด ประเมินต่อได้โดยไม่ต้องรอส่วนนี้'
        : result.reason === 'unreachable'
          ? 'ติดต่อเครื่องที่รันโมเดลไม่ได้ ส่วนนี้จึงยังใช้ไม่ได้'
          : 'โมเดลตอบกลับไม่สมบูรณ์ ลองใหม่อีกครั้ง'
    // 503 ไม่ใช่ 500 — แบบประเมินยังกรอกและบันทึกได้ตามปกติ ขาดแค่ตัวช่วยนี้
    return Response.json({ success: false, available: true, message }, { status: 503 })
  }

  return Response.json({
    success: true,
    available: true,
    analysis: result.text,
    model: result.model,
    elapsedMs: result.elapsedMs,
  })
}
