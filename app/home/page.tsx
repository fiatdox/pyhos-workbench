'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ยังทำที่ app/home/layout.tsx ซึ่งเป็น Server Component)
import Link from 'next/link'
import { Typography } from 'antd'
import { RightOutlined } from '@ant-design/icons'
import { MENU_ITEMS, usePermissions, useSessionUser } from './app-shell'
import PageHint from './page-hint'

const { Title } = Typography

/**
 * การ์ดบนหน้าแรกอ่านจาก MENU_ITEMS ชุดเดียวกับเมนูข้าง
 *
 * ไม่ถือรายการของตัวเองอีกแล้ว — ตอนที่แยกกันอยู่ มีสามเมนูที่ขึ้นในเมนูแต่ไม่มี
 * การ์ดบนหน้าแรกโดยไม่มีใครรู้ ตัดออกแค่ '/home' เพราะเป็นหน้านี้เอง
 */
const FEATURES = MENU_ITEMS.filter(item => item.key !== '/home')

export default function HomePage() {
  // การ์ดต้องหายไปพร้อมเมนูของงานที่ผู้ใช้ไม่มีสิทธิ์ ไม่งั้นหน้าแรกจะยังชวนให้กด
  const permissions = usePermissions()
  const user = useSessionUser()
  const features = FEATURES.filter(item => !item.feature || permissions[item.feature])

  return (
    <>
      <section className="mb-6">
        {user && <div className="mb-1 text-sm text-ink-3">สวัสดี {user.fullName}</div>}
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          เลือกเมนูที่ต้องการใช้งาน
          <PageHint>
            ข้อมูลทั้งหมดดึงจากฐานข้อมูล HIS ของโรงพยาบาล — ย้ายหน้าได้จากเมนูด้านซ้าย
            (จอเล็กกดปุ่มมุมซ้ายบน) และดูข้อมูลบัญชีของท่านได้จากรูปโปรไฟล์มุมขวาบน
          </PageHint>
        </Title>
        <div className="title-rule" />
      </section>

      {/* การ์ดทั้งใบเป็นลิงก์เดียว — กดตรงไหนก็ได้ และโฟกัสด้วยคีย์บอร์ดได้ทั้งใบ
          ไม่ยกตัวตอนชี้ (ของเดิม hoverable ของ antd) เปลี่ยนแค่สีขอบกับพื้น ไม่ให้เลย์เอาต์ขยับ */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {features.map(feature => (
          <Link
            key={feature.key}
            href={feature.key}
            className="group flex h-full flex-col rounded-xl border border-line bg-panel p-4 transition-colors hover:border-accent-line hover:bg-accent-soft"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-base text-accent transition-colors group-hover:bg-panel">
                {feature.icon}
              </div>
              <div className="min-w-0 flex-1 text-sm font-semibold text-ink">{feature.label}</div>
              <RightOutlined className="shrink-0 text-[10px] text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-accent motion-reduce:transition-none" />
            </div>
            <p className="mt-2.5 mb-0 text-xs leading-relaxed text-ink-3">{feature.desc}</p>
          </Link>
        ))}
      </section>
    </>
  )
}
