'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ยังทำที่ app/home/layout.tsx ซึ่งเป็น Server Component)
import Link from 'next/link'
import { Alert, Card, Tag, Typography } from 'antd'
import {
  AlertOutlined,
  ApartmentOutlined,
  CloudOutlined,
  FireOutlined,
  HeartOutlined,
  RightOutlined,
} from '@ant-design/icons'
import PageHint from '../page-hint'

const { Title } = Typography

/**
 * Service Plan — หน้ารวมสาขาที่ติดตามตัวชี้วัดฝั่งเภสัชกรรม
 *
 * ทั้งสี่สาขามีสถิติห้าปีงบแล้ว ดูรายเดือนและรายไตรมาสได้
 *
 * สาขาโรคหัวใจเป็นสาขา**เดียวที่มีเกณฑ์มากับตัวชี้วัด** (STEMI ไม่เกินร้อยละ 9)
 * หน้านั้นจึงตัดสินผ่าน/ไม่ผ่านได้ ส่วนอีกสามสาขายังไม่มีเกณฑ์ที่ตกลงกันไว้สักข้อ
 * จึงแสดงอัตราและแนวโน้มล้วน — เกณฑ์เป็นของคณะกรรมการ ยังไม่เดาแทน
 */
const BRANCHES = [
  {
    icon: <AlertOutlined />,
    title: 'สาขาโรคหลอดเลือดสมอง (Stroke)',
    desc: 'สถิติผู้ป่วยในห้าปีงบ — อัตราตายเทียบเกณฑ์ ภาวะแทรกซ้อน Pneumonia/UTI วันนอนเฉลี่ย และค่าบริการเฉลี่ยต่อราย',
    href: '/home/service-plan/stroke',
    ready: true,
  },
  {
    icon: <CloudOutlined />,
    title: 'สาขาโรคปอดอุดกั้นเรื้อรัง (COPD)',
    desc: 'ร้อยละการเสียชีวิตของผู้ป่วยปอดบวม และผู้ป่วยใน COPD (J44 โรคหลัก) แยกตามช่วงอายุ ห้าปีงบ',
    href: '/home/service-plan/copd',
    ready: true,
  },
  {
    icon: <HeartOutlined />,
    title: 'สาขาโรคหัวใจ',
    desc: 'อัตราตายของกล้ามเนื้อหัวใจตายเฉียบพลัน แยกชนิด STEMI / NSTEMI (เกณฑ์ไม่เกินร้อยละ 9) และอัตราป่วยโรคหัวใจขาดเลือด I20-I25',
    href: '/home/service-plan/cardiac',
    ready: true,
  },
  {
    icon: <FireOutlined />,
    title: 'Sepsis',
    desc: 'ผู้ป่วย Sepsis / Septic shock และการเสียชีวิต แยกตามชนิด ที่มาของการติดเชื้อ และตำแหน่งการติดเชื้อเก้าระบบ',
    href: '/home/service-plan/sepsis',
    ready: true,
  },
]

export default function ServicePlanPage() {
  return (
    <>
      <section className="mb-6">
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          <ApartmentOutlined /> Service Plan
          <PageHint>
            สาขาที่กลุ่มงานเภสัชกรรมต้องรายงานตัวชี้วัดตามแผนพัฒนาระบบบริการสุขภาพ —
            ทั้งสี่สาขามีสถิติห้าปีงบแล้ว ดูรายเดือนและรายไตรมาสได้
          </PageHint>
        </Title>
        <div className="h-px w-24 bg-linear-to-r from-violet-400/70 to-transparent" />
      </section>

      <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {BRANCHES.map(branch => (
          <Link key={branch.href} href={branch.href}>
            <Card hoverable variant="borderless" className="h-full border! border-line!">
              <div className="mb-2 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-accent-soft text-base text-accent">
                  {branch.icon}
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                  {branch.title}
                  <RightOutlined className="shrink-0 text-[10px] text-accent/60" />
                  {/* ป้ายนี้บอกว่าการ์ดไหนกดเข้าไปแล้วมีตัวเลขให้ดูจริง ไม่ใช่หน้าเปล่า */}
                  {!branch.ready && <Tag className="mr-0!">ยังไม่มีข้อมูล</Tag>}
                </div>
              </div>
              <p className="text-xs leading-relaxed text-ink-3">{branch.desc}</p>
            </Card>
          </Link>
        ))}
      </section>

      <Alert
        type="info"
        showIcon
        title="เกณฑ์เป้าหมายมีแค่สาขาโรคหัวใจ"
        description={
          <div className="text-xs leading-relaxed">
            มีเกณฑ์เป้าหมายอยู่ข้อเดียว — อัตราตาย STEMI ไม่เกินร้อยละ 9 ของสาขาโรคหัวใจ
            หน้านั้นจึงตัดสินผ่าน/ไม่ผ่านได้ ส่วนอีกสามสาขามีตัวเลขแล้วแต่ยังไม่มีเกณฑ์
            จึงแสดงอัตราและ
            แนวโน้มล้วน ไม่ตัดสินผ่าน/ไม่ผ่าน · และยังมีนิยามที่สองหน้าใช้ไม่ตรงกันอยู่ —
            หน้า Sepsis นับประเภทการจำหน่าย 02 (Against Advice) เป็นการเสียชีวิตด้วย ส่วนหน้า
            COPD กับ Stroke นับ 08 และ 09 เท่านั้น ทั้งสองแบบมาจากคิวรีที่ได้รับมาคนละชุด
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Tag>เกณฑ์เป้าหมาย</Tag>
              <Tag>นิยามการเสียชีวิต</Tag>
              <Tag>ผู้รับผิดชอบรายงาน</Tag>
            </div>
          </div>
        }
      />
    </>
  )
}
