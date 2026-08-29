'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
import { useRef, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import Cookies from 'js-cookie'
import {
  Alert,
  Button,
  Descriptions,
  Empty,
  Image,
  Input,
  InputNumber,
  Modal,
  Select,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { apiFetch } from '@/lib/client/session'
import {
  ExperimentOutlined,
  FileImageOutlined,
  FileTextOutlined,
  MedicineBoxOutlined,
  PrinterOutlined,
  ProfileOutlined,
  RadarChartOutlined,
  SmileOutlined,
  SolutionOutlined,
  SwapOutlined,
  UndoOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import type { MedicationColumn, MedicationHistory, MedicationRow } from '@/lib/his/medication-history'
import type { ConditionKey } from '@/lib/his/conditions'
import type { DentalNote } from '@/lib/his/dental-notes'
import type { DrugUsageOption } from '@/lib/his/drug-usage'
import type { PatientMatch } from '@/lib/his/patient-search'
import type { PatientNote } from '@/lib/his/patient-notes'
import type { OpdScanItem } from '@/lib/his/opd-scan'
import type { PhysicalExam } from '@/lib/his/physical-exams'
import type { XrayReport } from '@/lib/his/xray-reports'
import type { VisitDetail, VisitDiagnosis, VisitLab, VisitOrder } from '@/lib/his/visit-detail'
import type { ReconcilePrintData } from './reconcile-pdf'

/**
 * ตัวแสดง PDF ของ @react-pdf/renderer ทำงานได้เฉพาะในเบราว์เซอร์ (ใช้ canvas/worker)
 * ถ้าให้ Next เรนเดอร์ฝั่งเซิร์ฟเวอร์ด้วยจะพัง — และโหลดเมื่อกดพิมพ์เท่านั้น
 * ไม่ถ่วงการเปิดหน้าของคนที่ไม่ได้พิมพ์
 */
const ReconcilePdfViewer = dynamic(() => import('./reconcile-pdf-viewer'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center gap-3">
      <Spin />
      <span className="text-xs text-slate-400">กำลังสร้างเอกสาร...</span>
    </div>
  ),
})

const { Paragraph, Text, Title } = Typography

/**
 * สีประจำชนิดการรับยา — แสดงเป็นจุดสีที่หัวคอลัมน์ ไม่ระบายพื้นทั้งหัวหรือทั้งคอลัมน์
 * พื้นตารางและหัวตารางจึงเป็นโทนกลางทั้งหมด ตัวอักษรเป็นสีเข้มบนพื้นอ่อนตลอด
 * ทำให้อ่านวันที่ ชื่อห้องตรวจ จำนวน และวิธีใช้ยาได้ชัดที่สุด
 */
const TYPE_STYLE: Record<string, { head: string; legend: string }> = {
  OPD: { head: '#1f9d63', legend: 'ผู้ป่วยนอก (ตามห้องตรวจ)' },
  HME: { head: '#c94664', legend: 'ยากลับบ้าน' },
  BCH: { head: '#5560c4', legend: 'ยาต่อเนื่อง' },
}

/**
 * ครั้งที่มาผ่านห้องฉุกเฉิน — ใช้สีเหลืองแทนสีตามชนิดการรับยา
 * ดูจาก er_regist ไม่ใช่ชื่อห้องตรวจ บาง visit ลงเป็นคลินิกนอกเวลาแต่ผ่าน ER จริง
 */
const ER_STYLE = { head: '#eab308', legend: 'ห้องฉุกเฉิน (ER)' }

/** สีของคอลัมน์หนึ่ง — ER มาก่อนชนิดการรับยาเสมอ */
function columnStyle(column: MedicationColumn) {
  if (column.isEr) return ER_STYLE
  return TYPE_STYLE[column.type] ?? TYPE_STYLE.OPD
}

/** ช่วงเวลาที่เลือกค้นย้อนหลังได้ — ต้องตรงกับรายการที่ฝั่ง API อนุญาต */
const MONTH_OPTIONS = [
  { value: 6, label: 'ย้อนหลัง 6 เดือน' },
  { value: 9, label: 'ย้อนหลัง 9 เดือน' },
  { value: 12, label: 'ย้อนหลัง 12 เดือน' },
]

/**
 * แปลงวันที่จากฐาน HIS (ค.ศ. รูปแบบ 'YYYY-MM-DD' หรือ 'YYYY-MM-DD HH:mm')
 * ให้เป็น วว/ดด/ปปปป พ.ศ. — บวก 543 ที่ปี ไม่แตะเวลา
 */
function toThaiDate(value: string | null): string | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(value)
  if (!match) return value
  const [, year, month, day, time] = match
  return `${day}/${month}/${Number(year) + 543}${time ? ` ${time}` : ''}`
}

/**
 * ชื่อผู้ที่กำลังใช้งาน — ใช้กำกับท้ายใบพิมพ์ว่าใครเป็นคนพิมพ์ออกมา
 * อ่านจาก cookie user_data ที่ตั้งไว้ตอนเข้าสู่ระบบ ไม่ได้ยิง API เพิ่ม
 */
function currentUserName(): string {
  try {
    const raw = Cookies.get('user_data')
    if (!raw) return '—'
    const user = JSON.parse(raw) as { full_name?: unknown; username?: unknown }
    if (typeof user.full_name === 'string' && user.full_name) return user.full_name
    if (typeof user.username === 'string' && user.username) return user.username
    return '—'
  } catch {
    // cookie เสียหรือรูปแบบเปลี่ยน ไม่ควรทำให้พิมพ์เอกสารไม่ได้
    return '—'
  }
}

/**
 * สีป้ายกลุ่มโรคสำคัญ — แยกสีให้จำได้จากระยะไกล
 * กลุ่มที่ต้องรีบรู้ที่สุด (stroke, sepsis) ใช้โทนแดง
 */
const CONDITION_COLOR: Record<ConditionKey, string> = {
  stroke: 'red',
  sepsis: 'magenta',
  heart: 'volcano',
  copd: 'orange',
  asthma: 'gold',
  cancer: 'purple',
}

/** ค่าแทนตำแหน่งของผู้บันทึกที่ HIS ไม่ได้บันทึกไว้ ใช้เป็นตัวเลือกหนึ่งในตัวกรอง */
const NO_POSITION = '__none__'

/** ค่าแทนผู้บันทึกที่หาชื่อไม่เจอ ใช้ในตัวกรองของตาราง PE */
const NO_DOCTOR = '__none__'

/**
 * ต้องพิมพ์กี่ตัวอักษรถึงจะเริ่มค้นวิธีใช้ยา
 * ซ้ำกับ MIN_USAGE_SEARCH ใน lib/his/drug-usage.ts เพราะโมดูลนั้นเป็น server-only
 * ฝั่งเซิร์ฟเวอร์เป็นตัวบังคับจริง ค่านี้ใช้แค่บอกผู้ใช้ก่อนยิง API
 */
const MIN_USAGE_SEARCH = 3

/** คอลัมน์ในตารางประวัติผลตรวจร่างกาย (opdscreen.pe) */
const PE_COLUMNS: ColumnsType<PhysicalExam> = [
  {
    title: 'วันที่ตรวจ',
    dataIndex: 'date',
    key: 'date',
    width: 130,
    render: (value: string | null, row) => (
      <span className="font-mono text-xs">
        {[toThaiDate(value) ?? '—', row.time].filter(Boolean).join(' ')}
      </span>
    ),
  },
  {
    title: 'ห้องตรวจ / แพทย์',
    dataIndex: 'department',
    key: 'department',
    width: 220,
    render: (value: string | null, row) => (
      <div className="leading-snug">
        <div>{value ?? '—'}</div>
        {row.doctor && (
          <Text type="secondary" className="text-[11px]">
            {row.doctor}
          </Text>
        )}
      </div>
    ),
  },
  {
    title: 'ตรวจร่างกาย / บันทึกแพทย์ (PE)',
    dataIndex: 'pe',
    key: 'pe',
    // แพทย์พิมพ์ขึ้นบรรทัดเอง ต้องคงรูปแบบไว้
    render: (value: string) => <span className="whitespace-pre-wrap">{value}</span>,
  },
]

/** คอลัมน์ในตารางผลอ่านภาพรังสี (xray_report) */
const XRAY_COLUMNS: ColumnsType<XrayReport> = [
  {
    title: 'วันที่อ่านผล',
    dataIndex: 'reportDate',
    key: 'reportDate',
    width: 140,
    render: (value: string | null, row) => (
      <div className="leading-snug">
        <div className="font-mono text-xs">
          {[toThaiDate(value) ?? '—', row.reportTime].filter(Boolean).join(' ')}
        </div>
        {/* วันถ่ายภาพต่างจากวันอ่านผลได้ บอกไว้เมื่อไม่ตรงกันเท่านั้น */}
        {row.examinedDate && row.examinedDate !== row.reportDate && (
          <Text type="secondary" className="text-[11px]">
            ถ่าย {toThaiDate(row.examinedDate)}
          </Text>
        )}
      </div>
    ),
  },
  {
    title: 'รายการตรวจ / แพทย์ผู้อ่าน',
    dataIndex: 'itemName',
    key: 'itemName',
    width: 230,
    render: (value: string | null, row) => (
      <div className="leading-snug">
        <div>{value ?? '—'}</div>
        {row.doctor && (
          <Text type="secondary" className="text-[11px]">
            {row.doctor}
          </Text>
        )}
        {!row.confirmed && (
          <Tag color="warning" style={{ marginInlineEnd: 0 }}>
            ยังไม่ยืนยันผล
          </Tag>
        )}
      </div>
    ),
  },
  {
    title: 'ผลอ่าน',
    dataIndex: 'report',
    key: 'report',
    render: (text: string, row) => (
      <div className="leading-snug">
        {row.clinical && (
          <Text type="secondary" className="text-[11px]">
            ข้อบ่งชี้: {row.clinical}
          </Text>
        )}
        {/* รายงานมีการขึ้นบรรทัดของมันเอง ต้องคงไว้ */}
        <div className="whitespace-pre-wrap">{text}</div>
      </div>
    ),
  },
]

/** คอลัมน์ในตารางบันทึกทันตกรรม (dt_list) */
const DENTAL_COLUMNS: ColumnsType<DentalNote> = [
  {
    title: 'วันที่',
    dataIndex: 'date',
    key: 'date',
    width: 140,
    render: (value: string | null, row) => (
      <div className="leading-snug">
        <div className="font-mono text-xs">
          {[toThaiDate(value) ?? '—', row.time].filter(Boolean).join(' ')}
        </div>
        {row.outTime && (
          <Text type="secondary" className="text-[11px]">
            ออก {row.outTime}
          </Text>
        )}
      </div>
    ),
  },
  {
    title: 'ห้องตรวจ / ทันตแพทย์',
    dataIndex: 'department',
    key: 'department',
    width: 200,
    render: (value: string | null, row) => (
      <div className="leading-snug">
        <div>{value ?? '—'}</div>
        {row.doctor && (
          <Text type="secondary" className="text-[11px]">
            {row.doctor}
          </Text>
        )}
      </div>
    ),
  },
  {
    title: 'หัตถการ',
    dataIndex: 'treatments',
    key: 'treatments',
    width: 340,
    render: (items: string[]) =>
      items.length > 0 ? (
        <div className="flex flex-col gap-1 leading-snug">
          {items.map((item, index) => (
            <div key={`${item}-${index}`}>{item}</div>
          ))}
        </div>
      ) : (
        <Text type="secondary">—</Text>
      ),
  },
  {
    title: 'บันทึกทันตกรรม',
    dataIndex: 'note',
    key: 'note',
    // ทันตแพทย์พิมพ์ขึ้นบรรทัดเอง ต้องคงรูปแบบไว้
    render: (value: string | null) =>
      value ? <span className="whitespace-pre-wrap">{value}</span> : <Text type="secondary">—</Text>,
  },
]

/** ยาหนึ่งรายการในหน้า Med Reconcile — ค่าที่ผู้ป่วยได้รับ "ครั้งล่าสุด" ของยาตัวนั้น */
type ReconcileItem = {
  icode: string
  drugName: string
  /** วันที่ของครั้งล่าสุดที่ได้ยาตัวนี้ */
  date: string
  type: string
  label: string
  qty: string
  usage: string
  /** รหัสวิธีใช้ยา — ใบพิมพ์แสดงนำหน้าข้อความ เช่น 11pt ( 1 เม็ด x หลังอาหาร เช้า ) */
  usageCode: string | null
}

/**
 * สรุปรายการยาที่ใช้อยู่ล่าสุด จากข้อมูลที่โหลดมาแล้วในหน้านี้ — ไม่ต้องยิง API ซ้ำ
 * data.columns เรียงจากใหม่ไปเก่าอยู่แล้ว จึงหยุดที่คอลัมน์แรกที่ยาตัวนั้นมีค่า
 */
function buildReconcileList(data: MedicationHistory): ReconcileItem[] {
  const items: ReconcileItem[] = []
  for (const row of data.rows) {
    for (const column of data.columns) {
      const cell = row.cells[column.key]
      if (!cell) continue
      items.push({
        icode: row.icode,
        drugName: row.drugName,
        date: column.date,
        type: column.type,
        label: column.label,
        qty: cell.qty,
        usage: cell.usage ?? '',
        usageCode: cell.usageCode,
      })
      break
    }
  }
  // ยาที่เพิ่งได้รับล่าสุดอยู่บนสุด — เป็นลำดับที่แพทย์ไล่ทบทวนตามธรรมชาติ
  return items.sort((a, b) => b.date.localeCompare(a.date))
}

/** คอลัมน์ในตาราง Note View (ptnote) */
const NOTE_COLUMNS: ColumnsType<PatientNote> = [
  {
    title: 'วันที่บันทึก',
    dataIndex: 'noteDateTime',
    key: 'noteDateTime',
    width: 150,
    render: (value: string | null, row) => (
      <span className="font-mono text-xs">
        {toThaiDate(value) ?? toThaiDate(row.visitDate) ?? '—'}
      </span>
    ),
  },
  {
    title: 'ข้อความ',
    dataIndex: 'text',
    key: 'text',
    // ข้อความจาก HIS มีการขึ้นบรรทัดของมันเอง ต้องคงไว้
    render: (text: string) =>
      text ? <span className="whitespace-pre-wrap">{text}</span> : <Text type="secondary">—</Text>,
  },
  {
    title: 'ผู้บันทึก',
    dataIndex: 'staff',
    key: 'staff',
    width: 200,
    // modal ใช้ธีมมืด ต่างจากตารางประวัติยาที่อยู่บนพื้นขาว
    // จึงใช้ Text type="secondary" ที่ปรับสีตามธีมให้เอง แทนการกำหนดสีดำตายตัว
    render: (value: string | null, row) => (
      <div className="leading-snug">
        <div>{value ?? '—'}</div>
        {row.staffPosition && (
          <Text type="secondary" className="text-[11px]">
            {row.staffPosition}
          </Text>
        )}
      </div>
    ),
  },
]

/** หัวข้อย่อยของแต่ละส่วนใน modal รายละเอียด visit */
function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
      {children}
    </div>
  )
}

