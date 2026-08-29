import 'server-only'
import { after } from 'next/server'
import { signAuthToken } from './jwt'
import { describeDevice, notifyLoginSuccess } from './notify'
import { clientIp } from '@/lib/rate-limit'

/** ฟิลด์ผู้ใช้ที่จำเป็นต่อการออก session — ใช้ร่วมกันระหว่างเส้นทางปกติและเส้นทาง MFA */
export type SessionUser = {
  id: number
  username: string
  idCard: string | null
  pname: string | null
  fname: string
  lname: string
  userTypeId: number | null
  userPositionId: number | null
  userLevelId: number | null
  userStatusId: number | null
  missionId: number | null
  majorId: number | null
  submajorId: number | null
  hospitalLcPid: number | null
  passwordChangedAt: Date | null
}

/**
 * สร้าง response ตอบกลับตอนล็อกอินสำเร็จ (รูปทรงเดียวกับที่หน้า login ใช้)
 * และสั่งแจ้งเตือนเข้า Line หมอพร้อมหลังส่ง response ออกไปแล้ว
 */
export async function buildLoginSuccess(
  user: SessionUser,
  context: { request: Request; viaMfa: boolean },
): Promise<Response> {
  const token = await signAuthToken({
    sub: String(user.id),
    username: user.username,
    user_type_id: user.userTypeId,
  })

  // after() ให้การยิง API หมอพร้อม (~1 วินาที) ไม่ไปหน่วงหน้าล็อกอิน
  const ip = clientIp(context.request)
  const device = describeDevice(context.request.headers.get('user-agent'))
  after(() =>
    notifyLoginSuccess({
      userId: user.id,
      idCard: user.idCard,
      info: { username: user.username, clientIp: ip, device, viaMfa: context.viaMfa },
    }),
  )

  return Response.json({
    success: true,
    token,
    data: {
      id: user.id,
      username: user.username,
      pname: user.pname,
      fname: user.fname,
      lname: user.lname,
      full_name: [user.pname, user.fname, user.lname].filter(Boolean).join(' '),
      user_type_id: user.userTypeId,
      user_position_id: user.userPositionId,
      user_level_id: user.userLevelId,
      user_status_id: user.userStatusId,
      mission_id: user.missionId,
      major_id: user.majorId,
      submajor_id: user.submajorId,
      hospital_lc_pid: user.hospitalLcPid,
      password_changed_at: user.passwordChangedAt,
    },
  })
}
