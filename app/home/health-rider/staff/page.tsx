import { redirect } from 'next/navigation'
import { requireRiderAdmin } from '@/lib/auth/rider-admin'
import HealthRiderStaffView from './view'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * หน้าเพิ่มเจ้าหน้าที่ Health Rider — กันสิทธิ์ที่เซิร์ฟเวอร์ก่อนส่ง JS ลงไป
 *
 * ซ่อนการ์ดในหน้ารวมอย่างเดียวไม่พอ คนที่รู้ URL ยังพิมพ์เข้ามาตรง ๆ ได้
 * เด้งกลับหน้ารวมของงานนี้ ไม่ใช่หน้าแรก — คนที่มาถึงตรงนี้มีสิทธิ์ใช้งาน
 * Health Rider อยู่แล้ว แค่ไม่ใช่คนที่ตั้งค่าได้
 */
export default async function HealthRiderStaffPage() {
  const admin = await requireRiderAdmin()
  if (!admin.ok) redirect('/home/health-rider')

  return <HealthRiderStaffView />
}
