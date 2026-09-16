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
import { FileExcelOutlined, ProfileOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import buddhistEra from 'dayjs/plugin/buddhistEra'
import { apiFetch } from '@/lib/client/session'
import type { EdItem, EdScope } from '@/lib/his/rdu-ed'
import RowSearch, { matchesRow } from '../row-search'

// เปิด token BBBB (ปี พ.ศ.) ให้ dayjs — ถ้าไม่ extend ปฏิทินจะพิมพ์คำว่า BBBB ออกมาตรง ๆ
dayjs.extend(buddhistEra)

const { Paragraph, Text, Title } = Typography
const { RangePicker } = DatePicker

/**
 * รายงานร้อยละการสั่งใช้ยาในบัญชียาหลักแห่งชาติ (ED)
 *
 * หน้านี้ไม่มีชื่อผู้ป่วยและไม่มี HN เลยสักช่อง ต่างจากรายงานข้ออื่นทั้งหมด —
 * ตัวชี้วัดนับบรรทัดยา ไม่ได้นับคน สิ่งที่คณะกรรมการต้องเห็นคือ "ยานอกบัญชีตัวไหน
 * ถูกสั่งมากที่สุด" ซึ่งเป็นรายการยา งานที่ตามคือการทบทวนบัญชียาหรือหาตัวแทน
 * ในบัญชี ไม่ใช่การตามผู้ป่วยรายคน
 *
 * จำนวนผู้ป่วยยังแสดงอยู่เป็นตัวเลขนับต่อยาหนึ่งรายการ เพราะยาที่สั่งซ้ำให้คนเดิม
 * ทุกเดือนกับยาที่กระจายไปหลายสิบคน เป็นคนละเรื่องกันในแง่ของการทบทวน
 */

/** ค่าเริ่มต้น: ย้อนหลัง 30 วันถึงวันนี้ */
const DEFAULT_RANGE: [Dayjs, Dayjs] = [dayjs().subtract(30, 'day'), dayjs()]

/** ใส่ BOM เพราะ Excel บนวินโดวส์เดาว่า CSV เป็น CP874 (เหตุผลเต็มอยู่ที่ visit-report.tsx) */
function toCsv(rows: string[][]): string {
  const cell = (value: string) => `"${value.replace(/"/g, '""')}"`
  return '﻿' + rows.map(row => row.map(cell).join(',')).join('\r\n')
}

const SCOPE_LABEL: Record<EdScope, string> = {
  opd: 'ผู้ป่วยนอก',
  ipd: 'ผู้ป่วยใน',
}

type Report = {
  scope: EdScope
  totalLines: number
  edLines: number
  nedItems: EdItem[]
  mismatchedItems: number
  truncated: boolean
}

export default function EdReportPage() {
  const [range, setRange] = useState<[Dayjs, Dayjs]>(DEFAULT_RANGE)
  const [scope, setScope] = useState<EdScope>('opd')
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  /** คำค้นในตาราง — กรองในเบราว์เซอร์ ไม่ได้ยิงกลับไปที่ฐาน */
  const [keyword, setKeyword] = useState('')
  const [toast, toastHolder] = message.useMessage()

  const search = async () => {
    setLoading(true)
    setError('')
    try {
      const from = range[0].format('YYYY-MM-DD')
      const to = range[1].format('YYYY-MM-DD')
      const res = await apiFetch(`/api/his/rdu/ed?from=${from}&to=${to}&scope=${scope}`)
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
    const ned = report.totalLines - report.edLines
    return {
      ned,
      percent: report.totalLines === 0 ? null : (report.edLines * 100) / report.totalLines,
    }
  }, [report])

  const items = useMemo(() => report?.nedItems ?? [], [report])

  const shown = useMemo(
    () => items.filter(row => matchesRow([row.icode, row.name, row.generic], keyword)),
    [items, keyword],
  )

  const exportCsv = () => {
    if (shown.length === 0) {
      toast.info('ไม่มีรายการให้ส่งออก')
      return
    }

    const header = [
      'รหัสยา',
      'ชื่อยา',
      'ชื่อสามัญ',
      'จำนวนบรรทัดที่สั่ง',
      'จำนวนผู้ป่วย',
      'ร้อยละของยานอกบัญชีทั้งหมด',
    ]
    const totalNed = figures?.ned ?? 0
    const body = shown.map(row => [
      // นำหน้าด้วย ' เพื่อให้ Excel เก็บเป็นข้อความ ไม่ตัดศูนย์หน้ารหัสทิ้ง
      `'${row.icode}`,
      row.name,
      row.generic ?? '',
      String(row.lines),
      String(row.patients),
      totalNed === 0 ? '' : ((row.lines * 100) / totalNed).toFixed(2),
    ])

    const blob = new Blob([toCsv([header, ...body])], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `ยานอกบัญชียาหลัก-${SCOPE_LABEL[scope]}-${range[0].format('YYYY-MM-DD')}-ถึง-${range[1].format('YYYY-MM-DD')}.csv`
    link.click()
    // คืนหน่วยความจำของ blob หลังเบราว์เซอร์เริ่มดาวน์โหลดแล้ว
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success(`ส่งออก ${body.length} รายการแล้ว`)
  }

  const totalNed = figures?.ned ?? 0

  const columns: ColumnsType<EdItem> = [
    {
      title: 'รหัสยา',
      dataIndex: 'icode',
      width: 100,
      render: (icode: string) => <span className="font-mono text-xs">{icode}</span>,
    },
    {
      title: 'ชื่อยา',
      dataIndex: 'name',
      render: (name: string, row) => (
        <div className="leading-tight">
          <div className="text-xs">{name}</div>
          {row.generic && <div className="text-[11px] text-ink-3">{row.generic}</div>}
        </div>
      ),
    },
    {
      title: 'สั่งไป',
      dataIndex: 'lines',
      width: 120,
      align: 'right',
      className: 'qty',
      sorter: (a, b) => a.lines - b.lines,
      defaultSortOrder: 'descend',
      render: (lines: number) => (
        <div className="leading-tight">
          <div>{lines.toLocaleString('th-TH')}</div>
          <div className="text-[11px] font-normal text-ink-3">บรรทัด</div>
        </div>
      ),
    },
    {
      title: 'ผู้ป่วย',
      dataIndex: 'patients',
      width: 110,
      align: 'right',
      className: 'qty',
      sorter: (a, b) => a.patients - b.patients,
      /* สั่งกี่บรรทัดต่อผู้ป่วยหนึ่งคน — ตัวเลขนี้แยกยาที่สั่งซ้ำให้คนเดิมทุกเดือน
         (ควรทบทวนว่าจะหาตัวแทนในบัญชีไหม) ออกจากยาที่ใช้ครั้งคราวกระจายหลายคน */
      render: (patients: number, row) => (
        <div className="leading-tight">
          <div>{patients.toLocaleString('th-TH')}</div>
          <div className="text-[11px] font-normal text-ink-3">
            {patients === 0 ? '—' : `${(row.lines / patients).toFixed(1)} บรรทัด/คน`}
          </div>
        </div>
      ),
    },
    {
      title: 'สัดส่วนในยานอกบัญชี',
      dataIndex: 'lines',
      key: 'share',
      width: 150,
      align: 'right',
      className: 'qty',
      render: (lines: number) =>
        totalNed === 0 ? '—' : `${((lines * 100) / totalNed).toFixed(2)}%`,
    },
    {
      title: 'บัญชีย่อย',
      dataIndex: 'account',
      width: 110,
      /* ยานอกบัญชีไม่ควรมีบัญชีย่อย ถ้ามีแปลว่าสองคอลัมน์ในบัญชียาขัดกัน
         และรายการนั้นอาจถูกจัดผิดฝั่ง */
      render: (account: string | null) =>
        account == null ? (
          <Text type="secondary" className="text-xs">
            —
          </Text>
        ) : (
          <Tag color="warning" className="mr-0!">
            ขัดกัน: {account}
          </Tag>
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
            { title: 'การสั่งใช้ยาในบัญชียาหลัก (ED)' },
          ]}
        />
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          <ProfileOutlined /> ร้อยละการสั่งใช้ยาในบัญชียาหลักแห่งชาติ
        </Title>
        <div className="mb-2 h-px w-24 bg-linear-to-r from-sky-400/70 to-transparent" />
        <Paragraph type="secondary" style={{ maxWidth: 900, marginBottom: 0, fontSize: 12 }}>
          นับทุกบรรทัดยาที่จ่ายจริงในช่วงที่เลือก แล้วดูว่ากี่เปอร์เซ็นต์อยู่ในบัญชียาหลักแห่งชาติ —
          ข้อนี้ยิ่งสูงยิ่งดี และไม่เกี่ยงโรค ตารางแสดงเฉพาะยานอกบัญชีที่ถูกสั่ง
          เรียงจากที่สั่งมากที่สุด ซึ่งเป็นรายการที่ทบทวนแล้วได้ผลเร็วที่สุด
        </Paragraph>
      </section>

      <div className="mb-5 flex flex-wrap items-start gap-3">
        <Space.Compact>
          <RangePicker
            size="large"
            allowClear={false}
            value={range}
            format="DD/MM/BBBB"
            // ห้ามเลือกวันในอนาคต — การจ่ายยาที่ยังไม่เกิดขึ้นย่อมไม่มี
            maxDate={dayjs()}
            onChange={dates => {
              if (dates?.[0] && dates[1]) setRange([dates[0], dates[1]])
            }}
          />
          <Button size="large" type="primary" loading={loading} onClick={() => void search()}>
            ค้นหา
          </Button>
        </Space.Compact>
        {/* เลือกฝั่งก่อนค้น ไม่ได้กรองหลังได้ข้อมูลมาแล้ว — สองฝั่งเป็นคนละคิวรี
            และคนละตัวชี้วัด ไม่ใช่การกรองชุดข้อมูลเดียวกัน */}
        <Segmented<EdScope>
          size="large"
          value={scope}
          onChange={setScope}
          options={[
            { label: SCOPE_LABEL.opd, value: 'opd' },
            { label: SCOPE_LABEL.ipd, value: 'ipd' },
          ]}
        />
        <Text type="secondary" className="w-full text-[11px]">
          เลือกฝั่งแล้วกดค้นหาใหม่ทุกครั้ง · ผู้ป่วยนอกกับผู้ป่วยในเป็นคนละตัวชี้วัดและใช้เกณฑ์คนละตัว
          · ช่วงวันที่เลือกได้ไม่เกิน 366 วัน · ยาในบัญชีดูจากหมวดค่าใช้จ่ายของรายการยา
        </Text>
      </div>

      {error && <Alert type="error" showIcon title={error} className="mb-4" />}

      {report != null && report.mismatchedItems > 0 && (
        <Alert
          type="warning"
          showIcon
          className="mb-4"
          title={`บัญชียามีรายการที่ตั้งค่าขัดกันอยู่ ${report.mismatchedItems} รายการ`}
          description={
            <span className="text-xs leading-relaxed">
              ตัวชี้วัดนี้ดูจากหมวดค่าใช้จ่าย (ค่ายาในบัญชี / นอกบัญชี) ส่วนอีกคอลัมน์เก็บบัญชีย่อย
              ก–จ2 ไว้ ปกติสองอย่างนี้ต้องตรงกัน รายการที่ขัดกันแปลว่ามีฝั่งหนึ่งกรอกผิด
              และรายการนั้นอาจถูกนับผิดฝั่ง — ตัวเลขรวมยังเชื่อได้อยู่ตราบที่จำนวนนี้ยังน้อย
            </span>
          }
        />
      )}

      {report?.truncated && (
        <Alert
          type="info"
          showIcon
          className="mb-4"
          title="รายการยานอกบัญชียาวเกินกว่าที่แสดงได้ในครั้งเดียว จึงตัดไว้ที่ 500 รายการ"
          description={
            <span className="text-xs leading-relaxed">
              ร้อยละบนการ์ดยังถูกต้องอยู่ เพราะนับที่ฐานข้อมูลไม่ได้นับจากตาราง
            </span>
          }
        />
      )}

      <Spin spinning={loading}>
        {report && figures ? (
          <>
            <section className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label={`ตัวหาร — บรรทัดยาที่จ่ายจริง (${SCOPE_LABEL[report.scope]})`}
                value={report.totalLines.toLocaleString('th-TH')}
                unit="บรรทัด"
                hint="หนึ่งบรรทัดคือยาหนึ่งรายการในใบสั่งหนึ่งใบ"
              />
              <StatCard
                label="ตัวตั้ง — อยู่ในบัญชียาหลัก"
                value={report.edLines.toLocaleString('th-TH')}
                unit="บรรทัด"
                hint={`นอกบัญชี ${figures.ned.toLocaleString('th-TH')} บรรทัด`}
              />
              <StatCard
                label="ร้อยละการสั่งใช้ยาในบัญชียาหลัก"
                value={figures.percent == null ? '—' : figures.percent.toFixed(2)}
                unit={figures.percent == null ? '' : '%'}
                hint="ยังไม่ได้ตั้งเกณฑ์เป้าหมายของข้อนี้"
                tone="plain"
              />
              <StatCard
                label="รายการยานอกบัญชีที่ถูกสั่ง"
                value={items.length.toLocaleString('th-TH')}
                unit="รายการ"
                hint="นับเฉพาะที่มีการสั่งจริงในช่วงนี้"
              />
            </section>

            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <RowSearch
                value={keyword}
                onChange={setKeyword}
                placeholder="ค้นชื่อยา ชื่อสามัญ หรือรหัสยา"
              />
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs text-ink-3">
                  แสดง {shown.length.toLocaleString('th-TH')} รายการ
                </span>
                <Tooltip title="ได้ไฟล์ตามคำค้นที่ใช้อยู่ · ไฟล์นี้ไม่มีข้อมูลผู้ป่วย มีแต่รายการยา">
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
              <Table<EdItem>
                rowKey="icode"
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
                          ? 'ไม่มีการสั่งยานอกบัญชีในช่วงวันที่ที่เลือก'
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
