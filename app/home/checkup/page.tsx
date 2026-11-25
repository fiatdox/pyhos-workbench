'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
import { withBase } from '@/lib/base-path'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  DatePicker,
  Empty,
  Input,
  Modal,
  Select,
  Spin,
  Table,
  Tabs,
  Tooltip,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  DownloadOutlined,
  EyeOutlined,
  FileExcelOutlined,
  PrinterOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import buddhistEra from 'dayjs/plugin/buddhistEra'
import { apiFetch } from '@/lib/client/session'
import { trackExport } from '@/lib/client/track-export'
import type {
  CheckupReport,
  CheckupRight,
  CheckupRightSummary,
  CheckupVisit,
} from '@/lib/his/checkup'
import RowSearch, { matchesRow } from '@/app/home/rdu/reports/row-search'
import VisitDetailModal from '@/app/home/rdu/reports/visit-modal'
import PageHint from '@/app/home/page-hint'
import { ReportSkeleton } from '@/app/home/skeletons'

/** ใบรายงานผลการตรวจสุขภาพ (PDF ที่เซิร์ฟเวอร์สร้าง) ของครั้งที่มาหนึ่งครั้ง */
const sheetUrl = (row: { hn: string; vn: string }, download = false) =>
  withBase(`/api/his/checkup/sheet?hn=${encodeURIComponent(row.hn)}&vn=${encodeURIComponent(row.vn)}${
    download ? '&download=1' : ''
  }`)

// เปิด token BBBB (ปี พ.ศ.) ให้ dayjs — ถ้าไม่ extend ปฏิทินจะพิมพ์คำว่า BBBB ออกมาตรง ๆ
dayjs.extend(buddhistEra)

const { Title, Text } = Typography
const { RangePicker } = DatePicker

/**
 * งานตรวจสุขภาพ — เลือกสิทธิกับช่วงวันที่ แล้วได้รายชื่อ
 *
 * ตั้งต้นเลือก 18 สิทธิที่ชื่อมีคำว่า "ตรวจสุขภาพ" ไว้ให้ แต่เลือกสิทธิอื่นได้
 * ทั้งหมด — งานตรวจสุขภาพจริงไม่ได้ใช้แต่สิทธิที่ชื่อตรงคำ กลุ่มใหญ่สุดของ
 * ศูนย์ตรวจสุขภาพใช้สิทธิ "ชำระเงิน" คือคนจ่ายเงินมาตรวจเอง (เหตุผลและตัวเลข
 * อยู่ใน lib/his/checkup.ts)
 *
 * ใช้ส่วนประกอบร่วมของหมวด RDU (ช่องค้นในตาราง และหน้าต่างรายละเอียดการมารับบริการ)
 * ทั้งสองตัวไม่ผูกกับตัวชี้วัดใด ๆ รับแค่ hn/vn แล้วแสดงผล — ย้ายออกมาเป็นโฟลเดอร์
 * กลางจะต้องแก้ไฟล์ที่ import อยู่กว่าสิบห้าไฟล์ ซึ่งไม่ได้ทำให้อะไรดีขึ้น
 */

/** แปลง 'YYYY-MM-DD' เป็น วว/ดด/ปปปป พ.ศ. */
function toThaiDate(value: string | null): string {
  if (!value) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return value
  const [, year, month, day] = match
  return `${day}/${month}/${Number(year) + 543}`
}

/* เพศมาเป็นคำอ่านได้จากตาราง sex ของ HIS แล้ว หน้าจอไม่ได้แปลรหัสเอง — ถ้าแปลเอง
   แล้ววันหนึ่งโรงพยาบาลเพิ่มรหัสเพศใหม่ หน้าจอจะขึ้นขีดโดยไม่มีใครรู้ว่าฐานมีค่าอยู่ */
const sexLabel = (sex: string | null) => sex ?? '—'

/** ค่าเริ่มต้น: ย้อนหลัง 30 วันถึงวันนี้ — เท่ากับรายงานอื่นของระบบ */
const DEFAULT_RANGE: [Dayjs, Dayjs] = [dayjs().subtract(30, 'day'), dayjs()]

const PAGE_SIZE = 50

/** ใส่ BOM เพราะ Excel บนวินโดวส์เดาว่า CSV เป็น CP874 */
function toCsv(rows: string[][]): string {
  const cell = (value: string) => `"${value.replace(/"/g, '""')}"`
  return '﻿' + rows.map(row => row.map(cell).join(',')).join('\r\n')
}

