import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'
import { required } from '@/lib/db/env'

/**
 * ข้อมูลของงาน Health Rider (ส่งยาถึงบ้าน)
 *
 * ตาราง fiat_pyhos_* เป็นตารางที่สร้างเพิ่มไว้ในฐาน HIS ไม่ใช่ตารางของ HOSxP เอง
 * ส่วนนี้เขียนลงฐานจริง (เพิ่มเจ้าหน้าที่ เพิ่ม/ลบพื้นที่รับผิดชอบ) ต่างจากส่วน
 * อื่นของแอปที่อ่านอย่างเดียว — ทุกคำสั่งเขียนจึงต้องผูกกับเจ้าหน้าที่ที่ระบุมา
 */

/** ประเภทเจ้าหน้าที่ส่งยา (fiat_pyhos_health_rider_role) */
export type RiderRole = {
  id: number
  name: string | null
  /** คำนำหน้าที่ใช้แสดงคู่กับชื่อเจ้าหน้าที่ เช่น อสม. / จนท.รพ. */
  prefix: string | null
}

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v).trim() || null)

/** เจ้าหน้าที่ส่งยาหนึ่งคน (fiat_pyhos_health_rider_users) */
export type RiderStaff = {
  id: number
  pname: string | null
  fname: string | null
  lname: string | null
  /** 'Y' = ใช้งานอยู่ */
  active: string | null
  /** รหัสประเภท — หน้าจอใช้แยกผู้จัดการ (role 1) ออกจากผู้ส่งยา */
  roleId: number | null
  /** ชื่อประเภทจากตาราง role — null ถ้ารหัสประเภทไม่ตรงกับที่มีอยู่ */
  roleName: string | null
}

export async function listRiderRoles(): Promise<RiderRole[]> {
  const [result] = await hisDb.execute(sql`
    SELECT id, name, prefix
    FROM fiat_pyhos_health_rider_role
    ORDER BY id`)

  const rows = result as unknown as Record<string, unknown>[]

  return rows.map(row => ({
    id: Number(row.id),
    name: str(row.name),
    prefix: str(row.prefix),
  }))
}

/**
 * รายชื่อเจ้าหน้าที่ส่งยา
 *
 * เลือกเฉพาะคอลัมน์ที่หน้าจอใช้จริง — ตารางนี้เก็บเลขบัตรประชาชน เบอร์โทร
 * เลขบัญชีธนาคาร และรหัสผ่านไว้ด้วย ห้ามหลุดออกไปถึงเบราว์เซอร์
 * (คอลัมน์ username ก็ไม่เอา เพราะส่วนใหญ่ตั้งเป็นเลขบัตรประชาชน)
 *
 * ประเภทเจ้าหน้าที่ใช้ LEFT JOIN ไม่ใช่ INNER — คนที่รหัสประเภทไม่ตรงกับ
 * ตารางอ้างอิงต้องยังเห็นในรายชื่อ ไม่ใช่หายไปเงียบ ๆ
 */
export async function listRiderStaff(): Promise<RiderStaff[]> {
  const [result] = await hisDb.execute(sql`
    SELECT u.id, u.pname, u.fname, u.lname, u.active, u.role, r.name AS role_name
    FROM fiat_pyhos_health_rider_users u
    LEFT OUTER JOIN fiat_pyhos_health_rider_role r ON r.id = u.role
    ORDER BY u.id`)

  const rows = result as unknown as Record<string, unknown>[]

  return rows.map(row => ({
    id: Number(row.id),
    pname: str(row.pname),
    fname: str(row.fname),
    lname: str(row.lname),
    active: str(row.active),
    roleId: row.role == null ? null : Number(row.role),
    roleName: str(row.role_name),
  }))
}

/**
 * ปิด/เปิดสถานะใช้งานของเจ้าหน้าที่หนึ่งคน
 *
 * ไม่ลบแถวทิ้ง เพราะ id ถูกอ้างอิงอยู่ในตารางพื้นที่รับผิดชอบและประวัติการส่งยา
 * ลบแล้วข้อมูลเก่าจะชี้ไปยังคนที่ไม่มีอยู่ — ปิดสถานะจึงเป็นวิธีเอาคนออกจากงาน
 *
 * คืน false เมื่อไม่มีแถวไหนถูกแก้ (ไม่พบรหัสนั้น หรือค่าเดิมเป็นค่าเดียวกันอยู่แล้ว)
 */
export async function setRiderStaffActive(input: {
  id: number
  active: 'Y' | 'N'
}): Promise<boolean> {
  const [result] = await hisDb.execute(sql`
    UPDATE fiat_pyhos_health_rider_users
    SET active = ${input.active}
    WHERE id = ${input.id} AND (active IS NULL OR active <> ${input.active})`)

  return Number((result as unknown as { affectedRows?: number }).affectedRows ?? 0) > 0
}

