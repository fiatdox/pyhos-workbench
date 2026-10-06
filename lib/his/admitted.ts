import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'

/**
 * ผู้ป่วยที่ยังนอนอยู่ตอนนี้ — ตึก แพทย์ และรายชื่อ
 *
 * แยกออกมาจาก lib/his/drug-profile.ts เพราะไม่ใช่เรื่องของ Drug Profile เอง
 * แต่เป็นคำถามพื้นฐานว่า "ตอนนี้ใครนอนอยู่ที่ไหน ใครเป็นเจ้าของไข้" ซึ่งหน้าอื่น
 * ก็ต้องใช้ตัวช่วยเลือกผู้ป่วยชุดเดียวกัน (หน้าขออนุมัติใช้ยา DUE เป็นรายแรก)
 *
 * ไม่ส่งเลขบัตรประชาชนกลับไปฝั่งหน้าเว็บ แม้จะใช้ค้นได้ก็ตาม
 */

/** ยังไม่จำหน่าย = ยังไม่มีวันจำหน่ายและยังไม่มีสถานะจำหน่าย */
export const STILL_ADMITTED = sql`i.dchdate IS NULL AND (i.dchstts IS NULL OR i.dchstts = '')`

/** ชื่อผู้ป่วยประกอบจาก 3 คอลัมน์ ใช้ซ้ำหลายคิวรี */
export const PATIENT_NAME = sql`CONCAT(p.pname, p.fname, ' ', p.lname)`

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v).trim() || null)
const num = (v: unknown): number | null => (v == null ? null : Number(v))

type Row = Record<string, unknown>

const rows = (result: unknown): Row[] => result as unknown as Row[]

export type WardOption = {
  ward: string
  name: string
  /** จำนวนผู้ป่วยที่ยังนอนอยู่ตอนนี้ */
  admitted: number
}

export type AdmittedPatient = {
  an: string
  hn: string
  name: string
  age: number | null
  /** '1' = ชาย, '2' = หญิง ตามรหัสของ HIS */
  sex: string | null
  ward: string
  wardName: string | null
/** เลขเตียงที่ลงไว้ตอนนี้ (iptadm.bedno) — null เมื่อยังไม่ได้ลงเตียง */
  bed: string | null
  admitDate: string | null
  /** จำนวนวันนอนถึงวันนี้ */
  los: number | null
  /** แพทย์ผู้สั่ง admit (ipt.admdoctor) — null เมื่อรหัสไม่ตรงกับทะเบียนแพทย์ */
  admitDoctor: string | null
  /** แพทย์เจ้าของไข้ (ipt.incharge_doctor) — คนละคนกับผู้สั่ง admit ได้ */
  inchargeDoctor: string | null
}

/** แพทย์หนึ่งคนที่มีผู้ป่วยนอนอยู่ตอนนี้ */
export type DoctorOption = {
  code: string
  name: string
  /** จำนวนผู้ป่วยที่ยังนอนอยู่ซึ่งแพทย์คนนี้เป็นเจ้าของไข้หรือเป็นคนสั่ง admit */
  admitted: number
}

export async function listWards(): Promise<WardOption[]> {
  const [result] = await hisDb.execute(sql`
    SELECT w.ward, w.name, COUNT(i.an) AS admitted
    FROM ward w
    LEFT OUTER JOIN ipt i ON i.ward = w.ward AND ${STILL_ADMITTED}
    WHERE w.ward_active = 'Y'
    GROUP BY w.ward, w.name
    ORDER BY w.ward`)

  return rows(result).map(row => ({
    ward: String(row.ward),
    name: String(row.name ?? '').trim(),
    admitted: Number(row.admitted ?? 0),
  }))
}

/**
 * คิวรีร่วมของรายชื่อผู้ที่ยังนอนอยู่ — ต่างกันแค่เงื่อนไข WHERE
 *
 * ipt มี index (dchstts, ward) อยู่แล้ว การกรองจึงไม่ไล่ทั้งตาราง
 *
 * เลขเตียงมาจาก iptadm ซึ่งเป็นการจองเตียงที่ยังมีผลอยู่ หนึ่งแถวต่อหนึ่ง AN
 * (an เป็น primary key) จึง LEFT JOIN ตรง ๆ ได้ ไม่ต้องหาแถวล่าสุด
 *
 * สามตารางที่เหลือใช้ไม่ได้: ipt.cur_bedno ว่างทั้ง 370 แถวของผู้ป่วยที่นอนอยู่
 * ipt_bed_stat ว่างเปล่าทั้งตาราง และ iptbedmove เป็นบันทึกการย้าย ไม่ใช่สถานะ
 * ปัจจุบัน — มีเลขเตียงแค่ 38% ของผู้ป่วยที่นอนอยู่ และในจำนวนที่มีทั้งสองที่
 * 30 จาก 139 แถวไม่ตรงกับ iptadm โดย iptadm เป็นฝ่ายถูก (เคสที่ย้ายไป MICU2
 * แล้ว iptbedmove ยังค้างเลขเตียงของอายุรกรรมชายไว้ตั้งแต่สองเดือนก่อน)
 *
 * ได้เลขเตียง 344 จาก 370 ราย (93%) ที่ขาดคือคนที่เพิ่งรับเข้ามาและยังไม่ลงเตียง
 * กระจายอยู่ในตึกศัลยกรรมเป็นส่วนใหญ่ ช่องที่ว่างคือ "ยังไม่ลงเตียง" ไม่ใช่
 * "ไม่มีเตียง" — หน้าจอต้องแสดงเป็นขีด ไม่ใช่เลขศูนย์
 *
 * เรียงตามตึกก่อนเสมอ — โหมดเลือกตึกมีตึกเดียวอยู่แล้วจึงไม่เปลี่ยนอะไร
 * ส่วนโหมดเลือกแพทย์คนไข้กระจายอยู่หลายตึก การจัดกลุ่มตามตึกช่วยให้เดินราวน์ได้
 */
