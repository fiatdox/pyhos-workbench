'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ยังทำที่ app/home/layout.tsx ซึ่งเป็น Server Component)
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Alert, Breadcrumb, Empty, Segmented, Spin, Table, Tag, Typography } from 'antd'
import { CloudOutlined } from '@ant-design/icons'
import { apiFetch } from '@/lib/client/session'
// รายชื่อกลุ่มมาจาก copd-groups ไม่ใช่ copd-stats — อันหลังเป็น server-only
// ถ้า import ค่า (ไม่ใช่แค่ type) จากที่นั่น bundler จะลาก mysql2 เข้า client bundle
import {
  COPD_AGE_BANDS,
  PNEUMONIA_SCOPES,
  type CopdAgeBand,
  type CopdCount,
  type CopdPeriod,
  type PneumoniaScope,
} from '@/lib/his/copd-groups'
import type { CopdStats } from '@/lib/his/copd-stats'
import { BlockSkeleton, StatCardsSkeleton, TableRowsSkeleton } from '@/app/home/skeletons'
import PageHint from '../../page-hint'
import {
  GroupChart,
  MortalityChart,
  StackChart,
  type GroupPoint,
  type MortalityPoint,
  type TrendSeries,
} from '../charts'
import {
  comparable,
  Delta,
  Kpi,
  nf,
  Panel,
  PeriodCell,
  periodLabel,
  PeriodPicker,
  pctText,
  rangeLabelOf,
  RateCell,
  rateOf,
  SectionHead,
  type QuarterChoice,
} from '../ui'

const { Title } = Typography

/**
 * Service Plan สาขาโรคปอดอุดกั้นเรื้อรัง — ปอดบวมและ COPD
 *
 * สองคำถาม: ผู้ป่วยปอดบวมที่นอนโรงพยาบาลเสียชีวิตกี่ร้อยละ · และผู้ป่วยในโรคปอด
 * อุดกั้นเรื้อรัง (J44 โรคหลัก) มีเท่าไร อยู่ในช่วงอายุใด
 *
 * ไม่มีเกณฑ์ที่ตกลงกันไว้ทั้งสองข้อ หน้านี้จึงไม่ตัดสินผ่าน/ไม่ผ่านเลย แสดงเป็น
 * อัตราและแนวโน้มล้วน ถ้าคณะกรรมการกำหนดเกณฑ์มาเมื่อไร ที่ของมันคือตารางค่าตั้ง
 * ไม่ใช่ค่าคงที่ในไฟล์นี้
 *
 * สามเรื่องที่หน้านี้ต้องบอกคนอ่านตรง ๆ เพราะนิยามยังไม่ลงตัว — รายการรหัสปอดบวม
 * ที่ได้รับมาเขียนจุดทศนิยมไว้จนจับไม่ได้ (ดู lib/his/copd-stats.ts) · ขอบเขต
 * การวินิจฉัยของปอดบวมในคิวรีกับในหัวคอลัมน์ไม่ตรงกัน จึงให้เลือกดูทั้งสองแบบ ·
 * และ "อัตราผู้ป่วยใน" ของตัวชี้วัดระดับชาติคิดต่อแสนประชากร ซึ่ง HIS ไม่มีตัวหาร
 * นั้น หน้านี้จึงคิดต่อผู้ป่วยในพันราย แล้วบอกไว้ว่าคนละตัวหาร
 *
 * ไม่มีข้อมูลรายบุคคลในหน้านี้ ตัวเลขทุกตัวเป็นผลรวมรายช่วงที่นับมาจากฐานข้อมูล
 */

/** ป้ายของช่วงอายุ — ลำดับในนี้คือลำดับที่แสดงผล (เด็กไปผู้สูงอายุ) */
const AGE_LABEL: Record<CopdAgeBand, { short: string; long: string }> = {
  under15: { short: '< 15 ปี', long: 'อายุน้อยกว่า 15 ปี' },
  age15to39: { short: '15-39 ปี', long: 'อายุ 15-39 ปี' },
  age40to49: { short: '40-49 ปี', long: 'อายุ 40-49 ปี' },
  age50to59: { short: '50-59 ปี', long: 'อายุ 50-59 ปี' },
  age60up: { short: '≥ 60 ปี', long: 'อายุ 60 ปีขึ้นไป' },
}