/** ตำบลหนึ่งแห่งจากตารางที่อยู่มาตรฐานของ HIS (thaiaddress) */
export type Tambon = {
  /** รหัส 6 หลัก จังหวัด 2 + อำเภอ 2 + ตำบล 2 */
  id: string
  name: string
  /** 'ต.x อ.y จ.z' — ใช้แสดงให้เลือกไม่ผิดตำบลชื่อซ้ำ */
  fullName: string | null
}

/**
 * ตำบลที่ให้เลือกในหน้าจัดการพื้นที่ — เฉพาะอำเภอที่โรงพยาบาลรับผิดชอบ
 *
 * รหัสอำเภอ 4 หลัก (จังหวัด 2 + อำเภอ 2) อ่านจาก .env เพราะเป็นค่าเฉพาะของ
 * แต่ละที่ ไม่ใช่ค่ามาตรฐาน — ตั้งเป็นรหัสอื่นแล้วรายการตำบลเปลี่ยนตามทันที
 *
 * ที่ต้องจำกัดเพราะตารางที่อยู่มีตำบลทั้งประเทศราวเจ็ดพันแห่ง ส่งลงไปให้
 * เบราว์เซอร์ทั้งหมดทั้งที่ส่งยาแค่อำเภอเดียวไม่มีประโยชน์ และเลือกผิดง่ายด้วย
 */
export async function listRiderTambons(): Promise<Tambon[]> {
  const amphurId = required('HEALTH_RIDER_AMPHUR_ID')

  const [result] = await hisDb.execute(sql`
    SELECT a.addressid, a.name, a.full_name
    FROM thaiaddress a
    WHERE a.codetype = '3'
      AND LEFT(a.addressid, 4) = ${amphurId}
    ORDER BY a.addressid`)

  const rows = result as unknown as Record<string, unknown>[]

  return rows.map(row => ({
    id: String(row.addressid),
    name: String(row.name ?? '').trim(),
    fullName: str(row.full_name),
  }))
}

/** พื้นที่ที่เจ้าหน้าที่คนหนึ่งรับผิดชอบ หนึ่งแถวคือหนึ่งหมู่ */
export type RiderArea = {
  id: number
  tambonId: string | null
  /** ชื่อตำบลจาก thaiaddress — null ถ้ารหัสไม่ตรงกับตารางที่อยู่ */
  tambonName: string | null
  moo: string | null
  /** ป้ายชื่อพื้นที่ที่ผู้บันทึกเขียนไว้เอง บางแถวเป็นรายชื่อชุมชนคั่นจุลภาค */
  prefix: string | null
}

export async function listRiderAreas(riderId: number): Promise<RiderArea[]> {
  const [result] = await hisDb.execute(sql`
    SELECT s.id, s.tambon_id, s.moo, s.prefix, a.name AS tambon_name
    FROM fiat_pyhos_health_rider_send s
    LEFT OUTER JOIN thaiaddress a ON a.addressid = s.tambon_id AND a.codetype = '3'
    WHERE s.rider = ${riderId}
    -- moo เก็บเป็นข้อความ ถ้าเรียงตามตัวอักษรจะได้ 1, 10, 11, 2 จึงแปลงเป็นตัวเลขก่อน
    ORDER BY s.tambon_id, CAST(s.moo AS UNSIGNED), s.id`)

  const rows = result as unknown as Record<string, unknown>[]

  return rows.map(row => ({
    id: Number(row.id),
    tambonId: str(row.tambon_id),
    tambonName: str(row.tambon_name),
    moo: str(row.moo),
    prefix: str(row.prefix),
  }))
}

/**
 * เพิ่มพื้นที่รับผิดชอบให้เจ้าหน้าที่หนึ่งคน ทีละหลายหมู่ในตำบลเดียวกัน
 *
 * ตารางไม่มี unique key กันซ้ำ จึงต้องเช็คเองก่อนว่าคนนี้มีหมู่นั้นในตำบลนั้นแล้ว
 * ไม่งั้นกดสองครั้งจะได้แถวซ้ำที่ลบออกจากหน้านี้ไม่ได้
 *
 * คืนจำนวนที่เพิ่มจริงกับที่ข้ามเพราะซ้ำ เพื่อให้หน้าจอบอกผู้ใช้ได้ตรง
 */
export async function createRiderAreas(input: {
  rider: number
  tambonId: string
  moos: string[]
  prefix: string
}): Promise<{ added: number; skipped: string[] }> {
  const [existing] = await hisDb.execute(sql`
    SELECT moo FROM fiat_pyhos_health_rider_send
    WHERE rider = ${input.rider} AND tambon_id = ${input.tambonId}`)

  const taken = new Set(
    (existing as unknown as Record<string, unknown>[]).map(row => String(row.moo ?? '').trim()),
  )

  const skipped = input.moos.filter(moo => taken.has(moo))
  const toAdd = input.moos.filter(moo => !taken.has(moo))

  for (const moo of toAdd) {
    await hisDb.execute(sql`
      INSERT INTO fiat_pyhos_health_rider_send (rider, moo, tambon_id, prefix)
      VALUES (${input.rider}, ${moo}, ${input.tambonId}, ${input.prefix})`)
  }

  return { added: toAdd.length, skipped }
}

