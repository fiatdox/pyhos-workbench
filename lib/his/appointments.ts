import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'

/**
 * ประวัตินัดหมาย (ตาราง oapp)
 *
 * หนึ่งแถวคือนัดหนึ่งครั้งที่ออกจากการมารับบริการครั้งหนึ่ง — คนไข้โรคเรื้อรัง
 * มีได้หลายร้อยนัด (คนที่มากที่สุดในฐานมี 2,319 นัด เฉลี่ยทั้งฐาน 15.8 นัดต่อคน)
 * จึงต้องทั้งจำกัดช่วงเวลาและจำกัดจำนวนแถว
 *
 * เอานัดข้างหน้ามาด้วย ไม่ใช่เฉพาะที่ผ่านมาแล้ว — คำถามที่เภสัชกรถามจริงตอน
 * จ่ายยาคือ "นัดหน้าเมื่อไร" เพื่อตัดสินว่าจ่ายยาพอถึงวันนัดหรือยัง ประวัติล้วน
 * ตอบคำถามนั้นไม่ได้
 */

export type Appointment = {
  id: number
  /** 'YYYY-MM-DD' วันนัด */
  date: string
  /** 'HH:mm' ช่วงเวลานัด — null เมื่อไม่ได้ระบุเวลา */
  timeFrom: string | null
  timeTo: string | null
  clinicName: string | null
  departmentName: string | null
  doctorName: string | null
  /** เหตุผลที่นัด เช่น ติดตามการรักษา / นัดทำหัตถการ */
  cause: string | null
  note: string | null
  /** วันที่ออกใบนัด (วันที่มารับบริการครั้งที่นัด) */
  issuedDate: string | null
  /** มีรายการตรวจแล็บสั่งไว้ล่วงหน้าในใบนัดนี้ */
  hasLab: boolean
  /** มีรายการเอกซเรย์สั่งไว้ล่วงหน้าในใบนัดนี้ */
  hasXray: boolean
  /** เป็นนัดที่ห้องผ่าตัด/วิสัญญี — ดูหมายเหตุที่ OPERATING_ROOM_CLINIC */
  hasOperation: boolean
  /** ชื่อรายการแล็บที่สั่งไว้ ใช้เป็นคำอธิบายกำกับเครื่องหมายถูก */
  labList: string | null
  /** ชื่อรายการเอกซเรย์ที่สั่งไว้ */
  xrayList: string | null
  /** สถานะที่คำนวณเอง ไม่ได้อ่านจาก oapp_status_id — ดูหมายเหตุที่ APPOINTMENT_STATUS */
  status: AppointmentStatus
}

/**
 * สถานะของนัดหนึ่งครั้ง
 *
 * คำนวณจากข้อมูลจริง ไม่ได้อ่านจากคอลัมน์ oapp_status_id เพราะโรงพยาบาลนี้
 * ไม่ได้ดูแลคอลัมน์นั้น — ในรอบหนึ่งปีมี 352,283 แถวค้างเป็น 'รอให้ถึงวันนัด'
 * ทั้งที่ 235,784 แถวในนั้นคนไข้มาแล้วเรียบร้อย ส่วนสถานะ 'มารับบริการแล้ว'
 * มีอยู่ 3 แถวทั้งปี ถ้าแสดงตามคอลัมน์นั้นหน้าจอจะบอกว่าแทบไม่มีใครมาตามนัดเลย
 *
 * ตัวที่เชื่อถือได้คือ visit_vn — เลขการมารับบริการที่มาปิดใบนัดนั้น ตรวจแล้ว
 * 57,226 จาก 58,414 แถว (98%) ชี้ไปที่ ovst จริง และ 57,219 แถวเป็นการมา
 * ในวันนัดนั้นพอดี ส่วนสถานะ 'ยกเลิก' (4) ใช้งานจริง 1,565 แถวต่อปี จึงเชื่อได้
 */
export const APPOINTMENT_STATUS = ['waiting', 'kept', 'missed', 'cancelled'] as const
export type AppointmentStatus = (typeof APPOINTMENT_STATUS)[number]

