'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ยังทำที่ app/home/layout.tsx ซึ่งเป็น Server Component)
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Alert,
  Breadcrumb,
  Button,
  Empty,
  Segmented,
  Select,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd'
import { ArrowLeftOutlined, EnvironmentOutlined, FireOutlined } from '@ant-design/icons'
import { apiFetch } from '@/lib/client/session'
// รายชื่อกลุ่มมาจาก sepsis-groups ไม่ใช่ sepsis-stats — อันหลังเป็น server-only
// ถ้า import ค่า (ไม่ใช่แค่ type) จากที่นั่น bundler จะลาก mysql2 เข้า client bundle
import {
  SEPSIS_ORGANS,
  SEPSIS_SITES,
  SEPSIS_UNDERLYING,
  type SepsisArea,
  type SepsisCount,
  type SepsisGroup,
  type SepsisPeriod,
} from '@/lib/his/sepsis-groups'
import type { SepsisStats } from '@/lib/his/sepsis-stats'
import { BlockSkeleton, StatCardsSkeleton, TableRowsSkeleton } from '@/app/home/skeletons'
import PageHint from '../../page-hint'
import {
  AreaChart,
  GroupChart,
  MortalityChart,
  type AreaPoint,
  type GroupPoint,
  type MortalityPoint,
} from '../charts'
import {
  comparable,
  Delta,
  Kpi,
  nf,
  NumberCell,
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
 * Service Plan สาขา Sepsis — สถานการณ์ผู้ป่วยและการเสียชีวิต
 *
 * เจ็ดคำถามเรียงกัน: มีผู้ป่วยเท่าไรและตายเท่าไร (ภาพรวม) · เป็นชนิดไหนและติดเชื้อ
 * มาจากไหน (Sepsis/Septic shock · CI/HI) · ติดเชื้อที่ระบบใดของร่างกาย (เก้าระบบ) ·
 * อวัยวะล้มเหลวไปแล้วกี่ราย (O1-O5) · ผู้ป่วยมีโรคประจำตัวอะไรติดมา (P1-P8) ·
 * ผู้ป่วยมาจากอำเภอและตำบลไหน (CI/HI) · และในเขตรับผิดชอบเมื่อตัดผู้ป่วยที่รับ
 * ส่งต่อมาออกแล้วเหลือเท่าไร
 *
 * ไม่มีเกณฑ์ที่ตกลงกันไว้สักข้อ หน้านี้จึงไม่ตัดสินผ่าน/ไม่ผ่านเลย แสดงเป็นอัตรา
 * และแนวโน้มล้วน ถ้าคณะกรรมการกำหนดเกณฑ์มาเมื่อไร ที่ของมันคือตารางค่าตั้ง
 * ไม่ใช่ค่าคงที่ในไฟล์นี้
 *
 * ไม่มีข้อมูลรายบุคคลในหน้านี้ ตัวเลขทุกตัวเป็นผลรวมรายช่วงที่นับมาจากฐานข้อมูล
 */

/** ชื่อไทยและคำอธิบายของแต่ละกลุ่ม — ลำดับในนี้คือลำดับที่แสดงผล */
const GROUP_LABEL: Record<SepsisGroup, { short: string; long: string }> = {
  all: { short: 'ทั้งหมด', long: 'Sepsis + Septic shock ทั้งหมด' },
  sepsisOnly: { short: 'Sepsis', long: 'Sepsis (A40-A419)' },
  shockOnly: { short: 'Septic shock', long: 'Septic shock (R572)' },
  communityInfection: { short: 'CI', long: 'ติดเชื้อมาจากนอกโรงพยาบาล (CI)' },
  hospitalInfection: { short: 'HI', long: 'ติดเชื้อระหว่างนอนโรงพยาบาล (HI)' },
  ciSepsis: { short: 'CI Sepsis', long: 'CI เฉพาะที่เป็น Sepsis (A40-A419 แรกรับ)' },
  ciShock: { short: 'CI Shock', long: 'CI เฉพาะที่เป็น Septic shock (R572 แรกรับ)' },
  lrti: { short: 'LRTI', long: 'ทางเดินหายใจส่วนล่าง (LRTI)' },
  uti: { short: 'UTI', long: 'ทางเดินปัสสาวะ (UTI)' },
  bsi: { short: 'BSI', long: 'กระแสเลือด (BSI)' },
  gi: { short: 'GI', long: 'ทางเดินอาหาร (GI)' },
  hbp: { short: 'HBP', long: 'ตับ ถุงน้ำดี ตับอ่อน (HBP)' },
  skin: { short: 'Skin', long: 'ผิวหนังและเนื้อเยื่ออ่อน' },
  musculo: { short: 'Musculo', long: 'กระดูกและกล้ามเนื้อ' },
  cns: { short: 'CNS', long: 'ระบบประสาทส่วนกลาง (CNS)' },
  tropical: { short: 'Tropical', long: 'โรคติดเชื้อเขตร้อน' },
  arf: { short: 'ARF', long: 'ภาวะหายใจล้มเหลว (ARF · J960, J80)' },
  aki: { short: 'AKI', long: 'ไตวายเฉียบพลัน (AKI · N17)' },
  dic: { short: 'DIC', long: 'ภาวะการแข็งตัวของเลือดผิดปกติ (DIC · D65)' },
  encephalopathy: { short: 'Encephalopathy', long: 'สมองทำงานผิดปกติจากการติดเชื้อ (G9432)' },
  cholestasis: { short: 'Cholestasis', long: 'ภาวะน้ำดีคั่งจากการติดเชื้อ (K710)' },
  ckd: { short: 'CKD', long: 'โรคไตเรื้อรัง (N18, E112 หรือมีหัตถการฟอกเลือด)' },
  dm: { short: 'DM', long: 'เบาหวาน (E10-E14)' },
  cirrhosis: { short: 'Cirrhosis', long: 'ตับแข็ง (K703, K746)' },
  lung: { short: 'Chronic lung', long: 'โรคปอดเรื้อรัง (COPD, หืด, โรคเนื้อปอด)' },
  heart: {
    short: 'Heart',
    long: 'โรคหัวใจ (ลิ้นหัวใจ ขาดเลือด กล้ามเนื้อหัวใจ พิการแต่กำเนิด)',
  },
  hiv: { short: 'HIV', long: 'ติดเชื้อเอชไอวี (B20-B24)' },
  cancer: { short: 'Cancer', long: 'มะเร็ง (C00-C96)' },
  autoimmune: { short: 'Autoimmune', long: 'โรคภูมิต้านตนเอง (M05-M06, M32-M34)' },
}

/** ชนิดและที่มาของการติดเชื้อ — หกกลุ่มที่ตอบว่า "เป็นอะไร มาจากไหน" */
const TYPE_GROUPS: SepsisGroup[] = [
  'sepsisOnly',
  'shockOnly',
  'communityInfection',
  'hospitalInfection',
  'ciSepsis',
  'ciShock',
]

/** กลุ่มที่ขึ้นเป็นคอลัมน์อัตราตายในตารางภาพรวม — หกกลุ่มทำให้ตารางกว้างเกินจอ */
const TABLE_TYPE_GROUPS: SepsisGroup[] = [
  'sepsisOnly',
  'shockOnly',
  'communityInfection',
  'hospitalInfection',
]

/** จังหวัดที่โรงพยาบาลตั้งอยู่ — ใช้แค่ในคำอธิบายที่บอกเงื่อนไขของคิวรี */
const HOSPITAL_PROVINCE = '56'

/**
 * ตัวชี้วัดที่กราฟรายพื้นที่แสดงได้ — CI หรือ HI
 *
 * เลือกอันเดียวต่อครั้ง ไม่ใช่วางซ้อนกัน เพราะแกนสีบอกปริมาณได้ทีละชุดเท่านั้น
 * และตารางใต้กราฟแสดงทั้งสองพร้อมกันอยู่แล้วสำหรับคนที่อยากเทียบ
 */
const AREA_MEASURES = ['ci', 'hi'] as const
type AreaMeasure = (typeof AREA_MEASURES)[number]

const MEASURE_LABEL: Record<AreaMeasure, { short: string; long: string }> = {
  ci: { short: 'CI', long: 'ติดเชื้อมาจากชุมชน (CI)' },
  hi: { short: 'HI', long: 'ติดเชื้อในโรงพยาบาล (HI)' },
}

/** ค่าของตัวเลือก "ทุกอำเภอ" — รหัสอำเภอเป็นตัวเลขสองหลัก จึงชนกันไม่ได้ */
const ALL_DISTRICTS = 'all'

/** รวมทุกช่วงของกลุ่มหนึ่ง — การ์ดและกราฟเทียบกลุ่มใช้ยอดรวมของทั้งช่วงที่เลือก */
const sumOf = (periods: SepsisPeriod[], group: SepsisGroup) =>
  periods.reduce(
    (acc, period) => ({
      total: acc.total + period.groups[group].total,
      dead: acc.dead + period.groups[group].dead,
    }),
    { total: 0, dead: 0 },
  )

/**
 * ตารางเทียบกลุ่มในช่วงเดียว — ใช้ซ้ำสามส่วน (ตำแหน่งการติดเชื้อ · อวัยวะล้มเหลว ·
 * โรคประจำตัว) เพราะทั้งสามถามคำถามเดียวกัน: กลุ่มนี้มีกี่ราย ตายกี่ราย คิดเป็น
 * สัดส่วนเท่าไรของผู้ป่วยทั้งหมด และอัตราตายของกลุ่มสูงกว่าภาพรวมกี่จุด
 *
 * คอลัมน์สุดท้ายคือคอลัมน์ที่ตอบคำถามของรายงาน — "กลุ่มนี้ตายมากกว่าปกติไหม"
 * เทียบเป็นจุดร้อยละกับอัตราตายของผู้ป่วยทั้งหมดในช่วงเดียวกัน
 */
function GroupTable({
  title,
  groups,
  totals,
  overall,
  firstColumn,
}: {
  title: string
  groups: SepsisGroup[]
  totals: Record<SepsisGroup, SepsisCount>
  overall: SepsisCount
  firstColumn: string
}) {
  const overallRate = rateOf(overall)
  return (
    <section className="mt-4 rounded-2xl border border-line bg-panel p-4 backdrop-blur">
      <div className="mb-3 text-sm font-semibold text-ink">{title}</div>
      <Table
        size="small"
        rowKey="group"
        pagination={false}
        scroll={{ x: 'max-content' }}
        dataSource={groups
          .map(group => ({ group, name: GROUP_LABEL[group].long, count: totals[group] }))
          .sort((a, b) => b.count.total - a.count.total)}
        columns={[
          {
            key: 'name',
            title: firstColumn,
            dataIndex: 'name',
            render: (name: string) => <span className="text-ink">{name}</span>,
          },
          {
            key: 'total',
            title: 'ผู้ป่วย',
            align: 'right',
            render: (_, row) => nf.format(row.count.total),
          },
          {
            key: 'dead',
            title: 'เสียชีวิต',
            align: 'right',
            render: (_, row) => nf.format(row.count.dead),
          },
          {
            key: 'rate',
            title: 'อัตราตาย',
            align: 'right',
            render: (_, row) => <RateCell count={row.count} target={null} />,
          },
          {
            key: 'share',
            title: 'สัดส่วนของผู้ป่วยทั้งหมด',
            align: 'right',
            render: (_, row) =>
              overall.total > 0 ? `${((row.count.total / overall.total) * 100).toFixed(1)}%` : '—',
          },
          {
            key: 'gap',
            title: 'เทียบอัตราตายภาพรวม',
            align: 'right',
            render: (_, row) => (
              <Delta current={rateOf(row.count)} previous={overallRate} digits={2} suffix=" จุด" />
            ),
          },
        ]}
      />
    </section>
  )
}

export default function ServicePlanSepsisPage() {
  const [stats, setStats] = useState<SepsisStats | null>(null)
  const [fiscalYear, setFiscalYear] = useState<number | null>(null)
  const [quarter, setQuarter] = useState<QuarterChoice>(0)
  const [measure, setMeasure] = useState<AreaMeasure>('ci')
  /** รหัสอำเภอที่เจาะดูรายตำบล — null คือกำลังดูทุกอำเภอ */
  const [district, setDistrict] = useState<string | null>(null)
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
        const res = await apiFetch(
          `/api/his/service-plan/sepsis${query === '' ? '' : `?${query}`}`,
        )
        const json = await res.json()
        if (!alive) return
        if (!res.ok || !json.success) {
          setStats(null)
          setError(json.message ?? 'ดึงข้อมูลสถิติไม่สำเร็จ')
          return
        }
        setStats(json.stats as SepsisStats)
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

    const trend = (group: SepsisGroup) =>
      stats.periods.map<MortalityPoint>(period => ({
        label: periodLabel(period.key).short,
        title: periodLabel(period.key).full,
        partial: period.partial,
        percent: rateOf(period.groups[group]),
        dead: period.groups[group].dead,
        total: period.groups[group].total,
      }))

    const bars = (groups: SepsisGroup[]): GroupPoint[] =>
      groups.map(group => {
        const sum = sumOf(stats.periods, group)
        return { name: GROUP_LABEL[group].short, total: sum.total, dead: sum.dead }
      })

    const totals = Object.fromEntries(
      ['all' as const, ...TYPE_GROUPS, ...SEPSIS_SITES, ...SEPSIS_ORGANS, ...SEPSIS_UNDERLYING].map(
        group => [group, sumOf(stats.periods, group)],
      ),
    ) as Record<SepsisGroup, SepsisCount>

    /* ---------- พื้นที่ ---------- */
    const { districts, outside, inProvince, homeDistrict } = stats.areas
    const selectedDistrict = district == null ? null : districts.find(d => d.id === district)
    // แถวที่กราฟและตารางของส่วนที่ 6 อ่าน — อำเภอทั้งหมด หรือตำบลของอำเภอที่เจาะอยู่
    const rows: SepsisArea[] = selectedDistrict?.tambons ?? districts
    const measured = (area: SepsisArea) => (measure === 'ci' ? area.ci : area.hi)
    const areaView = {
      rows: [...rows].sort((a, b) => measured(b).total - measured(a).total),
      // พื้นที่ที่ไม่มีผู้ป่วยของตัวชี้วัดที่เลือกไม่ขึ้นกราฟ — แท่งศูนย์ไม่ได้บอกอะไร
      // และทำให้แกนสีไล่จากศูนย์เสียเปล่า แต่ยังอยู่ในตารางให้เห็นว่าเป็นศูนย์
      points: [...rows]
        .sort((a, b) => measured(b).total - measured(a).total)
        .filter(area => measured(area).total > 0)
        .map<AreaPoint>(area => ({
          id: area.id,
          name: area.name,
          patients: measured(area).total,
          dead: measured(area).dead,
        })),
      selected:
        selectedDistrict == null
          ? null
          : {
              name: selectedDistrict.name,
              count: measured(selectedDistrict),
              tambonCount: selectedDistrict.tambons.length,
            },
      // รายการเลือกอำเภอ — เรียงและนับตามตัวชี้วัดที่เลือกไว้ เพื่อให้ลำดับกับ
      // ตัวเลขในวงเล็บตรงกับแท่งที่เห็นอยู่ และอำเภอที่ไม่มีผู้ป่วยของตัวชี้วัดนั้น
      // ยังอยู่ในรายการ ไม่ใช่หายไปจนคนหาไม่เจอแล้วคิดว่าระบบไม่มีข้อมูล
      districtOptions: [...districts]
        .sort((a, b) => measured(b).total - measured(a).total)
        .map(d => ({ id: d.id, name: d.name, total: measured(d).total })),
      inProvince: measure === 'ci' ? inProvince.ci : inProvince.hi,
      outside: measure === 'ci' ? outside.ci : outside.hi,
    }

    /* ---------- อำเภอที่โรงพยาบาลตั้งอยู่ สำหรับส่วนที่ 7 ---------- */
    const home = districts.find(d => d.id === homeDistrict) ?? null
    const homeTambons = home?.tambons ?? []
    const nonReferred = {
      count: home?.ciNonReferred ?? { total: 0, dead: 0 },
      rows: [...homeTambons].sort((a, b) => b.ciNonReferred.total - a.ciNonReferred.total),
      points: [...homeTambons]
        .sort((a, b) => b.ciNonReferred.total - a.ciNonReferred.total)
        .filter(tambon => tambon.ciNonReferred.total > 0)
        .map<AreaPoint>(tambon => ({
          id: tambon.id,
          name: tambon.name,
          patients: tambon.ciNonReferred.total,
          dead: tambon.ciNonReferred.dead,
        })),
    }

    return {
      latest,
      running,
      latestLabel: periodLabel(latest.key).full,
      all: trend('all'),
      shock: trend('shockOnly'),
      hospital: trend('hospitalInfection'),
      arf: trend('arf'),
      aki: trend('aki'),
      types: bars(TYPE_GROUPS),
      // ตำแหน่ง อวัยวะ และโรคประจำตัว เรียงจากมากไปน้อยของช่วงที่เลือก เพราะคำถาม
      // คือ "อะไรพบมากที่สุด" ไม่ใช่การไล่ตามลำดับที่กำหนดไว้ล่วงหน้า
      sites: bars(SEPSIS_SITES).sort((a, b) => b.total - a.total),
      organs: bars(SEPSIS_ORGANS).sort((a, b) => b.total - a.total),
      underlying: bars(SEPSIS_UNDERLYING).sort((a, b) => b.total - a.total),
      totals,
      /** กลุ่มที่ไม่มีผู้ป่วยเลยทั้งช่วง — ต้องบอกว่าเพราะรหัสไม่ได้ใช้ ไม่ใช่กราฟพัง */
      emptyOrgans: SEPSIS_ORGANS.filter(group => totals[group].total === 0),
      areas: areaView,
      home,
      nonReferred,
      previousOf: new Map(
        stats.periods.map((period, index) => [
          period.key,
          index > 0 ? stats.periods[index - 1] : null,
        ]),
      ),
    }
  }, [stats, measure, district])

  /** ชื่ออำเภอที่โรงพยาบาลตั้งอยู่ — มาจากทะเบียน ไม่ได้ฝังเป็นข้อความในหน้า */
  const homeDistrictName = view?.home?.name ?? 'อำเภอที่โรงพยาบาลตั้งอยู่'

  return (
    <>
      <section className="mb-6">
        <Breadcrumb
          className="mb-2"
          items={[
            { title: <Link href="/home/service-plan">Service Plan</Link> },
            { title: 'Sepsis' },
          ]}
        />
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          <FireOutlined /> Sepsis
          <PageHint>
            สถานการณ์ผู้ป่วยในที่มีภาวะติดเชื้อในกระแสเลือด (A40-A419) หรือช็อกจากการติดเชื้อ
            (R572) เป็นการวินิจฉัยอันใดอันหนึ่ง — จำนวนผู้ป่วย การเสียชีวิต แยกตามชนิด
            (Sepsis / Septic shock) ที่มาของการติดเชื้อ (CI / HI) ตำแหน่งการติดเชื้อเก้าระบบ
            ภาวะอวัยวะล้มเหลว โรคประจำตัวที่เป็นปัจจัยเสี่ยง และตำบลที่อยู่ของผู้ป่วยในเขต
            รับผิดชอบ ไม่มีข้อมูลรายบุคคลในหน้านี้
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
          // ออกจากการเจาะรายตำบลด้วย เพราะอำเภอที่เลือกไว้อาจไม่มีผู้ป่วยในช่วงใหม่
          setDistrict(null)
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
                  {view.running.groups.all.total === 0
                    ? `ยังไม่มีผู้ป่วย Sepsis ของ${periodLabel(view.running.key).full} ที่ลงรหัสแล้ว`
                    : `${periodLabel(view.running.key).full} มีผู้ป่วยที่ลงรหัสแล้ว ${nf.format(view.running.groups.all.total)} ราย`}
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
                title="1 · ภาพรวมผู้ป่วยและการเสียชีวิต"
                desc="การนอนโรงพยาบาลที่มีรหัส A40-A419 หรือ R572 เป็นการวินิจฉัยอันใดอันหนึ่ง (ทั้งโรคหลัก โรคร่วม และที่เกิดระหว่างนอน)"
                hint={
                  <div className="text-xs leading-relaxed">
                    <div>
                      ตัวหารคือการนอนโรงพยาบาล (AN) ไม่ใช่จำนวนคน ผู้ป่วยคนเดียวที่นอนสองครั้ง
                      ในช่วงเดียวกันนับสองครั้ง · ปีงบประมาณนับตามวันจำหน่าย 1 ต.ค. ถึง 30 ก.ย.
                    </div>
                    <div className="mt-1.5">
                      การเสียชีวิตนับจากประเภทการจำหน่าย 02, 08 และ 09 แต่
                      <b>ตัดผู้ป่วยประคับประคองออก</b> — AN ที่มีรหัส Z515 เป็นการวินิจฉัยร่วม
                      ไม่นับเป็นการเสียชีวิตของตัวชี้วัดนี้ (ต่างจากหน้า Stroke ที่นับ 08/09 ล้วน)
                    </div>
                    <div className="mt-1.5">
                      ยังไม่มีเกณฑ์เป้าหมายที่ตกลงกันไว้ หน้านี้จึงไม่ตัดสินผ่าน/ไม่ผ่าน
                      ถ้าคณะกรรมการกำหนดเกณฑ์มา แจ้งได้ จะใส่เส้นเกณฑ์และสีผ่าน/ไม่ผ่านให้
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <Tag>ipt · iptdiag</Tag>
                      <Tag>diagtype 1, 2, 3</Tag>
                      <Tag>dchtype 02, 08, 09</Tag>
                      <Tag>ไม่นับ Z515</Tag>
                    </div>
                  </div>
                }
              />
            </section>

            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi
                label={`ผู้ป่วยทั้งหมด · ${rangeLabel}`}
                value={nf.format(view.totals.all.total)}
                hint={`เสียชีวิต ${nf.format(view.totals.all.dead)} ราย · จำหน่าย ${stats.from} ถึง ${stats.to}`}
              />
              <Kpi
                label={`อัตราตาย · ${view.latestLabel}`}
                value={pctText(view.latest.groups.all)}
                hint={`เสียชีวิต ${nf.format(view.latest.groups.all.dead)} จาก ${nf.format(view.latest.groups.all.total)} ราย`}
              />
              <Kpi
                label={`อัตราตายเมื่อเป็น Septic shock · ${view.latestLabel}`}
                value={pctText(view.latest.groups.shockOnly)}
                hint={`เสียชีวิต ${nf.format(view.latest.groups.shockOnly.dead)} จาก ${nf.format(view.latest.groups.shockOnly.total)} ราย`}
              />
              <Kpi
                label={`อัตราตายเมื่อติดเชื้อในโรงพยาบาล (HI) · ${view.latestLabel}`}
                value={pctText(view.latest.groups.hospitalInfection)}
                hint={`เสียชีวิต ${nf.format(view.latest.groups.hospitalInfection.dead)} จาก ${nf.format(view.latest.groups.hospitalInfection.total)} ราย`}
              />
            </section>

            <div className="grid gap-4 xl:grid-cols-2">
              <Panel
                title="ผู้ป่วย Sepsis + Septic shock ทั้งหมด"
                desc="ความสูงรวมคือผู้ป่วยทั้งหมดของช่วงนั้น สีแดงคือจำนวนที่เสียชีวิต และเส้นคืออัตราตาย"
              >
                <MortalityChart points={view.all} target={null} />
              </Panel>
              <Panel
                title="เฉพาะที่เป็น Septic shock"
                desc="กลุ่มที่อาการหนักที่สุด — อัตราตายสูงกว่าภาพรวมเกือบเท่าตัวทุกช่วง"
              >
                <MortalityChart points={view.shock} target={null} />
              </Panel>
            </div>

            <section className="rounded-2xl border border-line bg-panel p-4 backdrop-blur">
              <div className="mb-3 text-sm font-semibold text-ink">ตารางภาพรวม {rangeLabel}</div>
              <Table
                size="small"
                rowKey="key"
                pagination={false}
                scroll={{ x: 'max-content' }}
                // ตารางเรียงจากช่วงล่าสุดลงไป ต่างจากกราฟที่ไล่ซ้ายไปขวาตามเวลา
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
                    title: 'ผู้ป่วยทั้งหมด',
                    align: 'right',
                    render: (_, row) => (
                      <NumberCell
                        value={row.groups.all.total}
                        previous={comparable(
                          row,
                          view.previousOf.get(row.key)?.groups.all.total ?? null,
                        )}
                        goal="none"
                      />
                    ),
                  },
                  {
                    key: 'dead',
                    title: 'เสียชีวิต',
                    align: 'right',
                    render: (_, row) => (
                      <NumberCell
                        value={row.groups.all.dead}
                        previous={comparable(
                          row,
                          view.previousOf.get(row.key)?.groups.all.dead ?? null,
                        )}
                      />
                    ),
                  },
                  {
                    key: 'rate',
                    title: 'อัตราตาย',
                    align: 'right',
                    render: (_, row) => (
                      <RateCell
                        count={row.groups.all}
                        target={null}
                        previous={comparable(row, view.previousOf.get(row.key)?.groups.all ?? null)}
                      />
                    ),
                  },
                  ...TABLE_TYPE_GROUPS.map(group => ({
                    key: group,
                    title: GROUP_LABEL[group].short,
                    align: 'right' as const,
                    render: (_: unknown, row: SepsisPeriod) => (
                      <RateCell
                        count={row.groups[group]}
                        target={null}
                        previous={comparable(
                          row,
                          view.previousOf.get(row.key)?.groups[group] ?? null,
                        )}
                      />
                    ),
                  })),
                ]}
              />
              <div className="mt-2 text-xs text-ink-3">
                ช่องของสี่คอลัมน์ขวาเป็นร้อยละการเสียชีวิตของกลุ่มนั้น เศษส่วนใต้ร้อยละคือ
                เสียชีวิต/ผู้ป่วยในกลุ่ม และบรรทัดล่างสุดคือส่วนต่างจากช่วงก่อนหน้า
              </div>
            </section>

            <section className="mt-2">
              <SectionHead
                title="2 · ชนิดและที่มาของการติดเชื้อ"
                desc="Sepsis กับ Septic shock แยกตามรหัส ส่วน CI/HI แยกตามว่าวินิจฉัยไว้ตั้งแต่แรกรับหรือเกิดขึ้นระหว่างนอน"
                hint={
                  <div className="text-xs leading-relaxed">
                    <div>
                      Sepsis = A40-A419 · Septic shock = R572 · CI = วินิจฉัยเป็นโรคหลักหรือ
                      โรคร่วมแรกรับ (diagtype 1, 2) · HI = วินิจฉัยว่าเกิดระหว่างนอน (diagtype 3)
                    </div>
                    <div className="mt-1.5">
                      <b>CI Sepsis</b> และ <b>CI Shock</b> คือการตัดกลุ่ม CI ลงไปอีกชั้นตามรหัส
                      ช่วยแยกว่าในกลุ่มที่ติดเชื้อมาจากชุมชน ส่วนที่มาถึงโรงพยาบาลในสภาพช็อกแล้ว
                      มีเท่าไร และตายต่างจากกลุ่มที่ยังไม่ช็อกแค่ไหน
                    </div>
                    <div className="mt-1.5">
                      ทุกกลุ่มเป็น<b>ธง ไม่ใช่การแบ่งส่วน</b> ผู้ป่วยหนึ่งรายติดได้หลายธง
                      พร้อมกัน (เช่นมีทั้งรหัส A41 และ R572 จึงอยู่ทั้ง CI Sepsis และ CI Shock)
                      ผลรวมของกลุ่มย่อยจึงมากกว่ายอดรวมทั้งหมดได้ และเอามาวางเป็นแท่งซ้อนกันไม่ได้
                    </div>
                  </div>
                }
              />
              <Panel
                title={`ชนิดและที่มาของการติดเชื้อ · ${rangeLabel}`}
                desc="แท่งบนคือจำนวนผู้ป่วย แท่งล่างคือจำนวนที่เสียชีวิต — ชี้ที่แท่งเพื่อดูอัตราตายของกลุ่มนั้น"
              >
                <GroupChart points={view.types} />
              </Panel>
              <div className="mt-4">
                <Panel
                  title="แนวโน้มการติดเชื้อในโรงพยาบาล (HI)"
                  desc="กลุ่มที่โรงพยาบาลควบคุมได้โดยตรงที่สุด และมีอัตราตายสูงกว่ากลุ่มที่ติดเชื้อมาจากข้างนอก"
                >
                  <MortalityChart points={view.hospital} target={null} />
                </Panel>
              </div>
            </section>

            <section className="mt-2">
              <SectionHead
                title="3 · ตำแหน่งการติดเชื้อ เก้าระบบ"
                desc="นับจากรหัสโรคของตำแหน่งที่ติดเชื้อ ในผู้ป่วยที่มี Sepsis หรือ Septic shock อยู่แล้ว"
                hint={
                  <div className="text-xs leading-relaxed">
                    <div>
                      ผู้ป่วยหนึ่งรายติดเชื้อได้หลายตำแหน่งพร้อมกัน ผลรวมของเก้าระบบจึงมากกว่า
                      จำนวนผู้ป่วยทั้งหมด และผู้ป่วยบางรายไม่ได้ลงรหัสตำแหน่งไว้เลย ผลรวมจึง
                      ไม่เท่ากับยอดรวมทั้งหมดทั้งสองทาง
                    </div>
                    <div className="mt-1.5">
                      BSI นับเฉพาะที่ลงเป็น<b>โรคหลัก</b> (diagtype 1) ต่างจากอีกแปดระบบที่นับ
                      ทั้งโรคหลัก โรคร่วม และที่เกิดระหว่างนอน — เป็นไปตามนิยามที่ได้รับมา
                    </div>
                    <div className="mt-1.5">
                      ระบบที่มีผู้ป่วยหลักหน่วยต่อช่วง (เช่น Musculoskeletal หรือ Tropical)
                      อัตราตายจะแกว่งแรงมาก ตายเพิ่มรายเดียวขยับได้หลายสิบจุด ให้ดูจำนวนราย
                      ควบคู่เสมอ
                    </div>
                  </div>
                }
              />
              <Panel
                title={`ตำแหน่งการติดเชื้อ · ${rangeLabel}`}
                desc="เรียงจากพบมากไปน้อย — แท่งบนคือจำนวนผู้ป่วย แท่งล่างคือจำนวนที่เสียชีวิต"
              >
                <GroupChart points={view.sites} />
              </Panel>

              <GroupTable
                title={`ตารางตำแหน่งการติดเชื้อ ${rangeLabel}`}
                firstColumn="ตำแหน่งการติดเชื้อ"
                groups={SEPSIS_SITES}
                totals={view.totals}
                overall={view.totals.all}
              />
            </section>

            <section className="mt-2">
              <SectionHead
                title="4 · ภาวะอวัยวะล้มเหลวและภาวะแทรกซ้อนรุนแรง"
                desc="ภาวะที่เกิดตามมาจากการติดเชื้อและเป็นเครื่องชี้ความรุนแรง — นับจากรหัสโรคในผู้ป่วย Sepsis ชุดเดียวกับส่วนก่อนหน้า"
                hint={
                  <div className="text-xs leading-relaxed">
                    <div>
                      ARF = J960, J80 · AKI = N17 · DIC = D65 · Septic encephalopathy = G9432 ·
                      Sepsis induced cholestasis = K710 — นับทั้งโรคหลัก โรคร่วม และที่เกิด
                      ระหว่างนอน (diagtype 1, 2, 3)
                    </div>
                    <div className="mt-1.5">
                      รหัสพวกนี้บอกได้แค่ว่า<b>มีภาวะนี้ร่วมอยู่</b> ไม่ได้บอกว่าเกิดจาก sepsis
                      จริงหรือเป็นมาก่อน และไม่ได้บอกลำดับเวลา จึงอ่านเป็นเครื่องชี้ความรุนแรงได้
                      แต่อ่านเป็นสาเหตุการตายไม่ได้
                    </div>
                    {view.emptyOrgans.length > 0 && (
                      <div className="mt-1.5">
                        <b>
                          {view.emptyOrgans.map(group => GROUP_LABEL[group].short).join(' และ ')}
                          ได้ศูนย์ราย
                        </b>{' '}
                        — ตรวจแล้วไม่ใช่เพราะคิวรีผิด G9432 เป็นรหัสของ ICD-10-CM ไม่ใช่ ICD-10
                        ที่ใช้ในไทย จึงไม่มีในฐานนี้เลยสักแถว รหัสที่ลงจริงในผู้ป่วย sepsis คือ
                        G934 (41 ราย) G931 (40 ราย) G92 (38 ราย) ส่วน K710 มีทั้งห้าปีรวมกัน
                        รายเดียว การเปลี่ยนไปใช้รหัสอื่นเป็นเรื่องที่คณะกรรมการต้องตัดสิน
                        หน้านี้จึงคงนิยามที่ได้รับมาไว้ตามเดิม
                      </div>
                    )}
                  </div>
                }
              />
              <Panel
                title={`ภาวะอวัยวะล้มเหลวและภาวะแทรกซ้อนรุนแรง · ${rangeLabel}`}
                desc="เรียงจากพบมากไปน้อย — แท่งบนคือจำนวนผู้ป่วย แท่งล่างคือจำนวนที่เสียชีวิต"
              >
                <GroupChart points={view.organs} />
              </Panel>

              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <Panel
                  title="แนวโน้มภาวะหายใจล้มเหลว (ARF)"
                  desc="พบมากรองจาก AKI และผู้ป่วยที่มีภาวะนี้เสียชีวิตเกินครึ่งทุกปีงบ"
                >
                  <MortalityChart points={view.arf} target={null} />
                </Panel>
                <Panel
                  title="แนวโน้มไตวายเฉียบพลัน (AKI)"
                  desc="ภาวะแทรกซ้อนที่พบมากที่สุด — ราวหนึ่งในสามของผู้ป่วย Sepsis ทั้งหมด"
                >
                  <MortalityChart points={view.aki} target={null} />
                </Panel>
              </div>

              <GroupTable
                title={`ตารางภาวะอวัยวะล้มเหลว ${rangeLabel}`}
                firstColumn="ภาวะแทรกซ้อน"
                groups={SEPSIS_ORGANS}
                totals={view.totals}
                overall={view.totals.all}
              />
            </section>

            <section className="mt-2">
              <SectionHead
                title="5 · โรคประจำตัวที่เป็นปัจจัยเสี่ยง"
                desc="โรคเรื้อรังที่ผู้ป่วย Sepsis มีติดตัวมา — ใช้ดูว่ากลุ่มใดเสี่ยงตายสูงกว่าภาพรวม"
                hint={
                  <div className="text-xs leading-relaxed">
                    <div>
                      แปดกลุ่มนี้นับจากรหัสโรคของการนอนครั้งนั้น
                      <b>ไม่จำกัดประเภทการวินิจฉัย</b> ต่างจากกลุ่มอื่นในหน้านี้ที่จำกัด diagtype
                      — เป็นไปตามนิยามที่ได้รับมา เพราะโรคประจำตัวมักลงเป็นโรคร่วม ไม่ใช่โรคหลัก
                    </div>
                    <div className="mt-1.5">
                      CKD นับจากรหัส N18 หรือ E112 <b>หรือ</b> มีหัตถการฟอกเลือด/ใส่สายฟอกไต
                      (ICD-9-CM 54.98, 39.95) ใน iptoprt อย่างใดอย่างหนึ่ง — การรวมหัตถการเข้ามา
                      ทำให้กลุ่ม CKD ใหญ่ขึ้นราว 6-13% แล้วแต่ปี
                    </div>
                    <div className="mt-1.5">
                      คอลัมน์ขวาสุดเทียบอัตราตายของกลุ่มกับอัตราตายของผู้ป่วยทั้งหมดในช่วง
                      เดียวกัน เป็น<b>จุดร้อยละ</b> ไม่ใช่เท่า — และเป็นการเทียบแบบดิบ
                      ยังไม่ได้ปรับอายุหรือความรุนแรง จึงบอกไม่ได้ว่าโรคประจำตัวนั้นเป็นสาเหตุ
                    </div>
                    <div className="mt-1.5">
                      ผู้ป่วยหนึ่งรายมีได้หลายโรคประจำตัว (เช่นเบาหวานกับโรคไตเรื้อรังพร้อมกัน)
                      ผลรวมของแปดกลุ่มจึงมากกว่าจำนวนผู้ป่วยที่มีโรคประจำตัวจริง
                    </div>
                  </div>
                }
              />
              <Panel
                title={`โรคประจำตัวของผู้ป่วย Sepsis · ${rangeLabel}`}
                desc="เรียงจากพบมากไปน้อย — แท่งบนคือจำนวนผู้ป่วย แท่งล่างคือจำนวนที่เสียชีวิต"
              >
                <GroupChart points={view.underlying} />
              </Panel>

              <GroupTable
                title={`ตารางโรคประจำตัว ${rangeLabel}`}
                firstColumn="โรคประจำตัว"
                groups={SEPSIS_UNDERLYING}
                totals={view.totals}
                overall={view.totals.all}
              />
            </section>

            <section className="mt-2">
              <SectionHead
                title="6 · ผู้ป่วยแยกตามพื้นที่ที่อยู่"
                desc="ผู้ป่วยมาจากอำเภอไหนของจังหวัดพะเยา แยกตามที่มาของการติดเชื้อ — เลือกอำเภอจากรายการ หรือกดที่แท่ง เพื่อเจาะลงรายตำบล"
                hint={
                  <div className="text-xs leading-relaxed">
                    <div>
                      นับจากอำเภอและตำบลใน<b>ทะเบียนบ้าน</b>ของผู้ป่วย ไม่ใช่ที่อยู่ที่พักจริง
                      และไม่ใช่สถานพยาบาลที่ส่งต่อมา · ตัวหารเป็นการนอนโรงพยาบาล (AN)
                      เหมือนทุกส่วนในหน้านี้
                    </div>
                    <div className="mt-1.5">
                      <b>CI</b> คือติดเชื้อมาจากชุมชน จึงอ่านเป็นเรื่องของพื้นที่ได้ ส่วน{' '}
                      <b>HI</b> คือติดเชื้อระหว่างนอนโรงพยาบาล — ที่อยู่ของผู้ป่วยไม่ใช่สาเหตุ
                      แผนที่ HI จึงบอกแค่ว่า “ผู้ป่วยที่ติดเชื้อในโรงพยาบาลมาจากไหน”
                      ไม่ได้บอกว่าตำบลนั้นเสี่ยง
                    </div>
                    <div className="mt-1.5">
                      จำนวนรายพื้นที่<b>ไม่ได้ปรับตามจำนวนประชากร</b> อำเภอหรือตำบลที่คนมาก
                      ย่อมมีผู้ป่วยมากโดยไม่ได้แปลว่าเสี่ยงกว่า ถ้าต้องการอัตราต่อประชากร
                      แสนคน ต้องมีทะเบียนประชากรรายพื้นที่มาเป็นตัวหารก่อน ซึ่งยังไม่มีในระบบนี้
                    </div>
                    {view.areas.outside.total > 0 && (
                      <div className="mt-1.5">
                        ช่วงนี้มีผู้ป่วยที่ทะเบียนบ้านอยู่<b>นอกจังหวัดพะเยา</b>{' '}
                        {nf.format(view.areas.outside.total)} ราย (เสียชีวิต{' '}
                        {nf.format(view.areas.outside.dead)} ราย) ไม่อยู่ในกราฟรายอำเภอ
                        แต่รวมอยู่ในกราฟและตารางของส่วนอื่นทั้งหมด
                      </div>
                    )}
                    <div className="mt-1.5">
                      ตำบลที่มีผู้ป่วยหลักหน่วยถึงหลักสิบต่อช่วง อัตราตายจะแกว่งแรงมาก
                      ให้ดูจำนวนรายควบคู่เสมอ
                    </div>
                  </div>
                }
              />
              <section className="rounded-2xl border border-line bg-panel p-4 backdrop-blur">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <div className="text-sm font-semibold text-ink">
                    <EnvironmentOutlined />{' '}
                    {view.areas.selected == null
                      ? `ผู้ป่วย ${MEASURE_LABEL[measure].short} รายอำเภอ จังหวัดพะเยา`
                      : `ผู้ป่วย ${MEASURE_LABEL[measure].short} รายตำบล อำเภอ${view.areas.selected.name}`}
                  </div>
                  <Segmented<AreaMeasure>
                    size="small"
                    value={measure}
                    onChange={setMeasure}
                    options={AREA_MEASURES.map(value => ({
                      value,
                      label: MEASURE_LABEL[value].short,
                      title: MEASURE_LABEL[value].long,
                    }))}
                  />
                  {/* มีสองทางเข้าตั้งใจให้ซ้ำกัน — กดแท่งเป็นทางที่เร็วกว่าเมื่อรู้อยู่แล้ว
                      ว่าจะดูอำเภอไหน ส่วนรายการเลือกเป็นทางที่มองเห็นได้โดยไม่ต้องเดา
                      ว่าแท่งกดได้ ซึ่งเป็นเรื่องที่คนไม่เดาเองถ้าไม่มีอะไรบอก */}
                  <Select<string>
                    size="small"
                    style={{ width: 220 }}
                    value={district ?? ALL_DISTRICTS}
                    onChange={value => setDistrict(value === ALL_DISTRICTS ? null : value)}
                    options={[
                      { value: ALL_DISTRICTS, label: 'ทุกอำเภอ' },
                      // จำนวนในวงเล็บเป็นของตัวชี้วัดที่เลือกไว้ ไม่ใช่ยอดรวมทั้งสอง
                      // ไม่งั้นตัวเลขในรายการจะไม่ตรงกับความยาวแท่งที่เห็นอยู่
                      ...view.areas.districtOptions.map(item => ({
                        value: item.id,
                        label: `อำเภอ${item.name} (${nf.format(item.total)})`,
                      })),
                    ]}
                  />
                  {view.areas.selected != null && (
                    <Button
                      size="small"
                      type="text"
                      icon={<ArrowLeftOutlined />}
                      onClick={() => setDistrict(null)}
                    >
                      กลับไปดูทุกอำเภอ
                    </Button>
                  )}
                </div>
                <div className="mb-3 text-xs text-ink-3">
                  {view.areas.selected == null
                    ? `${MEASURE_LABEL[measure].long} ${nf.format(view.areas.inProvince.total)} ราย ใน ${nf.format(view.areas.districtOptions.length)} อำเภอ · กดที่แท่งของอำเภอ หรือเลือกจากรายการ เพื่อเจาะดูรายตำบล · สีเข้มกว่าคือมีผู้ป่วยมากกว่า`
                    : `${nf.format(view.areas.selected.count.total)} ราย ใน ${nf.format(view.areas.selected.tambonCount)} ตำบล · เสียชีวิต ${nf.format(view.areas.selected.count.dead)} ราย (${pctText(view.areas.selected.count)}) · สีเข้มกว่าคือมีผู้ป่วยมากกว่า`}
                </div>
                {view.areas.points.length > 0 ? (
                  <AreaChart
                    points={view.areas.points}
                    total={view.areas.selected?.count.total ?? view.areas.inProvince.total}
                    onSelect={view.areas.selected == null ? setDistrict : undefined}
                    shareLabel={
                      view.areas.selected == null ? 'ของผู้ป่วยในจังหวัด' : 'ของผู้ป่วยในอำเภอ'
                    }
                    description={`จำนวนผู้ป่วย ${MEASURE_LABEL[measure].long} แยกตามพื้นที่ที่อยู่ตามทะเบียนบ้าน เรียงจากมากไปน้อย`}
                  />
                ) : (
                  <Empty
                    description={
                      <span className="text-xs text-ink-3">
                        ไม่มีผู้ป่วย {MEASURE_LABEL[measure].short} ในพื้นที่นี้ในช่วงที่เลือก
                      </span>
                    }
                  />
                )}
              </section>

              <section className="mt-4 rounded-2xl border border-line bg-panel p-4 backdrop-blur">
                <div className="mb-3 text-sm font-semibold text-ink">
                  ตาราง{view.areas.selected == null ? 'รายอำเภอ' : `รายตำบลใน${view.areas.selected.name}`}{' '}
                  {rangeLabel}
                </div>
                <Table<SepsisArea>
                  size="small"
                  rowKey="id"
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                  dataSource={view.areas.rows}
                  columns={[
                    {
                      key: 'name',
                      title: view.areas.selected == null ? 'อำเภอ' : 'ตำบล',
                      dataIndex: 'name',
                      render: (name: string) => <span className="text-ink">{name}</span>,
                    },
                    {
                      key: 'ci',
                      title: 'CI (ราย)',
                      align: 'right',
                      render: (_, row) => nf.format(row.ci.total),
                    },
                    {
                      key: 'ciDead',
                      title: 'CI เสียชีวิต',
                      align: 'right',
                      render: (_, row) => nf.format(row.ci.dead),
                    },
                    {
                      key: 'ciRate',
                      title: 'CI อัตราตาย',
                      align: 'right',
                      render: (_, row) => <RateCell count={row.ci} target={null} />,
                    },
                    {
                      key: 'hi',
                      title: 'HI (ราย)',
                      align: 'right',
                      render: (_, row) => nf.format(row.hi.total),
                    },
                    {
                      key: 'hiDead',
                      title: 'HI เสียชีวิต',
                      align: 'right',
                      render: (_, row) => nf.format(row.hi.dead),
                    },
                    {
                      key: 'hiRate',
                      title: 'HI อัตราตาย',
                      align: 'right',
                      render: (_, row) => <RateCell count={row.hi} target={null} />,
                    },
                    {
                      key: 'share',
                      title: `สัดส่วน ${MEASURE_LABEL[measure].short} ของพื้นที่นี้`,
                      align: 'right',
                      render: (_, row) => {
                        const base =
                          view.areas.selected?.count.total ?? view.areas.inProvince.total
                        const value = measure === 'ci' ? row.ci.total : row.hi.total
                        return base > 0 ? `${((value / base) * 100).toFixed(1)}%` : '—'
                      },
                    },
                  ]}
                />
                <div className="mt-2 text-xs text-ink-3">
                  คอลัมน์สัดส่วนอ่านจากตัวชี้วัดที่เลือกไว้ด้านบน ({MEASURE_LABEL[measure].short})
                  ส่วนคอลัมน์ CI และ HI แสดงพร้อมกันเสมอเพื่อให้เทียบกันได้ในแถวเดียว
                </div>
              </section>
            </section>

            <section className="mt-2">
              <SectionHead
                title={`7 · CI Sepsis ในเขตรับผิดชอบ ที่ไม่ได้รับส่งต่อ (${homeDistrictName})`}
                desc="ตัดผู้ป่วยที่โรงพยาบาลอื่นส่งต่อมาออก เหลือเฉพาะผู้ป่วยที่มาโรงพยาบาลเอง — ใกล้เคียงอุบัติการณ์ในพื้นที่มากที่สุดที่ข้อมูลนี้บอกได้"
                hint={
                  <div className="text-xs leading-relaxed">
                    <div>
                      เงื่อนไขสามข้อซ้อนกัน: รหัส A40-A419 หรือ R572 เป็นโรคหลักหรือโรคร่วมแรกรับ
                      (CI) · ทะเบียนบ้าน chwpart {HOSPITAL_PROVINCE} amppart{' '}
                      {stats.areas.homeDistrict} · และไม่มี visit ใดของการนอนครั้งนั้นอยู่ใน
                      ทะเบียน referin
                    </div>
                    <div className="mt-1.5">
                      ส่วนนี้จำกัด{homeDistrictName}อำเภอเดียว เพราะผู้ป่วยจากอำเภออื่นส่วนใหญ่
                      มาถึงผ่านการส่งต่อ — วัดแล้วดอกคำใต้ถูกตัดออก 822 ราย จาก 1,307 และจุน
                      736 จาก 852 ตัวเลขที่เหลือจึงไม่ได้สะท้อนอะไรของอำเภอนั้น ส่วน
                      {homeDistrictName}ถูกตัดออกเพียง {nf.format(view.home?.referredIn ?? 0)} ราย
                    </div>
                    <div className="mt-1.5">
                      “ไม่รับส่งต่อ” ตัด AN ทั้งใบถ้ามี visit ใดของการนอนครั้งนั้นอยู่ในทะเบียน
                      referin ไม่ใช่ตัดเฉพาะ visit นั้น — การตัดเฉพาะ visit จะเหลือ AN ที่มีทั้ง
                      visit ที่รับส่งต่อและไม่รับไว้ด้วย ซึ่งอ่านว่า “ไม่ได้รับส่งต่อ” ไม่ได้
                    </div>
                    <div className="mt-1.5">
                      ยังไม่ปรับตามจำนวนประชากรเช่นเดียวกับส่วนก่อนหน้า
                    </div>
                  </div>
                }
              />
              <Panel
                title={`CI Sepsis ไม่รับส่งต่อ รายตำบล ${homeDistrictName} · ${rangeLabel}`}
                desc="สีเข้มคือผู้ป่วยมาก ตัวเลขที่ปลายแท่งคือจำนวนราย — ชี้ที่แท่งเพื่อดูจำนวนที่เสียชีวิตและอัตราตาย"
              >
                {view.nonReferred.points.length > 0 ? (
                  <AreaChart
                    points={view.nonReferred.points}
                    total={view.nonReferred.count.total}
                    shareLabel="ของผู้ป่วย CI ไม่รับส่งต่อในอำเภอ"
                    description="จำนวนผู้ป่วย CI Sepsis ที่ไม่ได้รับส่งต่อ แยกตามตำบลที่อยู่ตามทะเบียนบ้าน เรียงจากมากไปน้อย"
                  />
                ) : (
                  <Empty
                    description={
                      <span className="text-xs text-ink-3">
                        ไม่มีผู้ป่วย CI Sepsis ที่ไม่ได้รับส่งต่อใน{homeDistrictName}ในช่วงนี้
                      </span>
                    }
                  />
                )}
              </Panel>

              <section className="mt-4 rounded-2xl border border-line bg-panel p-4 backdrop-blur">
                <div className="mb-3 text-sm font-semibold text-ink">
                  ตารางรายตำบล {homeDistrictName} {rangeLabel}
                </div>
                <Table<SepsisArea>
                  size="small"
                  rowKey="id"
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                  dataSource={view.nonReferred.rows}
                  columns={[
                    {
                      key: 'name',
                      title: 'ตำบล',
                      dataIndex: 'name',
                      render: (name: string) => <span className="text-ink">{name}</span>,
                    },
                    {
                      key: 'total',
                      title: 'ผู้ป่วย CI ไม่รับส่งต่อ',
                      align: 'right',
                      render: (_, row) => nf.format(row.ciNonReferred.total),
                    },
                    {
                      key: 'dead',
                      title: 'เสียชีวิต',
                      align: 'right',
                      render: (_, row) => nf.format(row.ciNonReferred.dead),
                    },
                    {
                      key: 'rate',
                      title: 'อัตราตาย',
                      align: 'right',
                      render: (_, row) => <RateCell count={row.ciNonReferred} target={null} />,
                    },
                    {
                      key: 'gap',
                      title: 'เทียบอัตราตายของอำเภอ',
                      align: 'right',
                      render: (_, row) => (
                        <Delta
                          current={rateOf(row.ciNonReferred)}
                          previous={rateOf(view.nonReferred.count)}
                          digits={2}
                          suffix=" จุด"
                        />
                      ),
                    },
                    {
                      key: 'referred',
                      title: 'ตัดออกเพราะรับส่งต่อ',
                      align: 'right',
                      render: (_, row) => nf.format(row.referredIn),
                    },
                    {
                      key: 'share',
                      title: 'สัดส่วนของผู้ป่วยในอำเภอ',
                      align: 'right',
                      render: (_, row) =>
                        view.nonReferred.count.total > 0
                          ? `${((row.ciNonReferred.total / view.nonReferred.count.total) * 100).toFixed(1)}%`
                          : '—',
                    },
                  ]}
                />
                <div className="mt-2 text-xs text-ink-3">
                  รวมทั้งอำเภอ {nf.format(view.nonReferred.count.total)} ราย เสียชีวิต{' '}
                  {nf.format(view.nonReferred.count.dead)} ราย ({pctText(view.nonReferred.count)}) ·
                  ตัดผู้ป่วยที่รับส่งต่อมาออกไป {nf.format(view.home?.referredIn ?? 0)} ราย
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
