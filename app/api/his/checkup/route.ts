import { cookies } from 'next/headers'
import { verifyAuthToken } from '@/lib/auth/jwt'
import {
  CHECKUP_MAX_RANGE_DAYS,
  CHECKUP_MAX_ROWS,
  listCheckupRights,
  searchCheckups,
} from '@/lib/his/checkup'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * งานตรวจสุขภาพ
 *
 * GET  คืนรายการสิทธิที่เปิดใช้งาน พร้อมเพดานที่ยอมรับ
 * POST ค้นรายชื่อตามสิทธิที่เลือกและช่วงวันที่
 *
 * เป็น POST ไม่ใช่ GET เหมือนรายงานที่ส่งแค่ช่วงวันที่ — รายการสิทธิที่เลือกได้
 * ยาวถึง 207 รหัส ถ้าต่อเป็น query string จะชนความยาว URL สูงสุดของ proxy
 * ระหว่างทาง ทั้งสองเส้นทางอ่านข้อมูลอย่างเดียว ไม่เขียนอะไร
 */

const PER_IP = { limit: 30, windowSeconds: 300 }

/** 'YYYY-MM-DD' */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const MS_PER_DAY = 86_400_000

/**
 * เพดานจำนวนสิทธิที่รับจากคำขอ
 *
 * ทั้งฐานมีสิทธิที่เปิดใช้งาน 207 รหัส เผื่อไว้เล็กน้อยเพื่อกันคำขอที่ส่งรายการ
 * ยาวเกินจริงมาให้ต้องไปต่อเป็นพารามิเตอร์ของคิวรี
 */
const MAX_PTTYPES = 250

/** ความยาวสูงสุดของรหัสสิทธิ — pttype.pttype เป็น char(2) */
const MAX_CODE_LENGTH = 2

function bad(message: string) {
  return Response.json({ success: false, message }, { status: 400 })
}

async function requireUser(): Promise<string | null> {
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  return claims?.sub ?? null
}

export async function GET() {
  const sub = await requireUser()
  if (!sub) return Response.json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 })

  try {
    const rights = await listCheckupRights()
    /* ส่งเพดานไปด้วย ไม่ให้หน้าจอถือตัวเลขชุดเดียวกันไว้เอง — ถ้าวันหนึ่งเพดาน
       เปลี่ยน หน้าจอกับเซิร์ฟเวอร์จะไม่เถียงกันเรื่องค่าที่ยอมรับ */
    return Response.json({
      success: true,
      rights,
      maxRangeDays: CHECKUP_MAX_RANGE_DAYS,
      maxRows: CHECKUP_MAX_ROWS,
    })
  } catch (error) {
    console.error('[his/checkup] อ่านรายการสิทธิไม่สำเร็จ:', error)
    return Response.json(
      { success: false, message: 'อ่านรายการสิทธิไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  const sub = await requireUser()
  if (!sub) return Response.json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 })

  const ip = clientIp(request)
  const limited = rateLimit(`his-checkup:${sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'เรียกบ่อยเกินไป กรุณารอสักครู่')
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return bad('รูปแบบคำขอไม่ถูกต้อง')
  }

  const from = typeof body.from === 'string' ? body.from.trim() : ''
  const to = typeof body.to === 'string' ? body.to.trim() : ''
  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) return bad('รูปแบบวันที่ไม่ถูกต้อง')

  // เทียบเป็นเวลา UTC ทั้งคู่ ทั้งสองฝั่งจึงไม่มีเรื่องเขตเวลามาเกี่ยว
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return bad('วันที่ไม่ถูกต้อง')
  if (end < start) return bad('วันที่เริ่มต้นต้องไม่หลังวันที่สิ้นสุด')
  if ((end - start) / MS_PER_DAY + 1 > CHECKUP_MAX_RANGE_DAYS) {
    return bad(`เลือกช่วงวันที่ได้ครั้งละไม่เกิน ${CHECKUP_MAX_RANGE_DAYS} วัน`)
  }

  if (!Array.isArray(body.pttypes)) return bad('รายการสิทธิที่เลือกไม่ถูกต้อง')
  const pttypes = [
    ...new Set(
      body.pttypes
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim())
        .filter(item => item !== '' && item.length <= MAX_CODE_LENGTH),
    ),
  ]
  if (pttypes.length !== body.pttypes.length) return bad('รายการสิทธิที่เลือกไม่ถูกต้อง')
  if (pttypes.length === 0) return bad('กรุณาเลือกสิทธิอย่างน้อยหนึ่งรายการ')
  if (pttypes.length > MAX_PTTYPES) return bad(`เลือกสิทธิได้ครั้งละไม่เกิน ${MAX_PTTYPES} รายการ`)

  try {
    const report = await searchCheckups({ from, to, pttypes })
    return Response.json({ success: true, ...report })
  } catch (error) {
    console.error('[his/checkup] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'ค้นรายงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
