'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ยังทำที่ app/home/rdu/layout.tsx ซึ่งเป็น Server Component)
import { useMemo, useState, type ReactNode } from 'react'
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
import { EyeOutlined, FileExcelOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import buddhistEra from 'dayjs/plugin/buddhistEra'
import { apiFetch } from '@/lib/client/session'
import type { ReportVisit } from '@/lib/his/rdu-visit-report'
import VisitDetailModal from './visit-modal'

// เปิด token BBBB (ปี พ.ศ.) ให้ dayjs — ถ้าไม่ extend ปฏิทินจะพิมพ์คำว่า BBBB ออกมาตรง ๆ
dayjs.extend(buddhistEra)

const { Paragraph, Text, Title } = Typography
const { RangePicker } = DatePicker

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

/**
 * แปลงตารางเป็นไฟล์ CSV ที่ Excel เปิดได้ตรง ๆ (รูปแบบเดียวกับหน้าส่งยาถึงบ้าน)
 *
 * ใส่ BOM ไว้หน้าไฟล์ เพราะ Excel บนวินโดวส์เดาว่า CSV เป็นรหัสภาษาไทยของเครื่อง
 * (CP874) ถ้าไม่มี BOM ตัวอักษรไทยจะกลายเป็นขยะทั้งไฟล์
 *
 * ครอบทุกช่องด้วยเครื่องหมายคำพูดและ escape คำพูดข้างในเป็นสองตัว — ชื่อยาและ
 * ชื่อห้องตรวจในฐานมีจุลภาคอยู่เต็มไปหมด (เช่น 'AEROTIDE-250,บ.แอร์โรแคร์'
 * และ 'ER [1520,1530]') ถ้าไม่ครอบไว้คอลัมน์จะเลื่อนทั้งแถว
 */
function toCsv(rows: string[][]): string {
  const cell = (value: string) => `"${value.replace(/"/g, '""')}"`
  return '﻿' + rows.map(row => row.map(cell).join(',')).join('\r\n')
}

const sexLabel = (sex: string | null) => (sex === '1' ? 'ชาย' : sex === '2' ? 'หญิง' : '—')

/**
 * ตัวกรองของตาราง — สามกลุ่มล่างแบ่งกันหมดพอดี รวมกันได้เท่า 'all'
 *
 * 'with' จึงหมายถึงครั้งที่จ่ายยาจริงเท่านั้น ไม่ได้รวมครั้งที่ใช้ยาเดิมต่อ
 * ทั้งที่ตัวชี้วัดนับสองกลุ่มนี้รวมกัน — ถ้าให้ปุ่มซ้อนกัน จำนวนในวงเล็บจะบวกแล้ว
 * เกินยอดรวม ซึ่งอ่านผิดได้ทันที ส่วนตัวตั้งของตัวชี้วัดไปอ่านที่การ์ดด้านบนแทน
 */
type Filter = 'all' | 'with' | 'continued' | 'without'

type Report = {
  visits: ReportVisit[]
  diagnosisCodes: number
  drugItems: number
  drugIcodes: string[]
  maxAgeYears: number | null
  minAgeYears: number | null
  countsContinued: boolean
  truncated: boolean
}

/**
 * สถานะการได้รับยาของครั้งหนึ่ง
 *
 * 'continued' คือแถวที่มีรายการยาในทะเบียนแต่จำนวนเป็นศูนย์ = ผู้ป่วยใช้ยาเดิม
 * ที่มีอยู่ต่อ ตัวชี้วัดนับรวมกับ 'dispensed' แต่แยกป้ายกำกับไว้ เพราะเภสัชกร
 * ต้องแยกออกว่าเคสไหนได้ยาใหม่ เคสไหนแค่ยืนยันว่ายังใช้ยาเดิมอยู่
 * (สถานะนี้เกิดได้เฉพาะข้อที่เปิด countContinued ไว้ใน rdu-visit-report.ts)
 */
type DrugStatus = 'dispensed' | 'continued' | 'none'

const statusOf = (visit: ReportVisit): DrugStatus =>
  visit.drugs.length > 0 ? 'dispensed' : visit.continuedDrugs.length > 0 ? 'continued' : 'none'

const STATUS_LABEL: Record<DrugStatus, string> = {
  dispensed: 'ได้รับ',
  continued: 'ใช้ยาต่อเนื่อง',
  none: 'ไม่ได้รับ',
}

/** ปุ่มกรองแต่ละอันตรงกับสถานะอันเดียว ยกเว้น 'all' ที่ไม่กรอง */
const FILTER_STATUS: Record<Exclude<Filter, 'all'>, DrugStatus> = {
  with: 'dispensed',
  continued: 'continued',
  without: 'none',
}

/**
 * คำที่ใช้เรียกของตัวชี้วัดแต่ละข้อ
 *
 * แยกออกมาเป็น prop แทนที่จะเขียนตายในคอมโพเนนต์ เพราะทิศทางของตัวชี้วัด
 * ไม่เหมือนกัน — โรคหืดยิ่งได้รับยา ICS ยิ่งดี ส่วนโรคติดเชื้อทางเดินหายใจส่วนบน
 * ยิ่งได้รับยาปฏิชีวนะยิ่งต้องทบทวน กลุ่มที่เภสัชกรต้องตามจึงคนละกลุ่มกัน
 */
export type ReportLabels = {
  /** ชื่อตัวชี้วัดบนหัวหน้า */
  title: string
  breadcrumb: string
  icon: ReactNode
  intro: string
  /** คำเรียกยาในทะเบียน เช่น 'ยา ICS' / 'ยาปฏิชีวนะ' */
  drugLabel: string
  /** คำเรียกกลุ่มผู้ป่วยในหัวตาราง เช่น 'ผู้ป่วยโรคหอบหืด' */
  patientLabel: string
  /**
   * กลุ่มที่ต้องทบทวน — 'with' = กลุ่มที่ได้รับยา (เช่น RI), 'without' = กลุ่มที่
   * ไม่ได้รับยา (เช่น โรคหืด) ใช้เน้นสีปุ่มตัวกรองและเลือกว่าร้อยละไหนขึ้นการ์ด
   */
  followUp: 'with' | 'without'
  /** ลิงก์หน้าตั้งค่าทะเบียนของตัวชี้วัดข้อนี้
   *  drug ไม่มีได้ — บางข้อดูยาจากธงใน drugitems ไม่มีทะเบียนให้ตั้ง */
  settings: { diagnosis: string; drug?: string }
  /** ชื่อไฟล์ที่ส่งออก (ยังไม่รวมช่วงวันที่และนามสกุล) */
  fileName: string
}

/**
 * รายงานผู้ป่วยนอกตามตัวชี้วัด RDU — ใช้ร่วมกันทุกข้อ
 *
 * เป็นรายการทำงาน ไม่ใช่แค่ตัวเลขสรุป เภสัชกรจึงต้องเปิดดูรายครั้งได้ว่าเคสนั้น
 * เป็นเพราะอะไร
 *
 * เกณฑ์การนับทั้งสองด้าน (รหัสวินิจฉัย / รายการยา) อ่านจากทะเบียนในหน้าตั้งค่า
 * ถ้าทะเบียนยังว่าง รายงานจะว่างตามหรือขึ้นว่าไม่ได้รับยาทุกแถว — หน้าจอจึงต้อง
 * บอกให้ชัดว่าเป็นเพราะยังไม่ได้ตั้งค่า ไม่ใช่เพราะไม่มีผู้ป่วย
 */
export default function VisitReportPage({
  kind,
  labels,
}: {
  /** ชื่อตัวชี้วัดตามที่ lib/his/rdu-visit-report.ts รู้จัก */
  kind: string
  labels: ReportLabels
}) {
  const [range, setRange] = useState<[Dayjs, Dayjs]>(DEFAULT_RANGE)
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [picked, setPicked] = useState<ReportVisit | null>(null)
  const [toast, toastHolder] = message.useMessage()

  const search = async () => {
    setLoading(true)
    setError('')
    try {
      const from = range[0].format('YYYY-MM-DD')
      const to = range[1].format('YYYY-MM-DD')
      const res = await apiFetch(`/api/his/rdu/visits/${kind}?from=${from}&to=${to}`)
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

  const stats = useMemo(() => {
    const visits = report?.visits ?? []
    // ตัวตั้งนับทั้งที่จ่ายยาใหม่และที่ใช้ยาเดิมต่อ — การ์ด "ได้รับยา" จึงเป็น
    // ผลรวมของสองกลุ่ม แล้วแยกจำนวนที่ใช้ยาต่อเนื่องไว้เป็นบรรทัดรองอีกที
    const dispensed = visits.filter(visit => statusOf(visit) === 'dispensed').length
    const continued = visits.filter(visit => statusOf(visit) === 'continued').length
    const withDrug = dispensed + continued
    return {
      total: visits.length,
      dispensed,
      continued,
      withDrug,
      without: visits.length - withDrug,
      // ตัวชี้วัดคิดเป็นร้อยละของครั้งที่มารับบริการ ไม่ใช่ของรายผู้ป่วย
      // ตามที่ตกลงว่าหนึ่งแถวคือหนึ่ง vn
      percent: visits.length === 0 ? null : (withDrug * 100) / visits.length,
    }
  }, [report])

  const visible = useMemo(() => {
    const visits = report?.visits ?? []
    if (filter === 'all') return visits
    return visits.filter(visit => statusOf(visit) === FILTER_STATUS[filter])
  }, [report, filter])

  /**
   * ดาวน์โหลดตารางที่เห็นอยู่เป็นไฟล์ CSV ที่ Excel เปิดได้
   *
   * ส่งออกชุดเดียวกับที่กรองอยู่บนหน้าจอ ไม่ใช่ทั้งช่วงวันที่เสมอ — เลือกตัวกรอง
   * กลุ่มที่ต้องทบทวนไว้แล้วได้ไฟล์ที่มีทุกคน จะเข้าใจผิดว่าไฟล์ไม่ตรงกับที่เห็น
   *
   * ไฟล์นี้มีชื่อผู้ป่วยกับ HN เตือนไว้ตรงปุ่มด้วยว่าอย่าส่งต่อออกนอกงาน
   */
  const exportCsv = () => {
    if (visible.length === 0) {
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
      'รหัสวินิจฉัย',
      `ได้รับ${labels.drugLabel}`,
      `รายการ${labels.drugLabel}ที่ได้รับ`,
    ]
    const body = visible.map(row => [
      toThaiDate(row.date),
      // นำหน้าด้วย ' เพื่อให้ Excel เก็บเป็นข้อความ ไม่ตัดศูนย์หน้า HN/VN ทิ้ง
      // แล้วแปลง VN 12 หลักเป็นจำนวนเต็มจนเลขท้ายเพี้ยน
      `'${row.vn}`,
      `'${row.hn}`,
      row.patientName,
      sexLabel(row.sex),
      row.ageYears == null ? '' : String(row.ageYears),
      row.department ?? '',
      row.doctor ?? '',
      row.icd10.join(' '),
      STATUS_LABEL[statusOf(row)],
      // รวมสองกลุ่มไว้ในช่องเดียว แต่วงเล็บกำกับตัวที่เป็นยาเดิม เพื่อให้ไฟล์ที่
      // เปิดใน Excel อ่านได้ความหมายเดียวกับที่เห็นบนหน้าจอ
      [...row.drugs, ...row.continuedDrugs.map(name => `${name} (ยาเดิม)`)].join(' / '),
    ])

    const blob = new Blob([toCsv([header, ...body])], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${labels.fileName}-${range[0].format('YYYY-MM-DD')}-ถึง-${range[1].format('YYYY-MM-DD')}.csv`
    link.click()
    // คืนหน่วยความจำของ blob หลังเบราว์เซอร์เริ่มดาวน์โหลดแล้ว
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success(`ส่งออก ${body.length} รายการแล้ว`)
  }

  const columns: ColumnsType<ReportVisit> = [
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
    { title: 'ชื่อ-สกุล', dataIndex: 'patientName', width: 220 },
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
      title: 'ห้องตรวจ',
      dataIndex: 'department',
      width: 190,
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
      width: 180,
      render: (name: string | null) =>
        name ?? (
          <Text type="secondary" className="text-xs">
            —
          </Text>
        ),
    },
    {
      title: 'รหัสวินิจฉัย',
      dataIndex: 'icd10',
      width: 160,
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
      title: `ได้รับ${labels.drugLabel}`,
      key: 'status',
      width: 130,
      align: 'center',
      /* สีของแท็กตามทิศทางของตัวชี้วัด ไม่ใช่ตาม "ได้รับ/ไม่ได้รับ" เสมอไป —
         โรคหืดที่ได้รับยา ICS คือผลที่ต้องการ ส่วน RI ที่ได้รับยาปฏิชีวนะคือ
         กลุ่มที่ต้องทบทวน ถ้าใช้สีเขียวกับ "ได้รับ" ทุกข้อจะอ่านผิดทันที

         "ใช้ยาต่อเนื่อง" ใช้สีฟ้าเป็นกลุ่มของตัวเอง ไม่ตามทิศทางของตัวชี้วัด —
         เป็นกลุ่มที่เภสัชกรต้องแยกออกมาดูต่างหาก (ได้ยาอยู่แต่ไม่ได้จ่ายรอบนี้)
         จึงมีปุ่มกรองของตัวเองคู่กับสีนี้ ส่วนตัวเลขยังนับรวมเป็นการใช้ยาเหมือนเดิม */
      render: (_, row) => {
        const status = statusOf(row)
        const isFollowUp = (status !== 'none') === (labels.followUp === 'with')
        const tag = (
          <Tag
            color={status === 'continued' ? 'blue' : isFollowUp ? 'orange' : 'green'}
            className="mr-0!"
          >
            {STATUS_LABEL[status]}
          </Tag>
        )
        return status === 'continued' ? (
          <Tooltip title="มีรายการยาในใบสั่งแต่ไม่ได้จ่าย = ผู้ป่วยใช้ยาเดิมที่มีอยู่ต่อ นับเป็นการใช้ยา">
            {tag}
          </Tooltip>
        ) : (
          tag
        )
      },
    },
    {
      title: `รายการ${labels.drugLabel}ที่ได้รับ`,
      key: 'drugs',
      render: (_, row) =>
        row.drugs.length === 0 && row.continuedDrugs.length === 0 ? (
          <Text type="secondary" className="text-xs">
            —
          </Text>
        ) : (
          <span className="text-xs">
            {row.drugs.join(' / ')}
            {row.continuedDrugs.length > 0 && (
              <>
                {row.drugs.length > 0 && ' / '}
                <span className="text-ink-3">
                  {row.continuedDrugs.join(' / ')}{' '}
                  <Tag className="mr-0! text-[10px]">ยาเดิม</Tag>
                </span>
              </>
            )}
          </span>
        ),
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

  const followUpCount = labels.followUp === 'with' ? stats.withDrug : stats.without

  return (
    <>
      {toastHolder}

      <section className="mb-6">
        <Breadcrumb
          className="mb-2"
          items={[
            { title: <Link href="/home/rdu">RDU ติดตามตัวชี้วัดการใช้ยา</Link> },
            { title: labels.breadcrumb },
          ]}
        />
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          {labels.icon} {labels.title}
        </Title>
        <div className="mb-2 h-px w-24 bg-linear-to-r from-violet-400/70 to-transparent" />
        <Paragraph type="secondary" style={{ maxWidth: 820, marginBottom: 0, fontSize: 12 }}>
          {labels.intro} — หนึ่งแถวคือการมารับบริการหนึ่งครั้ง (VN)
          กดปุ่มดูเพื่อเปิดรายการยาและการวินิจฉัยของครั้งนั้น
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
          ช่วงวันที่ = วันที่มารับบริการ เลือกได้ไม่เกิน 366 วัน · แสดงสูงสุด 2,000 ครั้ง ·
          ไม่นับครั้งที่รับไว้เป็นผู้ป่วยใน
          {/* เงื่อนไขอายุมาจากนิยามของตัวชี้วัด ไม่ใช่ตัวกรองที่ผู้ใช้ตั้งเอง
              ต้องเขียนไว้ให้เห็น ไม่งั้นจะสงสัยว่าทำไมตัวเลขน้อยกว่าที่นับเองจาก HIS */}
          {report?.maxAgeYears != null &&
            ` · นับเฉพาะผู้ป่วยอายุไม่เกิน ${report.maxAgeYears} ปี ตามนิยามของตัวชี้วัด`}
          {report?.minAgeYears != null &&
            ` · นับเฉพาะผู้ป่วยอายุตั้งแต่ ${report.minAgeYears} ปีขึ้นไป ตามนิยามของตัวชี้วัด`}
          {/* กฎการนับข้อนี้ต่างจากข้ออื่น ต้องเขียนไว้ให้เห็นคู่กับตัวเลขเสมอ
              ไม่งั้นคนที่เทียบกับรายงานข้ออื่นจะคิดว่านับไม่เหมือนกันโดยผิดพลาด */}
          {report?.countsContinued &&
            ' · ครั้งที่มีรายการยาในใบสั่งแต่ไม่ได้จ่าย นับเป็นการใช้ยาต่อเนื่อง (ผู้ป่วยใช้ยาเดิมที่มีอยู่)'}
        </Text>
      </div>

      {error && <Alert type="error" showIcon title={error} className="mb-4" />}

      {/* ทะเบียนว่าง = รายงานว่างหรือขึ้นว่าไม่ได้รับยาทุกแถว ต้องบอกว่าเป็นเพราะอะไร
          ไม่งั้นจะอ่านตัวเลขผิดไปว่าโรงพยาบาลไม่มีผู้ป่วยหรือไม่จ่ายยาเลย */}
      {report && report.diagnosisCodes === 0 && (
        <Alert
          type="warning"
          showIcon
          className="mb-4"
          title="ยังไม่ได้ตั้งค่าทะเบียนรหัสวินิจฉัย รายงานจึงว่างเปล่า"
          description={
            <span className="text-xs leading-relaxed">
              เลือกรหัส ICD-10 ที่นับเป็น{labels.patientLabel}ก่อนที่{' '}
              <Link href={labels.settings.diagnosis} className="text-accent">
                หน้าตั้งค่ารหัสวินิจฉัย
              </Link>
            </span>
          }
        />
      )}

      {/* ข้อที่ดูยาจากธงใน drugitems ไม่มีทะเบียนให้ตั้ง จึงไม่ต้องเตือนเรื่องนี้
          (labels.settings.drug ว่าง = ไม่มีหน้าตั้งค่ายา) */}
      {report && report.diagnosisCodes > 0 && report.drugItems === 0 && labels.settings.drug && (
        <Alert
          type="warning"
          showIcon
          className="mb-4"
          title={`ยังไม่ได้ตั้งค่าทะเบียน${labels.drugLabel} ทุกแถวจึงขึ้นว่าไม่ได้รับยา`}
          description={
            <span className="text-xs leading-relaxed">
              เลือกรายการยาที่นับเป็น{labels.drugLabel}ก่อนที่{' '}
              <Link href={labels.settings.drug} className="text-accent">
                หน้าตั้งค่ารายการยา
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
          title="รายการยาวเกินกว่าที่แสดงได้ในครั้งเดียว จึงตัดไว้ที่ 2,000 ครั้งล่าสุด"
          description={
            <span className="text-xs leading-relaxed">
              แบ่งช่วงวันที่ให้สั้นลงเพื่อดูให้ครบ — ตัวเลขสรุปด้านล่างนับเฉพาะที่แสดงอยู่
            </span>
          }
        />
      )}

      <Spin spinning={loading}>
        {report ? (
          <>
            <section className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="ครั้งที่มารับบริการ" value={`${stats.total}`} unit="ครั้ง" />
              <StatCard
                label={`ได้รับ${labels.drugLabel}`}
                value={`${stats.withDrug}`}
                unit="ครั้ง"
                /* แยกให้เห็นว่าในตัวตั้งมีกี่ครั้งที่เป็นยาเดิม — ถ้าไม่บอก คนอ่าน
                   ที่เคยเห็นตัวเลขชุดก่อนจะสงสัยว่าทำไมตัวชี้วัดขยับขึ้นเฉย ๆ */
                hint={
                  report.countsContinued && stats.continued > 0
                    ? `จ่ายยา ${stats.dispensed} · ใช้ยาเดิมต่อ ${stats.continued}`
                    : undefined
                }
              />
              <StatCard
                label={`ไม่ได้รับ${labels.drugLabel}`}
                value={`${stats.without}`}
                unit="ครั้ง"
              />
              <StatCard
                label={`ร้อยละที่ได้รับ${labels.drugLabel}`}
                value={stats.percent == null ? '—' : stats.percent.toFixed(1)}
                unit={stats.percent == null ? '' : '%'}
              />
            </section>

            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <Segmented<Filter>
                value={filter}
                onChange={setFilter}
                options={[
                  { label: `ทั้งหมด (${stats.total})`, value: 'all' },
                  {
                    label: report.countsContinued
                      ? `จ่ายยา (${stats.dispensed})`
                      : `ได้รับยา (${stats.dispensed})`,
                    value: 'with',
                  },
                  /* ปุ่มนี้มีเฉพาะข้อที่นับการใช้ยาต่อเนื่อง — ข้ออื่นกลุ่มนี้ว่าง
                     เสมอ ปุ่มที่กดแล้วไม่มีอะไรเลยทุกครั้งมีแต่ทำให้สับสน */
                  ...(report.countsContinued
                    ? [{ label: `ใช้ยาต่อเนื่อง (${stats.continued})`, value: 'continued' as const }]
                    : []),
                  {
                    label: report.countsContinued
                      ? `ไม่ได้ใช้ยา (${stats.without})`
                      : `ไม่ได้รับยา (${stats.without})`,
                    value: 'without',
                  },
                ]}
              />
              <div className="flex items-center gap-3">
                <span className="text-xs text-ink-3">
                  แสดง {visible.length} แถว · ต้องทบทวน {followUpCount} ครั้ง
                </span>
                {/* ส่งออกเฉพาะที่กรองอยู่ ไม่ใช่ทั้งช่วงวันที่ — เขียนกำกับไว้ที่ tooltip
                    ของปุ่ม เพราะเป็นเรื่องที่ทำให้เข้าใจไฟล์ผิดได้ง่ายที่สุด */}
                <Tooltip title="ได้ไฟล์ตามตัวกรองที่เลือกอยู่ · มีชื่อผู้ป่วยและ HN อย่าส่งต่อออกนอกงาน">
                  <Button
                    icon={<FileExcelOutlined />}
                    onClick={exportCsv}
                    disabled={visible.length === 0}
                  >
                    ส่งออก Excel
                  </Button>
                </Tooltip>
              </div>
            </div>

            <div className="data-sheet">
              <Table<ReportVisit>
                rowKey="vn"
                size="small"
                columns={columns}
                dataSource={visible}
                pagination={{ pageSize: 50, showSizeChanger: false }}
                scroll={{ x: 'max-content' }}
                locale={{
                  emptyText: (
                    <Empty
                      description={
                        filter === 'all'
                          ? `ไม่พบ${labels.patientLabel}ในช่วงวันที่ที่เลือก`
                          : 'ไม่มีแถวที่ตรงกับตัวกรองนี้'
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

      <VisitDetailModal
        open={picked != null}
        onClose={() => setPicked(null)}
        hn={picked?.hn ?? null}
        vn={picked?.vn ?? null}
        patientName={picked?.patientName ?? null}
        drugIcodes={report?.drugIcodes ?? []}
        drugLabel={labels.drugLabel}
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
