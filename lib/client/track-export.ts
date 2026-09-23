import { apiFetch } from '@/lib/client/session'

/**
 * แจ้งเซิร์ฟเวอร์ว่าเพิ่งส่งออกไฟล์จากหน้านี้
 *
 * เรียกหลังสร้างไฟล์เสร็จแล้วเสมอ ไม่ใช่ก่อน — ถ้าเรียกก่อนแล้วการสร้างไฟล์ล้ม
 * ล็อกจะบอกว่ามีคนเอาข้อมูลออกไปทั้งที่ไม่มีไฟล์เกิดขึ้นจริง
 *
 * ไม่ await และกลืน error ทิ้ง — การแจ้งล็อกล้มต้องไม่ทำให้ผู้ใช้เห็นข้อความผิดพลาด
 * ทั้งที่ไฟล์อยู่ในเครื่องเขาเรียบร้อยแล้ว
 */
export function trackExport(input: { label: string; rows: number }): void {
  void (async () => {
    try {
      await apiFetch('/api/activity/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page: window.location.pathname,
          label: input.label,
          rows: input.rows,
        }),
      })
    } catch {
      // เงียบไว้ตั้งใจ — ดูเหตุผลข้างบน
    }
  })()
}
