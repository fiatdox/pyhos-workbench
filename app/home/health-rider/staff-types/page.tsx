'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ยังทำที่ app/home/layout.tsx ซึ่งเป็น Server Component)
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Alert, Breadcrumb, Empty, Spin, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { TagsOutlined } from '@ant-design/icons'
import { apiFetch } from '@/lib/client/session'
import type { RiderRole } from '@/lib/his/health-rider'

const { Text, Title } = Typography

/**
 * ประเภทเจ้าหน้าที่ส่งยา — อ่านอย่างเดียวจาก fiat_pyhos_health_rider_role
 *
 * ไม่มีปุ่มแก้ไข/ลบตามที่ตกลงกันไว้ และตอนนี้ก็ทำไม่ได้อยู่แล้วเพราะสิทธิ์
 * ที่แอปใช้ต่อฐาน HIS เป็นอ่านอย่างเดียว — ถ้าจะแก้จากหน้าเว็บต้องคุยเรื่องสิทธิ์ก่อน
 */
export default function HealthRiderStaffTypesPage() {
  const [roles, setRoles] = useState<RiderRole[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const res = await apiFetch('/api/his/health-rider/roles')
        const json = await res.json()
        if (!alive) return
        if (!res.ok || !json.success) {
          setError(json.message ?? 'ดึงประเภทเจ้าหน้าที่ไม่สำเร็จ')
          return
        }
        setRoles(json.roles as RiderRole[])
      } catch {
        if (alive) setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
      } finally {
        if (alive) setLoading(false)
      }
    }
    void load()
    // กันตั้ง state หลังผู้ใช้เปลี่ยนหน้าไปแล้ว
    return () => {
      alive = false
    }
  }, [])

  const columns: ColumnsType<RiderRole> = [
    {
      title: 'รหัส',
      dataIndex: 'id',
      width: 100,
      render: (id: number) => <span className="font-mono text-xs">{id}</span>,
    },
    {
      title: 'ชื่อประเภท',
      dataIndex: 'name',
      render: (name: string | null) =>
        name ?? <Text type="secondary">— ไม่ได้ระบุ —</Text>,
    },
    {
      title: 'คำนำหน้า',
      dataIndex: 'prefix',
      width: 220,
      // คำนำหน้าเป็นตัวที่เอาไปแสดงคู่กับชื่อเจ้าหน้าที่จริง ทำเป็นป้ายให้เห็นรูปแบบที่จะได้
      render: (prefix: string | null) =>
        prefix ? <Tag className="mr-0!">{prefix}</Tag> : <Text type="secondary">—</Text>,
    },
  ]

  return (
    <>
      <section className="mb-6">
        <Breadcrumb
          className="mb-2"
          items={[
            { title: <Link href="/home/health-rider">Health Rider</Link> },
            { title: 'ประเภทเจ้าหน้าที่' },
          ]}
        />
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          <TagsOutlined /> ประเภทเจ้าหน้าที่
        </Title>
        <div className="mb-2 h-px w-24 bg-linear-to-r from-violet-400/70 to-transparent" />
        <Text type="secondary" className="text-xs">
          ข้อมูลตั้งต้นจากฐาน HIS — หน้านี้ดูอย่างเดียว แก้ไขหรือลบไม่ได้
        </Text>
      </section>

      {error && <Alert type="error" showIcon title={error} className="mb-4" />}

      <section className="data-sheet rounded-2xl border border-line bg-panel p-2 backdrop-blur">
        <Spin spinning={loading}>
          <Table<RiderRole>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={roles}
            pagination={false}
            scroll={{ x: 'max-content' }}
            locale={{
              emptyText: <Empty description={loading ? 'กำลังโหลด' : 'ไม่มีข้อมูลประเภทเจ้าหน้าที่'} />,
            }}
          />
        </Spin>
      </section>
    </>
  )
}
