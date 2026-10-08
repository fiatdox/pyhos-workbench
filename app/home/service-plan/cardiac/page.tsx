'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ยังทำที่ app/home/layout.tsx ซึ่งเป็น Server Component)
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Alert, Breadcrumb, Empty, Segmented, Spin, Table, Tag, Typography } from 'antd'
import { HeartOutlined } from '@ant-design/icons'
import { apiFetch } from '@/lib/client/session'
// รายชื่อกลุ่มมาจาก cardiac-groups ไม่ใช่ cardiac-stats — อันหลังเป็น server-only
// ถ้า import ค่า (ไม่ใช่แค่ type) จากที่นั่น bundler จะลาก mysql2 เข้า client bundle
import {
  IHD_BLOCKS,
  MI_GROUPS,
  MI_PARTS,
  STEMI_MORTALITY_TARGET,
  type CardiacCode,
  type CardiacCount,
  type CardiacPeriod,
  type IhdBlock,
  type MiGroup,
} from '@/lib/his/cardiac-groups'
import type { CardiacStats } from '@/lib/his/cardiac-stats'
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
 * Service Plan สาขาโรคหัวใจ — กล้ามเนื้อหัวใจตายและโรคหัวใจขาดเลือด
 *
 * สองตัวชี้วัด:
 *   1. อัตราตายของผู้ป่วย STEMI ไม่เกินร้อยละ 9 (ส่วนที่ 1-2)
 *   2. อัตราป่วยโรคหัวใจขาดเลือด I20-I25 — ไม่มีเกณฑ์มาด้วย (ส่วนที่ 3)
 *
 * ตัวชี้วัดที่สอง**ครอบตัวชี้วัดที่หนึ่งไว้ทั้งหมด** ส่วนที่ 3 จึงบอกไว้ตรง ๆ ว่า
 * ยอด MI ของส่วนที่ 1 เป็นส่วนย่อยของยอดที่นั่นเท่าไร (ราว 79%) ไม่ใช่สองยอด
 * ที่ไม่เกี่ยวกัน — ทั้งสองอ่านจากคิวรีเดียวกัน บล็อก mi คือขอบเขตเดียวกับยอดรวม
 * ของส่วนที่ 1 ตรงตัว
 *
 * **หน้าแรกของระบบที่มีเกณฑ์มาด้วย** — หน้า Stroke, Sepsis และ COPD ยังไม่มีเกณฑ์
 * ที่ตกลงกันไว้เลยจึงไม่ตัดสินผ่าน/ไม่ผ่าน ที่นี่ตัดสินได้ แต่เฉพาะกลุ่ม STEMI
 * ซึ่งเป็นกลุ่มที่เกณฑ์นิยามไว้ ถ้าคนอ่านสลับไปดู NSTEMI หรือยอดรวม เส้นเกณฑ์กับ
 * คำตัดสินจะหายไป เพราะเกณฑ์ไม่ได้นิยามไว้สำหรับกลุ่มเหล่านั้น
 *
 * เรื่องที่หน้านี้ต้องบอกคนอ่านตรง ๆ — คิวรีที่ได้รับมานับช่วง I21-I23 ทั้งช่วง
 * ซึ่งรวม NSTEMI ที่มีมากกว่า STEMI สามเท่ากว่า ตัวหารจึงต่างกัน 4.4 เท่าจากที่
 * ชื่อตัวชี้วัดบอกไว้ (ดู lib/his/cardiac-stats.ts)
 *
 * ไม่มีข้อมูลรายบุคคลในหน้านี้ ตัวเลขทุกตัวเป็นผลรวมรายช่วงที่นับมาจากฐานข้อมูล
 */

/** ป้ายของกลุ่มชนิดกล้ามเนื้อหัวใจตาย */
const GROUP_LABEL: Record<MiGroup, { short: string; long: string; codes: string }> = {
  stemi: {
    short: 'STEMI',
    long: 'ST-elevation myocardial infarction',
    codes: 'I210-I213',
  },
  nstemi: {
    short: 'NSTEMI',
    long: 'Non-ST-elevation myocardial infarction',
    codes: 'I214',
  },
  other: {
    short: 'อื่น ๆ',
    long: 'ไม่ระบุชนิด · ตายซ้ำ · ภาวะแทรกซ้อนหลังกล้ามเนื้อหัวใจตาย',
    codes: 'I219, I22, I23',
  },
  all: {
    short: 'ทั้งหมด',
    long: 'กล้ามเนื้อหัวใจตายเฉียบพลันทุกชนิด — ยอดที่คิวรีที่ได้รับมาคำนวณ',
    codes: 'I21-I23',
  },
}

/** กลุ่มที่เลือกดูได้ — เรียง STEMI ก่อนเพราะเป็นกลุ่มของตัวชี้วัด */
const GROUP_CHOICES: MiGroup[] = ['stemi', 'nstemi', 'other', 'all']

