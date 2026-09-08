'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ยังทำที่ app/home/layout.tsx ซึ่งเป็น Server Component)
import Link from 'next/link'
import { Card, Typography } from 'antd'
import {
  BarChartOutlined,
  EnvironmentOutlined,
  MedicineBoxOutlined,
  RightOutlined,
  TagsOutlined,
  UserAddOutlined,
} from '@ant-design/icons'
import { MotorcycleOutlined } from '../icons'

const { Paragraph, Title } = Typography

/**
 * งานย่อยของ Health Rider
 *
 * เรียงตามที่ตกลงกันไว้ แต่ลำดับการทำจริงต้องกลับกัน — ต้องมีประเภทเจ้าหน้าที่
 * ก่อนถึงจะเพิ่มเจ้าหน้าที่ได้ และต้องมีเจ้าหน้าที่ก่อนถึงจะจ่ายพื้นที่รับผิดชอบได้
 */
const SECTIONS = [
  {
    href: '/home/health-rider/dashboard',
    icon: <BarChartOutlined />,
    title: 'ภาพรวมงานส่งยา',
    desc: 'ปริมาณงาน การจ่ายงาน แนวโน้ม พื้นที่ และภาระของเจ้าหน้าที่',
  },
  {
    href: '/home/health-rider/deliveries',
    icon: <MedicineBoxOutlined />,
    title: 'รายชื่อผู้ป่วยส่งยาถึงบ้าน',
    desc: 'เลือกวันแล้วดูว่าวันนั้นมีผู้ป่วยคนไหนต้องส่งยาบ้าง',
  },
  {
    href: '/home/health-rider/staff',
    icon: <UserAddOutlined />,
    title: 'เพิ่มเจ้าหน้าที่',
    desc: 'ทะเบียนเจ้าหน้าที่ส่งยา — เพิ่ม แก้ไข และปิดการใช้งานรายบุคคล',
  },
  {
    href: '/home/health-rider/areas',
    icon: <EnvironmentOutlined />,
    title: 'จัดการรับผิดชอบพื้นที่ส่งยา',
    desc: 'กำหนดว่าเจ้าหน้าที่คนไหนรับผิดชอบพื้นที่ใด',
  },
  {
    href: '/home/health-rider/staff-types',
    icon: <TagsOutlined />,
    title: 'ประเภทเจ้าหน้าที่',
    desc: 'ข้อมูลตั้งต้นของประเภทเจ้าหน้าที่ ใช้อ้างอิงตอนเพิ่มเจ้าหน้าที่',
  },
]

export default function HealthRiderPage() {
  return (
    <>
      <section className="mb-6">
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          <MotorcycleOutlined /> Health Rider
        </Title>
        <div className="mb-4 h-px w-24 bg-linear-to-r from-violet-400/70 to-transparent" />
        <Paragraph type="secondary" style={{ maxWidth: 720, marginBottom: 0 }}>
          งานส่งยาถึงบ้าน — ดูแลทะเบียนเจ้าหน้าที่ ประเภทเจ้าหน้าที่
          และการแบ่งพื้นที่รับผิดชอบ
        </Paragraph>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {SECTIONS.map(section => (
          <Link key={section.href} href={section.href}>
            <Card hoverable variant="borderless" className="h-full border! border-line!">
              <div className="mb-2 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-accent-soft text-base text-accent">
                  {section.icon}
                </div>
                <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
                  {section.title}
                  <RightOutlined className="shrink-0 text-[10px] text-accent/60" />
                </div>
              </div>
              <p className="text-xs leading-relaxed text-ink-3">{section.desc}</p>
            </Card>
          </Link>
        ))}
      </section>
    </>
  )
}
