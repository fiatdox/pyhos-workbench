import 'server-only'
import { hisScanPool } from '@/lib/db/his-scan'

/**
 * ภาพสแกนเวชระเบียนผู้ป่วยนอก (ตาราง opdscan บนเครื่องฐานภาพ)
 *
 * ตารางใหญ่และเก็บภาพเป็น longblob — รายการทั้งหมดจึงดึงเฉพาะ metadata
 * ส่วนตัวภาพดึงทีละใบตอนผู้ใช้เปิดดูจริง
 */

export type OpdScanItem = {
  scanId: number
  hn: string
  vn: string | null
  /** 'YYYY-MM-DD HH:mm' */
  scannedAt: string | null
  pageNo: number | null
  imageType: string
}

/** จำนวนรายการสูงสุดต่อการค้นหนึ่งครั้ง */
export const MAX_SCAN_ITEMS = 60

/** ขนาดภาพสูงสุดที่ยอมส่งออกไป กันภาพเสียหายที่ขนาดผิดปกติ */
const MAX_IMAGE_BYTES = 25 * 1024 * 1024

/** ชนิดภาพที่รู้จัก — ใช้ตั้ง Content-Type ตอนส่งออก */
const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  pdf: 'application/pdf',
}

export function scanMimeType(imageType: string): string {
  return MIME[imageType.toLowerCase()] ?? 'application/octet-stream'
}

async function query(
  sql: string,
  params: (string | number)[],
): Promise<Record<string, unknown>[]> {
  const [rows] = await hisScanPool.execute(sql, params)
  return rows as unknown as Record<string, unknown>[]
}

/**
 * รายการภาพสแกนของผู้ป่วย ค้นด้วย hn หรือเจาะจง vn ก็ได้
 * ทั้งสองคอลัมน์มี index อยู่แล้ว (ix_hn, ix_vn)
 */
export async function listOpdScans(
  filter: { hn: string; vn?: string | null },
  limit = MAX_SCAN_ITEMS,
): Promise<OpdScanItem[]> {
  const capped = Math.min(Math.max(limit, 1), MAX_SCAN_ITEMS)
  // ผูก hn ไว้เสมอแม้ระบุ vn มาด้วย — กันเปิดดูภาพข้ามผู้ป่วย
  const params = filter.vn ? [filter.hn, filter.vn] : [filter.hn]

  const rows = await query(
    `SELECT scan_id, hn, vn, DATE_FORMAT(scan_date_time, '%Y-%m-%d %H:%i') AS scanned_at,
            pageno, image_type
     FROM opdscan
     WHERE hn = ?${filter.vn ? ' AND vn = ?' : ''}
     ORDER BY scan_date_time DESC, pageno
     LIMIT ${capped}`,
    params,
  )

  return rows.map(row => ({
    scanId: Number(row.scan_id),
    hn: String(row.hn),
    vn: row.vn == null || row.vn === '' ? null : String(row.vn),
    scannedAt: row.scanned_at == null ? null : String(row.scanned_at),
    pageNo: row.pageno == null ? null : Number(row.pageno),
    imageType: String(row.image_type ?? 'jpg').trim().toLowerCase(),
  }))
}

/**
 * จำนวนภาพสแกนของผู้ป่วย ใช้ตัดสินว่าจะขึ้นปุ่มหรือไม่
 *
 * นับจาก metadata อย่างเดียว ไม่แตะคอลัมน์ scan_image ซึ่งเป็น longblob
 * (COUNT(*) บน ix_hn ไม่ต้องอ่านตัวภาพ)
 */
export async function countOpdScans(hn: string): Promise<number> {
  const rows = await query(`SELECT COUNT(*) AS n FROM opdscan WHERE hn = ?`, [hn])
  return Number(rows[0]?.n ?? 0)
}

/** ภาพหนึ่งใบ — ต้องระบุ hn คู่กับ scan_id เสมอ ให้ภาพผูกกับผู้ป่วยที่ผู้ใช้กำลังดูอยู่ */
export async function getOpdScanImage(
  scanId: number,
  hn: string,
): Promise<{ data: Buffer; imageType: string } | null> {
  const rows = await query(
    `SELECT image_type, scan_image FROM opdscan WHERE scan_id = ? AND hn = ? LIMIT 1`,
    [scanId, hn],
  )

  const row = rows[0]
  if (!row || !Buffer.isBuffer(row.scan_image)) return null
  if (row.scan_image.length === 0 || row.scan_image.length > MAX_IMAGE_BYTES) return null

  return {
    data: row.scan_image,
    imageType: String(row.image_type ?? 'jpg').trim().toLowerCase(),
  }
}
