import { redirect } from 'next/navigation'
import { requireAuditUser } from '@/lib/auth/audit-user'
import ActivityView from './activity-view'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * หน้าดูร่องรอยการใช้งาน — กันสิทธิ์ที่ฝั่งเซิร์ฟเวอร์ก่อนส่ง JS ลงไป
 *
 * ซ่อนเมนูอย่างเดียวไม่พอ คนที่รู้ URL ยังพิมพ์เข้ามาตรง ๆ ได้ และหน้านี้ต่างจาก
 * หน้าอื่นตรงที่ข้อมูลข้างในบอกว่าเพื่อนร่วมงานแต่ละคนเปิดดูคนไข้รายไหนไปบ้าง
 * เด้งกลับหน้าแรกเงียบ ๆ ไม่บอกว่ามีหน้านี้อยู่
 */
export default async function ActivityPage() {
  const user = await requireAuditUser()
  if (!user.ok) redirect('/home')

  return <ActivityView />
}
