import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'
import { rtfToText } from '@/lib/his/rtf'

/**
 * ผลแล็บที่รายงานเป็นเอกสาร (ตาราง lab_head ฟิลด์ result_rtf)
 *
 * ส่วนใหญ่คือผลเพาะเชื้อของงานจุลชีววิทยา — ในรอบ 6 เดือนมี 12,963 ใบ
 * เนื้อรายงานเฉลี่ย 1,224 ตัวอักษร มีทั้ง Gram stain, culture และผลความไวต่อยา
 *
 * ฟอร์มอื่น (Cytophatology, LABส่งต่อ ฯลฯ) มีบ้างแต่เนื้อหาเฉลี่ยแค่ ~115 ตัวอักษร
 * ซึ่งเป็นโครง RTF เปล่า ๆ ไม่มีเนื้อความ จึงคัดออกด้วยความยาว ไม่ใช่ด้วยชื่อฟอร์ม
 * (ดู EMPTY_RTF_LENGTH)
 *
 * lab_head ผูกกับ hn และ vn เท่านั้น ไม่มีคอลัมน์ an — ผลที่ได้จึงเป็นของผู้ป่วย
 * รายนั้นทุกครั้งที่มารับบริการ ไม่ได้จำกัดเฉพาะการนอนครั้งที่กำลังดูอยู่
 */

export type LabCultureItem = {
  labNo: number
  /** 'YYYY-MM-DD' */
  orderDate: string | null
  reportDate: string | null
  reportTime: string | null
  formName: string | null
  department: string | null
  reporterName: string | null
  vn: string | null
  /** ความยาวของ RTF ใช้บอกว่ามีเนื้อรายงานจริงหรือเป็นโครงเปล่า */
  rtfLength: number
}

/** ชื่อฟอร์มของงานจุลชีววิทยา — ผลเพาะเชื้อเกือบทั้งหมดอยู่ใต้ชื่อนี้ */
export const MICROBIOLOGY_FORM = 'จุลชีววิทยา'

/**
 * RTF ที่สั้นกว่านี้คือโครงเปล่าที่ไม่มีเนื้อความ
 * ของจริงหน้าตาแบบนี้ — มีแต่ fonttbl กับ \par เดียว ยาว 115 ตัวอักษร
 *   {\rtf1\ansi\deff0{\fonttbl{\f0\fnil\fcharset222 Times New Roman;}}
 *   \viewkind4\uc1\pard\lang1054\f0\fs24\par }
 * รอบ 6 เดือนมีแบบนี้ 1,400 ใบ จากทั้งหมด 14,344 ใบ
 */
export const EMPTY_RTF_LENGTH = 130

/** จำนวนใบรายงานสูงสุดต่อผู้ป่วยหนึ่งคน */
const MAX_REPORTS = 150

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v).trim() || null)

/**
 * รายการใบรายงานของผู้ป่วย — ไม่ลาก result_rtf ขึ้นมาด้วย
 * เป็น longtext ถ้าดึงทุกใบพร้อมกันจะกินหน่วยความจำและแบนด์วิดท์เกินจำเป็น
 * ส่งแค่ความยาวมาให้หน้าจอรู้ว่าใบไหนเปิดแล้วมีเนื้อหา
 */
export async function listLabCultures(hn: string): Promise<LabCultureItem[]> {
  const [result] = await hisDb.execute(sql`
    SELECT a.lab_order_number AS lab_no,
           DATE_FORMAT(a.order_date, '%Y-%m-%d') AS order_date,
           DATE_FORMAT(a.report_date, '%Y-%m-%d') AS report_date,
           TIME_FORMAT(a.report_time, '%H:%i') AS report_time,
           a.form_name, a.department, a.reporter_name, a.vn,
           CHAR_LENGTH(a.result_rtf) AS rtf_len
    FROM lab_head a
    WHERE a.hn = ${hn}
      AND a.result_rtf IS NOT NULL
      AND a.result_rtf <> ''
    ORDER BY a.order_date DESC, a.lab_order_number DESC
    LIMIT ${MAX_REPORTS}`)

  return (result as unknown as Record<string, unknown>[]).map(row => ({
    labNo: Number(row.lab_no),
    orderDate: str(row.order_date),
    reportDate: str(row.report_date),
    reportTime: str(row.report_time),
    formName: str(row.form_name),
    department: str(row.department),
    reporterName: str(row.reporter_name),
    vn: str(row.vn),
    rtfLength: Number(row.rtf_len ?? 0),
  }))
}

