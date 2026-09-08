import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'
import { serviceCodes } from '@/lib/his/service-codes'

/**
 * รายชื่อผู้ป่วยที่มีค่าบริการจัดส่งยาถึงบ้านในวันที่เลือก
 *
 * ตั้งต้นจาก opitemrece ซึ่งเป็นรายการค่าใช้จ่ายรายบรรทัดของแต่ละครั้งที่มารับ
 * บริการ — ยุบให้เหลือหนึ่งแถวต่อหนึ่ง vn ผู้ป่วยคนเดียวยังมีได้สองแถวในวันเดียว
 * ถ้ามารับบริการสองครั้ง (พบจริงในข้อมูล) เพราะเป็นคนละ vn กัน
 *
 * ส่งออกชื่อ HN อายุ ข้อมูลการมารับบริการ ที่อยู่ และเบอร์โทร — สองอย่างหลัง
 * จำเป็นกับงานนี้โดยตรง (ปลายทางที่ต้องไปส่ง และเบอร์ที่ต้องโทรนัดเวลา)
 * ส่วนเลขบัตรประชาชนยังคงไม่ส่งออก ถึงแม้ตาราง patient จะเก็บไว้ก็ตาม
 *
 * ผู้ส่งยากับผู้จัดการงานมาจากตารางจับคู่ fiat_pyhos_health_rider_trace ซึ่งอาจ
 * ยังไม่มีแถวของ vn นั้นถ้ายังไม่ได้จ่ายงาน จึงต่อแบบ LEFT JOIN ทั้งหมด
 */
export type DeliveryPatient = {
  vn: string
  hn: string
  name: string | null
  /** 'ชาย' / 'หญิง' — แปลงจากรหัสในฐานตั้งแต่ฝั่งเซิร์ฟเวอร์ */
  sex: string | null
  /** อายุ ณ วันที่มารับบริการ ไม่ใช่อายุวันนี้ */
  age: number | null
  /** เวลาที่มารับบริการ รูปแบบ HH:mm */
  visitTime: string | null
  pttypeName: string | null
  /**
   * เบอร์โทรตามทะเบียนผู้ป่วย — เอาไว้โทรนัดเวลาก่อนไปส่ง
   *
   * ส่งค่าดิบตามที่บันทึกไว้ ไม่จัดรูปแบบให้ เพราะหลายแถวเก็บสองเบอร์คั่นด้วย
   * เครื่องหมาย หรือมีหมายเหตุติดมาเช่น '(แม่)' ซึ่งเป็นข้อมูลที่คนโทรต้องเห็น
   */
  phone: string | null
  /** ที่อยู่ตามทะเบียนผู้ป่วย ประกอบเป็นข้อความบรรทัดเดียวไว้แล้ว */
  address: string | null
  /** รหัสตำบล 6 หลักและหมู่ของที่อยู่ — ใช้จับคู่กับพื้นที่รับผิดชอบของเจ้าหน้าที่ */
  tambonId: string | null
  tambonName: string | null
  moo: string | null
  /** รหัสเจ้าหน้าที่ที่รับไปส่ง — null เมื่อยังไม่ได้จ่ายงาน */
  riderId: number | null
  /** ชื่อเจ้าหน้าที่ที่รับไปส่ง — null ทั้งตอนยังไม่จ่ายงานและตอนหารหัสในทะเบียนไม่เจอ */
  riderName: string | null
  /** รหัสผู้จัดการที่จ่ายงานไว้ — หน้าจอใช้ตั้งค่าเริ่มต้นตอนเปิดแก้ */
  managerId: number | null
  managerName: string | null
  qty: number
  /** ค่าบริการรวมของแถวนั้น (บาท) */
  amount: number
}

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v).trim() || null)

/**
 * ประกอบที่อยู่เป็นข้อความบรรทัดเดียว
 *
 * ตาราง patient เก็บแยกเป็นบ้านเลขที่ หมู่ ถนน และรหัสตำบล/อำเภอ/จังหวัด
 * ส่วนชื่อตำบล-อำเภอ-จังหวัดมาจาก full_name ของตารางที่อยู่ ('ต.x อ.y จ.z')
 * ท่อนไหนว่างก็ข้ามไป จะได้ไม่เหลือคำว่า "หมู่" หรือ "ถ." ลอยอยู่โดด ๆ
 */
