import { after } from 'next/server'
import { denyAuditUser, requireAuditUser } from '@/lib/auth/audit-user'
import { describeDevice } from '@/lib/auth/notify'
import { recordActivity } from '@/lib/audit/activity-log'
import {
  ARCHIVE_MIN_KEEP_DAYS,
  activityStatus,
  archiveOldActivity,
} from '@/lib/audit/activity-archive'
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * สำรองร่องรอยเก่าออกเป็นไฟล์แล้วตัดออกจากตาราง
 *
 * GET = ดูสถานะว่าตารางโตแค่ไหนและมีกี่แถวที่ตัดได้ · POST = สั่งตัดจริง
 *
 * การลบร่องรอยเป็นการแก้เอกสารที่ใช้สอบเหตุการณ์ จึงต้องทิ้งร่องรอยของตัวเองไว้
 * ด้วยเสมอ — แถวที่บันทึกหลังตัดจะบอกว่าใครสั่ง ตัดไปกี่แถว และไฟล์ไปอยู่ที่ไหน
 * แถวนั้นใหม่กว่าเกณฑ์เสมอจึงไม่ถูกตัดไปพร้อมกันเอง
 *
 * ตั้งใจให้คนกดเอง ไม่ตัดอัตโนมัติ — ระบบที่ลบหลักฐานได้เองโดยไม่มีใครสั่งเป็น
 * สิ่งที่อธิบายกับผู้ตรวจยาก และที่นี่ไม่มีตัวจัดคิวงานให้พึ่งอยู่แล้ว ถ้าอยากให้
 * ทำอัตโนมัติ ให้ Task Scheduler ของวินโดวส์ยิง POST นี้ตามรอบที่ต้องการ
 */

const PER_IP = { limit: 10, windowSeconds: 600 }

export async function GET(request: Request) {
  const user = await requireAuditUser()
  if (!user.ok) return denyAuditUser(user.error)

  const keepDays = Number(new URL(request.url).searchParams.get('keepDays'))

  try {
    const status = await activityStatus(Number.isFinite(keepDays) ? keepDays : null)
    return Response.json({ success: true, status, minKeepDays: ARCHIVE_MIN_KEEP_DAYS })
  } catch (error) {
    console.error('[activity/archive] อ่านสถานะไม่สำเร็จ:', error)
    return Response.json({ success: false, message: 'อ่านสถานะตารางไม่สำเร็จ' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const user = await requireAuditUser()
  if (!user.ok) return denyAuditUser(user.error)

  const ip = clientIp(request)
  const limited = rateLimit(`activity-archive:${user.sub}:${ip}`, PER_IP.limit, PER_IP.windowSeconds)
  if (!limited.ok) return tooManyRequests(limited.retryAfterSeconds, 'สั่งบ่อยเกินไป')

  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const keepDays = Number((body as Record<string, unknown>)?.keepDays)

  try {
    const result = await archiveOldActivity({ keepDays: Number.isFinite(keepDays) ? keepDays : null })

    if (result.moved > 0) {
      after(() =>
        recordActivity({
          userId: Number(user.sub),
          username: user.username,
          action: 'export',
          method: 'POST',
          path: '/api/activity/archive',
          feature: 'audit',
          detail: `สำรองและตัดร่องรอย ${result.moved.toLocaleString('th-TH')} แถว → ${result.file}`,
          clientIp: ip,
          device: describeDevice(request.headers.get('user-agent')),
        }),
      )
    }

    return Response.json({ success: true, ...result })
  } catch (error) {
    console.error('[activity/archive] ตัดข้อมูลไม่สำเร็จ:', error)
    return Response.json(
      { success: false, message: 'สำรองข้อมูลไม่สำเร็จ — ไม่มีแถวใดถูกลบ' },
      { status: 500 },
    )
  }
}
