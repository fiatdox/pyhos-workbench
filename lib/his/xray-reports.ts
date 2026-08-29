import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'
import { rtfToText } from '@/lib/his/rtf'

/**
 * ผลอ่านภาพรังสี (ตาราง xray_report)
 *
 * เนื้อรายงานอยู่ในฟิลด์ report_rtf ตามที่ระบบเดิมใช้ — ในฐานจริงราว 6% เป็น RTF
 * ที่เหลือเป็นข้อความล้วน ตัวแปลงจัดการให้ทั้งสองแบบแล้ว
 *
 * ฟิลด์ report_text ที่มีคู่กันแทบไม่ถูกใช้ (3 จาก 5,000 แถวล่าสุด) จึงใช้เป็นตัวสำรอง
 * เมื่อ report_rtf ว่างเท่านั้น
 */

export type XrayReport = {
  xn: number
  vn: string | null
  /** 'YYYY-MM-DD' วันที่อ่านผล */
  reportDate: string | null
  reportTime: string | null
  /** วันที่ถ่ายภาพ — ต่างจากวันอ่านผลได้ */
  examinedDate: string | null
  itemName: string | null
  doctor: string | null
  /** ข้อบ่งชี้ที่แพทย์ผู้ส่งตรวจเขียนมา */
  clinical: string | null
  /** ยืนยันผลแล้ว (confirm = 'Y') — ที่ยังไม่ยืนยันคือรายงานร่าง */
  confirmed: boolean
  report: string
}

/** จำนวนรายงานสูงสุดต่อผู้ป่วยหนึ่งคน */
const MAX_REPORTS = 200

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v).trim() || null)

/**
 * รายงานเก่าราว 22,000 แถว (ปี 2557–2559) บันทึกวันที่เป็น พ.ศ. ลงคอลัมน์ date ตรง ๆ
 * ต่างจากที่เหลือซึ่งเป็น ค.ศ. — แปลงกลับให้เป็น ค.ศ. ทั้งหมด
 * ไม่งั้นหน้าจอที่บวก 543 อีกทีจะได้ปี 3101
 */
function toChristianYear(date: string | null): string | null {
  if (!date) return null
  const year = Number(date.slice(0, 4))
  return year >= 2400 ? `${year - 543}${date.slice(4)}` : date
}

export async function getXrayReports(hn: string): Promise<XrayReport[]> {
  const [result] = await hisDb.execute(sql`
    SELECT xr.xn, xr.vn, xr.confirm,
           DATE_FORMAT(xr.report_date, '%Y-%m-%d') AS report_date,
           TIME_FORMAT(xr.report_time, '%H:%i') AS report_time,
           DATE_FORMAT(xr.examined_date, '%Y-%m-%d') AS examined_date,
           xr.report_rtf, xr.report_text, xr.clinical_information,
           xi.xray_items_name, doc.name AS doctor_name
    FROM xray_report xr
    LEFT OUTER JOIN xray_items xi ON xi.xray_items_code = xr.xray_items_code
    LEFT OUTER JOIN doctor doc ON doc.code = xr.report_doctor
    WHERE xr.hn = ${hn}
    ORDER BY xr.report_date DESC, xr.report_time DESC, xr.xn DESC
    LIMIT ${MAX_REPORTS}`)

  const rows = result as unknown as Record<string, unknown>[]

  return rows
    .map(row => ({
      xn: Number(row.xn),
      vn: str(row.vn),
      reportDate: toChristianYear(str(row.report_date)),
      reportTime: str(row.report_time),
      examinedDate: toChristianYear(str(row.examined_date)),
      itemName: str(row.xray_items_name),
      doctor: str(row.doctor_name),
      clinical: str(row.clinical_information)?.replace(/\r\n?/g, '\n') ?? null,
      confirmed: String(row.confirm ?? '') === 'Y',
      report: rtfToText(row.report_rtf as Buffer | string | null) || rtfToText(str(row.report_text)),
    }))
    // รายการที่ยังไม่มีใครอ่านผลจะมีแต่หัวไฟล์ RTF เปล่า ๆ ไม่ต้องเอามาแสดง
    .filter(item => item.report.length > 0)
    // เรียงใหม่หลังแปลงปีแล้ว — ถ้าเรียงในคิวรี แถวที่เก็บเป็น พ.ศ. จะลอยขึ้นมาอยู่บนสุดทั้งหมด
    .sort((a, b) => (b.reportDate ?? '').localeCompare(a.reportDate ?? '') || b.xn - a.xn)
}