const joinAddress = (row: Record<string, unknown>): string | null => {
  // บางแถวใส่ '-' หรือ '0' ไว้แทนการเว้นว่าง ถ้าไม่กรองจะได้ที่อยู่ที่มี "ถ.-" ติดมา
  const filled = (value: unknown) => {
    const text = str(value)
    return text && text !== '-' && text !== '0' ? text : null
  }

  const moo = filled(row.moopart)
  const road = filled(row.road)
  const parts = [
    str(row.addrpart),
    moo && `ม.${moo}`,
    road && `ถ.${road}`,
    str(row.tambon_full) ?? str(row.tambon_name),
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(' ') : null
}

const sexLabel = (code: unknown): string | null => {
  const value = str(code)
  if (value === '1') return 'ชาย'
  if (value === '2') return 'หญิง'
  return null
}

/**
 * @param date วันที่มารับบริการ รูปแบบ 'YYYY-MM-DD' (ผู้เรียกตรวจรูปแบบมาแล้ว)
 *
 * เทียบ vstdate ตรง ๆ ไม่ใช้ DATE() ครอบ เพื่อให้ใช้ index ix_vstdate ได้
 * ส่วน patient/ovst/pttype ใช้ LEFT JOIN — แถวที่หาชื่อหรือสิทธิ์ไม่เจอต้องยัง
 * แสดงอยู่ ไม่ใช่หายไปเงียบ ๆ จนรายชื่อขาดคนไปโดยไม่มีใครรู้
 */
export async function listDrugDeliveryPatients(date: string): Promise<DeliveryPatient[]> {
  const [result] = await hisDb.execute(sql`
    SELECT o.vn, o.hn, SUM(o.qty) AS qty, SUM(o.sum_price) AS sum_price,
           CONCAT(IFNULL(p.pname, ''), IFNULL(p.fname, ''), ' ', IFNULL(p.lname, '')) AS ptname,
           p.sex,
           TIMESTAMPDIFF(YEAR, p.birthday, o.vstdate) AS age,
           TIME_FORMAT(v.vsttime, '%H:%i') AS visit_time,
           t.name AS pttype_name,
           -- เบอร์บ้านเป็นช่องหลักที่ห้องบัตรกรอก (มีอยู่ราว 97% ของผู้ป่วยส่งยา)
           -- ส่วน mobile_phone_number มีน้อยแต่เติมเคสที่ช่องหลักว่างได้อีกเล็กน้อย
           NULLIF(TRIM(p.hometel), '') AS hometel,
           NULLIF(TRIM(p.mobile_phone_number), '') AS mobile,
           p.addrpart, p.moopart, p.road,
           CONCAT(p.chwpart, p.amppart, p.tmbpart) AS tambon_id,
           addr.name AS tambon_name, addr.full_name AS tambon_full,
           tr.rider AS rider_id, tr.manager AS manager_id,
           CONCAT_WS(' ', ru.pname, ru.fname, ru.lname) AS rider_name,
           CONCAT_WS(' ', mu.pname, mu.fname, mu.lname) AS manager_name
    FROM opitemrece o
    LEFT OUTER JOIN patient p ON p.hn = o.hn
    LEFT OUTER JOIN ovst v ON v.vn = o.vn
    LEFT OUTER JOIN pttype t ON t.pttype = o.pttype
    -- คอลัมน์ addressid ในทะเบียนผู้ป่วยว่างทั้งหมด ต้องประกอบรหัส 6 หลักเอง
    -- จากจังหวัด 2 + อำเภอ 2 + ตำบล 2 (codetype '3' คือระดับตำบล)
    LEFT OUTER JOIN thaiaddress addr
      ON addr.addressid = CONCAT(p.chwpart, p.amppart, p.tmbpart) AND addr.codetype = '3'
    -- ตารางจับคู่ว่าใครเป็นคนเอายาไปส่ง หนึ่ง vn ต่อหนึ่งแถว (vn เป็น unique key)
    -- ทั้ง rider และ manager อ้างถึง id ในทะเบียนเจ้าหน้าที่ตารางเดียวกัน
    LEFT OUTER JOIN fiat_pyhos_health_rider_trace tr ON tr.vn = o.vn
    LEFT OUTER JOIN fiat_pyhos_health_rider_users ru ON ru.id = tr.rider
    LEFT OUTER JOIN fiat_pyhos_health_rider_users mu ON mu.id = tr.manager
    WHERE o.icode = ${serviceCodes.drugDelivery}
      AND o.vstdate = ${date}
    -- ยุบเป็นหนึ่งแถวต่อหนึ่งครั้งที่มารับบริการ ถ้าครั้งเดียวมีค่าบริการนี้หลายบรรทัด
    -- จะได้ไม่แสดงชื่อคนเดิมซ้ำ ๆ และ vn ใช้เป็นคีย์ของแถวได้จริง
    GROUP BY o.vn, o.hn, p.pname, p.fname, p.lname, p.sex, p.birthday, o.vstdate,
             v.vsttime, t.name, p.hometel, p.mobile_phone_number,
             p.addrpart, p.moopart, p.road, p.chwpart, p.amppart, p.tmbpart,
             addr.name, addr.full_name,
             tr.rider, tr.manager, ru.pname, ru.fname, ru.lname, mu.pname, mu.fname, mu.lname
    ORDER BY v.vsttime, o.hn`)

  const rows = result as unknown as Record<string, unknown>[]

  return rows.map(row => ({
    vn: String(row.vn ?? ''),
    hn: String(row.hn ?? ''),
    name: str(row.ptname),
    sex: sexLabel(row.sex),
    // อายุติดลบหรือว่างแปลว่าวันเกิดในฐานผิด แสดงเป็นไม่ทราบดีกว่าแสดงเลขที่ผิด
    age: row.age == null || Number(row.age) < 0 ? null : Number(row.age),
    visitTime: str(row.visit_time),
    pttypeName: str(row.pttype_name),
    phone: str(row.hometel) ?? str(row.mobile),
    address: joinAddress(row),
    // รหัสตำบลต้องครบ 6 หลักถึงจะเทียบกับพื้นที่รับผิดชอบได้ ที่อยู่ที่กรอกไม่ครบ
    // จะได้สตริงสั้นกว่านั้น ถือว่าไม่มีรหัสไปเลยดีกว่าเอาไปจับคู่ผิด
    tambonId: /^\d{6}$/.test(String(row.tambon_id ?? '')) ? String(row.tambon_id) : null,
    tambonName: str(row.tambon_name),
    moo: str(row.moopart),
    riderId: row.rider_id == null ? null : Number(row.rider_id),
    riderName: str(row.rider_name),
    // คอลัมน์ manager เก็บเป็นข้อความ แต่ค่าที่ใช้จริงเป็นรหัสในทะเบียนเจ้าหน้าที่
    managerId: Number.isInteger(Number(row.manager_id)) ? Number(row.manager_id) : null,
    managerName: str(row.manager_name),
    qty: Number(row.qty ?? 0),
    amount: Number(row.sum_price ?? 0),
  }))
}

/** คู่ (ตำบล, หมู่) ที่เจ้าหน้าที่คนหนึ่งรับผิดชอบ ใช้แนะนำผู้ส่งยาตอนจ่ายงาน */
export type RiderCoverage = {
  riderId: number
  tambonId: string
  moo: string
}

/**
 * พื้นที่รับผิดชอบทั้งหมดในรูปแบบที่หน้าจอเอาไปจับคู่กับที่อยู่ผู้ป่วยได้ทันที
 *
 * ส่งทั้งชุดไปให้หน้าจอครั้งเดียว (หลักร้อยแถว) แทนการถามทีละราย เพราะการจ่ายงาน
 * หนึ่งวันต้องจับคู่หลายสิบราย ถ้าถามรายคนจะยิงคำขอเป็นสิบ ๆ ครั้งโดยไม่จำเป็น
 *
 * เอาเฉพาะคนที่ยังใช้งานอยู่ — คนที่ปิดสถานะไปแล้วไม่ควรถูกแนะนำให้จ่ายงานใหม่
 */
export async function listRiderCoverage(): Promise<RiderCoverage[]> {
  const [result] = await hisDb.execute(sql`
    SELECT s.rider, s.tambon_id, s.moo
    FROM fiat_pyhos_health_rider_send s
    JOIN fiat_pyhos_health_rider_users u ON u.id = s.rider AND u.active = 'Y'
    WHERE s.tambon_id IS NOT NULL AND s.moo IS NOT NULL`)

  const rows = result as unknown as Record<string, unknown>[]

  return rows.map(row => ({
    riderId: Number(row.rider),
    tambonId: String(row.tambon_id).trim(),
    moo: String(row.moo).trim(),
  }))
}

/**
 * ค่าที่เขียนลงคอลัมน์สถานะตอนจ่ายงาน
 *
 * ข้อมูลเดิมทั้งตาราง (หกพันกว่าแถว) เป็น status '1' และ riderstatus '4' เหมือนกัน
 * หมด ยังไม่มีเอกสารว่าค่าอื่นแปลว่าอะไร จึงเขียนค่าเดียวกับของเดิมไว้ก่อน เพื่อให้
 * แถวที่จ่ายจากหน้านี้กับที่จ่ายจากระบบเดิมอยู่ในสถานะเดียวกัน
 */
const ASSIGN_STATUS = { status: '1', riderStatus: '4' }

export type AssignResult = { ok: true } | { ok: false; reason: 'unknown_vn' | 'unknown_staff' }

/**
 * จับคู่ผู้ส่งยาและผู้จัดการให้การมารับบริการหนึ่งครั้ง
 *
 * ตรวจก่อนว่า vn นั้นมีค่าบริการจัดส่งยาจริง — ไม่งั้นหน้าจอที่ส่ง vn ผิดมาจะสร้าง
 * แถวจ่ายงานให้คนที่ไม่ได้สั่งส่งยา และตรวจว่าทั้งผู้ส่งยาและผู้จัดการมีอยู่ในทะเบียน
 *
 * คอลัมน์ vn เป็น unique key จึงใช้ ON DUPLICATE KEY UPDATE — จ่ายงานซ้ำคือการ
 * เปลี่ยนคนส่ง ไม่ใช่การเพิ่มแถวใหม่ และไม่ต้องมีรอบตรวจว่ามีอยู่แล้วหรือยัง
 */
export async function assignDelivery(input: {
  vn: string
  rider: number
  manager: number
}): Promise<AssignResult> {
  const [visit] = await hisDb.execute(sql`
    SELECT 1 FROM opitemrece
    WHERE vn = ${input.vn} AND icode = ${serviceCodes.drugDelivery} LIMIT 1`)
  if ((visit as unknown as unknown[]).length === 0) return { ok: false, reason: 'unknown_vn' }

  const [staff] = await hisDb.execute(sql`
    SELECT COUNT(*) AS n FROM fiat_pyhos_health_rider_users
    WHERE id IN (${input.rider}, ${input.manager})`)
  const found = Number((staff as unknown as Record<string, unknown>[])[0]?.n ?? 0)
  // เท่ากับ 2 เมื่อเป็นคนละคน ส่วน 1 คือกรณีจ่ายงานให้ตัวเอง ซึ่งไม่ได้ห้ามไว้
  const expected = input.rider === input.manager ? 1 : 2
  if (found !== expected) return { ok: false, reason: 'unknown_staff' }

  await hisDb.execute(sql`
    INSERT INTO fiat_pyhos_health_rider_trace
      (vn, rider, manager, status, riderstatus, createdatetime)
    VALUES
      (${input.vn}, ${input.rider}, ${input.manager},
       ${ASSIGN_STATUS.status}, ${ASSIGN_STATUS.riderStatus}, NOW())
    ON DUPLICATE KEY UPDATE
      rider = VALUES(rider), manager = VALUES(manager),
      status = VALUES(status), riderstatus = VALUES(riderstatus),
      createdatetime = NOW()`)

  return { ok: true }
}

export type CancelResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'has_progress' }