async function listAdmitted(where: ReturnType<typeof sql>): Promise<AdmittedPatient[]> {
  const [result] = await hisDb.execute(sql`
    SELECT i.an, i.hn, ${PATIENT_NAME} AS ptname,
           TIMESTAMPDIFF(YEAR, p.birthday, CURDATE()) AS age, p.sex,
           i.ward, w.name AS ward_name,
           DATE_FORMAT(i.regdate, '%Y-%m-%d') AS regdate,
           DATEDIFF(CURDATE(), i.regdate) AS los,
           da.name AS adm_doctor, di.name AS inc_doctor,
           NULLIF(TRIM(ia.bedno), '') AS bedno
    FROM ipt i
    INNER JOIN patient p ON p.hn = i.hn
    LEFT OUTER JOIN ward w ON w.ward = i.ward
    LEFT OUTER JOIN doctor da ON da.code = i.admdoctor
    LEFT OUTER JOIN doctor di ON di.code = i.incharge_doctor
    LEFT OUTER JOIN iptadm ia ON ia.an = i.an
    WHERE ${where} AND ${STILL_ADMITTED}
    ORDER BY i.ward, i.regdate, i.an`)

  return rows(result).map(row => ({
    an: String(row.an),
    hn: String(row.hn ?? ''),
    name: String(row.ptname ?? '').trim(),
    age: num(row.age),
    sex: str(row.sex),
    ward: String(row.ward ?? ''),
    wardName: str(row.ward_name),
    bed: str(row.bedno),
    admitDate: str(row.regdate),
    los: num(row.los),
    admitDoctor: str(row.adm_doctor),
    inchargeDoctor: str(row.inc_doctor),
  }))
}

/** ผู้ป่วยที่ยังนอนอยู่ในตึกที่เลือก */
export async function listAdmittedInWard(ward: string): Promise<AdmittedPatient[]> {
  return listAdmitted(sql`i.ward = ${ward}`)
}

/**
 * ผู้ป่วยที่ยังนอนอยู่ของแพทย์เจ้าของไข้ที่เลือก
 *
 * เทียบกับ ipt.incharge_doctor เท่านั้น ไม่รวม admdoctor — HIS แยกสองช่องนี้ไว้
 * และตามที่ผู้ใช้ระบุ "แพทย์เจ้าของไข้" คือช่องแรก ส่วน admdoctor คือแพทย์ที่สั่ง
 * admit ซึ่งมักเป็นหมอเวรที่รับเคสเข้ามา ไม่ใช่คนที่ดูแลต่อ สองค่านี้ต่างกันใน
 * ผู้ป่วยส่วนใหญ่ที่นอนอยู่ตอนนี้ (207 จาก 341 ราย) การรวมสองช่องจึงไม่ใช่การ
 * "ได้ครบกว่า" แต่เป็นการตอบคำถามอื่น
 *
 * ตารางยังแสดงทั้งสองช่องไว้ จะได้เห็นว่าใครรับเคสเข้ามาแม้จะไม่ใช่ตัวกรอง
 */
export async function listAdmittedByDoctor(code: string): Promise<AdmittedPatient[]> {
  return listAdmitted(sql`i.incharge_doctor = ${code}`)
}

/**
 * แพทย์เจ้าของไข้ที่มีผู้ป่วยนอนอยู่ตอนนี้ พร้อมจำนวน
 *
 * ไม่ได้เอารายชื่อแพทย์ทั้งทะเบียน (active อยู่ราวหนึ่งพันสี่ร้อยคน) เพราะที่ใช้จริง
 * คือแพทย์ที่มีคนไข้นอนอยู่ ซึ่งมีราวหกสิบคน รายการยาวกว่านั้นเลือกยากโดยเปล่าประโยชน์
 *
 * ต้องใช้เงื่อนไขเดียวกับ listAdmittedByDoctor เสมอ — เลขในวงเล็บท้ายชื่อแพทย์
 * คือคำสัญญาว่ากดแล้วจะเจอกี่แถว ถ้าสองคิวรีนับไม่เหมือนกันจะกลายเป็นคำโกหก
 */
export async function listAdmittingDoctors(): Promise<DoctorOption[]> {
  const [result] = await hisDb.execute(sql`
    SELECT i.incharge_doctor AS code, d.name, COUNT(*) AS admitted
    FROM ipt i
    INNER JOIN doctor d ON d.code = i.incharge_doctor
    WHERE ${STILL_ADMITTED}
    GROUP BY i.incharge_doctor, d.name
    ORDER BY d.name`)

  return rows(result).map(row => ({
    code: String(row.code),
    name: String(row.name ?? '').trim(),
    admitted: Number(row.admitted ?? 0),
  }))
}
