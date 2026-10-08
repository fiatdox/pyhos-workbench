'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ยังทำที่ app/home/layout.tsx ซึ่งเป็น Server Component)
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Alert, Breadcrumb, Empty, Segmented, Spin, Table, Tag, Typography } from 'antd'
import { CloudOutlined } from '@ant-design/icons'
import { apiFetch } from '@/lib/client/session'
// รายชื่อกลุ่มมาจาก copd-groups ไม่ใช่ copd-stats — อันหลังเป็น server-only
// ถ้า import ค่า (ไม่ใช่แค่ type) จากที่นั่น bundler จะลาก mysql2 เข้า client bundle
import {
  COPD_AGE_BANDS,
  COPD_DISEASES,
  COPD_DRUG_TIERS,
  PNEUMONIA_SCOPES,
  type CopdAgeBand,
  type CopdCount,
  type CopdDisease,
  type CopdDrugs,
  type CopdDrugTier,
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
 * สามคำถาม: ผู้ป่วยปอดบวมที่นอนโรงพยาบาลเสียชีวิตกี่ร้อยละ · ผู้ป่วยในโรคปอด
 * อุดกั้นเรื้อรัง (J44 โรคหลัก) มีเท่าไร อยู่ในช่วงอายุใด · และผู้ป่วยนอก COPD
 * ได้รับยาสูดพ่นขั้นไหน
 *
 * สองส่วนแรกเป็นผู้ป่วยในนับตามวันจำหน่าย ส่วนที่สามเป็นผู้ป่วยนอกนับตามวันมารับ
 * บริการ และกลุ่มผู้ป่วยคนละชุดกัน ตัวเลขสองฝั่งเอามาหารกันไม่ได้ — หน้าจอบอกไว้
 * ที่หัวส่วนที่ 3
 *
 * ไม่มีเกณฑ์ที่ตกลงกันไว้ทั้งสามข้อ หน้านี้จึงไม่ตัดสินผ่าน/ไม่ผ่านเลย แสดงเป็น
 * อัตราและแนวโน้มล้วน ถ้าคณะกรรมการกำหนดเกณฑ์มาเมื่อไร ที่ของมันคือตารางค่าตั้ง
 * ไม่ใช่ค่าคงที่ในไฟล์นี้
 *
 * ห้าเรื่องที่หน้านี้ต้องบอกคนอ่านตรง ๆ เพราะนิยามยังไม่ลงตัว — รายการรหัสปอดบวม
 * ที่ได้รับมาเขียนจุดทศนิยมไว้จนจับไม่ได้ (ดู lib/his/copd-stats.ts) · ขอบเขต
 * การวินิจฉัยของปอดบวมในคิวรีกับในหัวคอลัมน์ไม่ตรงกัน จึงให้เลือกดูทั้งสองแบบ ·
 * "อัตราผู้ป่วยใน" ของตัวชี้วัดระดับชาติคิดต่อแสนประชากร ซึ่ง HIS ไม่มีตัวหาร
 * นั้น หน้านี้จึงคิดต่อผู้ป่วยในพันราย แล้วบอกไว้ว่าคนละตัวหาร · ชื่อขั้นยาที่ได้รับ
 * มาอ่านว่าเป็นยาคู่กับ Spiriva แต่เงื่อนไขไม่ได้บังคับ จึงเปลี่ยนชื่อที่แสดงและ
 * นับจำนวนที่ได้ Spiriva ร่วมจริงมาให้เทียบ · และมียาสูดพ่นนอกรายการที่ผู้ป่วย
 * ได้รับจริงและเพิ่มขึ้นทุกปี ซึ่งจัดขั้นให้เองไม่ได้
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

/**
 * ป้ายของขั้นยา — ตั้งชื่อตามยาที่ตัดสินขั้นจริง ไม่ใช่ชื่อในคิวรีที่ได้รับมา
 *
 * คิวรีนั้นตั้งชื่อว่า Spiriva_Symbicort / Spiriva_Seretide / Spiriva_Evoflo ซึ่ง
 * อ่านว่าต้องได้ยาคู่กับ Spiriva แต่เงื่อนไขไม่ได้บังคับไว้เลย และวัดแล้วคนส่วนใหญ่
 * ไม่ได้รับ Spiriva — ถ้าใช้ชื่อเดิมบนหน้าจอ คนอ่านจะเข้าใจผิดทันที ชื่อเดิมอยู่ใน
 * origin เพื่อให้เทียบกับรายงานเก่าได้
 */
const TIER_LABEL: Record<CopdDrugTier, { short: string; long: string; origin: string }> = {
  symbicort: {
    short: 'ขั้น D · Symbicort',
    long: 'SYMBICORT Turbuhaler (budesonide + formoterol)',
    origin: 'Spiriva_Symbicort',
  },
  seretide: {
    short: 'ขั้น C · Seretide',
    long: 'SERETIDE / AEROTIDE-250 (salmeterol + fluticasone 250)',
    origin: 'Spiriva_Seretide',
  },
  evoflo: {
    short: 'ขั้น B · Evoflo',
    long: 'EVOFLO / AEROTIDE-125 (salmeterol + fluticasone 125)',
    origin: 'Spiriva_Evoflo',
  },
  spiriva: {
    short: 'ขั้น A · Spiriva',
    long: 'SPIRIVA Powder Inh. Capsule (tiotropium)',
    origin: 'Spiriva',
  },
}

/** ผู้ป่วยที่ได้รับยาในรายการของช่วงหนึ่ง — สี่ขั้นรวมกัน */
const tierSum = (drugs: CopdDrugs) =>
  COPD_DRUG_TIERS.reduce((n, tier) => n + drugs.tiers[tier].patients, 0)

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

/** ช่วงเวลาหนึ่งช่วงบนแกนนอนของกราฟ */
type Timeline = { label: string; title: string; partial: boolean }[]

/**
 * ตัวเลขทุกอย่างที่ส่วนผู้ป่วยในของโรคหนึ่งต้องใช้
 *
 * เขียนเป็นชนิดข้อมูลตรง ๆ ไม่ใช้ ReturnType ของตัวสร้าง เพราะตัวสร้าง
 * อยู่ใน useMemo ซึ่งคอมโพเนนต์นอกอ้างถึงไม่ได้
 */
type DiseaseView = {
  disease: CopdDisease
  totals: CopdCount
  admissions: number
  per1000: number | null
  ageTotals: Record<CopdAgeBand, CopdCount>
  ageUnknown: CopdCount
  ageSeries: TrendSeries[]
  ageBars: GroupPoint[]
  emptyBands: CopdAgeBand[]
  topBand: CopdAgeBand | null
  timeline: Timeline
}

/**
 * ส่วนผู้ป่วยในของโรคหนึ่ง แยกตามช่วงอายุ — ใช้ซ้ำทั้ง COPD และหืด
 *
 * สองโรคถามคำถามเดียวกันทุกข้อ (มีเท่าไร อายุเท่าไร ตายกี่ราย คิดเป็นเท่าไรของ
 * ผู้ป่วยในทั้งหมด) จึงใช้ส่วนเดียวกัน ต่างแค่ข้อความที่ส่งเข้ามา — ถ้าทำสองชุด
 * วันหนึ่งคอลัมน์หรืออัตราของสองส่วนจะไม่ตรงกันแล้วไม่มีใครรู้ว่าอันไหนถูก
 */
function DiseaseSection({
  number,
  title,
  codes,
  desc,
  note,
  view,
  stats,
  periodTitle,
  rangeLabel,
  previousOf,
}: {
  number: number
  title: string
  /** ข้อความช่วงรหัสที่ใช้นับ เขียนให้คนอ่านตรวจได้ว่าตรงกับที่ตกลงไว้ */
  codes: string
  desc: string
  /** ข้อสังเกตเฉพาะของโรคนั้น ต่อท้ายคำเตือนที่ทั้งสองโรคใช้ร่วมกัน */
  note: ReactNode
  view: DiseaseView
  stats: CopdStats
  periodTitle: string
  rangeLabel: string
  previousOf: Map<string, CopdPeriod | null>
}) {
  const disease = view.disease
  return (
    <section className="mt-2">
      <SectionHead
        title={`${number} · ${title}`}
        desc={desc}
        hint={
          <div className="text-xs leading-relaxed">
            <div>
              รหัสที่นับ: {codes} — เฉพาะที่ลงเป็น<b>โรคหลัก (diagtype 1)</b> ตามคิวรีที่ได้รับมา
            </div>
            {note}
            <div className="mt-1.5">
              <b>“อัตราผู้ป่วยใน” ที่นี่คิดต่อผู้ป่วยในหนึ่งพันราย ไม่ใช่ต่อแสนประชากร</b> —
              ตัวชี้วัดระดับชาติใช้ประชากรเป็นตัวหาร แต่ HIS ไม่มีทะเบียนประชากรรายปีที่ใช้เป็น
              ตัวหารได้ (ตาราง person มีทุกคนที่เคยลงทะเบียน ไม่ได้แยกปีและไม่ได้ตัดคนที่ย้าย
              หรือเสียชีวิต) ตัวเลขสองแบบนี้เทียบกันตรง ๆ ไม่ได้ ถ้าต้องการต่อแสนประชากร
              ต้องมีตัวเลขประชากรรายปีจากข้างนอกมาใส่
            </div>
            <div className="mt-1.5">
              อายุอ่านจากทะเบียน an_stat ซึ่งเป็นอายุ ณ วันรับเข้านอนที่ HIS คำนวณไว้แล้ว
              ไม่ได้คิดจากวันเกิดเอง เพื่อให้ตรงกับคิวรีที่ได้รับมาและรายงานอื่นของ HIS ·
              ช่วงนี้มีผู้ป่วยที่ไม่มีอายุในทะเบียน {nf.format(view.ageUnknown.total)} ราย
            </div>
            {view.emptyBands.length > 0 && (
              <div className="mt-1.5">
                ช่วงอายุที่ไม่มีผู้ป่วยเลยในช่วงนี้:{' '}
                {view.emptyBands.map(band => AGE_LABEL[band].short).join(' · ')} — เป็นธรรมชาติ
                ของโรค ไม่ใช่ข้อมูลหาย
              </div>
            )}
            <div className="mt-1.5">
              ห้าช่วงอายุ<b>แบ่งผู้ป่วยออกจากกันหมด</b> ไม่ซ้อนกัน ผลรวมจึงเท่ากับยอดผู้ป่วย
              พอดี และวางเป็นแท่งซ้อนได้จริง (ต่างจากกลุ่มของหน้า Sepsis ที่ซ้อนกันได้ จึงต้อง
              วางเป็นแท่งแยก)
            </div>
          </div>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label={`ผู้ป่วยใน · ${rangeLabel}`}
          value={nf.format(view.totals.total)}
          hint={`จากผู้ป่วยในทั้งหมด ${nf.format(view.admissions)} ราย`}
        />
        <Kpi
          label="ต่อผู้ป่วยในหนึ่งพันราย"
          value={view.per1000 == null ? '—' : view.per1000.toFixed(1)}
          hint="ไม่ใช่อัตราต่อแสนประชากรของตัวชี้วัดระดับชาติ — HIS ไม่มีตัวหารนั้น"
        />
        <Kpi
          label="ร้อยละการเสียชีวิต"
          value={pctText(view.totals)}
          hint={`เสียชีวิต ${nf.format(view.totals.dead)} จาก ${nf.format(view.totals.total)} ราย`}
        />
        <Kpi
          label="ช่วงอายุที่พบมากที่สุด"
          value={view.topBand == null ? '—' : AGE_LABEL[view.topBand].short}
          hint={
            view.topBand == null
              ? 'ไม่มีผู้ป่วยในช่วงนี้'
              : `${nf.format(view.ageTotals[view.topBand].total)} ราย (${((view.ageTotals[view.topBand].total / view.totals.total) * 100).toFixed(1)}% ของผู้ป่วยโรคนี้)`
          }
        />
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel
          title={`ผู้ป่วยในแยกตามช่วงอายุ ตาม${periodTitle}`}
          desc="แท่งซ้อนตามช่วงอายุ — ความสูงรวมคือผู้ป่วยทั้งหมดของโรคนี้ในช่วงนั้น"
          hint={
            <div className="text-xs leading-relaxed">
              ซ้อนกันได้เพราะห้าช่วงอายุแบ่งผู้ป่วยออกจากกันหมด ผู้ป่วยหนึ่งรายอยู่ได้ช่วงเดียว
              · ช่วงที่มีผู้ป่วยน้อยแถบจะบางมากหรือไม่เห็นเลย กดปิดช่วงที่ใหญ่สุดใน
              คำอธิบายกราฟเพื่อดูช่วงที่เหลือ
            </div>
          }
        >
          <StackChart points={view.timeline} series={view.ageSeries} />
        </Panel>

        <Panel
          title={`ผู้ป่วยและการเสียชีวิตของแต่ละช่วงอายุ · ${rangeLabel}`}
          desc="แท่งบนคือผู้ป่วยของช่วงอายุนั้น แท่งล่างคือจำนวนที่เสียชีวิต — ชี้ที่แท่งเพื่อดูอัตรา"
          hint={
            <div className="text-xs leading-relaxed">
              ช่วงอายุที่มีผู้ป่วยหลักหน่วยถึงหลักสิบ อัตราการเสียชีวิตแทบไม่มีความหมายทาง
              สถิติ ตายรายเดียวในสิบรายได้ 10% ทันที ให้ดูจำนวนรายควบคู่เสมอ
            </div>
          }
        >
          {view.ageBars.length > 0 ? (
            <GroupChart points={view.ageBars} />
          ) : (
            <Empty
              description={<span className="text-xs text-ink-3">ไม่มีผู้ป่วยโรคนี้ในช่วงนี้</span>}
            />
          )}
        </Panel>
      </div>

      <section className="mt-4 rounded-2xl border border-line bg-panel p-4 backdrop-blur">
        <div className="mb-3 text-sm font-semibold text-ink">
          ตารางผู้ป่วยในแยกตามช่วงอายุ {rangeLabel}
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
              render: (value: string, row) => <PeriodCell value={value} partial={row.partial} />,
            },
            ...COPD_AGE_BANDS.map(band => ({
              key: band,
              title: AGE_LABEL[band].short,
              align: 'right' as const,
              render: (_: unknown, row: CopdPeriod) =>
                nf.format(row.inpatient[disease].ages[band].total),
            })),
            {
              key: 'total',
              title: 'รวม',
              align: 'right',
              render: (_, row) => (
                <span className="font-semibold text-ink">
                  {nf.format(row.inpatient[disease].total.total)}
                </span>
              ),
            },
            {
              key: 'per1000',
              title: 'ต่อผู้ป่วยในพันราย',
              align: 'right',
              render: (_, row) => {
                const rate = per1000(row.inpatient[disease].total.total, row.admissions)
                const previous = previousOf.get(row.key)
                return (
                  <div>
                    <span className="text-ink">{rate == null ? '—' : rate.toFixed(1)}</span>
                    <div className="text-xs">
                      <Delta
                        current={rate}
                        previous={
                          previous == null || row.partial !== previous.partial
                            ? null
                            : per1000(previous.inpatient[disease].total.total, previous.admissions)
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
              render: (_, row) => nf.format(row.inpatient[disease].total.dead),
            },
            {
              key: 'rate',
              title: 'ร้อยละการเสียชีวิต',
              align: 'right',
              render: (_, row) => (
                <RateCell
                  count={row.inpatient[disease].total}
                  target={null}
                  previous={comparable(
                    row,
                    previousOf.get(row.key)?.inpatient[disease].total ?? null,
                  )}
                />
              ),
            },
          ]}
        />
        <div className="mt-2 text-xs text-ink-3">
          ห้าคอลัมน์ช่วงอายุบวกกันได้เท่าคอลัมน์รวมพอดี
          {view.ageUnknown.total > 0 &&
            ` (บวกผู้ป่วยที่ไม่มีอายุในทะเบียนอีก ${nf.format(view.ageUnknown.total)} ราย)`}{' '}
          · คอลัมน์ “ต่อผู้ป่วยในพันราย” ไม่ได้ระบายสีขึ้นลง เพราะยังไม่มีเกณฑ์ว่าทิศไหนคือ
          ดีขึ้น — ผู้ป่วยมากขึ้นอ่านได้ทั้งว่าโรคมากขึ้นและว่าเข้าถึงบริการได้ดีขึ้น
        </div>
      </section>
    </section>
  )
}

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
    const admissions = stats.periods.reduce((n, period) => n + period.admissions, 0)
    const asWritten = sumOf(stats.periods, period => period.pneumoniaAsWritten)

    /**
     * ผู้ป่วยในของโรคหนึ่ง รวมทั้งช่วงที่เลือก
     *
     * สองโรค (COPD และหืด) ตอบคำถามเดียวกันและแสดงด้วยส่วนหน้าตาเดียวกัน จึงคิด
     * ด้วยฟังก์ชันเดียว ไม่ได้เขียนสองชุด — ถ้าเขียนซ้ำ วันหนึ่งสองส่วนจะคิด
     * อัตราไม่เหมือนกันแล้วไม่มีใครรู้ว่าอันไหนถูก
     */
    const timeline: Timeline = stats.periods.map(period => ({
      label: periodLabel(period.key).short,
      title: periodLabel(period.key).full,
      partial: period.partial,
    }))

    const diseaseView = (disease: CopdDisease): DiseaseView => {
      const totals = sumOf(stats.periods, period => period.inpatient[disease].total)
      const ageTotals = Object.fromEntries(
        COPD_AGE_BANDS.map(band => [
          band,
          sumOf(stats.periods, period => period.inpatient[disease].ages[band]),
        ]),
      ) as Record<CopdAgeBand, CopdCount>
      return {
        disease,
        timeline,
        totals,
        admissions,
        per1000: per1000(totals.total, admissions),
        ageTotals,
        ageUnknown: sumOf(stats.periods, period => period.inpatient[disease].ageUnknown),
        // แท่งซ้อนได้จริง เพราะห้าช่วงอายุแบ่งผู้ป่วยออกจากกันหมด ไม่ซ้อนกัน
        ageSeries: COPD_AGE_BANDS.map<TrendSeries>(band => ({
          name: AGE_LABEL[band].short,
          values: stats.periods.map(period => period.inpatient[disease].ages[band].total),
        })),
        // แท่งคู่: ผู้ป่วยของช่วงอายุนั้น เทียบ จำนวนที่เสียชีวิต
        ageBars: COPD_AGE_BANDS.filter(band => ageTotals[band].total > 0).map<GroupPoint>(band => ({
          name: AGE_LABEL[band].short,
          total: ageTotals[band].total,
          dead: ageTotals[band].dead,
        })),
        /** ช่วงอายุที่ไม่มีผู้ป่วยเลย — ต้องบอกว่าเป็นธรรมชาติของโรค ไม่ใช่กราฟพัง */
        emptyBands: COPD_AGE_BANDS.filter(band => ageTotals[band].total === 0),
        // ช่วงอายุที่พบมากที่สุด — การ์ดสรุปของแต่ละโรคชี้ไปที่คนละช่วง
        topBand:
          totals.total === 0
            ? null
            : [...COPD_AGE_BANDS].sort((a, b) => ageTotals[b].total - ageTotals[a].total)[0],
      }
    }

    /* ---------- การใช้ยาสูดพ่น สำหรับส่วนที่ 3 ---------- */
    const tierTotals = Object.fromEntries(
      COPD_DRUG_TIERS.map(tier => [
        tier,
        {
          patients: stats.periods.reduce((n, period) => n + period.drugs.tiers[tier].patients, 0),
          withSpiriva: stats.periods.reduce(
            (n, period) => n + period.drugs.tiers[tier].withSpiriva,
            0,
          ),
          withOutside: stats.periods.reduce(
            (n, period) => n + period.drugs.tiers[tier].withOutside,
            0,
          ),
        },
      ]),
    ) as CopdDrugs['tiers']
    const totalPatients = COPD_DRUG_TIERS.reduce((n, tier) => n + tierTotals[tier].patients, 0)
    const drugView = {
      tiers: tierTotals,
      totalPatients,
      totalWithSpiriva: COPD_DRUG_TIERS.reduce((n, tier) => n + tierTotals[tier].withSpiriva, 0),
      outside: stats.periods.reduce((n, period) => n + period.drugs.outside, 0),
      outsideOnly: stats.periods.reduce((n, period) => n + period.drugs.outsideOnly, 0),
      // ขั้นที่พบมากที่สุดของช่วงที่เลือก — null เมื่อไม่มีผู้ป่วยเลย
      top:
        totalPatients === 0
          ? null
          : [...COPD_DRUG_TIERS].sort(
              (a, b) => tierTotals[b].patients - tierTotals[a].patients,
            )[0],
      // แท่งซ้อนได้จริง เพราะผู้ป่วยหนึ่งคนอยู่ขั้นเดียวต่อหนึ่งช่วง
      series: COPD_DRUG_TIERS.map<TrendSeries>(tier => ({
        name: TIER_LABEL[tier].short,
        values: stats.periods.map(period => period.drugs.tiers[tier].patients),
      })),
      // แท่งคู่: ผู้ป่วยของขั้นนั้น เทียบ จำนวนที่ได้ Spiriva ร่วมจริง
      spirivaBars: COPD_DRUG_TIERS.filter(tier => tierTotals[tier].patients > 0).map<GroupPoint>(
        tier => ({
          name: TIER_LABEL[tier].short,
          total: tierTotals[tier].patients,
          dead: tierTotals[tier].withSpiriva,
        }),
      ),
    }

    return {
      latest,
      running,
      latestLabel: periodLabel(latest.key).full,
      scope,
      // ช่วงเวลาที่กราฟแท่งซ้อนใช้เป็นแกนนอน — ชุดเดียวกับที่กราฟอื่นในหน้าใช้
      timeline,
      pneumonia: {
        totals: pneumoniaTotals,
        trend: trend(period => period.pneumonia[scope]),
        asWritten,
        // ผลต่างระหว่างชุดรหัสที่แก้แล้วกับชุดเดิม — ตัวเลขที่หน้าจอต้องบอก
        missedByOldCodes: pneumoniaTotals.total - asWritten.total,
      },
      diseases: Object.fromEntries(
        COPD_DISEASES.map(disease => [disease, diseaseView(disease)]),
      ) as Record<CopdDisease, ReturnType<typeof diseaseView>>,
      drugs: drugView,
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

            <DiseaseSection
              number={2}
              title="ผู้ป่วยในโรคปอดอุดกั้นเรื้อรัง (J44) แยกตามช่วงอายุ"
              codes="J44 รวมรหัสลูกทั้งหมด (J440-J449)"
              desc="การนอนโรงพยาบาลที่มีรหัส J44 เป็นโรคหลัก — มีเท่าไร อยู่ในช่วงอายุใด และเสียชีวิตกี่ราย"
              note={
                <div className="mt-1.5">
                  ถ้านับทุกประเภทการวินิจฉัยจะได้ราวเท่าตัว เพราะ COPD มักเป็นโรคประจำตัวที่
                  ติดมากับการนอนด้วยเรื่องอื่น ตัวเลขที่นี่คือ “นอนเพราะ COPD” ไม่ใช่ “มี COPD”
                </div>
              }
              view={view.diseases.copd}
              stats={stats}
              periodTitle={periodTitle}
              rangeLabel={rangeLabel}
              previousOf={view.previousOf}
            />

            <DiseaseSection
              number={3}
              title="ผู้ป่วยในโรคหืด (J45-J46) แยกตามช่วงอายุ"
              codes="J45 รวมรหัสลูก (J450-J459) และ J46 status asthmaticus"
              desc="การนอนโรงพยาบาลที่มีรหัส J45 หรือ J46 เป็นโรคหลัก — มีเท่าไร อยู่ในช่วงอายุใด และเสียชีวิตกี่ราย"
              note={
                <>
                  <div className="mt-1.5">
                    คิวรีที่ได้รับมาเขียนช่วงเป็น <code>BETWEEN J45 AND J46</code> ซึ่งตรวจกับ
                    ฐานแล้ว<b>จับได้ครบ</b> 3,915 แถว เท่ากับการนับด้วยสามหลักแรกพอดี เพราะ J46
                    ไม่มีรหัสลูกในฐานนี้ — ต่างจากรายการรหัสปอดบวมของส่วนที่ 1 ที่พลาดเพราะ
                    เขียนจุดทศนิยม
                  </div>
                  <div className="mt-1.5">
                    <b>โรคนี้กลับทางกับ COPD</b> — ผู้ป่วยส่วนใหญ่เป็นเด็กอายุต่ำกว่า 15 ปี
                    ขณะที่ COPD เกือบทั้งหมดอายุ 60 ปีขึ้นไป สองส่วนนี้จึงอ่านคู่กันได้ว่าเป็น
                    คนละกลุ่มประชากรโดยสิ้นเชิง
                  </div>
                  <div className="mt-1.5">
                    การเสียชีวิตของโรคหืดมีหลักหน่วยหรือศูนย์ในทุกปีงบ ร้อยละการเสียชีวิตจึง
                    แทบไม่มีความหมายทางสถิติ ให้ดูจำนวนรายเป็นหลัก
                  </div>
                </>
              }
              view={view.diseases.asthma}
              stats={stats}
              periodTitle={periodTitle}
              rangeLabel={rangeLabel}
              previousOf={view.previousOf}
            />
            <section className="mt-2">
              <SectionHead
                title="4 · การใช้ยาสูดพ่นของผู้ป่วย COPD จำแนกตามขั้นของยา"
                desc="ผู้ป่วยนอกที่เคยวินิจฉัย COPD ได้รับยาสูดพ่นขั้นไหน นับหนึ่งคนต่อหนึ่งช่วงเวลาที่ขั้นสูงสุดที่ได้รับ"
                hint={
                  <div className="text-xs leading-relaxed">
                    <div>
                      <b>ขอบเขตต่างจากสองส่วนบนโดยสิ้นเชิง</b> — ส่วนนี้เป็นผู้ป่วย<b>นอก</b>
                      นับตามวันมารับบริการ และกลุ่มผู้ป่วยคือคนที่<b>เคย</b>มีรหัส J44 เป็น
                      โรคหลักของผู้ป่วยนอก ไม่จำกัดปี ส่วนที่ 1 ถึง 3 เป็นผู้ป่วยในนับตามวัน
                      จำหน่าย ตัวเลขสองฝั่งจึงเอามาหารกันไม่ได้
                    </div>
                    <div className="mt-1.5">
                      หน่วยนับคือ <b>ผู้ป่วยหนึ่งคนต่อหนึ่งช่วง</b> ไม่ใช่จำนวนใบสั่งยา คนที่มา
                      รับยาสามปีงบนับสามครั้ง ผลรวมข้ามช่วงจึงไม่ใช่จำนวนคนที่ไม่ซ้ำ · ขั้นที่
                      ได้คือ<b>ขั้นสูงสุด</b>ที่ได้รับในช่วงนั้น คนหนึ่งอยู่ขั้นเดียวต่อหนึ่งช่วง
                      สี่ขั้นจึงบวกกันได้และวางเป็นแท่งซ้อนได้
                    </div>
                    <div className="mt-1.5">
                      <b>ชื่อขั้นในคิวรีที่ได้รับมาอ่านว่าเป็นยาคู่ แต่เงื่อนไขไม่ได้บังคับ</b> —
                      “Spiriva_Symbicort” ติดให้ทุกคนที่ได้ Symbicort ไม่ว่าจะได้ Spiriva ร่วม
                      หรือไม่ ตรวจกับฐานแล้วคนส่วนใหญ่ของทุกขั้น<b>ไม่ได้รับ Spiriva เลย</b>
                      หน้านี้จึงตั้งชื่อขั้นตามยาที่ตัดสินขั้นจริง และมีคอลัมน์บอกว่าได้ Spiriva
                      ร่วมกี่ราย ถ้าเจตนาคือยาคู่จริง ๆ ตรรกะต้องแก้ ซึ่งเป็นเรื่องของคณะกรรมการ
                    </div>
                    <div className="mt-1.5">
                      <b>ลำดับขั้น D &gt; C &gt; B &gt; A มาจากคิวรีที่ได้รับมา ไม่ได้จัดเอง</b> —
                      สังเกตว่า EVOFLO-125 มี fluticasone น้อยกว่า SERETIDE-250 แต่อยู่ขั้นต่ำกว่า
                      และ SYMBICORT เป็นยาคนละโมเลกุล การเรียงนี้จึงเป็นข้อตกลงของบัญชียา
                      โรงพยาบาล ไม่ใช่ลำดับความแรงทางเภสัชวิทยา
                    </div>
                    <div className="mt-1.5">
                      <b>มียาสูดพ่นนอกรายการเจ็ดรหัสที่ผู้ป่วยได้รับจริง</b> — Spiolto Respimat
                      (tiotropium + olodaterol) เพิ่มจาก 8 รายในปีงบ 2566 เป็น 104 รายในปีงบ
                      2569 ยาตัวนี้ไม่มีในลำดับขั้นที่ได้รับมา จึงจัดขั้นให้เองไม่ได้ นับแยกไว้
                      ให้เห็น และบอกด้วยว่ากี่รายที่ได้ยานอกรายการอย่างเดียว ซึ่งกลุ่มนั้นจะ
                      หายไปทั้งหมดถ้านับตามรายการเดิม
                    </div>
                    <div className="mt-1.5">
                      รหัสยาที่อยู่ในทะเบียนแต่ไม่มีการจ่ายให้ผู้ป่วย COPD เลยในห้าปี (SPIRIVA
                      รหัสเก่าสองตัว · SE-RE-TIDE Evohaler · RELVAR Ellipta) ไม่ได้ใส่ไว้
                      เพราะใส่แล้วก็ได้ศูนย์
                    </div>
                  </div>
                }
              />

              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi
                  label={`ผู้ป่วยที่ได้รับยาในรายการ · ${rangeLabel}`}
                  value={nf.format(view.drugs.totalPatients)}
                  hint={
                    fiscalYear == null
                      ? 'นับหนึ่งคนต่อหนึ่งปีงบ คนเดิมที่มาหลายปีนับหลายครั้ง'
                      : 'นับหนึ่งคนต่อหนึ่งเดือน คนเดิมที่มาหลายเดือนนับหลายครั้ง'
                  }
                />
                <Kpi
                  label="ขั้นที่พบมากที่สุด"
                  value={view.drugs.top == null ? '—' : TIER_LABEL[view.drugs.top].short}
                  hint={
                    view.drugs.top == null
                      ? 'ไม่มีผู้ป่วยในช่วงนี้'
                      : `${nf.format(view.drugs.tiers[view.drugs.top].patients)} ราย (${((view.drugs.tiers[view.drugs.top].patients / view.drugs.totalPatients) * 100).toFixed(1)}%)`
                  }
                />
                <Kpi
                  label="ได้ Spiriva ร่วมจริง"
                  value={nf.format(view.drugs.totalWithSpiriva)}
                  hint={
                    view.drugs.totalPatients > 0
                      ? `${((view.drugs.totalWithSpiriva / view.drugs.totalPatients) * 100).toFixed(1)}% ของทั้งหมด — ชื่อขั้นอ่านว่าเป็นยาคู่ แต่ส่วนใหญ่ไม่ได้ Spiriva`
                      : 'ไม่มีผู้ป่วยในช่วงนี้'
                  }
                />
                <Kpi
                  label="ได้ยาสูดพ่นนอกรายการ"
                  value={nf.format(view.drugs.outside)}
                  hint={`Spiolto Respimat · ในจำนวนนี้ ${nf.format(view.drugs.outsideOnly)} รายไม่ได้ยาในรายการเลย จึงไม่อยู่ในสี่ขั้น`}
                />
              </section>

              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <Panel
                  title={`ผู้ป่วยแยกตามขั้นของยา ตาม${periodTitle}`}
                  desc="แท่งซ้อนตามขั้น — ความสูงรวมคือผู้ป่วยที่ได้รับยาในรายการในช่วงนั้น"
                  hint={
                    <div className="text-xs leading-relaxed">
                      ซ้อนกันได้เพราะผู้ป่วยหนึ่งคนอยู่ขั้นเดียวต่อหนึ่งช่วง (ยึดขั้นสูงสุดที่
                      ได้รับ) · ผู้ป่วยที่ได้ยานอกรายการอย่างเดียวไม่อยู่ในกราฟนี้ ดูจำนวนได้
                      จากการ์ดด้านบนและคอลัมน์สุดท้ายของตาราง
                    </div>
                  }
                >
                  <StackChart points={view.timeline} series={view.drugs.series} />
                </Panel>

                <Panel
                  title={`แต่ละขั้น ได้ Spiriva ร่วมกี่ราย · ${rangeLabel}`}
                  desc="แท่งบนคือผู้ป่วยของขั้นนั้น แท่งล่างคือจำนวนที่ได้รับ Spiriva ร่วมในช่วงเดียวกันจริง"
                  hint={
                    <div className="text-xs leading-relaxed">
                      กราฟนี้มีไว้ตอบข้อเดียว — ชื่อขั้นที่ได้รับมาอ่านว่าเป็นยาคู่กับ Spiriva
                      ความจริงเป็นอย่างไร · ขั้น A เป็น Spiriva อยู่แล้ว แท่งสองอันจึงเท่ากัน
                      เสมอโดยนิยาม ไม่ใช่ความบังเอิญ
                    </div>
                  }
                >
                  {view.drugs.spirivaBars.length > 0 ? (
                    <GroupChart
                      points={view.drugs.spirivaBars}
                      labels={{ total: 'ผู้ป่วยในขั้นนี้', part: 'ได้ Spiriva ร่วม' }}
                    />
                  ) : (
                    <Empty
                      description={
                        <span className="text-xs text-ink-3">ไม่มีผู้ป่วยที่ได้รับยาในช่วงนี้</span>
                      }
                    />
                  )}
                </Panel>
              </div>

              <section className="mt-4 rounded-2xl border border-line bg-panel p-4 backdrop-blur">
                <div className="mb-3 text-sm font-semibold text-ink">
                  ตารางการใช้ยาสูดพ่นแยกตามขั้น {rangeLabel}
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
                    ...COPD_DRUG_TIERS.map(tier => ({
                      key: tier,
                      title: TIER_LABEL[tier].short,
                      align: 'right' as const,
                      render: (_: unknown, row: CopdPeriod) => (
                        <div>
                          <span className="text-ink">
                            {nf.format(row.drugs.tiers[tier].patients)}
                          </span>
                          <div className="text-xs text-ink-3">
                            Spiriva ร่วม {nf.format(row.drugs.tiers[tier].withSpiriva)}
                          </div>
                        </div>
                      ),
                    })),
                    {
                      key: 'total',
                      title: 'รวมที่ได้ยาในรายการ',
                      align: 'right',
                      render: (_, row) => (
                        <span className="font-semibold text-ink">
                          {nf.format(tierSum(row.drugs))}
                        </span>
                      ),
                    },
                    {
                      key: 'outside',
                      title: 'ได้ยานอกรายการ',
                      align: 'right',
                      render: (_, row) => (
                        <div>
                          <span className="text-ink">{nf.format(row.drugs.outside)}</span>
                          <div className="text-xs text-ink-3">
                            ไม่ได้ยาในรายการเลย {nf.format(row.drugs.outsideOnly)}
                          </div>
                        </div>
                      ),
                    },
                  ]}
                />
                <div className="mt-2 text-xs text-ink-3">
                  สี่คอลัมน์ขั้นบวกกันได้เท่าคอลัมน์รวมพอดี · บรรทัดเล็กใต้ตัวเลขของแต่ละขั้นคือ
                  จำนวนที่ได้ Spiriva ร่วมจริง ซึ่งน้อยกว่าที่ชื่อขั้นสื่อไว้มาก · คอลัมน์
                  “ได้ยานอกรายการ” ไม่ได้บวกอยู่ในคอลัมน์รวม เพราะยาตัวนั้นยังไม่มีขั้น
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