/** ป้ายของบล็อกโรคหัวใจขาดเลือด */
const IHD_LABEL: Record<IhdBlock, { short: string; long: string; codes: string }> = {
  angina: {
    short: 'เจ็บเค้นหัวใจ',
    long: 'Angina pectoris — เจ็บเค้นหัวใจ รวมชนิดไม่คงที่ (unstable angina)',
    codes: 'I20',
  },
  mi: {
    short: 'กล้ามเนื้อหัวใจตาย',
    long: 'กล้ามเนื้อหัวใจตายเฉียบพลัน ตายซ้ำ และภาวะแทรกซ้อน — ขอบเขตเดียวกับส่วนที่ 1',
    codes: 'I21-I23',
  },
  otherAcute: {
    short: 'ขาดเลือดเฉียบพลันอื่น',
    long: 'โรคหัวใจขาดเลือดเฉียบพลันแบบอื่น',
    codes: 'I24',
  },
  chronic: {
    short: 'ขาดเลือดเรื้อรัง',
    long: 'โรคหัวใจขาดเลือดเรื้อรัง — บล็อกที่คิวรีที่ได้รับมาตกไปทั้งบล็อก',
    codes: 'I25',
  },
}

/**
 * ผู้ป่วยโรคหัวใจขาดเลือดต่อผู้ป่วยในหนึ่งพันราย — "อัตราป่วย" ที่ข้อมูลนี้ตอบได้
 *
 * ตัวชี้วัดระดับชาติคิดต่อประชากร ซึ่ง HIS ไม่มีตัวหารนั้น การแทนตัวหารนี้ประกาศ
 * ไว้ทุกที่ที่แสดงอัตรา เหมือนหน้า COPD ที่เจอข้อจำกัดเดียวกัน
 */
const per1000 = (patients: number, admissions: number) =>
  admissions > 0 ? (patients / admissions) * 1000 : null

/** รวมทุกช่วงของกลุ่มหนึ่ง */
const sumOf = (periods: CardiacPeriod[], group: MiGroup): CardiacCount =>
  periods.reduce(
    (acc, period) => ({
      total: acc.total + period.groups[group].total,
      dead: acc.dead + period.groups[group].dead,
    }),
    { total: 0, dead: 0 },
  )

/** รวมทุกช่วงของบล็อกโรคหัวใจขาดเลือดหนึ่งบล็อก */
const sumBlock = (periods: CardiacPeriod[], block: IhdBlock): CardiacCount =>
  periods.reduce(
    (acc, period) => ({
      total: acc.total + period.ihd[block].total,
      dead: acc.dead + period.ihd[block].dead,
    }),
    { total: 0, dead: 0 },
  )