type ListResponse = {
  success: boolean
  message?: string
  rights?: CheckupRight[]
  maxRangeDays?: number
  minKeyword?: number
}

export default function CheckupPage() {
  const [toast, toastHolder] = message.useMessage()

  const [loadingRights, setLoadingRights] = useState(true)
  const [rights, setRights] = useState<CheckupRight[]>([])
  const [maxRangeDays, setMaxRangeDays] = useState(366)
  const [minKeyword, setMinKeyword] = useState(2)

  const [range, setRange] = useState<[Dayjs, Dayjs]>(DEFAULT_RANGE)
  const [pttypes, setPttypes] = useState<string[]>([])
  /**
   * HN หรือชื่อ-สกุล สำหรับค้นในฐาน
   *
   * ต่างจากช่องค้นในตารางด้านล่าง ซึ่งกรองเฉพาะแถวที่โหลดมาแล้ว — ช่องนี้ถามฐาน
   * ใหม่และ**ค้นทุกช่วงเวลา** ไม่ใช้ช่วงวันที่ เพราะคนที่ถือ HN หรือชื่อมาคนหนึ่ง
   * มักไม่รู้ว่าคนนั้นมาตรวจวันไหน ถ้าบังคับให้เลือกช่วงวันที่ให้ถูกก่อนก็ไม่ได้
   * ช่วยอะไร
   */
  const [keyword, setKeyword] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [report, setReport] = useState<CheckupReport | null>(null)
  /** คำกรองของช่องค้นในตาราง — กรองแถวที่โหลดมาแล้วในเบราว์เซอร์ ไม่ได้ถามฐาน */
  const [rowFilter, setRowFilter] = useState('')
  /** แท็บที่เปิดอยู่ — รายชื่อเป็นค่าตั้งต้น เพราะเป็นสิ่งที่คนเข้ามาหา */
  const [tab, setTab] = useState<'list' | 'stats'>('list')
  const [currentPage, setCurrentPage] = useState(1)
  const [openVisit, setOpenVisit] = useState<{ hn: string; vn: string } | null>(null)
  /** vn ของแถวที่ติ๊กไว้ — ใช้เลือกว่าจะส่งออกเฉพาะบางรายการ */
  const [picked, setPicked] = useState<string[]>([])

  /** ใบตรวจสุขภาพที่กำลังเปิดดู — เก็บแถวไว้ใช้ทำหัวหน้าต่าง (HN และชื่อ) */
  const [sheetRow, setSheetRow] = useState<CheckupVisit | null>(null)
  /** PDF ยังโหลดไม่เสร็จ — สร้างที่เซิร์ฟเวอร์ใช้เวลาราวหนึ่งวินาที */
  const [sheetLoading, setSheetLoading] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const response = await apiFetch('/api/his/checkup', { cache: 'no-store' })
        const data = (await response.json()) as ListResponse
        if (!alive) return
        if (!data.success) {
          setError(data.message ?? 'อ่านรายการสิทธิไม่สำเร็จ')
          return
        }
        const list = data.rights ?? []
        setRights(list)
        if (data.maxRangeDays != null) setMaxRangeDays(data.maxRangeDays)
        if (data.minKeyword != null) setMinKeyword(data.minKeyword)
        /* เลือกสิทธิที่ชื่อมีคำว่าตรวจสุขภาพไว้ให้ตั้งต้น — เป็นชุดที่ตอบคำถาม
           ของหน้านี้ได้ทันทีโดยไม่ต้องเลือกเอง และยังเปลี่ยนได้ทั้งหมด */
        setPttypes(list.filter(right => right.checkupNamed).map(right => right.code))
      } catch {
        if (alive) setError('อ่านรายการสิทธิไม่สำเร็จ')
      } finally {
        if (alive) setLoadingRights(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  /** ตัวเลือกสิทธิ — สิทธิที่ชื่อมีคำว่า "ตรวจสุขภาพ" ขึ้นก่อน แต่ไม่ได้ตัดอันอื่นออก */
  const rightOptions = useMemo(
    () =>
      [...rights]
        .sort(
          (a, b) => Number(b.checkupNamed) - Number(a.checkupNamed) || a.name.localeCompare(b.name),
        )
        .map(right => ({ value: right.code, label: `${right.code} · ${right.name}` })),
    [rights],
  )

  const checkupNamedCodes = useMemo(
    () => rights.filter(right => right.checkupNamed).map(right => right.code),
    [rights],
  )

  const rangeDays = range[1].diff(range[0], 'day') + 1
  const trimmedKeyword = keyword.trim()
  const searchingByKeyword = trimmedKeyword !== ''
  /* เพดานช่วงวันที่ไม่เกี่ยวกับโหมดคำค้น เพราะโหมดนั้นค้นทุกช่วงเวลา — ถ้ายัง
     กันปุ่มไว้ คนที่ลากช่วงวันที่กว้างไว้ก่อนจะกดค้นด้วย HN ไม่ได้ทั้งที่ช่วง
     วันที่ไม่ได้ถูกใช้ */
  const overRange = !searchingByKeyword && rangeDays > maxRangeDays
  const shortKeyword = searchingByKeyword && trimmedKeyword.length < minKeyword
  const noRight = pttypes.length === 0

  const search = useCallback(async () => {
    if (noRight || overRange || shortKeyword) return
    setLoading(true)
    setError('')
    try {
      const response = await apiFetch('/api/his/checkup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          from: range[0].format('YYYY-MM-DD'),
          to: range[1].format('YYYY-MM-DD'),
          pttypes,
          keyword: trimmedKeyword,
        }),
      })
      const data = (await response.json()) as { success: boolean; message?: string }
      if (!data.success) {
        setError(data.message ?? 'ค้นรายงานไม่สำเร็จ')
        setReport(null)
        return
      }
      setReport(data as unknown as CheckupReport)
      setCurrentPage(1)
      // ล้างที่ติ๊กไว้ทุกครั้งที่ค้นใหม่ — vn ชุดเดิมไม่เกี่ยวกับผลชุดใหม่แล้ว
      // ถ้าปล่อยค้างไว้ จำนวนที่เลือกจะนับแถวที่ไม่มีอยู่ในตารางอีกต่อไป
      setPicked([])
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [noRight, overRange, shortKeyword, range, pttypes, trimmedKeyword])

  const visitRows = useMemo(() => {
    if (report == null) return []
    return report.visits.filter(row =>
      matchesRow(
        [row.hn, row.vn, row.patientName, row.pttype, row.pttypeName, row.department, row.doctor],
        rowFilter,
      ),
    )
  }, [report, rowFilter])

  const indexOf = (index: number) => (currentPage - 1) * PAGE_SIZE + index + 1

  /**
   * แถวที่จะส่งออก — ที่ติ๊กไว้ ถ้าไม่ได้ติ๊กอะไรเลยคือทั้งหมดที่เห็นอยู่
   *
   * กรองด้วย visitRows ไม่ใช่ picked ตรง ๆ เพื่อรักษาลำดับของตาราง และกันกรณีที่
   * ติ๊กไว้แล้วไปพิมพ์ค้นต่อ — แถวที่ติ๊กไว้แต่ถูกคำค้นกรองออกจะไม่หลุดเข้าไฟล์
   * ทั้งที่คนใช้มองไม่เห็นมันอยู่บนจอแล้ว
   */
  const pickedKeys = useMemo(() => new Set(picked), [picked])
  const exportRows = useMemo(
    () => (picked.length === 0 ? visitRows : visitRows.filter(row => pickedKeys.has(row.vn))),
    [picked.length, pickedKeys, visitRows],
  )

  /**
   * เปิดใบตรวจสุขภาพของแถวนั้น
   *
   * ตัวใบเป็น PDF ที่ /api/his/checkup/sheet สร้างที่เซิร์ฟเวอร์ (หน้าตาตามต้นแบบของ
   * pyhosweb) หน้าต่างนี้แค่เปิดใน iframe — ปลายทางนั้นผูก hn ไว้ในทุกคิวรี เดา vn
   * ของคนอื่นแล้วเปิดดูข้ามคนไม่ได้ และ proxy บันทึกร่องรอยการเปิดดูให้จาก hn
   */
  const openSheet = useCallback((row: CheckupVisit) => {
    setSheetRow(row)
    setSheetLoading(true)
  }, [])

  function exportCsv() {
    if (report == null || exportRows.length === 0) return
    const header = [
      'ลำดับ',
      'วันที่',
      'VN',
      'HN',
      'ชื่อ-สกุล',
      'เพศ',
      'อายุ',
      'รหัสสิทธิ',
      'ชื่อสิทธิ',
      'ห้องตรวจ',
      'แพทย์ผู้ตรวจ',
    ]
    const body = exportRows.map((row, index) => [
      String(index + 1),
      toThaiDate(row.date),
      // นำหน้าด้วย ' กัน Excel อ่าน VN/HN เป็นตัวเลขแล้วตัดศูนย์หน้าทิ้ง
      `'${row.vn}`,
      `'${row.hn}`,
      row.patientName,
      sexLabel(row.sex),
      row.ageYears == null ? '' : String(row.ageYears),
      row.pttype ?? '',
      row.pttypeName ?? '',
      row.department ?? '',
      row.doctor ?? '',
    ])

    const blob = new Blob([toCsv([header, ...body])], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `ตรวจสุขภาพ-${range[0].format('YYYY-MM-DD')}-ถึง-${range[1].format('YYYY-MM-DD')}.csv`
    link.click()
    // แจ้งเซิร์ฟเวอร์ว่าข้อมูลชุดนี้ถูกนำออกจากระบบ — ไฟล์สร้างในเบราว์เซอร์
    // จึงไม่มีคำขอไหนวิ่งไปให้ proxy ดักได้เอง
    trackExport({ label: link.download, rows: body.length })
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success(`ส่งออก ${body.length} รายการแล้ว`)
  }

  const visitColumns: ColumnsType<CheckupVisit> = [
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
      render: (date: string | null) => <span className="text-xs">{toThaiDate(date)}</span>,
    },
    {
      title: 'HN',
      key: 'hn',
      dataIndex: 'hn',
      width: 110,
      render: (hn: string) => <span className="font-mono text-xs">{hn}</span>,
    },
    {
      title: 'ชื่อ-สกุล',
      key: 'patientName',
      dataIndex: 'patientName',
      render: (name: string) => <span className="text-xs">{name}</span>,
    },
    {
      title: 'เพศ',
      key: 'sex',
      dataIndex: 'sex',
      width: 70,
      align: 'center',
      render: (sex: string | null) => <span className="text-xs">{sexLabel(sex)}</span>,
    },
    {
      title: 'อายุ',
      key: 'ageYears',
      dataIndex: 'ageYears',
      width: 70,
      align: 'right',
      className: 'qty',
      render: (age: number | null) => (age == null ? '—' : age),
    },
    {
      title: 'สิทธิการรักษา',
      key: 'pttypeName',
      render: (_, row) => (
        <span className="text-xs">
          {row.pttype != null && <span className="font-mono text-ink-3">{row.pttype} </span>}
          {row.pttypeName ?? 'ไม่ระบุสิทธิ'}
        </span>
      ),
    },
    {
      title: 'ห้องตรวจ',
      key: 'department',
      dataIndex: 'department',
      render: (name: string | null) => <span className="text-xs">{name ?? '—'}</span>,
    },
    {
      title: 'แพทย์ผู้ตรวจ',
      key: 'doctor',
      dataIndex: 'doctor',
      render: (name: string | null) => <span className="text-xs">{name ?? '—'}</span>,
    },
    {
      title: '',
      key: 'open',
      width: 92,
      align: 'center',
      render: (_, row) => (
        <>
          <Tooltip title="ดูรายละเอียดการมารับบริการ">
            <Button
              type="text"
              size="small"
              icon={<EyeOutlined />}
              onClick={() => setOpenVisit({ hn: row.hn, vn: row.vn })}
            />
          </Tooltip>
          <Tooltip title="พิมพ์ใบตรวจสุขภาพ">
            <Button
              type="text"
              size="small"
              icon={<PrinterOutlined />}
              onClick={() => openSheet(row)}
            />
          </Tooltip>
        </>
      ),
    },
  ]

  const rightColumns: ColumnsType<CheckupRightSummary> = [
    {
      title: 'รหัส',
      key: 'pttype',
      dataIndex: 'pttype',
      width: 80,
      render: (code: string | null) => <span className="font-mono text-xs">{code ?? '—'}</span>,
    },
    {
      title: 'ชื่อสิทธิ',
      key: 'name',
      dataIndex: 'name',
      render: (name: string) => <span className="text-xs">{name}</span>,
    },
    {
      title: 'ครั้ง',
      key: 'visits',
      dataIndex: 'visits',
      width: 100,
      align: 'right',
      className: 'qty',
      render: (visits: number) => visits.toLocaleString('th-TH'),
    },
    {
      title: 'คน',
      key: 'patients',
      dataIndex: 'patients',
      width: 100,
      align: 'right',
      className: 'qty',
      render: (patients: number) => patients.toLocaleString('th-TH'),
    },
  ]

  return (
    <>
      {toastHolder}

      <section className="mb-6">
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          ตรวจสุขภาพ
          <PageHint>
            เลือกสิทธิการรักษากับช่วงวันที่ แล้วได้รายชื่อผู้ที่มารับบริการด้วยสิทธินั้น ·
            ตั้งต้นเลือกสิทธิที่ชื่อมีคำว่า &ldquo;ตรวจสุขภาพ&rdquo; ไว้ให้ เปลี่ยนได้ทั้งหมด ·
            นับเฉพาะผู้ป่วยนอก
          </PageHint>
        </Title>
        <div className="title-rule" />
      </section>

      <section className="mb-4 rounded-2xl border border-line bg-panel p-4">
        {loadingRights ? (
          <Spin />
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <div className="mb-1.5 text-xs font-semibold text-ink">
                สิทธิการรักษา
                <PageHint tone="warning" title="สิทธิที่เลือกคือคำนิยามของรายงาน">
                  <div>
                    รายงานนี้คืน<b>ทุกครั้งที่ใช้สิทธิที่เลือก</b>ในช่วงวันที่ที่เลือก
                    ไม่มีเงื่อนไขอื่นซ่อนอยู่ ถ้าเลือกสิทธิที่ใช้กับงานอื่นด้วย
                    ผลที่ได้จะมีงานนั้นปนมา
                  </div>
                  <div className="mt-1.5">
                    งานตรวจสุขภาพจริง<b>ไม่ได้ใช้แต่สิทธิที่ชื่อตรงคำ</b> — วัดปีงบ 2569
                    ที่ศูนย์ตรวจสุขภาพ (Wellness Center) กลุ่มใหญ่สุด 3,370 จาก 6,449 ครั้ง
                    ใช้สิทธิ &ldquo;00 ชำระเงิน (ไม่มีสิทธิการรักษา)&rdquo; คือคนจ่ายเงินมา
                    ตรวจเอง ซึ่งไม่อยู่ในชุดตั้งต้น ถ้าต้องการกลุ่มนี้ต้องเลือกสิทธิ 00 เพิ่ม
                  </div>
                </PageHint>
              </div>
              <Select<string[]>
                mode="multiple"
                allowClear
                showSearch
                value={pttypes}
                onChange={setPttypes}
                options={rightOptions}
                placeholder="พิมพ์ค้นชื่อสิทธิหรือรหัสสิทธิ เลือกได้หลายสิทธิ"
                maxTagCount="responsive"
                className="w-full"
                size="large"
                // ค้นได้ทั้งชื่อสิทธิและรหัส — รหัสสองตัวอักษรเป็นสิ่งที่เจ้าหน้าที่
                // การเงินจำได้ขึ้นใจ ส่วนค่าตั้งต้นของ Select ค้นจาก label อย่างเดียว
                //
                // อ่าน option.value ตรง ๆ ไม่ใช่ option.data.value — filterOption ได้
                // ตัวเลือกมาตรง ๆ ไม่มีชั้น .data ให้ (ต่างจาก optionRender ที่ได้
                // FlattenOptionData ซึ่งห่อไว้ใน .data) และ TypeScript จับไม่ได้เพราะ
                // ชนิดของตัวเลือกมี index signature ทำให้ option.data เป็น any
                filterOption={(input, option) => {
                  const text = input.trim().toLowerCase()
                  if (text === '' || option == null) return true
                  return (
                    String(option.label ?? '')
                      .toLowerCase()
                      .includes(text) ||
                    String(option.value ?? '')
                      .toLowerCase()
                      .includes(text)
                  )
                }}
              />
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Button
                  size="small"
                  onClick={() => setPttypes(checkupNamedCodes)}
                  disabled={checkupNamedCodes.length === 0}
                >
                  สิทธิที่ชื่อมีคำว่าตรวจสุขภาพ ({checkupNamedCodes.length})
                </Button>
                <Button size="small" onClick={() => setPttypes([])} disabled={noRight}>
                  ล้างที่เลือก
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <div className="mb-1.5 text-xs font-semibold text-ink">
                  ช่วงวันที่
                  {searchingByKeyword && (
                    <span className="ml-1 font-normal text-ink-3">— ไม่ใช้ เพราะค้นด้วยคำค้น</span>
                  )}
                </div>
                <RangePicker
                  value={range}
                  onChange={value => {
                    if (value?.[0] && value[1]) setRange([value[0], value[1]])
                  }}
                  allowClear={false}
                  format="DD/MM/BBBB"
                  // จางลงตอนค้นด้วยคำค้น แต่ไม่ปิด — ลบคำค้นแล้วกลับมาใช้ค่าเดิมได้ทันที
                  className={searchingByKeyword ? 'opacity-50' : undefined}
                />
              </div>

              <div>
                <div className="mb-1.5 text-xs font-semibold text-ink">
                  ค้นด้วย HN หรือชื่อ-สกุล
                  <PageHint>
                    ใส่คำค้นแล้วจะ<b>ค้นทุกช่วงเวลา</b> ไม่ใช้ช่วงวันที่ — คนที่ถือ HN
                    หรือชื่อมาคนหนึ่งมักไม่รู้ว่าคนนั้นมาตรวจวันไหน
                    <div className="mt-1.5">
                      ตัวเลขล้วนคือ HN (ไม่ต้องใส่ศูนย์หน้า) · คำเดียวค้นทั้งชื่อและสกุล ·
                      สองคำถือว่าคำแรกเป็นชื่อ ที่เหลือเป็นสกุล · ค้นแบบ<b>ขึ้นต้น</b>เท่านั้น
                      เพราะฐานมีผู้ป่วย 628,462 ราย ถ้าค้นแบบมีคำนั้นอยู่ที่ไหนก็ได้
                      จะต้องไล่ทั้งตาราง
                    </div>
                    <div className="mt-1.5">
                      ยังกรองตามสิทธิที่เลือกไว้ด้วย — อยากเห็นทุกครั้งที่คนนี้มา
                      ให้เลือกสิทธิเพิ่ม
                    </div>
                  </PageHint>
                </div>
                <Input
                  allowClear
                  value={keyword}
                  onChange={event => setKeyword(event.target.value)}
                  onPressEnter={() => void search()}
                  placeholder="เช่น 104698 หรือ สมชาย ใจดี"
                  prefix={<SearchOutlined className="text-ink-3" />}
                  style={{ width: 260 }}
                />
              </div>

              <Button
                type="primary"
                icon={<SearchOutlined />}
                loading={loading}
                disabled={noRight || overRange || shortKeyword}
                onClick={search}
              >
                ค้นหา
              </Button>
            </div>

            <Text type="secondary" className="text-[11px]">
              {noRight ? (
                <span className="text-rose-500">
                  ยังไม่ได้เลือกสิทธิ — เลือกอย่างน้อยหนึ่งรายการ
                </span>
              ) : shortKeyword ? (
                <span className="text-rose-500">
                  พิมพ์คำค้นอย่างน้อย {minKeyword} ตัวอักษร
                </span>
              ) : overRange ? (
                <span className="text-rose-500">
                  ช่วงที่เลือกยาว {rangeDays} วัน เกินเพดาน {maxRangeDays} วันต่อการค้นหนึ่งครั้ง
                </span>
              ) : searchingByKeyword ? (
                <>
                  ค้น &ldquo;{trimmedKeyword}&rdquo; ทุกช่วงเวลา · {pttypes.length} สิทธิที่เลือก
                </>
              ) : (
                <>
                  ช่วง {rangeDays} วัน (เพดาน {maxRangeDays}) · {pttypes.length} สิทธิที่เลือก
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
            <span className="text-xs text-ink-3">
              เลือกสิทธิกับช่วงวันที่แล้วกดค้นหา เพื่อดูรายชื่อ · หรือใส่ HN หรือชื่อ-สกุล
              เพื่อค้นทุกช่วงเวลา
            </span>
          }
        />
      ) : (
        <Spin spinning={loading}>
          {report.truncated && (
            <Alert
              type="warning"
              showIcon
              className="mb-4"
              title={`พบ ${report.totalVisits.toLocaleString('th-TH')} ครั้ง แสดงได้ ${report.visits.length.toLocaleString('th-TH')} ครั้งล่าสุด`}
              description="ตัวเลขในแท็บสถิติยังเป็นยอดจริงทั้งหมด ส่วนรายชื่อกับไฟล์ที่ส่งออกได้เฉพาะเท่าที่แสดง — ถ้าต้องการครบ กรุณาแคบช่วงวันที่หรือเลือกสิทธิให้น้อยลง"
            />
          )}

          <Tabs
            activeKey={tab}
            onChange={key => setTab(key as 'list' | 'stats')}
            items={[
              {
                key: 'list',
                label: `รายชื่อ (${visitRows.length.toLocaleString('th-TH')})`,
                children: (
                  <>
              <section className="rounded-2xl border border-line bg-panel p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  {/* จำนวนรายการอยู่บนป้ายแท็บแล้ว ตรงนี้เหลือเฉพาะเรื่องที่ติ๊กไว้
                      ซึ่งป้ายแท็บบอกไม่ได้ */}
                  <div className="text-xs font-semibold text-ink">
                    {picked.length > 0 ? (
                      <span className="font-normal text-accent">
                        ติ๊กไว้ {exportRows.length.toLocaleString('th-TH')} รายการ
                        {/* ติ๊กไว้แล้วพิมพ์ค้นต่อจะมีแถวที่ติ๊กไว้หลุดออกจากจอ ต้องบอก
                            ไม่ใช่ปล่อยให้ตัวเลขหายไปเองเงียบ ๆ */}
                        {picked.length > exportRows.length && (
                          <span className="text-ink-3">
                            {' '}
                            (อีก {(picked.length - exportRows.length).toLocaleString('th-TH')}{' '}
                            รายการที่ติ๊กไว้ถูกคำค้นกรองออก)
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="font-normal text-ink-3">
                        ติ๊กเลือกรายการเพื่อส่งออกเฉพาะที่เลือก
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <RowSearch
                      value={rowFilter}
                      onChange={setRowFilter}
                      placeholder="กรองในตาราง — HN ชื่อ สิทธิ ห้องตรวจ แพทย์"
                    />
                    {/* เลือกทั้งหมด = ทุกแถวที่เห็นอยู่ ไม่ใช่แค่หน้าปัจจุบัน — ช่องติ๊ก
                        บนหัวตารางของ antd เลือกได้เฉพาะหน้าที่เปิดอยู่ (50 แถว)
                        ซึ่งไม่ใช่สิ่งที่คนกดคำว่า "ทั้งหมด" คาดหวังเมื่อผลมีหลายหน้า */}
                    <Button
                      size="small"
                      onClick={() => setPicked(visitRows.map(row => row.vn))}
                      disabled={visitRows.length === 0 || picked.length === visitRows.length}
                    >
                      เลือกทั้งหมด ({visitRows.length.toLocaleString('th-TH')})
                    </Button>
                    <Button size="small" onClick={() => setPicked([])} disabled={picked.length === 0}>
                      ล้างที่เลือก
                    </Button>
                    <Button
                      icon={<FileExcelOutlined />}
                      disabled={exportRows.length === 0}
                      onClick={exportCsv}
                    >
                      ส่งออก CSV ({exportRows.length.toLocaleString('th-TH')})
                    </Button>
                  </div>
                </div>
                <Table<CheckupVisit>
                  rowKey="vn"
                  size="small"
                  columns={visitColumns}
                  dataSource={visitRows}
                  rowSelection={{
                    selectedRowKeys: picked,
                    onChange: keys => setPicked(keys as string[]),
                    /* ให้เลือกข้ามหน้าได้ — ติ๊กหน้าแรกแล้วเปลี่ยนหน้าไปติ๊กต่อ
                       ของที่ติ๊กไว้ต้องไม่หายไป เพราะไฟล์ที่ส่งออกคิดจากทั้งชุด */
                    preserveSelectedRowKeys: true,
                  }}
                  pagination={{
                    pageSize: PAGE_SIZE,
                    current: currentPage,
                    onChange: setCurrentPage,
                    showSizeChanger: false,
                    showTotal: total => `${total.toLocaleString('th-TH')} รายการ`,
                  }}
                  scroll={{ x: 'max-content' }}
                />
              </section>
                  </>
                ),
              },
              {
                key: 'stats',
                label: 'สถิติ',
                children: (
                  <>
              <section className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-2xl border border-line bg-panel p-4">
                  <div className="text-xs text-ink-3">จำนวนครั้ง</div>
                  <div className="mt-1 text-2xl font-semibold text-ink">
                    {report.totalVisits.toLocaleString('th-TH')}
                  </div>
                  <div className="mt-1 text-[11px] text-ink-3">
                    {/* โหมดคำค้นไม่ได้ใช้ช่วงวันที่ ถ้าพิมพ์ช่วงไว้ตรงนี้จะเป็นการบอก
                        ขอบเขตที่ไม่ตรงกับตัวเลขข้างบน */}
                    {report.allTime
                      ? `ทุกช่วงเวลา · ค้น “${report.keyword ?? ''}”`
                      : `${toThaiDate(report.from)} ถึง ${toThaiDate(report.to)}`}
                  </div>
                </div>
                <div className="rounded-2xl border border-line bg-panel p-4">
                  <div className="text-xs text-ink-3">จำนวนคน</div>
                  <div className="mt-1 text-2xl font-semibold text-ink">
                    {report.totalPatients.toLocaleString('th-TH')}
                  </div>
                  <div className="mt-1 text-[11px] text-ink-3">
                    นับ HN ไม่ซ้ำ · เฉลี่ย{' '}
                    {report.totalPatients === 0
                      ? '—'
                      : (report.totalVisits / report.totalPatients).toFixed(2)}{' '}
                    ครั้งต่อคน
                  </div>
                </div>
                <div className="rounded-2xl border border-line bg-panel p-4">
                  <div className="text-xs text-ink-3">สิทธิที่พบข้อมูล</div>
                  <div className="mt-1 text-2xl font-semibold text-ink">{report.byRight.length}</div>
                  <div className="mt-1 text-[11px] text-ink-3">
                    จาก {report.pttypes.length} สิทธิที่เลือก
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-line bg-panel p-4">
                <div className="mb-2 text-xs font-semibold text-ink">
                  สรุปตามสิทธิการรักษา
                  {/* ผลบวกของคอลัมน์ "คน" มากกว่าจำนวนคนทั้งหมดได้ ถ้าไม่เขียนไว้
                      คนอ่านจะคิดว่าตัวเลขขัดกัน */}
                  <span className="ml-1 font-normal text-ink-3">
                    — คนเดียวใช้ได้หลายสิทธิ ผลบวกคอลัมน์ &ldquo;คน&rdquo; จึงมากกว่าจำนวนคนทั้งหมดได้
                  </span>
                </div>
                <Table<CheckupRightSummary>
                  rowKey={row => row.pttype ?? ''}
                  size="small"
                  columns={rightColumns}
                  dataSource={report.byRight}
                  pagination={false}
                  scroll={{ x: 'max-content', y: 320 }}
                />
              </section>
                  </>
                ),
              },
            ]}
          />
        </Spin>
      )}

      {/* ───────────── Modal: ใบตรวจสุขภาพก่อนพิมพ์ ───────────── */}
      <Modal
        title={
          sheetRow == null
            ? 'ใบรายงานผลการตรวจสุขภาพ'
            : `ใบรายงานผลการตรวจสุขภาพ · HN ${sheetRow.hn} · ${sheetRow.patientName}`
        }
        open={sheetRow != null}
        onCancel={() => setSheetRow(null)}
        footer={null}
        width="92vw"
        style={{ top: 24, maxWidth: 1000 }}
        // destroyOnHidden: ปิดแล้วทิ้ง iframe ไปเลย เปิดใบของคนถัดไปจะได้โหลดใหม่ทั้งใบ
        // ไม่เหลือหน้าของคนก่อนค้างอยู่ในตัวอ่าน PDF
        destroyOnHidden
      >
        {sheetRow != null && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Text type="secondary" className="text-[11px]">
                สั่งพิมพ์ได้จากแถบเครื่องมือของตัวอ่าน PDF ด้านล่าง · ผลแล็บที่อยู่นอกช่วงอ้างอิง
                พิมพ์เป็นตัวหนาสีแดงและติดดาวกำกับ · หมวดที่ไม่ได้ตรวจจะไม่ขึ้นในใบ
              </Text>
              <Button size="small" icon={<DownloadOutlined />} href={sheetUrl(sheetRow, true)}>
                ดาวน์โหลด PDF
              </Button>
            </div>
            <div className="relative mt-2 h-[calc(100vh-200px)] overflow-hidden rounded-lg border border-line">
              {sheetLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-panel">
                  <Spin description="กำลังสร้างใบรายงาน…">
                    <div className="h-16 w-40" />
                  </Spin>
                </div>
              )}
              <iframe
                key={sheetRow.vn}
                src={sheetUrl(sheetRow)}
                title={`ใบรายงานผลการตรวจสุขภาพ HN ${sheetRow.hn}`}
                className="h-full w-full border-0"
                onLoad={() => setSheetLoading(false)}
              />
            </div>
          </>
        )}
      </Modal>

      {/* ไม่มียาที่ต้องไฮไลต์ — หน้านี้ไม่ได้ผูกกับทะเบียนยาของตัวชี้วัดใด
          ส่ง drugIcodes ว่างไป บรรทัดยาจึงแสดงตามปกติโดยไม่มีป้ายติด */}
      <VisitDetailModal
        open={openVisit != null}
        hn={openVisit?.hn ?? ''}
        vn={openVisit?.vn ?? ''}
        onClose={() => setOpenVisit(null)}
        drugIcodes={[]}
        drugLabel=""
      />
    </>
  )
}
