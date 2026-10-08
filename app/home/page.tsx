'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ยังทำที่ app/home/layout.tsx ซึ่งเป็น Server Component)
import Link from 'next/link'
import { Card, Typography } from 'antd'
import { RightOutlined } from '@ant-design/icons'
import { MENU_ITEMS, usePermissions } from './app-shell'
import PageHint from './page-hint'

const { Title } = Typography

/**
 * การ์ดบนหน้าแรกอ่านจาก MENU_ITEMS ชุดเดียวกับเมนูในลิ้นชักซ้าย
 *
 * ไม่ถือรายการของตัวเองอีกแล้ว — ตอนที่แยกกันอยู่ มีสามเมนูที่ขึ้นในลิ้นชักแต่ไม่มี
 * การ์ดบนหน้าแรกโดยไม่มีใครรู้ ตัดออกแค่ '/home' เพราะเป็นหน้านี้เอง
 */
const FEATURES = MENU_ITEMS.filter(item => item.key !== '/home')

export default function HomePage() {
  // การ์ดต้องหายไปพร้อมเมนูของงานที่ผู้ใช้ไม่มีสิทธิ์ ไม่งั้นหน้าแรกจะยังชวนให้กด
  const permissions = usePermissions()
  const features = FEATURES.filter(item => !item.feature || permissions[item.feature])

  return (
    <>
      <section className="mb-8">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-accent-line bg-panel px-3.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.2em] text-accent backdrop-blur">
          <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_10px_#a78bfa]" />
          เข้าสู่ระบบแล้ว
        </div>
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          เลือกเมนูที่ต้องการใช้งาน
          <PageHint>
            ข้อมูลทั้งหมดดึงจากฐานข้อมูล HIS ของโรงพยาบาล — เปิดเมนูเพิ่มเติมได้จากปุ่มมุมซ้ายบน
            และดูข้อมูลบัญชีของท่านได้จากรูปโปรไฟล์มุมขวาบน
          </PageHint>
        </Title>
        <div className="h-px w-24 bg-linear-to-r from-violet-400/70 to-transparent" />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {features.map(feature => (
          <Link key={feature.key} href={feature.key}>
            <Card hoverable variant="borderless" className="h-full border! border-line!">
              {/* ไอคอนกับชื่อเมนูอยู่แถวเดียวกัน ส่วนคำอธิบายลงมาเต็มความกว้างข้างล่าง
                  ถ้าให้คำอธิบายไปอยู่ข้างไอคอนด้วย พอเหลือความกว้าง 1 ใน 4
                  จะเบียดจนตกบรรทัดละสองสามคำ */}
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-accent-soft text-base text-accent">
                  {feature.icon}
                </div>
                <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
                  {feature.label}
                  <RightOutlined className="shrink-0 text-[10px] text-accent/60" />
                </div>
              </div>
              <p className="mt-2.5 text-xs leading-relaxed text-ink-3">{feature.desc}</p>
            </Card>
          </Link>
        ))}
      </section>
    </>
  )
}
