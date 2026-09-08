'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ยังทำที่ app/home/layout.tsx ซึ่งเป็น Server Component)
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Alert,
  AutoComplete,
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
import {
  PlusOutlined,
  SearchOutlined,
  StopOutlined,
  UndoOutlined,
  UserAddOutlined,
} from '@ant-design/icons'
import { apiFetch } from '@/lib/client/session'
import type { RiderRole, RiderStaff } from '@/lib/his/health-rider'

const { Text, Title } = Typography

/** คำนำหน้าที่ใช้บ่อย — เลือกได้และพิมพ์เองได้ ไม่ได้บังคับให้อยู่ในรายการ */
const PNAME_OPTIONS = ['นาย', 'นาง', 'นางสาว'].map(value => ({ value }))

type StaffForm = {
  pname?: string
  fname: string
  lname: string
  cid: string
  role: number
}

/**
 * ทะเบียนเจ้าหน้าที่ส่งยา (fiat_pyhos_health_rider_users)
 *
 * ตารางต้นทางเก็บเลขบัตรประชาชน เบอร์โทร เลขบัญชีธนาคาร และรหัสผ่านไว้ด้วย
 * แต่ API คัดออกตั้งแต่ชั้นเซิร์ฟเวอร์ หน้านี้จึงได้มาเฉพาะชื่อ ประเภท และสถานะ
 *
 * เพิ่มคนใหม่และปิด/เปิดสถานะได้ แต่ไม่มีปุ่มลบ — id ถูกอ้างอิงในตารางพื้นที่
 * รับผิดชอบและประวัติการส่งยา ลบทิ้งแล้วข้อมูลเก่าจะชี้ไปยังคนที่ไม่มีอยู่
 */
