import { denyRduUser, requireRduUser } from '@/lib/auth/rdu-user'
import {
  addIcd10,
  isDiagnosisRegistry,
  listIcd10Candidates,
  listRegisteredIcd10,
  removeIcd10,
} from '@/lib/his/rdu-registry'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * ทะเบียนรหัสวินิจฉัยของตัวชี้วัด RDU — เส้นทางเดียวรับทุกทะเบียน
 *
 * [kind] คือชื่อทะเบียน (asthma, ri) ตรวจกับรายชื่อที่รู้จักใน rdu-registry.ts
 * ก่อนเสมอ — ค่าที่ไม่อยู่ในรายชื่อตอบ 404 ไม่ใช่ปล่อยให้ไปถึงคิวรี เพราะชื่อทะเบียน
 * ถูกแปลงเป็นชื่อตารางในคิวรีโดยตรง
 *
 * GET รับคำค้นได้ เพราะตาราง icd101 มี 43,825 รหัส ยกมาทั้งตารางต่อการเปิดหน้า
 * หนึ่งครั้งไม่ไหว — ไม่ใส่คำค้นจะได้หมวดโรคระบบหายใจมาตั้งต้น ใส่คำค้นจะค้น
 * ทั้งตารางแบบจำกัดจำนวนผล การค้นจึงอยู่ฝั่งเซิร์ฟเวอร์ ไม่ใช่ในเบราว์เซอร์
 *
 * ทุกครั้งที่ตอบกลับจะแนบทะเบียนปัจจุบันมาด้วยเสมอ ไม่ใช่เฉพาะตอนเปิดหน้า —
 * หน้าจอจะได้ยึดค่าจากฐานตลอด ไม่ต้องเดาว่าทะเบียนเปลี่ยนไปหรือยังหลังค้นแต่ละครั้ง
 */

const PER_IP = { limit: 120, windowSeconds: 300 }
// การตั้งค่าทำไม่บ่อย และหนึ่งคำขอย้ายได้หลายรายการอยู่แล้ว
const PER_IP_WRITE = { limit: 60, windowSeconds: 300 }

/** จำนวนรหัสสูงสุดต่อการเพิ่ม/ลบหนึ่งครั้ง — กันยิงชุดใหญ่จนล็อกตารางนาน */
const MAX_CHANGE = 200

/** คำค้นที่ยาวกว่านี้ไม่มีทางตรงกับอะไร — icd101.name ยาวสุด 200 ตัวอักษร */
const MAX_KEYWORD = 100

/** code ในฐานเป็น varchar(7) ตัวอักษรและตัวเลขล้วน ยาวกว่านี้ฐานจะตัดทิ้งเงียบ ๆ */
const CODE_PATTERN = /^[A-Za-z0-9]{1,7}$/

function bad(message: string) {
  return Response.json({ success: false, message }, { status: 400 })
}

function unknownRegistry() {
  return Response.json({ success: false, message: 'ไม่พบทะเบียนที่ระบุ' }, { status: 404 })
}

/** อ่านรายการรหัสที่รับมา — ตัดค่าซ้ำและค่าที่ผิดรูปแบบทิ้ง */
function parseCodes(values: unknown): string[] {
  const list = Array.isArray(values) ? values : String(values ?? '').split(',')
  return [
    ...new Set(list.map(value => String(value).trim()).filter(value => CODE_PATTERN.test(value))),
  ]
}