/**
 * เนื้อรายงานของใบเดียว แปลงจาก RTF เป็นข้อความธรรมดา
 *
 * ผูก hn ไว้ในเงื่อนไขด้วยเสมอ ไม่ได้ค้นจาก lab_order_number อย่างเดียว
 * กันเปิดดูผลข้ามผู้ป่วยด้วยการเดาเลขใบรายงาน (เป็นเลขรันนิ่ง เดาง่ายมาก)
 */
export async function getLabCultureReport(
  hn: string,
  labOrderNumber: number,
): Promise<string | null> {
  const [result] = await hisDb.execute(sql`
    SELECT a.result_rtf
    FROM lab_head a
    WHERE a.hn = ${hn} AND a.lab_order_number = ${labOrderNumber}
    LIMIT 1`)

  const row = (result as unknown as Record<string, unknown>[])[0]
  if (!row) return null
  return rtfToText(row.result_rtf as string | null)
}

/** ใบรายงานพร้อมเนื้อความที่แปลงเป็นข้อความแล้ว */
export type LabCultureReport = {
  labNo: number
  /** 'YYYY-MM-DD' */
  orderDate: string | null
  text: string
}

/**
 * ใบรายงานงานจุลชีววิทยาล่าสุดพร้อมเนื้อความ สำหรับงานที่ต้องอ่านผลจริง
 *
 * ต่างจาก listLabCultures ตรงที่ลาก result_rtf ขึ้นมาด้วย จึงจำกัดทั้งช่วงเวลาและ
 * จำนวนใบไว้เสมอ — ใบเดียวยาวได้ถึง 3,000 ตัวอักษร ผู้ป่วยที่นอนนาน ๆ มีเป็นสิบใบ
 *
 * เอาเฉพาะฟอร์มจุลชีววิทยา เพราะฟอร์มอื่นที่ยาวพอ ๆ กันเป็นผลตรวจคนละเรื่อง
 * (เช่นพยาธิวิทยา) ซึ่งไม่ได้ตอบคำถามเรื่องเชื้อและความไวต่อยา
 */
export async function listRecentCultureReports(
  hn: string,
  { days, max }: { days: number; max: number },
): Promise<LabCultureReport[]> {
  const [result] = await hisDb.execute(sql`
    SELECT a.lab_order_number AS lab_no,
           DATE_FORMAT(a.order_date, '%Y-%m-%d') AS order_date,
           a.result_rtf
    FROM lab_head a
    WHERE a.hn = ${hn}
      AND a.form_name = ${MICROBIOLOGY_FORM}
      AND a.result_rtf IS NOT NULL
      AND CHAR_LENGTH(a.result_rtf) > ${EMPTY_RTF_LENGTH}
      AND a.order_date >= DATE_SUB(CURDATE(), INTERVAL ${days} DAY)
    ORDER BY a.order_date DESC, a.lab_order_number DESC
    LIMIT ${max}`)

  return (result as unknown as Record<string, unknown>[]).map(row => ({
    labNo: Number(row.lab_no),
    orderDate: str(row.order_date),
    text: rtfToText(row.result_rtf as string | null),
  }))
}

/** จำนวนใบรายงานงานจุลชีววิทยาที่มีเนื้อความในช่วงเวลาที่กำหนด */
export async function countRecentCultureReports(hn: string, days: number): Promise<number> {
  const [result] = await hisDb.execute(sql`
    SELECT COUNT(*) AS n
    FROM lab_head a
    WHERE a.hn = ${hn}
      AND a.form_name = ${MICROBIOLOGY_FORM}
      AND a.result_rtf IS NOT NULL
      AND CHAR_LENGTH(a.result_rtf) > ${EMPTY_RTF_LENGTH}
      AND a.order_date >= DATE_SUB(CURDATE(), INTERVAL ${days} DAY)`)

  const row = (result as unknown as Record<string, unknown>[])[0]
  return Number(row?.n ?? 0)
}

/**
 * จำนวนใบรายงานที่มีเนื้อความจริง ใช้ตัดสินว่าจะขึ้นปุ่มให้กดหรือไม่
 *
 * นับเฉพาะที่ยาวเกินโครง RTF เปล่า — ถ้านับรวมใบเปล่าด้วย ปุ่มจะขึ้นแล้วกดเข้าไปเจอ
 * รายการที่เปิดดูไม่ได้สักใบ
 */
export async function countLabCultures(hn: string): Promise<number> {
  const [result] = await hisDb.execute(sql`
    SELECT COUNT(*) AS n
    FROM lab_head a
    WHERE a.hn = ${hn}
      AND a.result_rtf IS NOT NULL
      AND CHAR_LENGTH(a.result_rtf) > ${EMPTY_RTF_LENGTH}`)

  const row = (result as unknown as Record<string, unknown>[])[0]
  return Number(row?.n ?? 0)
}
