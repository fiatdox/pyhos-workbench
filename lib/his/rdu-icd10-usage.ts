import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'

/**
 * จำนวนครั้งที่แต่ละรหัส ICD-10 ถูกใช้จริงใน 12 เดือนล่าสุด
 *
 * ทำไมต้องมี: หน้าตั้งค่าทะเบียนวางรหัสหมวด (สามหลัก) ปนกับรหัสย่อยที่หมอลงจริง
 * โดยไม่มีอะไรบอกว่าอันไหนเป็นอันไหน แล้วระบบเทียบรหัสแบบตรงตัว — ใส่ S00 ไว้
 * จึงไม่แมตช์ S000 ที่หมอลงจริง ตัวชี้วัดกลายเป็นศูนย์โดยไม่มีอะไรเตือน
 * เรื่องนี้เกิดขึ้นจริงกับทะเบียน APL: ตัวหารร่วงจาก 266 ครั้งเหลือ 1 ครั้ง
 * ตัวเลขการใช้จริงข้างรหัสทำให้เห็นตั้งแต่ก่อนกดบันทึกว่ารหัสไหนไม่มีใครใช้
 *
 * ทำไมต้องแคช: การนับต้องกวาด ovstdiag ทั้งปี (1.19 ล้านแถว) ซึ่งใช้เวลาราว
 * ห้าวินาที ถ้านับสดทุกครั้งที่เปิดหน้าหรือพิมพ์ค้น หน้าตั้งค่าจะใช้งานไม่ได้เลย
 * เก็บเป็นตารางเล็ก ๆ แล้ว join ตอนแสดงผลจึงแทบไม่มีค่าใช้จ่าย
 *
 * ตัวเลขไม่ต้องสดถึงนาที — ใช้ตัดสินว่ารหัสไหน "มีคนใช้" กับ "ไม่มีใครใช้"
 * ซึ่งเป็นคำตอบที่ไม่เปลี่ยนภายในวันเดียว คำนวณใหม่วันละครั้งจึงพอ
 */

/** นับย้อนหลังกี่วัน — หนึ่งปีเต็ม ให้ครอบคลุมโรคตามฤดูกาลทุกโรค */
const WINDOW_DAYS = 365

/** เก่ากว่านี้ (ชั่วโมง) ถือว่าต้องคำนวณใหม่ */
const MAX_AGE_HOURS = 24

const rows = (result: unknown) => result as unknown as Record<string, unknown>[]

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v).trim() || null)

/**
 * คำนวณใหม่ทั้งตาราง
 *
 * สร้างใหม่ทั้งชุดแทนการอัปเดตทีละแถว เพราะรหัสที่เลิกใช้ไปแล้วต้องหายออกจาก
 * ตาราง ไม่ใช่ค้างอยู่ด้วยตัวเลขของปีที่แล้ว
 *
 * ฝั่งผู้ป่วยในต้องอ่านวันที่จาก an_stat เพราะ iptdiag ไม่มีคอลัมน์วันที่เลย
 * ถ้าไม่นับฝั่งนี้ด้วย รหัสอย่าง O800 (การคลอดปกติ) จะขึ้นว่าไม่มีใครใช้
 * ทั้งที่เป็นรหัสหลักของตัวชี้วัด NL ซึ่งนับจากผู้ป่วยในล้วน
 *
 * ทำเป็นสองคำสั่ง (ลบแล้วเติม) ไม่ได้ใช้ transaction — ระหว่างนั้นหน้าตั้งค่า
 * ที่เปิดพร้อมกันจะเห็นตัวเลขว่างชั่วครู่ ซึ่งไม่เสียหายเท่ากับการล็อกตาราง
 */
export async function refreshIcd10Usage(): Promise<void> {
  await hisDb.execute(sql`DELETE FROM pyhos_icd10_usage`)
  await hisDb.execute(sql`
    INSERT INTO pyhos_icd10_usage (icd10, opd_uses, ipd_uses, computed_at)
    SELECT u.icd10, SUM(u.opd), SUM(u.ipd), NOW() FROM (
      SELECT d.icd10, COUNT(*) AS opd, 0 AS ipd
        FROM ovstdiag d
       WHERE d.vstdate >= DATE_SUB(CURDATE(), INTERVAL ${WINDOW_DAYS} DAY)
       GROUP BY d.icd10
      UNION ALL
      SELECT d.icd10, 0, COUNT(*)
        FROM iptdiag d
        JOIN an_stat a ON a.an = d.an
       WHERE a.regdate >= DATE_SUB(CURDATE(), INTERVAL ${WINDOW_DAYS} DAY)
       GROUP BY d.icd10) u
     WHERE u.icd10 IS NOT NULL AND u.icd10 <> ''
     GROUP BY u.icd10`)
}

/**
 * คำนวณใหม่ถ้าค้างนานเกินไป แล้วคืนเวลาที่คำนวณล่าสุด
 *
 * คืน null เมื่อคำนวณไม่สำเร็จ — หน้าตั้งค่ายังต้องเปิดได้แม้ตัวเลขการใช้จะไม่มา
 * เพราะงานหลักของหน้านั้นคือการเลือกรหัส ไม่ใช่การดูสถิติ ถ้าปล่อยให้ error
 * ลอยขึ้นไป คนตั้งค่าจะทำงานไม่ได้เลยเพราะของประกอบพัง
 */
export async function ensureIcd10Usage(): Promise<string | null> {
  try {
    const [result] = await hisDb.execute(sql`
      SELECT DATE_FORMAT(MAX(computed_at), '%Y-%m-%d %H:%i') AS computed_at,
             TIMESTAMPDIFF(HOUR, MAX(computed_at), NOW()) AS age_hours
        FROM pyhos_icd10_usage`)

    const row = rows(result)[0] ?? {}
    const age = row.age_hours == null ? null : Number(row.age_hours)
    if (age != null && age < MAX_AGE_HOURS) return str(row.computed_at)

    await refreshIcd10Usage()

    const [fresh] = await hisDb.execute(sql`
      SELECT DATE_FORMAT(MAX(computed_at), '%Y-%m-%d %H:%i') AS computed_at
        FROM pyhos_icd10_usage`)
    return str(rows(fresh)[0]?.computed_at)
  } catch (error) {
    console.error('[rdu-icd10-usage] คำนวณจำนวนการใช้รหัสวินิจฉัยไม่สำเร็จ:', error)
    return null
  }
}
