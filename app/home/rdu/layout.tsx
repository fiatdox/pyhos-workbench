import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyAuthToken } from '@/lib/auth/jwt'
import { userCanUseRdu } from '@/lib/auth/permissions'

// ต้องอ่าน cookie ทุกครั้ง — ห้ามแคชส่วนนี้
export const dynamic = 'force-dynamic'

/**
 * กันการเข้าถึงงาน RDU ทุกหน้าย่อยไว้ที่ชั้นนี้ชั้นเดียว
 *
 * ใช้รายการตำแหน่งของตัวเอง (RDU_USER_POSITION_IDS) — คนที่ต้องเห็นตัวชี้วัดคือ
 * เภสัชกร แพทย์ และคณะกรรมการ (ดูเหตุผลเต็มที่ lib/auth/access.ts)
 */
export default async function RduLayout({ children }: LayoutProps<'/home/rdu'>) {
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  if (!claims?.sub) redirect('/?expired=1')
  if (!(await userCanUseRdu(claims.sub))) redirect('/home')

  return <>{children}</>
}
