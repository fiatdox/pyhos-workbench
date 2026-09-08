'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ยังทำที่ app/home/layout.tsx ซึ่งเป็น Server Component)
import Link from 'next/link'
import { Alert, Card, Empty, Tag, Typography } from 'antd'
import {
  AuditOutlined,
  CheckCircleOutlined,
  DashboardOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  FileAddOutlined,
  RightOutlined,
} from '@ant-design/icons'

const { Paragraph, Title } = Typography

/**
 * ขั้นตอนของ DUE ตามที่ตกลงกันไว้ — ทำแล้วเฉพาะขั้นแรก (หน้าสร้างคำขอ)
 * เขียนไว้บนหน้าจอเพื่อให้ทุกฝ่ายเห็นตรงกันว่าปลายทางของงานนี้คืออะไร
 */
const STEPS = [
  {
    icon: <FileAddOutlined />,
    title: 'สั่งยากลุ่ม DUE',
    desc: 'เลือกผู้ป่วยและรายการยาที่อยู่ในกลุ่ม DUE พร้อมระบุข้อบ่งใช้และเหตุผลที่ต้องใช้ยาตัวนี้',
    href: '/home/due/request',
  },
  {
    icon: <ExperimentOutlined />,
    title: 'รับรายการและประเมินการใช้ยา',
    desc: 'รับคำขอเข้าคิว ตรวจความสมเหตุสมผลของการสั่งใช้และของวิธีใช้ยา แล้วบันทึกแบบประเมินการใช้ยา',
    href: '/home/due/pharmacy',
  },
  {
    icon: <CheckCircleOutlined />,
    title: 'อนุมัติการใช้ยา',
    desc: 'ยาบางประเภทต้องผ่านการอนุมัติจากแพทย์ผู้กำกับก่อนใช้กับผู้ป่วย — พิจารณาจากผลเพาะเชื้อและค่าไต แล้วอนุมัติหรือไม่อนุมัติพร้อมเหตุผล',
    href: '/home/due/supervisor',
  },
]

