'use client'
import { Input } from 'antd'
import { SearchOutlined } from '@ant-design/icons'

/**
 * ช่องค้นในตารางรายงาน — ใช้ร่วมกันทุกหน้าตัวชี้วัด
 *
 * ทุกหน้าโหลดข้อมูลทั้งช่วงวันที่ลงเบราว์เซอร์อยู่แล้ว (หลักร้อยถึงสามพันแถว)
 * การค้นจึงทำในเบราว์เซอร์ล้วน ไม่ต้องยิงกลับไปที่ฐาน — ผลออกทันทีทุกตัวอักษร
 * และไม่เพิ่มภาระให้ฐาน HIS ที่คนทั้งโรงพยาบาลใช้งานอยู่
 *
 * ปุ่มกรองแบบ Segmented ที่มีอยู่เดิมตอบคำถาม "กลุ่มไหน" ได้ แต่ตอบ "คนนี้อยู่ใน
 * รายงานไหม" ไม่ได้เลย ซึ่งเป็นคำถามที่เกิดขึ้นตลอดเวลาในที่ประชุม — เภสัชกรถือ
 * HN มาหนึ่งใบแล้วต้องเลื่อนหาทีละหน้าจากห้าสิบแถวต่อหน้า
 */

/**
 * แถวนี้ตรงกับคำค้นหรือไม่
 *
 * แยกคำด้วยช่องว่างแล้วบังคับให้ตรงทุกคำ ไม่ใช่ตรงคำใดคำหนึ่ง — คนพิมพ์หลายคำ
 * ตั้งใจจะแคบผลลง ไม่ใช่ขยาย ("สมชาย amox" = สมชายที่ได้ amoxicillin)
 * ตรงกันแบบมีคำนั้นอยู่ที่ไหนก็ได้ ไม่ต้องขึ้นต้น เพราะชื่อยาในฐานขึ้นต้นด้วย
 * วงเล็บและรหัสภายในเต็มไปหมด ("(ง)Atorvastatin-40 Tablet [ช,ต](LIPITOR)")
 *
 * ค่าที่เป็น null/undefined ตัดทิ้งไปเฉย ๆ — คอลัมน์ที่ไม่มีค่าไม่ควรทำให้
 * แถวนั้นหาไม่เจอจากคอลัมน์อื่น
 */
export function matchesRow(
  fields: (string | number | null | undefined)[],
  keyword: string,
): boolean {
  const words = keyword.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true

  const haystack = fields
    .filter(value => value != null && value !== '')
    .join(' ')
    .toLowerCase()

  return words.every(word => haystack.includes(word))
}

/**
 * ช่องค้นของตาราง — กว้างคงที่เพื่อให้แถบเครื่องมือไม่ขยับตอนพิมพ์
 *
 * ไม่มี prop สำหรับปิดการใช้งาน ตั้งใจไม่ใส่ — ช่องนี้กรองแถวในเบราว์เซอร์ล้วน
 * ปิดตอนกำลังโหลดก็ไม่ได้ป้องกันอะไร และคอมโพเนนต์ของ antd ที่ปิดตั้งแต่เรนเดอร์
 * แรกทำให้ HTML จากเซิร์ฟเวอร์ไม่ตรงกับตอน hydrate (เจอมาแล้วกับ Select
 * ในหน้าทะเบียนรหัสวินิจฉัย)
 */
export default function RowSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  /** บอกว่าค้นอะไรได้บ้างในหน้านี้ — แต่ละตัวชี้วัดมีคอลัมน์ไม่เหมือนกัน */
  placeholder: string
}) {
  return (
    <Input
      allowClear
      value={value}
      onChange={event => onChange(event.target.value)}
      prefix={<SearchOutlined className="text-ink-3" />}
      placeholder={placeholder}
      className="w-full sm:w-72"
    />
  )
}
