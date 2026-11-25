import { cookies } from 'next/headers'
import { eq } from 'drizzle-orm'
import { verifyAuthToken } from '@/lib/auth/jwt'
import { coreKonDb } from '@/lib/db/core-kon'
import { users } from '@/lib/db/schema/core-kon'
import { getCheckupPrintout } from '@/lib/his/checkup-sheet-data'
import { renderCheckupSheet } from '@/lib/his/checkup-sheet-pdf'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * ใบรายงานผลการตรวจสุขภาพ (PDF) ของการมารับบริการหนึ่งครั้ง — หน้าตรวจสุขภาพเปิดใน iframe
 *
 * ?hn=&vn= เหมือน /api/his/visit-detail — คิวรีทุกตัวผูก hn ไว้ เดา vn ของคนอื่นไม่ได้
 * proxy บันทึกร่องรอยการเปิดดูให้เองจากพารามิเตอร์ hn (ดู lib/audit/activity-log.ts)
 *
 * สร้าง PDF ที่เซิร์ฟเวอร์ไม่ใช่ในเบราว์เซอร์ เหตุผลอยู่ที่หัว lib/his/checkup-sheet-pdf.tsx
 */

/** สร้าง PDF ใช้แรงพอสมควร (หลายร้อยมิลลิวินาที) จึงให้โควตาต่ำกว่าปลายทางที่คืน JSON */
const PER_IP = { limit: 30, windowSeconds: 300 }
const HN_RE = /^\d{9}$/
/** vn ของ HIS เป็นเลข 12 หลัก (yymmdd + เวลา) */
const VN_RE = /^\d{12}$/

const text = (status: number, body: string) =>
  new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })

/** ชื่อผู้พิมพ์สำหรับท้ายกระดาษ — อ่านจากฐานผู้ใช้ ไม่เชื่อค่าที่เบราว์เซอร์ส่งมา */
async function printedByOf(userId: string): Promise<string> {
  const id = Number(userId)
  if (!Number.isInteger(id)) return '—'
  const [row] = await coreKonDb
    .select({ pname: users.pname, fname: users.fname, lname: users.lname, username: users.username })
    .from(users)
    .where(eq(users.id, id))
    .limit(1)
  if (!row) return '—'
  return [row.pname, row.fname, row.lname].filter(Boolean).join(' ').trim() || row.username || '—'
}

export async function GET(request: Request) {
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  if (!claims?.sub) return text(401, 'กรุณาเข้าสู่ระบบใหม่')

  const ip = clientIp(request)
  const limited = rateLimit(`his-checkup-sheet:${claims.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) return tooManyRequests(limited.retryAfterSeconds, 'เรียกดูบ่อยเกินไป กรุณารอสักครู่')

  const params = new URL(request.url).searchParams
  const rawHn = (params.get('hn') ?? '').replace(/\D/g, '')
  const hn = rawHn.length > 0 && rawHn.length <= 9 ? rawHn.padStart(9, '0') : rawHn
  const vn = (params.get('vn') ?? '').replace(/\D/g, '')
  if (!HN_RE.test(hn) || !VN_RE.test(vn)) return text(400, 'HN หรือ VN ไม่ถูกต้อง')

  try {
    const [data, printedBy] = await Promise.all([getCheckupPrintout(hn, vn), printedByOf(claims.sub)])
    if (!data) return text(404, 'ไม่พบข้อมูลการมารับบริการครั้งนี้')

    const pdf = await renderCheckupSheet(data, printedBy)
    // ?download=1 = บันทึกเป็นไฟล์ ไม่มี = เปิดในตัวดู PDF ของเบราว์เซอร์ (พิมพ์ได้จากตรงนั้น)
    // ชื่อไฟล์ไม่มีชื่อผู้ป่วย — ไฟล์ที่ดาวน์โหลดไปตกค้างในเครื่องไม่ควรบอกว่าเป็นของใคร
    const disposition = params.has('download') ? 'attachment' : 'inline'
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${disposition}; filename="checkup-${data.visitDate}.pdf"`,
        // ข้อมูลสุขภาพของผู้ป่วย — ห้ามแคชทั้งที่เบราว์เซอร์และ proxy
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    console.error('[his/checkup/sheet] สร้าง PDF ไม่สำเร็จ:', error)
    return text(500, 'สร้างใบรายงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
  }
}
