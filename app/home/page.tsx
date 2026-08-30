'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ยังทำที่ app/home/layout.tsx ซึ่งเป็น Server Component)
import Link from 'next/link'
import { Card, Typography } from 'antd'
import { ExperimentOutlined, MedicineBoxOutlined, RightOutlined } from '@ant-design/icons'

const { Paragraph, Title } = Typography

// การ์ดต้องตรงกับเมนูใน drawer ซ้าย (MENU_ITEMS) — เพิ่มเมนูใหม่ที่ไหน เพิ่มที่นี่ด้วย
const FEATURES = [
  {
    href: '/home/medication-history',
    icon: <MedicineBoxOutlined />,
    title: 'ประวัติการได้รับยา',
    desc: 'ดูรายการยาที่ผู้ป่วยเคยได้รับ ย้อนหลังตามช่วงเวลา พร้อมชื่อยาและวันที่จ่าย',
  },
  {
    href: '/home/hla-b5801',
    icon: <ExperimentOutlined />,
    title: 'ผลตรวจ HLA-B*5801',
    desc: 'ผู้ป่วยที่รายงานผล HLA-B*5801 แล้ว ค้นตามช่วงวันที่และเปิดดูรูปใบรายงาน',
  },
]

export default function HomePage() {
  return (
    <>
      <section className="mb-8">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-accent-line bg-panel px-3.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.2em] text-accent backdrop-blur">
          <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_10px_#a78bfa]" />
          เข้าสู่ระบบแล้ว
        </div>
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          เลือกเมนูที่ต้องการใช้งาน
        </Title>
        <div className="mb-4 h-px w-24 bg-linear-to-r from-violet-400/70 to-transparent" />
        <Paragraph type="secondary" style={{ maxWidth: 640, marginBottom: 0 }}>
          ข้อมูลทั้งหมดดึงจากฐานข้อมูล HIS ของโรงพยาบาล — เปิดเมนูเพิ่มเติมได้จากปุ่มมุมซ้ายบน
          และดูข้อมูลบัญชีของท่านได้จากรูปโปรไฟล์มุมขวาบน
        </Paragraph>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        {FEATURES.map(feature => (
          <Link key={feature.href} href={feature.href}>
            <Card hoverable variant="borderless" className="h-full border! border-line!">
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-accent-soft text-lg text-accent">
                  {feature.icon}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                    {feature.title}
                    <RightOutlined className="text-[10px] text-accent/60" />
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-3">{feature.desc}</p>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </section>
    </>
  )
}
