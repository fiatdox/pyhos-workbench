'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ยังทำที่ app/home/rdu/layout.tsx ซึ่งเป็น Server Component)
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Alert,
  Breadcrumb,
  Button,
  DatePicker,
  Empty,
  InputNumber,
  Segmented,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { EyeOutlined, FileExcelOutlined, SearchOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import buddhistEra from 'dayjs/plugin/buddhistEra'
import { apiFetch } from '@/lib/client/session'
import { trackExport } from '@/lib/client/track-export'
import type {
  DuplicateDrugLine,
  DuplicateDrugOption,
  DuplicatePairRule,
  DuplicatePatientCase,
  DuplicateReport,
  DuplicateScope,
  DuplicateUnit,
  DuplicateVisitCase,
} from '@/lib/his/rdu-duplicate'
import RowSearch, { matchesRow } from '../row-search'
import VisitDetailModal from '../visit-modal'
import PageHint from '../../../page-hint'
import { ReportSkeleton } from '@/app/home/skeletons'

// เปิด token BBBB (ปี พ.ศ.) ให้ dayjs — ถ้าไม่ extend ปฏิทินจะพิมพ์คำว่า BBBB ออกมาตรง ๆ
dayjs.extend(buddhistEra)

const { Text, Title } = Typography
const { RangePicker } = DatePicker

/**
 * เครื่องมือค้นหาการใช้ยาซ้ำซ้อน
 *
 * ไม่ใช่ตัวชี้วัด — ต่างจากทุกหน้าในโฟลเดอร์นี้ที่ผูกกับทะเบียนยาซึ่งคณะกรรมการ
 * ตกลงไว้แล้วและมีเกณฑ์กำกับ หน้านี้ให้เภสัชกรประกอบชุดยาขึ้นเองตอนนั้น จึงไม่มี
 * เกณฑ์ ไม่มีตัวชี้วัด และไม่ตัดสินผ่าน/ไม่ผ่าน — ตอบแค่ว่า "ในชุดยาที่เลือกนี้
 * มีใครได้รับซ้ำซ้อนบ้าง"
 *
 * **ผลลัพธ์ถูกหรือไม่ขึ้นกับชุดยาที่ผู้ใช้เลือกทั้งหมด** ซึ่งเป็นเรื่องที่หน้าจอ
 * ต้องบอกให้ชัด ไม่ใช่ปล่อยให้เข้าใจเอาเอง — ถ้าเลือกยาที่ใช้ร่วมกันได้ตามปกติ
 * ปนมา (พาราเซตามอล + NSAID) ตัวเลขที่ได้คือการสั่งยาร่วมกันตามปกติ ไม่ใช่
 * ความผิดพลาด วัดแล้วชุดแบบนั้นให้ "ซ้ำซ้อน" เกือบสี่หมื่นครั้งต่อปีงบ
 */

/** แปลง 'YYYY-MM-DD' เป็น วว/ดด/ปปปป พ.ศ. */
function toThaiDate(value: string | null): string {
  if (!value) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return value
  const [, year, month, day] = match
  return `${day}/${month}/${Number(year) + 543}`
}

/** ค่าเริ่มต้น: ย้อนหลัง 30 วันถึงวันนี้ — เท่ากับรายงานอื่นในหมวดนี้ */
const DEFAULT_RANGE: [Dayjs, Dayjs] = [dayjs().subtract(30, 'day'), dayjs()]

/** ใส่ BOM เพราะ Excel บนวินโดวส์เดาว่า CSV เป็น CP874 (เหตุผลเต็มอยู่ที่ visit-report.tsx) */
function toCsv(rows: string[][]): string {
  const cell = (value: string) => `"${value.replace(/"/g, '""')}"`
  return '﻿' + rows.map(row => row.map(cell).join(',')).join('\r\n')
}

const sexLabel = (sex: string | null) => (sex === '1' ? 'ชาย' : sex === '2' ? 'หญิง' : '—')

const UNIT_LABEL: Record<DuplicateUnit, { short: string; long: string }> = {
  generic: {
    short: 'ชื่อสามัญ',
    long: 'ได้รับยาที่ชื่อสามัญต่างกันตั้งแต่สองชื่อ — ตอบว่าได้ยาที่ออกฤทธิ์ซ้ำทางกันไหม',
  },
  item: {
    short: 'รายการยา',
    long: 'ได้รับรายการยาต่างกันตั้งแต่สองรายการ — รวมกรณีชื่อสามัญเดียวกันแต่คนละรหัส',
  },
}

const SCOPE_LABEL: Record<DuplicateScope, string> = {
  visit: 'ใน visit เดียวกัน',
  across: 'ข้าม visit',
}

/**
 * ความกว้างหน้าต่างเป็นข้อความ
 *
 * 0 วันไม่ได้แปลว่า "ไม่มีหน้าต่าง" แต่แปลว่าคนละครั้งในวันเดียวกัน ซึ่งเป็น
 * คำถามที่มีจริง ถ้าพิมพ์ว่า "0 วัน" คนอ่านจะเข้าใจว่าปิดโหมดนี้ไปแล้ว
 */
const windowText = (days: number) => (days === 0 ? 'วันเดียวกัน' : `${days} วัน`)

/** คำอธิบายขอบเขต ซึ่งของโหมดข้าม visit เปลี่ยนตามหน้าต่างที่เลือก */
const scopeLong = (scope: DuplicateScope, days: number) =>
  scope === 'visit'
    ? 'ได้รับพร้อมกันในครั้งที่มารับบริการเดียวกัน — ความผิดพลาดของการสั่งยาครั้งนั้น'
    : days === 0
      ? 'ได้รับจากคนละครั้งในวันเดียวกัน — มักเป็นการมาซ้ำหรือสั่งจากคนละแผนกในวันนั้น'
      : `ได้รับจากคนละครั้ง ห่างกันไม่เกิน ${days} วัน — มักเป็นการสั่งจากคนละแผนกที่ไม่เห็นกัน`

/**
 * จำนวนที่จ่ายพร้อมหน่วยจริงของยานั้น
 *
 * ไม่เขียนกำกับว่า "เม็ด" เอาเอง — หน่วยในบัญชียามีทั้งเม็ด แค็บซูล ขวดตาม
 * ปริมาตร Vial และ Ampule ถ้าเขียนทับจะผิดกับยาน้ำและยาฉีดทั้งหมด
 */
const amountText = (line: DuplicateDrugLine) =>
  line.qty == null
    ? null
    : `${line.qty.toLocaleString('th-TH')}${line.units == null ? '' : ` ${line.units}`}`

/** บรรทัดยาเป็นข้อความบรรทัดเดียว — ใช้กับการค้นในตารางและไฟล์ CSV */
const lineText = (line: DuplicateDrugLine) =>
  [line.name, amountText(line), line.usageCode, line.usage]
    .filter(part => part != null && part !== '')
    .join(' · ')

/**
 * บรรทัดยาเป็น JSX — ชื่อยา จำนวน และวิธีใช้
 *
 * จำนวนกับวิธีใช้เน้นสีเข้มกว่าชื่อยา เพราะเป็นสิ่งที่ต้องเทียบระหว่างสองครั้ง
 * ชื่อยาในบัญชีมีชื่อการค้ากับชื่อบริษัทปนจนยาวมาก ถ้าเน้นชื่อยาเท่ากัน
 * ตาจะไปจับชื่อก่อนแล้วมองข้ามจำนวนที่เป็นประเด็น
 */
function DrugLines({ lines }: { lines: DuplicateDrugLine[] }) {
  if (lines.length === 0) {
    return (
      <Text type="secondary" className="text-xs">
        —
      </Text>
    )
  }
  return (
    <div className="flex flex-col gap-0.5">
      {lines.map(line => (
        <div key={line.icode} className="text-[11px] leading-snug">
          <span className="text-ink-3">{line.name}</span>
          {amountText(line) != null && (
            <span className="ml-1 font-semibold text-ink">{amountText(line)}</span>
          )}
          {(line.usageCode != null || line.usage != null) && (
            <span className="ml-1 text-ink">
              {line.usageCode != null && (
                <span className="font-mono text-ink-3">{line.usageCode} </span>
              )}
              {line.usage ?? ''}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

const PAIR_LABEL: Record<DuplicatePairRule, { short: string; long: string }> = {
  different: {
    short: 'ยาต่างตัว',
    long: 'ได้ยาคนละตัวที่ออกฤทธิ์ซ้ำทางกัน เช่น omeprazole ครั้งหนึ่ง pantoprazole อีกครั้ง',
  },
  same: {
    short: 'ยาตัวเดิมซ้ำ',
    long: 'ได้ยาตัวเดิมอีกจากคนละครั้ง เช่นเมื่อวานได้ gabapentin วันนี้มาอีกครั้งแล้วได้อีก — ผู้ป่วยมียาซ้อนกันสองชุด',
  },
  any: {
    short: 'ทั้งสองแบบ',
    long: 'นับทั้งยาต่างตัวที่ซ้ำทางกันและยาตัวเดิมที่ได้ซ้ำ',
  },
}

/**
 * ปุ่มลัดของจำนวนวัน — ค่าที่ใช้บ่อยตามรอบจ่ายยาจริง
 *
 * 0 = คนละครั้งวันเดียวกัน · 7/14 = ยาระยะสั้นอย่างยาปฏิชีวนะ · 30/60/90 = รอบนัด
 * ของคลินิกโรคเรื้อรัง · 180 = ครึ่งปี สำหรับยาที่จ่ายครั้งละนาน
 */
const WINDOW_PRESETS = [0, 7, 14, 30, 60, 90, 180]

/**
 * รูปคำตอบจากเซิร์ฟเวอร์ — ใช้ชนิดเดียวกับที่ฝั่งเซิร์ฟเวอร์ประกาศไว้
 *
 * ไม่ประกาศซ้ำที่นี่ ทั้งที่หน้ารายงานอื่นในโฟลเดอร์นี้ทำแบบนั้น — ตอนเพิ่มกฎ
 * การจับคู่ รูปของ counts เปลี่ยนจาก Record<scope, number> เป็นโครงซ้อน แต่
 * ชนิดที่ประกาศซ้ำไว้ยังเป็นแบบเดิม จึงคอมไพล์ผ่านทั้งที่หน้าจออ่านค่าผิดรูป
 * (ค่าที่ได้จะเป็นอ็อบเจกต์แล้วเรนเดอร์ออกมาพัง) การ import ชนิดมาตรง ๆ ปิด
 * ช่องนั้นไปเลย
 *
 * import type เท่านั้น ไม่ใช่ import ค่า — TypeScript ลบทิ้งตอนคอมไพล์ จึงไม่มี
 * โค้ดของ server-only (และ mysql2 ที่ติดมากับมัน) หลุดเข้า client bundle
 */
type Report = DuplicateReport

/** จำนวนแถวต่อหน้า — ช่องลำดับใช้ค่านี้คำนวณเลขต่อข้ามหน้า */
const PAGE_SIZE = 50

export default function DuplicateSearchPage() {
  const [drugs, setDrugs] = useState<DuplicateDrugOption[]>([])
  const [maxIcodes, setMaxIcodes] = useState(60)
  /* เพดานของหน้าต่างมาจากเซิร์ฟเวอร์ ไม่ได้ฝังไว้ที่นี่ — ถ้าฝังทั้งสองที่แล้ววันหนึ่ง
     แก้ข้างเดียว หน้าจอจะปล่อยให้กรอกค่าที่เซิร์ฟเวอร์ปฏิเสธโดยไม่บอกเหตุผล */
  const [windowBounds, setWindowBounds] = useState({ min: 0, max: 366 })
  const [loadingDrugs, setLoadingDrugs] = useState(true)

  const [generics, setGenerics] = useState<string[]>([])
  const [icodes, setIcodes] = useState<string[]>([])
  const [range, setRange] = useState<[Dayjs, Dayjs]>(DEFAULT_RANGE)
  const [unit, setUnit] = useState<DuplicateUnit>('generic')
  const [scope, setScope] = useState<DuplicateScope>('visit')
  /** ความกว้างหน้าต่างของโหมดข้าม visit เป็นวัน — ตั้งต้นเท่ากับฝั่งเซิร์ฟเวอร์ */
  const [windowDays, setWindowDays] = useState(90)
  /**
   * กฎการจับคู่ของโหมดข้าม visit
   *
   * ตั้งต้น different เท่ากับฝั่งเซิร์ฟเวอร์ — ไม่ตั้งต้นเป็น any เพราะที่หน้าต่าง
   * กว้าง ยาตัวเดิมซ้ำเกือบทั้งหมดเป็นการรับยาต่อเนื่องตามนัด ผลจะท่วมไปด้วย
   * เคสปกติ ช่องเทียบด้านล่างแสดงยอดของทั้งสามกฎอยู่แล้ว จึงเห็นได้ทันทีว่า
   * กฎอื่นให้เท่าไรโดยไม่ต้องกดค้นใหม่
   */
  const [pairRule, setPairRule] = useState<DuplicatePairRule>('different')

  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState('')
  const [picked, setPicked] = useState<DuplicateVisitCase | null>(null)
  const [page, setPage] = useState(1)
  const [toast, toastHolder] = message.useMessage()

  useEffect(() => {
    let alive = true
    const run = async () => {
      try {
        const res = await apiFetch('/api/his/rdu/duplicate')
        const json = await res.json()
        if (!alive) return
        if (!res.ok || !json.success) {
          setError(json.message ?? 'อ่านรายการยาไม่สำเร็จ')
          return
        }
        setDrugs(json.drugs as DuplicateDrugOption[])
        setMaxIcodes(Number(json.maxIcodes ?? 60))
        setWindowBounds({
          min: Number(json.minWindowDays ?? 0),
          max: Number(json.maxWindowDays ?? 366),
        })
        if (json.defaultWindowDays != null) setWindowDays(Number(json.defaultWindowDays))
        if (json.defaultPairRule != null) setPairRule(json.defaultPairRule as DuplicatePairRule)
      } catch {
        if (alive) setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
      } finally {
        if (alive) setLoadingDrugs(false)
      }
    }
    void run()
    return () => {
      alive = false
    }
  }, [])

  /**
   * ชื่อสามัญทั้งหมด พร้อมจำนวนรหัสของแต่ละชื่อ
   *
   * บอกจำนวนรหัสไว้ในตัวเลือกเลย เพราะเป็นข้อมูลที่ต้องรู้ก่อนเลือก — ชื่อที่มี
   * หลายรหัสคือชื่อที่หน่วยการนับสองแบบจะให้ผลต่างกัน (OMEPRAZOLE มี 4 รหัส
   * ระดับรายการยาจึงฟ้องคนที่ได้ยาตัวเดียวกันคนละรูปแบบด้วย)
   */
  const genericOptions = useMemo(() => {
    const groups = new Map<string, number>()
    for (const drug of drugs) {
      if (drug.generic == null) continue
      groups.set(drug.generic, (groups.get(drug.generic) ?? 0) + 1)
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([generic, count]) => ({
        value: generic,
        label: count === 1 ? generic : `${generic} (${count} รหัส)`,
      }))
  }, [drugs])

  const itemOptions = useMemo(
    () =>
      drugs.map(drug => ({
        value: drug.icode,
        label: drug.name,
        generic: drug.generic ?? '',
        strength: drug.strength ?? '',
      })),
    [drugs],
  )

  /** จำนวนรหัสที่ชุดนี้จะขยายออกมา — บอกก่อนกดค้น ไม่ให้ไปเจอเพดานที่เซิร์ฟเวอร์ */
  const resolvedIcodes = useMemo(() => {
    const picked = new Set(icodes)
    const chosen = new Set(generics)
    for (const drug of drugs) {
      if (drug.generic != null && chosen.has(drug.generic)) picked.add(drug.icode)
    }
    return picked.size
  }, [drugs, generics, icodes])

  const overLimit = resolvedIcodes > maxIcodes
  const nothingPicked = generics.length === 0 && icodes.length === 0
  /** ความยาวของช่วงวันที่เป็นวัน — ใช้เตือนเมื่อหน้าต่างกว้างกว่าช่วงที่ค้น */
  const rangeDays = range[1].diff(range[0], 'day') + 1

  const search = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('/api/his/rdu/duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: range[0].format('YYYY-MM-DD'),
          to: range[1].format('YYYY-MM-DD'),
          generics,
          icodes,
          unit,
          scope,
          pairRule,
          windowDays,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        setError(json.message ?? 'ค้นรายงานไม่สำเร็จ')
        setReport(null)
        return
      }
      setReport(json as Report)
      setPage(1)
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
      setReport(null)
    } finally {
      setLoading(false)
    }
  }

  const visitRows = useMemo(
    () =>
      (report?.visitCases ?? []).filter(row =>
        matchesRow(
          [
            row.hn,
            row.vn,
            row.patientName,
            row.department,
            row.doctor,
            ...row.generics,
            ...row.lines.map(lineText),
          ],
          keyword,
        ),
      ),
    [report, keyword],
  )

  const patientRows = useMemo(
    () =>
      (report?.patientCases ?? []).filter(row =>
        matchesRow(
          [
            row.hn,
            row.patientName,
            ...row.repeatedUnits,
            ...row.events.flatMap(event => [
              event.department,
              event.doctor,
              ...event.lines.map(lineText),
            ]),
          ],
          keyword,
        ),
      ),
    [report, keyword],
  )

  const shownCount = report?.scope === 'across' ? patientRows.length : visitRows.length
  const pageCount = Math.max(1, Math.ceil(shownCount / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const indexOf = (index: number) => (currentPage - 1) * PAGE_SIZE + index + 1

  const exportCsv = () => {
    if (report == null) return
    const unitName = UNIT_LABEL[report.unit].short
    const scopeName =
      report.scope === 'across'
        ? `${SCOPE_LABEL.across}-${report.windowDays}วัน-${PAIR_LABEL[report.pairRule].short}`
        : SCOPE_LABEL.visit
    let header: string[]
    let body: string[][]

    if (report.scope === 'across') {
      header = [
        'ลำดับ',
        'HN',
        'ชื่อ-สกุล',
        'เพศ',
        'อายุ',
        'ยาตัวเดิมที่ได้ซ้ำ',
        'จำนวนที่ซ้ำ',
        'ห่างกันน้อยสุด (วัน)',
        'ครั้งที่เกี่ยวข้อง',
      ]
      body = patientRows.map((row, index) => [
        String(index + 1),
        // นำหน้าด้วย ' เพื่อให้ Excel เก็บเป็นข้อความ ไม่ตัดศูนย์หน้า HN ทิ้ง
        `'${row.hn}`,
        row.patientName,
        sexLabel(row.sex),
        row.ageYears == null ? '' : String(row.ageYears),
        row.repeatedUnits.join(' + '),
        String(row.units),
        String(row.closestGapDays),
        row.events
          .map(
            event =>
              `${toThaiDate(event.date)} ${event.department ?? ''} :: ${event.lines
                .map(lineText)
                .join(' / ')}`,
          )
          .join(' || '),
      ])
    } else {
      header = [
        'ลำดับ',
        'วันที่',
        'VN',
        'HN',
        'ชื่อ-สกุล',
        'เพศ',
        'อายุ',
        'ห้องตรวจ',
        'แพทย์ผู้ตรวจ',
        'จำนวนที่ซ้ำ',
        'ชื่อสามัญ',
        'รายการยา จำนวน และวิธีใช้',
      ]
      body = visitRows.map((row, index) => [
        String(index + 1),
        toThaiDate(row.date),
        `'${row.vn}`,
        `'${row.hn}`,
        row.patientName,
        sexLabel(row.sex),
        row.ageYears == null ? '' : String(row.ageYears),
        row.department ?? '',
        row.doctor ?? '',
        String(row.units),
        row.generics.join(' + '),
        row.lines.map(lineText).join(' / '),
      ])
    }

    const blob = new Blob([toCsv([header, ...body])], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `ยาซ้ำซ้อน-${unitName}-${scopeName}-${range[0].format('YYYY-MM-DD')}-ถึง-${range[1].format('YYYY-MM-DD')}.csv`
    link.click()
    // แจ้งเซิร์ฟเวอร์ว่าข้อมูลชุดนี้ถูกนำออกจากระบบ — ไฟล์สร้างในเบราว์เซอร์
    // จึงไม่มีคำขอไหนวิ่งไปให้ proxy ดักได้เอง
    trackExport({ label: link.download, rows: body.length })
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success(`ส่งออก ${body.length} รายการแล้ว`)
  }

  const visitColumns: ColumnsType<DuplicateVisitCase> = [
    {
      title: 'ลำดับ',
      key: 'index',
      width: 70,
      align: 'center',
      render: (_: unknown, __: unknown, index: number) => (
        <span className="font-mono text-xs text-ink-3">{indexOf(index)}</span>
      ),
    },
    {
      title: 'วันที่',
      key: 'date',
      dataIndex: 'date',
      width: 110,
      render: (date: string | null) => toThaiDate(date),
    },
    {
      title: 'HN',
      key: 'hn',
      dataIndex: 'hn',
      width: 100,
      render: (hn: string) => <span className="font-mono text-xs">{hn}</span>,
    },
    { title: 'ชื่อ-สกุล', key: 'patientName', dataIndex: 'patientName', width: 200 },
    {
      title: 'เพศ',
      key: 'sex',
      dataIndex: 'sex',
      width: 70,
      render: (sex: string | null) => sexLabel(sex),
    },
    {
      title: 'อายุ',
      key: 'age',
      dataIndex: 'ageYears',
      width: 70,
      align: 'right',
      className: 'qty',
      render: (age: number | null) => (age == null ? '—' : `${age}`),
    },
    {
      title: 'ชื่อสามัญที่ได้รับพร้อมกัน',
      key: 'generics',
      dataIndex: 'generics',
      width: 250,
      /* ชื่อสามัญมาก่อนชื่อรายการยา เพราะชื่อรายการยาในบัญชีมีชื่อการค้ากับชื่อ
         บริษัทปนจนอ่านทีเดียวไม่ออกว่าซ้ำตรงไหน */
      render: (names: string[]) => (
        <span className="flex flex-wrap gap-1">
          {names.map(name => (
            <Tag color="red" key={name} className="mr-0! text-[11px]">
              {name}
            </Tag>
          ))}
        </span>
      ),
    },
    {
      title: 'ห้องตรวจ',
      key: 'department',
      dataIndex: 'department',
      width: 170,
      render: (name: string | null) =>
        name ?? (
          <Text type="secondary" className="text-xs">
            —
          </Text>
        ),
    },
    {
      title: 'แพทย์ผู้ตรวจ',
      key: 'doctor',
      dataIndex: 'doctor',
      width: 160,
      render: (name: string | null) =>
        name ?? (
          <Text type="secondary" className="text-xs">
            —
          </Text>
        ),
    },
    {
      title: 'รายการยา จำนวน และวิธีใช้',
      key: 'lines',
      dataIndex: 'lines',
      render: (lines: DuplicateDrugLine[]) => <DrugLines lines={lines} />,
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

  const patientColumns: ColumnsType<DuplicatePatientCase> = [
    {
      title: 'ลำดับ',
      key: 'index',
      width: 70,
      align: 'center',
      render: (_: unknown, __: unknown, index: number) => (
        <span className="font-mono text-xs text-ink-3">{indexOf(index)}</span>
      ),
    },
    {
      title: 'HN',
      key: 'hn',
      dataIndex: 'hn',
      width: 100,
      render: (hn: string) => <span className="font-mono text-xs">{hn}</span>,
    },
    { title: 'ชื่อ-สกุล', key: 'patientName', dataIndex: 'patientName', width: 200 },
    {
      title: 'เพศ',
      key: 'sex',
      dataIndex: 'sex',
      width: 70,
      render: (sex: string | null) => sexLabel(sex),
    },
    {
      title: 'อายุ',
      key: 'age',
      dataIndex: 'ageYears',
      width: 70,
      align: 'right',
      className: 'qty',
      render: (age: number | null) => (age == null ? '—' : `${age}`),
    },
    /* คอลัมน์หลักของกฎที่นับยาตัวเดิมซ้ำ — คำถามคือ "ยาตัวไหนที่ได้ซ้ำ"
       ไม่ใช่ "ซ้ำกี่ชนิด" ซึ่งเป็นคำตอบของกฎยาต่างตัว กฎนั้นจึงไม่มีคอลัมน์นี้
       (ค่าจะว่างทุกแถวอยู่แล้ว เพราะไม่มีคู่ที่หน่วยเดียวกันถูกนับ) */
    ...(report?.pairRule === 'different'
      ? []
      : [
          {
            title: 'ยาตัวเดิมที่ได้ซ้ำ',
            key: 'repeated',
            dataIndex: 'repeatedUnits',
            width: 230,
            render: (names: string[]) =>
              names.length === 0 ? (
                <Text type="secondary" className="text-xs">
                  —
                </Text>
              ) : (
                <span className="flex flex-wrap gap-1">
                  {names.map(name => (
                    <Tag color="volcano" key={name} className="mr-0! text-[11px]">
                      {name}
                    </Tag>
                  ))}
                </span>
              ),
          },
        ]),
    {
      title: 'จำนวนที่ซ้ำ',
      key: 'units',
      dataIndex: 'units',
      width: 110,
      align: 'right',
      className: 'qty',
    },
    {
      /* เรียงมาจากฐานโดยเอาคู่ที่ห่างกันน้อยสุดขึ้นก่อน — คู่ที่ได้ยาห่างกันไม่กี่วัน
         คือเคสที่น่าจะเป็นการสั่งซ้ำจริง ส่วนคู่ที่ห่างเกือบสามเดือนมักเป็นการเปลี่ยนยา */
      title: 'ห่างกันน้อยสุด',
      key: 'gap',
      dataIndex: 'closestGapDays',
      width: 130,
      align: 'right',
      className: 'qty',
      render: (days: number) => (days === 0 ? 'วันเดียวกัน' : `${days} วัน`),
    },
    {
      title: 'ครั้งที่เกี่ยวข้อง',
      key: 'events',
      render: (_, row) => (
        <span className="text-xs text-ink-3">
          {row.events.length} ครั้ง · {toThaiDate(row.events[0]?.date ?? null)} ถึง{' '}
          {toThaiDate(row.events[row.events.length - 1]?.date ?? null)} — กดเพื่อดูรายการ
        </span>
      ),
    },
  ]

  const summary =
    report == null
      ? null
      : report.scope === 'across'
        ? report.counts[report.unit].across[report.pairRule]
        : report.counts[report.unit].visit

  return (
    <>
      {toastHolder}

      <section className="mb-6">
        <Breadcrumb
          className="mb-2"
          items={[
            { title: <Link href="/home/rdu">RDU ติดตามตัวชี้วัดการใช้ยา</Link> },
            { title: 'ค้นหาการใช้ยาซ้ำซ้อน' },
          ]}
        />
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          ค้นหาการใช้ยาซ้ำซ้อน
          <PageHint>
            เลือกชุดยาที่ต้องการตรวจเอง แล้วหาผู้ป่วยนอกที่ได้รับซ้ำซ้อน — ภายในครั้งเดียวกัน
            หรือข้ามครั้งภายในจำนวนวันที่กำหนดเอง · <b>ไม่ใช่ตัวชี้วัด</b> จึงไม่มีเกณฑ์และไม่ตัดสิน
            ผ่าน/ไม่ผ่าน ต่างจากรายงานอื่นในหมวดนี้ที่ผูกกับทะเบียนยาซึ่งตกลงกันไว้แล้ว
          </PageHint>
        </Title>
        <div className="h-px w-24 bg-linear-to-r from-violet-400/70 to-transparent" />
      </section>

      <section className="mb-4 rounded-2xl border border-line bg-panel p-4 backdrop-blur">
        {loadingDrugs ? (
          <Spin />
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <div className="mb-1.5 text-xs font-semibold text-ink">
                เลือกด้วยชื่อสามัญ — ได้ครบทุกรหัสของชื่อนั้น
                <PageHint tone="warning" title="ผลลัพธ์ถูกหรือไม่ ขึ้นกับชุดยาที่เลือก">
                  <div>
                    เครื่องมือนี้ไม่รู้ว่ายาตัวไหนออกฤทธิ์ซ้ำทางกัน — <b>ชุดยาที่เลือกคือคำนิยาม</b>{' '}
                    ถ้าเลือกยาที่ซ้ำทางกันจริง (เช่น PPI ทุกตัว) ผลที่ได้คือการใช้ยาซ้ำซ้อน
                    แต่ถ้าเลือกยาที่ใช้ร่วมกันได้ตามปกติปนมา (เช่น พาราเซตามอลกับ NSAID)
                    ผลที่ได้คือการสั่งยาร่วมกันตามปกติ ไม่ใช่ความผิดพลาด วัดแล้วชุดแบบนั้น
                    ให้ผลเกือบสี่หมื่นครั้งต่อปีงบ ซึ่งไม่มีความหมายอะไร
                  </div>
                  <div className="mt-1.5">
                    ฐานข้อมูล HIS <b>ไม่มีคอลัมน์กลุ่มยาที่ใช้ได้</b> จึงจัดกลุ่มให้อัตโนมัติไม่ได้ —
                    drugcategory ว่าง 1,056 จาก 1,092 รายการ และ hintcode ที่เติมครบทุกแถวเอา 592
                    รายการมารวมเป็นรหัสเดียว (มีตั้งแต่ยาต้านไวรัสถึงวัคซีน) ไม่ใช่กลุ่มการรักษา
                  </div>
                  <div className="mt-1.5">
                    นับเฉพาะ<b>ผู้ป่วยนอก</b>ที่ได้รับยาจริง (จ่ายออกจากห้องยาแล้ว) เหมือนรายงาน
                    อื่นในหมวดนี้ · ตัวหารคือครั้งหรือคนที่ได้รับยาในชุดนี้อย่างน้อยหนึ่งรายการ
                    ไม่ใช่ผู้ป่วยนอกทั้งโรงพยาบาล
                  </div>
                </PageHint>
              </div>
              <Select<string[]>
                mode="multiple"
                allowClear
                showSearch
                value={generics}
                onChange={setGenerics}
                options={genericOptions}
                placeholder="พิมพ์ค้นชื่อสามัญ เลือกได้หลายชื่อ"
                maxTagCount="responsive"
                className="w-full"
                size="large"
              />
            </div>

            <div>
              <div className="mb-1.5 text-xs font-semibold text-ink">
                หรือเลือกเฉพาะรายการยา — ใช้เมื่อต้องการแค่บางรหัสของชื่อสามัญนั้น
              </div>
              <Select<string[]>
                mode="multiple"
                allowClear
                showSearch
                value={icodes}
                onChange={setIcodes}
                options={itemOptions}
                placeholder="พิมพ์ค้นชื่อยา ชื่อสามัญ หรือรหัส"
                maxTagCount="responsive"
                className="w-full"
                size="large"
                optionRender={option => (
                  <span className="text-xs">
                    <span className="font-mono text-ink-3">{option.value}</span> {option.label}
                    {option.data.generic !== '' && (
                      <span className="mt-0.5 block text-[11px] text-ink-3">
                        {option.data.generic}
                        {option.data.strength !== '' && ` — ${option.data.strength}`}
                      </span>
                    )}
                  </span>
                )}
                // ค้นได้ทั้งชื่อยา ชื่อสามัญ และรหัส — เภสัชกรบางคนจำรหัสยาที่ใช้ประจำได้
                // ขึ้นใจ ส่วนค่าตั้งต้นของ Select ค้นจาก label อย่างเดียวซึ่งคือชื่อยา
                //
                // อ่านชื่อสามัญจาก option.generic ตรง ๆ ไม่ใช่ option.data.generic —
                // สอง prop นี้รับรูปข้อมูลไม่เหมือนกัน optionRender ด้านบนได้
                // FlattenOptionData ซึ่งห่อตัวเลือกไว้ใน .data แต่ filterOption ได้
                // ตัวเลือกมาตรง ๆ ไม่มีชั้น .data ให้ ถ้าเขียนผิดจะพังตอนพิมพ์ค้นเท่านั้น
                // และ TypeScript จับไม่ได้เพราะชนิดของตัวเลือกมี index signature
                // ทำให้ option.data กลายเป็น any
                filterOption={(input, option) => {
                  const text = input.trim().toLowerCase()
                  if (text === '' || option == null) return true
                  return (
                    String(option.label ?? '').toLowerCase().includes(text) ||
                    String(option.value ?? '').toLowerCase().includes(text) ||
                    String(option.generic ?? '').toLowerCase().includes(text)
                  )
                }}
              />
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <div className="mb-1.5 text-xs font-semibold text-ink">ช่วงวันที่</div>
                <RangePicker
                  value={range}
                  onChange={value => {
                    if (value?.[0] && value[1]) setRange([value[0], value[1]])
                  }}
                  allowClear={false}
                  format="DD/MM/BBBB"
                />
              </div>
              <div>
                <div className="mb-1.5 text-xs font-semibold text-ink">นับซ้ำที่ระดับ</div>
                <Segmented<DuplicateUnit>
                  title="หน่วยการนับ"
                  value={unit}
                  onChange={setUnit}
                  options={(['generic', 'item'] as DuplicateUnit[]).map(value => ({
                    label: UNIT_LABEL[value].short,
                    value,
                  }))}
                />
              </div>
              <div>
                <div className="mb-1.5 text-xs font-semibold text-ink">ขอบเขต</div>
                <Segmented<DuplicateScope>
                  title="ขอบเขตการนับ"
                  value={scope}
                  onChange={setScope}
                  options={(['visit', 'across'] as DuplicateScope[]).map(value => ({
                    label:
                      value === 'across'
                        ? `${SCOPE_LABEL.across} (${windowText(windowDays)})`
                        : SCOPE_LABEL.visit,
                    value,
                  }))}
                />
              </div>

              {/* ไม่ซ่อนตอนดูโหมด visit ทั้งที่โหมดนั้นไม่ใช้ค่านี้ — ช่องเทียบสี่แบบ
                  แสดงตัวเลขของโหมดข้าม visit อยู่ด้วยเสมอ ซึ่งคิดจากหน้าต่างนี้
                  ถ้าซ่อนไป คนอ่านจะไม่รู้ว่าเลขสองช่องนั้นมาจากหน้าต่างกว้างเท่าไร */}
              <div>
                <div className="mb-1.5 text-xs font-semibold text-ink">
                  หน้าต่างของโหมดข้าม visit
                </div>
{/* หน่วยใช้ suffix ไม่ใช่ addonAfter — antd v6 เลิกใช้ addonAfter แล้วและขึ้น
                    คำเตือนใน console ส่วน suffix ยังใช้ได้และเหมาะกับหน่วยนับมากกว่า
                    เพราะอยู่ในกรอบเดียวกับตัวเลข ไม่ใช่ช่องต่อท้ายแยกกรอบ */}
                <InputNumber
                  value={windowDays}
                  onChange={value => {
                    if (value == null) return
                    const days = Math.round(value)
                    setWindowDays(Math.min(Math.max(days, windowBounds.min), windowBounds.max))
                  }}
                  min={windowBounds.min}
                  max={windowBounds.max}
                  precision={0}
                  suffix="วัน"
                  style={{ width: 130 }}
                />
                <div className="mt-1 flex flex-wrap gap-1">
                  {WINDOW_PRESETS.filter(
                    days => days >= windowBounds.min && days <= windowBounds.max,
                  ).map(days => (
                    <Button
                      key={days}
                      size="small"
                      type={days === windowDays ? 'primary' : 'default'}
                      onClick={() => setWindowDays(days)}
                    >
                      {days === 0 ? 'วันเดียวกัน' : days}
                    </Button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-xs font-semibold text-ink">คู่ที่นับว่าซ้ำ</div>
                <Segmented<DuplicatePairRule>
                  title="กฎการจับคู่"
                  value={pairRule}
                  onChange={setPairRule}
                  options={(['different', 'same', 'any'] as DuplicatePairRule[]).map(value => ({
                    label: PAIR_LABEL[value].short,
                    value,
                  }))}
                />
              </div>
              <Button
                type="primary"
                icon={<SearchOutlined />}
                loading={loading}
                disabled={nothingPicked || overLimit}
                onClick={search}
              >
                ค้นหา
              </Button>
            </div>

            <Text type="secondary" className="text-[11px]">
              {nothingPicked ? (
                'ยังไม่ได้เลือกยา — เลือกด้วยชื่อสามัญหรือรายการยาอย่างน้อยหนึ่งอย่าง'
              ) : overLimit ? (
                <span className="text-rose-500">
                  ชุดนี้ขยายเป็น {resolvedIcodes} รหัส เกินเพดาน {maxIcodes} รหัสต่อการค้นหนึ่งครั้ง
                  — ชุดที่ใหญ่กว่านี้มักมียาที่ไม่ได้ออกฤทธิ์ซ้ำทางกันปนมา กรุณาลดจำนวนยา
                </span>
              ) : (
                <>
                  ชุดนี้ขยายเป็น {resolvedIcodes} รหัส (เพดาน {maxIcodes}) ·{' '}
                  {UNIT_LABEL[unit].long} · {scopeLong(scope, windowDays)}
                  {scope === 'across' && <> · {PAIR_LABEL[pairRule].long}</>}
                  {scope === 'across' && pairRule !== 'different' && windowDays > 14 && (
                    <>
                      {' '}
                      — <b>หน้าต่างกว้างกับกฎที่นับยาตัวเดิมซ้ำจะรวมการรับยาตามนัดเข้ามาด้วย</b>{' '}
                      วัดแล้วยาโรคเรื้อรังมีคู่ที่ห่างกัน 61-90 วันมากกว่าคู่ที่ห่างกันไม่เกิน
                      3 วันราว 58 เท่า ซึ่งเกือบทั้งหมดคือการมารับยาต่อเนื่อง ไม่ใช่ความผิดพลาด
                      — ถ้าต้องการเฉพาะเคสที่สั่งทับกันจริง ลองหน้าต่าง 7 วันหรือแคบกว่า
                    </>
                  )}
                  {scope === 'across' && windowDays >= rangeDays && (
                    <>
                      {' '}
                      — <b>หน้าต่างกว้างกว่าช่วงวันที่ที่เลือก ({rangeDays} วัน)</b> เท่ากับ
                      นับคู่ที่อยู่ในช่วงนี้ทั้งหมดโดยไม่จำกัดระยะห่าง
                    </>
                  )}
                </>
              )}
            </Text>
          </div>
        )}
      </section>

      {error !== '' && <Alert type="error" showIcon title={error} className="mb-4" />}

      {loading && report == null ? (
        <ReportSkeleton />
      ) : report == null ? (
        <Empty
          description={
            <span className="text-xs text-ink-3">เลือกชุดยาแล้วกดค้นหา เพื่อดูการใช้ยาซ้ำซ้อน</span>
          }
        />
      ) : (
        <Spin spinning={loading}>
          <section className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-line bg-panel p-4 backdrop-blur">
              <div className="text-xs text-ink-3">เคสที่พบ</div>
              <div className="mt-1 text-2xl font-semibold text-ink">
                {(summary ?? 0).toLocaleString('th-TH')}
              </div>
              <div className="mt-1 text-[11px] text-ink-3">
                {report.scope === 'across' ? 'คน' : 'ครั้ง'} · นับที่ระดับ
                {UNIT_LABEL[report.unit].short}
                {report.scope === 'across' &&
                  ` · หน้าต่าง ${windowText(report.windowDays)} · ${PAIR_LABEL[report.pairRule].short}`}
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-panel p-4 backdrop-blur">
              <div className="text-xs text-ink-3">
                ตัวหาร — {report.scope === 'across' ? 'ผู้ป่วย' : 'ครั้ง'}ที่ได้รับยาในชุดนี้
              </div>
              <div className="mt-1 text-2xl font-semibold text-ink">
                {(report.scope === 'across'
                  ? report.totalPatients
                  : report.totalVisits
                ).toLocaleString('th-TH')}
              </div>
              <div className="mt-1 text-[11px] text-ink-3">
                {(report.scope === 'across' ? report.totalPatients : report.totalVisits) > 0
                  ? `คิดเป็น ${(
                      ((summary ?? 0) /
                        (report.scope === 'across' ? report.totalPatients : report.totalVisits)) *
                      100
                    ).toFixed(2)}%`
                  : '—'}
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-panel p-4 backdrop-blur">
              <div className="text-xs text-ink-3">ชุดยาที่ค้น</div>
              <div className="mt-1 text-2xl font-semibold text-ink">{report.icodes.length}</div>
              <div className="mt-1 text-[11px] text-ink-3">
                รหัส · {report.genericsInScope.length} ชื่อสามัญ ·{' '}
                {report.eventRows.toLocaleString('th-TH')} บรรทัดยา
              </div>
            </div>
            {/* ตารางเทียบสี่แบบ — คิดมาจากข้อมูลชุดเดียวกันที่อ่านมาแล้ว ไม่ได้ยิงฐานเพิ่ม
                มีไว้เพราะการเลือกหน่วยการนับผิดทำให้ตัวเลขต่างกันเป็นร้อยเท่า
                ถ้าไม่เห็นอีกสามแบบ คนอ่านไม่มีทางรู้ว่ากำลังดูแบบที่แคบหรือกว้าง */}
            <div className="rounded-2xl border border-line bg-panel p-4 backdrop-blur">
              <div className="mb-1.5 text-xs text-ink-3">
                เทียบทุกแบบในชุดนี้ — ข้าม visit ใช้หน้าต่าง {windowText(report.windowDays)}
              </div>
              <table className="w-full text-[11px]">
                <tbody>
                  {(['generic', 'item'] as DuplicateUnit[]).map(u => (
                    <tr key={u}>
                      <td className="pr-2 text-ink-3">{UNIT_LABEL[u].short}</td>
                      <td className="pr-2 text-right">
                        <span
                          className={
                            u === report.unit && report.scope === 'visit'
                              ? 'font-semibold text-ink'
                              : 'text-ink-3'
                          }
                        >
                          {report.counts[u].visit.toLocaleString('th-TH')}
                        </span>
                      </td>
                      {(['different', 'same', 'any'] as DuplicatePairRule[]).map(rule => (
                        <td key={rule} className="pr-2 text-right">
                          <span
                            className={
                              u === report.unit &&
                              report.scope === 'across' &&
                              rule === report.pairRule
                                ? 'font-semibold text-ink'
                                : 'text-ink-3'
                            }
                          >
                            {report.counts[u].across[rule].toLocaleString('th-TH')}
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <td />
                    <td className="pr-2 text-right text-[10px] text-ink-3">ใน visit</td>
                    <td className="pr-2 text-right text-[10px] text-ink-3">ต่างตัว</td>
                    <td className="pr-2 text-right text-[10px] text-ink-3">ตัวเดิมซ้ำ</td>
                    <td className="pr-2 text-right text-[10px] text-ink-3">ทั้งสอง</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {report.truncated && (
            <Alert
              type="info"
              showIcon
              className="mb-4"
              title="แสดงไม่ครบทุกเคส"
              description={
                <span className="text-xs">
                  เคสเกินเพดานที่ส่งกลับได้ครั้งละ 2,000 รายการ — ตัวเลขบนการ์ดยังเป็นยอดเต็ม
                  ของทั้งช่วง กรุณาแคบช่วงวันที่ถ้าต้องการรายชื่อให้ครบ
                </span>
              }
            />
          )}

          <section className="rounded-2xl border border-line bg-panel p-4 backdrop-blur">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-ink">
                {report.scope === 'across'
                  ? `${SCOPE_LABEL.across} (${windowText(report.windowDays)} · ${PAIR_LABEL[report.pairRule].short})`
                  : SCOPE_LABEL.visit}{' '}
                · นับที่ระดับ{UNIT_LABEL[report.unit].short}
                <span className="ml-2 text-xs font-normal text-ink-3">
                  {shownCount.toLocaleString('th-TH')} รายการ
                </span>
              </div>
              <Space wrap>
                <RowSearch
                  value={keyword}
                  onChange={setKeyword}
                  placeholder="ค้น HN ชื่อ แผนก หรือชื่อยา"
                />
                <Button
                  icon={<FileExcelOutlined />}
                  onClick={exportCsv}
                  disabled={shownCount === 0}
                >
                  ส่งออก CSV
                </Button>
              </Space>
            </div>

            {shownCount === 0 ? (
              <Empty
                description={
                  <span className="text-xs text-ink-3">
                    ไม่พบการใช้ยาซ้ำซ้อนในชุดยาและช่วงวันที่นี้
                  </span>
                }
              />
            ) : report.scope === 'across' ? (
              <Table<DuplicatePatientCase>
                size="small"
                rowKey="hn"
                dataSource={patientRows}
                columns={patientColumns}
                scroll={{ x: 'max-content' }}
                pagination={{
                  pageSize: PAGE_SIZE,
                  current: currentPage,
                  onChange: setPage,
                  showSizeChanger: false,
                }}
                /* รายละเอียดอยู่ในแถวที่กางออก ไม่ได้เปิดเป็นหน้าต่าง — โหมดนี้แถวหนึ่ง
                   คือคนหนึ่งที่มาหลายครั้ง สิ่งที่ต้องดูคือลำดับเวลาของหลายครั้งพร้อมกัน
                   ซึ่งหน้าต่างรายละเอียดของครั้งเดียวตอบไม่ได้ */
                expandable={{
                  expandedRowRender: row => (
                    <div className="flex flex-col gap-1.5 py-1">
                      {row.events.map(event => (
                        <div key={event.vn} className="text-xs">
                          <span className="font-mono text-ink-3">{toThaiDate(event.date)}</span>{' '}
                          <span className="text-ink">{event.department ?? '—'}</span>
                          {event.doctor != null && (
                            <span className="text-ink-3"> · {event.doctor}</span>
                          )}
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            {event.generics.map(name => (
                              <Tag color="red" key={name} className="mr-0! text-[11px]">
                                {name}
                              </Tag>
                            ))}
                          </div>
                          <div className="mt-0.5">
                            <DrugLines lines={event.lines} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ),
                }}
              />
            ) : (
              <Table<DuplicateVisitCase>
                size="small"
                rowKey="vn"
                dataSource={visitRows}
                columns={visitColumns}
                scroll={{ x: 'max-content' }}
                pagination={{
                  pageSize: PAGE_SIZE,
                  current: currentPage,
                  onChange: setPage,
                  showSizeChanger: false,
                }}
              />
            )}
          </section>
        </Spin>
      )}

      <VisitDetailModal
        open={picked != null}
        onClose={() => setPicked(null)}
        hn={picked?.hn ?? null}
        vn={picked?.vn ?? null}
        patientName={picked?.patientName ?? null}
        drugIcodes={report?.icodes ?? []}
        drugLabel="ยาในชุดที่ค้น"
      />
    </>
  )
}
