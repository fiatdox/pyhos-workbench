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
  Tooltip,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { EyeOutlined, FileExcelOutlined, MoonOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import buddhistEra from 'dayjs/plugin/buddhistEra'
import { apiFetch } from '@/lib/client/session'
import { trackExport } from '@/lib/client/track-export'
import type { BenzoCase } from '@/lib/his/rdu-benzo'
import RowSearch, { matchesRow } from '../row-search'
import VisitDetailModal from '../visit-modal'

// เปิด token BBBB (ปี พ.ศ.) ให้ dayjs — ถ้าไม่ extend ปฏิทินจะพิมพ์คำว่า BBBB ออกมาตรง ๆ
dayjs.extend(buddhistEra)

const { Paragraph, Text, Title } = Typography
const { RangePicker } = DatePicker

/**
 * รายงานการใช้ยา long-acting benzodiazepine ในผู้ป่วยนอกสูงอายุ
 *
 * ตารางแสดงเฉพาะคนที่ได้รับยา ไม่ใช่ตัวหารทั้งชุด — ตัวหารคือผู้ป่วยนอกสูงอายุ
 * ทุกคน ทั้งปีมีสองหมื่นกว่าคน ขนลงมาให้เบราว์เซอร์กรองก็เท่ากับขนข้อมูลผู้ป่วย
 * มาโดยไม่ได้ใช้ ตัวหารจึงมาเป็นตัวเลขบนการ์ด ส่วนตารางเป็นรายการงานล้วน ๆ
 *
 * หนึ่งแถวคือผู้ป่วยหนึ่งคน ไม่ใช่หนึ่งครั้ง — งานที่ตามคือการทบทวนยาของคนคนนั้น
 * ไม่ใช่การทบทวนใบสั่งยาทีละใบ
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

/**
 * วิธีนับของตัวชี้วัด — สองแบบให้ตัวเลขต่างกันเกินสองเท่า
 *
 * นิยามนับเป็นคน จึงตั้งเป็นค่าเริ่มต้น แต่เปิดให้สลับดูรายครั้งได้ด้วย เพราะ
 * บางรอบประชุมอยากรู้ว่าเป็นการสั่งซ้ำของคนเดิมหรือกระจายไปหลายคน
 */
type Basis = 'patients' | 'visits'

const BASIS_LABEL: Record<Basis, string> = {
  patients: 'นับเป็นคน',
  visits: 'นับเป็นครั้ง',
}

type Report = {
  cases: BenzoCase[]
  elderlyPatients: number
  elderlyVisits: number
  benzoPatients: number
  benzoVisits: number
  minAgeYears: number
  drugItems: number
  drugIcodes: string[]
  target: number
  truncated: boolean
}

const SETTINGS_DRUG = '/home/rdu/settings/long-acting-benzo'
const SETTINGS_AGE = '/home/rdu/settings/age-criteria'

export default function BenzoReportPage() {
  const [range, setRange] = useState<[Dayjs, Dayjs]>(DEFAULT_RANGE)
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [basis, setBasis] = useState<Basis>('patients')
  /** คำค้นในตาราง — กรองในเบราว์เซอร์ ไม่ได้ยิงกลับไปที่ฐาน */
  const [keyword, setKeyword] = useState('')
  const [picked, setPicked] = useState<BenzoCase | null>(null)
  const [toast, toastHolder] = message.useMessage()

  const search = async () => {
    setLoading(true)
    setError('')
    try {
      const from = range[0].format('YYYY-MM-DD')
      const to = range[1].format('YYYY-MM-DD')
      const res = await apiFetch(`/api/his/rdu/benzo?from=${from}&to=${to}`)
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

  const figures = useMemo(() => {
    if (report == null) return null
    const denominator = basis === 'patients' ? report.elderlyPatients : report.elderlyVisits
    const numerator = basis === 'patients' ? report.benzoPatients : report.benzoVisits
    return {
      denominator,
      numerator,
      percent: denominator === 0 ? null : (numerator * 100) / denominator,
      unit: basis === 'patients' ? 'คน' : 'ครั้ง',
    }
  }, [report, basis])

  const cases = useMemo(() => report?.cases ?? [], [report])

  /** แถวที่เหลือหลังค้น — ตัวเลขบนการ์ดไม่ขยับตาม เพราะนับมาจากฐานทั้งช่วง */
  const shown = useMemo(
    () =>
      cases.filter(row =>
        matchesRow(
          [row.hn, row.patientName, row.ageYears, row.department, row.doctor, ...row.drugs],
          keyword,
        ),
      ),
    [cases, keyword],
  )

  const exportCsv = () => {
    if (shown.length === 0) {
      toast.info('ไม่มีรายการให้ส่งออก')
      return
    }

    const header = [
      'HN',
      'ชื่อ-สกุล',
      'เพศ',
      'อายุ',
      'จำนวนครั้งที่ได้รับ',
      'วันที่ได้รับล่าสุด',
      'ห้องตรวจล่าสุด',
      'แพทย์ผู้ตรวจล่าสุด',
      'รายการยาที่ได้รับ',
    ]
    const body = shown.map(row => [
      // นำหน้าด้วย ' เพื่อให้ Excel เก็บเป็นข้อความ ไม่ตัดศูนย์หน้า HN ทิ้ง
      `'${row.hn}`,
      row.patientName,
      sexLabel(row.sex),
      row.ageYears == null ? '' : String(row.ageYears),
      String(row.visits),
      toThaiDate(row.lastDate),
      row.department ?? '',
      row.doctor ?? '',
      row.drugs.join(' / '),
    ])

    const blob = new Blob([toCsv([header, ...body])], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `long-acting-benzodiazepine-ในผู้สูงอายุ-${range[0].format('YYYY-MM-DD')}-ถึง-${range[1].format('YYYY-MM-DD')}.csv`
    link.click()
    // แจ้งเซิร์ฟเวอร์ว่าข้อมูลชุดนี้ถูกนำออกจากระบบ — ไฟล์สร้างในเบราว์เซอร์
    // จึงไม่มีคำขอไหนวิ่งไปให้ proxy ดักได้เอง
    trackExport({ label: link.download, rows: body.length })
    // คืนหน่วยความจำของ blob หลังเบราว์เซอร์เริ่มดาวน์โหลดแล้ว
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success(`ส่งออก ${body.length} รายการแล้ว`)
  }

  const columns: ColumnsType<BenzoCase> = [
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
      title: 'ได้รับล่าสุด',
      dataIndex: 'lastDate',
      width: 130,
      /* จำนวนครั้งอยู่ใต้วันที่ — คนที่ได้รับครั้งเดียวกับคนที่ได้ทุกเดือนต่างกัน
         มากในแง่ของการตามทบทวน แต่นับเป็นหนึ่งคนเท่ากันในตัวชี้วัด */
      render: (date: string | null, row) => (
        <div className="leading-tight">
          <div>{toThaiDate(date)}</div>
          <div className="text-[11px] text-ink-3">ได้รับ {row.visits} ครั้ง</div>
        </div>
      ),
    },
    {
      title: 'ห้องตรวจล่าสุด',
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
      title: 'แพทย์ผู้ตรวจล่าสุด',
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

  return (
    <>
      {toastHolder}

      <section className="mb-6">
        <Breadcrumb
          className="mb-2"
          items={[
            { title: <Link href="/home/rdu">RDU ติดตามตัวชี้วัดการใช้ยา</Link> },
            { title: 'long-acting benzodiazepine ในผู้สูงอายุ' },
          ]}
        />
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          <MoonOutlined /> การใช้ยา long-acting benzodiazepine ในผู้ป่วยนอกสูงอายุ
        </Title>
        <div className="mb-2 h-px w-24 bg-linear-to-r from-violet-400/70 to-transparent" />
        <Paragraph type="secondary" style={{ maxWidth: 900, marginBottom: 0, fontSize: 12 }}>
          ผู้ป่วยนอกสูงอายุที่ได้รับยากลุ่ม benzodiazepine ที่ออกฤทธิ์ยาวในช่วงวันที่ที่เลือก —
          ยากลุ่มนี้ตกค้างในผู้สูงอายุนานกว่าคนหนุ่มสาวมาก เสี่ยงง่วงค้าง สับสน และล้ม
          ข้อนี้ยิ่งต่ำยิ่งดี เกณฑ์คือไม่เกิน 5% ตารางแสดงเฉพาะคนที่ได้รับ
          หนึ่งแถวคือผู้ป่วยหนึ่งคน
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
          ช่วงวันที่ = วันที่มารับบริการ เลือกได้ไม่เกิน 366 วัน · แสดงสูงสุด 3,000 คน ·
          ไม่นับครั้งที่รับไว้เป็นผู้ป่วยใน · ข้อนี้ไม่ใช้รหัสวินิจฉัย
          ตัวหารคือผู้ป่วยนอกสูงอายุทุกคนไม่ว่ามาด้วยเรื่องใด
        </Text>
      </div>

      {error && <Alert type="error" showIcon title={error} className="mb-4" />}

      {/* ทะเบียนยาว่าง = ไม่มีเกณฑ์ว่ารายการไหนออกฤทธิ์ยาว ตารางจะว่างทั้งที่มีการสั่งยาอยู่ */}
      {report && report.drugItems === 0 && (
        <Alert
          type="warning"
          showIcon
          className="mb-4"
          title="ยังไม่ได้ตั้งค่าทะเบียนยา long-acting benzodiazepine รายงานจึงว่างเปล่า"
          description={
            <span className="text-xs leading-relaxed">
              เลือกรายการยาที่นับว่าออกฤทธิ์ยาวก่อนที่{' '}
              <Link href={SETTINGS_DRUG} className="text-accent">
                หน้าตั้งค่ายา
              </Link>{' '}
              — ข้อนี้แยกด้วยชื่อสามัญอัตโนมัติไม่ได้ ต้องดูค่าครึ่งชีวิตของยาแต่ละตัว
            </span>
          }
        />
      )}

      {report?.truncated && (
        <Alert
          type="info"
          showIcon
          className="mb-4"
          title="รายการยาวเกินกว่าที่แสดงได้ในครั้งเดียว จึงตัดไว้ที่ 3,000 คน"
          description={
            <span className="text-xs leading-relaxed">
              แบ่งช่วงวันที่ให้สั้นลงเพื่อดูให้ครบ — ร้อยละบนการ์ดยังถูกต้องอยู่
              เพราะนับที่ฐานข้อมูลไม่ได้นับจากตาราง
            </span>
          }
        />
      )}

      <Spin spinning={loading}>
        {report && figures ? (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Segmented<Basis>
                value={basis}
                onChange={setBasis}
                options={[
                  { label: BASIS_LABEL.patients, value: 'patients' },
                  { label: BASIS_LABEL.visits, value: 'visits' },
                ]}
              />
              <Text type="secondary" className="text-[11px]">
                นิยามของตัวชี้วัดนับเป็นคน — แบบนับครั้งไว้ดูว่าเป็นการสั่งซ้ำของคนเดิมหรือไม่
              </Text>
            </div>

            <section className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label={`ตัวหาร — ผู้ป่วยนอกสูงอายุ (${report.minAgeYears} ปีขึ้นไป)`}
                value={figures.denominator.toLocaleString('th-TH')}
                unit={figures.unit}
                hint={
                  basis === 'patients'
                    ? `มารับบริการรวม ${report.elderlyVisits.toLocaleString('th-TH')} ครั้ง`
                    : `จากผู้ป่วย ${report.elderlyPatients.toLocaleString('th-TH')} คน`
                }
              />
              <StatCard
                label="ตัวตั้ง — ได้รับยาออกฤทธิ์ยาว"
                value={figures.numerator.toLocaleString('th-TH')}
                unit={figures.unit}
                hint={
                  basis === 'patients'
                    ? `ได้รับยารวม ${report.benzoVisits.toLocaleString('th-TH')} ครั้ง`
                    : `จากผู้ป่วย ${report.benzoPatients.toLocaleString('th-TH')} คน`
                }
              />
              <StatCard
                label={`ร้อยละที่ได้รับยา (${BASIS_LABEL[basis]})`}
                value={figures.percent == null ? '—' : figures.percent.toFixed(2)}
                unit={figures.percent == null ? '' : '%'}
                hint={
                  figures.percent == null
                    ? `เกณฑ์ไม่เกิน ${report.target}%`
                    : figures.percent <= report.target
                      ? `ผ่านเกณฑ์ (ไม่เกิน ${report.target}%)`
                      : `เกินเกณฑ์ ${report.target}%`
                }
                tone={
                  figures.percent == null ? 'plain' : figures.percent <= report.target ? 'good' : 'warn'
                }
              />
              <StatCard
                label="รายการยาในทะเบียน"
                value={report.drugItems.toLocaleString('th-TH')}
                unit="รายการ"
                hint="ตั้งได้ที่หน้าตั้งค่ายาออกฤทธิ์ยาว"
              />
            </section>

            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <RowSearch
                value={keyword}
                onChange={setKeyword}
                placeholder="ค้น HN ชื่อผู้ป่วย ชื่อยา ห้องตรวจ แพทย์"
              />
              <span className="text-xs text-ink-3">
                ต้องทบทวน {shown.length.toLocaleString('th-TH')} คน · เกณฑ์อายุปรับได้ที่{' '}
                <Link href={SETTINGS_AGE} className="text-accent">
                  หน้าตั้งค่าเกณฑ์อายุ
                </Link>
              </span>
              <Tooltip title="ได้ไฟล์ทุกคนที่แสดงอยู่ · มีชื่อผู้ป่วยและ HN อย่าส่งต่อออกนอกงาน">
                <Button
                  icon={<FileExcelOutlined />}
                  onClick={exportCsv}
                  disabled={shown.length === 0}
                >
                  ส่งออก Excel
                </Button>
              </Tooltip>
            </div>

            <div className="data-sheet">
              <Table<BenzoCase>
                rowKey="hn"
                size="small"
                columns={columns}
                dataSource={shown}
                pagination={{ pageSize: 50, showSizeChanger: false }}
                scroll={{ x: 'max-content' }}
                locale={{
                  emptyText: (
                    <Empty
                      description={
                        keyword.trim() === ''
                          ? 'ไม่พบผู้สูงอายุที่ได้รับยากลุ่มนี้ในช่วงวันที่ที่เลือก'
                          : `ไม่มีแถวที่ตรงกับคำค้น "${keyword.trim()}"`
                      }
                    />
                  ),
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

      {/* เปิดดูรายละเอียดของครั้งล่าสุดที่ได้รับยา — หนึ่งแถวเป็นรายคนไม่ใช่รายครั้ง
          จึงเลือกครั้งล่าสุดเป็นตัวแทน ซึ่งเป็นครั้งที่คนตามเคสต้องดูก่อนอยู่แล้ว */}
      <VisitDetailModal
        open={picked != null}
        onClose={() => setPicked(null)}
        hn={picked?.hn ?? null}
        vn={picked?.lastVn ?? null}
        patientName={picked?.patientName ?? null}
        drugIcodes={report?.drugIcodes ?? []}
        drugLabel="benzodiazepine ออกฤทธิ์ยาว"
      />
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
  /** เน้นสีเฉพาะการ์ดที่บอกผลของตัวชี้วัด — การ์ดตัวตั้งตัวหารเป็นแค่ตัวเลขกลาง ๆ */
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