export async function GET(
  request: Request,
  ctx: RouteContext<'/api/his/rdu/registry/diagnosis/[kind]'>,
) {
  const user = await requireRduUser()
  if (!user.ok) return denyRduUser(user.error)

  const { kind } = await ctx.params
  if (!isDiagnosisRegistry(kind)) return unknownRegistry()

  const ip = clientIp(request)
  const limited = rateLimit(`rdu-dx:${user.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'เรียกบ่อยเกินไป กรุณารอสักครู่')
  }

  const keyword = (new URL(request.url).searchParams.get('q') ?? '').trim().slice(0, MAX_KEYWORD)

  try {
    const [codes, selected] = await Promise.all([
      listIcd10Candidates(kind, keyword),
      listRegisteredIcd10(kind),
    ])
    return Response.json({ success: true, codes, selected })
  } catch (error) {
    console.error(`[his/rdu/registry/diagnosis/${kind}] ล้มเหลว:`, error)
    return Response.json(
      { success: false, message: 'ดึงรหัสวินิจฉัยไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}

/** เพิ่มรหัสเข้าทะเบียน — ทีละหลายรหัสต่อหนึ่งคำขอ */
export async function POST(
  request: Request,
  ctx: RouteContext<'/api/his/rdu/registry/diagnosis/[kind]'>,
) {
  const user = await requireRduUser()
  if (!user.ok) return denyRduUser(user.error)

  const { kind } = await ctx.params
  if (!isDiagnosisRegistry(kind)) return unknownRegistry()

  const ip = clientIp(request)
  const limited = rateLimit(
    `rdu-dx-add:${user.sub}:${ip}`,
    PER_IP_WRITE.limit,
    PER_IP_WRITE.windowSeconds,
  )
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'บันทึกถี่เกินไป กรุณารอสักครู่')
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return bad('รูปแบบข้อมูลไม่ถูกต้อง')
  }

  const codes = parseCodes(body.codes)
  if (codes.length === 0) return bad('กรุณาเลือกรหัสวินิจฉัย')
  if (codes.length > MAX_CHANGE) return bad(`เพิ่มได้ครั้งละไม่เกิน ${MAX_CHANGE} รหัส`)

  try {
    const added = await addIcd10(kind, codes)
    // คืนทะเบียนหลังเขียนเสมอ ให้หน้าจอยึดค่าจากฐานแทนที่จะเดาเอาจากที่กดไป —
    // รหัสที่ไม่มีใน icd101 จะไม่ถูกเพิ่ม และอาจมีคนอื่นแก้ทะเบียนพร้อมกันอยู่
    return Response.json({ success: true, added, selected: await listRegisteredIcd10(kind) })
  } catch (error) {
    console.error(`[his/rdu/registry/diagnosis/${kind}] เพิ่มไม่สำเร็จ:`, error)
    return Response.json(
      { success: false, message: 'เพิ่มรหัสวินิจฉัยไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}

/** เอารหัสออกจากทะเบียน — ส่ง codes มาคั่นด้วยจุลภาค */
export async function DELETE(
  request: Request,
  ctx: RouteContext<'/api/his/rdu/registry/diagnosis/[kind]'>,
) {
  const user = await requireRduUser()
  if (!user.ok) return denyRduUser(user.error)

  const { kind } = await ctx.params
  if (!isDiagnosisRegistry(kind)) return unknownRegistry()

  const ip = clientIp(request)
  const limited = rateLimit(
    `rdu-dx-del:${user.sub}:${ip}`,
    PER_IP_WRITE.limit,
    PER_IP_WRITE.windowSeconds,
  )
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'บันทึกถี่เกินไป กรุณารอสักครู่')
  }

  const codes = parseCodes(new URL(request.url).searchParams.get('codes'))
  if (codes.length === 0) return bad('กรุณาเลือกรหัสวินิจฉัย')
  if (codes.length > MAX_CHANGE) return bad(`เอาออกได้ครั้งละไม่เกิน ${MAX_CHANGE} รหัส`)

  try {
    const removed = await removeIcd10(kind, codes)
    return Response.json({ success: true, removed, selected: await listRegisteredIcd10(kind) })
  } catch (error) {
    console.error(`[his/rdu/registry/diagnosis/${kind}] เอาออกไม่สำเร็จ:`, error)
    return Response.json(
      { success: false, message: 'เอารหัสวินิจฉัยออกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
