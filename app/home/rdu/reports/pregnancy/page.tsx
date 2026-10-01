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
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { EyeOutlined, FileExcelOutlined, WarningOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import buddhistEra from 'dayjs/plugin/buddhistEra'
import { apiFetch } from '@/lib/client/session'
import { trackExport } from '@/lib/client/track-export'
import type { PregnancyCase } from '@/lib/his/rdu-pregnancy'
import RowSearch, { matchesRow } from '../row-search'
import VisitDetailModal from '../visit-modal'
import PageHint from '../../../page-hint'

// เปิด token BBBB (ปี พ.ศ.) ให้ dayjs — ถ้าไม่ extend ปฏิทินจะพิมพ์คำว่า BBBB ออกมาตรง ๆ
dayjs.extend(buddhistEra)

const { Text, Title } = Typography
const { RangePicker } = DatePicker

/**
 * รายงานสตรีตั้งครรภ์ที่ได้รับยาที่ห้ามใช้
 *
 * ตารางแสดงเฉพาะรายที่ได้รับยา ไม่ใช่ตัวหารทั้งชุด — ตัวหารทั้งปีมีราวพันราย
 * ซึ่งเป็นชื่อและ HN ของคนที่ไม่มีอะไรต้องตาม ขนลงมาให้เบราว์เซอร์กรองก็เท่ากับ
 * ขนข้อมูลผู้ป่วยมาโดยไม่ได้ใช้ ตัวหารจึงมาเป็นตัวเลขบนการ์ด
 *
 * หนึ่งแถวคือผู้ป่วยหนึ่งราย และมีสองวันที่ให้ดูคู่กันเสมอ: วันที่พบรหัสตั้งครรภ์
 * กับวันที่ได้รับยา — เพราะยาไม่ได้มาจากครั้งเดียวกับที่ลงรหัส การตามเคสจึงต้อง
 * เห็นระยะห่างของสองวันนี้ก่อนจะตัดสินว่าตอนได้รับยายังตั้งครรภ์อยู่จริงหรือไม่
 */

/** แปลง 'YYYY-MM-DD' เป็น วว/ดด/ปปปป พ.ศ. */
function toThaiDate(value: string | null): string {
  if (!value) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return value
  const [, year, month, day] = match
  return `${day}/${month}/${Number(year) + 543}`
}

/** ค่าเริ่มต้น: ย้อนหลัง 1 ปีถึงวันนี้ — ข้อนี้เจอเคสไม่กี่รายต่อปี */
const DEFAULT_RANGE: [Dayjs, Dayjs] = [dayjs().subtract(1, 'year').add(1, 'day'), dayjs()]

/** ใส่ BOM เพราะ Excel บนวินโดวส์เดาว่า CSV เป็น CP874 (เหตุผลเต็มอยู่ที่ visit-report.tsx) */
function toCsv(rows: string[][]): string {
  const cell = (value: string) => `"${value.replace(/"/g, '""')}"`
  return '﻿' + rows.map(row => row.map(cell).join(',')).join('\r\n')
}

type Report = {
  cases: PregnancyCase[]
  pregnantPatients: number
  exposedPatients: number
  diagnosisCodes: number
  drugItems: number
  drugIcodes: string[]
  maxAgeYears: number
  windowDays: number
  target: number
  truncated: boolean
}

const SETTINGS_DRUG = '/home/rdu/settings/pregnancy-contra'
const SETTINGS_DX = '/home/rdu/settings/pregnancy-icd10'
const SETTINGS_AGE = '/home/rdu/settings/age-criteria'

/** จำนวนแถวต่อหน้า — ช่องลำดับใช้ค่านี้คำนวณเลขต่อข้ามหน้า */
const PAGE_SIZE = 50
export default function PregnancyReportPage() {
  const [range, setRange] = useState<[Dayjs, Dayjs]>(DEFAULT_RANGE)
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  /** คำค้นในตาราง — กรองในเบราว์เซอร์ ไม่ได้ยิงกลับไปที่ฐาน */
  const [keyword, setKeyword] = useState('')
  const [picked, setPicked] = useState<PregnancyCase | null>(null)
  const [toast, toastHolder] = message.useMessage()

  const search = async () => {
    setLoading(true)
    setError('')
    try {
      const from = range[0].format('YYYY-MM-DD')
      const to = range[1].format('YYYY-MM-DD')
      const res = await apiFetch(`/api/his/rdu/pregnancy?from=${from}&to=${to}`)
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

  const percent = useMemo(() => {
    if (report == null || report.pregnantPatients === 0) return null
    return (report.exposedPatients * 100) / report.pregnantPatients
  }, [report])

  const cases = useMemo(() => report?.cases ?? [], [report])

  /** แถวที่เหลือหลังค้น — ตัวเลขบนการ์ดไม่ขยับตาม เพราะนับมาจากฐานทั้งช่วง */
  const shown = useMemo(
    () =>
      cases.filter(row =>
        matchesRow(
          [
            row.hn,
            row.patientName,
            row.ageYears,
            row.department,
            row.doctor,
            ...row.icd10,
            ...row.drugs,
          ],
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
      'อายุ',
      'พบรหัสตั้งครรภ์ครั้งแรก',
      'พบรหัสตั้งครรภ์ครั้งล่าสุด',
      'สิ้นสุดช่วงเฝ้าระวัง',
      'จำนวนครั้งที่มาด้วยรหัสตั้งครรภ์',
      'รหัสวินิจฉัย',
      'วันที่ได้รับยาที่ห้ามใช้',
      'รายการยาที่ห้ามใช้ที่ได้รับ',
      'ห้องตรวจล่าสุด',
      'แพทย์ผู้ตรวจล่าสุด',
    ]
    const body = shown.map(row => [
      // นำหน้าด้วย ' เพื่อให้ Excel เก็บเป็นข้อความ ไม่ตัดศูนย์หน้า HN ทิ้ง
      `'${row.hn}`,
      row.patientName,
      row.ageYears == null ? '' : String(row.ageYears),
      toThaiDate(row.firstDate),
      toThaiDate(row.lastDate),
      toThaiDate(row.windowTo),
      String(row.visits),
      row.icd10.join(' '),
      toThaiDate(row.drugDate),
      row.drugs.join(' / '),
      row.department ?? '',
      row.doctor ?? '',
    ])

    const blob = new Blob([toCsv([header, ...body])], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `ยาที่ห้ามใช้ในสตรีตั้งครรภ์-${range[0].format('YYYY-MM-DD')}-ถึง-${range[1].format('YYYY-MM-DD')}.csv`
    link.click()
    // แจ้งเซิร์ฟเวอร์ว่าข้อมูลชุดนี้ถูกนำออกจากระบบ — ไฟล์สร้างในเบราว์เซอร์
    // จึงไม่มีคำขอไหนวิ่งไปให้ proxy ดักได้เอง
    trackExport({ label: link.download, rows: body.length })
    // คืนหน่วยความจำของ blob หลังเบราว์เซอร์เริ่มดาวน์โหลดแล้ว
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success(`ส่งออก ${body.length} รายการแล้ว`)
  }

  /**
   * หน้าที่เปิดอยู่ของตาราง — ต้องถือไว้เองเพราะช่องลำดับนับต่อข้ามหน้า
   *
   * antd ส่ง index ของแถวในหน้านั้น ๆ มาให้ ถ้าใช้ตรง ๆ หน้าที่สองจะเริ่มนับ 1 ใหม่
   * แล้วเลขลำดับจะซ้ำกับหน้าแรกทั้งชุด
   */
  const [page, setPage] = useState(1)
  // ผลลัพธ์หดลงได้ทุกครั้งที่เปลี่ยนตัวกรอง หน้าที่ค้างอยู่จึงอาจเลยท้ายตารางไปแล้ว
  // หนีบไว้ตรงนี้แทนการไล่รีเซ็ตที่ตัวกรองทุกจุด — ตารางจะไม่มีทางว่างเพราะเลขหน้า
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const columns: ColumnsType<PregnancyCase> = [
    {
      title: 'ลำดับ',
      key: 'index',
      width: 70,
      align: 'center',
      render: (_: unknown, __: unknown, index: number) => (
        <span className="font-mono text-xs text-ink-3">{(currentPage - 1) * PAGE_SIZE + index + 1}</span>
      ),
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
      title: 'ช่วงที่พบรหัสตั้งครรภ์',
      dataIndex: 'firstDate',
      width: 185,
      /* แสดงครั้งแรกกับครั้งล่าสุดคู่กัน — คนที่มาฝากครรภ์ครั้งเดียวแล้วหายไป
         กับคนที่มาต่อเนื่องทั้งการตั้งครรภ์ ตีความวันที่ได้รับยาต่างกันมาก */
      render: (_: string | null, row) => (
        <div className="leading-tight">
          <div className="text-xs">
            {toThaiDate(row.firstDate)}
            {row.lastDate !== row.firstDate && ` – ${toThaiDate(row.lastDate)}`}
          </div>
          <div className="text-[11px] text-ink-3">
            มา {row.visits} ครั้ง · เฝ้าระวังถึง {toThaiDate(row.windowTo)}
          </div>
        </div>
      ),
    },
    {
      title: 'ได้รับยาที่ห้ามใช้',
      dataIndex: 'drugDate',
      width: 280,
      render: (date: string | null, row) => (
        <div className="leading-tight">
          <div className="text-xs font-medium text-amber-500">{toThaiDate(date)}</div>
          <div className="text-[11px] text-ink-2">{row.drugs.join(' / ')}</div>
        </div>
      ),
    },
    {
      title: 'รหัสวินิจฉัย',
      dataIndex: 'icd10',
      width: 150,
      render: (codes: string[]) => (
        <span className="flex flex-wrap gap-1">
          {codes.map(code => (
            <Tag key={code} className="m-0 font-mono text-[11px]">
              {code}
            </Tag>
          ))}
        </span>
      ),
    },
    {
      title: 'ห้องตรวจล่าสุด',
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
            { title: 'ยาที่ห้ามใช้ในสตรีตั้งครรภ์' },
          ]}
        />
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          <WarningOutlined /> สตรีตั้งครรภ์ที่ได้รับยาที่ห้ามใช้
          <PageHint>
            สตรีตั้งครรภ์ที่ได้รับยากลุ่มที่ห้ามใช้ — warfarin, statins และ ergots
            ยากลุ่มนี้ทำให้ทารกในครรภ์พิการหรือเสียชีวิตได้ และไม่มีขนาดที่ปลอดภัย
            เกณฑ์ของข้อนี้จึงเป็นศูนย์ ตารางแสดงเฉพาะรายที่ได้รับยา
            หนึ่งแถวคือผู้ป่วยหนึ่งราย
          </PageHint>
        </Title>
        <div className="h-px w-24 bg-linear-to-r from-rose-400/70 to-transparent" />
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
          ช่วงวันที่ = วันที่พบรหัสตั้งครรภ์ เลือกได้ไม่เกิน 366 วัน · ตัวหารนับเฉพาะผู้ป่วยนอก
          ส่วนยาที่ได้รับนับทั้งผู้ป่วยนอกและผู้ป่วยใน ·
          ยาไม่จำเป็นต้องมาจากครั้งเดียวกับที่ลงรหัสตั้งครรภ์
        </Text>
      </div>

      {error && <Alert type="error" showIcon title={error} className="mb-4" />}

      {report && report.diagnosisCodes === 0 && (
        <Alert
          type="warning"
          showIcon
          className="mb-4"
          title="ยังไม่ได้ตั้งค่าทะเบียนรหัสวินิจฉัยการตั้งครรภ์ รายงานจึงว่างเปล่า"
          description={
            <span className="text-xs leading-relaxed">
              เลือกรหัสที่แปลว่ากำลังตั้งครรภ์ก่อนที่{' '}
              <Link href={SETTINGS_DX} className="text-accent">
                หน้าตั้งค่ารหัสวินิจฉัย
              </Link>
            </span>
          }
        />
      )}

      {report && report.diagnosisCodes > 0 && report.drugItems === 0 && (
        <Alert
          type="warning"
          showIcon
          className="mb-4"
          title="ยังไม่ได้ตั้งค่าทะเบียนยาที่ห้ามใช้ ตารางจะว่างเสมอ"
          description={
            <span className="text-xs leading-relaxed">
              เลือกรายการยาก่อนที่{' '}
              <Link href={SETTINGS_DRUG} className="text-accent">
                หน้าตั้งค่ายาที่ห้ามใช้
              </Link>{' '}
              — ข้อนี้ใช้คอลัมน์หมวดความเสี่ยงในฐาน HIS แทนไม่ได้ เพราะกรอกไว้ไม่ครบและไม่สม่ำเสมอ
            </span>
          }
        />
      )}

      {report?.truncated && (
        <Alert
          type="info"
          showIcon
          className="mb-4"
          title="รายการยาวเกินกว่าที่แสดงได้ในครั้งเดียว จึงตัดไว้ที่ 3,000 ราย"
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
                label={`ตัวหาร — สตรีตั้งครรภ์ (ไม่เกิน ${report.maxAgeYears} ปี)`}
                value={report.pregnantPatients.toLocaleString('th-TH')}
                unit="ราย"
                hint={`จากรหัสวินิจฉัยในทะเบียน ${report.diagnosisCodes} รหัส`}
              />
              <StatCard
                label="ตัวตั้ง — ได้รับยาที่ห้ามใช้"
                value={report.exposedPatients.toLocaleString('th-TH')}
                unit="ราย"
                hint={`เฝ้าระวัง ${report.windowDays} วันนับจากวันที่พบรหัสตั้งครรภ์ครั้งแรก`}
                tone={report.exposedPatients === 0 ? 'good' : 'warn'}
              />
              <StatCard
                label="ร้อยละของสตรีตั้งครรภ์"
                value={percent == null ? '—' : percent.toFixed(2)}
                unit={percent == null ? '' : '%'}
                hint={
                  percent == null
                    ? `เกณฑ์ ${report.target}%`
                    : percent <= report.target
                      ? `ผ่านเกณฑ์ (${report.target}%)`
                      : `เกินเกณฑ์ ${report.target}%`
                }
                tone={percent == null ? 'plain' : percent <= report.target ? 'good' : 'warn'}
              />
              <StatCard
                label="รายการยาในทะเบียน"
                value={report.drugItems.toLocaleString('th-TH')}
                unit="รายการ"
                hint="warfarin · statins · ergots"
              />
            </section>

            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <RowSearch
                value={keyword}
                onChange={setKeyword}
                placeholder="ค้น HN ชื่อผู้ป่วย รหัสโรค ชื่อยา ห้องตรวจ แพทย์"
              />
              <span className="text-xs text-ink-3">
                ต้องทบทวน {shown.length.toLocaleString('th-TH')} ราย · เพดานอายุปรับได้ที่{' '}
                <Link href={SETTINGS_AGE} className="text-accent">
                  หน้าตั้งค่าเกณฑ์อายุ
                </Link>
              </span>
              <Tooltip title="ได้ไฟล์ทุกรายที่แสดงอยู่ · มีชื่อผู้ป่วยและ HN อย่าส่งต่อออกนอกงาน">
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
              <Table<PregnancyCase>
                rowKey="hn"
                size="small"
                columns={columns}
                dataSource={shown}
                pagination={{
                  current: currentPage,
                  pageSize: PAGE_SIZE,
                  showSizeChanger: false,
                  onChange: setPage,
                }}
                scroll={{ x: 'max-content' }}
                locale={{
                  emptyText: (
                    <Empty
                      description={
                        keyword.trim() === ''
                          ? 'ไม่พบสตรีตั้งครรภ์ที่ได้รับยาที่ห้ามใช้ในช่วงวันที่ที่เลือก'
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

      {/* เปิดดูรายละเอียดของครั้งล่าสุดที่ลงรหัสตั้งครรภ์ — ไม่ใช่ครั้งที่ได้รับยา
          เพราะครั้งที่ได้รับยาอาจเป็นฝั่งผู้ป่วยใน ซึ่ง modal นี้รับแต่ VN ผู้ป่วยนอก */}
      <VisitDetailModal
        open={picked != null}
        onClose={() => setPicked(null)}
        hn={picked?.hn ?? null}
        vn={picked?.lastVn ?? null}
        patientName={picked?.patientName ?? null}
        drugIcodes={report?.drugIcodes ?? []}
        drugLabel="ยาที่ห้ามใช้ในสตรีตั้งครรภ์"
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
  /** เน้นสีเฉพาะการ์ดที่บอกผลของตัวชี้วัด — การ์ดตัวหารเป็นแค่ตัวเลขกลาง ๆ */
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