/** คอลัมน์การวินิจฉัยใน modal รายละเอียด visit */
const DIAGNOSIS_COLUMNS: ColumnsType<VisitDiagnosis> = [
  {
    title: 'ICD-10',
    dataIndex: 'icd10',
    key: 'icd10',
    width: 110,
    render: (code: string) => <span className="font-mono text-xs">{code || '—'}</span>,
  },
  {
    title: 'การวินิจฉัย',
    dataIndex: 'name',
    key: 'name',
    render: (name: string | null) => name ?? <Text type="secondary">—</Text>,
  },
  {
    title: 'ชนิด',
    dataIndex: 'typeName',
    key: 'typeName',
    width: 260,
    render: (value: string | null) => <Text type="secondary">{value ?? '—'}</Text>,
  },
  {
    title: 'แพทย์',
    dataIndex: 'doctor',
    key: 'doctor',
    width: 200,
    render: (value: string | null) => value ?? <Text type="secondary">—</Text>,
  },
]

/** คอลัมน์รายการที่สั่ง/เรียกเก็บใน visit */
const ORDER_COLUMNS: ColumnsType<VisitOrder> = [
  { title: 'รายการ', dataIndex: 'name', key: 'name' },
  {
    title: 'จำนวน',
    dataIndex: 'qty',
    key: 'qty',
    width: 90,
    align: 'right',
    render: (qty: string) => <span className="qty">{qty}</span>,
  },
  {
    title: 'หมวดค่าใช้จ่าย',
    dataIndex: 'incomeName',
    key: 'incomeName',
    width: 280,
    render: (value: string | null) => <Text type="secondary">{value ?? '—'}</Text>,
  },
  {
    title: 'ราคารวม',
    dataIndex: 'price',
    key: 'price',
    width: 110,
    align: 'right',
    render: (value: string | null) => (
      <span className="font-mono text-xs">{value ?? '—'}</span>
    ),
  },
]

/** คอลัมน์ผลแล็บของ visit */
const LAB_COLUMNS: ColumnsType<VisitLab> = [
  { title: 'รายการตรวจ', dataIndex: 'name', key: 'name' },
  {
    title: 'ผล',
    dataIndex: 'result',
    key: 'result',
    width: 130,
    align: 'right',
    // ผลที่ HIS ทำเครื่องหมายว่าผิดปกติไว้ ให้เห็นได้ตั้งแต่กวาดสายตา
    render: (value: string, row) => (
      <span className={`font-mono font-semibold ${row.abnormal ? 'text-red-400' : ''}`}>
        {value}
      </span>
    ),
  },
  {
    title: 'หน่วย',
    dataIndex: 'unit',
    key: 'unit',
    width: 110,
    render: (value: string | null) => <Text type="secondary">{value ?? '—'}</Text>,
  },
  {
    title: 'ค่าปกติ',
    dataIndex: 'normal',
    key: 'normal',
    width: 220,
    render: (value: string | null) => <Text type="secondary">{value ?? '—'}</Text>,
  },
  {
    title: 'ใบสั่งตรวจ',
    dataIndex: 'form',
    key: 'form',
    width: 140,
    render: (value: string | null) => <Text type="secondary">{value ?? '—'}</Text>,
  },
]

