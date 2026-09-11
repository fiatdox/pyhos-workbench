import 'server-only'
import { llmConfig, llmConfigured } from './config'

/**
 * ตัวเรียกโมเดลภาษาแบบขอ-ตอบครั้งเดียว (ไม่ stream)
 *
 * ใช้รูปแบบที่เข้ากันได้กับ OpenAI (`POST /v1/chat/completions`) เพราะเป็นภาษากลาง
 * ที่ตัวรันโมเดลฝั่งเครื่องตัวเองรองรับกันหมด — LM Studio, Ollama, llama.cpp server
 * และ vLLM เปลี่ยนตัวไหนก็แก้แค่ค่าใน .env ไม่ต้องแก้โค้ด
 *
 * ไม่ทำ stream ในรอบแรกเพราะฝั่งหน้าจอเป็นแผงสรุปที่อ่านทีเดียวจบ ไม่ใช่แชท
 * ที่ต้องเห็นตัวอักษรไหลทีละคำ — เพิ่มทีหลังได้โดยไม่กระทบผู้เรียก
 */

export type ChatMessage = { role: 'system' | 'user'; content: string }

export type ChatResult =
  | { ok: true; text: string; model: string; elapsedMs: number }
  | { ok: false; reason: 'not_configured' | 'timeout' | 'aborted' | 'unreachable' | 'bad_response' }

/** header ร่วมของทุกคำขอ — LM Studio ไม่บังคับกุญแจ แต่ vLLM ที่ตั้งไว้อาจบังคับ */
function headers(): Record<string, string> {
  const value: Record<string, string> = { 'Content-Type': 'application/json' }
  if (llmConfig.apiKey) value.Authorization = `Bearer ${llmConfig.apiKey}`
  return value
}

export async function chat(
  messages: ChatMessage[],
  /**
   * สัญญาณยกเลิกจากผู้เรียก — ส่ง request.signal ของ route มาได้เลย
   *
   * สำคัญกับงานที่ยิงอัตโนมัติแล้วผู้ใช้ปิดหน้าจอทิ้ง: ตัวรันโมเดลฝั่งเครื่องตัวเอง
   * ทำงานทีละคำขอ ถ้าไม่บอกให้หยุด คำขอที่ไม่มีใครรออ่านแล้วจะยังกิน GPU ต่อ
   * และไปหน่วงคำขอถัดไปที่มีคนรออยู่จริง
   */
  abort?: AbortSignal,
): Promise<ChatResult> {
  if (!llmConfigured()) return { ok: false, reason: 'not_configured' }

  // AbortSignal.timeout ตัดคำขอที่ค้างเอง ไม่ต้องจัดการ timer เอง และไม่ปล่อยให้
  // คำขอค้างกิน connection ของเซิร์ฟเวอร์ไว้จนกว่าปลายทางจะตอบ
  const timeout = AbortSignal.timeout(llmConfig.timeoutMs)
  const startedAt = Date.now()
  let response: Response
  try {
    response = await fetch(`${llmConfig.apiBase}/chat/completions`, {
      method: 'POST',
      headers: headers(),
      cache: 'no-store',
      signal: abort ? AbortSignal.any([timeout, abort]) : timeout,
      body: JSON.stringify({
        model: llmConfig.model,
        messages,
        stream: false,
        // งานนี้ต้องการคำตอบที่คงเส้นคงวาและยึดตามข้อมูลที่ให้ ไม่ใช่ความสร้างสรรค์
        temperature: 0.2,
        top_p: 0.9,
      }),
    })
  } catch (error) {
    // แยกสามกรณีออกจากกัน: หมดเวลารอ / ผู้เรียกสั่งยกเลิก / ติดต่อปลายทางไม่ได้
    // สองอย่างแรกไม่ใช่ความผิดปกติของระบบ จึงไม่ต้องลงล็อก
    if (timeout.aborted) return { ok: false, reason: 'timeout' }
    if (abort?.aborted) return { ok: false, reason: 'aborted' }
    console.error('[llm] เรียกโมเดลไม่สำเร็จ:', error)
    return { ok: false, reason: 'unreachable' }
  }

  if (!response.ok) {
    // อ่านเนื้อ error มาลงล็อกด้วย ปลายทางมักบอกสาเหตุจริงไว้ตรงนี้
    // (ชื่อโมเดลไม่ตรงกับที่โหลดไว้เป็นสาเหตุที่พบบ่อยที่สุด)
    console.error('[llm] โมเดลตอบสถานะ', response.status, (await response.text()).slice(0, 300))
    return { ok: false, reason: 'bad_response' }
  }

  try {
    const json = (await response.json()) as {
      choices?: { message?: { content?: string } }[]
      model?: string
    }
    const text = json.choices?.[0]?.message?.content?.trim() ?? ''
    if (!text) return { ok: false, reason: 'bad_response' }
    // ชื่อโมเดลที่ปลายทางตอบกลับมาเชื่อถือได้กว่าค่าใน .env — LM Studio คืนชื่อจริง
    // ของตัวที่โหลดอยู่ ซึ่งอาจไม่ตรงกับที่พิมพ์ไว้เป๊ะ ๆ
    return { ok: true, text, model: json.model || llmConfig.model, elapsedMs: Date.now() - startedAt }
  } catch {
    return { ok: false, reason: 'bad_response' }
  }
}

/**
 * เช็คว่าปลายทางเปิดอยู่จริงไหม ใช้ตอนหน้าจอถามว่าจะขึ้นแผงช่วยสรุปหรือไม่
 *
 * ตั้งเวลารอสั้น ๆ เพราะคำถามนี้เกิดตอนเปิดหน้า ผู้ใช้ไม่ควรต้องรอเพราะบริการเสริม
 * ที่อาจปิดอยู่ — ตอบไม่ทันก็ถือว่าปิด
 */
export async function probe(): Promise<{ reachable: boolean; models: string[] }> {
  if (!llmConfigured()) return { reachable: false, models: [] }

  try {
    const response = await fetch(`${llmConfig.apiBase}/models`, {
      headers: headers(),
      cache: 'no-store',
      signal: AbortSignal.timeout(3_000),
    })
    if (!response.ok) return { reachable: false, models: [] }
    const json = (await response.json()) as { data?: { id?: string }[] }
    const models = (json.data ?? []).map(item => String(item.id ?? '')).filter(Boolean)
    return { reachable: true, models }
  } catch {
    return { reachable: false, models: [] }
  }
}
