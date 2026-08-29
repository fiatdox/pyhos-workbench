import { SESSION_EXPIRED_MESSAGE, SESSION_EXPIRED_PARAM } from '@/lib/client/session'
import LoginForm from './login-form'

/**
 * หน้าเข้าสู่ระบบ — เป็น Server Component บาง ๆ ที่อ่าน query แล้วส่งต่อให้ฟอร์ม
 * ทำแบบนี้เพื่อให้ข้อความ "เซสชันหมดอายุ" ถูก render มาพร้อมหน้าเลย
 * ไม่ต้องรอ effect ฝั่ง client (และไม่เกิด hydration mismatch)
 */
export default async function LoginPage({ searchParams }: PageProps<'/'>) {
  const params = await searchParams
  const expired = params[SESSION_EXPIRED_PARAM] === '1'

  return <LoginForm initialError={expired ? SESSION_EXPIRED_MESSAGE : ''} />
}
