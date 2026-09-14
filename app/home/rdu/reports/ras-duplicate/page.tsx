'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ยังทำที่ app/home/rdu/layout.tsx ซึ่งเป็น Server Component)
import { useState } from 'react'
import Link from 'next/link'
import {
  Alert,
  Breadcrumb,
  Button,
  DatePicker,
  Empty,
  Result,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { EyeOutlined, FileExcelOutlined, MonitorOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import buddhistEra from 'dayjs/plugin/buddhistEra'
import { apiFetch } from '@/lib/client/session'
import type { RasDuplicateCase } from '@/lib/his/rdu-ras-duplicate'
import VisitDetailModal from '../visit-modal'

// เปิด token BBBB (ปี พ.ศ.) ให้ dayjs — ถ้าไม่ extend ปฏิทินจะพิมพ์คำว่า BBBB ออกมาตรง ๆ
dayjs.extend(buddhistEra)

const { Paragraph, Text, Title } = Typography
const { RangePicker } = DatePicker

/**
 * รายงานการได้รับยากลุ่ม RAS blockade ซ้ำซ้อน
 *
 * เกณฑ์ของตัวชี้วัดข้อนี้คือศูนย์ หน้าจอจึงออกแบบให้ "ไม่พบ" เป็นผลลัพธ์ที่อ่านแล้ว
 * รู้ทันทีว่าผ่าน ไม่ใช่ตารางว่างที่ดูเหมือนยังไม่ได้ค้นหรือระบบเสีย — ต่างจาก
 * หน้าอื่นที่ตารางว่างแปลว่าไม่มีข้อมูล
 */

/** แปลง 'YYYY-MM-DD' เป็น วว/ดด/ปปปป พ.ศ. */
function toThaiDate(value: string | null): string {
  if (!value) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return value
  const [, year, month, day] = match
  return `${day}/${month}/${Number(year) + 543}`
}

/** ค่าเริ่มต้น: ย้อนหลัง 30 วันถึงวันนี้ */
const DEFAULT_RANGE: [Dayjs, Dayjs] = [dayjs().subtract(30, 'day'), dayjs()]

/** ใส่ BOM เพราะ Excel บนวินโดวส์เดาว่า CSV เป็น CP874 (เหตุผลเต็มอยู่ที่ visit-report.tsx) */
function toCsv(rows: string[][]): string {
  const cell = (value: string) => `"${value.replace(/"/g, '""')}"`
  return '﻿' + rows.map(row => row.map(cell).join(',')).join('\r\n')
}

const sexLabel = (sex: string | null) => (sex === '1' ? 'ชาย' : sex === '2' ? 'หญิง' : '—')

type Report = {
  cases: RasDuplicateCase[]
  denominatorVisits: number
  denominatorPatients: number
  casePatients: number
  aceiItems: number
  arbItems: number
  drugIcodes: string[]
  truncated: boolean
}

const SETTINGS_ACEI = '/home/rdu/settings/ras-acei'
const SETTINGS_ARB = '/home/rdu/settings/ras-arb'

export default function RasDuplicateReportPage() {
  const [range, setRange] = useState<[Dayjs, Dayjs]>(DEFAULT_RANGE)
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<RasDuplicateCase | null>(null)
  const [toast, toastHolder] = message.useMessage()

  const search = async () => {
    setLoading(true)
    setError('')
    try {
      const from = range[0].format('YYYY-MM-DD')
      const to = range[1].format('YYYY-MM-DD')
      const res = await apiFetch(`/api/his/rdu/ras-duplicate?from=${from}&to=${to}`)
      const json = await res.json()
      if (!res.ok || !json.success) {
        setError(json.message ?? 'ดึงรายงานไม่สำเร็จ')
        return
      }
      setReport(json as Report)
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setLoading(false)
    }
  }

  const cases = report?.cases ?? []

  /* ร้อยละคิดจากรายผู้ป่วยเหมือนตัวชี้วัดกลุ่มโรคเรื้อรังข้ออื่น — ผู้ป่วยความดัน
     มารับยาทุกเดือน ถ้าหารด้วยจำนวนครั้ง เคสเดียวที่ซ้ำซ้อนจะถูกเจือจางจนมองไม่เห็น */
  const percent =
    report == null || report.denominatorPatients === 0
      ? null
      : (report.casePatients * 100) / report.denominatorPatients

  const exportCsv = () => {
    if (cases.length === 0) {
      toast.info('ไม่มีรายการให้ส่งออก')
      return
    }

    const header = [
      'วันที่',
      'VN',
      'HN',
      'ชื่อ-สกุล',
      'เพศ',
      'อายุ',
      'ห้องตรวจ',
      'แพทย์ผู้ตรวจ',
      'จำนวนชนิดที่ซ้ำ',
      'ชื่อสามัญ',
      'รายการยาที่ได้รับ',
    ]
    const body = cases.map(row => [
      toThaiDate(row.date),
      // นำหน้าด้วย ' เพื่อให้ Excel เก็บเป็นข้อความ ไม่ตัดศูนย์หน้า HN/VN ทิ้ง
      `'${row.vn}`,
      `'${row.hn}`,
      row.patientName,
      sexLabel(row.sex),
      row.ageYears == null ? '' : String(row.ageYears),
      row.department ?? '',
      row.doctor ?? '',
      String(row.generics.length),
      row.generics.join(' + '),
      row.drugs.join(' / '),
    ])

    const blob = new Blob([toCsv([header, ...body])], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `RAS-blockade-ซ้ำซ้อน-${range[0].format('YYYY-MM-DD')}-ถึง-${range[1].format('YYYY-MM-DD')}.csv`
    link.click()
    // คืนหน่วยความจำของ blob หลังเบราว์เซอร์เริ่มดาวน์โหลดแล้ว
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success(`ส่งออก ${body.length} รายการแล้ว`)
  }

  const columns: ColumnsType<RasDuplicateCase> = [
    {
      title: 'วันที่',
      dataIndex: 'date',
      width: 110,
      render: (date: string | null) => toThaiDate(date),
    },
    {
      title: 'HN',
      dataIndex: 'hn',
      width: 100,
      render: (hn: string) => <span className="font-mono text-xs">{hn}</span>,
    },
    { title: 'ชื่อ-สกุล', dataIndex: 'patientName', width: 210 },
    { title: 'เพศ', dataIndex: 'sex', width: 70, render: (sex: string | null) => sexLabel(sex) },
    {
      title: 'อายุ',
      dataIndex: 'ageYears',
      width: 70,
      align: 'right',
      className: 'qty',
      render: (age: number | null) => (age == null ? '—' : `${age}`),
    },
    {
      title: 'ชื่อสามัญที่ได้รับพร้อมกัน',
      dataIndex: 'generics',
      width: 260,
      /* แสดงชื่อสามัญไว้ก่อนชื่อรายการยา เพราะนี่คือสิ่งที่ตัวชี้วัดนับ —
         ชื่อรายการยาในบัญชีมีชื่อการค้าและชื่อบริษัทปนจนอ่านทีเดียวไม่ออกว่าซ้ำตรงไหน */
      render: (generics: string[]) => (
        <span className="flex flex-wrap gap-1">
          {generics.map(name => (
            <Tag color="red" key={name} className="mr-0! text-[11px]">
              {name}
            </Tag>
          ))}
        </span>
      ),
    },
    {
      title: 'ห้องตรวจ',
      dataIndex: 'department',
      width: 180,
      render: (name: string | null) =>
        name ?? (
          <Text type="secondary" className="text-xs">
            —
          </Text>
        ),
    },
    {
      title: 'แพทย์ผู้ตรวจ',
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
      render: (drugs: string[]) => <span className="text-xs">{drugs.join(' / ')}</span>,
    },
    {
      title: '',
      key: 'action',
      width: 80,
      fixed: 'right',
      render: (_, row) => (
        <Button size="small" icon={<EyeOutlined />} onClick={() => setPicked(row)}>
          ดู
        </Button>
      ),
    },
  ]

  const noRegistry = report != null && report.aceiItems === 0 && report.arbItems === 0

  return (
    <>
      {toastHolder}

      <section className="mb-6">
        <Breadcrumb
          className="mb-2"
          items={[
            { title: <Link href="/home/rdu">RDU ติดตามตัวชี้วัดการใช้ยา</Link> },
            { title: 'RAS blockade ซ้ำซ้อน' },
          ]}
        />
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          <MonitorOutlined /> การได้รับยากลุ่ม RAS blockade ซ้ำซ้อน
        </Title>
        <div className="mb-2 h-px w-24 bg-linear-to-r from-violet-400/70 to-transparent" />
        <Paragraph type="secondary" style={{ maxWidth: 860, marginBottom: 0, fontSize: 12 }}>
          ผู้ป่วยนอกที่ได้รับยาที่ยับยั้งระบบ renin-angiotensin ตั้งแต่สองชนิดขึ้นไปในการมารับบริการครั้งเดียวกัน
          — นับด้วยชื่อสามัญ ยาตัวเดียวกันคนละขนาด (เช่น Enalapril 5 กับ 20 มก.) ไม่ถือว่าซ้ำซ้อน
          เกณฑ์ของตัวชี้วัดข้อนี้คือไม่ควรมีเลย
        </Paragraph>
      </section>

      <div className="mb-5">
        <Space.Compact>
          <RangePicker
            size="large"
            allowClear={false}
            value={range}
            format="DD/MM/BBBB"
            // ห้ามเลือกวันในอนาคต — การมารับบริการที่ยังไม่เกิดขึ้นย่อมไม่มี
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
          ช่วงวันที่ = วันที่มารับบริการ เลือกได้ไม่เกิน 366 วัน · ไม่นับครั้งที่รับไว้เป็นผู้ป่วยใน ·
          นับเฉพาะรายการที่จ่ายยาจริง
        </Text>
      </div>

      {error && <Alert type="error" showIcon title={error} className="mb-4" />}

      {noRegistry && (
        <Alert
          type="warning"
          showIcon
          className="mb-4"
          title="ยังไม่ได้ตั้งค่าทะเบียนยา รายงานจึงว่างเปล่า"
          description={
            <span className="text-xs leading-relaxed">
              เลือกรายการยาที่นับก่อนที่{' '}
              <Link href={SETTINGS_ACEI} className="text-accent">
                หน้าตั้งค่ายา ACEI
              </Link>{' '}
              และ{' '}
              <Link href={SETTINGS_ARB} className="text-accent">
                หน้าตั้งค่ายา ARB
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
          title="เคสยาวเกินกว่าที่แสดงได้ในครั้งเดียว จึงตัดไว้ที่ 2,000 เคสล่าสุด"
          description={
            <span className="text-xs leading-relaxed">แบ่งช่วงวันที่ให้สั้นลงเพื่อดูให้ครบ</span>
          }
        />
      )}

      <Spin spinning={loading}>
        {report ? (
          <>
            <section className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="ผู้ป่วยที่ได้รับยากลุ่ม RAS"
                value={report.denominatorPatients.toLocaleString('th-TH')}
                unit="คน"
                hint={`รับยารวม ${report.denominatorVisits.toLocaleString('th-TH')} ครั้ง`}
              />
              <StatCard
                label="ได้รับซ้ำซ้อน"
                value={report.casePatients.toLocaleString('th-TH')}
                unit="คน"
                hint={`รวม ${cases.length.toLocaleString('th-TH')} ครั้ง`}
              />
              <StatCard
                label="ร้อยละที่ได้รับซ้ำซ้อน"
                value={percent == null ? '—' : percent.toFixed(2)}
                unit={percent == null ? '' : '%'}
                hint="เกณฑ์ของตัวชี้วัดคือ 0%"
              />
              <StatCard
                label="รายการยาในทะเบียน"
                value={`${report.aceiItems + report.arbItems}`}
                unit="รายการ"
                hint={`ACEI ${report.aceiItems} · ARB ${report.arbItems}`}
              />
            </section>

            {cases.length === 0 && !noRegistry ? (
              /* ผลลัพธ์ที่ต้องการของตัวชี้วัดข้อนี้คือไม่พบเลย จึงบอกให้ชัดว่าผ่านเกณฑ์
                 ไม่ใช่ปล่อยตารางว่างซึ่งอ่านได้ว่าค้นไม่เจอหรือระบบยังไม่ทำงาน */
              <div className="rounded-2xl border border-line bg-panel py-10 backdrop-blur-md">
                <Result
                  status="success"
                  title="ไม่พบการได้รับยากลุ่ม RAS ซ้ำซ้อนในช่วงวันที่ที่เลือก"
                  subTitle={`ตรวจจากผู้ป่วย ${report.denominatorPatients.toLocaleString('th-TH')} คน ที่ได้รับยากลุ่มนี้ รวม ${report.denominatorVisits.toLocaleString('th-TH')} ครั้ง — ผ่านเกณฑ์ของตัวชี้วัด`}
                />
              </div>
            ) : (
              <>
                <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-ink-3">
                    ต้องทบทวน {cases.length.toLocaleString('th-TH')} ครั้ง จากผู้ป่วย{' '}
                    {report.casePatients.toLocaleString('th-TH')} คน
                  </span>
                  <Tooltip title="ได้ไฟล์ทุกเคสที่แสดงอยู่ · มีชื่อผู้ป่วยและ HN อย่าส่งต่อออกนอกงาน">
                    <Button
                      icon={<FileExcelOutlined />}
                      onClick={exportCsv}
                      disabled={cases.length === 0}
                    >
                      ส่งออก Excel
                    </Button>
                  </Tooltip>
                </div>

                <div className="data-sheet">
                  <Table<RasDuplicateCase>
                    rowKey="vn"
                    size="small"
                    columns={columns}
                    dataSource={cases}
                    pagination={{ pageSize: 50, showSizeChanger: false }}
                    scroll={{ x: 'max-content' }}
                    locale={{ emptyText: <Empty description="ไม่มีรายการ" /> }}
                  />
                </div>
              </>
            )}
          </>
        ) : (
          !loading && (
            <div className="rounded-2xl border border-line bg-panel py-16 backdrop-blur-md">
              <Empty description="เลือกช่วงวันที่แล้วกดค้นหา" />
            </div>
          )
        )}
      </Spin>

      <VisitDetailModal
        open={picked != null}
        onClose={() => setPicked(null)}
        hn={picked?.hn ?? null}
        vn={picked?.vn ?? null}
        patientName={picked?.patientName ?? null}
        drugIcodes={report?.drugIcodes ?? []}
        drugLabel="RAS blockade"
      />
    </>
  )
}

function StatCard({
  label,
  value,
  unit,
  hint,
}: {
  label: string
  value: string
  unit: string
  /** บรรทัดเล็กใต้ตัวเลข — ใช้แยกองค์ประกอบของตัวเลขที่รวมกันมาหลายอย่าง */
  hint?: string
}) {
  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-3 backdrop-blur">
      <div className="text-[11px] text-ink-3">{label}</div>
      <div className="mt-0.5 text-xl font-semibold text-ink">
        <span className="qty">{value}</span>
        {unit && <span className="ml-1 text-xs font-normal text-ink-3">{unit}</span>}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-ink-3">{hint}</div>}
    </div>
  )
}