/**
 * ช่องเลือกวิธีใช้ยา — ค้นจาก drugusage.code (พิมพ์อย่างน้อย 3 ตัวอักษร)
 * เมื่อเลือกแล้วจะเก็บ shortlist ซึ่งเป็นข้อความที่ใช้พิมพ์ฉลากยาจริง
 */
function UsageSelect({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const [options, setOptions] = useState<DrugUsageOption[]>([])
  const [searching, setSearching] = useState(false)
  const [hint, setHint] = useState(`พิมพ์อย่างน้อย ${MIN_USAGE_SEARCH} ตัวอักษรเพื่อค้น`)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = (term: string) => {
    if (timer.current) clearTimeout(timer.current)
    const keyword = term.trim()
    if (keyword.length < MIN_USAGE_SEARCH) {
      setOptions([])
      setSearching(false)
      setHint(`พิมพ์อย่างน้อย ${MIN_USAGE_SEARCH} ตัวอักษรเพื่อค้น`)
      return
    }
    setSearching(true)
    // หน่วงไว้ก่อน ไม่ยิงทุกตัวอักษรที่พิมพ์
    timer.current = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/his/drug-usage?q=${encodeURIComponent(keyword)}`)
        const json = await res.json()
        if (!res.ok || !json.success) {
          setOptions([])
          setHint(json.message ?? 'ค้นวิธีใช้ยาไม่สำเร็จ')
          return
        }
        const found = json.options as DrugUsageOption[]
        setOptions(found)
        setHint(found.length === 0 ? 'ไม่พบวิธีใช้ที่ตรงกับคำค้น' : '')
      } catch {
        setOptions([])
        setHint('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')
      } finally {
        setSearching(false)
      }
    }, 300)
  }

  return (
    <Select
      size="small"
      allowClear
      className="w-full"
      placeholder="ค้นรหัสวิธีใช้ เช่น 1x3pc"
      // ค้นที่ฝั่งฐานข้อมูล จึงไม่ให้ antd กรองตัวเลือกซ้ำอีกชั้น
      showSearch={{ onSearch: search, filterOption: false }}
      value={value || undefined}
      loading={searching}
      onChange={next => onChange(next ?? '')}
      notFoundContent={
        searching ? <Spin size="small" /> : <Text type="secondary" className="text-[11px]">{hint}</Text>
      }
      // ค่าที่เก็บคือ shortlist — ข้อความที่ใช้พิมพ์ฉลากยา ส่วน code ใช้แค่ตอนค้น
      options={options.map(option => ({ value: option.shortlist, label: option.shortlist }))}
      optionRender={option => (
        <div className="leading-snug">
          <div className="font-mono text-xs">
            {options.find(item => item.shortlist === option.value)?.code}
          </div>
          <div className="text-[11px] opacity-70">{option.value}</div>
        </div>
      )}
    />
  )
}

export default function MedicationHistoryPage() {
  const [hn, setHn] = useState('')
  /** HN ของผู้ป่วยที่กำลังแสดงอยู่ — ใช้ตอนเปลี่ยนช่วงเดือน (ช่องค้นอาจเป็นชื่อหรือเลขบัตร) */
  const [activeHn, setActiveHn] = useState('')
  const [matches, setMatches] = useState<PatientMatch[]>([])
  const [matchOpen, setMatchOpen] = useState(false)
  const [months, setMonths] = useState(6)
  const [noteOpen, setNoteOpen] = useState(false)
  const [notes, setNotes] = useState<PatientNote[]>([])
  const [noteLoading, setNoteLoading] = useState(false)
  const [noteError, setNoteError] = useState('')
  const [notePositions, setNotePositions] = useState<string[]>([])
  const [peOpen, setPeOpen] = useState(false)
  const [exams, setExams] = useState<PhysicalExam[]>([])
  const [peLoading, setPeLoading] = useState(false)
  const [peError, setPeError] = useState('')
  const [peDoctors, setPeDoctors] = useState<string[]>([])
  const [dentalOpen, setDentalOpen] = useState(false)
  const [dentalNotes, setDentalNotes] = useState<DentalNote[]>([])
  const [dentalLoading, setDentalLoading] = useState(false)
  const [dentalError, setDentalError] = useState('')
  const [xrayOpen, setXrayOpen] = useState(false)
  const [xrayReports, setXrayReports] = useState<XrayReport[]>([])
  const [xrayLoading, setXrayLoading] = useState(false)
  const [xrayError, setXrayError] = useState('')
  const [hlaOpen, setHlaOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [scans, setScans] = useState<OpdScanItem[]>([])
  const [scanLoading, setScanLoading] = useState(false)
  const [scanError, setScanError] = useState('')
  const [scanVn, setScanVn] = useState<string | null>(null)
  const [reconcileOpen, setReconcileOpen] = useState(false)
  /** ค่าที่แพทย์แก้ไว้ในหน้า Med Reconcile เก็บตาม icode — ยังไม่ถูกส่งกลับไป HIS */
  const [reconcileEdits, setReconcileEdits] = useState<
    Record<string, { qty: string; usage: string }>
  >({})
  /**
   * ยาที่ "ไม่เอาลงใบพิมพ์" เก็บตาม icode — เก็บด้านที่ถูกเอาออกแทนด้านที่เลือกไว้
   * เพราะค่าเริ่มต้นคือเลือกทั้งหมด ถ้าเก็บด้านที่เลือกจะต้องคอยเซ็ตใหม่ทุกครั้งที่เปลี่ยนผู้ป่วยหรือช่วงเดือน
   */
  const [reconcileExcluded, setReconcileExcluded] = useState<Record<string, true>>({})
  const [printOpen, setPrintOpen] = useState(false)
  const [visitOpen, setVisitOpen] = useState(false)
  const [visitColumn, setVisitColumn] = useState<MedicationColumn | null>(null)
  const [visit, setVisit] = useState<VisitDetail | null>(null)
  const [visitLoading, setVisitLoading] = useState(false)
  const [visitError, setVisitError] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState<MedicationHistory | null>(null)

  /** โหลดบันทึกผู้ป่วย (ptnote) ตอนกดเปิด Note — ไม่ดึงมาพร้อมประวัติยาเพราะส่วนใหญ่ไม่ได้เปิดดู */
  const openNotes = async (patientHn: string) => {
    setNoteOpen(true)
    setNoteLoading(true)
    setNoteError('')
    setNotes([])
    // ตัวกรองของ HN คนก่อนหน้าใช้กับคนใหม่ไม่ได้ — ตำแหน่งที่มีในบันทึกคนละชุดกัน
    setNotePositions([])
    try {
      const res = await apiFetch(`/api/his/patient-notes?hn=${patientHn}`)
      const json = await res.json()
      if (!res.ok || !json.success) {
        setNoteError(json.message ?? 'ดึงบันทึกผู้ป่วยไม่สำเร็จ')
        return
      }
      setNotes(json.notes as PatientNote[])
    } catch {
      setNoteError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setNoteLoading(false)
    }
  }

  /** โหลดประวัติผลตรวจร่างกายตอนกดปุ่ม PE — รูปแบบเดียวกับ Note */
  const openExams = async (patientHn: string) => {
    setPeOpen(true)
    setPeLoading(true)
    setPeError('')
    setExams([])
    // รายชื่อแพทย์ของผู้ป่วยคนก่อนหน้าใช้กับคนใหม่ไม่ได้
    setPeDoctors([])
    try {
      const res = await apiFetch(`/api/his/physical-exams?hn=${patientHn}`)
      const json = await res.json()
      if (!res.ok || !json.success) {
        setPeError(json.message ?? 'ดึงผลตรวจร่างกายไม่สำเร็จ')
        return
      }
      setExams(json.exams as PhysicalExam[])
    } catch {
      setPeError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setPeLoading(false)
    }
  }

  /** โหลดบันทึกงานทันตกรรม (dtmain) ตอนกดปุ่ม Dent Note */
  const openDental = async (patientHn: string) => {
    setDentalOpen(true)
    setDentalLoading(true)
    setDentalError('')
    setDentalNotes([])
    try {
      const res = await apiFetch(`/api/his/dental-notes?hn=${patientHn}`)
      const json = await res.json()
      if (!res.ok || !json.success) {
        setDentalError(json.message ?? 'ดึงบันทึกงานทันตกรรมไม่สำเร็จ')
        return
      }
      setDentalNotes(json.notes as DentalNote[])
    } catch {
      setDentalError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setDentalLoading(false)
    }
  }

  /** โหลดผลอ่านภาพรังสี (xray_report) ตอนกดปุ่ม X-ray Report */
  const openXray = async (patientHn: string) => {
    setXrayOpen(true)
    setXrayLoading(true)
    setXrayError('')
    setXrayReports([])
    try {
      const res = await apiFetch(`/api/his/xray-reports?hn=${patientHn}`)
      const json = await res.json()
      if (!res.ok || !json.success) {
        setXrayError(json.message ?? 'ดึงผลอ่านภาพรังสีไม่สำเร็จ')
        return
      }
      setXrayReports(json.reports as XrayReport[])
    } catch {
      setXrayError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setXrayLoading(false)
    }
  }

  /** โหลดรายการภาพสแกนเวชระเบียน — ดึงมาแค่ metadata ตัวภาพโหลดทีละใบตอนแสดงผล */
  const openScans = async (patientHn: string) => {
    setScanOpen(true)
    setScanLoading(true)
    setScanError('')
    setScans([])
    setScanVn(null)
    try {
      const res = await apiFetch(`/api/his/opd-scan?hn=${patientHn}`)
      const json = await res.json()
      if (!res.ok || !json.success) {
        setScanError(json.message ?? 'ดึงรายการภาพสแกนไม่สำเร็จ')
        return
      }
      setScans(json.items as OpdScanItem[])
    } catch {
      setScanError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setScanLoading(false)
    }
  }

  /** เปิดรายละเอียดการมารับบริการหนึ่งครั้ง (เฉพาะคอลัมน์ผู้ป่วยนอกที่มี vn) */
  const openVisit = async (column: MedicationColumn, patientHn: string) => {
    if (!column.vn) return
    setVisitColumn(column)
    setVisitOpen(true)
    setVisitLoading(true)
    setVisitError('')
    setVisit(null)
    try {
      const res = await apiFetch(`/api/his/visit-detail?hn=${patientHn}&vn=${column.vn}`)
      const json = await res.json()
      if (!res.ok || !json.success) {
        setVisitError(json.message ?? 'ดึงรายละเอียดการมารับบริการไม่สำเร็จ')
        return
      }
      setVisit(json.visit as VisitDetail)
    } catch {
      setVisitError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setVisitLoading(false)
    }
  }

  /** ล้างผลค้นหาเดิมทิ้ง — ใช้ทั้งตอนล้างช่อง HN และตอนเริ่มค้นครั้งใหม่ */
  const clearResult = () => {
    setData(null)
    setError('')
    // ค่าที่แก้ไว้ผูกกับผลค้นหาชุดเดิม ใช้กับผู้ป่วยคนใหม่หรือช่วงเดือนใหม่ไม่ได้
    setReconcileEdits({})
    setReconcileExcluded({})
  }

  /** โหลดประวัติยาของ HN ที่ระบุ */
  const loadHistory = async (patientHn: string, range = months) => {
    setLoading(true)
    // ล้างของเดิมก่อนเริ่มค้น กันแสดงข้อมูลคนละคนกับ HN ที่กำลังค้นอยู่
    clearResult()
    setActiveHn(patientHn)
    try {
      const res = await apiFetch(`/api/his/medication-history?hn=${patientHn}&months=${range}`)
      const json = await res.json()
      if (!res.ok || !json.success) {
        setData(null)
        setError(json.message ?? 'ค้นหาไม่สำเร็จ')
        return
      }
      setData(json as MedicationHistory)
    } catch {
      setData(null)
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setLoading(false)
    }
  }

  /**
   * ช่องค้นหารับได้สามแบบ
   * - HN (ตัวเลขไม่เกิน 9 หลัก) และเลขบัตรประชาชน 13 หลัก = ระบุตัวคนได้แน่นอน → โหลดเลย
   * - ชื่อ-สกุล = ระบุตัวคนไม่ได้ ต่อให้เจอคนเดียวก็ต้องให้ยืนยันก่อนเปิดเวชระเบียน
   *   จึงแสดงรายชื่อให้เลือกเสมอ (มี HN อายุ และวันที่มาล่าสุด ไว้แยกคนชื่อซ้ำ)
   */
  const search = async (value: string) => {
    const keyword = value.trim()
    if (!keyword) {
      // ไม่กรอกอะไร = ไม่มีผลลัพธ์ ต้องล้างข้อมูลผู้ป่วยคนก่อนหน้าออกด้วย
      setData(null)
      setError('กรุณากรอก HN เลขบัตรประชาชน หรือชื่อ-สกุล')
      return
    }

    if (/^\d{1,9}$/.test(keyword)) {
      await loadHistory(keyword.padStart(9, '0'))
      return
    }

    setLoading(true)
    clearResult()
    setActiveHn('')
    try {
      const res = await apiFetch(`/api/his/patient-search?q=${encodeURIComponent(keyword)}`)
      const json = await res.json()
      if (!res.ok || !json.success) {
        setError(json.message ?? 'ค้นหาผู้ป่วยไม่สำเร็จ')
        return
      }
      const found = json.matches as PatientMatch[]
      if (found.length === 0) {
        setError('ไม่พบผู้ป่วยที่ตรงกับคำค้น')
        return
      }
      // เลขบัตร 13 หลักชี้ตัวคนได้เอง เจอรายเดียวก็เปิดได้เลย
      if (/^\d{13}$/.test(keyword) && found.length === 1) {
        await loadHistory(found[0].hn)
        return
      }
      setMatches(found)
      setMatchOpen(true)
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setLoading(false)
    }
  }

  // ── ตัวกรองบันทึกผู้ป่วยตามตำแหน่งผู้บันทึก ──
  // สร้างตัวเลือกจากบันทึกที่โหลดมาจริง (ไม่ได้ตายตัว) เรียงจากตำแหน่งที่บันทึกไว้มากสุด
  const positionCount = new Map<string, number>()
  for (const note of notes) {
    const key = note.staffPosition ?? NO_POSITION
    positionCount.set(key, (positionCount.get(key) ?? 0) + 1)
  }
  const positionOptions = [...positionCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({
      value,
      label: `${value === NO_POSITION ? 'ไม่ระบุตำแหน่ง' : value} (${count})`,
    }))

  // ไม่เลือกอะไรเลย = แสดงทั้งหมด
  const visibleNotes =
    notePositions.length === 0
      ? notes
      : notes.filter(note => notePositions.includes(note.staffPosition ?? NO_POSITION))

  // ── ภาพสแกนเวชระเบียน: จัดกลุ่มตาม vn ให้เลือกดูเฉพาะครั้งที่มารับบริการได้ ──
  const scanVnCount = new Map<string, number>()
  for (const scan of scans) {
    const key = scan.vn ?? ''
    if (key) scanVnCount.set(key, (scanVnCount.get(key) ?? 0) + 1)
  }
  const visibleScans = scanVn ? scans.filter(scan => scan.vn === scanVn) : scans

  // ── ตัวกรองผลตรวจร่างกายตามผู้บันทึก ──
  const doctorCount = new Map<string, number>()
  for (const exam of exams) {
    const key = exam.doctor ?? NO_DOCTOR
    doctorCount.set(key, (doctorCount.get(key) ?? 0) + 1)
  }
  const doctorOptions = [...doctorCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({
      value,
      label: `${value === NO_DOCTOR ? 'ไม่ระบุผู้บันทึก' : value} (${count})`,
    }))

  const visibleExams =
    peDoctors.length === 0
      ? exams
      : exams.filter(exam => peDoctors.includes(exam.doctor ?? NO_DOCTOR))

  // ── Med Reconcile ──
  const reconcileItems = data ? buildReconcileList(data) : []
  const editItem = (icode: string, patch: Partial<{ qty: string; usage: string }>) =>
    setReconcileEdits(prev => {
      const base = reconcileItems.find(item => item.icode === icode)
      const current = prev[icode] ?? { qty: base?.qty ?? '', usage: base?.usage ?? '' }
      return { ...prev, [icode]: { ...current, ...patch } }
    })

  /** ค่าที่กำลังแสดงในช่องกรอก = ค่าที่แก้ไว้ ถ้ายังไม่แก้ก็เป็นค่าจากครั้งล่าสุด */
  const editedValue = (item: ReconcileItem) => reconcileEdits[item.icode] ?? item

  /** ยาที่ติ๊กไว้ = ทุกตัวที่ไม่ได้ถูกเอาออก */
  const reconcileSelected = reconcileItems.filter(item => !reconcileExcluded[item.icode])

  /** ข้อมูลที่ส่งให้เอกสาร PDF — ประกอบตอนกดพิมพ์เท่านั้น */
  const buildPrintData = (): ReconcilePrintData | null => {
    if (!data?.patient) return null
    return {
      hn: data.patient.hn,
      name: data.patient.name,
      age: data.patient.age != null ? `${data.patient.age} ปี` : '—',
      months: data.months,
      allergies: data.allergies.map(item => item.agent),
      items: reconcileSelected.map(item => {
        const edited = editedValue(item)
        return {
          drugName: item.drugName,
          qty: edited.qty,
          usage: edited.usage,
          // แก้วิธีใช้ไปแล้วรหัสเดิมไม่ตรงกับข้อความอีก จึงไม่พิมพ์รหัสกำกับ
          usageCode: edited.usage === item.usage ? item.usageCode : null,
          date: toThaiDate(item.date) ?? item.date,
          label: item.label,
          edited: edited.qty !== item.qty || edited.usage !== item.usage,
        }
      }),
      printedAt: new Date().toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }),
      printedBy: currentUserName(),
    }
  }

  const RECONCILE_COLUMNS: ColumnsType<ReconcileItem> = [
    {
      title: 'ชื่อยา',
      dataIndex: 'drugName',
      key: 'drugName',
      width: 320,
      render: (name: string) => <span className="font-semibold">{name}</span>,
    },
    {
      title: 'ได้รับล่าสุด',
      dataIndex: 'date',
      key: 'date',
      width: 190,
      render: (date: string, item) => (
        <div className="leading-snug">
          <div className="font-mono text-xs">{toThaiDate(date)}</div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: (TYPE_STYLE[item.type] ?? TYPE_STYLE.OPD).head }}
            />
            <Text type="secondary" className="text-[11px]">{item.label}</Text>
          </div>
        </div>
      ),
    },
    {
      title: 'จำนวน',
      key: 'qty',
      width: 140,
      render: (_: unknown, item) => (
        <div className="leading-snug">
          <InputNumber
            size="small"
            min={0}
            className="w-full"
            value={editedValue(item).qty === '' ? null : Number(editedValue(item).qty)}
            onChange={value => editItem(item.icode, { qty: value == null ? '' : String(value) })}
          />
          {editedValue(item).qty !== item.qty && (
            <Text type="secondary" className="text-[11px]">เดิม {item.qty}</Text>
          )}
        </div>
      ),
    },
    {
      title: 'วิธีใช้',
      key: 'usage',
      render: (_: unknown, item) => (
        <div className="leading-snug">
          <UsageSelect
            value={editedValue(item).usage}
            onChange={usage => editItem(item.icode, { usage })}
          />
          {editedValue(item).usage !== item.usage && (
            <Text type="secondary" className="text-[11px]">
              เดิม {item.usage || '— ไม่ได้ระบุ —'}
            </Text>
          )}
        </div>
      ),
    },
    {
      title: '',
      key: 'reset',
      width: 90,
      align: 'center',
      render: (_: unknown, item) =>
        reconcileEdits[item.icode] ? (
          <Button
            type="text"
            size="small"
            icon={<UndoOutlined />}
            onClick={() =>
              setReconcileEdits(prev => {
                const next = { ...prev }
                delete next[item.icode]
                return next
              })
            }
          >
            <span className="text-[11px]">คืนค่า</span>
          </Button>
        ) : null,
    },
  ]

  const columns: ColumnsType<MedicationRow> = [
    {
      title: (
        <div className="text-center leading-tight">
          <div className="text-[13px]">ชื่อยา</div>
          <div className="text-[11px] font-normal opacity-60">Drugname</div>
        </div>
      ),
      dataIndex: 'drugName',
      key: 'drugName',
      fixed: 'left',
      width: 340,
      // scroll.x = 'max-content' ทำให้คอลัมน์ยืดตามชื่อยาที่ยาวที่สุด
      // คลาสนี้ตรึงความกว้างไว้ที่ 340px แล้วให้ชื่อยาตัดบรรทัดแทน (ดูกฎใน globals.css)
      className: 'drug-col',
      onHeaderCell: () => ({ className: 'drug-col' }),
      render: (name: string, _row, index) => (
        <div className="flex gap-2 leading-snug">
          <span className="w-5 shrink-0 text-right text-[12px] font-medium opacity-50">
            {index + 1}
          </span>
          <span className="font-semibold">{name}</span>
        </div>
      ),
    },
    ...(data?.columns ?? []).map(column => {
      const style = columnStyle(column)
      return {
        title: (
          <div className="text-center leading-tight">
            {/* พ.ศ. เหมือนวันที่ทุกจุดในหน้านี้ (modal Note และรายละเอียด visit) */}
            <div className="font-mono text-[13px] font-bold tracking-tight">
              {toThaiDate(column.date)}
            </div>
            <div className="mt-1 flex items-center justify-center gap-1.5">
              {/* จุดสีบอกชนิดการรับยา ตรงกับคำอธิบายสีด้านบนตาราง */}
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: style.head }}
              />
              <span className="text-[11px] font-medium opacity-75">{column.label}</span>
            </div>
            {/* เฉพาะผู้ป่วยนอก — HME/BCH ผูกกับการนอนโรงพยาบาล ไม่มี visit ให้เปิดดู */}
            {column.vn && data?.patient && (
              <Tooltip title="ดูรายละเอียดการมารับบริการครั้งนี้">
                <Button
                  type="text"
                  size="small"
                  icon={<ProfileOutlined />}
                  className="mt-0.5"
                  onClick={() => void openVisit(column, data.patient!.hn)}
                >
                  <span className="text-[11px]">รายละเอียด</span>
                </Button>
              </Tooltip>
            )}
          </div>
        ),
        key: column.key,
        align: 'center' as const,
        width: 150,
        render: (_: unknown, row: MedicationRow) => {
          const cell = row.cells[column.key]
          if (!cell) return null
          return (
            <div className="leading-snug">
              <div className="qty">{cell.qty}</div>
              {cell.usage && <div className="mt-0.5 text-[11px] opacity-65">{cell.usage}</div>}
            </div>
          )
        },
      }
    }),
  ]

  return (
    <>
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-violet-500/15 text-lg text-violet-200">
          <MedicineBoxOutlined />
        </div>
        <div>
          <Title level={3} style={{ color: '#fff', margin: 0 }}>ประวัติการได้รับยา</Title>
          <Paragraph type="secondary" style={{ margin: 0, fontSize: 12 }}>
            ค้นด้วย HN — เลือกช่วงย้อนหลังได้ ครอบคลุมทั้ง OPD, ยากลับบ้าน (HME) และยาต่อเนื่อง (BCH)
          </Paragraph>
        </div>
      </div>

      {/* ───────────── ช่องค้นหา ───────────── */}
      <div className="mb-5 flex flex-wrap items-start gap-3">
        <div className="w-full max-w-md">
        <Input.Search
          placeholder="HN / เลขบัตรประชาชน / ชื่อ-สกุล"
          size="large"
          maxLength={60}
          allowClear
          enterButton="ค้นหา"
          loading={loading}
          value={hn}
          onChange={e => {
            const next = e.target.value
            setHn(next)
            // ล้างช่องค้น (รวมถึงกดปุ่มกากบาท) = ล้างผลค้นหาเดิมออกจากหน้าจอ
            if (!next.trim()) {
              clearResult()
              setActiveHn('')
            }
          }}
          onSearch={value => void search(value)}
        />
          <Text type="secondary" className="mt-1.5 block text-[11px]">
            HN พิมพ์สั้นกว่า 9 หลักได้ ระบบเติมศูนย์นำหน้าให้ · เลขบัตรประชาชนต้องครบ 13
            หลัก · ค้นด้วยชื่อ-สกุล (แบบขึ้นต้น) จะให้ยืนยันจากรายชื่อก่อนเสมอ
          </Text>
        </div>

        <Select
          size="large"
          value={months}
          options={MONTH_OPTIONS}
          style={{ width: 180 }}
          onChange={value => {
            setMonths(value)
            // ถ้ามีผลค้นหาอยู่แล้ว เปลี่ยนช่วงเดือนให้ค้นซ้ำทันที ไม่ต้องกดค้นหาใหม่
            // ใช้ HN ที่กำลังแสดงอยู่ ไม่ใช่ค่าในช่องค้น (ซึ่งอาจเป็นชื่อหรือเลขบัตร)
            if (activeHn) void loadHistory(activeHn, value)
          }}
        />
      </div>

      {error && <Alert type="error" showIcon title={error} className="mb-5" />}

      {/* ───────────── ข้อมูลผู้ป่วย + ข้อมูลเพิ่มเติม (แถวเดียวกัน 70/30) ───────────── */}
      {data?.patient && (
        // จอแคบเรียงลงล่างแทน เพราะแบ่ง 30% แล้วปุ่มจะเหลือความกว้างไม่พอ
        <div className="mb-5 flex flex-col gap-4 lg:flex-row">
        {/* key = HN ทำให้ React สร้างการ์ดใหม่ทั้งใบเมื่อเปลี่ยนผู้ป่วย
            ไม่ให้ state ภายในของ antd (tooltip/tag ที่ค้างอยู่) ตกค้างข้ามคนไข้ */}
        <div
          key={data.patient.hn}
          className="flex min-w-0 gap-4 rounded-2xl border border-white/10 bg-white/3 p-3 backdrop-blur-md lg:w-[60%]"
        >
          {/* รูปผู้ป่วยจากตาราง patient_image — ไม่มีรูปก็ไม่กันพื้นที่ไว้ */}
          {data.hasPhoto && (
            <Image
              src={`/api/his/patient-image?hn=${data.patient.hn}`}
              alt={`รูปผู้ป่วย HN ${data.patient.hn}`}
              width={92}
              height={116}
              style={{ objectFit: 'cover', borderRadius: 10 }}
              className="shrink-0"
            />
          )}

          <div className="min-w-0 flex-1">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            ข้อมูลผู้ป่วย
          </div>

          {/* ไม่แสดงเลขบัตรประชาชน เบอร์โทร และที่อยู่ — หน้านี้ใช้ดูประวัติยาเท่านั้น
              (ฝั่ง API ก็ตัดออกตั้งแต่ต้นทางแล้ว ไม่ได้ซ่อนแค่ใน UI) */}
          <Descriptions
            size="small"
            column={{ xs: 1, sm: 2, lg: 3 }}
            items={[
              { key: 'hn', label: 'HN', children: data.patient.hn },
              { key: 'name', label: 'ชื่อ-สกุล', children: data.patient.name },
              { key: 'age', label: 'อายุ', children: data.patient.age != null ? `${data.patient.age} ปี` : '—' },
              {
                key: 'conditions',
                // บอกให้ชัดว่ามาจากประวัติทั้งหมด ไม่ใช่ช่วงเดือนที่เลือกไว้ด้านบน
                // โรคที่วินิจฉัยไว้เมื่อหลายปีก่อนก็ยังขึ้น ไม่ใช่ค่าค้างของคนไข้คนก่อน
                label: 'กลุ่มโรคสำคัญ (ทั้งประวัติ)',
                span: 'filled',
                children:
                  data.conditions.length > 0 ? (
                    <span className="flex flex-wrap gap-1.5">
                      {data.conditions.map(condition => (
                        <Tooltip
                          key={condition.key}
                          // รหัสที่ทำให้เข้ากลุ่ม พร้อมวันที่วินิจฉัยล่าสุด — กันเข้าใจผิดว่าเป็นข้อมูลลอย ๆ
                          title={
                            <span className="text-[11px]">
                              {condition.codes.slice(0, 6).map(code => (
                                <span key={code.icd10} className="block">
                                  {code.icd10} {code.name ?? ''} · ล่าสุด {toThaiDate(code.lastDate)}
                                </span>
                              ))}
                              {condition.codes.length > 6 && (
                                <span className="block">
                                  และอีก {condition.codes.length - 6} รหัส
                                </span>
                              )}
                            </span>
                          }
                        >
                          <Tag
                            color={CONDITION_COLOR[condition.key]}
                            style={{ marginInlineEnd: 0 }}
                          >
                            {condition.label}
                          </Tag>
                        </Tooltip>
                      ))}
                    </span>
                  ) : (
                    <Text type="secondary">ไม่พบกลุ่มโรคสำคัญในประวัติการวินิจฉัย</Text>
                  ),
              },
              {
                key: 'allergy',
                label: 'การแพ้ยา',
                // 'filled' = กินพื้นที่ที่เหลือของแถว ตามจำนวนคอลัมน์ที่เปลี่ยนไปตามขนาดจอ
                span: 'filled',
                children:
                  data.allergies.length > 0 ? (
                    <span className="flex flex-wrap gap-1.5">
                      {data.allergies.map(item => (
                        <Tooltip
                          key={item.agent}
                          title={[
                            item.symptom ? `อาการ: ${item.symptom}` : null,
                            item.seriousness ? `ความรุนแรง: ${item.seriousness}` : null,
                            item.reportDate ? `บันทึกเมื่อ: ${toThaiDate(item.reportDate)}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ') || 'ไม่มีรายละเอียดเพิ่มเติม'}
                        >
                          <Tag color="error" icon={<WarningOutlined />} style={{ marginInlineEnd: 0 }}>
                            {item.agent}
                          </Tag>
                        </Tooltip>
                      ))}
                    </span>
                  ) : (
                    <Text type="secondary">ไม่พบประวัติแพ้ยาในระบบ</Text>
                  ),
              },
            ]}
          />
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/3 p-3 backdrop-blur-md lg:w-[40%]">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            ข้อมูลเพิ่มเติม
          </div>
          {/* flex-wrap เพราะคอลัมน์ 30% เรียงปุ่มทั้งหมดในบรรทัดเดียวไม่พอ */}
          <div className="flex flex-wrap gap-2">
            <Button size="small" icon={<FileTextOutlined />} onClick={() => void openNotes(data.patient!.hn)}>
              Note
            </Button>
            <Button
              size="small"
              icon={<SolutionOutlined />}
              onClick={() => void openExams(data.patient!.hn)}
            >
              PE
            </Button>
            <Button
              size="small"
              icon={<SmileOutlined />}
              onClick={() => void openDental(data.patient!.hn)}
            >
              Dent Note
            </Button>
            <Button
              size="small"
              icon={<FileImageOutlined />}
              onClick={() => void openScans(data.patient!.hn)}
            >
              OPD Scan
            </Button>
            <Button
              size="small"
              icon={<RadarChartOutlined />}
              onClick={() => void openXray(data.patient!.hn)}
            >
              X-ray Report
            </Button>
            {/* แสดงเฉพาะผู้ป่วยที่เคยตรวจ HLA-B*5801 — ไม่เคยตรวจก็ไม่มีปุ่มให้กด */}
            {data.hlaResults.length > 0 && (
              <Button size="small" icon={<ExperimentOutlined />} onClick={() => setHlaOpen(true)}>
                HLA-B*5801 ({data.hlaResults.length})
              </Button>
            )}
            <Button size="small" icon={<SwapOutlined />} onClick={() => setReconcileOpen(true)}>
              Med Reconcile
            </Button>
          </div>
        </div>
        </div>
      )}

      {/* ───────────── Modal: รายละเอียดของ HN นี้ ───────────── */}
      <Modal
        title={
          data?.patient
            ? `บันทึกผู้ป่วย (Note) · HN ${data.patient.hn} · ${data.patient.name}`
            : 'บันทึกผู้ป่วย (Note)'
        }
        open={noteOpen}
        onCancel={() => setNoteOpen(false)}
        footer={null}
        // กว้างเกือบเต็มจอ — ข้อความในบันทึกมักยาวหลายบรรทัด
        width="90vw"
        style={{ top: 40, maxWidth: 1400 }}
      >
        <Spin spinning={noteLoading}>
          {noteError && <Alert type="error" showIcon title={noteError} className="mb-3" />}

          {/* กรองตามตำแหน่งของผู้บันทึก — เลือกได้หลายตำแหน่งพร้อมกัน */}
          {positionOptions.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <Select
                mode="multiple"
                allowClear
                size="small"
                placeholder="กรองตามตำแหน่งผู้บันทึก (ทั้งหมด)"
                value={notePositions}
                options={positionOptions}
                onChange={setNotePositions}
                maxTagCount="responsive"
                style={{ minWidth: 320, flex: '1 1 320px', maxWidth: 640 }}
              />
              <Text type="secondary" className="text-[11px]">
                แสดง {visibleNotes.length} จาก {notes.length} รายการ
              </Text>
            </div>
          )}

          <Table<PatientNote>
            rowKey="id"
            size="small"
            columns={NOTE_COLUMNS}
            dataSource={visibleNotes}
            pagination={false}
            scroll={{ x: 'max-content', y: 460 }}
            locale={{
              emptyText: (
                <Empty
                  description={
                    notes.length > 0
                      ? 'ไม่มีบันทึกของตำแหน่งที่เลือก'
                      : 'ไม่พบบันทึกของผู้ป่วยรายนี้'
                  }
                />
              ),
            }}
          />
        </Spin>
      </Modal>

      {/* ───────────── Modal: เลือกผู้ป่วยเมื่อค้นแล้วเจอหลายคน ───────────── */}
      <Modal
        title={`เลือกผู้ป่วย — พบ ${matches.length} ราย`}
        open={matchOpen}
        onCancel={() => setMatchOpen(false)}
        footer={null}
        width={640}
      >
        <Table<PatientMatch>
          rowKey="hn"
          size="small"
          dataSource={matches}
          pagination={false}
          scroll={{ y: 360 }}
          columns={[
            {
              title: 'HN',
              dataIndex: 'hn',
              key: 'hn',
              width: 110,
              render: (value: string) => <span className="font-mono text-xs">{value}</span>,
            },
            { title: 'ชื่อ-สกุล', dataIndex: 'name', key: 'name' },
            {
              title: 'อายุ',
              dataIndex: 'age',
              key: 'age',
              width: 80,
              render: (value: number | null) => (value == null ? '—' : `${value} ปี`),
            },
            {
              title: 'มาล่าสุด',
              dataIndex: 'lastVisit',
              key: 'lastVisit',
              width: 120,
              render: (value: string | null) => (
                <span className="font-mono text-xs">{toThaiDate(value) ?? '—'}</span>
              ),
            },
            {
              title: '',
              key: 'pick',
              width: 90,
              render: (_: unknown, row) => (
                <Button
                  size="small"
                  type="primary"
                  onClick={() => {
                    setMatchOpen(false)
                    setHn(row.hn)
                    void loadHistory(row.hn)
                  }}
                >
                  เลือก
                </Button>
              ),
            },
          ]}
        />
      </Modal>

      {/* ───────────── Modal: ผลตรวจ HLA-B*5801 ของผู้ป่วยรายนี้ ───────────── */}
      <Modal
        title={
          data?.patient
            ? `ผลตรวจ HLA-B*5801 · HN ${data.patient.hn} · ${data.patient.name}`
            : 'ผลตรวจ HLA-B*5801'
        }
        open={hlaOpen}
        onCancel={() => setHlaOpen(false)}
        footer={null}
        width="90vw"
        style={{ top: 32, maxWidth: 1200 }}
        styles={{ body: { maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' } }}
      >
        <div className="flex flex-col gap-5">
          {(data?.hlaResults ?? []).map(item => (
            <section key={item.labOrderNumber}>
              <SectionTitle>
                รายงานผล {toThaiDate(item.reportDate) ?? '—'} {item.reportTime ?? ''}
                {item.doctor ? ` · สั่งโดย ${item.doctor}` : ''}
              </SectionTitle>
              <div className="mb-2 text-sm">{item.result ?? '—'}</div>
              {item.images.length > 0 ? (
                <Image.PreviewGroup>
                  <div className="flex flex-wrap gap-3">
                    {item.images.map(index => (
                      <Image
                        key={index}
                        src={`/api/his/hla-b5801/image?lab_order_number=${item.labOrderNumber}&index=${index}`}
                        alt={`ใบรายงานผล HLA-B*5801 แผ่นที่ ${index}`}
                        width={240}
                        loading="lazy"
                        style={{ borderRadius: 8 }}
                      />
                    ))}
                  </div>
                </Image.PreviewGroup>
              ) : (
                <Text type="secondary" className="text-[11px]">ไม่มีรูปใบรายงานของครั้งนี้</Text>
              )}
            </section>
          ))}
        </div>
      </Modal>

      {/* ───────────── Modal: บันทึกงานทันตกรรม (dtmain) ───────────── */}
      <Modal
        title={
          data?.patient
            ? `บันทึกงานทันตกรรม · HN ${data.patient.hn} · ${data.patient.name}`
            : 'บันทึกงานทันตกรรม'
        }
        open={dentalOpen}
        onCancel={() => setDentalOpen(false)}
        footer={null}
        width="90vw"
        style={{ top: 40, maxWidth: 1400 }}
      >
        <Spin spinning={dentalLoading}>
          {dentalError && <Alert type="error" showIcon title={dentalError} className="mb-3" />}
          <Table<DentalNote>
            rowKey="vn"
            size="small"
            columns={DENTAL_COLUMNS}
            dataSource={dentalNotes}
            pagination={false}
            scroll={{ x: 'max-content', y: 460 }}
            locale={{ emptyText: <Empty description="ไม่พบประวัติงานทันตกรรมของผู้ป่วยรายนี้" /> }}
          />
        </Spin>
      </Modal>

      {/* ───────────── Modal: ผลอ่านภาพรังสี (xray_report) ───────────── */}
      <Modal
        title={
          data?.patient
            ? `ผลอ่านภาพรังสี · HN ${data.patient.hn} · ${data.patient.name}`
            : 'ผลอ่านภาพรังสี'
        }
        open={xrayOpen}
        onCancel={() => setXrayOpen(false)}
        footer={null}
        width="90vw"
        style={{ top: 40, maxWidth: 1400 }}
      >
        <Spin spinning={xrayLoading}>
          {xrayError && <Alert type="error" showIcon title={xrayError} className="mb-3" />}
          <Table<XrayReport>
            rowKey="xn"
            size="small"
            columns={XRAY_COLUMNS}
            dataSource={xrayReports}
            pagination={false}
            scroll={{ x: 'max-content', y: 460 }}
            locale={{ emptyText: <Empty description="ไม่พบผลอ่านภาพรังสีของผู้ป่วยรายนี้" /> }}
          />
        </Spin>
      </Modal>

      {/* ───────────── Modal: ภาพสแกนเวชระเบียน (opdscan) ───────────── */}
      <Modal
        title={
          data?.patient
            ? `ภาพสแกนเวชระเบียน · HN ${data.patient.hn} · ${data.patient.name}`
            : 'ภาพสแกนเวชระเบียน'
        }
        open={scanOpen}
        onCancel={() => setScanOpen(false)}
        footer={null}
        width="92vw"
        style={{ top: 32, maxWidth: 1400 }}
        styles={{ body: { maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' } }}
      >
        <Spin spinning={scanLoading}>
          {scanError && <Alert type="error" showIcon title={scanError} className="mb-3" />}

          {scans.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <Select
                allowClear
                size="small"
                placeholder="เลือกครั้งที่มารับบริการ (ทั้งหมด)"
                value={scanVn}
                onChange={value => setScanVn(value ?? null)}
                style={{ minWidth: 300 }}
                options={[...scanVnCount.entries()].map(([vn, count]) => ({
                  value: vn,
                  // vn ขึ้นต้นด้วย ปปดดวว พ.ศ. สองหลัก จึงเทียบวันที่จากรายการได้ตรง ๆ
                  label: `VN ${vn} (${count} ภาพ)`,
                }))}
              />
              <Text type="secondary" className="text-[11px]">
                แสดง {visibleScans.length} จาก {scans.length} ภาพ (สูงสุด 60 ภาพล่าสุด)
              </Text>
            </div>
          )}

          {visibleScans.length > 0 ? (
            // โหลดภาพเมื่อเลื่อนถึงเท่านั้น — แต่ละใบเป็นไฟล์เต็มขนาดหลักร้อย KB ถึงหลาย MB
            <Image.PreviewGroup>
              <div className="flex flex-wrap gap-3">
                {visibleScans.map(scan => (
                  <div key={scan.scanId} className="w-44">
                    <Image
                      src={`/api/his/opd-scan/image?hn=${scan.hn}&scan_id=${scan.scanId}`}
                      alt={`สแกนหน้า ${scan.pageNo ?? '-'} วันที่ ${scan.scannedAt ?? '-'}`}
                      width={176}
                      height={220}
                      loading="lazy"
                      style={{ objectFit: 'cover', borderRadius: 8 }}
                      fallback="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNzYiIGhlaWdodD0iMjIwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMmExYzRkIi8+PC9zdmc+"
                    />
                    <div className="mt-1 leading-snug">
                      <div className="font-mono text-[11px]">
                        {toThaiDate(scan.scannedAt) ?? '—'}
                      </div>
                      <Text type="secondary" className="text-[11px]">
                        หน้า {scan.pageNo ?? '-'}
                        {scan.vn ? ` · VN ${scan.vn}` : ''}
                      </Text>
                    </div>
                  </div>
                ))}
              </div>
            </Image.PreviewGroup>
          ) : (
            !scanLoading && <Empty description="ไม่พบภาพสแกนของผู้ป่วยรายนี้" />
          )}
        </Spin>
      </Modal>

      {/* ───────────── Modal: ประวัติผลตรวจร่างกาย (PE) ───────────── */}
      <Modal
        title={
          data?.patient
            ? `ผลตรวจร่างกาย (PE) · HN ${data.patient.hn} · ${data.patient.name}`
            : 'ผลตรวจร่างกาย (PE)'
        }
        open={peOpen}
        onCancel={() => setPeOpen(false)}
        footer={null}
        width="90vw"
        style={{ top: 40, maxWidth: 1400 }}
      >
        <Spin spinning={peLoading}>
          {peError && <Alert type="error" showIcon title={peError} className="mb-3" />}

          {/* กรองตามผู้บันทึก — เลือกได้หลายคนพร้อมกัน */}
          {doctorOptions.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <Select
                mode="multiple"
                allowClear
                size="small"
                placeholder="กรองตามผู้บันทึก (ทั้งหมด)"
                value={peDoctors}
                options={doctorOptions}
                onChange={setPeDoctors}
                maxTagCount="responsive"
                style={{ minWidth: 320, flex: '1 1 320px', maxWidth: 640 }}
              />
              <Text type="secondary" className="text-[11px]">
                แสดง {visibleExams.length} จาก {exams.length} รายการ
              </Text>
            </div>
          )}

          <Table<PhysicalExam>
            rowKey="vn"
            size="small"
            columns={PE_COLUMNS}
            dataSource={visibleExams}
            pagination={false}
            scroll={{ x: 'max-content', y: 460 }}
            locale={{
              emptyText: (
                <Empty
                  description={
                    exams.length > 0
                      ? 'ไม่มีผลตรวจของผู้บันทึกที่เลือก'
                      : 'ไม่พบผลตรวจร่างกายของผู้ป่วยรายนี้'
                  }
                />
              ),
            }}
          />
        </Spin>
      </Modal>

      {/* ───────────── Modal: รายละเอียดการมารับบริการ (visit ผู้ป่วยนอก) ───────────── */}
      <Modal
        title={
          visitColumn
            ? `รายละเอียดการมารับบริการ · ${toThaiDate(visitColumn.date)} · ${visitColumn.label}`
            : 'รายละเอียดการมารับบริการ'
        }
        open={visitOpen}
        onCancel={() => setVisitOpen(false)}
        footer={null}
        // เนื้อหาเป็นตารางหลายชุด จึงกางเกือบเต็มจอ แล้วให้เลื่อนภายในตัว modal เอง
        width="96vw"
        style={{ top: 24, maxWidth: 1600 }}
        styles={{ body: { maxHeight: 'calc(100vh - 140px)', overflowY: 'auto' } }}
      >
        <Spin spinning={visitLoading}>
          {visitError && <Alert type="error" showIcon title={visitError} className="mb-3" />}
          {visit && (
            <div className="flex flex-col gap-5">
              <Descriptions
                size="small"
                bordered
                column={{ xs: 1, sm: 2, lg: 3 }}
                items={[
                  {
                    key: 'date',
                    label: 'วันที่มารับบริการ',
                    children: [toThaiDate(visit.header.date), visit.header.time]
                      .filter(Boolean)
                      .join(' ') || '—',
                  },
                  { key: 'dep', label: 'ห้องตรวจ', children: visit.header.department ?? '—' },
                  { key: 'clinic', label: 'แผนก', children: visit.header.clinic ?? '—' },
                  { key: 'doctor', label: 'แพทย์ผู้ตรวจ', children: visit.header.doctor ?? '—' },
                  { key: 'arrival', label: 'ประเภทการมา', children: visit.header.arrival ?? '—' },
                  { key: 'payment', label: 'สิทธิการรักษา', children: visit.header.payment ?? '—' },
                ]}
              />

              {visit.chiefComplaint && (
                <section>
                  <SectionTitle>อาการสำคัญ</SectionTitle>
                  <div className="rounded-lg border border-white/10 bg-white/3 p-3 text-sm whitespace-pre-wrap">
                    {visit.chiefComplaint}
                  </div>
                </section>
              )}

              {visit.physicalExam && (
                <section>
                  <SectionTitle>ตรวจร่างกาย / บันทึกแพทย์ (PE)</SectionTitle>
                  {/* ข้อความมีการขึ้นบรรทัดของแพทย์เอง ต้องคงไว้ */}
                  <div className="rounded-lg border border-white/10 bg-white/3 p-3 text-sm whitespace-pre-wrap">
                    {visit.physicalExam}
                  </div>
                </section>
              )}

              {visit.vitals.length > 0 && (
                <section>
                  <SectionTitle>สัญญาณชีพ</SectionTitle>
                  <div className="flex flex-wrap gap-2">
                    {visit.vitals.map(item => (
                      <span
                        key={item.label}
                        className="rounded-lg border border-white/10 bg-white/3 px-3 py-1.5 leading-tight"
                      >
                        <span className="mr-2 text-[11px] opacity-60">{item.label}</span>
                        <span className="qty">{item.value}</span>
                      </span>
                    ))}
                  </div>
                </section>
              )}

              <section>
                <SectionTitle>การวินิจฉัย ({visit.diagnoses.length})</SectionTitle>
                <Table<VisitDiagnosis>
                  rowKey={row => `${row.icd10}-${row.typeName ?? ''}`}
                  size="small"
                  columns={DIAGNOSIS_COLUMNS}
                  dataSource={visit.diagnoses}
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                  locale={{ emptyText: <Empty description="ไม่มีการวินิจฉัยที่บันทึกไว้" /> }}
                />
              </section>

              <section>
                <SectionTitle>รายการที่ได้รับ ({visit.orders.length})</SectionTitle>
                <Table<VisitOrder>
                  rowKey="key"
                  size="small"
                  columns={ORDER_COLUMNS}
                  dataSource={visit.orders}
                  pagination={false}
                  scroll={{ x: 'max-content', y: 320 }}
                  locale={{ emptyText: <Empty description="ไม่มีรายการในครั้งนี้" /> }}
                />
              </section>

              {visit.labs.length > 0 && (
                <section>
                  <SectionTitle>ผลตรวจทางห้องปฏิบัติการ ({visit.labs.length})</SectionTitle>
                  <Table<VisitLab>
                    rowKey="key"
                    size="small"
                    columns={LAB_COLUMNS}
                    dataSource={visit.labs}
                    pagination={false}
                    scroll={{ x: 'max-content', y: 360 }}
                  />
                </section>
              )}
            </div>
          )}
        </Spin>
      </Modal>

      {/* ───────────── Modal: Med Reconcile ───────────── */}
      <Modal
        title={
          data?.patient
            ? `Med Reconcile · HN ${data.patient.hn} · ${data.patient.name}`
            : 'Med Reconcile'
        }
        open={reconcileOpen}
        onCancel={() => setReconcileOpen(false)}
        footer={null}
        width="92vw"
        style={{ top: 32, maxWidth: 1400 }}
        styles={{ body: { maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' } }}
      >
        <Alert
          type="info"
          showIcon
          className="mb-3"
          title="ตัวอย่างการทำงาน"
          description={`รายการยาที่ผู้ป่วยได้รับล่าสุดในช่วง ${data?.months ?? months} เดือน แก้จำนวนและวิธีใช้เพื่อทบทวนได้ ค่าที่แก้ยังไม่ถูกบันทึกกลับเข้าระบบ HIS`}
        />

        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Text type="secondary" className="text-[11px]">
            {reconcileItems.length} รายการยา · เลือกไว้ {reconcileSelected.length} รายการ · แก้ไขแล้ว{' '}
            {Object.keys(reconcileEdits).length} รายการ
          </Text>
          {Object.keys(reconcileEdits).length > 0 && (
            <Button size="small" icon={<UndoOutlined />} onClick={() => setReconcileEdits({})}>
              คืนค่าเดิมทั้งหมด
            </Button>
          )}
          {/* พิมพ์เฉพาะรายการที่ติ๊กไว้ — ไม่ติ๊กเลยก็ไม่มีอะไรให้พิมพ์ */}
          <Button
            size="small"
            type="primary"
            icon={<PrinterOutlined />}
            disabled={reconcileSelected.length === 0}
            onClick={() => setPrintOpen(true)}
            className="ml-auto"
          >
            พิมพ์ ({reconcileSelected.length})
          </Button>
        </div>

        <div className="data-sheet">
          <Table<ReconcileItem>
            rowKey="icode"
            size="small"
            columns={RECONCILE_COLUMNS}
            dataSource={reconcileItems}
            rowSelection={{
              selectedRowKeys: reconcileSelected.map(item => item.icode),
              onChange: keys => {
                const picked = new Set(keys as string[])
                const next: Record<string, true> = {}
                for (const item of reconcileItems) {
                  if (!picked.has(item.icode)) next[item.icode] = true
                }
                setReconcileExcluded(next)
              },
            }}
            pagination={false}
            scroll={{ x: 'max-content', y: 'calc(100vh - 340px)' }}
            locale={{ emptyText: <Empty description="ไม่พบรายการยาในช่วงเวลาที่เลือก" /> }}
          />
        </div>
      </Modal>

      {/* ───────────── Modal: ตัวอย่างก่อนพิมพ์ (PDF) ───────────── */}
      <Modal
        title={
          data?.patient
            ? `ใบทบทวนรายการยา · HN ${data.patient.hn} · ${data.patient.name}`
            : 'ใบทบทวนรายการยา'
        }
        open={printOpen}
        onCancel={() => setPrintOpen(false)}
        footer={null}
        width="92vw"
        style={{ top: 24, maxWidth: 1000 }}
        // destroyOnHidden: ปิดแล้วทิ้ง viewer ไปเลย เปิดใหม่จะได้สร้างเอกสารจากค่าล่าสุดเสมอ
        destroyOnHidden
      >
        <Text type="secondary" className="text-[11px]">
          สั่งพิมพ์หรือบันทึกไฟล์ได้จากแถบเครื่องมือของตัวอ่าน PDF ด้านล่าง
        </Text>
        <div className="mt-2 h-[calc(100vh-200px)] overflow-hidden rounded-lg">
          {printOpen && (() => {
            const printData = buildPrintData()
            return printData ? <ReconcilePdfViewer data={printData} /> : null
          })()}
        </div>
      </Modal>

      {/* ───────────── ตารางประวัติยา ───────────── */}
      <Spin spinning={loading}>
        {data ? (
          data.rows.length > 0 ? (
            <>
              <div className="mb-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-300">
                <span>คำอธิบายสี:</span>
                {[...Object.entries(TYPE_STYLE), ['ER', ER_STYLE] as const].map(([key, style]) => (
                  <span key={key} className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: style.head }} />
                    {style.legend}
                  </span>
                ))}
                <span className="ml-auto text-slate-400">
                  {data.rows.length} รายการยา · {data.columns.length} ครั้งที่รับยา
                </span>
              </div>
              {/* ใช้ธีมมืดของ antd ตามปกติเหมือนตาราง Note ใน modal */}
              <div className="data-sheet">
                <Table<MedicationRow>
                  rowKey="icode"
                  size="small"
                  columns={columns}
                  dataSource={data.rows}
                  pagination={false}
                  // สูงตามจอ (หักส่วนหัวเรื่อง/ช่องค้นหา/การ์ดผู้ป่วยออก) แทนค่าคงที่
                  scroll={{ x: 'max-content', y: 'calc(100vh - 420px)' }}
                />
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/3 py-16 backdrop-blur-md">
              <Empty description={`ไม่พบประวัติการได้รับยาในช่วง ${data.months} เดือนล่าสุด`} />
            </div>
          )
        ) : (
          !loading && (
            <div className="rounded-2xl border border-white/10 bg-white/3 py-16 backdrop-blur-md">
              <Empty description="กรอก HN แล้วกดค้นหา" />
            </div>
          )
        )}
      </Spin>
    </>
  )
}
