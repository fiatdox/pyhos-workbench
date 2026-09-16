'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ยังทำที่ app/home/rdu/layout.tsx ซึ่งเป็น Server Component)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  Empty,
  Progress,
  Segmented,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import {
  BarChartOutlined,
  FileExcelOutlined,
  ReloadOutlined,
  RightOutlined,
  StopOutlined,
} from '@ant-design/icons'
import { apiFetch } from '@/lib/client/session'
import { GapChart, meetsTarget, YearlyChart, type YearPoint } from './charts'

const { Paragraph, Text, Title } = Typography

/**
 * หน้าสรุปเปรียบเทียบตัวชี้วัด RDU สามปีงบประมาณ
 *
 * ต่างจากหน้าวิเคราะห์ตรงคำถาม — หน้านั้นเจาะข้อเดียวว่าตัวเลขมาจากห้องตรวจไหน
 * ส่วนหน้านี้ตอบว่าทั้งชุดดีขึ้นหรือแย่ลง และข้อไหนยังไม่ถึงเกณฑ์ เป็นหน้าที่
 * เอาขึ้นจอในที่ประชุมคณะกรรมการ ไม่ใช่หน้าที่ใช้ตามเคส
 *
 * ตัวเลขมาจากตารางแคช ไม่ได้คำนวณสด — สิบข้อคูณสามปีใช้เวลาราวสองนาที
 * (เหตุผลเต็มอยู่ที่ lib/his/rdu-yearly.ts) หน้าจอจึงเป็นคนไล่สั่งคำนวณทีละช่อง
 * แล้วแสดงความคืบหน้า ผู้ใช้จะได้เห็นว่าเหลืออีกเท่าไรและกดหยุดกลางคันได้
 */

/** ข้อมูลของตัวชี้วัดหนึ่งข้อที่เซิร์ฟเวอร์ส่งมา */
type Indicator = {
  name: string
  label: string
  short: string
  group: 'antibiotic' | 'chronic' | 'special' | 'prescribing'
  unit: 'visits' | 'patients' | 'admissions' | 'items'
  goal: 'low' | 'high'
  target: number | null
  reportHref: string
}

type YearlyRow = {
  indicator: string
  fiscalYear: number
  numerator: number
  denominator: number
  partial: boolean
  computedAt: string | null
}

const GROUP_LABEL: Record<Indicator['group'], string> = {
  antibiotic: 'กลุ่มยาปฏิชีวนะ',
  chronic: 'กลุ่มโรคเรื้อรัง',
  special: 'กลุ่มผู้ป่วยพิเศษ',
  prescribing: 'ภาพรวมการสั่งใช้ยา',
}

const GROUP_ORDER: Indicator['group'][] = ['antibiotic', 'chronic', 'special', 'prescribing']

/** หน่วยของตัวหาร — ข้อความเดียวกันนี้ใช้ทั้งบนการ์ด ในกราฟ และในไฟล์ที่ส่งออก */
const UNIT_LABEL: Record<Indicator['unit'], string> = {
  visits: 'ครั้ง',
  patients: 'คน',
  admissions: 'ราย',
  items: 'รายการยา',
}

/** ใส่ BOM เพราะ Excel บนวินโดวส์เดาว่า CSV เป็น CP874 */
function toCsv(rows: string[][]): string {
  const cell = (value: string) => `"${value.replace(/"/g, '""')}"`
  return '﻿' + rows.map(row => row.map(cell).join(',')).join('\r\n')
}

type Filter = 'all' | 'missing' | 'failing'

