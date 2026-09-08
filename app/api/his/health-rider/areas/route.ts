import { cookies } from 'next/headers'
import { verifyAuthToken } from '@/lib/auth/jwt'
import { createRiderAreas, deleteRiderAreas, listRiderAreas } from '@/lib/his/health-rider'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PER_IP = { limit: 60, windowSeconds: 300 }
// เพิ่มทีเดียวได้หลายหมู่ต่อหนึ่งคำขอ จำนวนครั้งจึงน้อยอยู่แล้ว
const PER_IP_ADD = { limit: 30, windowSeconds: 300 }
// ลบได้ทีละแถวเท่านั้น การจัดพื้นที่ของเจ้าหน้าที่หนึ่งคนใหม่จึงยิงหลายสิบครั้ง
// ติด ๆ กันเป็นเรื่องปกติ ตั้งเท่ากับการอ่านเพื่อไม่ให้งานจริงสะดุด
const PER_IP_DELETE = { limit: 120, windowSeconds: 300 }

/** จำนวนหมู่สูงสุดต่อการเพิ่มหนึ่งครั้ง — กันยิงชุดใหญ่จนล็อกตารางนาน */
const MAX_MOOS = 50

/** จำนวนรายการสูงสุดต่อการลบหนึ่งครั้ง — กันเผลอเลือกทั้งตารางแล้วลบรวดเดียว */
const MAX_DELETE = 200

function bad(message: string) {
  return Response.json({ success: false, message }, { status: 400 })
}

async function requireUser() {
  const token = (await cookies()).get('auth_token')?.value
  return token ? await verifyAuthToken(token) : null
}

export async function GET(request: Request) {
  const claims = await requireUser()
  if (!claims?.sub) {
    return Response.json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 })
  }

  const ip = clientIp(request)
  const limited = rateLimit(`rider-area:${claims.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'เรียกบ่อยเกินไป กรุณารอสักครู่')
  }

  const rider = Number(new URL(request.url).searchParams.get('rider'))
  if (!Number.isInteger(rider)) return bad('กรุณาเลือกเจ้าหน้าที่')

  try {
    const areas = await listRiderAreas(rider)
    return Response.json({ success: true, areas })
  } catch (error) {
    console.error('[his/health-rider/areas] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'ดึงพื้นที่รับผิดชอบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}

/** เพิ่มพื้นที่รับผิดชอบ — ทีละหลายหมู่ในตำบลเดียวกัน */
export async function POST(request: Request) {
  const claims = await requireUser()
  if (!claims?.sub) {
    return Response.json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 })
  }

  const ip = clientIp(request)
  const limited = rateLimit(
    `rider-area-add:${claims.sub}:${ip}`,
    PER_IP_ADD.limit,
    PER_IP_ADD.windowSeconds,
  )
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'เพิ่มข้อมูลถี่เกินไป กรุณารอสักครู่')
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return bad('รูปแบบข้อมูลไม่ถูกต้อง')
  }

  const rider = Number(body.rider)
  const tambonId = typeof body.tambonId === 'string' ? body.tambonId.trim() : ''
  const prefix = typeof body.prefix === 'string' ? body.prefix.trim() : ''
  // รับได้ทั้งตัวเลขและข้อความ ตัดซ้ำและตัดค่าว่างทิ้ง
  const moos = Array.isArray(body.moos)
    ? [...new Set(body.moos.map(value => String(value).trim()).filter(Boolean))]
    : []

  if (!Number.isInteger(rider)) return bad('กรุณาเลือกเจ้าหน้าที่')
  if (!/^\d{6}$/.test(tambonId)) return bad('รหัสตำบลไม่ถูกต้อง')
  if (moos.length === 0) return bad('กรุณาระบุหมู่ที่')
  if (moos.length > MAX_MOOS) return bad(`เพิ่มได้ครั้งละไม่เกิน ${MAX_MOOS} หมู่`)
  // คอลัมน์ moo เป็น varchar(3) ยาวกว่านี้ฐานจะตัดทิ้งเงียบ ๆ
  if (moos.some(moo => moo.length > 3)) return bad('หมู่ที่ต้องยาวไม่เกิน 3 ตัวอักษร')
  if (prefix.length > 150) return bad('ชื่อพื้นที่ยาวเกินกว่าที่ระบบรับได้')

  try {
    const result = await createRiderAreas({ rider, tambonId, moos, prefix })
    return Response.json({ success: true, ...result })
  } catch (error) {
    console.error('[his/health-rider/areas] เพิ่มไม่สำเร็จ:', error)
    return Response.json(
      { success: false, message: 'เพิ่มพื้นที่รับผิดชอบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}

/**
 * ลบพื้นที่รับผิดชอบ — ส่ง ids มาได้ทั้งแถวเดียวและหลายแถว (คั่นด้วยจุลภาค)
 *
 * ต้องส่ง rider มาด้วยเสมอ ไม่ใช่แค่ ids — คำสั่งลบผูกสองค่านี้เข้าด้วยกัน กันกรณี
 * ส่ง id ที่ไม่ใช่ของเจ้าหน้าที่ที่เปิดอยู่แล้วลบแถวของคนอื่นทิ้งโดยไม่ตั้งใจ
 */
export async function DELETE(request: Request) {
  const claims = await requireUser()
  if (!claims?.sub) {
    return Response.json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 })
  }

  const ip = clientIp(request)
  const limited = rateLimit(
    `rider-area-del:${claims.sub}:${ip}`,
    PER_IP_DELETE.limit,
    PER_IP_DELETE.windowSeconds,
  )
  if (!limited.ok) {
    return tooManyRequests(
      limited.retryAfterSeconds,
      `ลบข้อมูลถี่เกินไป กรุณารออีก ${limited.retryAfterSeconds} วินาที`,
    )
  }

  const params = new URL(request.url).searchParams
  const rider = Number(params.get('rider'))
  const ids = [
    ...new Set(
      (params.get('ids') ?? '')
        .split(',')
        .map(value => Number(value.trim()))
        .filter(value => Number.isInteger(value) && value > 0),
    ),
  ]

  if (!Number.isInteger(rider) || rider <= 0) return bad('กรุณาเลือกเจ้าหน้าที่')
  if (ids.length === 0) return bad('รหัสรายการไม่ถูกต้อง')
  if (ids.length > MAX_DELETE) return bad(`ลบได้ครั้งละไม่เกิน ${MAX_DELETE} รายการ`)

  try {
    const removed = await deleteRiderAreas({ ids, rider })
    if (removed === 0) {
      return Response.json(
        { success: false, message: 'ไม่พบรายการที่เลือก อาจถูกลบไปแล้ว' },
        { status: 404 },
      )
    }
    // บอกจำนวนที่ลบได้จริง — อาจน้อยกว่าที่เลือกถ้ามีคนอื่นลบไปก่อน
    return Response.json({ success: true, removed })
  } catch (error) {
    console.error('[his/health-rider/areas] ลบไม่สำเร็จ:', error)
    return Response.json(
      { success: false, message: 'ลบพื้นที่รับผิดชอบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