export default function HealthRiderStaffPage() {
  const [staff, setStaff] = useState<RiderStaff[]>([])
  const [roles, setRoles] = useState<RiderRole[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  /** รหัสของแถวที่กำลังเปลี่ยนสถานะ ใช้ล็อกปุ่มเฉพาะแถวนั้น ไม่ใช่ทั้งตาราง */
  const [togglingId, setTogglingId] = useState<number | null>(null)
  const [form] = Form.useForm<StaffForm>()
  const [toast, toastHolder] = message.useMessage()

  const loadStaff = useCallback(async () => {
    const res = await apiFetch('/api/his/health-rider/staff')
    const json = await res.json()
    if (!res.ok || !json.success) throw new Error(json.message ?? 'ดึงรายชื่อเจ้าหน้าที่ไม่สำเร็จ')
    return json.staff as RiderStaff[]
  }, [])

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        // ดึงประเภทมาพร้อมกัน เพราะฟอร์มเพิ่มเจ้าหน้าที่ต้องใช้เป็นตัวเลือก
        const [list, roleRes] = await Promise.all([
          loadStaff(),
          apiFetch('/api/his/health-rider/roles'),
        ])
        const roleJson = await roleRes.json()
        if (!alive) return
        setStaff(list)
        if (roleRes.ok && roleJson.success) setRoles(roleJson.roles as RiderRole[])
      } catch (err) {
        if (alive) {
          setError(err instanceof Error ? err.message : 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่')
        }
      } finally {
        if (alive) setLoading(false)
      }
    }
    void load()
    // กันตั้ง state หลังผู้ใช้เปลี่ยนหน้าไปแล้ว
    return () => {
      alive = false
    }
  }, [loadStaff])

  const submit = async (values: StaffForm) => {
    setSaving(true)
    try {
      const res = await apiFetch('/api/his/health-rider/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        toast.error(json.message ?? 'เพิ่มเจ้าหน้าที่ไม่สำเร็จ')
        return
      }
      toast.success(`เพิ่มเจ้าหน้าที่แล้ว (รหัส ${json.id})`)
      setAddOpen(false)
      form.resetFields()
      // โหลดรายชื่อใหม่ทั้งชุด ไม่ต่อแถวเองที่ฝั่งหน้าจอ — เลข id กับชื่อประเภท
      // มาจากฐาน ถ้าเดาเองแล้วไม่ตรงจะเห็นข้อมูลผิดจนกว่าจะรีเฟรช
      setStaff(await loadStaff())
    } catch {
      toast.error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setSaving(false)
    }
  }

  /**
   * ปิดหรือเปิดสถานะใช้งานของเจ้าหน้าที่หนึ่งคน
   *
   * โหลดรายชื่อใหม่หลังบันทึกแทนการแก้ state เอง ถ้าฝั่งฐานไม่ได้เปลี่ยนจริง
   * หน้าจอจะได้ไม่แสดงสถานะที่ไม่ตรงกับฐาน
   */
  const toggleActive = async (row: RiderStaff) => {
    const next = row.active === 'Y' ? 'N' : 'Y'
    setTogglingId(row.id)
    try {
      const res = await apiFetch('/api/his/health-rider/staff', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, active: next }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        toast.error(json.message ?? 'เปลี่ยนสถานะไม่สำเร็จ')
        return
      }
      toast.success(next === 'N' ? 'ปิดสถานะการใช้งานแล้ว' : 'เปิดสถานะการใช้งานแล้ว')
      setStaff(await loadStaff())
    } catch {
      toast.error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setTogglingId(null)
    }
  }

  const visible = useMemo(() => {
    const term = keyword.trim().toLowerCase()
    if (!term) return staff
    return staff.filter(row =>
      [row.pname, row.fname, row.lname, row.roleName, String(row.id)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term),
    )
  }, [staff, keyword])

  const columns: ColumnsType<RiderStaff> = [
    {
      title: 'รหัส',
      dataIndex: 'id',
      width: 90,
      render: (id: number) => <span className="font-mono text-xs">{id}</span>,
    },
    {
      title: 'ชื่อ-สกุล',
      dataIndex: 'fname',
      // ชื่อกับสกุลอยู่คนละคอลัมน์ในฐาน แต่คนอ่านมองเป็นค่าเดียว จึงต่อกันตรงนี้
      render: (_: string, row) => {
        const full = [row.pname, row.fname, row.lname].filter(Boolean).join(' ')
        return full || <Text type="secondary">— ไม่ได้ระบุ —</Text>
      },
    },
    {
      title: 'ประเภทเจ้าหน้าที่',
      dataIndex: 'roleName',
      width: 280,
      render: (roleName: string | null) =>
        roleName ? (
          <Tag className="mr-0!">{roleName}</Tag>
        ) : (
          // รหัสประเภทไม่ตรงกับตารางอ้างอิง — ต้องเห็นว่าเป็นข้อมูลที่ผิด ไม่ใช่แค่ช่องว่าง
          <Tag color="orange" className="mr-0!">
            ไม่พบประเภท
          </Tag>
        ),
    },
    {
      title: 'สถานะ',
      dataIndex: 'active',
      width: 120,
      render: (active: string | null) =>
        active === 'Y' ? (
          <Tag color="green" className="mr-0!">
            ใช้งาน
          </Tag>
        ) : (
          <Tag className="mr-0!">ปิดใช้งาน</Tag>
        ),
    },
    {
      title: '',
      key: 'toggle',
      width: 130,
      align: 'right',
      // ปิดแล้วเปิดคืนได้จากปุ่มเดียวกัน คนกดผิดจึงแก้เองได้ทันที
      render: (_, row) => {
        const closing = row.active === 'Y'
        return (
          <Popconfirm
            title={closing ? 'ปิดสถานะการใช้งาน' : 'เปิดสถานะการใช้งาน'}
            description={
              <span className="text-xs">
                {[row.pname, row.fname, row.lname].filter(Boolean).join(' ') || `รหัส ${row.id}`}
                {closing
                  ? ' — จะไม่ถือว่าเป็นเจ้าหน้าที่ที่ปฏิบัติงานอยู่ พื้นที่รับผิดชอบเดิมยังอยู่ครบ'
                  : ' — กลับมาเป็นเจ้าหน้าที่ที่ปฏิบัติงานอยู่'}
              </span>
            }
            okText={closing ? 'ปิดสถานะ' : 'เปิดสถานะ'}
            cancelText="ยกเลิก"
            okButtonProps={{ danger: closing }}
            onConfirm={() => toggleActive(row)}
          >
            <Button
              type="text"
              size="small"
              danger={closing}
              loading={togglingId === row.id}
              icon={closing ? <StopOutlined /> : <UndoOutlined />}
            >
              {closing ? 'ปิดสถานะ' : 'เปิดสถานะ'}
            </Button>
          </Popconfirm>
        )
      },
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
            { title: 'เพิ่มเจ้าหน้าที่' },
          ]}
        />
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          <UserAddOutlined /> เพิ่มเจ้าหน้าที่
        </Title>
        <div className="mb-2 h-px w-24 bg-linear-to-r from-violet-400/70 to-transparent" />
        <Text type="secondary" className="text-xs">
          รายชื่อเจ้าหน้าที่ส่งยาจากฐาน HIS — เพิ่มคนใหม่และปิด/เปิดสถานะได้ ไม่มีการลบทิ้ง
        </Text>
      </section>

      {error && <Alert type="error" showIcon title={error} className="mb-4" />}

      {/* ช่องค้นหา จำนวน และปุ่มเพิ่ม อยู่แถวเดียวกัน — ช่องค้นหายืดตามที่ว่าง
          ที่เหลือชิดขวา จอแคบมากค่อยตกบรรทัด */}
      <section className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          allowClear
          className="min-w-56 flex-1 sm:max-w-80"
          value={keyword}
          onChange={event => setKeyword(event.target.value)}
          placeholder="ค้นหาชื่อ หรือประเภทเจ้าหน้าที่"
          prefix={<SearchOutlined className="text-ink-3" />}
        />
        <Text type="secondary" className="ml-auto text-xs">
          {keyword.trim()
            ? `พบ ${visible.length} จาก ${staff.length} คน`
            : `ทั้งหมด ${staff.length} คน`}
        </Text>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
          เพิ่มเจ้าหน้าที่
        </Button>
      </section>

      <section className="data-sheet rounded-2xl border border-line bg-panel p-2 backdrop-blur">
        <Spin spinning={loading}>
          <Table<RiderStaff>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={visible}
            // 91 คนยาวเกินกว่าจะไล่ดูรวดเดียว แบ่งหน้าไว้แต่ยังค้นข้ามทั้งชุดได้จากช่องด้านบน
            pagination={{ pageSize: 25, showSizeChanger: false, hideOnSinglePage: true }}
            scroll={{ x: 'max-content' }}
            locale={{
              emptyText: (
                <Empty
                  description={
                    loading
                      ? 'กำลังโหลด'
                      : keyword.trim()
                        ? 'ไม่พบเจ้าหน้าที่ตามคำค้น'
                        : 'ไม่มีข้อมูลเจ้าหน้าที่'
                  }
                />
              ),
            }}
          />
        </Spin>
      </section>

      {/* ───────── ฟอร์มเพิ่มเจ้าหน้าที่ ─────────
          ไม่มีช่อง id เพราะคอลัมน์เป็น auto_increment ให้ฐานแจกเลขเอง
          และไม่มีช่อง active เพราะตกลงกันว่าเพิ่มใหม่เป็น 'Y' เสมอ */}
      <Modal
        title="เพิ่มเจ้าหน้าที่"
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
          <Form.Item label="คำนำหน้า" name="pname">
            <AutoComplete
              options={PNAME_OPTIONS}
              placeholder="นาย / นาง / นางสาว"
              filterOption={(input, option) => (option?.value ?? '').includes(input)}
            />
          </Form.Item>

          <Form.Item
            label="ชื่อ"
            name="fname"
            rules={[{ required: true, message: 'กรุณากรอกชื่อ' }]}
          >
            <Input placeholder="ชื่อจริง" maxLength={150} />
          </Form.Item>

          <Form.Item
            label="นามสกุล"
            name="lname"
            rules={[{ required: true, message: 'กรุณากรอกนามสกุล' }]}
          >
            <Input placeholder="นามสกุล" maxLength={100} />
          </Form.Item>

          <Form.Item
            label="เลขบัตรประชาชน"
            name="cid"
            // ตรวจหลักตรวจสอบตั้งแต่ในฟอร์ม จะได้รู้ตั้งแต่ยังไม่กดบันทึก
            // (ฝั่งเซิร์ฟเวอร์ตรวจซ้ำอีกชั้น ไม่ได้เชื่อการตรวจฝั่งเบราว์เซอร์)
            rules={[
              { required: true, message: 'กรุณากรอกเลขบัตรประชาชน' },
              {
                validator: (_, value: string) =>
                  isValidCid(String(value ?? ''))
                    ? Promise.resolve()
                    : Promise.reject(new Error('เลขบัตรประชาชนไม่ถูกต้อง')),
              },
            ]}
          >
            <Input placeholder="13 หลัก" maxLength={17} inputMode="numeric" />
          </Form.Item>

          <Form.Item
            label="ประเภทเจ้าหน้าที่"
            name="role"
            rules={[{ required: true, message: 'กรุณาเลือกประเภทเจ้าหน้าที่' }]}
          >
            <Select
              placeholder="เลือกประเภท"
              options={roles.map(role => ({ value: role.id, label: role.name ?? `รหัส ${role.id}` }))}
            />
          </Form.Item>

          <Alert
            type="info"
            showIcon
            title="สถานะของคนที่เพิ่มใหม่จะเป็น ใช้งาน (Y) เสมอ"
            description={
              <span className="text-xs">
                ยังไม่ได้ตั้งชื่อผู้ใช้และรหัสผ่านให้ — คนที่เพิ่มจากหน้านี้จึงยังล็อกอิน
                เข้าแอปฝั่งผู้ส่งยาไม่ได้
              </span>
            }
          />
        </Form>
      </Modal>
    </>
  )
}

/**
 * ตรวจเลขบัตรประชาชนด้วยหลักตรวจสอบหลักที่ 13
 *
 * เขียนซ้ำฝั่งเบราว์เซอร์เพราะตัวในฝั่งเซิร์ฟเวอร์อยู่ในโมดูล server-only
 * ดึงมาใช้ตรงนี้ไม่ได้ — สองที่ต้องใช้สูตรเดียวกัน ถ้าแก้ต้องแก้ทั้งคู่
 */
function isValidCid(raw: string): boolean {
  const cid = raw.replace(/\D/g, '')
  if (!/^\d{13}$/.test(cid)) return false
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(cid[i]) * (13 - i)
  return (11 - (sum % 11)) % 10 === Number(cid[12])
}
