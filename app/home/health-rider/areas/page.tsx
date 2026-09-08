'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ยังทำที่ app/home/layout.tsx ซึ่งเป็น Server Component)
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Alert,
  Breadcrumb,
  Button,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Spin,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { DeleteOutlined, EnvironmentOutlined, PlusOutlined } from '@ant-design/icons'
import { apiFetch } from '@/lib/client/session'
import type { RiderArea, RiderStaff, Tambon } from '@/lib/his/health-rider'

const { Text, Title } = Typography

/**
 * ตัวเลือกหมู่ที่ 1-30 — พิมพ์เองได้ด้วยเผื่อมีหมู่นอกช่วงนี้
 *
 * ป้ายเป็นตัวเลขล้วน ไม่มีคำว่า "หมู่" นำหน้า เพราะค่าที่บันทึกลงคอลัมน์ moo
 * เป็นตัวเลขล้วน ป้ายที่ต่างจากค่าจริงทำให้เข้าใจผิดว่าเก็บคำว่าหมู่ไปด้วย
 */
const MOO_OPTIONS = Array.from({ length: 30 }, (_, index) => ({
  value: String(index + 1),
  label: String(index + 1),
}))

type AreaForm = {
  tambonId: string
  moos: string[]
  prefix: string
}

const fullName = (staff: RiderStaff) =>
  [staff.pname, staff.fname, staff.lname].filter(Boolean).join(' ') || `รหัส ${staff.id}`

/**
 * จัดการพื้นที่รับผิดชอบของเจ้าหน้าที่ส่งยา (fiat_pyhos_health_rider_send)
 *
 * หนึ่งแถวคือหนึ่งหมู่ — เจ้าหน้าที่หนึ่งคนรับผิดชอบได้หลายหมู่หลายตำบล
 * เพิ่มและลบได้ทีละแถว การลบถามยืนยันก่อนเสมอเพราะฐานไม่มีที่กู้คืนให้
 */
