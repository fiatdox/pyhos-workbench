'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ทำที่ page.tsx ซึ่งเป็น Server Component และที่ API อีกชั้น)
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Alert,
  Breadcrumb,
  Button,
  DatePicker,
  Empty,
  Input,
  Segmented,
  Select,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { type Dayjs } from 'dayjs'
import { ReloadOutlined, SafetyCertificateOutlined, SearchOutlined } from '@ant-design/icons'
import { apiFetch } from '@/lib/client/session'
import ArchivePanel from './archive-panel'
import PageHint from '../../page-hint'
import { TableRowsSkeleton } from '@/app/home/skeletons'

const { RangePicker } = DatePicker
const { Text, Title } = Typography

type Row = {
  id: number
  at: string
  userId: number | null
  username: string | null
  fullName: string | null
  action: string
  method: string | null
  path: string
  feature: string | null
  targetHn: string | null
  detail: string | null
  clientIp: string | null
  device: string | null
}

type Summary = {
  total: number
  exports: number
  patientsTouched: number
  topUsers: { userId: number | null; name: string; count: number }[]
  byAction: { action: string; count: number }[]
  byFeature: { feature: string; count: number }[]
}

type Person = { userId: number; name: string }

/**
 * คำไทยของแต่ละประเภทเหตุการณ์ พร้อมสีที่สื่อความหมาย
 *
 * export เป็นสีแดงตั้งใจ — การนำข้อมูลออกจากระบบคือเหตุการณ์ที่ต้องสะดุดตาที่สุด
 * ในหน้านี้ ส่วน denied สีส้มคือการยิง API โดยไม่มีสิทธิ์ ซึ่งอาจเป็นแค่เซสชันหมดอายุ
 */
const ACTION_META: Record<string, { label: string; color: string }> = {
  page: { label: 'เปิดหน้า', color: 'default' },
  api: { label: 'ดึงข้อมูล', color: 'blue' },
  export: { label: 'ส่งออกไฟล์', color: 'red' },
  login: { label: 'เข้าสู่ระบบ', color: 'green' },
  logout: { label: 'ออกจากระบบ', color: 'default' },
  denied: { label: 'ถูกปฏิเสธ', color: 'orange' },
}

const ACTION_OPTIONS = [
  { label: 'ทั้งหมด', value: '' },
  { label: 'ส่งออกไฟล์', value: 'export' },
  { label: 'ดึงข้อมูล', value: 'api' },
  { label: 'เปิดหน้า', value: 'page' },
  { label: 'ถูกปฏิเสธ', value: 'denied' },
]

const toThaiDate = (value: Dayjs) => `${value.format('DD/MM')}/${value.year() + 543}`

const formatAt = (iso: string) => {
  const at = dayjs(iso)
  return `${toThaiDate(at)} ${at.format('HH:mm:ss')}`
}

