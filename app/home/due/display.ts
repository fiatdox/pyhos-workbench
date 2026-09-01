/**
 * ค่าที่ใช้แสดงผลร่วมกันของหน้าจอ DUE ทุกหน้า
 *
 * แยกออกมาเพราะหน้างานเภสัชกรรมกับหน้าแพทย์ผู้กำกับต้องแปลสถานะและวันที่
 * เหมือนกันเป๊ะ ถ้าต่างคนต่างเขียน พอแก้ป้ายสถานะที่หน้าหนึ่งอีกหน้าจะค้างของเดิม
 * แล้วคนใช้สองฝ่ายจะเห็นคำไม่ตรงกันบนคำขอใบเดียวกัน
 */
import type { DueStatus } from './mock-data'

/** แปลง 'YYYY-MM-DD' หรือ 'YYYY-MM-DD HH:mm' เป็น วว/ดด/ปปปป พ.ศ. */
export function toThaiDate(value: string | null): string {
  if (!value) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(value)
  if (!match) return value
  const [, year, month, day, time] = match
  const date = `${day}/${month}/${Number(year) + 543}`
  return time ? `${date} ${time} น.` : date
}

/** 'YYYY-MM-DD HH:mm:ss' → 'ปปปป-ดด-วว ชช:นน:ss' แบบ พ.ศ. ตามที่ใช้ในระบบเดิม */
export function toThaiDateTime(value: string): string {
  const match = /^(\d{4})(-\d{2}-\d{2}.*)$/.exec(value)
  return match ? `${Number(match[1]) + 543}${match[2]}` : value
}

export const sexLabel = (sex: string) => (sex === '1' ? 'ชาย' : sex === '2' ? 'หญิง' : '—')

/**
 * หน้าตาของแต่ละสถานะ
 *
 * `actionable` = เภสัชกรกดรับรายการได้ตอนนี้ ใช้ตัดสินทั้งการเปิดปุ่มและการนับ
 * ตัวเลขบนแท็บ จะได้ไม่มีทางหลุดกันเองระหว่างสองที่
 */
export const STATUS_META: Record<
  DueStatus,
  { label: string; color: string; actionable: boolean; done: boolean }
> = {
  pending: { label: 'รอรับรายการ', color: 'gold', actionable: true, done: false },
  awaiting_approval: { label: 'รออนุมัติ', color: 'orange', actionable: false, done: false },
  approved: { label: 'อนุมัติแล้ว รอรับรายการ', color: 'green', actionable: true, done: false },
  denied: { label: 'ไม่อนุมัติ', color: 'red', actionable: false, done: true },
  accepted: { label: 'รับรายการแล้ว', color: 'blue', actionable: false, done: true },
  rejected: { label: 'ไม่รับรายการ', color: 'default', actionable: false, done: true },
}

/** แปลงค่าที่เก็บไว้กลับเป็นข้อความไทยสำหรับแสดงผล */
export function labelOf(options: { value: string; label: string }[], value: string | null): string {
  if (!value) return '—'
  return options.find(option => option.value === value)?.label ?? value
}