/** รหัสสถานะ 'ยกเลิก' ใน oapp_status — คอลัมน์เดียวของตารางนั้นที่ใช้งานจริง */
const CANCELLED_STATUS = 4

/**
 * คลินิกห้องผ่าตัด/วิสัญญี — ใช้เป็นเครื่องหมายว่านัดนี้คือนัดผ่าตัด
 *
 * ตาราง oapp มีช่อง operation_appointment มาให้อยู่แล้ว แต่ในฐานนี้ไม่เคยเป็น 'Y'
 * เลยแม้แถวเดียว (มีแต่ null กับ 'N') ส่วน operation_note ที่มี 173,389 แถวเก็บคำว่า
 * 'OperationNoteEdit' ซ้ำกันทุกแถว ซึ่งเป็นค่าตั้งต้นของหน้าจอ HOSxP ที่รั่วลงฐาน
 * ไม่ใช่ข้อมูล และตารางนัดผ่าตัดของ HOSxP (operation_schedule, operation_visit_list)
 * ว่างเปล่าทั้งคู่ — โรงพยาบาลนี้ไม่ได้ใช้โมดูลนั้น
 *
 * สิ่งที่เหลือและเชื่อถือได้คือคลินิกปลายทางของใบนัด นัดที่ส่งไปห้องผ่าตัด/วิสัญญี
 * มีราว 4,567 ใบต่อปี ซึ่งเป็นตัวเลขที่สมเหตุสมผลกับขนาดโรงพยาบาล
 *
 * รหัสนี้เป็นของโรงพยาบาลนี้ ไม่ใช่รหัสมาตรฐาน — ถ้าย้ายไปใช้ที่อื่นต้องแก้ค่านี้
 * (เทียบด้วยรหัส ไม่ใช่ชื่อคลินิก เพราะชุดอักขระของ HIS ไม่ใช่ utf8
 * การส่งข้อความไทยลงไปใน SQL จะเทียบไม่ตรง)
 */
const OPERATING_ROOM_CLINIC = '055'

/**
 * ช่วงเวลาที่เอามาแสดง นับจากวันนี้
 *
 * ตารางมีวันนัดเพี้ยนจากการพิมพ์ผิดอยู่ด้วย (เก่าสุด 2442 ใหม่สุด 2599) การจำกัด
 * ช่วงจึงกันแถวขยะออกไปในตัว ไม่ต้องมีเงื่อนไขแยก
 */
const PAST_YEARS = 3
const FUTURE_YEARS = 2

/** จำนวนนัดสูงสุดต่อผู้ป่วยหนึ่งคน — เอาวันที่ใกล้ที่สุดก่อน */
const MAX_APPOINTMENTS = 400

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v).trim() || null)

/** นัดอยู่ในช่วงที่เอามาแสดง — ใช้ซ้ำทั้งคิวรีนับและคิวรีดึงรายการ */
const IN_RANGE = sql`
  o.nextdate BETWEEN DATE_SUB(CURDATE(), INTERVAL ${sql.raw(String(PAST_YEARS))} YEAR)
                 AND DATE_ADD(CURDATE(), INTERVAL ${sql.raw(String(FUTURE_YEARS))} YEAR)`

/**
 * จำนวนนัดในช่วงที่แสดง ใช้ตัดสินว่าจะขึ้นปุ่มหรือไม่
 *
 * ต้องใช้เงื่อนไขชุดเดียวกับคิวรีที่ดึงรายการจริง ไม่งั้นเลขบนปุ่มกับจำนวนแถว
 * ที่กดเข้าไปเห็นจะไม่ตรงกัน
 */
export async function countAppointments(hn: string): Promise<number> {
  const [result] = await hisDb.execute(sql`
    SELECT COUNT(*) AS n FROM oapp o WHERE o.hn = ${hn} AND ${IN_RANGE}`)
  const rows = result as unknown as Record<string, unknown>[]
  return Math.min(Number(rows[0]?.n ?? 0), MAX_APPOINTMENTS)
}