export default function HealthRiderAreasPage() {
  const [staff, setStaff] = useState<RiderStaff[]>([])
  const [tambons, setTambons] = useState<Tambon[]>([])
  const [riderId, setRiderId] = useState<number | null>(null)
  const [areas, setAreas] = useState<RiderArea[]>([])
  const [loading, setLoading] = useState(true)
  const [areaLoading, setAreaLoading] = useState(false)
  const [error, setError] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  /** id ของแถวที่กำลังลบ ใช้ล็อกปุ่มเฉพาะแถวนั้น ไม่ใช่ทั้งตาราง */
  const [removingId, setRemovingId] = useState<number | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [removingBatch, setRemovingBatch] = useState(false)
  const [form] = Form.useForm<AreaForm>()
  const [toast, toastHolder] = message.useMessage()

  const loadAreas = useCallback(async (rider: number) => {
    const res = await apiFetch(`/api/his/health-rider/areas?rider=${rider}`)
    const json = await res.json()
    if (!res.ok || !json.success) throw new Error(json.message ?? 'ดึงพื้นที่รับผิดชอบไม่สำเร็จ')
    return json.areas as RiderArea[]
  }, [])

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const [staffRes, tambonRes] = await Promise.all([
          apiFetch('/api/his/health-rider/staff'),
          apiFetch('/api/his/health-rider/tambons'),
        ])
        const staffJson = await staffRes.json()
        const tambonJson = await tambonRes.json()
        if (!alive) return
        if (!staffRes.ok || !staffJson.success) {
          setError(staffJson.message ?? 'ดึงรายชื่อเจ้าหน้าที่ไม่สำเร็จ')
          return
        }
        setStaff(staffJson.staff as RiderStaff[])
        if (tambonRes.ok && tambonJson.success) setTambons(tambonJson.tambons as Tambon[])
      } catch {
        if (alive) setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
      } finally {
        if (alive) setLoading(false)
      }
    }
    void load()
    return () => {
      alive = false
    }
  }, [])

  const pickRider = async (value: number) => {
    setRiderId(value)
    setAreaLoading(true)
    setAreas([])
    // รายการที่เลือกไว้เป็นของเจ้าหน้าที่คนเดิม ต้องล้างก่อนเปลี่ยนคน
    setSelected([])
    try {
      setAreas(await loadAreas(value))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ดึงพื้นที่รับผิดชอบไม่สำเร็จ')
    } finally {
      setAreaLoading(false)
    }
  }

  const submit = async (values: AreaForm) => {
    if (riderId == null) return
    setSaving(true)
    try {
      const res = await apiFetch('/api/his/health-rider/areas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rider: riderId, ...values }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        toast.error(json.message ?? 'เพิ่มพื้นที่รับผิดชอบไม่สำเร็จ')
        return
      }
      // บอกทั้งที่เพิ่มได้และที่ข้ามเพราะมีอยู่แล้ว — ถ้าบอกแค่ "สำเร็จ"
      // ผู้ใช้จะไม่รู้ว่าหมู่ที่เลือกไว้บางตัวไม่ได้ถูกเพิ่ม
      const skipped = (json.skipped as string[]) ?? []
      if (json.added > 0) toast.success(`เพิ่ม ${json.added} หมู่แล้ว`)
      if (skipped.length > 0) toast.info(`ข้าม ${skipped.length} หมู่ที่มีอยู่แล้ว (${skipped.join(', ')})`)
      if (json.added === 0 && skipped.length === 0) toast.info('ไม่มีรายการที่ต้องเพิ่ม')
      setAddOpen(false)
      form.resetFields()
      setAreas(await loadAreas(riderId))
    } catch {
      toast.error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setSaving(false)
    }
  }

  /**
   * ลบพื้นที่ตาม id ที่ส่งมา ใช้ร่วมกันทั้งปุ่มในแถวและปุ่มลบตามที่เลือก
   *
   * ไม่ตัดแถวออกจาก state เองเพราะถ้าฝั่งฐานลบไม่สำเร็จจริง หน้าจอจะโกหกว่าลบแล้ว
   * คืนค่าว่าสำเร็จไหม เพื่อให้ผู้เรียกตัดสินใจได้ว่าจะล้างรายการที่เลือกไว้หรือไม่
   */
  const removeByIds = async (ids: number[], done: string) => {
    if (riderId == null || ids.length === 0) return false
    try {
      const res = await apiFetch(
        `/api/his/health-rider/areas?ids=${ids.join(',')}&rider=${riderId}`,
        { method: 'DELETE' },
      )
      const json = await res.json()
      if (!res.ok || !json.success) {
        toast.error(json.message ?? 'ลบพื้นที่รับผิดชอบไม่สำเร็จ')
        return false
      }
      // จำนวนที่ลบได้จริงมาจากเซิร์ฟเวอร์ อาจน้อยกว่าที่เลือกถ้ามีคนอื่นลบไปก่อน
      const removed = Number(json.removed ?? ids.length)
      toast.success(removed === ids.length ? done : `ลบได้ ${removed} จาก ${ids.length} รายการ`)
      setAreas(await loadAreas(riderId))
      return true
    } catch {
      toast.error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
      return false
    }
  }

  const removeArea = async (area: RiderArea) => {
    setRemovingId(area.id)
    const label = `${area.tambonName ?? area.tambonId ?? 'พื้นที่'} หมู่ ${area.moo ?? '—'}`
    try {
      // ลบแถวที่ติ๊กไว้ออกจากรายการที่เลือกด้วย ไม่งั้นจะค้างเป็นแถวที่ไม่มีอยู่แล้ว
      if (await removeByIds([area.id], `ลบ ${label} แล้ว`)) {
        setSelected(current => current.filter(id => id !== area.id))
      }
    } finally {
      setRemovingId(null)
    }
  }

  const removeSelected = async () => {
    setRemovingBatch(true)
    try {
      if (await removeByIds(selected, `ลบ ${selected.length} รายการแล้ว`)) setSelected([])
    } finally {
      setRemovingBatch(false)
    }
  }

  const rider = staff.find(item => item.id === riderId) ?? null

  /** จำนวนตำบลที่ดูแล ใช้สรุปให้เห็นภาพก่อนไล่อ่านตาราง */
  const tambonCount = useMemo(
    () => new Set(areas.map(area => area.tambonId).filter(Boolean)).size,
    [areas],
  )

  const columns: ColumnsType<RiderArea> = [
    {
      title: 'ตำบล',
      dataIndex: 'tambonName',
      width: 220,
      render: (name: string | null, row) =>
        name ? (
          <span className="text-xs text-ink">{name}</span>
        ) : (
          // รหัสตำบลไม่ตรงกับตารางที่อยู่ — ต้องเห็นว่าเป็นข้อมูลที่ผิด
          <Tag color="orange" className="mr-0!">
            ไม่พบตำบล {row.tambonId ?? '—'}
          </Tag>
        ),
    },
    {
      title: 'รหัสตำบล',
      dataIndex: 'tambonId',
      width: 110,
      render: (id: string | null) => <span className="font-mono text-xs">{id ?? '—'}</span>,
    },
    {
      title: 'หมู่ที่',
      dataIndex: 'moo',
      width: 90,
      render: (moo: string | null) => <span className="font-mono text-xs">{moo ?? '—'}</span>,
    },
    {
      title: 'ชื่อพื้นที่',
      dataIndex: 'prefix',
      render: (prefix: string | null) =>
        prefix ? (
          <span className="text-xs text-ink">{prefix}</span>
        ) : (
          <Text type="secondary" className="text-xs">
            —
          </Text>
        ),
    },
    {
      title: '',
      key: 'remove',
      width: 56,
      align: 'right',
      render: (_, row) => (
        <Popconfirm
          title="ลบพื้นที่รับผิดชอบ"
          description={
            <span className="text-xs">
              {row.tambonName ?? row.tambonId ?? 'ไม่พบตำบล'} หมู่ {row.moo ?? '—'} — ลบแล้วกู้คืนไม่ได้
            </span>
          }
          okText="ลบ"
          cancelText="ยกเลิก"
          okButtonProps={{ danger: true }}
          onConfirm={() => removeArea(row)}
        >
          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined />}
            loading={removingId === row.id}
            aria-label="ลบพื้นที่รับผิดชอบ"
          />
        </Popconfirm>
      ),
    },
  ]

  return (
    <>
      {toastHolder}
      <section className="mb-6">
        <Breadcrumb
          className="mb-2"
          items={[
            { title: <Link href="/home/health-rider">Health Rider</Link> },
            { title: 'จัดการรับผิดชอบพื้นที่ส่งยา' },
          ]}
        />
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          <EnvironmentOutlined /> จัดการรับผิดชอบพื้นที่ส่งยา
        </Title>
        <div className="mb-2 h-px w-24 bg-linear-to-r from-violet-400/70 to-transparent" />
        <Text type="secondary" className="text-xs">
          เลือกเจ้าหน้าที่เพื่อดูพื้นที่ที่รับผิดชอบ — หนึ่งแถวคือหนึ่งหมู่ เพิ่มและลบได้ทีละแถว
        </Text>
      </section>

      {error && <Alert type="error" showIcon title={error} className="mb-4" />}

      {/* ช่องเลือกเจ้าหน้าที่กับปุ่มเพิ่มอยู่แถวเดียวกัน แบบเดียวกับหน้าทะเบียนเจ้าหน้าที่ */}
      <section className="mb-4 flex flex-wrap items-center gap-3">
        <Select
          showSearch
          loading={loading}
          className="min-w-64 flex-1 sm:max-w-96"
          placeholder="เลือกเจ้าหน้าที่"
          value={riderId}
          onChange={value => void pickRider(value)}
          optionFilterProp="label"
          options={staff.map(item => ({
            value: item.id,
            label: `${fullName(item)}${item.roleName ? ` · ${item.roleName}` : ''}`,
          }))}
        />
        {rider && (
          <Text type="secondary" className="ml-auto text-xs">
            รับผิดชอบ {areas.length} หมู่ · {tambonCount} ตำบล
          </Text>
        )}
        {/* ปุ่มโผล่เมื่อเลือกเจ้าหน้าที่แล้วเท่านั้น แทนการขึ้นมาแบบกดไม่ได้ — ค่า
            disabled ที่ต่างกันระหว่างสองฝั่งเป็นต้นเหตุของคำเตือน hydration
            (ฝั่งเซิร์ฟเวอร์ไม่ใส่แอตทริบิวต์ ฝั่ง client ใส่ true) */}
        {riderId != null && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
            เพิ่มพื้นที่รับผิดชอบ
          </Button>
        )}
      </section>

      {riderId == null ? (
        <section className="rounded-2xl border border-line bg-panel p-8 backdrop-blur">
          <Empty description="เลือกเจ้าหน้าที่เพื่อดูพื้นที่รับผิดชอบ" />
        </section>
      ) : (
        <section className="data-sheet rounded-2xl border border-line bg-panel p-2 backdrop-blur">
          {/* แถบนี้โผล่เฉพาะตอนมีแถวถูกเลือก จะได้ไม่กินที่ตอนใช้งานปกติ */}
          {selected.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-panel px-3 py-2">
              <Text className="text-xs">เลือกไว้ {selected.length} รายการ</Text>
              <Button size="small" type="text" onClick={() => setSelected([])}>
                ล้างที่เลือก
              </Button>
              <Popconfirm
                title={`ลบ ${selected.length} รายการที่เลือก`}
                description={<span className="text-xs">ลบแล้วกู้คืนไม่ได้</span>}
                okText="ลบ"
                cancelText="ยกเลิก"
                okButtonProps={{ danger: true }}
                onConfirm={() => removeSelected()}
              >
                <Button
                  size="small"
                  danger
                  type="primary"
                  icon={<DeleteOutlined />}
                  loading={removingBatch}
                  className="ml-auto"
                >
                  ลบตามที่เลือก
                </Button>
              </Popconfirm>
            </div>
          )}
          <Spin spinning={areaLoading}>
            <Table<RiderArea>
              rowKey="id"
              size="small"
              columns={columns}
              dataSource={areas}
              rowSelection={{
                selectedRowKeys: selected,
                onChange: keys => setSelected(keys.map(Number)),
              }}
              pagination={{ pageSize: 25, showSizeChanger: false, hideOnSinglePage: true }}
              scroll={{ x: 'max-content' }}
              locale={{
                emptyText: (
                  <Empty
                    description={areaLoading ? 'กำลังโหลด' : 'เจ้าหน้าที่คนนี้ยังไม่มีพื้นที่รับผิดชอบ'}
                  />
                ),
              }}
            />
          </Spin>
        </section>
      )}

      <Modal
        title={rider ? `เพิ่มพื้นที่รับผิดชอบ · ${fullName(rider)}` : 'เพิ่มพื้นที่รับผิดชอบ'}
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={() => form.submit()}
        okText="บันทึก"
        cancelText="ยกเลิก"
        confirmLoading={saving}
        width={520}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={values => void submit(values)}>
          <Form.Item
            label="ตำบล"
            name="tambonId"
            rules={[{ required: true, message: 'กรุณาเลือกตำบล' }]}
          >
            <Select
              showSearch
              // รายการจำกัดเฉพาะอำเภอที่ตั้งไว้ใน .env (HEALTH_RIDER_AMPHUR_ID)
              placeholder="เลือกตำบล"
              notFoundContent="ไม่พบตำบลในอำเภอที่รับผิดชอบ"
              optionFilterProp="label"
              // เติมชื่อพื้นที่ให้อัตโนมัติจากชื่อตำบล แก้ทับได้ถ้าอยากใส่ชื่อชุมชนแทน
              onChange={(value: string) => {
                const tambon = tambons.find(item => item.id === value)
                if (tambon) form.setFieldValue('prefix', tambon.name)
              }}
              options={tambons.map(item => ({
                value: item.id,
                label: item.fullName ?? item.name,
              }))}
            />
          </Form.Item>

          <Form.Item
            label="หมู่ที่"
            name="moos"
            extra="เลือกได้หลายหมู่พร้อมกัน หรือพิมพ์เลขหมู่ที่ไม่มีในรายการแล้วกด Enter"
            rules={[{ required: true, message: 'กรุณาเลือกหมู่ที่' }]}
          >
            <Select mode="tags" placeholder="เช่น 1, 2, 5" options={MOO_OPTIONS} tokenSeparators={[',']} />
          </Form.Item>

          <Form.Item
            label="ชื่อพื้นที่"
            name="prefix"
            extra="ค่าเริ่มต้นคือชื่อตำบล แก้เป็นชื่อชุมชนได้ตามที่ใช้จริง"
          >
            <Input maxLength={150} placeholder="ชื่อตำบลหรือชื่อชุมชน" />
          </Form.Item>

          <Alert
            type="info"
            showIcon
            title="หมู่ที่มีอยู่แล้วจะถูกข้ามให้อัตโนมัติ"
            description={
              <span className="text-xs">
                ตารางนี้ไม่มีตัวกันซ้ำในฐาน ระบบจึงเช็คให้ก่อนบันทึก และจะบอกว่าข้ามหมู่ไหนไปบ้าง
              </span>
            }
          />
        </Form>
      </Modal>
    </>
  )
}
