'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ยังทำที่ app/home/rdu/layout.tsx ซึ่งเป็น Server Component)
import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Alert,
  Breadcrumb,
  Button,
  DatePicker,
  Empty,
  Segmented,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { FileExcelOutlined, HeartOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import buddhistEra from 'dayjs/plugin/buddhistEra'
import { apiFetch } from '@/lib/client/session'
import { trackExport } from '@/lib/client/track-export'
import type { DeliveryCase } from '@/lib/his/rdu-delivery'
import RowSearch, { matchesRow } from '../row-search'

// เปิด token BBBB (ปี พ.ศ.) ให้ dayjs — ถ้าไม่ extend ปฏิทินจะพิมพ์คำว่า BBBB ออกมาตรง ๆ
dayjs.extend(buddhistEra)

const { Paragraph, Text, Title } = Typography
const { RangePicker } = DatePicker

/**
 * รายงานการใช้ยาปฏิชีวนะในสตรีคลอดปกติครบกำหนดทางช่องคลอด
 *
 * ต่างจากหน้ารายงานข้ออื่นตรงที่หนึ่งแถวคือการนอนโรงพยาบาลหนึ่งครั้ง (AN)
 * ไม่ใช่ครั้งที่มารับบริการแบบผู้ป่วยนอก (VN) — ข้อนี้เป็นข้อเดียวที่นับจาก
 * ฝั่งผู้ป่วยใน จึงไม่ได้ใช้โครง visit-report.tsx ร่วมกับข้ออื่น
 *
 * ยังไม่มีปุ่มเปิดดูรายละเอียดรายครั้งเหมือนข้ออื่น — หน้ารายละเอียดที่มีอยู่
 * รับแต่ VN ของผู้ป่วยนอก ถ้าจะทำต้องเขียนของฝั่งผู้ป่วยในขึ้นใหม่ทั้งหน้า
 * ซึ่งเกินขอบเขตของตัวชี้วัดข้อนี้ — ชื่อยาที่ได้รับแสดงในตารางอยู่แล้ว
 */

/** แปลง 'YYYY-MM-DD' เป็น วว/ดด/ปปปป พ.ศ. */
function toThaiDate(value: string | null): string {
  if (!value) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return value
  const [, year, month, day] = match
  return `${day}/${month}/${Number(year) + 543}`
}

/** ค่าเริ่มต้น: ย้อนหลัง 90 วันถึงวันนี้ — การคลอดปกติมีราวเดือนละ 25 ราย
    ถ้าเริ่มที่ 30 วันเหมือนข้ออื่น ตารางจะสั้นจนดูแนวโน้มอะไรไม่ออก */
const DEFAULT_RANGE: [Dayjs, Dayjs] = [dayjs().subtract(90, 'day'), dayjs()]

/** ใส่ BOM เพราะ Excel บนวินโดวส์เดาว่า CSV เป็น CP874 */
function toCsv(rows: string[][]): string {
  const cell = (value: string) => `"${value.replace(/"/g, '""')}"`
  return '﻿' + rows.map(row => row.map(cell).join(',')).join('\r\n')
}

type Filter = 'all' | 'with' | 'without'

type Report = {
  cases: DeliveryCase[]
  diagnosisCodes: number
  drugIcodes: string[]
  truncated: boolean
}

const SETTINGS_DIAGNOSIS = '/home/rdu/settings/nl-icd10'

export default function DeliveryReportPage() {
  const [range, setRange] = useState<[Dayjs, Dayjs]>(DEFAULT_RANGE)
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  /** คำค้นในตาราง — กรองในเบราว์เซอร์ ไม่ได้ยิงกลับไปที่ฐาน */
  const [keyword, setKeyword] = useState('')
  const [toast, toastHolder] = message.useMessage()

  const search = async () => {
    setLoading(true)
    setError('')
    try {
      const from = range[0].format('YYYY-MM-DD')
      const to = range[1].format('YYYY-MM-DD')
      const res = await apiFetch(`/api/his/rdu/delivery?from=${from}&to=${to}`)
      const json = await res.json()
      if (!res.ok || !json.success) {
        setError(json.message ?? 'ดึงรายงานไม่สำเร็จ')
        return
      }
      setReport(json as Report)
      setFilter('all')
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setLoading(false)
    }
  }

  const cases = useMemo(() => report?.cases ?? [], [report])
  const withDrug = useMemo(() => cases.filter(row => row.drugs.length > 0), [cases])

  const percent = useMemo(
    () => (cases.length === 0 ? null : (withDrug.length * 100) / cases.length),
    [cases, withDrug],
  )

  /* ค้นทับตัวกรองกลุ่ม ไม่ใช่แทนที่ — ตัวกรองบอกว่า "กลุ่มไหน" ส่วนช่องค้นบอกว่า
     "รายไหน" และมักใช้คู่กัน (เลือกกลุ่มที่ได้รับยาก่อน แล้วค้นชื่อยาต่อ) */
  const shown = useMemo(() => {
    const byFilter =
      filter === 'all'
        ? cases
        : filter === 'with'
          ? withDrug
          : cases.filter(row => row.drugs.length === 0)
    return byFilter.filter(row =>
      matchesRow(
        [
          row.hn,
          row.an,
          row.patientName,
          row.ageYears,
          row.ward,
          row.doctor,
          ...row.icd10,
          ...row.drugs,
        ],
        keyword,
      ),
    )
  }, [cases, withDrug, filter, keyword])

  const exportCsv = () => {
    if (shown.length === 0) {
      toast.info('ไม่มีรายการให้ส่งออก')
      return
    }

    const header = [
      'AN',
      'HN',
      'ชื่อ-สกุล',
      'อายุ',
      'วันที่รับไว้',
      'วันที่จำหน่าย',
      'หอผู้ป่วย',
      'แพทย์ผู้รับไว้',
      'รหัสวินิจฉัย',
      'ได้รับยาปฏิชีวนะ',
      'รายการยาปฏิชีวนะ',
    ]
    const body = shown.map(row => [
      // นำหน้าด้วย ' เพื่อให้ Excel เก็บเป็นข้อความ ไม่ตัดศูนย์หน้า AN/HN ทิ้ง
      `'${row.an}`,
      `'${row.hn}`,
      row.patientName,
      row.ageYears == null ? '' : String(row.ageYears),
      toThaiDate(row.admitDate),
      toThaiDate(row.dischargeDate),
      row.ward ?? '',
      row.doctor ?? '',
      row.icd10.join(' '),
      row.drugs.length > 0 ? 'ได้รับ' : 'ไม่ได้รับ',
      row.drugs.join(' / '),
    ])

    const blob = new Blob([toCsv([header, ...body])], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `ยาปฏิชีวนะในสตรีคลอดปกติ-${range[0].format('YYYY-MM-DD')}-ถึง-${range[1].format('YYYY-MM-DD')}.csv`
    link.click()
    // แจ้งเซิร์ฟเวอร์ว่าข้อมูลชุดนี้ถูกนำออกจากระบบ — ไฟล์สร้างในเบราว์เซอร์
    // จึงไม่มีคำขอไหนวิ่งไปให้ proxy ดักได้เอง
    trackExport({ label: link.download, rows: body.length })
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success(`ส่งออก ${body.length} รายการแล้ว`)
  }

  const columns: ColumnsType<DeliveryCase> = [
    {
      title: 'วันที่รับไว้',
      dataIndex: 'admitDate',
      width: 130,
      /* วันจำหน่ายอยู่ใต้วันรับไว้ — การคลอดปกตินอนสั้น ถ้านอนยาวผิดปกติ
         มักแปลว่ามีภาวะแทรกซ้อน ซึ่งเป็นบริบทที่คนทบทวนต้องเห็นคู่กัน */
      render: (date: string | null, row) => (
        <div className="leading-tight">
          <div>{toThaiDate(date)}</div>
          <div className="text-[11px] text-ink-3">จำหน่าย {toThaiDate(row.dischargeDate)}</div>
        </div>
      ),
    },
    {
      title: 'AN',
      dataIndex: 'an',
      width: 110,
      render: (an: string) => <span className="font-mono text-xs">{an}</span>,
    },
    {
      title: 'HN',
      dataIndex: 'hn',
      width: 100,
      render: (hn: string) => <span className="font-mono text-xs">{hn}</span>,
    },
    { title: 'ชื่อ-สกุล', dataIndex: 'patientName', width: 200 },
    {
      title: 'อายุ',
      dataIndex: 'ageYears',
      width: 70,
      align: 'right',
      className: 'qty',
      render: (age: number | null) => (age == null ? '—' : `${age}`),
    },
    {
      title: 'รหัสวินิจฉัย',
      dataIndex: 'icd10',
      width: 130,
      render: (codes: string[]) => (
        <span className="flex flex-wrap gap-1">
          {codes.map(code => (
            <Tag key={code} className="mr-0! font-mono text-[11px]">
              {code}
            </Tag>
          ))}
        </span>
      ),
    },
    {
      title: 'ยาปฏิชีวนะ',
      dataIndex: 'drugs',
      width: 110,
      render: (drugs: string[]) => (
        // ทิศทางของข้อนี้คือยิ่งได้รับยิ่งต้องทบทวน สีจึงกลับกับข้อโรคหืด
        <Tag color={drugs.length > 0 ? 'orange' : 'green'} className="mr-0!">
          {drugs.length > 0 ? 'ได้รับ' : 'ไม่ได้รับ'}
        </Tag>
      ),
    },
    {
      title: 'หอผู้ป่วย',
      dataIndex: 'ward',
      width: 170,
      render: (name: string | null) =>
        name ?? (
          <Text type="secondary" className="text-xs">
            —
          </Text>
        ),
    },
    {
      title: 'แพทย์ผู้รับไว้',
      dataIndex: 'doctor',
      width: 170,
      render: (name: string | null) =>
        name ?? (
          <Text type="secondary" className="text-xs">
            —
          </Text>
        ),
    },
    {
      title: 'รายการยาที่ได้รับ',
      dataIndex: 'drugs',
      key: 'drugNames',
      render: (drugs: string[]) => <span className="text-xs">{drugs.join(' / ')}</span>,
    },
  ]

  return (
    <>
      {toastHolder}

      <section className="mb-6">
        <Breadcrumb
          className="mb-2"
          items={[
            { title: <Link href="/home/rdu">RDU ติดตามตัวชี้วัดการใช้ยา</Link> },
            { title: 'ยาปฏิชีวนะในสตรีคลอดปกติ' },
          ]}
        />
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          <HeartOutlined /> การใช้ยาปฏิชีวนะในสตรีคลอดปกติครบกำหนดทางช่องคลอด
        </Title>
        <div className="mb-2 h-px w-24 bg-linear-to-r from-violet-400/70 to-transparent" />
        <Paragraph type="secondary" style={{ maxWidth: 900, marginBottom: 0, fontSize: 12 }}>
          การคลอดปกติที่ไม่มีภาวะแทรกซ้อนไม่ต้องให้ยาปฏิชีวนะ ข้อนี้จึงยิ่งต่ำยิ่งดี —
          หนึ่งแถวคือการนอนโรงพยาบาลหนึ่งครั้ง (AN) ไม่ใช่ครั้งที่มารับบริการแบบผู้ป่วยนอก
          เพราะเป็นตัวชี้วัดข้อเดียวที่นับจากฝั่งผู้ป่วยใน
        </Paragraph>
      </section>

      <div className="mb-5">
        <Space.Compact>
          <RangePicker
            size="large"
            allowClear={false}
            value={range}
            format="DD/MM/BBBB"
            // ห้ามเลือกวันในอนาคต — การคลอดที่ยังไม่เกิดขึ้นย่อมไม่มี
            maxDate={dayjs()}
            onChange={dates => {
              if (dates?.[0] && dates[1]) setRange([dates[0], dates[1]])
            }}
          />
          <Button size="large" type="primary" loading={loading} onClick={() => void search()}>
            ค้นหา
          </Button>
        </Space.Compact>
        <Text type="secondary" className="mt-1.5 block text-[11px]">
          ช่วงวันที่ = วันที่รับไว้เป็นผู้ป่วยใน เลือกได้ไม่เกิน 366 วัน ·
          ยาปฏิชีวนะนับจากที่จ่ายจริงระหว่างนอนโรงพยาบาล ดูจากธง antibiotic ในทะเบียนยาของ HIS
        </Text>
      </div>

      {error && <Alert type="error" showIcon title={error} className="mb-4" />}

      {report && report.diagnosisCodes === 0 && (
        <Alert
          type="warning"
          showIcon
          className="mb-4"
          title="ยังไม่ได้ตั้งค่าทะเบียนรหัสวินิจฉัยการคลอดปกติ รายงานจึงว่างเปล่า"
          description={
            <span className="text-xs leading-relaxed">
              เลือกรหัส ICD-10 ที่นับเป็นการคลอดปกติก่อนที่{' '}
              <Link href={SETTINGS_DIAGNOSIS} className="text-accent">
                หน้าตั้งค่ารหัสวินิจฉัย
              </Link>
            </span>
          }
        />
      )}

      {report?.truncated && (
        <Alert
          type="info"
          showIcon
          className="mb-4"
          title="รายการยาวเกินกว่าที่แสดงได้ในครั้งเดียว จึงตัดไว้ที่ 2,000 ราย"
          description={
            <span className="text-xs leading-relaxed">
              แบ่งช่วงวันที่ให้สั้นลงเพื่อดูให้ครบ — ร้อยละบนการ์ดคำนวณจากรายการที่แสดงอยู่เท่านั้น
            </span>
          }
        />
      )}

      <Spin spinning={loading}>
        {report ? (
          <>
            <section className="mb-4 grid gap-3 sm:grid-cols-3">
              <StatCard
                label="ตัวหาร — การคลอดปกติ"
                value={cases.length.toLocaleString('th-TH')}
                unit="ราย"
              />
              <StatCard
                label="ได้รับยาปฏิชีวนะ"
                value={withDrug.length.toLocaleString('th-TH')}
                unit="ราย"
                tone={withDrug.length > 0 ? 'warn' : 'good'}
              />
              <StatCard
                label="ร้อยละที่ได้รับยาปฏิชีวนะ"
                value={percent == null ? '—' : percent.toFixed(2)}
                unit={percent == null ? '' : '%'}
                hint="ยิ่งต่ำยิ่งดี"
                tone={percent == null ? 'plain' : 'warn'}
              />
            </section>

            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <Segmented<Filter>
                value={filter}
                onChange={setFilter}
                options={[
                  { label: `ทั้งหมด (${cases.length.toLocaleString('th-TH')})`, value: 'all' },
                  {
                    label: `ได้รับยา (${withDrug.length.toLocaleString('th-TH')})`,
                    value: 'with',
                  },
                  {
                    label: `ไม่ได้รับ (${(cases.length - withDrug.length).toLocaleString('th-TH')})`,
                    value: 'without',
                  },
                ]}
              />
              <div className="flex flex-wrap items-center gap-3">
                <RowSearch
                  value={keyword}
                  onChange={setKeyword}
                  placeholder="ค้น HN / AN ชื่อผู้ป่วย รหัสโรค ชื่อยา หอผู้ป่วย แพทย์"
                />
                <Tooltip title="ได้ไฟล์ตามตัวกรองและคำค้นที่ใช้อยู่ · มีชื่อผู้ป่วยและ HN อย่าส่งต่อออกนอกงาน">
                  <Button
                    icon={<FileExcelOutlined />}
                    onClick={exportCsv}
                    disabled={shown.length === 0}
                  >
                    ส่งออก Excel
                  </Button>
                </Tooltip>
              </div>
            </div>

            <div className="data-sheet">
              <Table<DeliveryCase>
                rowKey="an"
                size="small"
                columns={columns}
                dataSource={shown}
                pagination={{ pageSize: 50, showSizeChanger: false }}
                scroll={{ x: 'max-content' }}
                locale={{
                  emptyText: <Empty description="ไม่พบการคลอดปกติในช่วงวันที่ที่เลือก" />,
                }}
              />
            </div>
          </>
        ) : (
          !loading && (
            <div className="rounded-2xl border border-line bg-panel py-16 backdrop-blur-md">
              <Empty description="เลือกช่วงวันที่แล้วกดค้นหา" />
            </div>
          )
        )}
      </Spin>
    </>
  )
}

function StatCard({
  label,
  value,
  unit,
  hint,
  tone = 'plain',
}: {
  label: string
  value: string
  unit: string
  hint?: string
  tone?: 'plain' | 'good' | 'warn'
}) {
  const toneClass =
    tone === 'good' ? 'text-emerald-500' : tone === 'warn' ? 'text-amber-500' : 'text-ink'
  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-3 backdrop-blur">
      <div className="text-[11px] text-ink-3">{label}</div>
      <div className={`mt-0.5 text-xl font-semibold ${toneClass}`}>
        <span className="qty">{value}</span>
        {unit && <span className="ml-1 text-xs font-normal text-ink-3">{unit}</span>}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-ink-3">{hint}</div>}
    </div>
  )
}
