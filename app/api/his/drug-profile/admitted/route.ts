import { cookies } from 'next/headers'
import { verifyAuthToken } from '@/lib/auth/jwt'
import { listAdmittedByDoctor, listAdmittedInWard } from '@/lib/his/drug-profile'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PER_IP = { limit: 120, windowSeconds: 300 }
// รหัสตึกใน HIS เป็น varchar(4) และเป็นตัวเลข/ตัวอักษรล้วน
const WARD_RE = /^[A-Za-z0-9]{1,4}$/
// รหัสแพทย์เป็น varchar(15) — ที่ใช้จริงเป็นตัวเลขสี่หลัก แต่ไม่ผูกกับความยาวนั้น
const DOCTOR_RE = /^[A-Za-z0-9]{1,15}$/

/**
 * รายชื่อผู้ป่วยที่ยังนอนอยู่ — กรองตามตึก หรือตามแพทย์ อย่างใดอย่างหนึ่ง
 *
 * สองทางนี้ตอบคำถามคนละข้อแต่ได้ผลลัพธ์หน้าตาเดียวกัน จึงอยู่เส้นทางเดียวกัน
 * ส่งมาทั้งคู่หรือไม่ส่งเลยถือว่าผิด ไม่ใช่เลือกให้เองว่าจะใช้ตัวไหน
 */
export async function GET(request: Request) {
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  if (!claims?.sub) {
    return Response.json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 })
  }

  const ip = clientIp(request)
  const limited = rateLimit(`his-dp-adm:${claims.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfterSeconds, 'เรียกดูบ่อยเกินไป กรุณารอสักครู่')
  }

  const params = new URL(request.url).searchParams
  const ward = (params.get('ward') ?? '').trim()
  const doctor = (params.get('doctor') ?? '').trim()

  if (Boolean(ward) === Boolean(doctor)) {
    return Response.json(
      { success: false, message: 'ระบุตึกหรือแพทย์มาอย่างใดอย่างหนึ่ง' },
      { status: 400 },
    )
  }

  if (doctor) {
    if (!DOCTOR_RE.test(doctor)) {
      return Response.json({ success: false, message: 'ไม่พบรหัสแพทย์ที่ระบุ' }, { status: 400 })
    }

    try {
      const patients = await listAdmittedByDoctor(doctor)
      return Response.json({ success: true, doctor, patients })
    } catch (error) {
      console.error('[his/drug-profile/admitted] ตามแพทย์ล้มเหลว:', error)
      return Response.json(
        { success: false, message: 'ดึงรายชื่อผู้ป่วยของแพทย์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
        { status: 500 },
      )
    }
  }

  if (!WARD_RE.test(ward)) {
    return Response.json({ success: false, message: 'ไม่พบรหัสตึกที่ระบุ' }, { status: 400 })
  }

  try {
    const patients = await listAdmittedInWard(ward)
    return Response.json({ success: true, ward, patients })
  } catch (error) {
    console.error('[his/drug-profile/admitted] ล้มเหลว:', error)
    return Response.json(
      { success: false, message: 'ดึงรายชื่อผู้ป่วยในตึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 },
    )
  }
}