/**
 * ลบพื้นที่รับผิดชอบ ทีละแถวหรือหลายแถวพร้อมกัน
 *
 * เงื่อนไขผูก rider ไว้ด้วยทั้งที่ id เป็นคีย์หลักอยู่แล้ว — ถ้าหน้าจอส่ง id ที่ไม่ใช่
 * ของเจ้าหน้าที่ที่กำลังเปิดอยู่ จะไม่ลบอะไรเลยแทนที่จะลบแถวของคนอื่นทิ้ง
 *
 * ลบทั้งชุดในคำสั่งเดียว ไม่วนลบทีละแถว — ถ้าวนแล้วขาดกลางคัน จะเหลือสถานะที่
 * ลบไปแล้วครึ่งหนึ่งโดยที่หน้าจอไม่รู้ว่าครึ่งไหน
 *
 * คืนจำนวนแถวที่ถูกลบจริง ซึ่งอาจน้อยกว่าที่ส่งมาถ้ามีคนอื่นลบไปก่อนแล้ว
 */
export async function deleteRiderAreas(input: { ids: number[]; rider: number }): Promise<number> {
  if (input.ids.length === 0) return 0

  const list = sql.join(
    input.ids.map(id => sql`${id}`),
    sql`, `,
  )
  const [result] = await hisDb.execute(sql`
    DELETE FROM fiat_pyhos_health_rider_send
    WHERE rider = ${input.rider} AND id IN (${list})`)

  return Number((result as unknown as { affectedRows?: number }).affectedRows ?? 0)
}

/**
 * ตรวจเลขบัตรประชาชนด้วยหลักตรวจสอบหลักที่ 13
 *
 * คอลัมน์ cid เป็น unique key พิมพ์ผิดแล้วจะไปชนของคนอื่นหรือสร้างเลขที่ไม่มีจริง
 * ค้างไว้ในทะเบียน การตรวจตรงนี้จับเลขที่พิมพ์สลับหลักได้เกือบทั้งหมด
 */
export function isValidThaiCid(cid: string): boolean {
  if (!/^\d{13}$/.test(cid)) return false
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(cid[i]) * (13 - i)
  return (11 - (sum % 11)) % 10 === Number(cid[12])
}

export type NewRiderStaff = {
  pname: string
  fname: string
  lname: string
  cid: string
  role: number
}

export type CreateStaffResult =
  | { ok: true; id: number }
  | { ok: false; reason: 'duplicate_cid' | 'unknown_role' }

/**
 * เพิ่มเจ้าหน้าที่หนึ่งคน
 *
 * ไม่รับค่า id จากผู้ใช้ — คอลัมน์เป็น auto_increment ให้ฐานเป็นคนแจกเลข
 * ถ้าปล่อยให้กรอกเองจะไปชนกับเลขที่ฐานจะแจกให้แถวถัดไป
 *
 * active ตั้งเป็น 'Y' เสมอตามที่ตกลงกันไว้ ไม่ได้เปิดให้เลือก
 * username กับ password ปล่อยว่าง — คนที่เพิ่มจากหน้านี้จึงยังล็อกอินเข้าแอป
 * ฝั่งผู้ส่งยาไม่ได้ ต้องตกลงเรื่องการตั้งบัญชีก่อนถึงจะเติมสองช่องนี้ได้
 */
export async function createRiderStaff(input: NewRiderStaff): Promise<CreateStaffResult> {
  // เช็คก่อนเพื่อให้ได้ข้อความที่บอกสาเหตุจริง ไม่ใช่ error ของฐานดิบ ๆ
  // (ยังดัก error 1062 ซ้ำอีกชั้นที่ผู้เรียก เผื่อมีคนเพิ่มพร้อมกันพอดี)
  const [existing] = await hisDb.execute(sql`
    SELECT id FROM fiat_pyhos_health_rider_users WHERE cid = ${input.cid} LIMIT 1`)
  if ((existing as unknown as unknown[]).length > 0) return { ok: false, reason: 'duplicate_cid' }

  const [role] = await hisDb.execute(sql`
    SELECT id FROM fiat_pyhos_health_rider_role WHERE id = ${input.role} LIMIT 1`)
  if ((role as unknown as unknown[]).length === 0) return { ok: false, reason: 'unknown_role' }

  const [result] = await hisDb.execute(sql`
    INSERT INTO fiat_pyhos_health_rider_users
      (pname, fname, lname, cid, role, active, createdatetime)
    VALUES
      (${input.pname}, ${input.fname}, ${input.lname}, ${input.cid}, ${input.role}, 'Y', NOW())`)

  return { ok: true, id: Number((result as unknown as { insertId?: number }).insertId ?? 0) }
}