/** ป้ายของขอบเขตการวินิจฉัยปอดบวมสองแบบ */
const SCOPE_LABEL: Record<PneumoniaScope, { short: string; long: string }> = {
  any: {
    short: 'ทุกประเภทการวินิจฉัย',
    long: 'มีรหัสปอดบวมเป็นการวินิจฉัยประเภทใดก็ได้ — ตามที่คิวรีที่ได้รับมาทำจริง',
  },
  primary: {
    short: 'โรคหลัก/โรคร่วมแรกรับ',
    long: 'เฉพาะ diagtype 1 หรือ 2 — ตามที่หัวคอลัมน์ของคิวรีนั้นเขียนไว้ว่า PDx หรือ SDx',
  },
}

/** รวมทุกช่วงของตัวนับหนึ่งชุด */
const sumOf = (periods: CopdPeriod[], pick: (period: CopdPeriod) => CopdCount): CopdCount =>
  periods.reduce(
    (acc, period) => {
      const count = pick(period)
      return { total: acc.total + count.total, dead: acc.dead + count.dead }
    },
    { total: 0, dead: 0 },
  )

/** ผู้ป่วย COPD ต่อผู้ป่วยในหนึ่งพันราย — "อัตราผู้ป่วยใน" ที่ข้อมูลนี้ตอบได้ */
const per1000 = (patients: number, admissions: number) =>
  admissions > 0 ? (patients / admissions) * 1000 : null

