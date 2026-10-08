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
  SEPSIS_ICU_BINS,
  SEPSIS_ICU_SCOPES,
  SEPSIS_ICU_THRESHOLDS,
  SEPSIS_ICU_WITHIN,
  SEPSIS_ORGANS,
  SEPSIS_SITES,
  SEPSIS_UNDERLYING,
  type SepsisArea,
  type SepsisCount,
  type SepsisGroup,
  type SepsisIcuBin,
  type SepsisIcuCounts,
  type SepsisIcuScope,
  type SepsisIcuThreshold,
  type SepsisPeriod,
  type SepsisReferral,
  type SepsisSplit,
  SEPSIS_SPLITS,
} from '@/lib/his/sepsis-groups'
import type { SepsisStats } from '@/lib/his/sepsis-stats'
import { BlockSkeleton, StatCardsSkeleton, TableRowsSkeleton } from '@/app/home/skeletons'
import PageHint from '../../page-hint'
import {
  AreaChart,
  GroupChart,
  MortalityChart,
  TrendChart,
  type AreaPoint,
  type GroupPoint,
  type MortalityPoint,
  type TrendSeries,
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
 * เก้าคำถามเรียงกัน: มีผู้ป่วยเท่าไรและตายเท่าไร (ภาพรวม) · เป็นชนิดไหนและติดเชื้อ
 * มาจากไหน (Sepsis/Septic shock · CI/HI) · ติดเชื้อที่ระบบใดของร่างกาย (เก้าระบบ) ·
 * อวัยวะล้มเหลวไปแล้วกี่ราย (O1-O5) · ผู้ป่วยมีโรคประจำตัวอะไรติดมา (P1-P8) ·
 * ผู้ป่วยมาจากอำเภอและตำบลไหน (CI/HI) · ในเขตรับผิดชอบเมื่อตัดผู้ป่วยที่รับส่งต่อ
 * มาออกแล้วเหลือเท่าไร · ผู้ป่วยที่โรงพยาบาลอื่นส่งต่อมา มาถึงในสภาพช็อกกี่ราย
 * แยกตามโรงพยาบาลต้นทาง · และได้เข้า ICU เร็วแค่ไหนนับจากแรกรับ (early ICU access)
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

/** ป้ายของหกชุด CI/HI คูณการรับส่งต่อ */
const SPLIT_LABEL: Record<SepsisSplit, { short: string; title: string; desc: string }> = {
  ci: {
    short: 'CI',
    title: 'CI Sepsis ทั้งหมด',
    desc: 'ติดเชื้อมาจากชุมชน — วินิจฉัยไว้ตั้งแต่แรกรับ (diagtype 1, 2)',
  },
  ciOwn: {
    short: 'CI มาเอง',
    title: 'CI Sepsis ที่มาเอง',
    desc: 'ไม่มี visit ของการนอนครั้งนั้นอยู่ในทะเบียนรับส่งต่อ',
  },
  ciReferred: {
    short: 'CI รับส่งต่อ',
    title: 'CI Sepsis ที่รับส่งต่อมา',
    desc: 'สถานพยาบาลอื่นส่งต่อมา — รายละเอียดรายโรงพยาบาลต้นทางอยู่ส่วนที่ 8',
  },
  hi: {
    short: 'HI',
    title: 'HI Sepsis ทั้งหมด',
    desc: 'ติดเชื้อระหว่างนอนโรงพยาบาล (diagtype 3) — กลุ่มที่ควบคุมได้โดยตรงที่สุด',
  },
  hiOwn: {
    short: 'HI มาเอง',
    title: 'HI Sepsis ที่มาเอง',
    desc: 'เข้ามาเองด้วยเรื่องอื่น แล้วติดเชื้อระหว่างนอน',
  },
  hiReferred: {
    short: 'HI รับส่งต่อ',
    title: 'HI Sepsis ที่รับส่งต่อมา',
    desc: 'ถูกส่งต่อมาด้วยเรื่องอื่น แล้วติดเชื้อระหว่างนอนที่นี่',
  },
}

/** ลำดับของแผงหกใบ — เรียง CI สามใบแล้ว HI สามใบ ให้เทียบในแถวเดียวกันได้ */
const SPLIT_PANELS: SepsisSplit[] = ['ci', 'ciOwn', 'ciReferred', 'hi', 'hiOwn', 'hiReferred']

/** ป้ายของถังเวลาที่ใช้ถึง ICU */
const ICU_BIN_LABEL: Record<SepsisIcuBin, string> = {
  atAdmission: 'หอแรกรับเป็น ICU อยู่แล้ว',
  h3: 'ย้ายเข้า ICU ภายใน 3 ชม.',
  h6: 'ย้ายเข้า ICU 3-6 ชม.',
  h12: 'ย้ายเข้า ICU 6-12 ชม.',
  h24: 'ย้ายเข้า ICU 12-24 ชม.',
  later: 'ย้ายเข้า ICU หลัง 24 ชม.',
  unknownTime: 'เข้า ICU แต่ไม่มีเวลาบันทึกไว้',
  never: 'ไม่ได้เข้า ICU',
}

/** ป้ายของตัวหารสองแบบ */
const ICU_SCOPE_LABEL: Record<SepsisIcuScope, { short: string; long: string }> = {
  all: { short: 'ผู้ป่วยทั้งหมด', long: 'ผู้ป่วย sepsis ทั้งหมด' },
  ci: { short: 'เฉพาะ CI', long: 'เฉพาะที่ติดเชื้อมาจากชุมชน (CI)' },
}

/** รวมถังที่นับเป็น "ทันเวลา" ที่เกณฑ์หนึ่ง */
const withinOf = (counts: SepsisIcuCounts, threshold: SepsisIcuThreshold) =>
  SEPSIS_ICU_WITHIN[threshold].reduce((n, bin) => n + counts.bins[bin], 0)

/** รวมถังทั้งหมดที่ได้เข้า ICU ไม่ว่าเมื่อไร — ทุกถังยกเว้น never */
const everOf = (counts: SepsisIcuCounts) => counts.admissions - counts.bins.never

/** แถวของตารางถังเวลา */
type IcuBinRow = { bin: SepsisIcuBin; name: string; count: number }

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
  /** เกณฑ์เวลาของ early ICU access ที่กำลังดู (ชั่วโมง) */
  const [icuThreshold, setIcuThreshold] = useState<SepsisIcuThreshold>(3)
  /** ตัวหารของอัตรา early ICU access — ทุกราย หรือเฉพาะ CI */
  const [icuScope, setIcuScope] = useState<SepsisIcuScope>('all')
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

    /* ---------- อัตรารับส่งต่อของอำเภอที่โรงพยาบาลตั้งอยู่ สำหรับส่วนที่ 7 ---------- */
    const homeReferral = {
      ci: stats.periods.reduce((n, period) => n + period.homeReferral.ci, 0),
      referredIn: stats.periods.reduce((n, period) => n + period.homeReferral.referredIn, 0),
      trend: stats.periods.map<MortalityPoint>(period => ({
        label: periodLabel(period.key).short,
        title: periodLabel(period.key).full,
        partial: period.partial,
        percent:
          period.homeReferral.ci > 0
            ? (period.homeReferral.referredIn / period.homeReferral.ci) * 100
            : null,
        dead: period.homeReferral.referredIn,
        total: period.homeReferral.ci,
      })),
    }

    /* ---------- โรงพยาบาลต้นทางที่ส่งผู้ป่วยมา สำหรับส่วนที่ 8 ---------- */
    const { hospitals, ci: referredCi, shock: referredShock } = stats.referrals
    const referrals = {
      hospitals,
      ci: referredCi,
      shock: referredShock,
      // มาแล้วเรียงจากส่งมามากไปน้อย แถวแรกคือต้นทางที่ส่งมามากที่สุด
      top: hospitals[0] ?? null,
      // แท่งคู่: ส่งมาทั้งหมด เทียบ ที่มาถึงในสภาพช็อก — ตัดแห่งที่ไม่ส่งใครเลย
      // ออกจากกราฟ แต่คงไว้ในตาราง เหมือนที่ทำกับพื้นที่ในส่วนที่ 6
      bars: hospitals
        .filter(hospital => hospital.ci.total > 0)
        .map<GroupPoint>(hospital => ({
          // ตัดคำว่า "โรงพยาบาล" ออกจากป้ายแกน ไม่งั้นชื่อซ้ำกันทุกแท่งจนอ่านยาก
          name: hospital.name.replace(/^โรงพยาบาล/, ''),
          total: hospital.ci.total,
          dead: hospital.shock.total,
        })),
      unknown: hospitals
        .filter(hospital => hospital.code === '')
        .reduce((n, hospital) => n + hospital.ci.total, 0),
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

    /* ---------- การเข้าถึง ICU สำหรับส่วนที่ 9 ---------- */
    const icuTotals: SepsisIcuCounts = {
      admissions: stats.periods.reduce((n, period) => n + period.icu[icuScope].admissions, 0),
      bins: Object.fromEntries(
        SEPSIS_ICU_BINS.map(bin => [
          bin,
          stats.periods.reduce((n, period) => n + period.icu[icuScope].bins[bin], 0),
        ]),
      ) as Record<SepsisIcuBin, number>,
    }
    const icu = {
      scope: icuScope,
      threshold: icuThreshold,
      totals: icuTotals,
      within: withinOf(icuTotals, icuThreshold),
      ever: everOf(icuTotals),
      // แท่งซ้อน: ส่วนที่แยกสีคือจำนวนที่ถึง ICU ทันเกณฑ์ ไม่ใช่จำนวนที่เสียชีวิต
      // จึงต้องส่ง labels กับ tone เข้าไปด้วย ไม่งั้นกราฟจะบอกผิดเรื่องและผิดสี
      trend: stats.periods.map<MortalityPoint>(period => {
        const counts = period.icu[icuScope]
        const within = withinOf(counts, icuThreshold)
        return {
          label: periodLabel(period.key).short,
          title: periodLabel(period.key).full,
          partial: period.partial,
          percent: counts.admissions > 0 ? (within / counts.admissions) * 100 : null,
          dead: within,
          total: counts.admissions,
        }
      }),
      // ถังเรียงตามลำดับเวลา ไม่ได้เรียงตามจำนวน — คำถามคือ "ช้าแค่ไหน" ซึ่งอ่าน
      // จากลำดับเวลาเท่านั้น การเรียงตามจำนวนจะทำให้ไล่ไม่ได้ว่าถังไหนมาก่อน
      bins: SEPSIS_ICU_BINS.map(bin => ({
        bin,
        name: ICU_BIN_LABEL[bin],
        count: icuTotals.bins[bin],
      })),
      // แท่งคู่รายหอ: เข้าหอนั้นทั้งหมด เทียบ ที่ถึงทันเกณฑ์
      wards: stats.icuWards[icuScope],
      wardBars: stats.icuWards[icuScope]
        .filter(ward => ward.patients > 0)
        .map<GroupPoint>(ward => ({
          name: ward.name,
          total: ward.patients,
          dead: SEPSIS_ICU_WITHIN[icuThreshold].reduce((n, bin) => n + ward.bins[bin], 0),
        })),
    }

    return {
      latest,
      running,
      latestLabel: periodLabel(latest.key).full,
      icu,
      all: trend('all'),
      shock: trend('shockOnly'),
      arf: trend('arf'),
      aki: trend('aki'),
      types: bars(TYPE_GROUPS),
      // หกชุดบนโครงเดียวกับกราฟอัตราตาย — ส่วนที่แยกสีคือจำนวนที่เสียชีวิต
      splits: Object.fromEntries(
        SEPSIS_SPLITS.map(split => [
          split,
          stats.periods.map<MortalityPoint>(period => ({
            label: periodLabel(period.key).short,
            title: `${SPLIT_LABEL[split].short} · ${periodLabel(period.key).full}`,
            partial: period.partial,
            percent: rateOf(period.splits[split]),
            dead: period.splits[split].dead,
            total: period.splits[split].total,
          })),
        ]),
      ) as Record<SepsisSplit, MortalityPoint[]>,
      // ช่วงเวลาที่กราฟเส้นใช้เป็นแกนนอน — ชุดเดียวกับที่กราฟอื่นในหน้าใช้
      timeline: stats.periods.map(period => ({
        label: periodLabel(period.key).short,
        title: periodLabel(period.key).full,
        partial: period.partial,
      })),
      // เส้นหนึ่งเส้นต่อหนึ่งตำแหน่งการติดเชื้อ เรียงจากพบมากไปน้อยของทั้งช่วง
      siteLines: [...SEPSIS_SITES]
        .sort((a, b) => totals[b].total - totals[a].total)
        .map<TrendSeries>(group => ({
          name: GROUP_LABEL[group].short,
          values: stats.periods.map(period => period.groups[group].total),
        })),
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
      homeReferral,
      referrals,
      previousOf: new Map(
        stats.periods.map((period, index) => [
          period.key,
          index > 0 ? stats.periods[index - 1] : null,
        ]),
      ),
    }
  }, [stats, measure, district, icuThreshold, icuScope])

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
                desc="Sepsis กับ Septic shock แยกตามรหัส ส่วน CI/HI แยกตามว่าวินิจฉัยไว้ตั้งแต่แรกรับหรือเกิดขึ้นระหว่างนอน — และอัตราเสียชีวิตของหกชุดที่ไล่ลงไปอีกชั้นตามการรับส่งต่อ"
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
              <div className="mt-6">
                <h4 className="mb-1 text-sm font-semibold text-ink-2">
                  อัตราเสียชีวิตแยกตามที่มาของการติดเชื้อและการรับส่งต่อ
                  <PageHint>
                    <div>
                      หกชุดบนโครงเดียวกัน — ความสูงรวมของแท่งคือผู้ป่วยของชุดนั้นในช่วงนั้น
                      สีแดงคือจำนวนที่เสียชีวิต และเส้นคืออัตราตาย ชี้ที่แท่งเพื่อดูทั้งจำนวน
                      และร้อยละ
                    </div>
                    <div className="mt-1.5">
                      <b>มาเอง</b> คือการนอนครั้งนั้นไม่มี visit ใดอยู่ในทะเบียน referin ·
                      <b> รับส่งต่อมา</b> คือมี — สองอย่างนี้แบ่งกันหมดพอดี บวกกันได้เท่ากับ
                      ยอดของฝั่งนั้นเสมอ ต่างจาก CI กับ HI ที่ซ้อนกันได้ (AN เดียวมีได้ทั้งสอง)
                      ผลรวมหกชุดจึงมากกว่าผู้ป่วยทั้งหมด
                    </div>
                    <div className="mt-1.5">
                      ชุดนี้นับผู้ป่วย<b>ทุกคน</b> ไม่จำกัดพื้นที่ ต่างจากส่วนที่ 7 และ 8
                      ที่จำกัดอำเภอ — ยอด CI และ HI ของที่นี่จึงเท่ากับคอลัมน์ CI/HI ใน
                      ตารางภาพรวมของส่วนที่ 1 พอดี
                    </div>
                    <div className="mt-1.5">
                      <b>HI แยกตามการรับส่งต่อ อ่านต่างจาก CI</b> — ผู้ป่วยกลุ่มนี้ถูกส่งมา
                      ด้วยเรื่องอื่นแล้วติดเชื้อระหว่างนอนที่นี่ การรับส่งต่อจึงไม่ใช่สาเหตุ
                      ของการติดเชื้อ แต่เป็นเครื่องบอกว่าผู้ป่วยหนักกว่าตั้งแต่แรกรับ
                    </div>
                  </PageHint>
                </h4>
                <p className="mb-4 text-xs text-ink-3">
                  CI = ติดเชื้อมาจากชุมชน · HI = ติดเชื้อระหว่างนอนโรงพยาบาล · แต่ละฝั่งแยกอีก
                  ชั้นว่าผู้ป่วยมาเองหรือรับส่งต่อมาจากสถานพยาบาลอื่น
                </p>
                <div className="grid gap-4 xl:grid-cols-3">
                  {SPLIT_PANELS.map(split => (
                    <Panel
                      key={split}
                      title={SPLIT_LABEL[split].title}
                      desc={SPLIT_LABEL[split].desc}
                    >
                      <MortalityChart points={view.splits[split]} target={null} />
                    </Panel>
                  ))}
                </div>

                <section className="mt-4 rounded-2xl border border-line bg-panel p-4 backdrop-blur">
                  <div className="mb-3 text-sm font-semibold text-ink">
                    ตารางอัตราเสียชีวิตหกชุด {rangeLabel}
                  </div>
                  <Table
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
                      ...SEPSIS_SPLITS.map(split => ({
                        key: split,
                        title: SPLIT_LABEL[split].short,
                        align: 'right' as const,
                        render: (_: unknown, row: SepsisPeriod) => (
                          <RateCell
                            count={row.splits[split]}
                            target={null}
                            previous={comparable(
                              row,
                              view.previousOf.get(row.key)?.splits[split] ?? null,
                            )}
                          />
                        ),
                      })),
                    ]}
                  />
                  <div className="mt-2 text-xs text-ink-3">
                    แต่ละช่องเป็นร้อยละการเสียชีวิตของชุดนั้น เศษส่วนใต้ร้อยละคือ
                    เสียชีวิต/ผู้ป่วยในชุด และบรรทัดล่างสุดคือส่วนต่างจากช่วงก่อนหน้า
                  </div>
                </section>
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

              <div className="mt-4">
                <Panel
                  title="แนวโน้มตำแหน่งการติดเชื้อตามช่วงเวลา"
                  desc="เส้นหนึ่งเส้นต่อหนึ่งระบบ เรียงในคำอธิบายจากพบมากไปน้อย — กดชื่อในคำอธิบายเพื่อซ่อนหรือแสดงเส้นนั้น"
                  hint={
                    <div className="text-xs leading-relaxed">
                      <div>
                        เป็น<b>เส้นแยก ไม่ใช่พื้นที่ซ้อน</b> เพราะผู้ป่วยหนึ่งรายติดเชื้อได้
                        หลายตำแหน่งพร้อมกัน ผลรวมของเก้าเส้นจึงมากกว่าจำนวนผู้ป่วยทั้งหมด
                        การวางซ้อนกันจะสื่อว่าผลรวมมีความหมาย ซึ่งไม่จริง
                      </div>
                      <div className="mt-1.5">
                        เก้าเส้นพร้อมกันแน่นเกินกว่าจะไล่ตาได้ทั้งหมด LRTI กับ UTI สองเส้นบน
                        กินพื้นที่เกือบทั้งกราฟ — ถ้าจะดูระบบที่เหลือ กดปิดสองเส้นนั้นใน
                        คำอธิบายกราฟ แกนตั้งจะปรับสเกลให้เอง
                      </div>
                      <div className="mt-1.5">
                        กราฟนี้แสดง<b>จำนวนราย</b> ไม่ใช่อัตราตาย ส่วนอัตราตายของแต่ละระบบ
                        อยู่ในตารางด้านล่าง
                      </div>
                    </div>
                  }
                >
                  <TrendChart points={view.timeline} series={view.siteLines} />
                </Panel>
              </div>

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
                title={`7 · CI Sepsis ในเขตรับผิดชอบ (${homeDistrictName})`}
                desc="ผู้ป่วยในอำเภอที่โรงพยาบาลตั้งอยู่มาถึงด้วยวิธีไหน — มาเองหรือรับส่งต่อมา และกลุ่มที่มาเองกระจายอยู่ตำบลไหน"
                hint={
                  <div className="text-xs leading-relaxed">
                    <div>
                      เงื่อนไขสามข้อซ้อนกัน: รหัส A40-A419 หรือ R572 เป็นโรคหลักหรือโรคร่วมแรกรับ
                      (CI) · ทะเบียนบ้าน chwpart {HOSPITAL_PROVINCE} amppart{' '}
                      {stats.areas.homeDistrict} · และไม่มี visit ใดของการนอนครั้งนั้นอยู่ใน
                      ทะเบียน referin
                    </div>
                    <div className="mt-1.5">
                      กราฟแรกเป็นอัตรารับส่งต่อของอำเภอนี้ ส่วนกราฟและตารางด้านล่างเป็น
                      กลุ่มที่<b>มาเอง</b> แยกรายตำบล — สองอันเป็นส่วนเติมเต็มกัน
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
                title={`อัตราผู้ป่วย CI Sepsis ที่รับส่งต่อมา · ${homeDistrictName}`}
                desc="ความสูงรวมคือผู้ป่วย CI ทั้งหมดของอำเภอในช่วงนั้น สีแดงคือส่วนที่รับส่งต่อมา และเส้นคือสัดส่วนที่รับส่งต่อ"
                hint={
                  <div className="text-xs leading-relaxed">
                    <div>
                      ตัวหารคือผู้ป่วย CI ทั้งหมดที่ทะเบียนบ้านอยู่{homeDistrictName} ตัวเศษคือ
                      ส่วนที่มี visit ของการนอนครั้งนั้นอยู่ในทะเบียน referin
                    </div>
                    <div className="mt-1.5">
                      <b>เป็นตัวเลขหลักหน่วย</b> — ทั้งห้าปีงบมีรับส่งต่อรวม{' '}
                      {nf.format(view.homeReferral.referredIn)} ราย จาก{' '}
                      {nf.format(view.homeReferral.ci)} ราย ในมุมมองรายเดือนบางเดือนเป็นศูนย์
                      และบางเดือนสองถึงสี่ราย อัตรารายเดือนจึงแกว่งแรงมาก หนึ่งรายขยับได้
                      ราวสองจุด ให้อ่านแนวโน้มจากมุมมองรายปีงบเป็นหลัก
                    </div>
                    <div className="mt-1.5">
                      คนในอำเภอเดียวกับโรงพยาบาลส่วนใหญ่มาเอง สัดส่วนรับส่งต่อที่ต่ำจึงเป็น
                      เรื่องปกติ ไม่ใช่ปัญหา — ตัวเลขนี้มีประโยชน์ตอนที่มันเปลี่ยน เช่นปีงบ
                      2566 ขึ้นไป 4.8% จาก 1.3% ของปีก่อน ซึ่งควรไปดูว่าเกิดอะไรขึ้น
                    </div>
                    <div className="mt-1.5">
                      ส่วนที่รับส่งต่อมานี้คือส่วนที่ถูกตัดออกจากกราฟรายตำบลด้านล่าง
                      และผู้ป่วยที่ส่งมาจากอำเภออื่นอยู่ในส่วนที่ 8 ไม่ได้อยู่ในกราฟนี้
                    </div>
                  </div>
                }
              >
                <MortalityChart
                  points={view.homeReferral.trend}
                  target={null}
                  labels={{
                    rest: 'มาเอง',
                    part: 'รับส่งต่อมา',
                    rate: 'สัดส่วนรับส่งต่อ',
                    total: 'ผู้ป่วย CI',
                  }}
                />
              </Panel>

              <div className="mt-4">
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
              </div>

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

            <section className="mt-2">
              <SectionHead
                title="8 · Septic shock ในผู้ป่วย CI Sepsis ที่รับส่งต่อมา แยกตามโรงพยาบาลต้นทาง"
                desc="ผู้ป่วยติดเชื้อจากชุมชนที่โรงพยาบาลอื่นส่งต่อมา — มาถึงในสภาพช็อกแล้วกี่ราย และกลุ่มนั้นเสียชีวิตเท่าไร"
                hint={
                  <div className="text-xs leading-relaxed">
                    <div>
                      ขอบเขต: ทะเบียนบ้านอยู่ในจังหวัดพะเยาแต่<b>นอกอำเภอเมืองพะเยา</b> ·
                      มีรหัส A40-A419 หรือ R572 เป็นโรคหลักหรือโรคร่วมแรกรับ (CI) · และมี visit
                      ของการนอนครั้งนั้นอยู่ในทะเบียน referin · ต้นทางอ่านจาก refer_hospcode
                      แล้วเอาชื่อจากทะเบียน hospcode
                    </div>
                    <div className="mt-1.5">
                      ส่วนนี้<b>คู่กับส่วนที่ 7</b> — ที่นั่นเป็นผู้ป่วยในอำเภอเมืองที่มาเอง
                      ที่นี่เป็นผู้ป่วยนอกอำเภอเมืองที่ถูกส่งต่อมา สองส่วนรวมกันคือผู้ป่วย
                      CI ในจังหวัดเกือบทั้งหมด และยอดที่นี่เท่ากับจำนวนที่ส่วนที่ 7 ตัดออก
                      จากอำเภออื่นพอดี
                    </div>
                    <div className="mt-1.5">
                      <b>นิยาม Septic shock ของส่วนนี้แคบกว่าส่วนอื่นในหน้า</b> — นับ R572
                      ที่ลงเป็นโรคร่วมแรกรับ (diagtype 2) เท่านั้น ตามคิวรีที่ได้รับมา ส่วนกลุ่ม
                      CI Shock ในส่วนที่ 2 นับโรคหลักด้วย (diagtype 1, 2) วัดแล้วต่างกัน 83
                      จาก 2,434 ราย ตัวเลขสองส่วนจึงไม่เท่ากันโดยตั้งใจ
                    </div>
                    <div className="mt-1.5">
                      ตัวเลขนี้<b>อ่านเป็นคุณภาพของโรงพยาบาลต้นทางตรง ๆ ไม่ได้</b> สัดส่วน
                      ที่มาถึงในสภาพช็อกขึ้นกับระยะทาง ความสามารถในการดูแลก่อนส่ง และ
                      เกณฑ์การตัดสินใจส่งต่อซึ่งต่างกันในแต่ละแห่ง โรงพยาบาลที่ส่งเฉพาะ
                      เคสหนักจะมีสัดส่วนช็อกสูงกว่าโดยไม่ได้แปลว่าดูแลแย่กว่า
                    </div>
                    <div className="mt-1.5">
                      แห่งที่ส่งมาหลักหน่วยต่อช่วง (เชียงราย มหาวิทยาลัยพะเยา มะเร็งลำปาง
                      ค่ายขุนเจือง) อัตราตายไม่มีความหมายทางสถิติเลย ตายรายเดียวได้ 100%
                      ให้ดูจำนวนรายควบคู่เสมอ
                    </div>
                    {view.referrals.unknown > 0 && (
                      <div className="mt-1.5">
                        ช่วงนี้มี {nf.format(view.referrals.unknown)} รายที่ทะเบียนส่งต่อไม่ได้
                        ระบุรหัสต้นทางไว้ ขึ้นเป็นแถว “ไม่ระบุต้นทาง” ไม่ได้ตัดออก
                      </div>
                    )}
                  </div>
                }
              />

              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi
                  label={`CI Sepsis ที่รับส่งต่อมา · ${rangeLabel}`}
                  value={nf.format(view.referrals.ci.total)}
                  hint={`จาก ${nf.format(view.referrals.hospitals.length)} สถานพยาบาลต้นทาง · เสียชีวิต ${nf.format(view.referrals.ci.dead)} ราย (${pctText(view.referrals.ci)})`}
                />
                <Kpi
                  label="มาถึงในสภาพ Septic shock"
                  value={nf.format(view.referrals.shock.total)}
                  hint={
                    view.referrals.ci.total > 0
                      ? `${((view.referrals.shock.total / view.referrals.ci.total) * 100).toFixed(1)}% ของผู้ป่วยที่รับส่งต่อมา`
                      : 'ไม่มีผู้ป่วยในช่วงนี้'
                  }
                />
                <Kpi
                  label="อัตราตายของกลุ่ม Septic shock"
                  value={pctText(view.referrals.shock)}
                  hint={`เสียชีวิต ${nf.format(view.referrals.shock.dead)} จาก ${nf.format(view.referrals.shock.total)} ราย`}
                />
                <Kpi
                  label="ต้นทางที่ส่งมามากที่สุด"
                  value={view.referrals.top?.name.replace(/^โรงพยาบาล/, '') ?? '—'}
                  hint={
                    view.referrals.top == null
                      ? 'ไม่มีข้อมูลในช่วงนี้'
                      : `${nf.format(view.referrals.top.ci.total)} ราย · ช็อกแรกรับ ${nf.format(view.referrals.top.shock.total)} ราย`
                  }
                />
              </section>

              <div className="mt-4">
                <Panel
                  title={`ผู้ป่วยที่รับส่งต่อมา แยกตามโรงพยาบาลต้นทาง · ${rangeLabel}`}
                  desc="แท่งบนคือผู้ป่วย CI Sepsis ที่ส่งมา แท่งล่างคือจำนวนที่มาถึงในสภาพ Septic shock — ชี้ที่แท่งเพื่อดูสัดส่วน"
                >
                  {view.referrals.bars.length > 0 ? (
                    <GroupChart
                      points={view.referrals.bars}
                      labels={{ total: 'ส่งมาทั้งหมด', part: 'ช็อกแรกรับ' }}
                    />
                  ) : (
                    <Empty
                      description={
                        <span className="text-xs text-ink-3">
                          ไม่มีผู้ป่วยที่รับส่งต่อมาในช่วงนี้
                        </span>
                      }
                    />
                  )}
                </Panel>
              </div>

              <section className="mt-4 rounded-2xl border border-line bg-panel p-4 backdrop-blur">
                <div className="mb-3 text-sm font-semibold text-ink">
                  ตารางรายโรงพยาบาลต้นทาง {rangeLabel}
                </div>
                <Table<SepsisReferral>
                  size="small"
                  rowKey="code"
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                  dataSource={view.referrals.hospitals}
                  columns={[
                    {
                      key: 'name',
                      title: 'โรงพยาบาลต้นทาง',
                      dataIndex: 'name',
                      render: (name: string) => <span className="text-ink">{name}</span>,
                    },
                    {
                      key: 'ci',
                      title: 'CI Sepsis ที่ส่งมา',
                      align: 'right',
                      render: (_, row) => nf.format(row.ci.total),
                    },
                    {
                      key: 'shock',
                      title: 'Septic shock',
                      align: 'right',
                      render: (_, row) => nf.format(row.shock.total),
                    },
                    {
                      key: 'shockShare',
                      title: 'สัดส่วนที่มาถึงในสภาพช็อก',
                      align: 'right',
                      render: (_, row) =>
                        row.ci.total > 0
                          ? `${((row.shock.total / row.ci.total) * 100).toFixed(1)}%`
                          : '—',
                    },
                    {
                      key: 'shockDead',
                      title: 'ช็อกแล้วเสียชีวิต',
                      align: 'right',
                      render: (_, row) => nf.format(row.shock.dead),
                    },
                    {
                      key: 'shockRate',
                      title: 'อัตราตายของกลุ่มช็อก',
                      align: 'right',
                      render: (_, row) => <RateCell count={row.shock} target={null} />,
                    },
                    {
                      key: 'gap',
                      title: 'เทียบอัตราตายรวมของกลุ่มช็อก',
                      align: 'right',
                      render: (_, row) => (
                        <Delta
                          current={rateOf(row.shock)}
                          previous={rateOf(view.referrals.shock)}
                          digits={2}
                          suffix=" จุด"
                        />
                      ),
                    },
                    {
                      key: 'ciRate',
                      title: 'อัตราตายทั้งกลุ่มที่ส่งมา',
                      align: 'right',
                      render: (_, row) => <RateCell count={row.ci} target={null} />,
                    },
                  ]}
                />
                <div className="mt-2 text-xs text-ink-3">
                  รวมที่รับส่งต่อมา {nf.format(view.referrals.ci.total)} ราย · มาถึงในสภาพช็อก{' '}
                  {nf.format(view.referrals.shock.total)} ราย (
                  {view.referrals.ci.total > 0
                    ? `${((view.referrals.shock.total / view.referrals.ci.total) * 100).toFixed(1)}%`
                    : '—'}
                  ) · ในกลุ่มนั้นเสียชีวิต {nf.format(view.referrals.shock.dead)} ราย (
                  {pctText(view.referrals.shock)})
                </div>
              </section>
            </section>
            <section className="mt-2">
              <SectionHead
                title="9 · การเข้าถึง ICU ของผู้ป่วย Sepsis (early ICU access)"
                desc="ผู้ป่วยได้เข้าหอผู้ป่วยหนักเร็วแค่ไหนนับจากเวลารับเข้านอน — และกลุ่มที่ไม่ได้เข้าเลยมีเท่าไร"
                hint={
                  <div className="text-xs leading-relaxed">
                    <div>
                      <b>นาฬิกาเริ่มที่เวลารับเข้านอน (ipt.regdate + regtime)</b> ไม่ใช่เวลาที่
                      วินิจฉัย sepsis หรือเวลาที่ผู้ป่วยถึงห้องฉุกเฉิน เพราะ HIS ไม่ได้บันทึก
                      เวลาวินิจฉัยไว้เลย ตัวเลขนี้จึงเป็น “ช้ากว่าแรกรับเท่าไร” ไม่ใช่
                      “ช้ากว่าการวินิจฉัยเท่าไร” ตามนิยามของตัวชี้วัดระดับชาติ — ถ้าคณะกรรมการ
                      ต้องการนาฬิกาที่เริ่มจากการวินิจฉัย ต้องมีที่บันทึกเวลานั้นก่อน
                    </div>
                    <div className="mt-1.5">
                      หอ ICU ที่นับมีห้าหอตามที่ได้รับมา: MICU 1 (16) · MICU 2 (01) · SICU (33) ·
                      ICU 4 (36) · Sub ICU Med (30) — ไม่รวม NICU (35) เพราะ sepsis ของทารก
                      แรกเกิดลงรหัส P36 ไม่ใช่ A40-A41 จึงไม่เข้าขอบเขตรายงานนี้อยู่แล้ว
                    </div>
                    <div className="mt-1.5">
                      หอ ICU แห่งแรกหาจากสามทางตามลำดับ: หอแรกรับ (ipt.first_ward) ถ้าเป็น ICU
                      อยู่แล้ว · แถวย้ายเตียงเข้า ICU ที่เร็วที่สุดในทะเบียน iptbedmove ·
                      หรือหอที่จำหน่ายถ้าเป็น ICU แต่ไม่มีแถวย้ายเตียงบันทึกไว้ ทางที่สาม
                      บอกได้แต่ว่า “เข้า ICU” ไม่รู้ว่าเมื่อไร จึงนับเป็นทันเกณฑ์ไม่ได้ (วัดแล้ว{' '}
                      {nf.format(view.icu.totals.bins.unknownTime)} ราย จาก{' '}
                      {nf.format(view.icu.totals.admissions)} รายในช่วงนี้)
                    </div>
                    <div className="mt-1.5">
                      <b>ปุ่มตัวหารเปลี่ยนความหมายของอัตรา</b> — ผู้ป่วย HI ติดเชื้อหลังนอนไป
                      แล้วหลายวัน ระยะเวลา “จากแรกรับถึง ICU” ของกลุ่มนั้นจึงยาวโดยธรรมชาติ
                      ไม่ได้แปลว่าเข้าถึง ICU ช้า ตัวเลขของ “ผู้ป่วยทั้งหมด” ต่ำกว่าความจริง
                      อยู่เสมอ และควรดูคู่กับ “เฉพาะ CI”
                    </div>
                    <div className="mt-1.5">
                      <b>ยังไม่มีเกณฑ์ที่ตกลงกันไว้</b> หน้านี้จึงไม่ตัดสินผ่าน/ไม่ผ่าน เกณฑ์ 3
                      ชั่วโมงเป็นค่าที่ใช้กันทั่วไปในตัวชี้วัด Service Plan สาขา Sepsis แต่ที่นั่น
                      นับจากการวินิจฉัย ไม่ใช่จากแรกรับ จึงเทียบกันตรง ๆ ไม่ได้
                    </div>
                  </div>
                }
              />

              <div className="mb-4 flex flex-wrap items-center gap-3">
                <Segmented<SepsisIcuThreshold>
                  title="เกณฑ์เวลา"
                  value={view.icu.threshold}
                  onChange={setIcuThreshold}
                  options={SEPSIS_ICU_THRESHOLDS.map(hours => ({
                    label: `ภายใน ${hours} ชม.`,
                    value: hours,
                  }))}
                />
                <Segmented<SepsisIcuScope>
                  title="ตัวหาร"
                  value={view.icu.scope}
                  onChange={setIcuScope}
                  options={SEPSIS_ICU_SCOPES.map(name => ({
                    label: ICU_SCOPE_LABEL[name].short,
                    value: name,
                  }))}
                />
                <span className="text-xs text-ink-3">{ICU_SCOPE_LABEL[view.icu.scope].long}</span>
              </div>

              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi
                  label={`Early ICU access ภายใน ${view.icu.threshold} ชม. · ${rangeLabel}`}
                  value={
                    view.icu.totals.admissions > 0
                      ? `${((view.icu.within / view.icu.totals.admissions) * 100).toFixed(1)}%`
                      : '—'
                  }
                  hint={`${nf.format(view.icu.within)} จาก ${nf.format(view.icu.totals.admissions)} ราย`}
                />
                <Kpi
                  label="หอแรกรับเป็น ICU อยู่แล้ว"
                  value={nf.format(view.icu.totals.bins.atAdmission)}
                  hint={
                    view.icu.totals.admissions > 0
                      ? `${((view.icu.totals.bins.atAdmission / view.icu.totals.admissions) * 100).toFixed(1)}% ของผู้ป่วยในช่วงนี้ — เกือบทั้งหมดของกลุ่มที่ทันเกณฑ์มาจากทางนี้`
                      : 'ไม่มีผู้ป่วยในช่วงนี้'
                  }
                />
                <Kpi
                  label="ได้เข้า ICU ไม่ว่าเมื่อไร"
                  value={nf.format(view.icu.ever)}
                  hint={
                    view.icu.totals.admissions > 0
                      ? `${((view.icu.ever / view.icu.totals.admissions) * 100).toFixed(1)}% ของผู้ป่วยในช่วงนี้`
                      : 'ไม่มีผู้ป่วยในช่วงนี้'
                  }
                />
                <Kpi
                  label="ไม่ได้เข้า ICU เลย"
                  value={nf.format(view.icu.totals.bins.never)}
                  hint={
                    view.icu.totals.admissions > 0
                      ? `${((view.icu.totals.bins.never / view.icu.totals.admissions) * 100).toFixed(1)}% ของผู้ป่วยในช่วงนี้ — รวมผู้ป่วยที่อาการไม่ถึงเกณฑ์เข้า ICU`
                      : 'ไม่มีผู้ป่วยในช่วงนี้'
                  }
                />
              </section>

              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <Panel
                  title={`อัตรา early ICU access ภายใน ${view.icu.threshold} ชม. ตาม${periodTitle}`}
                  desc={`ความสูงรวมของแท่งคือ${ICU_SCOPE_LABEL[view.icu.scope].long}ในช่วงนั้น ส่วนสีฟ้าคือจำนวนที่เข้า ICU ทันเกณฑ์ และเส้นคืออัตรา`}
                  hint={
                    <div className="text-xs leading-relaxed">
                      สีฟ้าในกราฟนี้ไม่ใช่สีแดงของกราฟอื่นในหน้า เพราะตัวชี้วัดนี้
                      <b>ยิ่งมากยิ่งดี</b> ต่างจากอัตราตายที่ยิ่งน้อยยิ่งดี — สีแดงสงวนไว้
                      ให้การเสียชีวิตตลอดทั้งหน้า
                    </div>
                  }
                >
                  <MortalityChart
                    points={view.icu.trend}
                    target={null}
                    tone="good"
                    goal="atLeast"
                    labels={{
                      rest: `ไม่ทันเกณฑ์ ${view.icu.threshold} ชม.`,
                      part: `เข้า ICU ภายใน ${view.icu.threshold} ชม.`,
                      rate: 'อัตรา early ICU access',
                      total: 'ผู้ป่วย',
                    }}
                  />
                </Panel>

                <Panel
                  title={`หอ ICU แห่งแรกที่ผู้ป่วยเข้า · ${rangeLabel}`}
                  desc={`แท่งบนคือผู้ป่วยที่เข้าหอนั้นเป็น ICU แห่งแรกของการนอนครั้งนั้น แท่งล่างคือจำนวนที่ถึงภายใน ${view.icu.threshold} ชม.`}
                  hint={
                    <div className="text-xs leading-relaxed">
                      นับหอ <b>แห่งแรก</b> เท่านั้น ผู้ป่วยที่ย้ายต่อไปอีกหอจะไม่ถูกนับซ้ำ
                      ผลรวมของทุกหอจึงเท่ากับจำนวนที่ได้เข้า ICU พอดี — และตัวเลขนี้อ่านเป็น
                      ภาระงานของแต่ละหอ ไม่ใช่คุณภาพของหอ
                    </div>
                  }
                >
                  {view.icu.wardBars.length > 0 ? (
                    <GroupChart
                      points={view.icu.wardBars}
                      labels={{
                        total: 'ผู้ป่วยที่เข้าหอนี้',
                        part: `ถึงภายใน ${view.icu.threshold} ชม.`,
                      }}
                    />
                  ) : (
                    <Empty
                      description={
                        <span className="text-xs text-ink-3">ไม่มีผู้ป่วยที่เข้า ICU ในช่วงนี้</span>
                      }
                    />
                  )}
                </Panel>
              </div>

              <section className="mt-4 rounded-2xl border border-line bg-panel p-4 backdrop-blur">
                <div className="mb-3 text-sm font-semibold text-ink">
                  ระยะเวลาจากแรกรับถึง ICU แยกเป็นช่วง {rangeLabel}
                </div>
                <Table<IcuBinRow>
                  size="small"
                  rowKey="bin"
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                  dataSource={view.icu.bins}
                  columns={[
                    {
                      key: 'name',
                      title: 'ระยะเวลาถึง ICU',
                      dataIndex: 'name',
                      render: (name: string) => <span className="text-ink">{name}</span>,
                    },
                    {
                      key: 'count',
                      title: 'ผู้ป่วย',
                      align: 'right',
                      render: (_, row) => nf.format(row.count),
                    },
                    {
                      key: 'share',
                      title: 'สัดส่วนของผู้ป่วยในช่วง',
                      align: 'right',
                      render: (_, row) =>
                        view.icu.totals.admissions > 0
                          ? `${((row.count / view.icu.totals.admissions) * 100).toFixed(1)}%`
                          : '—',
                    },
                    {
                      key: 'cumulative',
                      title: 'สะสมจากเร็วไปช้า',
                      align: 'right',
                      // สะสมหยุดที่ถัง later — unknownTime กับ never ไม่ใช่ "ช้ากว่า" แต่เป็น
                      // คนละเรื่อง (ไม่รู้เวลา และไม่ได้เข้า) การสะสมต่อจะอ่านว่าช้าที่สุด
                      render: (_, row) => {
                        const order = SEPSIS_ICU_BINS.indexOf(row.bin)
                        if (order > SEPSIS_ICU_BINS.indexOf('later')) return '—'
                        const upto = view.icu.bins
                          .slice(0, order + 1)
                          .reduce((n, item) => n + item.count, 0)
                        return view.icu.totals.admissions > 0
                          ? `${((upto / view.icu.totals.admissions) * 100).toFixed(1)}%`
                          : '—'
                      },
                    },
                  ]}
                />
                <div className="mt-2 text-xs text-ink-3">
                  ทุกรายตกช่วงใดช่วงเดียว ผลรวมของคอลัมน์ผู้ป่วยจึงเท่ากับ{' '}
                  {nf.format(view.icu.totals.admissions)} รายพอดี
                </div>
              </section>

              <section className="mt-4 rounded-2xl border border-line bg-panel p-4 backdrop-blur">
                <div className="mb-3 text-sm font-semibold text-ink">
                  ตารางอัตรา early ICU access ภายใน {view.icu.threshold} ชม. {rangeLabel}
                </div>
                <Table<SepsisPeriod>
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
                      key: 'admissions',
                      title: 'ผู้ป่วยในช่วง',
                      align: 'right',
                      render: (_, row) => nf.format(row.icu[view.icu.scope].admissions),
                    },
                    {
                      key: 'atAdmission',
                      title: 'แรกรับเข้า ICU เลย',
                      align: 'right',
                      render: (_, row) => nf.format(row.icu[view.icu.scope].bins.atAdmission),
                    },
                    {
                      key: 'within',
                      title: `ถึง ICU ภายใน ${view.icu.threshold} ชม.`,
                      align: 'right',
                      render: (_, row) =>
                        nf.format(withinOf(row.icu[view.icu.scope], view.icu.threshold)),
                    },
                    {
                      key: 'rate',
                      title: 'อัตรา early ICU access',
                      align: 'right',
                      render: (_, row) => {
                        const counts = row.icu[view.icu.scope]
                        const previous = view.previousOf.get(row.key)
                        return (
                          <RateCell
                            goal="high"
                            target={null}
                            count={{
                              total: counts.admissions,
                              dead: withinOf(counts, view.icu.threshold),
                            }}
                            previous={comparable(
                              row,
                              previous == null
                                ? null
                                : {
                                    total: previous.icu[view.icu.scope].admissions,
                                    dead: withinOf(
                                      previous.icu[view.icu.scope],
                                      view.icu.threshold,
                                    ),
                                  },
                            )}
                          />
                        )
                      },
                    },
                    {
                      key: 'ever',
                      title: 'ได้เข้า ICU ไม่ว่าเมื่อไร',
                      align: 'right',
                      render: (_, row) => nf.format(everOf(row.icu[view.icu.scope])),
                    },
                    {
                      key: 'never',
                      title: 'ไม่ได้เข้า ICU',
                      align: 'right',
                      render: (_, row) => nf.format(row.icu[view.icu.scope].bins.never),
                    },
                  ]}
                />
                <div className="mt-2 text-xs text-ink-3">
                  คอลัมน์อัตราคิดจาก “ถึง ICU ภายใน {view.icu.threshold} ชม.” หารด้วย
                  “ผู้ป่วยในช่วง” บรรทัดล่างสุดคือส่วนต่างจากช่วงก่อนหน้า — ที่นี่ลูกศรขึ้น
                  เป็นสีเขียว เพราะตัวชี้วัดนี้ยิ่งมากยิ่งดี
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