export default function ActivityView() {
  const [toast, toastHolder] = message.useMessage()
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(6, 'day'), dayjs()])
  const [action, setAction] = useState('')
  const [userId, setUserId] = useState<number | null>(null)
  const [hn, setHn] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  /** ขยับเพื่อบังคับให้โหลดตารางใหม่ — ใช้หลังตัดข้อมูลเก่าออกไป */
  const [reloadKey, setReloadKey] = useState(0)

  const query = useCallback(
    (before?: number) => {
      const params = new URLSearchParams({
        from: range[0].format('YYYY-MM-DD'),
        to: range[1].format('YYYY-MM-DD'),
      })
      if (action) params.set('action', action)
      if (userId) params.set('userId', String(userId))
      if (hn.trim()) params.set('hn', hn.trim())
      if (before) params.set('before', String(before))
      return params.toString()
    },
    [range, action, userId, hn],
  )

  useEffect(() => {
    let alive = true
    const run = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await apiFetch(`/api/activity/list?${query()}`)
        const json = await res.json()
        if (!alive) return
        if (!res.ok || !json.success) {
          setError(json.message ?? 'ดึงร่องรอยการใช้งานไม่สำเร็จ')
          setRows([])
          setSummary(null)
          return
        }
        setRows(json.rows as Row[])
        setSummary(json.summary as Summary)
        setPeople(json.people as Person[])
        setHasMore(Boolean(json.hasMore))
      } catch {
        if (alive) setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')
      } finally {
        if (alive) setLoading(false)
      }
    }
    void run()
    return () => {
      alive = false
    }
  }, [query, reloadKey])

  /** ต่อท้ายรายการเดิม ไม่ใช่แทนที่ — เลื่อนหน้าด้วย id ของแถวสุดท้าย */
  const loadMore = async () => {
    const last = rows.at(-1)
    if (!last) return
    setLoadingMore(true)
    try {
      const res = await apiFetch(`/api/activity/list?${query(last.id)}`)
      const json = await res.json()
      if (!res.ok || !json.success) {
        toast.error(json.message ?? 'โหลดเพิ่มไม่สำเร็จ')
        return
      }
      setRows(current => [...current, ...(json.rows as Row[])])
      setHasMore(Boolean(json.hasMore))
    } catch {
      toast.error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')
    } finally {
      setLoadingMore(false)
    }
  }

  const featureFilters = useMemo(
    () =>
      (summary?.byFeature ?? []).map(item => ({
        text: `${item.feature} (${item.count.toLocaleString('th-TH')})`,
        value: item.feature,
      })),
    [summary],
  )

  const columns: ColumnsType<Row> = [
    {
      title: 'ลำดับ',
      key: 'index',
      width: 70,
      align: 'center',
      render: (_: unknown, __: unknown, index: number) => (
        <span className="font-mono text-xs text-ink-3">{index + 1}</span>
      ),
    },
    {
      title: 'เวลา',
      dataIndex: 'at',
      width: 170,
      fixed: 'left',
      render: (value: string) => <span className="font-mono text-xs">{formatAt(value)}</span>,
    },
    {
      title: 'ผู้ใช้',
      dataIndex: 'fullName',
      width: 210,
      render: (value: string | null, row) => (
        <div className="min-w-0">
          <div className="truncate text-xs text-ink">
            {value ?? row.username ?? 'ไม่ระบุตัวตน'}
          </div>
          {row.username && value && (
            <div className="truncate font-mono text-[11px] text-ink-3">{row.username}</div>
          )}
        </div>
      ),
    },
    {
      title: 'เหตุการณ์',
      dataIndex: 'action',
      width: 120,
      render: (value: string) => {
        const meta = ACTION_META[value] ?? { label: value, color: 'default' }
        return (
          <Tag color={meta.color} className="mr-0!">
            {meta.label}
          </Tag>
        )
      },
    },
    {
      title: 'งาน',
      dataIndex: 'feature',
      width: 130,
      filters: featureFilters,
      filterMultiple: false,
      // กรองที่เซิร์ฟเวอร์ ไม่ใช่ในตาราง — ตารางถือแค่หน้าที่โหลดมาแล้ว
      // ถ้ากรองในนี้จะได้ผลของหน้านี้เท่านั้น ทั้งที่ยังมีอีกหลายหน้าที่ยังไม่โหลด
      onFilter: () => true,
      render: (value: string | null) =>
        value ? <span className="text-xs text-ink-2">{value}</span> : <Blank />,
    },
    {
      title: 'HN ที่เปิดดู',
      dataIndex: 'targetHn',
      width: 120,
      render: (value: string | null) =>
        value ? (
          <Tooltip title="กดเพื่อดูว่าใครเปิดดู HN นี้บ้าง">
            <button
              type="button"
              className="cursor-pointer font-mono text-xs text-accent underline-offset-2 hover:underline"
              onClick={() => setHn(value)}
            >
              {value}
            </button>
          </Tooltip>
        ) : (
          <Blank />
        ),
    },
    {
      title: 'เส้นทาง',
      dataIndex: 'path',
      render: (value: string, row) => (
        <div className="min-w-0">
          <div className="truncate font-mono text-[11px] text-ink-2">
            {row.method && row.method !== 'GET' ? `${row.method} ` : ''}
            {value}
          </div>
          {row.detail && <div className="truncate text-[11px] text-ink-3">{row.detail}</div>}
        </div>
      ),
    },
    {
      title: 'อุปกรณ์',
      dataIndex: 'device',
      width: 150,
      render: (value: string | null, row) => (
        <div className="min-w-0">
          <div className="truncate text-[11px] text-ink-3">{value ?? '—'}</div>
          {row.clientIp && (
            <div className="truncate font-mono text-[11px] text-ink-3">{row.clientIp}</div>
          )}
        </div>
      ),
    },
  ]

  const filtering = Boolean(action || userId || hn.trim())

  return (
    <>
      {toastHolder}

      <section className="mb-6">
        <Breadcrumb
          className="mb-2"
          items={[{ title: <Link href="/home">หน้าแรก</Link> }, { title: 'ร่องรอยการใช้งาน' }]}
        />
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          <SafetyCertificateOutlined /> ร่องรอยการใช้งาน
          <PageHint>
            ใครเข้าหน้าไหน ดึงข้อมูลอะไร และนำอะไรออกจากระบบไปบ้าง — เก็บทุกคำขอที่ผ่านเซิร์ฟเวอร์
          </PageHint>
        </Title>
      </section>

      {/* หน้านี้เองก็เป็นข้อมูลอ่อนไหว บอกไว้ตรง ๆ ว่าใช้ทำอะไรได้และห้ามใช้ทำอะไร */}
      <Alert
        className="mb-4"
        type="info"
        showIcon
        title="ข้อมูลนี้ใช้เพื่อการตรวจสอบเท่านั้น"
        description={
          <span className="text-xs">
            ตารางนี้บอกได้ว่าเจ้าหน้าที่แต่ละคนเปิดดูผู้ป่วยรายใดบ้าง
            ใช้สำหรับสอบเหตุการณ์ที่มีเรื่องร้องเรียนหรือตรวจสอบตามระบบคุณภาพ
            ไม่ใช่เครื่องมือประเมินผลงานรายบุคคล และการเปิดหน้านี้ก็ถูกบันทึกไว้เช่นกัน
          </span>
        }
      />

      {summary && (
        <section className="mb-4 grid gap-3 sm:grid-cols-3">
          <StatCard label="เหตุการณ์ทั้งหมด" value={summary.total} />
          <StatCard label="การส่งออกไฟล์" value={summary.exports} tone="warn" />
          <StatCard label="ผู้ป่วยที่ถูกเปิดดู (ไม่ซ้ำ)" value={summary.patientsTouched} />
        </section>
      )}

      <ArchivePanel onDone={() => setReloadKey(key => key + 1)} />

      <section className="mb-4 flex flex-wrap items-center gap-2">
        <RangePicker
          allowClear={false}
          value={range}
          onChange={value => {
            if (value?.[0] && value[1]) setRange([value[0], value[1]])
          }}
          format={value => toThaiDate(value)}
          maxDate={dayjs()}
        />
        <Segmented options={ACTION_OPTIONS} value={action} onChange={value => setAction(String(value))} />
        <Select
          allowClear
          showSearch
          className="min-w-52"
          placeholder="ทุกผู้ใช้"
          value={userId}
          onChange={value => setUserId(value ?? null)}
          optionFilterProp="label"
          options={people.map(item => ({ value: item.userId, label: item.name }))}
        />
        <Input
          allowClear
          className="w-44"
          value={hn}
          onChange={event => setHn(event.target.value)}
          placeholder="ค้นด้วย HN"
          prefix={<SearchOutlined className="text-ink-3" />}
        />
        <Text type="secondary" className="ml-auto text-xs">
          {rows.length.toLocaleString('th-TH')} แถวที่แสดงอยู่
          {filtering ? ' · กรองอยู่' : ''}
        </Text>
      </section>

      {error && <Alert className="mb-4" type="error" showIcon title={error} />}

      {summary && summary.topUsers.length > 0 && !filtering && (
        <section className="mb-4 rounded-2xl border border-line bg-panel p-3">
          <div className="mb-2 text-xs font-semibold text-ink">เคลื่อนไหวมากที่สุดในช่วงนี้</div>
          <div className="flex flex-wrap gap-2">
            {summary.topUsers.map(item => (
              <button
                key={item.userId ?? item.name}
                type="button"
                className="cursor-pointer rounded-full border border-line bg-accent-soft px-3 py-1 text-xs text-ink-2 hover:border-accent"
                onClick={() => setUserId(item.userId)}
              >
                {item.name} · {item.count.toLocaleString('th-TH')}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="data-sheet rounded-2xl border border-line bg-panel p-2 backdrop-blur">
          {/* โครงร่างแถวอยู่ในช่อง emptyText — หัวตารางยังอยู่ ความกว้างคอลัมน์จึงไม่ขยับ
          ตอนข้อมูลมาถึง ส่วน loading ของ Table ไว้สำหรับการโหลดทับรายการที่มีอยู่แล้ว
          ซึ่งต้องเป็นวงกลมหมุนคลุมของเดิม ไม่ใช่โครงร่างที่ลบของเดิมหายไปจากจอ */}
        <Table<Row>
            loading={loading && rows.length > 0}
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={rows}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{
            emptyText: loading ? (
              <TableRowsSkeleton columns={columns.length} rows={6} />
            ) : (
              <Empty description="ไม่พบร่องรอยตามเงื่อนไขที่เลือก" />
            ),
          }}
        />
        {hasMore && (
          <div className="flex justify-center p-3">
            <Button icon={<ReloadOutlined />} loading={loadingMore} onClick={loadMore}>
              โหลดเพิ่ม
            </Button>
          </div>
        )}
      </section>
    </>
  )
}

const Blank = () => (
  <Text type="secondary" className="text-xs">
    —
  </Text>
)

function StatCard({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'warn'
}) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <div className="text-xs text-ink-3">{label}</div>
      {/* ตัวเลขการส่งออกใช้สีเตือน — เป็นตัวเดียวในหน้านี้ที่หมายถึงข้อมูลออกนอกระบบ */}
      <div className={`mt-1 font-mono text-2xl ${tone === 'warn' ? 'text-danger' : 'text-ink'}`}>
        {value.toLocaleString('th-TH')}
      </div>
    </div>
  )
}
