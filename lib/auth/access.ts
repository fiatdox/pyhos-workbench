import 'server-only'

/**
 * จำกัดสิทธิ์เข้าใช้ระบบตามตำแหน่ง/วิชาชีพ (users.user_position_id)
 *
 * ตั้งค่าที่ .env — ALLOWED_USER_POSITION_IDS=3,7,12
 *
 * ไม่ได้เก็บไว้ในฐานข้อมูลเพราะเป็นการตัดสินใจระดับ "ใครเข้าระบบนี้ได้บ้าง"
 * ซึ่งควรอยู่กับการติดตั้งของแต่ละที่ และคนที่แก้ควรเป็นคนที่เข้าถึงเซิร์ฟเวอร์ได้
 * ไม่ใช่ผู้ใช้ในระบบ (ถ้าอยู่ในตาราง ใครที่แก้ตารางได้ก็เปิดสิทธิ์ให้ตัวเองได้)
 *
 * ดูรหัสตำแหน่งทั้งหมดได้จาก core_kon:
 *   SELECT user_position_id, position_name FROM user_positions ORDER BY user_position_id
 */

/**
 * รายการตำแหน่งที่อนุญาต — อ่านครั้งเดียวตอนโหลดโมดูล
 * (ค่าใน .env ไม่เปลี่ยนระหว่างที่เซิร์ฟเวอร์รันอยู่ ต้องรีสตาร์ทถึงมีผล)
 *
 * ไม่ได้ตั้ง = null = ไม่จำกัด ใครก็เข้าได้เหมือนเดิม
 * ตั้งเป็นค่าว่างก็ถือว่าไม่จำกัดเช่นกัน ไม่ใช่ "ห้ามทุกคน" — ตั้งค่าพลาดแล้ว
 * ล็อกทุกคนออกจากระบบรวมถึงผู้ดูแลเอง เป็นผลที่รุนแรงเกินกว่าจะให้เกิดจากช่องว่าง
 */
const ALLOWED_POSITION_IDS: Set<number> | null = parseAllowList('ALLOWED_USER_POSITION_IDS')

/**
 * ตำแหน่งที่เห็นเมนู DUE — DUE_USER_POSITION_IDS
 *
 * แยกจากรายการเข้าระบบเพราะเป็นคนละคำถาม: เข้าระบบได้ ไม่ได้แปลว่าต้องเห็นทุกงาน
 * ไม่ได้ตั้ง = ทุกคนที่เข้าระบบได้เห็นเมนูนี้ (พฤติกรรมเดิมก่อนมีการจำกัด)
 */
const DUE_POSITION_IDS: Set<number> | null = parseAllowList('DUE_USER_POSITION_IDS')

/**
 * ตำแหน่งที่เห็นเมนู RDU — RDU_USER_POSITION_IDS
 *
 * แยกจากรายการของ DUE ทั้งที่เป็นงานของกลุ่มงานเภสัชกรรมเหมือนกัน เพราะคนดู
 * คนละกลุ่ม: DUE เป็นงานประจำวันของคนอนุมัติคำขอ ส่วน RDU เป็นตัวชี้วัดที่
 * แพทย์และคณะกรรมการต้องเห็นด้วย การผูกไว้ด้วยกันแปลว่าเปิด RDU ให้ใคร
 * ก็ต้องเปิดให้เขาอนุมัติคำขอ DUE ไปด้วย ซึ่งไม่ใช่สิ่งที่ต้องการ
 *
 * ไม่ได้ตั้ง = ทุกคนที่เข้าระบบได้เห็นเมนูนี้ (เหมือนกติกาของ DUE)
 */
const RDU_POSITION_IDS: Set<number> | null = parseAllowList('RDU_USER_POSITION_IDS')

function parseAllowList(name: string): Set<number> | null {
  const raw = process.env[name]?.trim()
  if (!raw) return null

  const parts = raw
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)

  const ids = new Set<number>()
  const bad: string[] = []
  for (const part of parts) {
    const id = Number(part)
    // พิมพ์ผิดแล้วเงียบ = เปิดสิทธิ์ให้คนที่ไม่ควรได้ หรือปิดสิทธิ์คนที่ควรได้
    // โดยไม่มีใครรู้ จึงเลือกให้พังตั้งแต่ตอนเปิดระบบดีกว่า
    if (!Number.isInteger(id)) bad.push(part)
    else ids.add(id)
  }

  if (bad.length > 0) {
    throw new Error(
      `ค่า ${name} ต้องเป็นรหัสตำแหน่งตัวเลขคั่นด้วยจุลภาค — ค่าที่ผิด: ${bad.join(', ')}`,
    )
  }
  return ids.size > 0 ? ids : null
}

/** เปิดจำกัดสิทธิ์ตามตำแหน่งอยู่หรือไม่ */
export function positionRestrictionEnabled(): boolean {
  return ALLOWED_POSITION_IDS !== null
}

/**
 * ตำแหน่งนี้เข้าใช้ระบบได้หรือไม่
 *
 * บัญชีที่ไม่ได้ระบุตำแหน่ง (null) ถือว่าไม่ผ่านเมื่อเปิดการจำกัดไว้ —
 * ตรวจสอบวิชาชีพไม่ได้ก็ไม่ควรให้ผ่าน ไม่ใช่ปล่อยผ่านเพราะข้อมูลไม่ครบ
 */
export function isPositionAllowed(userPositionId: number | null | undefined): boolean {
  if (ALLOWED_POSITION_IDS === null) return true
  if (userPositionId == null) return false
  return ALLOWED_POSITION_IDS.has(userPositionId)
}

/**
 * ตำแหน่งนี้ใช้งานเมนู DUE ได้หรือไม่
 *
 * บัญชีที่ไม่ได้ระบุตำแหน่งถือว่าไม่ผ่านเมื่อเปิดการจำกัดไว้ ด้วยเหตุผลเดียวกับ
 * การเข้าระบบ — ตรวจไม่ได้ก็ไม่ควรให้ผ่าน
 */
export function canUseDue(userPositionId: number | null | undefined): boolean {
  if (DUE_POSITION_IDS === null) return true
  if (userPositionId == null) return false
  return DUE_POSITION_IDS.has(userPositionId)
}

/**
 * ตำแหน่งนี้ใช้งานเมนู RDU ได้หรือไม่ — กติกาเดียวกับ canUseDue คนละรายการ
 */
export function canUseRdu(userPositionId: number | null | undefined): boolean {
  if (RDU_POSITION_IDS === null) return true
  if (userPositionId == null) return false
  return RDU_POSITION_IDS.has(userPositionId)
}

/** ข้อความแจ้งผู้ใช้ — ไม่บอกว่ารายการที่อนุญาตมีอะไรบ้าง */
export const POSITION_DENIED_MESSAGE =
  'บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งานระบบ (ตำแหน่งไม่อยู่ในกลุ่มที่กำหนด) กรุณาติดต่อผู้ดูแลระบบ'
