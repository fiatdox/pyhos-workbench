'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ยังทำที่ app/home/rdu/layout.tsx ซึ่งเป็น Server Component)
import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  DatePicker,
  Empty,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd'
import { DashboardOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import buddhistEra from 'dayjs/plugin/buddhistEra'
import { apiFetch } from '@/lib/client/session'
import { BreakdownChart, DrugChart, TrendChart, type Bucket } from './charts'

// เปิด token BBBB (ปี พ.ศ.) ให้ dayjs — ถ้าไม่ extend ปฏิทินจะพิมพ์คำว่า BBBB ออกมาตรง ๆ
dayjs.extend(buddhistEra)

const { Paragraph, Text, Title } = Typography
const { RangePicker } = DatePicker

/* ───────────── ตัวชี้วัดที่เปิดวิเคราะห์ได้ ─────────────
   ต้องตรงกับ REPORTS ใน lib/his/rdu-visit-report.ts — ป้ายกำกับซ้ำกับหน้ารายงาน
   แต่ import ข้ามมาไม่ได้เพราะโมดูลนั้นเป็น server-only */

type Indicator = {
  kind: string
  label: string
  short: string
  drugLabel: string
  /** ทิศทาง — 'with' = ยิ่งได้รับยายิ่งต้องทบทวน */
  followUp: 'with' | 'without'
  /** เกณฑ์เป้าหมายเป็นร้อยละ ถ้ามีกำหนดไว้ */
  target?: number
  reportHref: string
}

const INDICATORS: Indicator[] = [
  {
    kind: 'ri',
    label: 'โรคติดเชื้อทางเดินหายใจส่วนบน (RI)',
    short: 'RI',
    drugLabel: 'ยาปฏิชีวนะ',
    followUp: 'with',
    reportHref: '/home/rdu/reports/ri',
  },
  {
    kind: 'ad',
    label: 'โรคอุจจาระร่วงเฉียบพลัน (AD)',
    short: 'AD',
    drugLabel: 'ยาปฏิชีวนะ',
    followUp: 'with',
    reportHref: '/home/rdu/reports/ad',
  },
  {
    kind: 'apl',
    label: 'บาดแผลสดจากอุบัติเหตุ (APL)',
    short: 'APL',
    drugLabel: 'ยาปฏิชีวนะ',
    followUp: 'with',
    reportHref: '/home/rdu/reports/apl',
  },
  {
    kind: 'asthma',
    label: 'ผู้ป่วยโรคหืดที่ได้รับยา ICS',
    short: 'โรคหืด',
    drugLabel: 'ยา ICS',
    followUp: 'without',
    reportHref: '/home/rdu/reports/asthma',
  },
  {
    kind: 'glibenclamide-elderly',
    label: 'ผู้ป่วยเบาหวานสูงอายุกับยา glibenclamide',
    short: 'glibenclamide',
    drugLabel: 'ยา glibenclamide',
    followUp: 'with',
    reportHref: '/home/rdu/reports/glibenclamide-elderly',
  },
  {
    kind: 'ruauri-child',
    label: 'ผู้ป่วยเด็ก RUA-URI กับยาต้านฮิสตามีน',
    short: 'เด็ก RUA-URI',
    drugLabel: 'ยาต้านฮิสตามีน',
    followUp: 'with',
    // เกณฑ์ตามเอกสารตัวชี้วัดที่ 18
    target: 20,
    reportHref: '/home/rdu/reports/ruauri-child',
  },
]

/** ข้อมูลรายครั้งแบบย่อที่เซิร์ฟเวอร์ส่งมา (ดู lib/his/rdu-dashboard.ts) */
type Facts = {
  departments: string[]
  doctors: string[]
  codes: { code: string; name: string }[]
  drugs: { icode: string; name: string }[]
  visits: { d: string; dep: number; doc: number; dx: number[]; rx: number[] }[]
  maxAgeYears: number | null
  minAgeYears: number | null
  truncated: boolean
}

/**
 * ปีงบประมาณไทย — 1 ต.ค. ปีก่อนหน้า ถึง 30 ก.ย. ของปีนั้น
 *
 * ปีงบ 2569 = 1 ต.ค. 2568 ถึง 30 ก.ย. 2569 (ค.ศ. 2025-10-01 ถึง 2026-09-30)
 * ความยาว 365 วัน จึงยังอยู่ในเพดาน 366 วันของ API
 */
function fiscalYearRange(buddhistYear: number): [Dayjs, Dayjs] {
  const endYear = buddhistYear - 543
  return [dayjs(`${endYear - 1}-10-01`), dayjs(`${endYear}-09-30`)]
}

/** ปีงบประมาณที่วันนี้อยู่ — ตั้งแต่ 1 ต.ค. ถือว่าเข้าปีงบถัดไปแล้ว */
function currentFiscalYear(): number {
  const now = dayjs()
  return now.year() + 543 + (now.month() >= 9 ? 1 : 0)
}

/** ตัวเลือกปีงบประมาณย้อนหลัง 5 ปี */
const FISCAL_YEARS = Array.from({ length: 5 }, (_, index) => currentFiscalYear() - index)

const THAI_MONTHS = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
]