export async function listAppointments(hn: string): Promise<Appointment[]> {
  const [result] = await hisDb.execute(sql`
    SELECT o.oapp_id,
           DATE_FORMAT(o.nextdate, '%Y-%m-%d') AS nextdate,
           TIME_FORMAT(o.nexttime, '%H:%i') AS nexttime,
           TIME_FORMAT(o.nexttime_end, '%H:%i') AS nexttime_end,
           DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS vstdate,
           c.name AS clinic_name,
           k.department AS department_name,
           d.name AS doctor_name,
           o.app_cause, o.note,
           o.oapp_status_id,
           NULLIF(TRIM(o.visit_vn), '') AS visit_vn,
           o.nextdate < CURDATE() AS is_past,
           NULLIF(TRIM(o.lab_list_text), '') AS lab_list,
           COALESCE(xr.items, NULLIF(TRIM(o.xray_list_text), '')) AS xray_list,
           o.clinic = ${OPERATING_ROOM_CLINIC} AS is_operation
    FROM oapp o
    LEFT OUTER JOIN clinic c ON c.clinic = o.clinic
    LEFT OUTER JOIN kskdepartment k ON k.depcode = o.depcode
    LEFT OUTER JOIN doctor d ON d.code = o.doctor
    LEFT OUTER JOIN (
      SELECT ox.oapp_id,
             GROUP_CONCAT(DISTINCT xi.xray_items_name ORDER BY xi.xray_items_name SEPARATOR ', ')
               AS items
      FROM oapp_xray ox
      INNER JOIN xray_items xi ON xi.xray_items_code = ox.xray_items_code
      WHERE ox.oapp_id IN (SELECT mine.oapp_id FROM oapp mine WHERE mine.hn = ${hn})
      GROUP BY ox.oapp_id
    ) xr ON xr.oapp_id = o.oapp_id
    WHERE o.hn = ${hn} AND ${IN_RANGE}
    ORDER BY o.nextdate DESC, o.nexttime DESC, o.oapp_id DESC
    LIMIT ${MAX_APPOINTMENTS}`)

  const rows = result as unknown as Record<string, unknown>[]

  return rows.map(row => {
    const labList = str(row.lab_list)
    const xrayList = str(row.xray_list)
    return {
      id: Number(row.oapp_id),
      date: String(row.nextdate),
      timeFrom: str(row.nexttime),
      timeTo: str(row.nexttime_end),
      clinicName: str(row.clinic_name),
      // ชื่อแผนกมีรหัสห้องต่อท้ายในวงเล็บเหลี่ยม ('ห้องตรวจ จักษุ [2301]')
      // ซึ่งเป็นรหัสภายในของ HIS ไม่ได้สื่ออะไรกับคนอ่าน
      departmentName: str(row.department_name)?.replace(/\s*\[[^\]]*\]\s*$/, '') ?? null,
      doctorName: str(row.doctor_name),
      cause: str(row.app_cause),
      note: str(row.note),
      issuedDate: str(row.vstdate),
      hasLab: labList != null,
      hasXray: xrayList != null,
      hasOperation: Number(row.is_operation ?? 0) === 1,
      labList,
      xrayList,
      status: statusOf({
        cancelled: Number(row.oapp_status_id ?? 0) === CANCELLED_STATUS,
        came: str(row.visit_vn) != null,
        past: Number(row.is_past ?? 0) === 1,
      }),
    }
  })
}

/**
 * ลำดับการตัดสินสถานะ — ยกเลิกมาก่อนทุกอย่าง
 *
 * ใบนัดที่ยกเลิกแล้วบางใบมี visit_vn ติดอยู่ (69 จาก 1,565 แถวในหนึ่งปี) เพราะ
 * คนไข้มาในวันนั้นด้วยเรื่องอื่น ถ้าเช็คการมาก่อนจะกลายเป็น 'มาตามนัด' ทั้งที่
 * ใบนัดถูกยกเลิกไปแล้ว
 */
function statusOf(input: { cancelled: boolean; came: boolean; past: boolean }): AppointmentStatus {
  if (input.cancelled) return 'cancelled'
  if (input.came) return 'kept'
  return input.past ? 'missed' : 'waiting'
}
