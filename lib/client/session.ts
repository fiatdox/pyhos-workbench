import Cookies from 'js-cookie'

/**
 * จัดการกรณี token หมดอายุฝั่งหน้าเว็บ
 *
 * ทุก API ของระบบตอบ 401 เมื่อ JWT หมดอายุหรือใช้ไม่ได้ ถ้าปล่อยให้แต่ละหน้า
 * แสดงเป็นข้อความ error เฉย ๆ ผู้ใช้จะค้างอยู่หน้าเดิมที่กดอะไรก็ไม่ได้แล้ว
 * จึงรวมไว้ที่เดียว: เจอ 401 = ล้าง cookie แล้วกลับไปหน้าเข้าสู่ระบบทันที
 */

/** query string ที่ติดไปกับ URL หน้า login เพื่อบอกสาเหตุที่ถูกส่งกลับมา */
export const SESSION_EXPIRED_PARAM = 'expired'

export const SESSION_EXPIRED_MESSAGE = 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'

/** ล้าง cookie ของเซสชันแล้วกลับไปหน้าเข้าสู่ระบบ */
export function goToLogin() {
  Cookies.remove('auth_token')
  Cookies.remove('user_data')
  Cookies.remove('user_type_id')
  // ใช้ location.replace ไม่ใช่ router.push — ล้าง state ของหน้าที่ค้างอยู่ให้หมด
  // และไม่ให้ปุ่ม back ย้อนกลับมาหน้าที่เข้าไม่ได้แล้ว
  window.location.replace(`/?${SESSION_EXPIRED_PARAM}=1`)
}

/**
 * fetch ที่ดัก 401 ให้เอง — ใช้แทน fetch ทุกที่ที่เรียก API ที่ต้องล็อกอิน
 *
 * เมื่อเจอ 401 จะเริ่มเปลี่ยนหน้าแล้วคืน promise ที่ไม่ resolve
 * ผู้เรียกจึงค้างอยู่ที่สถานะกำลังโหลดจนกว่าเบราว์เซอร์จะเปลี่ยนหน้าเสร็จ
 * (ถ้า resolve ตามปกติ หน้าจะแวบข้อความ error ขึ้นมาก่อนโดยไม่จำเป็น)
 */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, {
    cache: 'no-store',
    credentials: 'same-origin',
    ...init,
  })

  if (res.status === 401) {
    goToLogin()
    return new Promise<Response>(() => {})
  }

  return res
}
