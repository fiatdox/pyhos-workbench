import 'server-only'
import { auditMfa } from './mfa'
import { sendLoginAlert, sendLogoutAlert, type SessionAlertInfo } from './moph'

/** ย่อ user-agent ให้อ่านรู้เรื่องบนการ์ด LINE (ไม่ต้องละเอียดถึงเวอร์ชัน) */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'ไม่ทราบอุปกรณ์'

  const os =
    /Windows NT/i.test(userAgent) ? 'Windows' :
    /iPhone|iPad|iOS/i.test(userAgent) ? 'iOS' :
    /Android/i.test(userAgent) ? 'Android' :
    /Mac OS X/i.test(userAgent) ? 'macOS' :
    /Linux/i.test(userAgent) ? 'Linux' : 'ไม่ทราบระบบ'

  // เรียงจากเฉพาะเจาะจงไปกว้าง — Edge/Chrome ต่างก็มีคำว่า Chrome ใน UA
  const browser =
    /Edg\//i.test(userAgent) ? 'Edge' :
    /OPR\//i.test(userAgent) ? 'Opera' :
    /Firefox\//i.test(userAgent) ? 'Firefox' :
    /Chrome\//i.test(userAgent) ? 'Chrome' :
    /Safari\//i.test(userAgent) ? 'Safari' : 'เบราว์เซอร์อื่น'

  return `${browser} · ${os}`
}

type NotifyParams = {
  userId: number
  idCard: string | null
  info: SessionAlertInfo
}

/**
 * แจ้งเตือนเข้าสู่ระบบสำเร็จ — ตั้งใจให้เรียกผ่าน after() ของ Next
 * ห้าม throw ออกไป เพราะการแจ้งเตือนล้มไม่ควรกระทบการใช้งาน
 */
export async function notifyLoginSuccess({ userId, idCard, info }: NotifyParams): Promise<void> {
  if (!idCard) return
  try {
    const sent = await sendLoginAlert(idCard, info)
    await auditMfa({
      userId,
      username: info.username,
      event: 'login_notified',
      detail: sent.detail,
      sendMs: sent.ms,
      clientIp: info.clientIp,
    })
  } catch (error) {
    console.error('[notify] แจ้งเตือนเข้าสู่ระบบไม่สำเร็จ:', error)
  }
}

/** แจ้งเตือนออกจากระบบ */
export async function notifyLogout({ userId, idCard, info }: NotifyParams): Promise<void> {
  if (!idCard) return
  try {
    const sent = await sendLogoutAlert(idCard, info)
    await auditMfa({
      userId,
      username: info.username,
      event: 'logout_notified',
      detail: sent.detail,
      sendMs: sent.ms,
      clientIp: info.clientIp,
    })
  } catch (error) {
    console.error('[notify] แจ้งเตือนออกจากระบบไม่สำเร็จ:', error)
  }
}
