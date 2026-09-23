import 'server-only'
import { coreKonDb } from '@/lib/db/core-kon'
import { activityLog } from '@/lib/db/schema/core-kon'

/**
 * ร่องรอยการใช้งาน workbench — ใครเข้าหน้าไหน ดึงอะไร ส่งออกอะไร
 *
 * เขียนจากสองทาง: proxy.ts ดักคำขอทุกอันที่ผ่านเข้ามา ส่วนการส่งออกไฟล์ต้องให้
 * หน้าจอแจ้งกลับมาเอง เพราะไฟล์ CSV ถูกประกอบในเบราว์เซอร์จากข้อมูลที่โหลดไปแล้ว
 * ไม่มีคำขอวิ่งกลับมาที่เซิร์ฟเวอร์ให้ดักเลยสักครั้ง
 *
 * กติกาข้อเดียวที่ห้ามผิด: การเขียนล็อกต้องไม่ทำให้คำขอของผู้ใช้ล้ม ระบบเฝ้าดู
 * ที่ทำให้ระบบหลักใช้ไม่ได้แย่กว่าไม่มีระบบเฝ้าดู ทุกทางจึงกลืน error ทิ้งหมด
 */

export const ACTIONS = ['page', 'api', 'export', 'login', 'logout', 'denied'] as const
export type ActivityAction = (typeof ACTIONS)[number]

export type ActivityEntry = {
  userId?: number | null
  username?: string | null
  action: ActivityAction
  method?: string | null
  path: string
  feature?: string | null
  targetHn?: string | null
  detail?: string | null
  status?: number | null
  durationMs?: number | null
  clientIp?: string | null
  device?: string | null
}

/** ความยาวสูงสุดของแต่ละคอลัมน์ข้อความ — ตัดให้พอดีก่อนเขียน ไม่ปล่อยให้ฐานปฏิเสธทั้งแถว */
const LIMITS = {
  username: 50,
  method: 8,
  path: 300,
  feature: 40,
  targetHn: 20,
  detail: 400,
  clientIp: 64,
  device: 200,
} as const

const clip = (value: string | null | undefined, max: number): string | null => {
  const text = value?.trim()
  if (!text) return null
  return text.length > max ? text.slice(0, max) : text
}

const int = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null

/**
 * งานที่เส้นทางหนึ่งสังกัด — ตัดจากช่วงแรกของ path ที่มีความหมาย
 *
 * ทั้ง '/home/rdu/reports/ed' และ '/api/his/rdu/ed' ต้องได้ 'rdu' เหมือนกัน
 * ไม่งั้นหน้า admin จะกรองตามงานไม่ได้ เพราะฝั่งหน้าเว็บกับฝั่ง API แยกกันอยู่
 */
export function featureOf(path: string): string | null {
  const parts = path.split('/').filter(Boolean)
  if (parts[0] === 'home') return parts[1] ?? 'home'
  if (parts[0] === 'api') {
    // '/api/his/rdu/...' — ข้าม 'his' ที่เป็นชื่อฐาน ไม่ใช่ชื่องาน
    const rest = parts.slice(1).filter(part => part !== 'his')
    return rest[0] ?? 'api'
  }
  return parts[0] ?? null
}

/** ชื่อพารามิเตอร์ที่หมายถึงตัวผู้ป่วยในเส้นทางต่าง ๆ ของโปรเจกต์นี้ */
const HN_KEYS = ['hn', 'patient', 'patientHn', 'patient_hn']

/**
 * HN ที่คำขอนี้เจาะจงถึง — null ถ้าเป็นการดูภาพรวมที่ไม่ได้ระบุตัวคน
 *
 * ดูจาก query string อย่างเดียว ไม่แกะ body — body ของ POST อ่านใน proxy แล้ว
 * ตัวเส้นทางปลายทางจะอ่านซ้ำไม่ได้ (stream อ่านได้ครั้งเดียว) ซึ่งจะทำให้การ
 * บันทึกล็อกไปทำให้ฟีเจอร์จริงพัง เส้นทางที่รับ HN ทาง body จึงต้องแจ้งเอง
 */
export function targetHnOf(url: URL): string | null {
  for (const key of HN_KEYS) {
    const value = url.searchParams.get(key)
    if (value && /^[0-9A-Za-z-]{3,20}$/.test(value.trim())) return value.trim()
  }
  return null
}

/**
 * เก็บพารามิเตอร์ที่เหลือไว้เป็นคำอธิบาย — ตอบได้ว่า "ดึงช่วงไหน ค้นคำว่าอะไร"
 *
 * ตัดคำค้นที่เป็นชื่อคนทิ้ง ('q', 'term', 'name') เพราะการค้นด้วยชื่อผู้ป่วยจะทำให้
 * ชื่อไปนอนอยู่ในตารางล็อกทั้งที่ตารางนี้ตั้งใจเก็บแค่ HN เป็นตัวอ้างอิง
 */
const SKIP_PARAMS = new Set([...HN_KEYS, 'q', 'term', 'name', 'keyword', '_rsc'])

export function detailOf(url: URL): string | null {
  const parts: string[] = []
  for (const [key, value] of url.searchParams) {
    if (SKIP_PARAMS.has(key)) continue
    if (!value) continue
    parts.push(`${key}=${value}`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

/**
 * บันทึกหนึ่งเหตุการณ์ — ไม่คืนค่า ไม่โยน error ไม่ว่าจะเกิดอะไรขึ้น
 *
 * ผู้เรียกควรส่งผลลัพธ์นี้เข้า waitUntil หรือ after เพื่อไม่ให้ผู้ใช้ต้องรอการเขียน
 * ล็อกก่อนได้รับคำตอบ
 */
export async function recordActivity(entry: ActivityEntry): Promise<void> {
  try {
    await coreKonDb.insert(activityLog).values({
      userId: int(entry.userId),
      username: clip(entry.username, LIMITS.username),
      action: entry.action,
      method: clip(entry.method, LIMITS.method),
      path: clip(entry.path, LIMITS.path) ?? '/',
      feature: clip(entry.feature, LIMITS.feature),
      targetHn: clip(entry.targetHn, LIMITS.targetHn),
      detail: clip(entry.detail, LIMITS.detail),
      status: int(entry.status),
      durationMs: int(entry.durationMs),
      clientIp: clip(entry.clientIp, LIMITS.clientIp),
      device: clip(entry.device, LIMITS.device),
    })
  } catch (error) {
    console.error('[activity-log] เขียนล็อกไม่สำเร็จ:', error)
  }
}