/** 'YYYY-MM' → 'ส.ค. 68' */
const monthLabel = (ym: string) => {
  const [year, month] = ym.split('-')
  return `${THAI_MONTHS[Number(month) - 1]} ${String(Number(year) + 543).slice(2)}`
}

/** ตัดป้ายยาว ๆ ให้พอดีแกนกราฟ — ชื่อยาในฐานยาวเป็นร้อยตัวอักษร */
const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`

/** จำนวนแท่งสูงสุดต่อกราฟหนึ่งมิติ — ที่เหลือยุบเป็น "อื่น ๆ" */
const TOP_N = 12

const NONE_LABEL = '— ไม่ระบุ —'

/**
 * หน้าวิเคราะห์ตัวชี้วัด RDU
 *
 * ดึงข้อมูลรายครั้งของช่วงที่เลือกมาครั้งเดียว แล้วกรองและรวมยอดในเบราว์เซอร์ —
 * การกดเปลี่ยนตัวกรองจึงเปลี่ยนทันทีโดยไม่ต้องรอฐาน (คิวรีรวมข้อมูลหนึ่งปีงบ
 * ใช้เวลาราวสองวินาที ถ้ายิงใหม่ทุกครั้งที่กดกรองจะใช้งานไม่ได้)
 *
 * ตัวกรองทั้งสี่มุมทำงานร่วมกันแบบ "และ" และรายการตัวเลือกของแต่ละมุมสร้างจาก
 * ข้อมูลทั้งช่วง ไม่ใช่จากผลที่กรองแล้ว — ไม่งั้นพอเลือกมุมหนึ่ง ตัวเลือกของมุมอื่น
 * จะหดจนเปลี่ยนใจไม่ได้
 */
export default function RduDashboardPage() {
  const [indicator, setIndicator] = useState<Indicator>(INDICATORS[0])
  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => fiscalYearRange(currentFiscalYear()))
  const [facts, setFacts] = useState<Facts | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  /** ตัวกรองเก็บเป็นหมายเลขในพจนานุกรม null = ไม่กรองมุมนั้น */
  const [dep, setDep] = useState<number | null>(null)
  const [doc, setDoc] = useState<number | null>(null)
  const [dx, setDx] = useState<number | null>(null)
  const [rx, setRx] = useState<number | null>(null)

  const clearFilters = () => {
    setDep(null)
    setDoc(null)
    setDx(null)
    setRx(null)
  }

  const load = async (next: Indicator, nextRange: [Dayjs, Dayjs]) => {
    setLoading(true)
    setError('')
    try {
      const from = nextRange[0].format('YYYY-MM-DD')
      const to = nextRange[1].format('YYYY-MM-DD')
      const res = await apiFetch(`/api/his/rdu/dashboard/${next.kind}?from=${from}&to=${to}`)
      const json = await res.json()
      if (!res.ok || !json.success) {
        setError(json.message ?? 'ดึงข้อมูลวิเคราะห์ไม่สำเร็จ')
        return
      }
      setFacts(json as Facts)
      // พจนานุกรมชุดใหม่ หมายเลขเดิมจะชี้ผิดตัว ต้องล้างตัวกรองทิ้ง
      clearFilters()
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setLoading(false)
    }
  }

  /** ครั้งที่ผ่านตัวกรองทั้งสี่มุม */
  const visible = useMemo(() => {
    const all = facts?.visits ?? []
    return all.filter(
      visit =>
        (dep == null || visit.dep === dep) &&
        (doc == null || visit.doc === doc) &&
        (dx == null || visit.dx.includes(dx)) &&
        (rx == null || visit.rx.includes(rx)),
    )
  }, [facts, dep, doc, dx, rx])

  const stats = useMemo(() => {
    const withDrug = visible.filter(visit => visit.rx.length > 0).length
    return {
      total: visible.length,
      withDrug,
      without: visible.length - withDrug,
      percent: visible.length === 0 ? null : (withDrug * 100) / visible.length,
    }
  }, [visible])

  /**
   * รวมยอดตามมิติหนึ่ง
   *
   * pick คืนหมายเลขของกลุ่มที่แถวนั้นสังกัด — คืนหลายค่าได้ (รหัสโรคหนึ่งครั้งมี
   * ได้หลายรหัส) กรณีนั้นหนึ่งครั้งจะถูกนับในทุกกลุ่มที่เกี่ยวข้อง ยอดรวมของกราฟ
   * จึงมากกว่าจำนวนครั้งจริงได้ ซึ่งถูกต้องสำหรับคำถาม "รหัสนี้เจอกี่ครั้ง"
   */
  const bucketsBy = useMemo(
    () =>
      (pick: (visit: Facts['visits'][number]) => number[], names: string[]): Bucket[] => {
        const totals = new Map<number, Bucket>()
        for (const visit of visible) {
          const received = visit.rx.length > 0
          for (const key of pick(visit)) {
            const bucket = totals.get(key) ?? {
              label: key === -1 ? NONE_LABEL : (names[key] ?? `#${key}`),
              total: 0,
              withDrug: 0,
            }
            bucket.total += 1
            if (received) bucket.withDrug += 1
            totals.set(key, bucket)
          }
        }
        return [...totals.values()].sort((a, b) => b.total - a.total)
      },
    [visible],
  )

  /** ตัดเหลือ TOP_N แล้วยุบส่วนที่เหลือเป็นแท่งเดียว */
  const topOf = (buckets: Bucket[]): Bucket[] => {
    if (buckets.length <= TOP_N) return [...buckets].reverse()
    const head = buckets.slice(0, TOP_N)
    const rest = buckets.slice(TOP_N)
    head.push({
      label: `อื่น ๆ (${rest.length} รายการ)`,
      total: rest.reduce((sum, item) => sum + item.total, 0),
      withDrug: rest.reduce((sum, item) => sum + item.withDrug, 0),
    })
    // Highcharts วาดแท่งนอนจากล่างขึ้นบน กลับลำดับเพื่อให้อันดับหนึ่งอยู่บนสุด
    return head.reverse()
  }

  const trend = useMemo(() => {
    const totals = new Map<string, Bucket>()
    for (const visit of visible) {
      const ym = visit.d.slice(0, 7)
      const bucket = totals.get(ym) ?? { label: monthLabel(ym), total: 0, withDrug: 0 }
      bucket.total += 1
      if (visit.rx.length > 0) bucket.withDrug += 1
      totals.set(ym, bucket)
    }
    return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value)
  }, [visible])

  const byDepartment = useMemo(
    () => topOf(bucketsBy(visit => [visit.dep], facts?.departments ?? [])),
    [bucketsBy, facts],
  )
  const byDoctor = useMemo(
    () => topOf(bucketsBy(visit => [visit.doc], facts?.doctors ?? [])),
    [bucketsBy, facts],
  )
  const byCode = useMemo(
    () =>
      topOf(
        bucketsBy(
          visit => visit.dx,
          (facts?.codes ?? []).map(item => `${item.code} ${clip(item.name, 40)}`),
        ),
      ),
    [bucketsBy, facts],
  )
  const byDrug = useMemo(
    () =>
      topOf(
        bucketsBy(
          visit => visit.rx,
          (facts?.drugs ?? []).map(item => clip(item.name, 52)),
        ),
      ),
    [bucketsBy, facts],
  )

  /** ตัวเลือกของช่องกรอง — สร้างจากข้อมูลทั้งช่วง ไม่ใช่จากผลที่กรองแล้ว */
  const options = useMemo(() => {
    const count = (pick: (visit: Facts['visits'][number]) => number[]) => {
      const totals = new Map<number, number>()
      for (const visit of facts?.visits ?? []) {
        for (const key of pick(visit)) totals.set(key, (totals.get(key) ?? 0) + 1)
      }
      return totals
    }
    const build = (totals: Map<number, number>, label: (key: number) => string) =>
      [...totals.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([value, n]) => ({ value, label: `${label(value)} (${n})` }))

    return {
      departments: build(count(v => [v.dep]), key =>
        key === -1 ? NONE_LABEL : (facts?.departments[key] ?? ''),
      ),
      doctors: build(count(v => [v.doc]), key =>
        key === -1 ? NONE_LABEL : (facts?.doctors[key] ?? ''),
      ),
      codes: build(count(v => v.dx), key => {
        const item = facts?.codes[key]
        return item ? `${item.code} ${clip(item.name, 48)}` : ''
      }),
      drugs: build(count(v => v.rx), key => clip(facts?.drugs[key]?.name ?? '', 60)),
    }
  }, [facts])

  const filtered = dep != null || doc != null || dx != null || rx != null

  return (
    <>
      <section className="mb-6">
        <Breadcrumb
          className="mb-2"
          items={[
            { title: <Link href="/home/rdu">RDU ติดตามตัวชี้วัดการใช้ยา</Link> },
            { title: 'วิเคราะห์ข้อมูล' },
          ]}
        />
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          <DashboardOutlined /> วิเคราะห์ตัวชี้วัด RDU
        </Title>
        <div className="mb-2 h-px w-24 bg-linear-to-r from-violet-400/70 to-transparent" />
        <Paragraph type="secondary" style={{ maxWidth: 860, marginBottom: 0, fontSize: 12 }}>
          ดูว่าตัวเลขของตัวชี้วัดมาจากไหน — แยกตามเดือน ห้องตรวจ แพทย์ผู้ตรวจ รหัสวินิจฉัย
          และตัวยา เลือกช่วงวันที่เองหรือเลือกทั้งปีงบประมาณ แล้วกดที่ตัวกรองเพื่อเจาะดูเฉพาะกลุ่ม —
          นับเฉพาะผู้ป่วยนอก ไม่รวมครั้งที่รับไว้เป็นผู้ป่วยใน
        </Paragraph>
      </section>

      {/* ───────────── เลือกตัวชี้วัดและช่วงเวลา ───────────── */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented<string>
          size="large"
          value={indicator.kind}
          onChange={value => {
            const next = INDICATORS.find(item => item.kind === value) ?? INDICATORS[0]
            setIndicator(next)
            setFacts(null)
            clearFilters()
          }}
          options={INDICATORS.map(item => ({ label: item.short, value: item.kind }))}
        />

        <Select
          size="large"
          placeholder="ปีงบประมาณ"
          style={{ width: 160 }}
          options={FISCAL_YEARS.map(year => ({ value: year, label: `ปีงบ ${year}` }))}
          onChange={year => setRange(fiscalYearRange(year))}
        />

        <Space.Compact>
          <RangePicker
            size="large"
            allowClear={false}
            value={range}
            format="DD/MM/BBBB"
            maxDate={dayjs()}
            onChange={dates => {
              if (dates?.[0] && dates[1]) setRange([dates[0], dates[1]])
            }}
          />
          <Button
            size="large"
            type="primary"
            loading={loading}
            onClick={() => void load(indicator, range)}
          >
            ดึงข้อมูล
          </Button>
        </Space.Compact>
      </div>

      <Text type="secondary" className="mb-4 block text-[11px]">
        {indicator.label} · ช่วงวันที่เลือกได้ไม่เกิน 366 วัน (ปีงบประมาณพอดี)
        {facts?.maxAgeYears != null &&
          ` · นับเฉพาะผู้ป่วยอายุไม่เกิน ${facts.maxAgeYears} ปี ตามนิยามของตัวชี้วัด`}
        {facts?.minAgeYears != null &&
          ` · นับเฉพาะผู้ป่วยอายุตั้งแต่ ${facts.minAgeYears} ปีขึ้นไป ตามนิยามของตัวชี้วัด`}
      </Text>

      {error && <Alert type="error" showIcon title={error} className="mb-4" />}

      {facts?.truncated && (
        <Alert
          type="warning"
          showIcon
          className="mb-4"
          title="ข้อมูลในช่วงนี้ยาวเกินกว่าที่วิเคราะห์ได้ในครั้งเดียว จึงตัดไว้ที่ 30,000 ครั้งแรก"
          description={
            <span className="text-xs leading-relaxed">
              ตัวเลขทั้งหน้านับเฉพาะส่วนที่ดึงมาได้ — แบ่งช่วงวันที่ให้สั้นลงเพื่อดูให้ครบ
            </span>
          }
        />
      )}

      <Spin spinning={loading}>
        {facts ? (
          <>
            {/* ───────────── ตัวกรองสี่มุม ───────────── */}
            <section className="mb-4 rounded-2xl border border-line bg-panel p-3 backdrop-blur">
              <div className="flex flex-wrap items-center gap-2">
                <Text type="secondary" className="text-xs">
                  กรองดู
                </Text>
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="ห้องตรวจ"
                  style={{ minWidth: 220 }}
                  value={dep}
                  onChange={value => setDep(value ?? null)}
                  options={options.departments}
                />
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="แพทย์ผู้ตรวจ"
                  style={{ minWidth: 220 }}
                  value={doc}
                  onChange={value => setDoc(value ?? null)}
                  options={options.doctors}
                />
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="รหัสวินิจฉัย"
                  style={{ minWidth: 260 }}
                  value={dx}
                  onChange={value => setDx(value ?? null)}
                  options={options.codes}
                />
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder={`ชื่อ${indicator.drugLabel}`}
                  style={{ minWidth: 280 }}
                  value={rx}
                  onChange={value => setRx(value ?? null)}
                  options={options.drugs}
                />
                {filtered && (
                  <Button size="small" icon={<ReloadOutlined />} onClick={clearFilters}>
                    ล้างตัวกรอง
                  </Button>
                )}
              </div>
              {/* เลือกชื่อยาแล้วตัวหารจะเหลือเฉพาะครั้งที่ได้รับยาตัวนั้น ซึ่งทำให้
                  ร้อยละกลายเป็น 100 เสมอ ต้องบอกไว้ ไม่งั้นจะอ่านว่าตัวชี้วัดพุ่ง */}
              {rx != null && (
                <Text type="secondary" className="mt-2 block text-[11px]">
                  กรองด้วยชื่อยาอยู่ — ตัวหารเหลือเฉพาะครั้งที่ได้รับยาตัวนั้น
                  ร้อยละจึงเป็น 100% เสมอ ใช้ดูว่ายาตัวนั้นถูกจ่ายที่ไหนและโดยใคร
                </Text>
              )}
            </section>

            {/* ───────────── ตัวเลขสรุป ───────────── */}
            <section className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="ครั้งที่มารับบริการ" value={`${stats.total}`} unit="ครั้ง" />
              <StatCard
                label={`ได้รับ${indicator.drugLabel}`}
                value={`${stats.withDrug}`}
                unit="ครั้ง"
              />
              <StatCard
                label={`ไม่ได้รับ${indicator.drugLabel}`}
                value={`${stats.without}`}
                unit="ครั้ง"
              />
              <StatCard
                label={`ร้อยละที่ได้รับ${indicator.drugLabel}`}
                value={stats.percent == null ? '—' : stats.percent.toFixed(1)}
                unit={stats.percent == null ? '' : '%'}
                tag={
                  indicator.target == null || stats.percent == null ? undefined : (
                    <Tag
                      className="mr-0!"
                      color={stats.percent <= indicator.target ? 'green' : 'orange'}
                    >
                      เกณฑ์ ≤ {indicator.target}%
                    </Tag>
                  )
                }
              />
            </section>

            {stats.total === 0 ? (
              <div className="rounded-2xl border border-line bg-panel py-16 backdrop-blur-md">
                <Empty
                  description={
                    filtered ? 'ไม่มีข้อมูลที่ตรงกับตัวกรองนี้' : 'ไม่พบข้อมูลในช่วงวันที่ที่เลือก'
                  }
                />
              </div>
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                <ChartCard
                  title="แนวโน้มรายเดือน"
                  hint="แท่งคือจำนวนครั้ง เส้นคือร้อยละที่ได้รับยา (แกนขวา)"
                  wide
                >
                  <TrendChart
                    buckets={trend}
                    drugLabel={indicator.drugLabel}
                    target={indicator.target}
                    followUp={indicator.followUp}
                  />
                </ChartCard>

                <ChartCard title="แยกตามห้องตรวจ" hint={`สูงสุด ${TOP_N} อันดับ · ป้าย = ร้อยละ`}>
                  <BreakdownChart
                    buckets={byDepartment}
                    drugLabel={indicator.drugLabel}
                    followUp={indicator.followUp}
                    height={Math.max(260, byDepartment.length * 26 + 60)}
                  />
                </ChartCard>

                <ChartCard title="แยกตามแพทย์ผู้ตรวจ" hint={`สูงสุด ${TOP_N} อันดับ · ป้าย = ร้อยละ`}>
                  <BreakdownChart
                    buckets={byDoctor}
                    drugLabel={indicator.drugLabel}
                    followUp={indicator.followUp}
                    height={Math.max(260, byDoctor.length * 26 + 60)}
                  />
                </ChartCard>

                <ChartCard
                  title="แยกตามรหัสวินิจฉัย"
                  hint="หนึ่งครั้งที่บันทึกหลายรหัสถูกนับในทุกรหัส ยอดรวมจึงมากกว่าจำนวนครั้ง"
                >
                  <BreakdownChart
                    buckets={byCode}
                    drugLabel={indicator.drugLabel}
                    followUp={indicator.followUp}
                    height={Math.max(260, byCode.length * 26 + 60)}
                  />
                </ChartCard>

                <ChartCard
                  title={`${indicator.drugLabel}ที่ถูกจ่ายบ่อย`}
                  hint="นับจำนวนครั้งที่มีการจ่ายยาตัวนั้น"
                >
                  {byDrug.length === 0 ? (
                    <Empty description={`ไม่มีการจ่าย${indicator.drugLabel}ในกลุ่มนี้`} />
                  ) : (
                    <DrugChart
                      buckets={byDrug}
                      height={Math.max(260, byDrug.length * 26 + 60)}
                    />
                  )}
                </ChartCard>
              </div>
            )}

            <div className="mt-4">
              <Link href={indicator.reportHref} className="text-xs font-medium text-accent">
                เปิดรายการรายเคสของตัวชี้วัดนี้ →
              </Link>
            </div>
          </>
        ) : (
          !loading && (
            <div className="rounded-2xl border border-line bg-panel py-16 backdrop-blur-md">
              <Empty description="เลือกตัวชี้วัดกับช่วงเวลาแล้วกดดึงข้อมูล" />
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
  tag,
}: {
  label: string
  value: string
  unit: string
  tag?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-3 backdrop-blur">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-ink-3">{label}</div>
        {tag}
      </div>
      <div className="mt-0.5 text-xl font-semibold text-ink">
        <span className="qty">{value}</span>
        {unit && <span className="ml-1 text-xs font-normal text-ink-3">{unit}</span>}
      </div>
    </div>
  )
}

function ChartCard({
  title,
  hint,
  wide,
  children,
}: {
  title: string
  hint: string
  /** กราฟที่กินความกว้างทั้งแถวบนจอกว้าง */
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <Card
      variant="borderless"
      className={`border! border-line! ${wide ? 'xl:col-span-2' : ''}`}
      styles={{ body: { padding: 12 } }}
    >
      <div className="mb-1 px-1 text-sm font-semibold text-ink">{title}</div>
      <div className="mb-2 px-1 text-[11px] text-ink-3">{hint}</div>
      {children}
    </Card>
  )
}