export default function ServicePlanCardiacPage() {
  const [stats, setStats] = useState<CardiacStats | null>(null)
  const [fiscalYear, setFiscalYear] = useState<number | null>(null)
  const [quarter, setQuarter] = useState<QuarterChoice>(0)
  /** กลุ่มชนิดที่กำลังดู — ตั้งต้นที่ STEMI ตามชื่อตัวชี้วัด */
  const [group, setGroup] = useState<MiGroup>('stemi')
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
          `/api/his/service-plan/cardiac${query === '' ? '' : `?${query}`}`,
        )
        const json = await res.json()
        if (!alive) return
        if (!res.ok || !json.success) {
          setStats(null)
          setError(json.message ?? 'ดึงข้อมูลสถิติไม่สำเร็จ')
          return
        }
        setStats(json.stats as CardiacStats)
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

    // เกณฑ์ร้อยละ 9 นิยามไว้สำหรับ STEMI เท่านั้น — กลุ่มอื่นไม่ลากเส้นและไม่ตัดสิน
    const target = group === 'stemi' ? STEMI_MORTALITY_TARGET : null
    const totals = sumOf(stats.periods, group)
    const allTotals = sumOf(stats.periods, 'all')

    return {
      latest,
      running,
      latestLabel: periodLabel(latest.key).full,
      group,
      target,
      totals,
      allTotals,
      latestCount: latest.groups[group],
      // ช่วงเวลาที่กราฟแท่งซ้อนใช้เป็นแกนนอน
      timeline: stats.periods.map(period => ({
        label: periodLabel(period.key).short,
        title: periodLabel(period.key).full,
        partial: period.partial,
      })),
      trend: stats.periods.map<MortalityPoint>(period => ({
        label: periodLabel(period.key).short,
        title: `${GROUP_LABEL[group].short} · ${periodLabel(period.key).full}`,
        partial: period.partial,
        percent: rateOf(period.groups[group]),
        dead: period.groups[group].dead,
        total: period.groups[group].total,
      })),
      // แท่งซ้อนได้จริง เพราะสามกลุ่มแบ่งผู้ป่วยออกจากกันหมด (โรคหลักมีรหัสเดียว)
      typeSeries: MI_PARTS.map<TrendSeries>(part => ({
        name: GROUP_LABEL[part].short,
        values: stats.periods.map(period => period.groups[part].total),
      })),
      // แท่งคู่เทียบสามกลุ่มในช่วงเดียว — ตัดกลุ่มที่ไม่มีผู้ป่วยออกจากกราฟ
      typeBars: MI_PARTS.filter(part => sumOf(stats.periods, part).total > 0).map<GroupPoint>(
        part => {
          const sum = sumOf(stats.periods, part)
          return { name: GROUP_LABEL[part].short, total: sum.total, dead: sum.dead }
        },
      ),
      /** กลุ่มที่ไม่มีผู้ป่วยเลยทั้งช่วง — ต้องบอกว่าไม่ได้ลงรหัสนั้น ไม่ใช่กราฟพัง */
      emptyParts: MI_PARTS.filter(part => sumOf(stats.periods, part).total === 0),
      codes: stats.codes,
      /** ตัวชี้วัดที่สอง — โรคหัวใจขาดเลือดทั้งช่วง I20-I25 */
      ihd: {
        totals: stats.periods.reduce<CardiacCount>(
          (acc, period) => ({
            total: acc.total + period.ihdTotal.total,
            dead: acc.dead + period.ihdTotal.dead,
          }),
          { total: 0, dead: 0 },
        ),
        latest: latest.ihdTotal,
        admissions: stats.periods.reduce((n, period) => n + period.admissions, 0),
        latestAdmissions: latest.admissions,
        // สี่บล็อกแบ่งผู้ป่วยออกจากกันหมด วางเป็นแท่งซ้อนได้จริง — ตัดบล็อกที่ไม่มี
        // ผู้ป่วยเลยออกจากกราฟ ไม่ให้คำอธิบายกราฟมีชื่อที่ไม่มีแท่งอยู่
        series: IHD_BLOCKS.filter(block => sumBlock(stats.periods, block).total > 0).map<TrendSeries>(
          block => ({
            name: IHD_LABEL[block].short,
            values: stats.periods.map(period => period.ihd[block].total),
          }),
        ),
        bars: IHD_BLOCKS.filter(block => sumBlock(stats.periods, block).total > 0).map<GroupPoint>(
          block => {
            const sum = sumBlock(stats.periods, block)
            return { name: IHD_LABEL[block].short, total: sum.total, dead: sum.dead }
          },
        ),
        /** บล็อกที่ไม่มีผู้ป่วยเลยทั้งช่วง — ต้องบอกว่าไม่ได้ลงรหัสนั้น ไม่ใช่ข้อมูลหาย */
        emptyBlocks: IHD_BLOCKS.filter(block => sumBlock(stats.periods, block).total === 0),
        trend: stats.periods.map<MortalityPoint>(period => ({
          label: periodLabel(period.key).short,
          title: `โรคหัวใจขาดเลือด · ${periodLabel(period.key).full}`,
          partial: period.partial,
          percent: rateOf(period.ihdTotal),
          dead: period.ihdTotal.dead,
          total: period.ihdTotal.total,
        })),
        /** ยอดแบบที่คิวรีเขียนไว้ และส่วนที่ BETWEEN ตกไป */
        asWritten: stats.asWritten,
        missed: {
          total: stats.periods.reduce((n, period) => n + period.ihdTotal.total, 0) -
            stats.asWritten.total,
          dead: stats.periods.reduce((n, period) => n + period.ihdTotal.dead, 0) -
            stats.asWritten.dead,
        },
      },
      previousOf: new Map(
        stats.periods.map((period, index) => [
          period.key,
          index > 0 ? stats.periods[index - 1] : null,
        ]),
      ),
    }
  }, [stats, group])

  return (
    <>
      <section className="mb-6">
        <Breadcrumb
          className="mb-2"
          items={[
            { title: <Link href="/home/service-plan">Service Plan</Link> },
            { title: 'สาขาโรคหัวใจ' },
          ]}
        />
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          <HeartOutlined /> สาขาโรคหัวใจ
          <PageHint>
            สองตัวชี้วัดของผู้ป่วยในที่ลงโรคหัวใจเป็นโรคหลัก นับตามวันจำหน่าย ปีงบประมาณ
            1 ต.ค. ถึง 30 ก.ย. — (1) อัตราตายของกล้ามเนื้อหัวใจตายเฉียบพลัน แยกชนิด
            STEMI / NSTEMI ซึ่งมีเกณฑ์ไม่เกินร้อยละ 9 สำหรับกลุ่ม STEMI และ (2) อัตรา
            ป่วยโรคหัวใจขาดเลือดทั้งช่วง I20-I25 ซึ่งครอบตัวชี้วัดแรกไว้และไม่มีเกณฑ์
            มาด้วย · ไม่มีข้อมูลรายบุคคลในหน้านี้
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
                  {view.running.groups.all.total === 0
                    ? `ยังไม่มีผู้ป่วยกล้ามเนื้อหัวใจตายของ${periodLabel(view.running.key).full} ที่ลงรหัสแล้ว`
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
                  ส่วนการ์ดสรุปด้านบนอ่านจาก{view.latestLabel} ซึ่งปิดแล้ว · ช่วงที่ยังไม่จบ
                  ไม่ถูกตัดสินผ่าน/ไม่ผ่านเกณฑ์
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
                title="1 · อัตราตายของผู้ป่วยกล้ามเนื้อหัวใจตายเฉียบพลัน"
                desc="การนอนโรงพยาบาลที่มีรหัส I21-I23 เป็นโรคหลัก — เสียชีวิตในโรงพยาบาลกี่ราย คิดเป็นร้อยละเท่าไร"
                hint={
                  <div className="text-xs leading-relaxed">
                    <div>
                      <b>คิวรีที่ได้รับมานับกว้างกว่าชื่อตัวชี้วัด</b> — ชื่อบอกว่า STEMI แต่
                      ช่วง <code>I21-I23</code> รวม NSTEMI (I214) เข้ามาด้วย ซึ่งในฐานนี้มี
                      มากกว่า STEMI สามเท่ากว่า วัดห้าปีงบได้ STEMI 342 ราย เทียบยอดรวม
                      1,497 ราย — <b>ตัวหารต่างกัน 4.4 เท่า</b> ร้อยละของสองกลุ่มใกล้กัน
                      โดยบังเอิญ (7.02% เทียบ 7.21%) แต่การรายงานยอดรวมว่าเป็น STEMI ยังผิด
                      หน้านี้จึงให้เลือกกลุ่มได้ และตั้งต้นที่ STEMI ตามชื่อตัวชี้วัด
                    </div>
                    <div className="mt-1.5">
                      <b>เกณฑ์ไม่เกินร้อยละ 9 ใช้กับกลุ่ม STEMI เท่านั้น</b> ไม่ได้นิยามไว้
                      สำหรับ NSTEMI หรือยอดรวม เมื่อสลับไปดูกลุ่มอื่น เส้นเกณฑ์และคำตัดสิน
                      ผ่าน/ไม่ผ่านจะหายไป ไม่ใช่กราฟพัง
                    </div>
                    <div className="mt-1.5">
                      <b>จำนวนผู้ป่วย STEMI ต่อปีมีหลักสิบ</b> (เฉลี่ยราว 68 รายต่อปีงบ)
                      อัตราตายรายปีจึงแกว่งมากโดยธรรมชาติ — ตายเพิ่มสามรายขยับอัตราได้
                      หลายจุด การข้ามเกณฑ์ในปีเดียวจึงอ่านเป็นแนวโน้มไม่ได้ ต้องดูหลายปี
                      ประกอบ และรายเดือนยิ่งแกว่งกว่านั้นอีก
                    </div>
                    <div className="mt-1.5">
                      ตัวหารคือการนอนโรงพยาบาล (AN) ไม่ใช่จำนวนคน ผู้ป่วยคนเดียวที่นอนสองครั้ง
                      ในช่วงเดียวกันนับสองครั้ง · นับเฉพาะที่ลงเป็น<b>โรคหลัก</b> (diagtype 1)
                      ตามคิวรีที่ได้รับมา
                    </div>
                    <div className="mt-1.5">
                      การเสียชีวิตนับจากประเภทการจำหน่าย 08 และ 09 ตรงกับทะเบียนของ HIS
                      (Dead Autopsy / Dead Non Autopsy) ส่วน 02 คือ Against Advice ไม่ใช่
                      การเสียชีวิต — เหมือนหน้า COPD และ Stroke แต่<b>ต่างจากหน้า Sepsis</b>{' '}
                      ที่นับ 02 ด้วยตามคิวรีที่ได้รับมาสำหรับหน้านั้น
                    </div>
                    <div className="mt-1.5">
                      ช่วงรหัสในคิวรีเขียนเป็น <code>BETWEEN</code> ซึ่งเทียบสตริง จึงได้
                      I23 ตัวเปล่าแต่ไม่ได้ I230-I239 — หน้านี้ใช้สามหลักแรกแทน วัดแล้ววันนี้
                      ผลเท่ากันทุกตัวเลข เพราะไม่มีการลง I23x เป็นโรคหลักเลย
                    </div>
                  </div>
                }
              />

              <div className="mb-4 flex flex-wrap items-center gap-3">
                <Segmented<MiGroup>
                  title="ชนิด"
                  value={view.group}
                  onChange={setGroup}
                  options={GROUP_CHOICES.map(choice => ({
                    label: GROUP_LABEL[choice].short,
                    value: choice,
                  }))}
                />
                <span className="text-xs text-ink-3">
                  {GROUP_LABEL[view.group].long} · {GROUP_LABEL[view.group].codes}
                </span>
                {view.target == null && (
                  <Tag className="mr-0!" color="default">
                    กลุ่มนี้ไม่มีเกณฑ์
                  </Tag>
                )}
              </div>

              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi
                  label={`ผู้ป่วย ${GROUP_LABEL[view.group].short} · ${rangeLabel}`}
                  value={nf.format(view.totals.total)}
                  hint={
                    view.group === 'all'
                      ? `เสียชีวิต ${nf.format(view.totals.dead)} ราย`
                      : `เสียชีวิต ${nf.format(view.totals.dead)} ราย · คิดเป็น ${view.allTotals.total > 0 ? ((view.totals.total / view.allTotals.total) * 100).toFixed(1) : '—'}% ของผู้ป่วยกล้ามเนื้อหัวใจตายทั้งหมด`
                  }
                />
                <Kpi
                  label={`อัตราตาย · ${rangeLabel}`}
                  value={pctText(view.totals)}
                  hint={
                    view.target == null
                      ? `${nf.format(view.totals.dead)} จาก ${nf.format(view.totals.total)} ราย — กลุ่มนี้ไม่มีเกณฑ์กำหนดไว้`
                      : `${nf.format(view.totals.dead)} จาก ${nf.format(view.totals.total)} ราย · เกณฑ์ไม่เกิน ${view.target}%`
                  }
                  verdict={
                    view.target == null || rateOf(view.totals) == null
                      ? null
                      : (rateOf(view.totals) as number) <= view.target
                  }
                />
                <Kpi
                  label={`อัตราตาย · ${view.latestLabel}`}
                  value={pctText(view.latestCount)}
                  hint={`${nf.format(view.latestCount.dead)} จาก ${nf.format(view.latestCount.total)} ราย — ช่วงที่ปิดแล้วล่าสุด`}
                  verdict={
                    view.target == null || rateOf(view.latestCount) == null
                      ? null
                      : (rateOf(view.latestCount) as number) <= view.target
                  }
                />
                <Kpi
                  label="สัดส่วน STEMI ต่อ NSTEMI"
                  value={
                    sumOf(stats.periods, 'nstemi').total > 0
                      ? `1 : ${(sumOf(stats.periods, 'nstemi').total / Math.max(sumOf(stats.periods, 'stemi').total, 1)).toFixed(1)}`
                      : '—'
                  }
                  hint={`STEMI ${nf.format(sumOf(stats.periods, 'stemi').total)} ราย · NSTEMI ${nf.format(sumOf(stats.periods, 'nstemi').total)} ราย`}
                />
              </section>

              <div className="mt-4">
                <Panel
                  title={`อัตราตายของ ${GROUP_LABEL[view.group].short} ตาม${periodTitle}`}
                  desc={
                    view.target == null
                      ? 'ความสูงรวมของแท่งคือผู้ป่วยของกลุ่มนี้ในช่วงนั้น สีแดงคือจำนวนที่เสียชีวิต และเส้นคืออัตราตาย — กลุ่มนี้ไม่มีเกณฑ์จึงไม่มีเส้นเกณฑ์'
                      : `ความสูงรวมของแท่งคือผู้ป่วยของกลุ่มนี้ในช่วงนั้น สีแดงคือจำนวนที่เสียชีวิต เส้นม่วงคืออัตราตาย และเส้นประคือเกณฑ์ไม่เกิน ${view.target}%`
                  }
                >
                  <MortalityChart points={view.trend} target={view.target} />
                </Panel>
              </div>

              <section className="mt-4 rounded-2xl border border-line bg-panel p-4 backdrop-blur">
                <div className="mb-3 text-sm font-semibold text-ink">
                  ตารางอัตราตายทุกกลุ่ม {rangeLabel}
                </div>
                <Table<CardiacPeriod>
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
                    ...MI_GROUPS.map(name => ({
                      key: name,
                      title: GROUP_LABEL[name].short,
                      align: 'right' as const,
                      render: (_: unknown, row: CardiacPeriod) => (
                        <RateCell
                          count={row.groups[name]}
                          // เกณฑ์ตัดสินเฉพาะคอลัมน์ STEMI คอลัมน์อื่นแสดงเลขเปล่า
                          target={name === 'stemi' ? STEMI_MORTALITY_TARGET : null}
                          previous={comparable(row, view.previousOf.get(row.key)?.groups[name] ?? null)}
                        />
                      ),
                    })),
                  ]}
                />
                <div className="mt-2 text-xs text-ink-3">
                  แต่ละช่องเป็นร้อยละการเสียชีวิตของกลุ่มนั้น เศษส่วนใต้ร้อยละคือ
                  เสียชีวิต/ผู้ป่วยในกลุ่ม และบรรทัดล่างสุดคือส่วนต่างจากช่วงก่อนหน้า ·
                  <b> เฉพาะคอลัมน์ STEMI ที่ระบายสีผ่าน/ไม่ผ่าน</b> เพราะเกณฑ์ร้อยละ{' '}
                  {STEMI_MORTALITY_TARGET} นิยามไว้สำหรับกลุ่มนั้นเท่านั้น · สามคอลัมน์แรก
                  บวกกันได้เท่าคอลัมน์ทั้งหมดพอดี เพราะหนึ่งการนอนมีโรคหลักได้รหัสเดียว
                </div>
              </section>
            </section>

            <section className="mt-2">
              <SectionHead
                title="2 · ชนิดของกล้ามเนื้อหัวใจตายและรหัสที่ลง"
                desc="ยอดที่เห็นในส่วนที่ 1 มาจากรหัสอะไรบ้าง และแต่ละชนิดมีสัดส่วนเท่าไร"
                hint={
                  <div className="text-xs leading-relaxed">
                    <div>
                      ส่วนนี้มีไว้ให้ตรวจได้ว่าตัวหารของตัวชี้วัดมาจากรหัสอะไร — ถ้าไม่แสดง
                      รายรหัสไว้ คนอ่านไม่มีทางรู้ว่า NSTEMI ถูกนับรวมอยู่หรือไม่
                    </div>
                    <div className="mt-1.5">
                      สามกลุ่ม<b>แบ่งผู้ป่วยออกจากกันหมด</b> ไม่ซ้อนกัน เพราะหนึ่งการนอนมี
                      โรคหลักได้รหัสเดียว ผลรวมจึงเท่ากับยอดทั้งหมดพอดี และวางเป็นแท่งซ้อน
                      ได้จริง (ต่างจากกลุ่มของหน้า Sepsis ที่ซ้อนกันได้ จึงต้องวางเป็นแท่งแยก)
                    </div>
                    {view.emptyParts.length > 0 && (
                      <div className="mt-1.5">
                        กลุ่มที่ไม่มีผู้ป่วยเลยในช่วงนี้:{' '}
                        {view.emptyParts.map(part => GROUP_LABEL[part].short).join(' · ')} —
                        หมายความว่าไม่มีการลงรหัสกลุ่มนั้นเป็นโรคหลัก ไม่ใช่ข้อมูลหาย
                      </div>
                    )}
                  </div>
                }
              />

              <div className="grid gap-4 xl:grid-cols-2">
                <Panel
                  title={`ผู้ป่วยแยกตามชนิด ตาม${periodTitle}`}
                  desc="แท่งซ้อนตามชนิด — ความสูงรวมคือผู้ป่วยกล้ามเนื้อหัวใจตายทั้งหมดในช่วงนั้น"
                >
                  <StackChart points={view.timeline} series={view.typeSeries} />
                </Panel>

                <Panel
                  title={`ผู้ป่วยและการเสียชีวิตของแต่ละชนิด · ${rangeLabel}`}
                  desc="แท่งบนคือผู้ป่วยของชนิดนั้น แท่งล่างคือจำนวนที่เสียชีวิต — ชี้ที่แท่งเพื่อดูอัตรา"
                >
                  {view.typeBars.length > 0 ? (
                    <GroupChart points={view.typeBars} />
                  ) : (
                    <Empty
                      description={
                        <span className="text-xs text-ink-3">ไม่มีผู้ป่วยในช่วงนี้</span>
                      }
                    />
                  )}
                </Panel>
              </div>

              <section className="mt-4 rounded-2xl border border-line bg-panel p-4 backdrop-blur">
                <div className="mb-3 text-sm font-semibold text-ink">
                  ตารางรายรหัสที่ลงเป็นโรคหลัก {rangeLabel}
                </div>
                <Table<CardiacCode>
                  size="small"
                  rowKey="code"
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                  dataSource={view.codes}
                  columns={[
                    {
                      key: 'code',
                      title: 'รหัส',
                      dataIndex: 'code',
                      render: (code: string) => <span className="text-ink">{code}</span>,
                    },
                    { key: 'name', title: 'ความหมาย', dataIndex: 'name' },
                    {
                      key: 'block',
                      title: 'บล็อก',
                      align: 'center',
                      render: (_, row) => (
                        <span className="text-xs text-ink-3">{IHD_LABEL[row.block].codes}</span>
                      ),
                    },
                    {
                      key: 'group',
                      title: 'นับเข้ากลุ่ม',
                      align: 'center',
                      // รหัสนอกขอบเขตกล้ามเนื้อหัวใจตาย (I20 I24 I25) ได้ group เป็น null
                      // ต้องขึ้นว่าไม่นับเข้ากลุ่มไหน ไม่ใช่โยนไปกลุ่ม "อื่น ๆ" ของ MI
                      render: (_, row) =>
                        row.group == null ? (
                          <span className="text-xs text-ink-3">ไม่ใช่กล้ามเนื้อหัวใจตาย</span>
                        ) : (
                          <Tag
                            className="mr-0!"
                            color={row.group === 'stemi' ? 'volcano' : 'default'}
                          >
                            {GROUP_LABEL[row.group].short}
                          </Tag>
                        ),
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
                        view.allTotals.total > 0
                          ? `${((row.count.total / view.allTotals.total) * 100).toFixed(1)}%`
                          : '—',
                    },
                  ]}
                />
                <div className="mt-2 text-xs text-ink-3">
                  รวม {nf.format(view.allTotals.total)} ราย เสียชีวิต{' '}
                  {nf.format(view.allTotals.dead)} ราย ({pctText(view.allTotals)}) ·
                  อัตราตายรายรหัสไม่ได้ตัดสินผ่าน/ไม่ผ่าน เพราะเกณฑ์นิยามไว้ที่ระดับกลุ่ม
                  STEMI ไม่ใช่รายรหัส และหลายรหัสมีผู้ป่วยหลักหน่วยจนอัตราไม่มีความหมาย
                </div>
              </section>
            </section>

            <section className="mt-2">
              <SectionHead
                title="3 · อัตราป่วยโรคหัวใจขาดเลือด (I20-I25)"
                desc="ขอบเขตที่กว้างกว่าสองส่วนบน — รวมเจ็บเค้นหัวใจและโรคหัวใจขาดเลือดเรื้อรังเข้ามาด้วย"
                hint={
                  <div className="text-xs leading-relaxed">
                    <div>
                      <b>ส่วนนี้ครอบส่วนที่ 1-2 ไว้ทั้งหมด</b> — ช่วง I20-I25 รวม I21-I23
                      ของตัวชี้วัดกล้ามเนื้อหัวใจตายเข้าไว้แล้ว ยอดของสองส่วนจึงไม่ใช่ตัวเลข
                      ที่ไม่เกี่ยวกัน กล้ามเนื้อหัวใจตายเป็นส่วนย่อยของที่นี่ประมาณ 79%
                      ทั้งสองส่วนอ่านจากคิวรีเดียวกัน ยอดจึงขัดกันเองไม่ได้
                    </div>
                    <div className="mt-1.5">
                      <b>คิวรีที่ได้รับมาตกบล็อก I25 ไปทั้งบล็อก</b> — <code>BETWEEN &apos;I20&apos; AND &apos;I25&apos;</code>{' '}
                      เทียบสตริง จึงได้ I25 ตัวเปล่าแต่ไม่ได้ I250-I259 ซึ่งคือโรคหัวใจ
                      ขาดเลือดเรื้อรังทั้งบล็อก ต่างจากกรณี I23x ของส่วนที่ 1 ที่วัดแล้วไม่
                      กระทบอะไรเลย อันนี้กระทบจริงทุกช่วงเวลา หน้านี้นับครบทั้งบล็อก และบอก
                      ส่วนต่างไว้ให้เทียบกับรายงานเดิมได้
                    </div>
                    <div className="mt-1.5">
                      <b>
                        &ldquo;อัตราป่วย&rdquo; ที่นี่คิดต่อผู้ป่วยในหนึ่งพันราย ไม่ใช่ต่อแสน
                        ประชากร
                      </b>{' '}
                      — ตัวชี้วัดระดับชาติคิดต่อประชากร ซึ่ง HIS ไม่มีตัวหารนั้น (ไม่มีทะเบียน
                      ประชากรที่มีมิติปี) การแทนตัวหารนี้เหมือนหน้า COPD ที่เจอข้อจำกัดเดียวกัน
                      · อัตราที่ได้จึงขึ้นกับจำนวนผู้ป่วยในทั้งหมดด้วย ถ้าช่วงไหนรับผู้ป่วยใน
                      น้อยลง อัตรานี้จะสูงขึ้นแม้ผู้ป่วยโรคหัวใจเท่าเดิม ตารางจึงแสดงตัวหาร
                      ไว้ทุกช่วงให้ตรวจได้
                    </div>
                    <div className="mt-1.5">
                      <b>ตัวชี้วัดนี้ไม่มีเกณฑ์มาด้วย</b> จึงไม่ตัดสินผ่าน/ไม่ผ่าน — ต่างจาก
                      ส่วนที่ 1 ที่มีเกณฑ์ร้อยละ 9 ของ STEMI เกณฑ์นั้นเป็นเรื่องอัตราตายของ
                      กลุ่มเดียว เอามาใช้กับอัตราป่วยของขอบเขตนี้ไม่ได้
                    </div>
                    <div className="mt-1.5">
                      สี่บล็อก<b>แบ่งผู้ป่วยออกจากกันหมด</b> ไม่ซ้อนกัน เพราะหนึ่งการนอนมี
                      โรคหลักได้รหัสเดียว ผลรวมจึงเท่ากับยอดทั้งหมดพอดี และวางเป็นแท่งซ้อนได้
                      {view.ihd.emptyBlocks.length > 0 && (
                        <>
                          {' '}
                          · บล็อกที่ไม่มีผู้ป่วยเลยในช่วงนี้:{' '}
                          {view.ihd.emptyBlocks
                            .map(block => `${IHD_LABEL[block].short} (${IHD_LABEL[block].codes})`)
                            .join(' · ')}{' '}
                          — หมายความว่าไม่มีการลงรหัสนั้นเป็นโรคหลัก ไม่ใช่ข้อมูลหาย
                        </>
                      )}
                    </div>
                    <div className="mt-1.5">
                      ตัวหารของอัตราตายคือการนอนโรงพยาบาล (AN) ไม่ใช่จำนวนคน ผู้ป่วยคนเดียว
                      ที่นอนสองครั้งนับสองครั้ง · นับเฉพาะที่ลงเป็น<b>โรคหลัก</b> (diagtype 1)
                      และการเสียชีวิตนับจากประเภทการจำหน่าย 08 กับ 09 เหมือนสองส่วนบน
                    </div>
                  </div>
                }
              />

              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi
                  label={`ผู้ป่วยโรคหัวใจขาดเลือด · ${rangeLabel}`}
                  value={nf.format(view.ihd.totals.total)}
                  hint={
                    view.ihd.missed.total > 0
                      ? `มากกว่าที่คิวรีเดิมนับได้ ${nf.format(view.ihd.missed.total)} ราย (เดิม ${nf.format(view.ihd.asWritten.total)} ราย) เพราะคิวรีเดิมตกบล็อก I25`
                      : 'เท่ากับที่คิวรีเดิมนับได้ — ช่วงนี้ไม่มีผู้ป่วยบล็อก I25'
                  }
                />
                <Kpi
                  label={`อัตราป่วย · ${rangeLabel}`}
                  value={
                    per1000(view.ihd.totals.total, view.ihd.admissions)?.toFixed(1) ?? '—'
                  }
                  hint={`ต่อผู้ป่วยในหนึ่งพันราย — จากผู้ป่วยในทั้งหมด ${nf.format(view.ihd.admissions)} ราย ไม่ใช่ต่อแสนประชากร`}
                />
                <Kpi
                  label={`อัตราตาย · ${rangeLabel}`}
                  value={pctText(view.ihd.totals)}
                  hint={`${nf.format(view.ihd.totals.dead)} จาก ${nf.format(view.ihd.totals.total)} ราย — ตัวชี้วัดนี้ไม่มีเกณฑ์กำหนดไว้`}
                />
                <Kpi
                  label="กล้ามเนื้อหัวใจตายเป็นสัดส่วนเท่าไร"
                  value={
                    view.ihd.totals.total > 0
                      ? `${((view.allTotals.total / view.ihd.totals.total) * 100).toFixed(1)}%`
                      : '—'
                  }
                  hint={`ยอดของส่วนที่ 1 (${nf.format(view.allTotals.total)} ราย) เทียบยอดทั้งขอบเขตนี้ — ส่วนที่ 1 เป็นส่วนย่อยของส่วนนี้`}
                />
              </section>

              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <Panel
                  title={`ผู้ป่วยแยกตามบล็อกรหัส ตาม${periodTitle}`}
                  desc="แท่งซ้อนตามบล็อก — ความสูงรวมคือผู้ป่วยโรคหัวใจขาดเลือดทั้งหมดในช่วงนั้น"
                >
                  <StackChart points={view.timeline} series={view.ihd.series} />
                </Panel>

                <Panel
                  title={`อัตราตายของโรคหัวใจขาดเลือด ตาม${periodTitle}`}
                  desc="ความสูงรวมของแท่งคือผู้ป่วยทั้งขอบเขตนี้ สีแดงคือจำนวนที่เสียชีวิต และเส้นคืออัตราตาย — ตัวชี้วัดนี้ไม่มีเกณฑ์จึงไม่มีเส้นเกณฑ์"
                >
                  <MortalityChart points={view.ihd.trend} target={null} />
                </Panel>
              </div>

              <div className="mt-4">
                <Panel
                  title={`ผู้ป่วยและการเสียชีวิตของแต่ละบล็อก · ${rangeLabel}`}
                  desc="แท่งบนคือผู้ป่วยของบล็อกนั้น แท่งล่างคือจำนวนที่เสียชีวิต — ชี้ที่แท่งเพื่อดูอัตรา"
                >
                  {view.ihd.bars.length > 0 ? (
                    <GroupChart points={view.ihd.bars} />
                  ) : (
                    <Empty
                      description={<span className="text-xs text-ink-3">ไม่มีผู้ป่วยในช่วงนี้</span>}
                    />
                  )}
                </Panel>
              </div>

              <section className="mt-4 rounded-2xl border border-line bg-panel p-4 backdrop-blur">
                <div className="mb-3 text-sm font-semibold text-ink">
                  ตารางอัตราป่วยและอัตราตายของโรคหัวใจขาดเลือด {rangeLabel}
                </div>
                <Table<CardiacPeriod>
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
                      render: (value: string, row: CardiacPeriod) => (
                        <PeriodCell value={value} partial={row.partial} />
                      ),
                    },
                    {
                      key: 'patients',
                      title: 'ผู้ป่วย',
                      align: 'right' as const,
                      render: (_: unknown, row: CardiacPeriod) => nf.format(row.ihdTotal.total),
                    },
                    {
                      key: 'admissions',
                      title: 'ผู้ป่วยในทั้งหมด',
                      align: 'right' as const,
                      render: (_: unknown, row: CardiacPeriod) => nf.format(row.admissions),
                    },
                    {
                      key: 'per1000',
                      title: 'ต่อพันการนอน',
                      align: 'right' as const,
                      render: (_: unknown, row: CardiacPeriod) =>
                        per1000(row.ihdTotal.total, row.admissions)?.toFixed(1) ?? '—',
                    },
                    ...IHD_BLOCKS.filter(block => sumBlock(stats.periods, block).total > 0).map(
                      block => ({
                        key: block,
                        title: IHD_LABEL[block].short,
                        align: 'right' as const,
                        render: (_: unknown, row: CardiacPeriod) => nf.format(row.ihd[block].total),
                      }),
                    ),
                    {
                      key: 'dead',
                      title: 'เสียชีวิต',
                      align: 'right' as const,
                      render: (_: unknown, row: CardiacPeriod) => nf.format(row.ihdTotal.dead),
                    },
                    {
                      key: 'rate',
                      title: 'อัตราตาย',
                      align: 'right' as const,
                      render: (_: unknown, row: CardiacPeriod) => (
                        <RateCell
                          count={row.ihdTotal}
                          // ตัวชี้วัดนี้ไม่มีเกณฑ์ จึงไม่ระบายสีผ่าน/ไม่ผ่าน
                          target={null}
                          previous={comparable(row, view.previousOf.get(row.key)?.ihdTotal ?? null)}
                        />
                      ),
                    },
                  ]}
                />
                <div className="mt-2 text-xs text-ink-3">
                  คอลัมน์บล็อกบวกกันได้เท่าคอลัมน์ผู้ป่วยพอดี เพราะหนึ่งการนอนมีโรคหลักได้
                  รหัสเดียว · <b>ต่อพันการนอนไม่ใช่ต่อแสนประชากร</b> ตัวหารคือคอลัมน์ผู้ป่วยใน
                  ทั้งหมดที่แสดงไว้ข้าง ๆ ซึ่งแสดงไว้เพราะอัตราขยับได้จากตัวหารเปลี่ยนโดยที่
                  ผู้ป่วยโรคหัวใจเท่าเดิม · ไม่มีคอลัมน์ไหนตัดสินผ่าน/ไม่ผ่าน เพราะตัวชี้วัดนี้
                  ไม่มีเกณฑ์กำหนดมา
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
