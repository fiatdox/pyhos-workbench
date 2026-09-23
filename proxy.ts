import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server'
import { describeDevice } from '@/lib/auth/notify'
import { verifyAuthToken } from '@/lib/auth/jwt'
import { detailOf, featureOf, recordActivity, targetHnOf } from '@/lib/audit/activity-log'

/**
 * ดักคำขอทุกอันเพื่อบันทึกร่องรอยการใช้งาน
 *
 * ชื่อไฟล์คือ proxy.ts ไม่ใช่ middleware.ts — Next 16 เลิกใช้ชื่อเดิมแล้ว
 * (node_modules/next/dist/docs/.../middleware.md) ความสามารถเหมือนเดิมทุกอย่าง
 * และรุ่นนี้รันบน Node.js runtime เป็นค่าตั้งต้น จึงต่อฐานข้อมูลได้ตรงจากที่นี่
 * ห้ามประกาศ runtime เองเด็ดขาด Next จะโยน error ทันที
 *
 * ไม่แตะคำขอเลย — คืน NextResponse.next() เสมอ การตรวจสิทธิ์ยังอยู่ที่เดิม
 * (app/home/layout.tsx กับด่านตรวจของแต่ละเส้นทาง) ที่นี่ทำหน้าที่เฝ้าดูอย่างเดียว
 * ถ้าวันหนึ่งจะย้ายการตรวจสิทธิ์มาไว้ที่นี่ ต้องคิดใหม่ทั้งหมด เพราะการปล่อยผ่าน
 * เป็นพฤติกรรมที่ตั้งใจของไฟล์นี้ ไม่ใช่ของที่ลืมใส่
 */

export const config = {
  // เส้นทางของ activity เองไม่ถูกดัก — เส้นทางแจ้งการส่งออกไฟล์เขียนล็อกของมันเอง
  // ถ้าดักด้วยจะได้สองแถวต่อการส่งออกหนึ่งครั้ง ส่วนเส้นทางอ่านล็อกในหน้า admin
  // ถ้าดักจะยิ่งบานปลาย เพราะการเปิดดูล็อกจะสร้างล็อกใหม่ให้ตัวเองทุกครั้งที่กรอง
  // /api/auth ไม่ถูกดักเพราะคำขอล็อกอินยังไม่มี cookie ตอนวิ่งผ่านที่นี่ ถ้าดัก
  // ด้วยจะได้แถว 'ถูกปฏิเสธ' ทุกครั้งที่มีคนล็อกอินสำเร็จ ซึ่งอ่านแล้วเข้าใจผิด
  // ทั้งหมด — การเข้า/ออกระบบบันทึกจากจุดที่รู้ตัวตนแล้วแทน (lib/auth/session.ts
  // กับ api/auth/logout) ส่วน /api/activity ดูเหตุผลที่ app/api/activity/list
  matcher: ['/home/:path*', '/api/((?!activity|auth).*)'],
}

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  event.waitUntil(track(request))
  return NextResponse.next()
}

async function track(request: NextRequest): Promise<void> {
  try {
    const url = new URL(request.url)
    const path = url.pathname

    // Next ดึงหน้าไว้ล่วงหน้าตอนเมาส์ผ่านลิงก์ ผู้ใช้ยังไม่ได้เข้าหน้านั้นจริง
    // ถ้านับด้วย ล็อกจะเต็มไปด้วยหน้าที่ไม่มีใครเปิด จนของจริงหาไม่เจอ
    if (request.headers.get('next-router-prefetch')) return

    const token = request.cookies.get('auth_token')?.value
    const claims = token ? await verifyAuthToken(token) : null
    const isApi = path.startsWith('/api')

    // คำขอที่ไม่มีตัวตนและเป็นหน้าเว็บ ปล่อยผ่านไปเงียบ ๆ — เดี๋ยวก็ถูกเด้งไปหน้า
    // ล็อกอินอยู่ดี และไม่มี "ใคร" ให้บันทึก ส่วนฝั่ง API บันทึกไว้เพราะการยิง API
    // โดยไม่มี token คือสิ่งที่คนตรวจสอบอยากเห็น ไม่ใช่เสียงรบกวน
    if (!claims?.sub && !isApi) return

    const userId = Number(claims?.sub)

    await recordActivity({
      userId: Number.isInteger(userId) ? userId : null,
      username: claims?.username ?? null,
      action: claims?.sub ? (isApi ? 'api' : 'page') : 'denied',
      method: request.method,
      path,
      feature: featureOf(path),
      targetHn: targetHnOf(url),
      detail: detailOf(url),
      clientIp:
        request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
        request.headers.get('x-real-ip'),
      device: describeDevice(request.headers.get('user-agent')),
    })
  } catch (error) {
    // ระบบเฝ้าดูที่ทำให้ระบบหลักล่มแย่กว่าไม่มีระบบเฝ้าดู
    console.error('[proxy] บันทึกร่องรอยไม่สำเร็จ:', error)
  }
}