export default function ServicePlanCopdPage() {
  const [stats, setStats] = useState<CopdStats | null>(null)
  const [fiscalYear, setFiscalYear] = useState<number | null>(null)
  const [quarter, setQuarter] = useState<QuarterChoice>(0)
  /** ขอบเขตการวินิจฉัยของตัวชี้วัดปอดบวม */
  const [scope, setScope] = useState<PneumoniaScope>('any')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    const run = async () => {
      try {
        const params = new URLSearchParams()
        if (fiscalYear != null) {
          params.set('year', String(fiscalYear))
          if (quarter !== 0) params.set('quarter', String(quarter))
        }
        const query = params.toString()
        const res = await apiFetch(`/api/his/service-plan/copd${query === '' ? '' : `?${query}`}`)
        const json = await res.json()
        if (!alive) return
        if (!res.ok || !json.success) {
          setStats(null)
          setError(json.message ?? 'ดึงข้อมูลสถิติไม่สำเร็จ')
          return
        }
        setStats(json.stats as CopdStats)
        setError('')
      } catch {
        if (!alive) return
        setStats(null)
        setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
      } finally {
        if (alive) setLoading(false)
      }
    }
    void run()
    // กันตั้ง state จากคำตอบของตัวเลือกเก่าเมื่อผู้ใช้กดสลับเร็ว ๆ
    return () => {
      alive = false
    }
  }, [fiscalYear, quarter])

  const rangeLabel = rangeLabelOf(fiscalYear, quarter)
  const periodTitle = fiscalYear == null ? 'ปีงบ' : 'เดือน'

  const view = useMemo(() => {
    if (!stats || stats.periods.length === 0) return null
    // การ์ดสรุปอ่านจากช่วงที่ปิดแล้ว ไม่ใช่ช่วงที่กำลังเดินอยู่ ซึ่งตัวเลขยังไม่ครบ
    const closed = stats.periods.filter(period => !period.partial)
    const latest = closed[closed.length - 1] ?? stats.periods[stats.periods.length - 1]
    const running = stats.periods.find(period => period.partial) ?? null

    const trend = (pick: (period: CopdPeriod) => CopdCount) =>
      stats.periods.map<MortalityPoint>(period => {
        const count = pick(period)
        return {
          label: periodLabel(period.key).short,
          title: periodLabel(period.key).full,
          partial: period.partial,
          percent: rateOf(count),
          dead: count.dead,
          total: count.total,
        }
      })

    const pneumoniaTotals = sumOf(stats.periods, period => period.pneumonia[scope])
    const copdTotals = sumOf(stats.periods, period => period.copd)
    const admissions = stats.periods.reduce((n, period) => n + period.admissions, 0)
    const asWritten = sumOf(stats.periods, period => period.pneumoniaAsWritten)

    const ageTotals = Object.fromEntries(
      COPD_AGE_BANDS.map(band => [band, sumOf(stats.periods, period => period.ages[band])]),
    ) as Record<CopdAgeBand, CopdCount>
    const ageUnknown = sumOf(stats.periods, period => period.ageUnknown)

    return {
      latest,
      running,
      latestLabel: periodLabel(latest.key).full,
      scope,
      // ช่วงเวลาที่กราฟแท่งซ้อนใช้เป็นแกนนอน — ชุดเดียวกับที่กราฟอื่นในหน้าใช้
      timeline: stats.periods.map(period => ({
        label: periodLabel(period.key).short,
        title: periodLabel(period.key).full,
        partial: period.partial,
      })),
      pneumonia: {
        totals: pneumoniaTotals,
        trend: trend(period => period.pneumonia[scope]),
        asWritten,
        // ผลต่างระหว่างชุดรหัสที่แก้แล้วกับชุดเดิม — ตัวเลขที่หน้าจอต้องบอก
        missedByOldCodes: pneumoniaTotals.total - asWritten.total,
      },
      copd: {
        totals: copdTotals,
        admissions,
        per1000: per1000(copdTotals.total, admissions),
        trend: trend(period => period.copd),
        // แท่งซ้อนได้จริง เพราะห้าช่วงอายุแบ่งผู้ป่วยออกจากกันหมด ไม่ซ้อนกัน
        ageSeries: COPD_AGE_BANDS.map<TrendSeries>(band => ({
          name: AGE_LABEL[band].short,
          values: stats.periods.map(period => period.ages[band].total),
        })),
        ageTotals,
        ageUnknown,
        // แท่งคู่: ผู้ป่วยของช่วงอายุนั้น เทียบ จำนวนที่เสียชีวิต
        ageBars: COPD_AGE_BANDS.filter(band => ageTotals[band].total > 0).map<GroupPoint>(band => ({
          name: AGE_LABEL[band].short,
          total: ageTotals[band].total,
          dead: ageTotals[band].dead,
        })),
        /** ช่วงอายุที่ไม่มีผู้ป่วยเลย — ต้องบอกว่าเป็นธรรมชาติของโรค ไม่ใช่กราฟพัง */
        emptyBands: COPD_AGE_BANDS.filter(band => ageTotals[band].total === 0),
      },
      previousOf: new Map(
        stats.periods.map((period, index) => [
          period.key,
          index > 0 ? stats.periods[index - 1] : null,
        ]),
      ),
    }
  }, [stats, scope])

  return (
    <>
      <section className="mb-6">
        <Breadcrumb
          className="mb-2"
          items={[
            { title: <Link href="/home/service-plan">Service Plan</Link> },
            { title: 'สาขาโรคปอดอุดกั้นเรื้อรัง' },
          ]}
        />
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          <CloudOutlined /> สาขาโรคปอดอุดกั้นเรื้อรัง (COPD)
          <PageHint>
            สองตัวชี้วัดของผู้ป่วยใน — ร้อยละการเสียชีวิตในโรงพยาบาลของผู้ป่วยปอดบวม และจำนวน
            ผู้ป่วยในโรคปอดอุดกั้นเรื้อรัง (J44 เป็นโรคหลัก) แยกตามช่วงอายุ นับตามวันจำหน่าย
            ปีงบประมาณ 1 ต.ค. ถึง 30 ก.ย. ไม่มีข้อมูลรายบุคคลในหน้านี้
          </PageHint>
        </Title>
        <div className="h-px w-24 bg-linear-to-r from-violet-400/70 to-transparent" />
      </section>

      <PeriodPicker
        fiscalYear={fiscalYear}
        quarter={quarter}
        rangeLabel={rangeLabel}
        from={stats?.from}
        to={stats?.to}
        onChange={(year, choice) => {
          setLoading(true)
          setFiscalYear(year)
          setQuarter(choice)
        }}
        note={
          view?.running && (
            <span className="flex items-center text-xs">
              <Tag className="mr-0!" color="orange">
                {periodLabel(view.running.key).full} ยังไม่จบ
              </Tag>
              <PageHint>
                <div>
                  {view.running.pneumonia.any.total === 0
                    ? `ยังไม่มีผู้ป่วยปอดบวมของ${periodLabel(view.running.key).full} ที่ลงรหัสแล้ว`
                    : `${periodLabel(view.running.key).full} มีผู้ป่วยปอดบวมที่ลงรหัสแล้ว ${nf.format(view.running.pneumonia.any.total)} ราย`}
                  {stats?.coding && stats.coding.discharged > 0 && (
                    <>
                      {' '}
                      — เดือน {stats.coding.month} จำหน่ายผู้ป่วยใน{' '}
                      {nf.format(stats.coding.discharged)} ราย ลงรหัสการวินิจฉัยหลักแล้ว{' '}
                      {nf.format(stats.coding.coded)} ราย (
                      {Math.round((stats.coding.coded / stats.coding.discharged) * 100)}%)
                    </>
                  )}
                </div>
                <div className="mt-1.5">
                  การลงรหัสโรคทำหลังจำหน่ายและตามหลังอยู่หลายสัปดาห์ ตัวเลขของช่วงที่กำลัง
                  เดินอยู่จึงต่ำกว่าความจริงเสมอ ไม่ใช่แค่ยังไม่ครบตามสัดส่วนเวลาที่ผ่านไป
                </div>
                <div className="mt-1.5">
                  ในกราฟและตาราง ช่วงนี้ทำเครื่องหมายดอกจัน (*) และแท่งจางกว่าช่วงอื่น
                  ส่วนการ์ดสรุปด้านบนอ่านจาก{view.latestLabel} ซึ่งปิดแล้ว
                </div>
              </PageHint>
            </span>
          )
        }
      />

      {error && <Alert type="error" showIcon title={error} className="mb-4" />}

      {/* วงกลมหมุนไว้เฉพาะตอนดึงใหม่ทับของที่แสดงอยู่ โหลดครั้งแรกใช้โครงร่าง */}
      <Spin spinning={loading && stats !== null}>
        {stats && view ? (
          <div className="flex flex-col gap-4">
            <section>
              <SectionHead
                title="1 · ร้อยละการเสียชีวิตของผู้ป่วยปอดบวม"
                desc="การนอนโรงพยาบาลที่มีรหัสปอดบวมอยู่ — เสียชีวิตในโรงพยาบาลกี่ราย คิดเป็นร้อยละเท่าไร"
                hint={
                  <div className="text-xs leading-relaxed">
                    <div>
                      รหัสที่นับ: J100, J110 (ปอดบวมจากไข้หวัดใหญ่) · J12-J17 (ปอดบวมแยกตามเชื้อ)
                      · J18 (ปอดบวมไม่ระบุเชื้อ) · J850, J851 (ฝีในปอด) — รวมรหัสลูกทั้งหมด
                    </div>
                    <div className="mt-1.5">
                      <b>แก้รายการรหัสจากคิวรีที่ได้รับมา</b> — ที่นั่นเขียนจุดทศนิยมไว้
                      (J10.0, J11.0, J18, J85.0, J85.1) แต่ฐานนี้เก็บรหัสแบบไม่มีจุด (J100,
                      J180) เงื่อนไขนั้นจึงจับไม่ได้เลยสักแถว ผลคือกลุ่ม J18 ทั้งก้อน ซึ่งเป็น
                      รหัสปอดบวมที่ลงมากที่สุด หายไปทั้งหมด เหลือแต่ J12-J17 ที่เขียนด้วย
                      LEFT(icd10,3) ซึ่งทำงานได้ — ช่วงนี้ต่างกัน{' '}
                      {nf.format(view.pneumonia.missedByOldCodes)} ราย (
                      {nf.format(view.pneumonia.asWritten.total)} เทียบ{' '}
                      {nf.format(view.pneumonia.totals.total)})
                    </div>
                    <div className="mt-1.5">
                      <b>ปุ่มขอบเขตการวินิจฉัย</b> — คิวรีที่ได้รับมาไม่ได้กรอง diagtype เลย
                      จึงนับทุกประเภทรวมทั้งที่วินิจฉัยเพิ่มระหว่างนอน แต่หัวคอลัมน์ของคิวรีนั้น
                      เขียนว่า “PDx หรือ SDx” ซึ่งคือ diagtype 1 กับ 2 สองอย่างนี้ไม่ตรงกัน
                      จึงให้เลือกดูได้ทั้งคู่ ไม่ได้เดาแทนว่าอันไหนถูก
                    </div>
                    <div className="mt-1.5">
                      <b>การเสียชีวิตนับจากประเภทการจำหน่าย 08 และ 09 เท่านั้น</b> ตามที่คิวรี
                      ใช้ และตรงกับทะเบียนของ HIS (08 = Dead Autopsy · 09 = Dead Non Autopsy)
                      ส่วน 02 คือ Against Advice ไม่ใช่การเสียชีวิต —{' '}
                      <b>ตรงนี้ต่างจากหน้า Sepsis</b> ที่นับ 02 เป็นการเสียชีวิตด้วยตามคิวรี
                      ที่ได้รับมาสำหรับหน้านั้น สองหน้าจึงใช้นิยามการตายไม่ตรงกันอยู่
                    </div>
                    <div className="mt-1.5">
                      ตัวหารคือการนอนโรงพยาบาล (AN) ไม่ใช่จำนวนคน ผู้ป่วยคนเดียวที่นอนสองครั้ง
                      ในช่วงเดียวกันนับสองครั้ง · ยังไม่มีเกณฑ์เป้าหมายที่ตกลงกันไว้ หน้านี้จึง
                      ไม่ตัดสินผ่าน/ไม่ผ่าน
                    </div>
                  </div>
                }
              />

              <div className="mb-4 flex flex-wrap items-center gap-3">
                <Segmented<PneumoniaScope>
                  title="ขอบเขตการวินิจฉัย"
                  value={view.scope}
                  onChange={setScope}
                  options={PNEUMONIA_SCOPES.map(name => ({
                    label: SCOPE_LABEL[name].short,
                    value: name,
                  }))}
                />
                <span className="text-xs text-ink-3">{SCOPE_LABEL[view.scope].long}</span>
              </div>

              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi
                  label={`ผู้ป่วยปอดบวม · ${rangeLabel}`}
                  value={nf.format(view.pneumonia.totals.total)}
                  hint={`เสียชีวิตในโรงพยาบาล ${nf.format(view.pneumonia.totals.dead)} ราย`}
                />
                <Kpi
                  label="ร้อยละการเสียชีวิต"
                  value={pctText(view.pneumonia.totals)}
                  hint={`${nf.format(view.pneumonia.totals.dead)} จาก ${nf.format(view.pneumonia.totals.total)} ราย`}
                />
                <Kpi
                  label={`ร้อยละการเสียชีวิต · ${view.latestLabel}`}
                  value={pctText(view.latest.pneumonia[view.scope])}
                  hint={`${nf.format(view.latest.pneumonia[view.scope].dead)} จาก ${nf.format(view.latest.pneumonia[view.scope].total)} ราย — ช่วงที่ปิดแล้วล่าสุด`}
                />
                <Kpi
                  label="ที่รายการรหัสเดิมนับไม่ได้"
                  value={nf.format(view.pneumonia.missedByOldCodes)}
                  hint={`คิวรีเดิมนับได้ ${nf.format(view.pneumonia.asWritten.total)} ราย เพราะรหัสที่มีจุดจับไม่ได้`}
                />
              </section>

              <div className="mt-4">
                <Panel
                  title={`ผู้ป่วยปอดบวมและการเสียชีวิต ตาม${periodTitle}`}
                  desc="ความสูงรวมของแท่งคือผู้ป่วยปอดบวมในช่วงนั้น สีแดงคือจำนวนที่เสียชีวิต และเส้นคือร้อยละการเสียชีวิต"
                >
                  <MortalityChart points={view.pneumonia.trend} target={null} />
                </Panel>
              </div>

              <section className="mt-4 rounded-2xl border border-line bg-panel p-4 backdrop-blur">
                <div className="mb-3 text-sm font-semibold text-ink">
                  ตารางผู้ป่วยปอดบวม {rangeLabel}
                </div>
                <Table<CopdPeriod>
                  size="small"
                  rowKey="key"
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                  dataSource={[...stats.periods].reverse()}
                  columns={[
                    {
                      key: 'period',
                      title: periodTitle,
                      dataIndex: 'key',
                      render: (value: string, row) => (
                        <PeriodCell value={value} partial={row.partial} />
                      ),
                    },
                    {
                      key: 'total',
                      title: 'ผู้ป่วยปอดบวม',
                      align: 'right',
                      render: (_, row) => nf.format(row.pneumonia[view.scope].total),
                    },
                    {
                      key: 'dead',
                      title: 'เสียชีวิต',
                      align: 'right',
                      render: (_, row) => nf.format(row.pneumonia[view.scope].dead),
                    },
                    {
                      key: 'rate',
                      title: 'ร้อยละการเสียชีวิต',
                      align: 'right',
                      render: (_, row) => (
                        <RateCell
                          count={row.pneumonia[view.scope]}
                          target={null}
                          previous={comparable(
                            row,
                            view.previousOf.get(row.key)?.pneumonia[view.scope] ?? null,
                          )}
                        />
                      ),
                    },
                    {
                      key: 'share',
                      title: 'สัดส่วนของผู้ป่วยในทั้งหมด',
                      align: 'right',
                      render: (_, row) =>
                        row.admissions > 0
                          ? `${((row.pneumonia[view.scope].total / row.admissions) * 100).toFixed(1)}%`
                          : '—',
                    },
                    {
                      key: 'written',
                      title: 'รายการรหัสเดิมนับได้',
                      align: 'right',
                      render: (_, row) => nf.format(row.pneumoniaAsWritten.total),
                    },
                  ]}
                />
                <div className="mt-2 text-xs text-ink-3">
                  คอลัมน์สุดท้ายคือจำนวนที่รายการรหัสของคิวรีเดิมนับได้ ใส่ไว้ให้เทียบว่าการ
                  แก้จุดทศนิยมเปลี่ยนตัวเลขไปเท่าไร ไม่ได้เอาไปคิดอัตราที่ไหน
                </div>
              </section>
            </section>

            <section className="mt-2">
              <SectionHead
                title="2 · ผู้ป่วยในโรคปอดอุดกั้นเรื้อรัง (J44) แยกตามช่วงอายุ"
                desc="การนอนโรงพยาบาลที่มีรหัส J44 เป็นโรคหลัก — มีเท่าไร อยู่ในช่วงอายุใด และเสียชีวิตกี่ราย"
                hint={
                  <div className="text-xs leading-relaxed">
                    <div>
                      นับเฉพาะ <b>J44 ที่เป็นโรคหลัก (diagtype 1)</b> ตามคิวรีที่ได้รับมา —
                      ถ้านับทุกประเภทการวินิจฉัยจะได้ราวเท่าตัว เพราะ COPD มักเป็นโรคประจำตัว
                      ที่ติดมากับการนอนด้วยเรื่องอื่น ตัวเลขที่นี่คือ “นอนเพราะ COPD”
                      ไม่ใช่ “มี COPD”
                    </div>
                    <div className="mt-1.5">
                      <b>“อัตราผู้ป่วยใน” ที่นี่คิดต่อผู้ป่วยในหนึ่งพันราย ไม่ใช่ต่อแสนประชากร</b>{' '}
                      — ตัวชี้วัดระดับชาติใช้ประชากรเป็นตัวหาร แต่ HIS ไม่มีทะเบียนประชากรรายปี
                      ที่ใช้เป็นตัวหารได้ (ตาราง person มีทุกคนที่เคยลงทะเบียน ไม่ได้แยกปีและ
                      ไม่ได้ตัดคนที่ย้ายหรือเสียชีวิต) ตัวเลขสองแบบนี้เทียบกันตรง ๆ ไม่ได้
                      ถ้าต้องการต่อแสนประชากร ต้องมีตัวเลขประชากรรายปีจากข้างนอกมาใส่
                    </div>
                    <div className="mt-1.5">
                      อายุอ่านจากทะเบียน an_stat ซึ่งเป็นอายุ ณ วันรับเข้านอนที่ HIS คำนวณไว้แล้ว
                      ไม่ได้คิดจากวันเกิดเอง เพื่อให้ตรงกับคิวรีที่ได้รับมาและรายงานอื่นของ HIS
                      · ช่วงนี้มีผู้ป่วยที่ไม่มีอายุในทะเบียน{' '}
                      {nf.format(view.copd.ageUnknown.total)} ราย
                    </div>
                    {view.copd.emptyBands.length > 0 && (
                      <div className="mt-1.5">
                        ช่วงอายุที่ไม่มีผู้ป่วยเลยในช่วงนี้:{' '}
                        {view.copd.emptyBands.map(band => AGE_LABEL[band].short).join(' · ')} —
                        เป็นธรรมชาติของโรคนี้ที่พบในผู้สูงอายุเกือบทั้งหมด ไม่ใช่ข้อมูลหาย
                      </div>
                    )}
                    <div className="mt-1.5">
                      ห้าช่วงอายุ<b>แบ่งผู้ป่วยออกจากกันหมด</b> ไม่ซ้อนกัน ผลรวมจึงเท่ากับยอด
                      ผู้ป่วย COPD พอดี และวางเป็นแท่งซ้อนได้จริง (ต่างจากกลุ่มของหน้า Sepsis
                      ที่ซ้อนกันได้ จึงต้องวางเป็นแท่งแยก)
                    </div>
                  </div>
                }
              />

              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi
                  label={`ผู้ป่วยใน COPD · ${rangeLabel}`}
                  value={nf.format(view.copd.totals.total)}
                  hint={`J44 เป็นโรคหลัก · จากผู้ป่วยในทั้งหมด ${nf.format(view.copd.admissions)} ราย`}
                />
                <Kpi
                  label="ต่อผู้ป่วยในหนึ่งพันราย"
                  value={view.copd.per1000 == null ? '—' : view.copd.per1000.toFixed(1)}
                  hint="ไม่ใช่อัตราต่อแสนประชากรของตัวชี้วัดระดับชาติ — HIS ไม่มีตัวหารนั้น"
                />
                <Kpi
                  label="ร้อยละการเสียชีวิต"
                  value={pctText(view.copd.totals)}
                  hint={`เสียชีวิต ${nf.format(view.copd.totals.dead)} จาก ${nf.format(view.copd.totals.total)} ราย`}
                />
                <Kpi
                  label="อายุ 60 ปีขึ้นไป"
                  value={nf.format(view.copd.ageTotals.age60up.total)}
                  hint={
                    view.copd.totals.total > 0
                      ? `${((view.copd.ageTotals.age60up.total / view.copd.totals.total) * 100).toFixed(1)}% ของผู้ป่วย COPD ในช่วงนี้`
                      : 'ไม่มีผู้ป่วยในช่วงนี้'
                  }
                />
              </section>

              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <Panel
                  title={`ผู้ป่วยใน COPD แยกตามช่วงอายุ ตาม${periodTitle}`}
                  desc="แท่งซ้อนตามช่วงอายุ — ความสูงรวมคือผู้ป่วย COPD ทั้งหมดในช่วงนั้น"
                  hint={
                    <div className="text-xs leading-relaxed">
                      ซ้อนกันได้เพราะห้าช่วงอายุแบ่งผู้ป่วยออกจากกันหมด ผู้ป่วยหนึ่งรายอยู่ได้
                      ช่วงเดียว · ช่วงอายุน้อยเกือบไม่มีผู้ป่วยเลย แถบของมันจึงบางมากหรือ
                      ไม่เห็นเลย กดปิดช่วง 60 ปีขึ้นไปในคำอธิบายกราฟเพื่อดูช่วงที่เหลือ
                    </div>
                  }
                >
                  <StackChart points={view.timeline} series={view.copd.ageSeries} />
                </Panel>

                <Panel
                  title={`ผู้ป่วยและการเสียชีวิตของแต่ละช่วงอายุ · ${rangeLabel}`}
                  desc="แท่งบนคือผู้ป่วยของช่วงอายุนั้น แท่งล่างคือจำนวนที่เสียชีวิต — ชี้ที่แท่งเพื่อดูอัตรา"
                  hint={
                    <div className="text-xs leading-relaxed">
                      ช่วงอายุที่มีผู้ป่วยหลักหน่วยถึงหลักสิบ อัตราการเสียชีวิตแทบไม่มีความหมาย
                      ทางสถิติ ตายรายเดียวในสิบรายได้ 10% ทันที ให้ดูจำนวนรายควบคู่เสมอ
                    </div>
                  }
                >
                  {view.copd.ageBars.length > 0 ? (
                    <GroupChart points={view.copd.ageBars} />
                  ) : (
                    <Empty
                      description={
                        <span className="text-xs text-ink-3">ไม่มีผู้ป่วย COPD ในช่วงนี้</span>
                      }
                    />
                  )}
                </Panel>
              </div>

              <section className="mt-4 rounded-2xl border border-line bg-panel p-4 backdrop-blur">
                <div className="mb-3 text-sm font-semibold text-ink">
                  ตารางผู้ป่วยใน COPD แยกตามช่วงอายุ {rangeLabel}
                </div>
                <Table<CopdPeriod>
                  size="small"
                  rowKey="key"
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                  dataSource={[...stats.periods].reverse()}
                  columns={[
                    {
                      key: 'period',
                      title: periodTitle,
                      dataIndex: 'key',
                      render: (value: string, row) => (
                        <PeriodCell value={value} partial={row.partial} />
                      ),
                    },
                    ...COPD_AGE_BANDS.map(band => ({
                      key: band,
                      title: AGE_LABEL[band].short,
                      align: 'right' as const,
                      render: (_: unknown, row: CopdPeriod) => nf.format(row.ages[band].total),
                    })),
                    {
                      key: 'total',
                      title: 'รวม',
                      align: 'right',
                      render: (_, row) => (
                        <span className="font-semibold text-ink">{nf.format(row.copd.total)}</span>
                      ),
                    },
                    {
                      key: 'per1000',
                      title: 'ต่อผู้ป่วยในพันราย',
                      align: 'right',
                      render: (_, row) => {
                        const rate = per1000(row.copd.total, row.admissions)
                        const previous = view.previousOf.get(row.key)
                        return (
                          <div>
                            <span className="text-ink">{rate == null ? '—' : rate.toFixed(1)}</span>
                            <div className="text-xs">
                              <Delta
                                current={rate}
                                previous={
                                  previous == null || row.partial !== previous.partial
                                    ? null
                                    : per1000(previous.copd.total, previous.admissions)
                                }
                                digits={1}
                                goal="none"
                              />
                            </div>
                          </div>
                        )
                      },
                    },
                    {
                      key: 'dead',
                      title: 'เสียชีวิต',
                      align: 'right',
                      render: (_, row) => nf.format(row.copd.dead),
                    },
                    {
                      key: 'rate',
                      title: 'ร้อยละการเสียชีวิต',
                      align: 'right',
                      render: (_, row) => (
                        <RateCell
                          count={row.copd}
                          target={null}
                          previous={comparable(row, view.previousOf.get(row.key)?.copd ?? null)}
                        />
                      ),
                    },
                  ]}
                />
                <div className="mt-2 text-xs text-ink-3">
                  ห้าคอลัมน์ช่วงอายุบวกกันได้เท่าคอลัมน์รวมพอดี
                  {view.copd.ageUnknown.total > 0 &&
                    ` (บวกผู้ป่วยที่ไม่มีอายุในทะเบียนอีก ${nf.format(view.copd.ageUnknown.total)} ราย)`}{' '}
                  · คอลัมน์ “ต่อผู้ป่วยในพันราย” ไม่ได้ระบายสีขึ้นลง เพราะยังไม่มีเกณฑ์ว่า
                  ทิศไหนคือดีขึ้น — ผู้ป่วยมากขึ้นอ่านได้ทั้งว่าโรคมากขึ้นและว่าเข้าถึงบริการ
                  ได้ดีขึ้น
                </div>
              </section>
            </section>
          </div>
        ) : loading ? (
          <div className="flex flex-col gap-4">
            <StatCardsSkeleton count={4} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" />
            <div className="grid gap-4 xl:grid-cols-2">
              <BlockSkeleton height={300} />
              <BlockSkeleton height={300} />
            </div>
            <section className="rounded-2xl border border-line bg-panel p-4 backdrop-blur">
              <TableRowsSkeleton columns={6} rows={6} />
            </section>
          </div>
        ) : stats ? (
          <Empty
            description={
              <span className="text-xs text-ink-3">
                {rangeLabel} ยังมาไม่ถึง — ยังไม่มีเดือนที่จำหน่ายผู้ป่วยในช่วงนี้
              </span>
            }
          />
        ) : null}
      </Spin>
    </>
  )
}
