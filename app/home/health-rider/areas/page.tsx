import { redirect } from 'next/navigation'
import { requireRiderAdmin } from '@/lib/auth/rider-admin'
import HealthRiderAreasView from './view'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * หน้าจัดการพื้นที่รับผิดชอบ — กันสิทธิ์ที่เซิร์ฟเวอร์ก่อนส่ง JS ลงไป
 * เหตุผลเดียวกับหน้าเพิ่มเจ้าหน้าที่ (ดู ../staff/page.tsx)
 */
export default async function HealthRiderAreasPage() {
  const admin = await requireRiderAdmin()
  if (!admin.ok) redirect('/home/health-rider')

  return <HealthRiderAreasView />
}
