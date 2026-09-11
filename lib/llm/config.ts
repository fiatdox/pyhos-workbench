import 'server-only'

/**
 * การตั้งค่าโมเดลภาษาที่รันในเครือข่ายของโรงพยาบาล
 *
 * คุยด้วย API แบบเดียวกับ OpenAI ซึ่งตัวรันโมเดลฝั่งเครื่องตัวเองรองรับกันหมด
 * (LM Studio, Ollama, llama.cpp server, vLLM) เปลี่ยนตัวไหนก็แก้แค่ .env
 *
 * ทั้งหมดเป็นค่าเลือกได้ — ไม่ตั้งไว้ = ปิดฟีเจอร์ช่วยวิเคราะห์ หน้าจอที่เกี่ยวข้อง
 * จะไม่ขึ้นปุ่มให้กดเลย ระบบส่วนอื่นทำงานตามปกติทุกอย่าง เจตนาคือเปิดใช้ที่เครื่อง
 * ไหนก็ได้ที่มีโมเดลรันอยู่ โดยเครื่องที่ไม่มีต้องไม่พังและไม่มีปุ่มค้างให้กดเปล่า ๆ
 *
 * ข้อมูลผู้ป่วยที่ส่งเข้าโมเดลจะไปถึงปลายทางที่ตั้งไว้ตรงนี้เท่านั้น — ตั้งเป็น
 * เครื่องในเครือข่ายที่โรงพยาบาลดูแลเองเสมอ ห้ามชี้ไปยังบริการภายนอก
 */

const rawBase = process.env.LLM_BASE_URL?.trim().replace(/\/+$/, '') || ''

/**
 * เติม /v1 ให้เองเมื่อยังไม่มี
 *
 * LM Studio โชว์ที่อยู่เป็น http://127.0.0.1:1234/v1 ส่วน Ollama โชว์เป็น
 * http://127.0.0.1:11434 เฉย ๆ ทั้งที่รับ /v1/chat/completions เหมือนกัน
 * กรอกมาแบบไหนก็ควรใช้ได้ ไม่ต้องมาจำว่าตัวไหนต้องเติมอะไร
 */
const apiBase = rawBase === '' ? '' : /\/v\d+$/.test(rawBase) ? rawBase : `${rawBase}/v1`

const timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 60_000)

export const llmConfig = {
  /** ที่อยู่ฐานที่ลงท้ายด้วย /v1 พร้อมต่อ /chat/completions หรือ /models ได้เลย */
  apiBase,
  model: process.env.LLM_MODEL?.trim() || '',
  /** กุญแจ — LM Studio ไม่บังคับ ปล่อยว่างได้ */
  apiKey: process.env.LLM_API_KEY?.trim() || '',
  /** เวลารอสูงสุดต่อหนึ่งคำขอ — โมเดลบน CPU ช้ากว่านี้ได้ ตั้งเผื่อไว้ที่ .env */
  timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60_000,
}

/** ตั้งค่าครบพอจะเรียกใช้ได้หรือยัง — ต้องมีทั้งที่อยู่และชื่อโมเดล */
export function llmConfigured(): boolean {
  return llmConfig.apiBase !== '' && llmConfig.model !== ''
}
