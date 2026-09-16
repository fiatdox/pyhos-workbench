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
import { EyeOutlined, FileExcelOutlined, MedicineBoxOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import buddhistEra from 'dayjs/plugin/buddhistEra'
import { apiFetch } from '@/lib/client/session'
import type { MetforminCase, MetforminCaseKind } from '@/lib/his/rdu-metformin'
import RowSearch, { matchesRow } from '../row-search'
import VisitDetailModal from '../visit-modal'

// เปิด token BBBB (ปี พ.ศ.) ให้ dayjs — ถ้าไม่ extend ปฏิทินจะพิมพ์คำว่า BBBB ออกมาตรง ๆ
dayjs.extend(buddhistEra)

const { Paragraph, Text, Title } = Typography
const { RangePicker } = DatePicker

/**
 * รายงานการใช้ยา metformin ในผู้ป่วยเบาหวาน
 *
 * ทิศทางกลับกับตัวชี้วัดกลุ่มยาปฏิชีวนะ — ข้อนี้ยิ่งใช้ยิ่งดี เกณฑ์คือตั้งแต่ 80%
 * ขึ้นไป รายการในตารางจึงเป็น "คนที่ยังไม่ได้ใช้" ไม่ใช่ "คนที่ใช้"
 *
 * หนึ่งแถวคือผู้ป่วยหนึ่งคนตลอดช่วงที่เลือก ไม่ใช่หนึ่งครั้งที่มา — ตัวชี้วัดนับ
 * เป็นคน และคนที่มารับยาทุกเดือนก็ไม่ควรโผล่มาสิบสองแถวให้ตามซ้ำสิบสองรอบ
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
 * ป้ายกำกับของเหตุที่อยู่ในรายการ
 *
 * สามกลุ่มนี้ต้องแยกสีให้ชัด เพราะสิ่งที่ต้องทำไม่เหมือนกันเลย — 'gap' คือรายชื่อ
 * ที่คณะกรรมการเอาไปทบทวนเพื่อดันตัวชี้วัดขึ้น ส่วน 'unsafe' เป็นเรื่องความปลอดภัย
 * ที่ต้องรีบกว่า แม้จะไม่มีผลกับตัวเลขของตัวชี้วัดเลยก็ตาม
 */
const KIND_LABEL: Record<MetforminCaseKind, string> = {
  gap: 'ยังไม่ได้ใช้ metformin',
  excluded: 'มีข้อห้ามใช้',
  unsafe: 'ใช้ทั้งที่มีข้อห้าม',
}

const KIND_COLOR: Record<MetforminCaseKind, string> = {
  gap: 'orange',
  excluded: 'default',
  unsafe: 'red',
}

type Filter = 'all' | MetforminCaseKind

type Report = {
  cases: MetforminCase[]
  totalPatients: number
  contraindicatedPatients: number
  denominatorPatients: number
  metforminPatients: number
  metforminDespiteContraindication: number
  totalVisits: number
  diagnosisCodes: number
  antidiabeticItems: number
  metforminItems: number
  metforminIcodes: string[]
  egfrThreshold: number
  target: number
  truncated: boolean
}

const SETTINGS_DIAGNOSIS = '/home/rdu/settings/dm-icd10'
const SETTINGS_ANTIDIABETIC = '/home/rdu/settings/antidiabetic'

export default function MetforminReportPage() {
  const [range, setRange] = useState<[Dayjs, Dayjs]>(DEFAULT_RANGE)
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  /** คำค้นในตาราง — กรองในเบราว์เซอร์ ไม่ได้ยิงกลับไปที่ฐาน */
  const [keyword, setKeyword] = useState('')
  const [picked, setPicked] = useState<MetforminCase | null>(null)
  const [toast, toastHolder] = message.useMessage()

  const search = async () => {
    setLoading(true)
    setError('')
    try {
      const from = range[0].format('YYYY-MM-DD')
      const to = range[1].format('YYYY-MM-DD')
      const res = await apiFetch(`/api/his/rdu/metformin?from=${from}&to=${to}`)
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

  /**
   * ร้อยละของตัวชี้วัด — ตัวหารตัดคนที่มีข้อห้ามใช้ออกแล้ว
   *
   * นิยามเขียนว่า "โดยไม่มีข้อห้ามใช้" การเอาคนที่ไตเสื่อมจนห้ามใช้ metformin
   * มาหารด้วย เท่ากับลงโทษโรงพยาบาลที่สั่งยาถูกต้องตามข้อห้าม
   */
  const percent = useMemo(() => {
    if (report == null || report.denominatorPatients === 0) return null
    return (report.metforminPatients * 100) / report.denominatorPatients
  }, [report])

  // ผูกกับ report ไว้ใน useMemo ไม่ใช่เขียน ?? [] ตรง ๆ — ไม่งั้นได้อาร์เรย์ใหม่
  // ทุกครั้งที่ render แล้ว useMemo ของ shown ด้านล่างจะคำนวณใหม่ทุกรอบไปด้วย
  const cases = useMemo(() => report?.cases ?? [], [report])

  const countOf = (kind: MetforminCaseKind) => cases.filter(row => row.kind === kind).length

  /* ค้นทับตัวกรองกลุ่ม ไม่ใช่แทนที่ — ตัวกรองบอกว่า "กลุ่มไหน" ส่วนช่องค้นบอกว่า
     "คนไหน" และมักใช้คู่กัน (เลือกกลุ่มที่ต้องทบทวนก่อน แล้วค้นชื่อยาต่อ) */
  const shown = useMemo(() => {
    const byFilter = filter === 'all' ? cases : cases.filter(row => row.kind === filter)
    return byFilter.filter(row =>
      matchesRow(
        [
          row.hn,
          row.patientName,
          row.ageYears,
          row.department,
          row.doctor,
          row.egfr,
          ...row.drugs,
        ],
        keyword,
      ),
    )
  }, [cases, filter, keyword])

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
      'สถานะ',
      'จำนวนครั้งที่รับยา',
      'วันที่รับยาล่าสุด',
      'ห้องตรวจล่าสุด',
      'แพทย์ผู้ตรวจล่าสุด',
      'eGFR ล่าสุด',
      'วันที่ตรวจ eGFR',
      'ยาลดน้ำตาลที่ได้รับ',
    ]
    const body = shown.map(row => [
      // นำหน้าด้วย ' เพื่อให้ Excel เก็บเป็นข้อความ ไม่ตัดศูนย์หน้า HN ทิ้ง
      `'${row.hn}`,
      row.patientName,
      sexLabel(row.sex),
      row.ageYears == null ? '' : String(row.ageYears),
      KIND_LABEL[row.kind],
      String(row.visits),
      toThaiDate(row.lastDate),
      row.department ?? '',
      row.doctor ?? '',
      row.egfr == null ? '' : String(row.egfr),
      toThaiDate(row.egfrDate),
      row.drugs.join(' / '),
    ])

    const blob = new Blob([toCsv([header, ...body])], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `การใช้-metformin-ในผู้ป่วยเบาหวาน-${range[0].format('YYYY-MM-DD')}-ถึง-${range[1].format('YYYY-MM-DD')}.csv`
    link.click()
    // คืนหน่วยความจำของ blob หลังเบราว์เซอร์เริ่มดาวน์โหลดแล้ว
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success(`ส่งออก ${body.length} รายการแล้ว`)
  }

  const columns: ColumnsType<MetforminCase> = [
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
      title: 'สถานะ',
      dataIndex: 'kind',
      width: 160,
      render: (kind: MetforminCaseKind) => (
        <Tag color={KIND_COLOR[kind]} className="mr-0!">
          {KIND_LABEL[kind]}
        </Tag>
      ),
    },
    {
      title: 'รับยาล่าสุด',
      dataIndex: 'lastDate',
      width: 130,
      /* จำนวนครั้งอยู่ใต้วันที่ — คนที่มารับยาครั้งเดียวทั้งปีกับคนที่มาทุกเดือน
         มีน้ำหนักในการตามต่างกันมาก แต่ทั้งคู่นับเป็นหนึ่งคนเท่ากันในตัวชี้วัด */
      render: (date: string | null, row) => (
        <div className="leading-tight">
          <div>{toThaiDate(date)}</div>
          <div className="text-[11px] text-ink-3">รับยา {row.visits} ครั้ง</div>
        </div>
      ),
    },
    {
      title: 'eGFR ล่าสุด',
      dataIndex: 'egfr',
      width: 130,
      render: (egfr: number | null, row) => {
        if (egfr == null) {
          return (
            <Text type="secondary" className="text-xs">
              ไม่มีผลแล็บ
            </Text>
          )
        }
        const low = report != null && egfr < report.egfrThreshold
        return (
          <div className="leading-tight">
            <span className="qty text-sm font-semibold text-ink">{egfr.toFixed(1)}</span>
            {low && (
              <Tag color="red" className="ml-1.5 mr-0!">
                ต่ำกว่า {report?.egfrThreshold}
              </Tag>
            )}
            <div className="text-[11px] text-ink-3">{toThaiDate(row.egfrDate)}</div>
          </div>
        )
      },
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
      title: 'ยาลดน้ำตาลที่ได้รับ',
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
            { title: 'การใช้ metformin ในผู้ป่วยเบาหวาน' },
          ]}
        />
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          <MedicineBoxOutlined /> การใช้ยา metformin ในผู้ป่วยเบาหวาน
        </Title>
        <div className="mb-2 h-px w-24 bg-linear-to-r from-violet-400/70 to-transparent" />
        <Paragraph type="secondary" style={{ maxWidth: 900, marginBottom: 0, fontSize: 12 }}>
          ผู้ป่วยเบาหวานที่ได้รับยาลดระดับน้ำตาลในช่วงวันที่ที่เลือก มีกี่คนที่ได้รับ metformin
          ไม่ว่าจะเดี่ยว ๆ หรือร่วมกับยาอื่น — ข้อนี้ยิ่งสูงยิ่งดี เกณฑ์คือตั้งแต่ 80% ขึ้นไป
          ตารางจึงแสดงเฉพาะคนที่ยังไม่ได้ใช้ หนึ่งแถวคือผู้ป่วยหนึ่งคน ไม่ใช่หนึ่งครั้งที่มา
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
          ช่วงวันที่ = วันที่รับยา เลือกได้ไม่เกิน 366 วัน · แสดงสูงสุด 3,000 คน ·
          ไม่นับครั้งที่รับไว้เป็นผู้ป่วยใน · ข้อห้ามใช้ดูจากค่า eGFR ล่าสุดของผู้ป่วย
          จึงต้องไล่ผลแล็บทีละคน — การดูทั้งปีงบประมาณใช้เวลาราวสิบวินาที
        </Text>
      </div>

      {error && <Alert type="error" showIcon title={error} className="mb-4" />}

      {/* ทะเบียนยาลดน้ำตาลว่าง = ไม่มีตัวหาร ทั้งหน้าจะเป็นศูนย์โดยไม่ได้แปลว่า
          โรงพยาบาลไม่ได้จ่ายยาเบาหวานเลย ต้องบอกให้ชัดว่าเป็นเพราะยังไม่ได้ตั้งค่า */}
      {report && report.antidiabeticItems === 0 && (
        <Alert
          type="warning"
          showIcon
          className="mb-4"
          title="ยังไม่ได้ตั้งค่าทะเบียนยาลดระดับน้ำตาล ตัวหารจึงเป็นศูนย์"
          description={
            <span className="text-xs leading-relaxed">
              เลือกรายการยาลดน้ำตาลทั้งหมดก่อนที่{' '}
              <Link href={SETTINGS_ANTIDIABETIC} className="text-accent">
                หน้าตั้งค่ายาลดระดับน้ำตาล
              </Link>
            </span>
          }
        />
      )}

      {/* ตัวตั้งอ่านจาก drugitems.generic_name ไม่มีทะเบียนให้ตั้ง ถ้าไม่เจอเลย
          แปลว่าฐานรายการยามีปัญหา ไม่ใช่เรื่องที่ไปตั้งค่าเพิ่มแล้วจะหาย */}
      {report && report.metforminItems === 0 && (
        <Alert
          type="warning"
          showIcon
          className="mb-4"
          title="ไม่พบรายการยาที่มี metformin ในฐานรายการยา ตัวตั้งจึงเป็นศูนย์"
          description={
            <span className="text-xs leading-relaxed">
              ข้อนี้ดูจากชื่อสามัญในตาราง drugitems ไม่ได้ใช้ทะเบียนที่ตั้งเอง —
              ถ้ารายการยา metformin ของโรงพยาบาลไม่ได้กรอกชื่อสามัญไว้
              ต้องไปแก้ที่โปรแกรม HIS
            </span>
          }
        />
      )}

      {report && report.diagnosisCodes === 0 && (
        <Alert
          type="warning"
          showIcon
          className="mb-4"
          title="ยังไม่ได้ตั้งค่าทะเบียนรหัสวินิจฉัยโรคเบาหวาน รายงานจึงว่างเปล่า"
          description={
            <span className="text-xs leading-relaxed">
              เลือกรหัส ICD-10 ที่นับเป็นโรคเบาหวานก่อนที่{' '}
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
        {report ? (
          <>
            <section className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="ตัวหาร — ผู้ป่วยเบาหวานที่ได้รับยาลดน้ำตาล"
                value={report.denominatorPatients.toLocaleString('th-TH')}
                unit="คน"
                hint={`จากทั้งหมด ${report.totalPatients.toLocaleString('th-TH')} คน ตัดผู้มีข้อห้ามใช้ออก ${report.contraindicatedPatients.toLocaleString('th-TH')} คน`}
              />
              <StatCard
                label="ตัวตั้ง — ได้รับ metformin"
                value={report.metforminPatients.toLocaleString('th-TH')}
                unit="คน"
                hint={`มารับยารวม ${report.totalVisits.toLocaleString('th-TH')} ครั้งในช่วงนี้`}
              />
              <StatCard
                label="ร้อยละที่ใช้ metformin"
                value={percent == null ? '—' : percent.toFixed(1)}
                unit={percent == null ? '' : '%'}
                hint={
                  percent == null
                    ? `เกณฑ์ตั้งแต่ ${report.target}% ขึ้นไป`
                    : percent >= report.target
                      ? `ผ่านเกณฑ์ (ตั้งแต่ ${report.target}% ขึ้นไป)`
                      : `ยังไม่ถึงเกณฑ์ ${report.target}%`
                }
                tone={percent == null ? 'plain' : percent >= report.target ? 'good' : 'warn'}
              />
              <StatCard
                label="ใช้ทั้งที่มีข้อห้าม"
                value={report.metforminDespiteContraindication.toLocaleString('th-TH')}
                unit="คน"
                hint={`ได้รับ metformin ทั้งที่ eGFR ต่ำกว่า ${report.egfrThreshold}`}
                tone={report.metforminDespiteContraindication > 0 ? 'warn' : 'plain'}
              />
            </section>

            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <Segmented<Filter>
                value={filter}
                onChange={setFilter}
                options={[
                  { label: `ทั้งหมด (${cases.length.toLocaleString('th-TH')})`, value: 'all' },
                  {
                    label: `ยังไม่ได้ใช้ (${countOf('gap').toLocaleString('th-TH')})`,
                    value: 'gap',
                  },
                  {
                    label: `มีข้อห้ามใช้ (${countOf('excluded').toLocaleString('th-TH')})`,
                    value: 'excluded',
                  },
                  {
                    label: `ใช้ทั้งที่มีข้อห้าม (${countOf('unsafe').toLocaleString('th-TH')})`,
                    value: 'unsafe',
                  },
                ]}
              />
              <div className="flex flex-wrap items-center gap-3">
                <RowSearch
                  value={keyword}
                  onChange={setKeyword}
                  placeholder="ค้น HN ชื่อผู้ป่วย ชื่อยา ห้องตรวจ แพทย์"
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
              <Table<MetforminCase>
                rowKey="hn"
                size="small"
                columns={columns}
                dataSource={shown}
                pagination={{ pageSize: 50, showSizeChanger: false }}
                scroll={{ x: 'max-content' }}
                locale={{
                  emptyText: (
                    <Empty description="ไม่มีผู้ป่วยในกลุ่มนี้ในช่วงวันที่ที่เลือก" />
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

      {/* เปิดดูรายละเอียดของครั้งล่าสุดที่ผู้ป่วยคนนั้นมารับยา — หนึ่งแถวเป็นรายคน
          ไม่ใช่รายครั้ง จึงเลือกครั้งล่าสุดให้เป็นตัวแทน ซึ่งเป็นครั้งที่คนตามเคส
          ต้องดูก่อนอยู่แล้วว่าตอนนี้ผู้ป่วยได้ยาอะไรอยู่บ้าง */}
      <VisitDetailModal
        open={picked != null}
        onClose={() => setPicked(null)}
        hn={picked?.hn ?? null}
        vn={picked?.lastVn ?? null}
        patientName={picked?.patientName ?? null}
        drugIcodes={report?.metforminIcodes ?? []}
        drugLabel="metformin"
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