/**
 * ยกเลิกการจ่ายงานของการมารับบริการหนึ่งครั้ง — ลบแถวจับคู่ทิ้งทั้งแถว
 *
 * ไม่ยอมลบเมื่อแถวนั้นมีร่องรอยว่างานเดินไปแล้ว (เวลารับของ เวลาส่งถึง หรือรูป
 * หลักฐาน) เพราะนั่นคือบันทึกว่าเกิดอะไรขึ้นจริง ไม่ใช่แค่การมอบหมายที่แก้ได้
 * — เคสแบบนั้นต้องไปคุยกันว่าจะแก้ข้อมูลอย่างไร ไม่ใช่ลบจากหน้าจอนี้
 */
export async function cancelDelivery(vn: string): Promise<CancelResult> {
  const [existing] = await hisDb.execute(sql`
    SELECT recievedatetime, senddatetime, img
    FROM fiat_pyhos_health_rider_trace WHERE vn = ${vn} LIMIT 1`)

  const row = (existing as unknown as Record<string, unknown>[])[0]
  if (!row) return { ok: false, reason: 'not_found' }
  if (row.recievedatetime != null || row.senddatetime != null || str(row.img) != null) {
    return { ok: false, reason: 'has_progress' }
  }

  await hisDb.execute(sql`
    DELETE FROM fiat_pyhos_health_rider_trace WHERE vn = ${vn}`)

  return { ok: true }
}

/** จำนวนรายการส่งยาแยกตามวัน ใช้บอกว่าช่วงนี้วันไหนมีงานบ้างก่อนเลือกวัน */
export type DeliveryDay = {
  date: string
  /** จำนวนผู้ป่วย (นับ HN ไม่ซ้ำ) ไม่ใช่จำนวนแถว */
  patients: number
}

export async function listDrugDeliveryDays(from: string, to: string): Promise<DeliveryDay[]> {
  const [result] = await hisDb.execute(sql`
    SELECT DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS day, COUNT(DISTINCT o.hn) AS patients
    FROM opitemrece o
    WHERE o.icode = ${serviceCodes.drugDelivery}
      AND o.vstdate BETWEEN ${from} AND ${to}
    GROUP BY o.vstdate
    ORDER BY o.vstdate`)

  const rows = result as unknown as Record<string, unknown>[]

  return rows.map(row => ({ date: String(row.day), patients: Number(row.patients ?? 0) }))
}
