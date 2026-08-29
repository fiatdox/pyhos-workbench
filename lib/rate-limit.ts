import 'server-only'

/**
 * ตัวจำกัดอัตราแบบ fixed window เก็บในหน่วยความจำของโปรเซส
 *
 * ข้อจำกัดที่ต้องรู้: ถ้าขยายเป็นหลาย instance (pm2 cluster / หลายเครื่อง)
 * แต่ละโปรเซสจะนับแยกกัน — ถ้าถึงจุดนั้นให้ย้ายไปนับที่ Redis หรือในตารางฐานข้อมูล
 */

type Bucket = { count: number; resetAt: number }

const globalForLimiter = globalThis as unknown as { rateLimitBuckets?: Map<string, Bucket> }
const buckets = globalForLimiter.rateLimitBuckets ?? new Map<string, Bucket>()
globalForLimiter.rateLimitBuckets = buckets

// กันหน่วยความจำบวมเมื่อมี key แปลก ๆ เข้ามามาก — เก็บกวาดของหมดอายุเป็นระยะ
let lastSweep = Date.now()
function sweep(now: number) {
  if (now - lastSweep < 60_000) return
  lastSweep = now
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key)
}

export type RateLimitResult = {
  ok: boolean
  remaining: number
  /** วินาทีที่ต้องรอก่อนลองใหม่ (เมื่อ ok = false) */
  retryAfterSeconds: number
}

/**
 * นับหนึ่งครั้งสำหรับ key ที่ระบุ
 * @param limit จำนวนครั้งสูงสุดต่อหนึ่งหน้าต่างเวลา
 * @param windowSeconds ความยาวหน้าต่างเวลา (วินาที)
 */
export function rateLimit(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now()
  sweep(now)

  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 })
    return { ok: true, remaining: limit - 1, retryAfterSeconds: 0 }
  }

  bucket.count += 1
  if (bucket.count > limit) {
    return { ok: false, remaining: 0, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) }
  }
  return { ok: true, remaining: limit - bucket.count, retryAfterSeconds: 0 }
}

/** ล้างตัวนับของ key (ใช้เมื่อทำรายการสำเร็จ เช่น ล็อกอินผ่าน) */
export function resetRateLimit(key: string): void {
  buckets.delete(key)
}

/** ดึง IP ผู้เรียกจาก header ที่ reverse proxy ใส่มา */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim().slice(0, 64)
  return (request.headers.get('x-real-ip') ?? 'unknown').slice(0, 64)
}

/** ตอบ 429 พร้อม header Retry-After ให้ client รู้ว่าต้องรอเท่าไร */
export function tooManyRequests(retryAfterSeconds: number, message: string): Response {
  return Response.json(
    { success: false, message, retry_after_seconds: retryAfterSeconds },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
  )
}
