import { denyRduUser, requireRduUser } from '@/lib/auth/rdu-user'
import {
  DUPLICATE_DEFAULT_PAIR_RULE,
  DUPLICATE_DEFAULT_WINDOW_DAYS,
  DUPLICATE_MAX_ICODES,
  DUPLICATE_MAX_RANGE_DAYS,
  DUPLICATE_MAX_WINDOW_DAYS,
  DUPLICATE_MIN_WINDOW_DAYS,
  isDuplicatePairRule,
  isDuplicateScope,
  isDuplicateUnit,
  listDuplicateDrugOptions,
  loadDuplicateReport,
} from '@/lib/his/rdu-duplicate'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * เครื่องมือค้นหาการใช้ยาซ้ำซ้อน
 *
 * GET  คืนรายการยาที่เปิดใช้งานทั้งหมด พร้อมเพดานที่ยอมรับ
 * POST ค้นตามชุดยาที่เลือก
 *
 * ทำไม POST ไม่ใช่ GET เหมือนรายงานอื่นทุกข้อในหมวดนี้:
 * ชุดยาที่ส่งมาเป็นรายการ ซึ่งยาวได้ถึง 606 ชื่อสามัญหรือ 1,092 รหัส ถ้าต่อเป็น
 * query string จะชน URL ยาวสุดของเบราว์เซอร์และของ proxy ระหว่างทาง รายงานอื่น
 * ส่งแค่ช่วงวันที่จึงเป็น GET ได้ — ไม่ได้เปลี่ยนข้อมูลอะไรทั้งสองเส้นทาง
 */

const PER_IP = { limit: 30, windowSeconds: 300 }

/** 'YYYY-MM-DD' */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const MS_PER_DAY = 86_400_000

/**
 * เพดานจำนวนรายการที่รับจากคำขอ ก่อนขยายชื่อสามัญเป็นรหัส
 *
 * กันคำขอที่ส่งรายการมามหาศาลให้ฐานต้องไปขยายก่อนจะรู้ว่าเกินเพดานรหัสอยู่ดี —
 * เพดานจริงของงานคือ DUPLICATE_MAX_ICODES ซึ่งตรวจหลังขยายแล้วใน lib
 */
const MAX_SELECTION = 300

function bad(message: string) {
  return Response.json({ success: false, message }, { status: 400 })
}

/** รายการสตริงที่สะอาดแล้ว — ตัดค่าว่าง ตัดซ้ำ และจำกัดความยาว */
function stringList(value: unknown): string[] | null {
  if (value == null) return []
  if (!Array.isArray(value)) return null
  const cleaned = value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(item => item !== '' && item.length <= 120)
  return [...new Set(cleaned)]
}

