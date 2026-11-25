/**
 * path ย่อยที่ระบบเปิดอยู่ เช่น "/workbench" เมื่อ nginx ส่ง
 * https://phayaohospital.moph.go.th/workbench/* มาที่ Next — เว้นว่าง = เปิดที่ราก "/"
 *
 * ตั้ง NEXT_PUBLIC_BASE_PATH ใน .env ก่อน `next build` — ค่าถูกฝังลงไฟล์ฝั่ง client
 * เปลี่ยนแล้วต้อง build ใหม่ (next.config.ts อ่านตัวเดียวกันไปตั้ง basePath)
 *
 * Next เติม basePath ให้เองเฉพาะ <Link>, router.push/replace(), redirect() และ
 * usePathname() (ตัดออกให้) ที่เหลือไม่เติม ต้องผ่าน withBase() ทุกจุด:
 * fetch(), <img>/<iframe> src, <a href> ที่ไม่ใช่ Link, window.location,
 * next/image src, ฟอนต์ของ @react-pdf ฝั่งเบราว์เซอร์ และ path ของคุกกี้
 *
 * ไฟล์นี้ไม่มี 'server-only' ตั้งใจ — ใช้ทั้งสองฝั่ง และค่าก็ไม่ใช่ความลับ
 */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '')

/**
 * '/api/x' → '/workbench/api/x' — ใส่ได้เฉพาะ path ที่ขึ้นต้นด้วย '/'
 *
 * หน้าแรกได้ '/workbench' ไม่ใช่ '/workbench/' ('/?expired=1' → '/workbench?expired=1')
 * เพราะ Next ไม่ใช้สแลชท้าย แบบมีสแลชจะโดน 308 เด้งอีกรอบก่อนถึงหน้า
 */
export function withBase(path: string): string {
  if (BASE_PATH && (path === '/' || path.startsWith('/?'))) return `${BASE_PATH}${path.slice(1)}`
  return `${BASE_PATH}${path}`
}

/** '/workbench/home/x' → '/home/x' — สำหรับ window.location.pathname ที่ติด basePath มาด้วย */
export function stripBase(pathname: string): string {
  if (!BASE_PATH) return pathname
  if (pathname === BASE_PATH) return '/'
  return pathname.startsWith(`${BASE_PATH}/`) ? pathname.slice(BASE_PATH.length) : pathname
}

/**
 * path ของคุกกี้ทุกตัวของระบบ — จำกัดไว้ใต้ basePath ไม่ให้ชนกับระบบอื่นบนโดเมนเดียวกัน
 * (เช่น DUE ที่ /due) และไม่ส่ง auth_token ไปให้แอปอื่นบน phayaohospital.moph.go.th
 */
export const COOKIE_PATH = BASE_PATH || '/'
