'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ยังทำที่ app/home/layout.tsx ซึ่งเป็น Server Component)
import Link from 'next/link'
import { Breadcrumb, Empty, Typography } from 'antd'
import { CloudOutlined } from '@ant-design/icons'
import PageHint from '../../page-hint'

const { Title } = Typography

/**
 * Service Plan สาขาโรคปอดอุดกั้นเรื้อรัง — หน้าเปล่าที่ทำโครงไว้ก่อน
 *
 * ยังไม่ดึงข้อมูลอะไรเลย เพราะยังไม่ได้ตกลงว่าตัวชี้วัดของสาขานี้นับจากอะไร
 * (รหัสโรค รหัสยาสูดพ่น หรือทะเบียนผู้ป่วย) และเป้าหมายเท่าไร
 */
export default function ServicePlanCopdPage() {
  return (
    <>
      <section className="mb-6">
        <Breadcrumb
          className="mb-2"
          items={[
            { title: <Link href="/home/service-plan">Service Plan</Link> },
            { title: 'สาขาโรคปอดอุดกั้นเรื้อรัง' },
          ]}
        />
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          <CloudOutlined /> สาขาโรคปอดอุดกั้นเรื้อรัง (COPD)
          <PageHint>
            ตัวชี้วัดงานเภสัชกรรมในสาขาโรคปอดอุดกั้นเรื้อรัง — ยังเป็นหน้าเปล่า
          </PageHint>
        </Title>
        <div className="h-px w-24 bg-linear-to-r from-violet-400/70 to-transparent" />
      </section>

      <Empty description="ยังไม่มีข้อมูลในหน้านี้" />
    </>
  )
}