export default function DuePage() {
  return (
    <>
      <section className="mb-6">
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          <AuditOutlined /> DUE ขออนุมัติใช้ยา
        </Title>
        <div className="mb-4 h-px w-24 bg-linear-to-r from-violet-400/70 to-transparent" />
        {/* ไม่มีปุ่มลัดตรงนี้ — การ์ดใบแรกด้านล่างกดเข้าหน้าเดียวกันอยู่แล้ว
            มีสองทางเข้าที่ทำอย่างเดียวกันบนหน้าเดียวกันทำให้อ่านลำดับขั้นตอนสับสน */}
        <Paragraph type="secondary" style={{ maxWidth: 760, marginBottom: 0 }}>
          Drug Use Evaluation — แพทย์สั่งยากลุ่ม DUE เภสัชกรรับรายการมาวิเคราะห์ความสมเหตุสมผล
          ทั้งของการสั่งใช้และของวิธีใช้ยา และแพทย์ผู้กำกับเป็นผู้อนุมัติรายการยาบางประเภท
          ก่อนนำไปใช้กับผู้ป่วย
        </Paragraph>
      </section>

      <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {STEPS.map(step => {
          const card = (
            <Card
              hoverable={step.href != null}
              variant="borderless"
              className="h-full border! border-line!"
            >
              <div className="mb-2 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-accent-soft text-base text-accent">
                  {step.icon}
                </div>
                <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
                  {step.title}
                  {step.href ? (
                    <RightOutlined className="shrink-0 text-[10px] text-accent/60" />
                  ) : (
                    <Tag className="mr-0!">ยังไม่เปิด</Tag>
                  )}
                </div>
              </div>
              <p className="text-xs leading-relaxed text-ink-3">{step.desc}</p>
            </Card>
          )
          // การ์ดที่มีหน้าจอแล้วเท่านั้นที่ห่อด้วยลิงก์ ใบที่ยังไม่มีหน้าจอกดแล้วจะ 404
          return step.href ? (
            <Link key={step.title} href={step.href}>
              {card}
            </Link>
          ) : (
            <div key={step.title}>{card}</div>
          )
        })}
      </section>

      {/* แยกออกจากการ์ดขั้นตอน เพราะไม่ใช่ขั้นหนึ่งของการทำงานกับคำขอรายใบ
          แต่เป็นการสรุปผลของทั้งสามขั้นรวมกัน คนละกลุ่มผู้ใช้ คนละความถี่ */}
      {/* ใช้กริดชุดเดียวกับการ์ดขั้นตอน การ์ดจึงกว้างเท่ากันพอดี
          ถ้าปล่อยเต็มความกว้างจะดูเหมือนเป็นแบนเนอร์คนละระดับกับที่เหลือ */}
      <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Link href="/home/due/dashboard">
          <Card hoverable variant="borderless" className="h-full border! border-line!">
            <div className="mb-2 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-accent-soft text-base text-accent">
                <DashboardOutlined />
              </div>
              <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
                ภาพรวมและตัวชี้วัด
                <RightOutlined className="shrink-0 text-[10px] text-accent/60" />
              </div>
            </div>
            <p className="text-xs leading-relaxed text-ink-3">
              เส้นทางของคำขอ งานค้าง เวลารอคอย ความเหมาะสมของการใช้ยา DRPs
              และปริมาณการใช้ยาต้านจุลชีพ
            </p>
          </Card>
        </Link>

        {/* แดชบอร์ดไว้ดูบนจอ ส่วนรายงานคือเอกสารที่ต้องส่งออกไปนอกระบบ
            (เข้าที่ประชุม ส่ง สปสช. เก็บเข้าแฟ้ม) จึงเป็นคนละหน้ากัน */}
        <Card variant="borderless" className="h-full border! border-line!">
          <div className="mb-2 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-accent-soft text-base text-accent">
              <FileTextOutlined />
            </div>
            <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
              รายงาน
              <Tag className="mr-0!">ยังไม่เปิด</Tag>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-ink-3">
            ออกรายงานสรุปตามรอบเพื่อส่งคณะกรรมการควบคุมการใช้ยาต้านจุลชีพ — เลือกช่วงเวลา
            แล้วสั่งพิมพ์หรือบันทึกเป็นไฟล์
          </p>
        </Card>
      </section>

      {/* เมนูอื่นในระบบอ่านจาก HIS อย่างเดียว เมนูนี้เป็นเมนูแรกที่ต้องเก็บข้อมูลของตัวเอง
          จึงต้องตกลงเรื่องที่เก็บและสิทธิ์ผู้ใช้ก่อน ยังไม่เขียนโค้ดส่วนบันทึกคำขอ */}
      <Alert
        type="info"
        showIcon
        className="mb-6"
        title="ทำแล้วเฉพาะส่วนดึงข้อมูลผู้ป่วย ยังบันทึกคำขอไม่ได้"
        description={
          <div className="text-xs leading-relaxed">
            ต่างจากเมนูอื่นที่อ่านข้อมูลจาก HIS อย่างเดียว เมนูนี้ต้อง{' '}
            <b>บันทึกข้อมูลของตัวเอง</b> (คำขอ ผลวิเคราะห์ การอนุมัติ) และต้องรู้ว่าใครเป็น
            แพทย์ / เภสัชกร / แพทย์ผู้กำกับ ยังต้องตกลงสามเรื่องนี้ก่อนจึงจะทำต่อได้
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Tag>ที่เก็บข้อมูล</Tag>
              <Tag>สิทธิ์ตามบทบาทผู้ใช้</Tag>
              <Tag>รายการยาที่นับเป็น DUE</Tag>
            </div>
          </div>
        }
      />

      <Empty description="ยังไม่มีรายการคำขอ" />
    </>
  )
}