export async function GET() {
  const user = await requireRduUser()
  if (!user.ok) return denyRduUser(user.error)

  try {
    const drugs = await listDuplicateDrugOptions()
    /* ส่งเพดานกับค่าตั้งต้นไปด้วย ไม่ให้หน้าจอถือตัวเลขชุดเดียวกันไว้เอง —
       ถ้าวันหนึ่งเพดานเปลี่ยน หน้าจอกับเซิร์ฟเวอร์จะไม่เถียงกันเรื่องค่าที่ยอมรับ */
    return Response.json({
      success: true,
      drugs,
      maxIcodes: DUPLICATE_MAX_ICODES,
      defaultWindowDays: DUPLICATE_DEFAULT_WINDOW_DAYS,
      defaultPairRule: DUPLICATE_DEFAULT_PAIR_RULE,
      minWindowDays: DUPLICATE_MIN_WINDOW_DAYS,
      maxWindowDays: DUPLICATE_MAX_WINDOW_DAYS,
    })
  } catch (error) {
    console.error('[his/rdu/duplicate] อ่านรายการยาไม่สำเร็จ:', error)
    return Response.json(
      { success: false, message: 'อ่านรายการยาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  const user = await requireRduUser()
  if (!user.ok) return denyRduUser(user.error)

  const ip = clientIp(request)
  const limited = rateLimit(`rdu-dup:${user.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
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
  if ((end - start) / MS_PER_DAY + 1 > DUPLICATE_MAX_RANGE_DAYS) {
    return bad(`เลือกช่วงวันที่ได้ครั้งละไม่เกิน ${DUPLICATE_MAX_RANGE_DAYS} วัน`)
  }

  const generics = stringList(body.generics)
  const icodes = stringList(body.icodes)
  if (generics == null || icodes == null) return bad('รายการยาที่เลือกไม่ถูกต้อง')
  if (generics.length === 0 && icodes.length === 0) return bad('กรุณาเลือกยาอย่างน้อยหนึ่งรายการ')
  if (generics.length + icodes.length > MAX_SELECTION) {
    return bad(`เลือกยาได้ครั้งละไม่เกิน ${MAX_SELECTION} รายการ`)
  }

  /**
   * ความกว้างหน้าต่างของโหมดข้าม visit
   *
   * ไม่ใส่มา = ใช้ค่าตั้งต้น ไม่ใช่ error — คำขอเก่าที่ยังไม่รู้จักพารามิเตอร์นี้
   * ต้องได้พฤติกรรมเดิม ส่วนค่าที่ใส่มาต้องเป็นจำนวนเต็มในช่วงที่ยอมรับ
   * ค่าทศนิยมปฏิเสธไป ไม่ปัดให้เอง เพราะผู้ใช้ควรเห็นว่าค่าที่ส่งไม่ถูกรับ
   */
  let windowDays = DUPLICATE_DEFAULT_WINDOW_DAYS
  if (body.windowDays != null) {
    if (typeof body.windowDays !== 'number' || !Number.isInteger(body.windowDays)) {
      return bad('จำนวนวันของหน้าต่างต้องเป็นจำนวนเต็ม')
    }
    if (
      body.windowDays < DUPLICATE_MIN_WINDOW_DAYS ||
      body.windowDays > DUPLICATE_MAX_WINDOW_DAYS
    ) {
      return bad(
        `จำนวนวันของหน้าต่างต้องอยู่ระหว่าง ${DUPLICATE_MIN_WINDOW_DAYS} ถึง ${DUPLICATE_MAX_WINDOW_DAYS} วัน`,
      )
    }
    windowDays = body.windowDays
  }

  const unit = typeof body.unit === 'string' ? body.unit : ''
  const scope = typeof body.scope === 'string' ? body.scope : ''
  if (!isDuplicateUnit(unit)) return bad('หน่วยการนับไม่ถูกต้อง')
  if (!isDuplicateScope(scope)) return bad('ขอบเขตการนับไม่ถูกต้อง')

  /* ไม่ใส่มา = ใช้ค่าตั้งต้น เหมือน windowDays — คำขอเก่าที่ยังไม่รู้จักกฎนี้
     ต้องได้พฤติกรรมเดิม ซึ่งคือการนับเฉพาะคู่ที่หน่วยต่างกัน */
  const pairRule = body.pairRule == null ? DUPLICATE_DEFAULT_PAIR_RULE : body.pairRule
  if (typeof pairRule !== 'string' || !isDuplicatePairRule(pairRule)) {
    return bad('กฎการจับคู่ไม่ถูกต้อง')
  }

  try {
    const report = await loadDuplicateReport({
      from,
      to,
      generics,
      icodes,
      unit,
      scope,
      pairRule,
      windowDays,
    })
    return Response.json({ success: true, ...report })
  } catch (error) {
    /* เพดานจำนวนรหัสยาและจำนวนบรรทัดยาโยน Error ที่เขียนข้อความไว้ให้ผู้ใช้อ่าน
       แล้ว — ส่งข้อความนั้นกลับไปตรง ๆ เพราะบอกวิธีแก้ (แคบช่วงหรือลดยา) ส่วน
       ข้อผิดพลาดอื่นไม่ส่งรายละเอียดออกไป ไม่รู้ว่ามีอะไรติดมาด้วย */
    const known =
      error instanceof Error &&
      (error.message.startsWith('ชุดยาที่เลือกขยายเป็น') ||
        error.message.startsWith('ช่วงวันที่กับชุดยาที่เลือก'))
    if (known) return bad((error as Error).message)

    console.error('[his/rdu/duplicate] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'ค้นรายงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
