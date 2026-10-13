'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
import type { ReactNode } from 'react'
import { Popover } from 'antd'
import { ExclamationCircleOutlined, QuestionCircleOutlined } from '@ant-design/icons'

/**
 * คำอธิบายหัวข้อที่พับเก็บไว้หลังไอคอน
 *
 * เดิมทุกหน้าวางคำอธิบายเป็นย่อหน้าใต้หัวข้อ ซึ่งกินความสูงสองถึงสามบรรทัดทุกครั้ง
 * ที่เปิดหน้า ทั้งที่คนใช้งานประจำอ่านรอบเดียวก็จำได้แล้ว บรรทัดที่เสียไปมีค่ามาก
 * ในหน้าที่เป็นตาราง เพราะดันแถวข้อมูลตกขอบจอไปเปล่า ๆ
 *
 * เก็บไว้ ไม่ใช่ลบทิ้ง — คำอธิบายพวกนี้บอกว่าตัวเลขในหน้านับอะไรและไม่นับอะไร
 * คนที่เพิ่งเข้ามาใช้ครั้งแรกยังต้องอ่าน
 *
 * เปิดด้วยทั้งชี้และกด เพราะบนแท็บเล็ตไม่มีการชี้ค้าง ถ้าผูกกับ hover อย่างเดียว
 * คำอธิบายจะเปิดไม่ได้เลยบนเครื่องที่ใช้นิ้ว
 *
 * tone="warning": ข้อควรระวังที่มีผลต่อความถูกต้องของผล — ไอคอนสีเหลือง
 * และ title เป็นหัวข้อตัวหนาบนสุดของคำอธิบาย (ใช้เป็นชื่อปุ่มให้โปรแกรมอ่านหน้าจอด้วย)
 */
export default function PageHint({
  children,
  tone = 'info',
  title,
}: {
  children: ReactNode
  tone?: 'info' | 'warning'
  title?: string
}) {
  const warning = tone === 'warning'
  return (
    <Popover
      trigger={['hover', 'click']}
      placement="bottomLeft"
      content={
        <div style={{ maxWidth: 440 }} className="text-xs leading-relaxed text-ink-2">
          {title && <div className="mb-1.5 text-sm font-semibold text-ink">{title}</div>}
          {children}
        </div>
      }
    >
      <button
        type="button"
        aria-label={title ?? 'คำอธิบายหน้านี้'}
        className={
          warning
            ? 'ml-2 cursor-help align-middle text-base text-amber-500 transition-colors hover:text-amber-600'
            : 'ml-2 cursor-help align-middle text-base text-ink-3 transition-colors hover:text-accent'
        }
      >
        {warning ? <ExclamationCircleOutlined /> : <QuestionCircleOutlined />}
      </button>
    </Popover>
  )
}
