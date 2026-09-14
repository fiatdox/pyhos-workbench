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
import { EyeOutlined, FileExcelOutlined, MonitorOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import buddhistEra from 'dayjs/plugin/buddhistEra'
import { apiFetch } from '@/lib/client/session'
import type { CkdNsaidCase } from '@/lib/his/rdu-ckd-nsaid'
import VisitDetailModal from '../visit-modal'

// เปิด token BBBB (ปี พ.ศ.) ให้ dayjs — ถ้าไม่ extend ปฏิทินจะพิมพ์คำว่า BBBB ออกมาตรง ๆ
dayjs.extend(buddhistEra)

const { Paragraph, Text, Title } = Typography
const { RangePicker } = DatePicker

/**
 * รายงานการใช้ยา NSAIDs ในผู้ป่วยโรคไตเรื้อรัง
 *
 * ต่างจากหน้ารายงานตัวชี้วัดข้ออื่นตรงที่ตารางแสดงเฉพาะ "เคสที่ต้องทบทวน" ไม่ใช่
 * ทั้งตัวหาร — ตัวหารของข้อนี้คือครั้งที่ผู้ป่วย CKD มารับบริการทั้งหมด ซึ่งทั้งปี
 * มีเป็นแสนครั้ง ขนลงมาให้เบราว์เซอร์กรองก็เท่ากับขนข้อมูลผู้ป่วยมาโดยไม่ได้ใช้
 * ตัวหารจึงมาเป็นตัวเลขบนการ์ด ส่วนตารางเป็นรายการงานล้วน ๆ
 *
 * ด้วยเหตุนี้จึงไม่มีปุ่มกรอง "ได้รับ / ไม่ได้รับ" แบบหน้าอื่น ทุกแถวในตารางนี้คือ
 * เคสที่ได้รับยาอยู่แล้ว
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
 * ระยะของโรคไตจากค่า eGFR ตามเกณฑ์ KDIGO
 *
 * แสดงเป็นระยะไม่ใช่ตัวเลขล้วน เพราะคนอ่านรายงานตัดสินจากระยะ ไม่ได้ตัดสินจาก
 * ทศนิยม — แต่ยังพิมพ์ตัวเลขกำกับไว้ด้วย เผื่อเคสที่อยู่คาบเส้น
 */
function stageOf(egfr: number | null): { label: string; color: string } | null {
  if (egfr == null) return null
  if (egfr < 15) return { label: 'ระยะ 5', color: 'red' }
  if (egfr < 30) return { label: 'ระยะ 4', color: 'red' }
  if (egfr < 45) return { label: 'ระยะ 3b', color: 'orange' }
  if (egfr < 60) return { label: 'ระยะ 3a', color: 'orange' }
  /* ค่าไตล่าสุดสูงกว่าเส้นแบ่งแล้ว แถวนี้จึงเข้าตัวหารด้วยรหัสวินิจฉัยเท่านั้น
     (คนที่เข้าด้วยผลแล็บอย่างเดียวถูกกรองออกไปตั้งแต่ในคิวรีแล้ว) — เป็นเคสที่
     ควรทบทวนว่ารหัสโรคไตที่ลงไว้ยังตรงกับสภาพผู้ป่วยตอนนี้หรือไม่ */
  return { label: 'สูงกว่า 60', color: 'default' }
}

type Report = {
  cases: CkdNsaidCase[]
  denominatorVisits: number
  denominatorPatients: number
  casePatients: number
  diagnosisCodes: number
  drugItems: number
  drugIcodes: string[]
  egfrThreshold: number
  truncated: boolean
}

const SETTINGS_DIAGNOSIS = '/home/rdu/settings/ckd-icd10'
const SETTINGS_DRUG = '/home/rdu/settings/nsaid'

export default function CkdNsaidReportPage() {
  const [range, setRange] = useState<[Dayjs, Dayjs]>(DEFAULT_RANGE)
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<CkdNsaidCase | null>(null)
  const [toast, toastHolder] = message.useMessage()

  const search = async () => {
    setLoading(true)
    setError('')
    try {
      const from = range[0].format('YYYY-MM-DD')
      const to = range[1].format('YYYY-MM-DD')
      const res = await apiFetch(`/api/his/rdu/ckd-nsaid?from=${from}&to=${to}`)
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

  /**
   * ร้อยละของตัวชี้วัด — คิดจากรายผู้ป่วย ไม่ใช่รายครั้ง
   *
   * นิยามของข้อนี้เขียนว่า "ร้อยละของผู้ป่วยโรคไตเรื้อรังระดับ 3 ขึ้นไปที่ได้รับยา
   * NSAIDs" ตัวหารจึงเป็นจำนวนคน ไม่ใช่จำนวนครั้ง — ต่างจากตัวชี้วัดกลุ่มยาปฏิชีวนะ
   * ที่นับตามครั้งที่มารับบริการ ถ้าหารด้วยจำนวนครั้งจะได้ตัวเลขที่ต่ำกว่าความจริง
   * เพราะผู้ป่วย CKD มาโรงพยาบาลบ่อยกว่าคนทั่วไปมาก
   */
  const percent = useMemo(() => {
    if (report == null || report.denominatorPatients === 0) return null
    return (report.casePatients * 100) / report.denominatorPatients
  }, [report])

  const cases = report?.cases ?? []

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
      'eGFR ล่าสุด',
      'วันที่ตรวจ eGFR',
      'ระยะโรคไต',
      'รหัสวินิจฉัย CKD',
      'รายการ NSAIDs ที่ได้รับ',
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
      row.egfr == null ? '' : String(row.egfr),
      toThaiDate(row.egfrDate),
      stageOf(row.egfr)?.label ?? '',
      row.ckdCodes.join(' '),
      row.drugs.join(' / '),
    ])

    const blob = new Blob([toCsv([header, ...body])], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `NSAIDs-ในผู้ป่วยโรคไตเรื้อรัง-${range[0].format('YYYY-MM-DD')}-ถึง-${range[1].format('YYYY-MM-DD')}.csv`
    link.click()
    // คืนหน่วยความจำของ blob หลังเบราว์เซอร์เริ่มดาวน์โหลดแล้ว
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success(`ส่งออก ${body.length} รายการแล้ว`)
  }

  const columns: ColumnsType<CkdNsaidCase> = [
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
      title: 'eGFR ล่าสุด',
      dataIndex: 'egfr',
      width: 150,
      /* วันที่ของผลอยู่ใต้ตัวเลข ไม่ได้แยกคอลัมน์ — ค่าไตที่ตรวจไว้เมื่อสองปีก่อน
         กับที่ตรวจเมื่อเดือนที่แล้วมีน้ำหนักต่างกันมาก คนอ่านต้องเห็นคู่กันเสมอ */
      render: (egfr: number | null, row) => {
        const stage = stageOf(egfr)
        if (egfr == null || stage == null) {
          return (
            <Text type="secondary" className="text-xs">
              ไม่มีผลแล็บ
            </Text>
          )
        }
        return (
          <div className="leading-tight">
            <span className="qty text-sm font-semibold text-ink">{egfr.toFixed(1)}</span>
            <Tag color={stage.color} className="ml-1.5 mr-0!">
              {stage.label}
            </Tag>
            <div className="text-[11px] text-ink-3">{toThaiDate(row.egfrDate)}</div>
          </div>
        )
      },
    },
    {
      title: 'รหัสวินิจฉัย CKD',
      dataIndex: 'ckdCodes',
      width: 150,
      render: (codes: string[]) =>
        codes.length === 0 ? (
          /* เข้าตัวหารด้วยผลแล็บอย่างเดียว — บอกไว้ให้ชัด ไม่ใช่ปล่อยเป็นขีดว่าง
             เพราะเคสกลุ่มนี้คือกลุ่มที่ยังไม่ถูกลงรหัสโรคไต ซึ่งเป็นประเด็นของตัวเอง */
          <Tooltip title="ไม่เคยถูกลงรหัสโรคไตเรื้อรัง เข้าเกณฑ์จากผลค่าไตอย่างเดียว">
            <Tag className="mr-0! text-[11px]">จากผลแล็บ</Tag>
          </Tooltip>
        ) : (
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
      title: 'รายการ NSAIDs ที่ได้รับ',
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
            { title: 'NSAIDs ในผู้ป่วยโรคไตเรื้อรัง' },
          ]}
        />
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          <MonitorOutlined /> การใช้ยา NSAIDs ในผู้ป่วยโรคไตเรื้อรัง
        </Title>
        <div className="mb-2 h-px w-24 bg-linear-to-r from-violet-400/70 to-transparent" />
        <Paragraph type="secondary" style={{ maxWidth: 860, marginBottom: 0, fontSize: 12 }}>
          ผู้ป่วยนอกที่เป็นโรคไตเรื้อรังระดับ 3 ขึ้นไป และได้รับยากลุ่ม NSAIDs ในช่วงวันที่ที่เลือก
          — ตารางแสดงเฉพาะเคสที่ต้องทบทวน ส่วนตัวหารทั้งหมดอยู่บนการ์ดด้านบน
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
          ช่วงวันที่ = วันที่มารับบริการ เลือกได้ไม่เกิน 366 วัน · แสดงสูงสุด 3,000 เคส ·
          ไม่นับครั้งที่รับไว้เป็นผู้ป่วยใน ·
          คิวรีข้อนี้หนักกว่าตัวชี้วัดข้ออื่น เพราะต้องไล่ค่าไตล่าสุดของทุกครั้งที่มา —
          การดูทั้งปีงบประมาณใช้เวลาราวยี่สิบวินาที
        </Text>
      </div>

      {error && <Alert type="error" showIcon title={error} className="mb-4" />}

      {/* ทะเบียนยาว่าง = ไม่มีเกณฑ์ว่าตัวไหนคือ NSAIDs ตารางจะว่างทั้งที่มีผู้ป่วยอยู่
          ต้องบอกว่าเป็นเพราะยังไม่ได้ตั้งค่า ไม่ใช่เพราะโรงพยาบาลไม่ได้จ่ายยาเลย */}
      {report && report.drugItems === 0 && (
        <Alert
          type="warning"
          showIcon
          className="mb-4"
          title="ยังไม่ได้ตั้งค่าทะเบียนยา NSAIDs รายงานจึงว่างเปล่า"
          description={
            <span className="text-xs leading-relaxed">
              เลือกรายการยาที่นับเป็น NSAIDs ก่อนที่{' '}
              <Link href={SETTINGS_DRUG} className="text-accent">
                หน้าตั้งค่ายา NSAIDs
              </Link>
            </span>
          }
        />
      )}

      {/* ทะเบียนวินิจฉัยว่างไม่ทำให้รายงานพัง เพราะยังมีทางผลแล็บอยู่ แต่ตัวหาร
          จะขาดคนที่ถูกลงรหัสไว้โดยไม่เคยเจาะเลือดที่นี่ — เตือนแบบไม่ปิดกั้น */}
      {report && report.diagnosisCodes === 0 && (
        <Alert
          type="info"
          showIcon
          className="mb-4"
          title="ยังไม่ได้ตั้งค่าทะเบียนรหัสวินิจฉัยโรคไตเรื้อรัง ตัวหารจึงมาจากผลค่าไตอย่างเดียว"
          description={
            <span className="text-xs leading-relaxed">
              ผู้ป่วยที่ถูกลงรหัส N18 ไว้แต่ไม่เคยตรวจค่าไตที่โรงพยาบาลนี้จะไม่ถูกนับ — เลือกรหัสได้ที่{' '}
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
          title="เคสยาวเกินกว่าที่แสดงได้ในครั้งเดียว จึงตัดไว้ที่ 3,000 เคสล่าสุด"
          description={
            <span className="text-xs leading-relaxed">
              แบ่งช่วงวันที่ให้สั้นลงเพื่อดูให้ครบ — ร้อยละบนการ์ดคำนวณจากเคสที่แสดงอยู่เท่านั้น
              จึงต่ำกว่าความจริง
            </span>
          }
        />
      )}

      <Spin spinning={loading}>
        {report ? (
          <>
            <section className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="ผู้ป่วยโรคไตเรื้อรังระดับ 3 ขึ้นไป"
                value={`${report.denominatorPatients.toLocaleString('th-TH')}`}
                unit="คน"
                hint={`มารับบริการรวม ${report.denominatorVisits.toLocaleString('th-TH')} ครั้ง`}
              />
              <StatCard
                label="ได้รับยา NSAIDs"
                value={`${report.casePatients.toLocaleString('th-TH')}`}
                unit="คน"
                hint={`รวม ${cases.length.toLocaleString('th-TH')} ครั้งที่ได้รับยา`}
              />
              <StatCard
                label="ร้อยละที่ได้รับ NSAIDs"
                value={percent == null ? '—' : percent.toFixed(1)}
                unit={percent == null ? '' : '%'}
                hint="คิดจากรายผู้ป่วย ตามนิยามของตัวชี้วัด"
              />
              <StatCard
                label="เกณฑ์ที่ใช้แบ่งระยะ"
                value={`< ${report.egfrThreshold}`}
                unit="eGFR"
                hint="หรือเคยถูกลงรหัสวินิจฉัยในทะเบียน"
              />
            </section>

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
              <Table<CkdNsaidCase>
                rowKey="vn"
                size="small"
                columns={columns}
                dataSource={cases}
                pagination={{ pageSize: 50, showSizeChanger: false }}
                scroll={{ x: 'max-content' }}
                locale={{
                  emptyText: (
                    <Empty description="ไม่พบผู้ป่วยโรคไตเรื้อรังที่ได้รับยา NSAIDs ในช่วงวันที่ที่เลือก" />
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
        drugLabel="NSAIDs"
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
  /** บรรทัดเล็กใต้ตัวเลข — ข้อนี้มีทั้งจำนวนคนและจำนวนครั้ง ต้องเห็นคู่กันไม่ให้อ่านสลับ */
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
