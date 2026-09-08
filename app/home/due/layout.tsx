import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyAuthToken } from '@/lib/auth/jwt'
import { userCanUseDue } from '@/lib/auth/permissions'

// ต้องอ่าน cookie ทุกครั้ง — ห้ามแคชส่วนนี้
export const dynamic = 'force-dynamic'

/**
 * กันการเข้าถึงงาน DUE ทุกหน้าย่อยไว้ที่ชั้นนี้ชั้นเดียว
 *
 * วางเป็น layout ไม่ใช่เช็คในแต่ละหน้า เพราะหน้าย่อยจะเพิ่มขึ้นอีก และการลืมใส่
 * เช็คในหน้าใหม่จะเปิดช่องโดยไม่มีใครสังเกต ส่วน layout ครอบทุกหน้าใต้เส้นทางนี้
 * โดยอัตโนมัติ
 *
 * เด้งกลับหน้าแรกของระบบ ไม่ใช่หน้าเข้าสู่ระบบ — คนที่มาถึงตรงนี้ล็อกอินถูกต้อง
 * อยู่แล้ว แค่ไม่มีสิทธิ์ในงานนี้
 */
export default async function DueLayout({ children }: LayoutProps<'/home/due'>) {
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  if (!claims?.sub) redirect('/?expired=1')
  if (!(await userCanUseDue(claims.sub))) redirect('/home')

  return <>{children}</>
}
