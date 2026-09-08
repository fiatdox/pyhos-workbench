/**
 * ค่าคงที่ของธีมที่ทั้งฝั่งเซิร์ฟเวอร์และฝั่งเบราว์เซอร์ใช้ร่วมกัน
 *
 * แยกออกมาจาก theme.tsx เพราะไฟล์นั้นเป็น 'use client' — ฟังก์ชันที่ export
 * จากโมดูล client จะกลายเป็น client reference เรียกจาก Server Component ไม่ได้
 * (root layout ต้องอ่านคุกกี้ธีมตั้งแต่ฝั่งเซิร์ฟเวอร์ จึงต้องเรียกได้จริง)
 */

export type ThemeMode = 'dark' | 'light'

/** ชื่อเดียวกันทั้งใน localStorage และคุกกี้ — เก็บสองที่เพราะคนละคนอ่าน
 *  localStorage ให้สคริปต์ใน <head> อ่านก่อน paint ส่วนคุกกี้ให้ฝั่งเซิร์ฟเวอร์
 *  อ่านตอนเรนเดอร์ จะได้ส่ง HTML ที่เป็นธีมเดียวกับที่เบราว์เซอร์จะใช้ */
export const THEME_KEY = 'pyhos-theme'

export const DEFAULT_MODE: ThemeMode = 'dark'

/** ค่าที่อ่านได้จากคุกกี้อาจเป็นอะไรก็ได้ ค่านอกสองแบบนี้ถือเป็นค่าเริ่มต้น */
export function normalizeMode(value: string | undefined | null): ThemeMode {
  return value === 'light' || value === 'dark' ? value : DEFAULT_MODE
}

export const themeCookie = (mode: ThemeMode) =>
  `${THEME_KEY}=${mode};path=/;max-age=31536000;samesite=lax`