export default function RduSummaryPage() {
  const [indicators, setIndicators] = useState<Indicator[]>([])
  const [years, setYears] = useState<number[]>([])
  const [rows, setRows] = useState<YearlyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  /** ช่องที่กำลังคำนวณอยู่ และคิวที่เหลือ */
  const [running, setRunning] = useState<{ done: number; total: number; now: string } | null>(null)
  const stop = useRef(false)
  const [toast, toastHolder] = message.useMessage()

  const apply = useCallback((json: Record<string, unknown>) => {
    setIndicators(json.indicators as Indicator[])
    setYears(json.years as number[])
    setRows(json.results as YearlyRow[])
  }, [])

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const res = await apiFetch('/api/his/rdu/yearly')
        const json = await res.json()
        if (!alive) return
        if (!res.ok || !json.success) {
          setError(json.message ?? 'ดึงผลตัวชี้วัดไม่สำเร็จ')
          return
        }
        apply(json as Record<string, unknown>)
      } catch {
        if (alive) setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
      } finally {
        if (alive) setLoading(false)
      }
    }
    void load()
    return () => {
      alive = false
    }
  }, [apply])

  /** ผลของช่องหนึ่ง — คีย์เป็น "ตัวชี้วัด|ปี" เพื่อค้นได้ในครั้งเดียว */
  const byCell = useMemo(() => {
    const map = new Map<string, YearlyRow>()
    for (const row of rows) map.set(`${row.indicator}|${row.fiscalYear}`, row)
    return map
  }, [rows])

  const pointsOf = useCallback(
    (indicator: Indicator): YearPoint[] =>
      years.map(year => {
        const row = byCell.get(`${indicator.name}|${year}`)
        if (row == null) {
          return { year, percent: null, numerator: 0, denominator: 0, partial: false, missing: true }
        }
        return {
          year,
          percent: row.denominator === 0 ? null : (row.numerator * 100) / row.denominator,
          numerator: row.numerator,
          denominator: row.denominator,
          partial: row.partial,
          missing: false,
        }
      }),
    [byCell, years],
  )

  /**
   * คำนวณทีละช่องตามคิว
   *
   * ยิงทีละคำขอ ไม่ได้ยิงพร้อมกัน — คิวรีพวกนี้หนักกับฐาน HIS ซึ่งเป็นฐานที่
   * ห้องตรวจใช้งานจริงอยู่ ยิงขนานกันสิบคำขอเท่ากับทำให้ระบบงานประจำช้าไปด้วย
   */
  const compute = async (cells: { indicator: string; fiscalYear: number }[]) => {
    if (cells.length === 0) {
      toast.info('ไม่มีช่องที่ต้องคำนวณ')
      return
    }
    stop.current = false
    setRunning({ done: 0, total: cells.length, now: '' })

    let done = 0
    let failed = 0
    for (const cell of cells) {
      if (stop.current) break
      const label = indicators.find(item => item.name === cell.indicator)?.short ?? cell.indicator
      setRunning({ done, total: cells.length, now: `${label} · ปีงบ ${cell.fiscalYear}` })
      try {
        const res = await apiFetch('/api/his/rdu/yearly', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cell),
        })
        const json = await res.json()
        if (!res.ok || !json.success) failed += 1
      } catch {
        failed += 1
      }
      done += 1
    }

    setRunning(null)

    /* อ่านผลทั้งชุดใหม่รอบเดียวตอนจบ ไม่ได้ทยอยยัดทีละช่อง — computed_at มาจาก
       ฐาน การเดาเองฝั่งหน้าจอจะทำให้เวลาที่แสดงไม่ตรงกับที่บันทึกจริง */
    try {
      const res = await apiFetch('/api/his/rdu/yearly')
      const json = await res.json()
      if (res.ok && json.success) apply(json as Record<string, unknown>)
    } catch {
      /* ปล่อยให้ค่าเดิมค้างไว้ ดีกว่าล้างทิ้งทั้งหน้าเพราะอ่านซ้ำไม่สำเร็จ */
    }

    if (stop.current) toast.info(`หยุดแล้ว — คำนวณไปได้ ${done} จาก ${cells.length} ช่อง`)
    else if (failed > 0) toast.warning(`คำนวณเสร็จ แต่มี ${failed} ช่องที่ล้มเหลว`)
    else toast.success(`คำนวณครบ ${done} ช่องแล้ว`)
  }

  const allCells = useMemo(
    () => indicators.flatMap(item => years.map(year => ({ indicator: item.name, fiscalYear: year }))),
    [indicators, years],
  )

  const missingCells = useMemo(
    () => allCells.filter(cell => !byCell.has(`${cell.indicator}|${cell.fiscalYear}`)),
    [allCells, byCell],
  )

  /** ปีล่าสุดที่มีข้อมูลของตัวชี้วัดข้อนั้น — ใช้ตัดสินว่าตอนนี้ผ่านเกณฑ์หรือยัง */
  const latestOf = useCallback(
    (indicator: Indicator) => {
      for (let i = years.length - 1; i >= 0; i -= 1) {
        const row = byCell.get(`${indicator.name}|${years[i]}`)
        if (row != null && row.denominator > 0) {
          return { year: years[i], percent: (row.numerator * 100) / row.denominator, row }
        }
      }
      return null
    },
    [byCell, years],
  )

  const shown = useMemo(() => {
    if (filter === 'all') return indicators
    if (filter === 'missing') {
      return indicators.filter(item =>
        years.some(year => !byCell.has(`${item.name}|${year}`)),
      )
    }
    return indicators.filter(item => {
      const latest = latestOf(item)
      return meetsTarget(latest?.percent ?? null, item.target, item.goal) === false
    })
  }, [filter, indicators, years, byCell, latestOf])

  /** แถวของกราฟภาพรวม — เฉพาะข้อที่มีทั้งเกณฑ์และตัวเลข */
  const gapRows = useMemo(
    () =>
      indicators
        .flatMap(item => {
          const latest = latestOf(item)
          if (latest == null || item.target == null) return []
          const gap =
            item.goal === 'low' ? item.target - latest.percent : latest.percent - item.target
          return [
            {
              label: item.short,
              gap,
              percent: latest.percent,
              target: item.target,
              goal: item.goal,
            },
          ]
        })
        .sort((a, b) => a.gap - b.gap),
    [indicators, latestOf],
  )

  const exportCsv = () => {
    if (rows.length === 0) {
      toast.info('ยังไม่มีผลให้ส่งออก')
      return
    }
    const header = ['ตัวชี้วัด', 'กลุ่ม', 'เกณฑ์', 'หน่วย', ...years.map(y => `ปีงบ ${y}`)]
    const body = indicators.map(item => [
      item.label,
      GROUP_LABEL[item.group],
      item.target == null
        ? 'ยังไม่ได้ตั้งเกณฑ์'
        : `${item.goal === 'low' ? 'ไม่เกิน' : 'ตั้งแต่'} ${item.target}%`,
      UNIT_LABEL[item.unit],
      ...years.map(year => {
        const row = byCell.get(`${item.name}|${year}`)
        if (row == null) return 'ยังไม่ได้คำนวณ'
        if (row.denominator === 0) return 'ไม่มีข้อมูล'
        const percent = (row.numerator * 100) / row.denominator
        return `${percent.toFixed(2)}% (${row.numerator}/${row.denominator})${row.partial ? ' ยังไม่จบปี' : ''}`
      }),
    ])

    const blob = new Blob([toCsv([header, ...body])], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `สรุปตัวชี้วัด-RDU-${years[0]}-ถึง-${years[years.length - 1]}.csv`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success('ส่งออกแล้ว')
  }

  /** เวลาคำนวณล่าสุดของทั้งหน้า — บอกว่าเลขที่เห็นเก่าแค่ไหน */
  const lastComputed = useMemo(() => {
    const stamps = rows.map(row => row.computedAt).filter((s): s is string => s != null)
    return stamps.length === 0 ? null : stamps.sort()[stamps.length - 1]
  }, [rows])

  return (
    <>
      {toastHolder}

      <section className="mb-6">
        <Breadcrumb
          className="mb-2"
          items={[
            { title: <Link href="/home/rdu">RDU ติดตามตัวชี้วัดการใช้ยา</Link> },
            { title: 'สรุปเปรียบเทียบ 3 ปี' },
          ]}
        />
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          <BarChartOutlined /> สรุปเปรียบเทียบตัวชี้วัด 3 ปีงบประมาณ
        </Title>
        <div className="mb-2 h-px w-24 bg-linear-to-r from-violet-400/70 to-transparent" />
        <Paragraph type="secondary" style={{ maxWidth: 900, marginBottom: 0, fontSize: 12 }}>
          ตัวชี้วัดทุกข้อเทียบกับเกณฑ์ของตัวเอง ย้อนหลัง {years.length || 3} ปีงบประมาณ —
          แท่งเขียวคือผ่านเกณฑ์ แดงคือยังไม่ถึง ม่วงคือยังไม่ได้ตั้งเกณฑ์ไว้
          เครื่องหมาย * ท้ายปีแปลว่าปีงบนั้นยังไม่จบ ตัวเลขจึงยังไม่ครบปี
        </Paragraph>
      </section>

      {error && <Alert type="error" showIcon title={error} className="mb-4" />}

      {/* ตัวเลขมาจากแคช ต้องบอกให้ชัดว่าเก่าแค่ไหน ไม่งั้นคนจะเข้าใจว่าเป็นสดเสมอ */}
      <Alert
        type="info"
        showIcon
        className="mb-4"
        title={
          lastComputed == null
            ? 'ยังไม่เคยคำนวณ — กดปุ่มคำนวณเพื่อสร้างตัวเลขครั้งแรก'
            : `ตัวเลขคำนวณไว้ล่าสุดเมื่อ ${lastComputed} น.`
        }
        description={
          <span className="text-xs leading-relaxed">
            หน้านี้อ่านผลที่คำนวณเก็บไว้ ไม่ได้คำนวณสดทุกครั้งที่เปิด เพราะทั้งตารางใช้เวลาราวสองนาที
            — ปีที่ปิดไปแล้วตัวเลขไม่เปลี่ยนอีก ยกเว้นมีคนแก้ทะเบียนหรือเกณฑ์อายุ
            ซึ่งต้องกดคำนวณใหม่เอง
          </span>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Space.Compact>
          <Button
            type="primary"
            icon={<ReloadOutlined />}
            disabled={running != null || indicators.length === 0}
            onClick={() => void compute(allCells)}
          >
            คำนวณใหม่ทั้งหมด ({allCells.length} ช่อง)
          </Button>
          <Button
            icon={<ReloadOutlined />}
            disabled={running != null || missingCells.length === 0}
            onClick={() => void compute(missingCells)}
          >
            เฉพาะที่ยังไม่มี ({missingCells.length})
          </Button>
        </Space.Compact>

        {running != null && (
          <Button danger icon={<StopOutlined />} onClick={() => (stop.current = true)}>
            หยุด
          </Button>
        )}

        <Tooltip title="ได้ตารางร้อยละทุกข้อทุกปี เปิดใน Excel ได้ตรง ๆ">
          <Button icon={<FileExcelOutlined />} onClick={exportCsv} disabled={rows.length === 0}>
            ส่งออก Excel
          </Button>
        </Tooltip>

        <Link href="/home/rdu/settings/age-criteria" className="text-xs text-accent">
          ตั้งเกณฑ์เป้าหมายและเกณฑ์อายุ
        </Link>
      </div>

      {running != null && (
        <div className="mb-5 rounded-xl border border-line bg-panel px-4 py-3 backdrop-blur">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-3">
            <span>กำลังคำนวณ: {running.now || 'เตรียมคิว'}</span>
            <span className="qty">
              {running.done} / {running.total} ช่อง
            </span>
          </div>
          <Progress
            percent={Math.round((running.done * 100) / Math.max(running.total, 1))}
            status="active"
            showInfo={false}
          />
          <Text type="secondary" className="mt-1 block text-[11px]">
            ยิงทีละช่องเพื่อไม่ให้ฐาน HIS ที่ห้องตรวจใช้งานอยู่ช้าไปด้วย — ปิดหน้านี้แล้วจะหยุดกลางคัน
            ช่องที่คำนวณไปแล้วยังอยู่
          </Text>
        </div>
      )}

      <Spin spinning={loading}>
        {indicators.length === 0 && !loading ? (
          <div className="rounded-2xl border border-line bg-panel py-16 backdrop-blur-md">
            <Empty description="ไม่มีตัวชี้วัด" />
          </div>
        ) : (
          <>
            {gapRows.length > 0 && (
              <Card
                variant="borderless"
                className="mb-5 border! border-line!"
                title={
                  <span className="text-sm font-semibold text-ink">
                    ภาพรวม — ห่างจากเกณฑ์กี่จุด (ปีล่าสุดที่มีข้อมูล)
                  </span>
                }
              >
                <Paragraph type="secondary" style={{ fontSize: 11, marginBottom: 8 }}>
                  ร้อยละดิบของแต่ละข้อเทียบกันตรง ๆ ไม่ได้ เพราะบางข้อเกณฑ์คือ
                  &ldquo;ไม่เกิน&rdquo; บางข้อคือ &ldquo;ตั้งแต่&rdquo; — กราฟนี้จึงวัดระยะห่างจาก
                  เกณฑ์ของตัวเองแทน แท่งไปทางขวาคือดีกว่าเกณฑ์ ไปทางซ้ายคือยังไม่ถึง
                  (ข้อที่ยังไม่ได้ตั้งเกณฑ์จะไม่อยู่ในกราฟนี้)
                </Paragraph>
                <GapChart rows={gapRows} />
              </Card>
            )}

            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Segmented<Filter>
                value={filter}
                onChange={setFilter}
                options={[
                  { label: `ทั้งหมด (${indicators.length})`, value: 'all' },
                  {
                    label: `ยังไม่ถึงเกณฑ์ (${
                      indicators.filter(
                        item =>
                          meetsTarget(latestOf(item)?.percent ?? null, item.target, item.goal) ===
                          false,
                      ).length
                    })`,
                    value: 'failing',
                  },
                  {
                    label: `ข้อมูลไม่ครบ (${
                      indicators.filter(item =>
                        years.some(year => !byCell.has(`${item.name}|${year}`)),
                      ).length
                    })`,
                    value: 'missing',
                  },
                ]}
              />
            </div>

            {GROUP_ORDER.map(group => {
              const items = shown.filter(item => item.group === group)
              if (items.length === 0) return null
              return (
                <section key={group} className="mb-6">
                  <h3 className="mb-3 text-sm font-semibold text-ink-2">{GROUP_LABEL[group]}</h3>
                  <div className="grid gap-4 xl:grid-cols-2">
                    {items.map(item => {
                      const latest = latestOf(item)
                      const pass = meetsTarget(latest?.percent ?? null, item.target, item.goal)
                      return (
                        <Card
                          key={item.name}
                          variant="borderless"
                          className="border! border-line!"
                          title={
                            <div className="py-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold text-ink whitespace-normal">
                                  {item.label}
                                </span>
                                {pass === true && (
                                  <Tag color="green" className="mr-0!">
                                    ผ่านเกณฑ์
                                  </Tag>
                                )}
                                {pass === false && (
                                  <Tag color="red" className="mr-0!">
                                    ยังไม่ถึงเกณฑ์
                                  </Tag>
                                )}
                                {item.target == null && (
                                  <Tag className="mr-0!">ยังไม่ได้ตั้งเกณฑ์</Tag>
                                )}
                              </div>
                              <div className="mt-0.5 text-[11px] font-normal text-ink-3">
                                นับเป็น{UNIT_LABEL[item.unit]}
                                {item.target != null &&
                                  ` · เกณฑ์${item.goal === 'low' ? 'ไม่เกิน' : 'ตั้งแต่'} ${item.target}%`}
                                {latest != null && ` · ปีล่าสุด ${latest.percent.toFixed(2)}%`}
                              </div>
                            </div>
                          }
                          extra={
                            <Link
                              href={item.reportHref}
                              className="whitespace-nowrap text-xs text-accent"
                            >
                              ดูรายเคส <RightOutlined className="text-[10px]" />
                            </Link>
                          }
                        >
                          <YearlyChart
                            points={pointsOf(item)}
                            target={item.target}
                            goal={item.goal}
                            unit={item.unit}
                          />
                        </Card>
                      )
                    })}
                  </div>
                </section>
              )
            })}

            {shown.length === 0 && (
              <div className="rounded-2xl border border-line bg-panel py-16 backdrop-blur-md">
                <Empty description="ไม่มีตัวชี้วัดในกลุ่มที่กรองอยู่" />
              </div>
            )}
          </>
        )}
      </Spin>
    </>
  )
}
