import { denyRduUser, requireRduUser } from '@/lib/auth/rdu-user'
import {
  addDrugs,
  isDrugRegistry,
  listDrugCandidates,
  listRegisteredDrugs,
  removeDrugs,
} from '@/lib/his/rdu-registry'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * ทะเบียนรายการยาของตัวชี้วัด RDU — เส้นทางเดียวรับทุกทะเบียน
 *
 * [kind] คือชื่อทะเบียน (inhaler, ri-antibiotic) ตรวจกับรายชื่อที่รู้จักใน
 * lib/his/rdu-registry.ts ก่อนเสมอ — ค่าที่ไม่อยู่ในรายชื่อตอบ 404 ไม่ใช่ปล่อยให้
 * ไปถึงคิวรี เพราะชื่อทะเบียนถูกแปลงเป็นชื่อตารางในคิวรีโดยตรง
 *
 * ใช้ด่านตรวจของงาน RDU (RDU_USER_POSITION_IDS)
 *
 * GET คืนทั้งรายการยาที่เลือกได้และรหัสที่อยู่ในทะเบียนในคำขอเดียว — หน้าจอ
 * ต้องใช้ทั้งสองอย่างพร้อมกันเสมอ ถ้าแยกสองเส้นทางแล้วอันหนึ่งล้มเหลว หน้าจอจะ
 * แสดงช่องขวาว่างทั้งที่ทะเบียนมีข้อมูลอยู่ ซึ่งชวนให้เลือกซ้ำเข้าไปใหม่
 */

const PER_IP = { limit: 60, windowSeconds: 300 }
// การตั้งค่าทำไม่บ่อย และหนึ่งคำขอย้ายได้หลายรายการอยู่แล้ว
const PER_IP_WRITE = { limit: 60, windowSeconds: 300 }

/** จำนวนรหัสยาสูงสุดต่อการเพิ่ม/ลบหนึ่งครั้ง — กันยิงชุดใหญ่จนล็อกตารางนาน */
const MAX_CHANGE = 200

/** icode ในฐานเป็น varchar(7) ตัวเลขล้วน ยาวกว่านี้ฐานจะตัดทิ้งเงียบ ๆ */
const ICODE_PATTERN = /^[A-Za-z0-9]{1,7}$/

function bad(message: string) {
  return Response.json({ success: false, message }, { status: 400 })
}

function unknownRegistry() {
  return Response.json({ success: false, message: 'ไม่พบทะเบียนที่ระบุ' }, { status: 404 })
}

/** อ่านรายการ icode ที่รับมา — ตัดค่าซ้ำและค่าที่ผิดรูปแบบทิ้ง */
function parseIcodes(values: unknown): string[] {
  const list = Array.isArray(values) ? values : String(values ?? '').split(',')
  return [
    ...new Set(list.map(value => String(value).trim()).filter(value => ICODE_PATTERN.test(value))),
  ]
}

export async function GET(request: Request, ctx: RouteContext<'/api/his/rdu/registry/drug/[kind]'>) {
  const user = await requireRduUser()
  if (!user.ok) return denyRduUser(user.error)

  const { kind } = await ctx.params
  if (!isDrugRegistry(kind)) return unknownRegistry()

  const ip = clientIp(request)
  const limited = rateLimit(`rdu-drug:${user.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'เรียกบ่อยเกินไป กรุณารอสักครู่')
  }

  try {
    const [drugs, selected] = await Promise.all([
      listDrugCandidates(kind),
      listRegisteredDrugs(kind),
    ])
    return Response.json({ success: true, drugs, selected })
  } catch (error) {
    console.error(`[his/rdu/registry/drug/${kind}] ล้มเหลว:`, error)
    return Response.json(
      { success: false, message: 'ดึงทะเบียนรายการยาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}

/** เพิ่มยาเข้าทะเบียน — ทีละหลายรายการต่อหนึ่งคำขอ */
export async function POST(
  request: Request,
  ctx: RouteContext<'/api/his/rdu/registry/drug/[kind]'>,
) {
  const user = await requireRduUser()
  if (!user.ok) return denyRduUser(user.error)

  const { kind } = await ctx.params
  if (!isDrugRegistry(kind)) return unknownRegistry()

  const ip = clientIp(request)
  const limited = rateLimit(
    `rdu-drug-add:${user.sub}:${ip}`,
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

  const icodes = parseIcodes(body.icodes)
  if (icodes.length === 0) return bad('กรุณาเลือกรายการยา')
  if (icodes.length > MAX_CHANGE) return bad(`เพิ่มได้ครั้งละไม่เกิน ${MAX_CHANGE} รายการ`)

  try {
    const added = await addDrugs(kind, icodes)
    // คืนทะเบียนหลังเขียนเสมอ ให้หน้าจอยึดค่าจากฐานแทนที่จะเดาเอาจากที่กดไป —
    // รหัสที่ไม่มีใน drugitems จะไม่ถูกเพิ่ม และอาจมีคนอื่นแก้ทะเบียนพร้อมกันอยู่
    return Response.json({ success: true, added, selected: await listRegisteredDrugs(kind) })
  } catch (error) {
    console.error(`[his/rdu/registry/drug/${kind}] เพิ่มไม่สำเร็จ:`, error)
    return Response.json(
      { success: false, message: 'เพิ่มรายการยาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}

/** เอายาออกจากทะเบียน — ส่ง icodes มาคั่นด้วยจุลภาค */
export async function DELETE(
  request: Request,
  ctx: RouteContext<'/api/his/rdu/registry/drug/[kind]'>,
) {
  const user = await requireRduUser()
  if (!user.ok) return denyRduUser(user.error)

  const { kind } = await ctx.params
  if (!isDrugRegistry(kind)) return unknownRegistry()

  const ip = clientIp(request)
  const limited = rateLimit(
    `rdu-drug-del:${user.sub}:${ip}`,
    PER_IP_WRITE.limit,
    PER_IP_WRITE.windowSeconds,
  )
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'บันทึกถี่เกินไป กรุณารอสักครู่')
  }

  const icodes = parseIcodes(new URL(request.url).searchParams.get('icodes'))
  if (icodes.length === 0) return bad('กรุณาเลือกรายการยา')
  if (icodes.length > MAX_CHANGE) return bad(`เอาออกได้ครั้งละไม่เกิน ${MAX_CHANGE} รายการ`)

  try {
    const removed = await removeDrugs(kind, icodes)
    return Response.json({ success: true, removed, selected: await listRegisteredDrugs(kind) })
  } catch (error) {
    console.error(`[his/rdu/registry/drug/${kind}] เอาออกไม่สำเร็จ:`, error)
    return Response.json(
      { success: false, message: 'เอารายการยาออกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
