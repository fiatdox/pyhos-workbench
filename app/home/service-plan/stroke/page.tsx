'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ยังทำที่ app/home/layout.tsx ซึ่งเป็น Server Component)
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Alert, Breadcrumb, Button, Empty, Select, Spin, Table, Tag, Typography } from 'antd'
import {
  AlertOutlined,
  ArrowLeftOutlined,
  EnvironmentOutlined,
} from '@ant-design/icons'
import { apiFetch } from '@/lib/client/session'
import type { StrokeCount, StrokeStats, StrokeStatsPeriod } from '@/lib/his/stroke-stats'
import { BlockSkeleton, StatCardsSkeleton, TableRowsSkeleton } from '@/app/home/skeletons'
import PageHint from '../../page-hint'
import {
  comparable,
  Kpi,
  NumberCell,
  Panel,
  PeriodCell,
  PeriodPicker,
  periodLabel,
  pctText,
  rangeLabelOf,
  RateCell,
  rateOf,
  SectionHead,
  nf,
  verdictOf,
  type QuarterChoice,
} from '../ui'
import {
  AreaChart,
  MortalityChart,
  ResourceChart,
  VolumeChart,
  type MortalityPoint,
  type ResourcePoint,
  type VolumePoint,
} from '../charts'

const { Title } = Typography

/**
 * Service Plan สาขาโรคหลอดเลือดสมอง — สถิติผู้ป่วยในย้อนหลังห้าปีงบ
 *
 * หน้าเดียวตอบสามคำถามที่ต่อกันเป็นเรื่องเดียว: ผู้ป่วยรอดหรือไม่ (อัตราตาย) ·
 * ระหว่างนอนเกิดอะไรขึ้นบ้าง (ภาวะแทรกซ้อน) · ใช้ทรัพยากรไปเท่าไร (วันนอนและ
 * ค่าบริการ) เรียงจากผลลัพธ์ไปหาต้นทุน ไม่ใช่เรียงตามว่าคิวรีไหนเขียนก่อน
 *
 * สามตัวชี้วัดที่มีเกณฑ์: ทั้งกลุ่ม I60-I68 ไม่เกิน 7% · ชนิดเลือดออก
 * I60-I62 ไม่เกิน 25% · ชนิดตีบ/อุดตัน I63-I68 ไม่เกิน 5%
 *
 * เกณฑ์อยู่ที่ไฟล์นี้ ไม่ได้อยู่ในโมดูลคิวรี เพราะโมดูลนั้นเป็น server-only และ
 * เกณฑ์ไม่มีผลต่อการนับเลย มีผลแต่กับการระบายสีผ่าน/ไม่ผ่าน ถ้าวันหนึ่งเกณฑ์
 * ต้องให้คณะกรรมการแก้เองได้ ที่ของมันคือตารางค่าตั้ง ไม่ใช่ค่าคงที่ตรงนี้
 *
 * ภาวะแทรกซ้อน วันนอน และค่าบริการยังไม่มีเกณฑ์ที่ตกลงกันไว้ จึงไม่ตัดสิน
 * ผ่าน/ไม่ผ่าน แสดงเป็นแนวโน้มอย่างเดียว — และตัวหารของภาวะแทรกซ้อนคือผู้ป่วย
 * ที่มีภาวะนั้น ไม่ใช่ผู้ป่วย stroke ทั้งหมด
 *
 * ไม่มีข้อมูลรายบุคคลในหน้านี้ ตัวเลขทุกตัวเป็นผลรวมรายปีที่นับมาจากฐานข้อมูล
 */

/** ค่าเฉลี่ยต่อราย — null เมื่อช่วงนั้นไม่มีผู้ป่วย จะได้ไม่หารด้วยศูนย์ */
const perPatient = (total: number, patients: number): number | null =>
  patients > 0 ? total / patients : null

/** ค่าเฉลี่ยต่อรายของช่วงก่อนหน้า — undefined/null ทั้งคู่แปลว่าไม่มีช่วงก่อนให้เทียบ */
const previousPerPatient = (
  previous: StrokeStatsPeriod | null | undefined,
  field: 'stayDays' | 'charge',
): number | null => (previous == null ? null : perPatient(previous[field], previous.all.total))

const TARGET_ALL = 7
const TARGET_HEMORRHAGIC = 25
const TARGET_ISCHEMIC = 5

/** ค่าของตัวเลือก "ทุกอำเภอ" — รหัสอำเภอเป็นตัวเลขสองหลัก จึงชนกันไม่ได้ */
const ALL_DISTRICTS = 'all'

export default function ServicePlanStrokePage() {
  const [stats, setStats] = useState<StrokeStats | null>(null)
  /**
   * ปีงบที่เจาะดู — null คือมุมมองเทียบรายปีงบ
   *
   * เก็บเป็น state ของหน้า ไม่ได้อ่านย้อนจาก stats ที่ได้กลับมา เพราะระหว่างรอ
   * คำตอบรอบใหม่ stats ยังเป็นของรอบก่อน ตัวเลือกบนจอจะกระพริบกลับไปค่าเก่า
   */
  const [fiscalYear, setFiscalYear] = useState<number | null>(null)
  const [quarter, setQuarter] = useState<QuarterChoice>(0)
  /** อำเภอที่กำลังเจาะดูรายตำบล — null คือดูทุกอำเภอ */
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
          `/api/his/service-plan/stroke${query === '' ? '' : `?${query}`}`,
        )
        const json = await res.json()
        if (!alive) return
        if (!res.ok || !json.success) {
          setStats(null)
          setError(json.message ?? 'ดึงข้อมูลสถิติไม่สำเร็จ')
          return
        }
        setStats(json.stats as StrokeStats)
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

  /** หัวคอลัมน์แรกของทุกตาราง — เปลี่ยนตามมุมมองที่เลือก */
  const periodTitle = fiscalYear == null ? 'ปีงบ' : 'เดือน'

  const rangeLabel = rangeLabelOf(fiscalYear, quarter)

  const view = useMemo(() => {
    if (!stats || stats.periods.length === 0) return null
    /**
     * "ปีล่าสุด" ของการ์ดสรุปคือปีงบที่ปิดแล้ว ไม่ใช่ปีที่กำลังเดินอยู่
     *
     * ปีที่เดินอยู่มีอยู่ในกราฟและตารางด้วย แต่ตัดสินผ่าน/ไม่ผ่านจากมันไม่ได้ —
     * ต้นปีงบมีผู้ป่วยไม่กี่รายและเวชระเบียนยังลงรหัสไม่ทัน ร้อยละที่ได้จึงแกว่ง
     * สุดขั้ว ถ้าเอามาขึ้นการ์ดใหญ่จะกลายเป็นตัวเลขที่ผิดอยู่ทุกต้นปี
     */
    const closed = stats.periods.filter(period => !period.partial)
    const latest = closed[closed.length - 1] ?? stats.periods[stats.periods.length - 1]
    /** ช่วงที่กำลังเดินอยู่ — null เมื่อไม่มีแถวของมัน */
    const running = stats.periods.find(period => period.partial) ?? null
    const point = (pick: (year: StrokeStatsPeriod) => StrokeCount) =>
      stats.periods.map<MortalityPoint>(year => {
        const count = pick(year)
        return {
          label: periodLabel(year.key).short,
          title: periodLabel(year.key).full,
          partial: year.partial,
          percent: rateOf(count),
          dead: count.dead,
          total: count.total,
        }
      })
    const volume = stats.periods.map<VolumePoint>(year => ({
      label: periodLabel(year.key).short,
      title: periodLabel(year.key).full,
      partial: year.partial,
      hemorrhagic: year.hemorrhagic.total,
      ischemic: year.ischemic.total,
      // ตกลงแล้วว่า I62x นับเข้ากลุ่มเลือดออก สองกลุ่มย่อยจึงแบ่งทั้งกลุ่มได้หมด
      // และค่านี้ต้องเป็นศูนย์เสมอ — เก็บไว้เป็นตัวจับความผิดปกติ ถ้าวันหนึ่งมีรหัส
      // ใหม่โผล่มาในขอบเขตแต่ไม่เข้ากลุ่มย่อยไหน จะเห็นเป็นแถบขึ้นมาทันที
      // ไม่ใช่หายไปเงียบ ๆ จนสองกลุ่มย่อยบวกกันไม่เท่าทั้งกลุ่มโดยไม่มีใครรู้
      other: Math.max(year.all.total - year.hemorrhagic.total - year.ischemic.total, 0),
    }))
    /**
     * ค่าเฉลี่ยต่อรายของยอดรวมรายปี
     *
     * หารที่หน้าจอ ไม่ได้ให้ฐานข้อมูลหารมาให้ เพราะต้องแสดงทั้งยอดรวมและค่าเฉลี่ย
     * อยู่แล้ว ส่งมาค่าเดียวแล้วคูณกลับจะได้เลขที่เพี้ยนจากการปัดเศษ
     */
    const resource = (pick: (year: StrokeStatsPeriod) => number) =>
      stats.periods.map<ResourcePoint>(year => ({
        label: periodLabel(year.key).short,
        title: periodLabel(year.key).full,
        partial: year.partial,
        average: year.all.total > 0 ? pick(year) / year.all.total : null,
        total: pick(year),
        patients: year.all.total,
      }))
    /** สัดส่วนผู้ป่วย stroke ที่เกิดภาวะนั้น — ตัวหารคือผู้ป่วยทั้งกลุ่มของปีเดียวกัน */
    const share = (count: StrokeCount, year: StrokeStatsPeriod) =>
      year.all.total > 0 ? (count.total / year.all.total) * 100 : null
    return {
      latest,
      running,
      all: point(year => year.all),
      hemorrhagic: point(year => year.hemorrhagic),
      ischemic: point(year => year.ischemic),
      pneumonia: point(year => year.pneumonia),
      uti: point(year => year.uti),
      volume,
      pneumoniaShare: share(latest.pneumonia, latest),
      utiShare: share(latest.uti, latest),
      /** รวมทั้งช่วงของปอดอักเสบสองนิยาม ใช้เป็นหลักฐานในหมายเหตุ */
      pneumoniaFive: stats.periods.reduce((sum, year) => sum + year.pneumonia.total, 0),
      pneumoniaOtherFive: stats.periods.reduce((sum, year) => sum + year.pneumoniaOther.total, 0),
      stay: resource(year => year.stayDays),
      charge: resource(year => year.charge),
      /** ค่าเฉลี่ยของปีล่าสุด แยกออกมาเป็นตัวแปรเพื่อให้ TypeScript แคบชนิดได้ครั้งเดียว */
      stayAvg: latest.all.total > 0 ? latest.stayDays / latest.all.total : null,
      chargeAvg: latest.all.total > 0 ? latest.charge / latest.all.total : null,
      /** รายที่นอนเกินสามสิบวันของปีล่าสุด ใช้เตือนว่าค่าเฉลี่ยถูกดึง */
      stayOver30: latest.stayOver30,
      stayMax: latest.stayMax,
      /**
       * ปีงบก่อนหน้าของแต่ละปี ใช้ทำลูกศรเทียบในตาราง
       *
       * ทำเป็นตารางค้นแทนการอ่านแถวถัดไปในตาราง เพราะตารางเรียงจากปีล่าสุดลงมา
       * การอ่าน "แถวถัดไป" จะไปผูกกับลำดับการแสดงผล ถ้าวันหนึ่งเปลี่ยนการเรียง
       * ลูกศรจะกลับทิศทั้งตารางโดยไม่มีอะไรเตือน
       */
      previousOf: new Map(
        stats.periods.map((period, index) => [
          period.key,
          index > 0 ? stats.periods[index - 1] : null,
        ]),
      ),
      /** ป้ายของช่วงล่าสุดที่ปิดแล้ว ใช้กำกับการ์ดสรุปทุกใบ */
      latestLabel: periodLabel(latest.key).full,
      areas: (() => {
        const inProvince = stats.areas.total - stats.areas.outside
        const selected = stats.areas.districts.find(item => item.id === district) ?? null
        return {
          inProvince,
          provinceShare: stats.areas.total > 0 ? (inProvince / stats.areas.total) * 100 : null,
          top: stats.areas.districts[0] ?? null,
          topShare:
            inProvince > 0 && stats.areas.districts[0] != null
              ? (stats.areas.districts[0].patients / inProvince) * 100
              : null,
          tambonCount: stats.areas.districts.reduce(
            (sum, item) => sum + item.tambons.length,
            0,
          ),
          selected,
          // กราฟแท่งนอนของ Highcharts เรียงจากล่างขึ้นบน ถ้าส่งเรียงมากไปน้อย
          // แท่งที่มากที่สุดจะไปอยู่ล่างสุด จึงกลับลำดับก่อนส่ง
          points: (selected == null
            ? stats.areas.districts.map(item => ({
                id: item.id,
                name: item.name,
                patients: item.patients,
              }))
            : selected.tambons.map(item => ({
                id: item.id,
                name: item.name,
                patients: item.patients,
              }))
          )
            .slice()
            .reverse(),
        }
      })(),
    }
  }, [stats, district])

  return (
    <>
      <section className="mb-6">
        <Breadcrumb
          className="mb-2"
          items={[
            { title: <Link href="/home/service-plan">Service Plan</Link> },
            { title: 'สาขาโรคหลอดเลือดสมอง' },
          ]}
        />
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          <AlertOutlined /> สาขาโรคหลอดเลือดสมอง (Stroke)
          <PageHint>
            สถิติผู้ป่วยในโรคหลอดเลือดสมองย้อนหลังห้าปีงบประมาณ นับจากการวินิจฉัยหลักรหัส
            I60-I68 ของผู้ป่วยที่จำหน่ายในปีงบนั้น — อัตราตายเทียบเกณฑ์ ภาวะแทรกซ้อน
            Pneumonia และ UTI ระหว่างนอน วันนอนเฉลี่ย และค่าบริการเฉลี่ยต่อราย
            ไม่มีข้อมูลรายบุคคลในหน้านี้
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
                  {view.running.all.total === 0
                    ? `ยังไม่มีผู้ป่วยโรคหลอดเลือดสมองของ${periodLabel(view.running.key).full} ที่ลงรหัสการวินิจฉัยหลักแล้ว`
                    : `${periodLabel(view.running.key).full} มีผู้ป่วยที่ลงรหัสแล้ว ${nf.format(view.running.all.total)} ราย`}
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
                title="1 · อัตราตายเทียบเกณฑ์"
                desc="ร้อยละของผู้ป่วยในที่จำหน่ายด้วยสถานะเสียชีวิต ต่อผู้ป่วยในของกลุ่มรหัสนั้นในช่วงเดียวกัน"
                hint={
                  <div className="text-xs leading-relaxed">
                      <div>
                        ตัวหาร = ผู้ป่วยใน (AN ไม่ซ้ำ) ที่จำหน่ายในปีงบนั้น และมีการวินิจฉัยหลัก
                        (diagtype = 1) รหัส I60-I68 · ตัวตั้ง = ในกลุ่มนั้นที่ประเภทการจำหน่ายเป็น
                        08 หรือ 09 · ปีงบประมาณนับตามวันจำหน่าย 1 ต.ค. ถึง 30 ก.ย. · กลุ่มย่อย
                        เลือดออก I60-I62 และตีบ/อุดตัน I63-I68
                      </div>
                      <div className="mt-1.5">
                        รหัส I690-I699 (อาการหลงเหลือจากโรคหลอดเลือดสมอง) ไม่ถูกนับ เพราะไม่ใช่
                        การเกิดโรคครั้งใหม่
                      </div>
                      <div className="mt-1.5">
                        กราฟและตารางมีห้าปีงบที่ปิดแล้ว บวกปีที่กำลังเดินอยู่ซึ่งทำเครื่องหมาย
                        ดอกจันไว้ ปีนั้นยังนับไม่ครบเพราะการลงรหัสโรคตามหลังวันจำหน่าย
                        {stats.coding && stats.coding.discharged > 0 && (
                          <>
                            {' '}
                            — เดือนที่กำลังเดินอยู่ ({stats.coding.month}) ลงรหัสหลักแล้ว{' '}
                            {nf.format(stats.coding.coded)} จาก {nf.format(stats.coding.discharged)} ราย
                            ({Math.round((stats.coding.coded / stats.coding.discharged) * 100)}%)
                            ตัวเลขของช่วงล่าสุดจึงยังขยับได้อีก
                          </>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <Tag>ipt · iptdiag</Tag>
                        <Tag>diagtype = 1</Tag>
                        <Tag>dchtype 08, 09</Tag>
                      </div>
                    </div>
                }
              />
            </section>

            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi
                label={`ทั้งกลุ่ม I60-I68 · ${view.latestLabel}`}
                value={pctText(view.latest.all)}
                hint={`เสียชีวิต ${nf.format(view.latest.all.dead)} จาก ${nf.format(view.latest.all.total)} ราย · เกณฑ์ไม่เกิน ${TARGET_ALL}%`}
                verdict={verdictOf(view.latest.all, TARGET_ALL)}
              />
              <Kpi
                label={`เลือดออก I60-I62 · ${view.latestLabel}`}
                value={pctText(view.latest.hemorrhagic)}
                hint={`เสียชีวิต ${nf.format(view.latest.hemorrhagic.dead)} จาก ${nf.format(view.latest.hemorrhagic.total)} ราย · เกณฑ์ไม่เกิน ${TARGET_HEMORRHAGIC}%`}
                verdict={verdictOf(view.latest.hemorrhagic, TARGET_HEMORRHAGIC)}
              />
              <Kpi
                label={`ตีบ/อุดตัน I63-I68 · ${view.latestLabel}`}
                value={pctText(view.latest.ischemic)}
                hint={`เสียชีวิต ${nf.format(view.latest.ischemic.dead)} จาก ${nf.format(view.latest.ischemic.total)} ราย · เกณฑ์ไม่เกิน ${TARGET_ISCHEMIC}%`}
                verdict={verdictOf(view.latest.ischemic, TARGET_ISCHEMIC)}
              />
              <Kpi
                label={`ผู้ป่วยในทั้งกลุ่ม · ${rangeLabel}`}
                value={nf.format(stats.periods.reduce((sum, period) => sum + period.all.total, 0))}
                hint={`จำหน่าย ${stats.from} ถึง ${stats.to}`}
              />
            </section>

            <div className="grid gap-4 xl:grid-cols-2">
              <Panel
                title={`อัตราตายทั้งกลุ่ม I60-I68 · เกณฑ์ไม่เกิน ${TARGET_ALL}%`}
                desc="ร้อยละของผู้ป่วยในที่จำหน่ายด้วยสถานะเสียชีวิต ต่อผู้ป่วยในทั้งหมดของกลุ่มโรคในปีงบนั้น"
              >
                <MortalityChart points={view.all} target={TARGET_ALL} />
              </Panel>
              <Panel
                title={`อัตราตายชนิดเลือดออก I60-I62 · เกณฑ์ไม่เกิน ${TARGET_HEMORRHAGIC}%`}
                desc="กลุ่มเลือดออกใต้เยื่อหุ้มสมอง ในเนื้อสมอง และเลือดออกในสมองแบบอื่น"
              >
                <MortalityChart points={view.hemorrhagic} target={TARGET_HEMORRHAGIC} />
              </Panel>
              <Panel
                title={`อัตราตายชนิดตีบ/อุดตัน I63-I68 · เกณฑ์ไม่เกิน ${TARGET_ISCHEMIC}%`}
                desc="กลุ่มสมองขาดเลือด หลอดเลือดตีบหรืออุดตัน และโรคหลอดเลือดสมองอื่นที่ไม่ใช่ชนิดเลือดออก"
              >
                <MortalityChart points={view.ischemic} target={TARGET_ISCHEMIC} />
              </Panel>
              <Panel
                title="จำนวนผู้ป่วยในรายช่วง"
                hint={
                  <div className="text-xs leading-relaxed">
                    <div>
                      <b>สองกลุ่มย่อยบวกกันได้เท่าทั้งกลุ่มพอดี</b> — I620-I629 (เลือดออกใน
                      กะโหลกศีรษะแบบที่ไม่ได้เกิดจากอุบัติเหตุ) นับเข้ากลุ่มเลือดออกแล้วตามที่
                      ตกลงกันไว้ ห้าปีเพิ่มกลุ่มเลือดออกขึ้น 226 ราย (+14%) ก่อนหน้านี้ช่วงรหัส
                      เขียนด้วย BETWEEN ซึ่งเทียบแบบตัวอักษร รหัสลูกของขอบบนจึงตกหายไปอยู่
                      กลุ่ม &ldquo;อื่น ๆ&rdquo; ตอนนี้กลุ่มนั้นเป็นศูนย์โดยโครงสร้าง
                      {view.volume.length > 0 &&
                        Math.max(...view.volume.map(point => point.other)) > 0 && (
                          <>
                            {' '}
                            — <b>แต่ช่วงนี้ยังเหลืออยู่ถึง{' '}
                            {Math.max(...view.volume.map(point => point.other))} ราย</b> ซึ่ง
                            หมายความว่ามีรหัสใหม่ในขอบเขตที่ยังไม่เข้ากลุ่มย่อยไหน ควรแจ้งให้ตรวจ
                          </>
                        )}
                    </div>
                    <div className="mt-1.5">
                      รหัส I690-I699 (อาการหลงเหลือจากโรคหลอดเลือดสมอง) อยู่นอกขอบเขตของหน้านี้
                      โดยเจตนา ห้าปีมี 53 การนอน — ไม่ใช่การเกิดโรคครั้งใหม่ ถ้านับเข้ามาจะ
                      เจือจางอัตราตายของ stroke เฉียบพลัน
                    </div>
                  </div>
                }
                desc="ความสูงรวมคือผู้ป่วยในทั้งกลุ่มโรค แยกสีตามชนิด — อัตราที่ทรงตัวบนฐานผู้ป่วยที่โตขึ้นไม่ใช่เรื่องเดียวกับฐานเท่าเดิม"
              >
                <VolumeChart points={view.volume} />
              </Panel>
            </div>

            <section className="rounded-2xl border border-line bg-panel p-4 backdrop-blur">
              <div className="mb-3 text-sm font-semibold text-ink">ตาราง{rangeLabel}</div>
              <Table
                size="small"
                rowKey="key"
                pagination={false}
                scroll={{ x: 'max-content' }}
                // ตารางเรียงจากปีล่าสุดลงไป ต่างจากกราฟที่ไล่ซ้ายไปขวาตามเวลา —
                // กราฟเล่าแนวโน้ม แต่ตารางเปิดมาเพื่อดูเลขของปีล่าสุดก่อน
                // คัดลอกก่อน reverse เพราะ reverse แก้อาร์เรย์เดิม ซึ่งเป็นตัวเดียว
                // กับที่กราฟใช้อยู่ ถ้าแก้ตรง ๆ กราฟจะกลับด้านตามไปด้วย
                dataSource={[...stats.periods].reverse()}
                columns={[
                  {
                    key: 'year',
                    title: periodTitle,
                    dataIndex: 'key',
                    render: (value: string, row) => <PeriodCell value={value} partial={row.partial} />,
                  },
                  {
                    key: 'total',
                    title: 'ผู้ป่วยในทั้งกลุ่ม',
                    align: 'right',
                    render: (_, row) => nf.format(row.all.total),
                  },
                  {
                    key: 'dead',
                    title: 'เสียชีวิต',
                    align: 'right',
                    render: (_, row) => nf.format(row.all.dead),
                  },
                  {
                    key: 'rate-all',
                    title: `อัตราตายทั้งกลุ่ม (เกณฑ์ ≤ ${TARGET_ALL}%)`,
                    align: 'right',
                    render: (_, row) => <RateCell count={row.all} target={TARGET_ALL} />,
                  },
                  {
                    key: 'rate-hemorrhagic',
                    title: `เลือดออก I60-I62 (เกณฑ์ ≤ ${TARGET_HEMORRHAGIC}%)`,
                    align: 'right',
                    render: (_, row) => (
                      <RateCell count={row.hemorrhagic} target={TARGET_HEMORRHAGIC} />
                    ),
                  },
                  {
                    key: 'rate-ischemic',
                    title: `ตีบ/อุดตัน I63-I68 (เกณฑ์ ≤ ${TARGET_ISCHEMIC}%)`,
                    align: 'right',
                    render: (_, row) => <RateCell count={row.ischemic} target={TARGET_ISCHEMIC} />,
                  },
                ]}
              />
            </section>

            {/* ภาวะแทรกซ้อนเป็นคนละคำถามกับอัตราตายของโรค จึงแยกเป็นอีกส่วนหนึ่ง
                ไม่ใช่การ์ดใบที่สี่ในแถวบน — ตัวหารคนละตัว และคนที่ดูก็คนละรอบกัน */}
            <section className="mt-2">
              <SectionHead
                title="2 · ภาวะแทรกซ้อนระหว่างนอนโรงพยาบาล"
                desc="นับจากโรคร่วม (การวินิจฉัยที่ไม่ใช่โรคหลัก) ของผู้ป่วยที่โรคหลักเป็นโรคหลอดเลือดสมอง อัตราตายคิดจากผู้ป่วยที่มีภาวะนั้นเป็นตัวหาร ไม่ใช่ผู้ป่วย stroke ทั้งหมด"
                hint={
                  <div className="text-xs leading-relaxed">
                      <div>
                        J69x คือปอดอักเสบจากการสำลักเท่านั้น ส่วนผู้ป่วย stroke ที่ลงรหัสปอดอักเสบ
                        แบบอื่น (J12-J18) ไม่ถูกนับ — ห้าปีที่ผ่านมามี{' '}
                        {nf.format(view.pneumoniaFive)} ราย กับ {nf.format(view.pneumoniaOtherFive)} ราย
                        ตามลำดับ ตัวเลขจึงต่างกันราวสามเท่าแล้วแต่เลือกนิยามไหน หน้านี้แสดงกลุ่ม
                        J12-J18 ไว้เป็นการ์ดและคอลัมน์แยก ถ้าคณะกรรมการตัดสินว่าตัวชี้วัดควรรวม
                        ทั้งสองกลุ่ม แจ้งได้ จะรวมให้เป็นตัวเดียว
                      </div>
                      <div className="mt-1.5">
                        อีกข้อที่ต้องระวังคือตัวหารของสองภาวะนี้เล็ก (หลักสิบถึงหลักห้าสิบต่อปี)
                        ผู้เสียชีวิตเพิ่มหรือลดหนึ่งรายขยับร้อยละได้หลายจุด การอ่านแนวโน้มจึงควรดู
                        จำนวนรายที่เป็นความสูงของแท่งควบคู่ไปกับเส้นร้อยละเสมอ
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <Tag>โรคร่วม diagtype ≠ 1</Tag>
                        <Tag>J690 92 ราย</Tag>
                        <Tag>N390 259 ราย</Tag>
                      </div>
                    </div>
                }
              />

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi
                  label={`อัตราตายเมื่อมี Pneumonia · ${view.latestLabel}`}
                  value={pctText(view.latest.pneumonia)}
                  hint={`เสียชีวิต ${nf.format(view.latest.pneumonia.dead)} จาก ${nf.format(view.latest.pneumonia.total)} ราย${
                    view.pneumoniaShare == null
                      ? ''
                      : ` · พบใน ${view.pneumoniaShare.toFixed(1)}% ของผู้ป่วย stroke`
                  }`}
                />
                <Kpi
                  label={`อัตราตายเมื่อมี UTI · ${view.latestLabel}`}
                  value={pctText(view.latest.uti)}
                  hint={`เสียชีวิต ${nf.format(view.latest.uti.dead)} จาก ${nf.format(view.latest.uti.total)} ราย${
                    view.utiShare == null
                      ? ''
                      : ` · พบใน ${view.utiShare.toFixed(1)}% ของผู้ป่วย stroke`
                  }`}
                />
                <Kpi
                  label="อัตราตายของผู้ป่วย stroke ทั้งกลุ่ม"
                  value={pctText(view.latest.all)}
                  hint="ไว้เทียบว่าภาวะแทรกซ้อนทำให้อัตราตายต่างจากภาพรวมแค่ไหน"
                />
                <Kpi
                  label="ปอดอักเสบรหัสอื่น J12-J18"
                  value={pctText(view.latest.pneumoniaOther)}
                  hint={`เสียชีวิต ${nf.format(view.latest.pneumoniaOther.dead)} จาก ${nf.format(view.latest.pneumoniaOther.total)} ราย · ไม่ได้อยู่ในตัวชี้วัด Pneumonia ข้างซ้าย`}
                />
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <Panel
                  title="Pneumonia (J69x) ในผู้ป่วย Stroke"
                  desc="ปอดอักเสบจากการสำลัก — ความสูงรวมคือผู้ป่วย stroke ที่มีภาวะนี้ในปีนั้น"
                >
                  <MortalityChart points={view.pneumonia} target={null} />
                </Panel>
                <Panel
                  title="UTI (N39x) ในผู้ป่วย Stroke"
                  desc="ติดเชื้อทางเดินปัสสาวะ — ความสูงรวมคือผู้ป่วย stroke ที่มีภาวะนี้ในปีนั้น"
                >
                  <MortalityChart points={view.uti} target={null} />
                </Panel>
              </div>

              <section className="mt-4 rounded-2xl border border-line bg-panel p-4 backdrop-blur">
                <div className="mb-3 text-sm font-semibold text-ink">
                  ตารางภาวะแทรกซ้อน {rangeLabel}
                </div>
                <Table
                  size="small"
                  rowKey="key"
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                  dataSource={[...stats.periods].reverse()}
                  columns={[
                    {
                      key: 'year',
                      title: periodTitle,
                      dataIndex: 'key',
                      render: (value: string, row) => <PeriodCell value={value} partial={row.partial} />,
                    },
                    {
                      key: 'stroke',
                      title: 'ผู้ป่วย stroke',
                      align: 'right',
                      render: (_, row) => (
                        <NumberCell
                          value={row.all.total}
                          previous={comparable(row, view.previousOf.get(row.key)?.all.total ?? null)}
                          goal="none"
                        />
                      ),
                    },
                    {
                      key: 'pneumonia',
                      title: 'Pneumonia (J69x)',
                      align: 'right',
                      render: (_, row) => (
                        <RateCell
                          count={row.pneumonia}
                          target={null}
                          previous={comparable(row, view.previousOf.get(row.key)?.pneumonia ?? null)}
                        />
                      ),
                    },
                    {
                      key: 'uti',
                      title: 'UTI (N39x)',
                      align: 'right',
                      render: (_, row) => (
                        <RateCell
                          count={row.uti}
                          target={null}
                          previous={comparable(row, view.previousOf.get(row.key)?.uti ?? null)}
                        />
                      ),
                    },
                    {
                      key: 'pneumonia-other',
                      title: 'ปอดอักเสบรหัสอื่น (J12-J18)',
                      align: 'right',
                      render: (_, row) => (
                        <RateCell
                          count={row.pneumoniaOther}
                          target={null}
                          previous={comparable(row, view.previousOf.get(row.key)?.pneumoniaOther ?? null)}
                        />
                      ),
                    },
                  ]}
                />
                <div className="mt-2 text-xs text-ink-3">
                  ตัวเลขในช่องคือร้อยละการเสียชีวิต เศษส่วนใต้ร้อยละคือ เสียชีวิต/ผู้ป่วยที่มีภาวะนั้น
                  และบรรทัดล่างสุดคือส่วนต่างจากปีงบก่อนหน้า — เขียวคือดีขึ้น แดงคือแย่ลง
                  เทาคือตัวเลขที่ขึ้นลงไม่ได้แปลว่าดีหรือแย่
                </div>
              </section>
            </section>

            {/* ทรัพยากรที่ใช้ — คนละหน่วยกับสองส่วนบน (วันกับบาท ไม่ใช่ร้อยละ)
                และไม่มีเกณฑ์ จึงไม่มีสีผ่าน/ไม่ผ่านในส่วนนี้เลย */}
            <section className="mt-2">
              <SectionHead
                title="3 · วันนอนและค่าบริการ"
                desc="วันนอนนับจาก an_stat (วันจำหน่ายลบวันรับไว้) และค่าบริการคือยอดค่ารักษาทั้งหมดของการนอนครั้งนั้น ทั้งคู่หารด้วยจำนวนผู้ป่วยของช่วงเดียวกัน"
                hint={
                  <div className="text-xs leading-relaxed">
                      <div>
                        วันนอนใช้ an_stat.admdate (จำนวนวัน ตรงกับวันจำหน่ายลบวันรับไว้) ครบทุกราย
                        ของผู้ป่วย stroke ทั้งห้าปี ส่วนค่าบริการใช้ an_stat.item_money ซึ่งเป็นยอด
                        ค่ารักษาทั้งหมดของการนอนครั้งนั้น ไม่ใช่ยอดที่เรียกเก็บได้จริงและไม่ใช่
                        ยอดที่กองทุนจ่าย
                      </div>
                      <div className="mt-1.5">
                        ยอดนี้เทียบกับการไล่รวม opitemrece ทีละรายการแล้วต่างกันไม่เกิน 0.05%
                        แต่เร็วกว่ามาก (0.15 วินาที เทียบกับ 8.7 วินาที เพราะ opitemrece มี 31
                        ล้านแถว) หน้านี้จึงเลือกทางที่เร็วกว่า ถ้าต้องการยอดที่แยกเป็นหมวดค่าใช้จ่าย
                        ต้องกลับไปไล่ opitemrece และควรทำเป็นรายงานที่กดสั่งเอง ไม่ใช่โหลดพร้อมหน้า
                      </div>
                      <div className="mt-1.5">
                        ค่าเฉลี่ยทั้งสองตัวถูกดึงด้วยรายที่นอนยาว — ปีล่าสุดมีรายที่นอนถึง{' '}
                        {nf.format(view.stayMax)} วัน และ {nf.format(view.stayOver30)} รายที่นอนเกิน
                        30 วัน ตัวเลขเฉลี่ยจึงสูงกว่าที่ผู้ป่วยส่วนใหญ่เจอจริง
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <Tag>an_stat.admdate</Tag>
                        <Tag>an_stat.item_money</Tag>
                      </div>
                    </div>
                }
              />

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi
                  label={`วันนอนเฉลี่ย · ${view.latestLabel}`}
                  value={view.stayAvg == null ? '—' : `${view.stayAvg.toFixed(2)} วัน`}
                  hint={`รวม ${nf.format(view.latest.stayDays)} วันนอน จากผู้ป่วย ${nf.format(view.latest.all.total)} ราย`}
                />
                <Kpi
                  label={`ค่าบริการเฉลี่ยต่อราย · ${view.latestLabel}`}
                  value={
                    view.chargeAvg == null
                      ? '—'
                      : `${nf.format(Math.round(view.chargeAvg))} บาท`
                  }
                  hint={`ยอดรวม ${nf.format(Math.round(view.latest.charge))} บาท`}
                />
                <Kpi
                  label="นอนนานที่สุดในปีล่าสุด"
                  value={`${nf.format(view.stayMax)} วัน`}
                  hint={`มี ${nf.format(view.stayOver30)} รายที่นอนเกิน 30 วัน — ค่าเฉลี่ยถูกดึงขึ้นด้วยรายกลุ่มนี้`}
                />
                <Kpi
                  label="ค่าบริการต่อวันนอน"
                  value={
                    view.latest.stayDays > 0
                      ? `${nf.format(Math.round(view.latest.charge / view.latest.stayDays))} บาท`
                      : '—'
                  }
                  hint="ยอดรวมค่าบริการหารด้วยวันนอนรวมของปีล่าสุด"
                />
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <Panel
                  title="วันนอนเฉลี่ยต่อราย"
                  desc="แท่งคือวันนอนเฉลี่ย เส้นคือจำนวนผู้ป่วยของปีนั้น — ต้องอ่านคู่กันเสมอ"
                >
                  <ResourceChart points={view.stay} unit="days" />
                </Panel>
                <Panel
                  title="ค่าบริการ เฉลี่ยต่อราย คู่กับยอดรวม"
                  desc="แท่งซ้ายคือผู้ป่วยหนึ่งรายใช้ค่ารักษาเท่าไร แท่งขวาคือโรคนี้กินค่ารักษาของโรงพยาบาลไปทั้งหมดเท่าไร (ล้านบาท) — ยอดค่ารักษา ไม่ใช่ยอดที่เรียกเก็บได้จริง"
                >
                  <ResourceChart points={view.charge} unit="baht" pairTotal />
                </Panel>
              </div>

              <section className="mt-4 rounded-2xl border border-line bg-panel p-4 backdrop-blur">
                <div className="mb-3 text-sm font-semibold text-ink">
                  ตารางวันนอนและค่าบริการ {rangeLabel}
                </div>
                <Table
                  size="small"
                  rowKey="key"
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                  dataSource={[...stats.periods].reverse()}
                  columns={[
                    {
                      key: 'year',
                      title: periodTitle,
                      dataIndex: 'key',
                      render: (value: string, row) => <PeriodCell value={value} partial={row.partial} />,
                    },
                    {
                      key: 'patients',
                      title: 'ผู้ป่วย',
                      align: 'right',
                      render: (_, row) => (
                        <NumberCell
                          value={row.all.total}
                          previous={comparable(row, view.previousOf.get(row.key)?.all.total ?? null)}
                          goal="none"
                        />
                      ),
                    },
                    {
                      key: 'stay-avg',
                      title: 'วันนอนเฉลี่ย',
                      align: 'right',
                      render: (_, row) => (
                        <NumberCell
                          value={perPatient(row.stayDays, row.all.total)}
                          previous={comparable(row, previousPerPatient(view.previousOf.get(row.key), 'stayDays'))}
                          digits={2}
                        />
                      ),
                    },
                    {
                      key: 'stay-total',
                      title: 'วันนอนรวม',
                      align: 'right',
                      render: (_, row) => (
                        <NumberCell
                          value={row.stayDays}
                          previous={comparable(row, view.previousOf.get(row.key)?.stayDays ?? null)}
                          goal="none"
                        />
                      ),
                    },
                    {
                      key: 'charge-avg',
                      title: 'ค่าบริการเฉลี่ย/ราย (บาท)',
                      align: 'right',
                      render: (_, row) => (
                        <NumberCell
                          value={perPatient(row.charge, row.all.total)}
                          previous={comparable(row, previousPerPatient(view.previousOf.get(row.key), 'charge'))}
                        />
                      ),
                    },
                    {
                      key: 'charge-total',
                      title: 'ค่าบริการรวม (บาท)',
                      align: 'right',
                      render: (_, row) => (
                        <NumberCell
                          value={Math.round(row.charge)}
                          previous={comparable(
                            row,
                            view.previousOf.get(row.key) == null
                              ? null
                              : Math.round(view.previousOf.get(row.key)!.charge),
                          )}
                          goal="none"
                        />
                      ),
                    },
                  ]}
                />
              </section>
            </section>

            {/* ที่อยู่ของผู้ป่วย — คนละแกนกับสามส่วนบนที่เป็นเรื่องของเวลา ส่วนนี้ตอบว่า
                คนไข้มาจากไหน ซึ่งเป็นภาพรวมของทั้งช่วง ไม่ได้แยกตามช่วงย่อย */}
            <section className="mt-2">
              <SectionHead
                title="4 · ผู้ป่วยมาจากพื้นที่ไหน"
                desc="นับตามอำเภอ/ตำบลในทะเบียนบ้านของผู้ป่วย ตลอดช่วงที่เลือกไว้ด้านบน — ไม่ได้แยกตามปีหรือเดือน เพราะคำถามของส่วนนี้คือพื้นที่ ไม่ใช่แนวโน้ม"
                hint={
                  <div className="text-xs leading-relaxed">
                      <div>
                        นับจากอำเภอ/ตำบลในทะเบียนบ้าน ไม่ใช่ที่อยู่ขณะเจ็บป่วย และนับเป็นจำนวน
                        ครั้งที่นอนโรงพยาบาล (AN) เหมือนตัวเลขอื่นในหน้านี้ ผู้ป่วยคนเดียวที่นอน
                        สองครั้งในช่วงเดียวกันจึงนับสองครั้ง
                      </div>
                      <div className="mt-1.5">
                        เป็นจำนวนรายล้วน ไม่ใช่อัตราต่อประชากร อำเภอที่คนมากย่อมมีผู้ป่วยมากกว่า
                        โดยไม่ได้แปลว่าเสี่ยงกว่า ถ้าต้องการอัตราต่อแสนประชากรต้องมีข้อมูล
                        ประชากรรายอำเภอมาประกบ ซึ่งยังไม่มีในระบบนี้
                      </div>
                      <div className="mt-1.5">
                        ตำบลที่มีผู้ป่วยหลักหน่วยมีอยู่หลายตำบล ผลต่างหนึ่งถึงสองรายระหว่างตำบล
                        ไม่ใช่ความต่างที่เอาไปสรุปอะไรได้
                      </div>
                    </div>
                }
              />

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi
                  label="ผู้ป่วยในจังหวัดพะเยา"
                  value={nf.format(view.areas.inProvince)}
                  hint={`${view.areas.provinceShare == null ? '—' : `${view.areas.provinceShare.toFixed(1)}%`} ของผู้ป่วยทั้งหมด ${nf.format(stats.areas.total)} ราย`}
                />
                <Kpi
                  label="นอกจังหวัด"
                  value={nf.format(stats.areas.outside)}
                  hint="ทะเบียนบ้านอยู่จังหวัดอื่น ไม่อยู่ในกราฟรายอำเภอ"
                />
                <Kpi
                  label="อำเภอที่มีผู้ป่วยมากที่สุด"
                  value={view.areas.top?.name ?? '—'}
                  hint={
                    view.areas.top == null
                      ? 'ไม่มีข้อมูลในช่วงนี้'
                      : `${nf.format(view.areas.top.patients)} ราย · ${view.areas.topShare == null ? '—' : `${view.areas.topShare.toFixed(1)}%`} ของผู้ป่วยในจังหวัด`
                  }
                />
                <Kpi
                  label="อำเภอที่มีผู้ป่วย"
                  value={`${nf.format(stats.areas.districts.length)} อำเภอ`}
                  hint={`รวม ${nf.format(view.areas.tambonCount)} ตำบล`}
                />
              </div>

              <section className="mt-4 rounded-2xl border border-line bg-panel p-4 backdrop-blur">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <div className="text-sm font-semibold text-ink">
                    <EnvironmentOutlined />{' '}
                    {view.areas.selected == null
                      ? 'จำนวนผู้ป่วยรายอำเภอ จังหวัดพะเยา'
                      : `จำนวนผู้ป่วยรายตำบล อำเภอ${view.areas.selected.name}`}
                  </div>
                  {/* มีสองทางเข้าตั้งใจให้ซ้ำกัน — กดแท่งเป็นทางที่เร็วกว่าเมื่อรู้อยู่แล้ว
                      ว่าจะดูอำเภอไหน ส่วนรายการเลือกเป็นทางที่มองเห็นได้โดยไม่ต้องเดา
                      ว่าแท่งกดได้ ซึ่งเป็นเรื่องที่คนไม่เดาเองถ้าไม่มีอะไรบอก */}
                  <Select<string>
                    size="small"
                    style={{ width: 200 }}
                    value={district ?? ALL_DISTRICTS}
                    onChange={value => setDistrict(value === ALL_DISTRICTS ? null : value)}
                    options={[
                      { value: ALL_DISTRICTS, label: 'ทุกอำเภอ' },
                      ...stats.areas.districts.map(item => ({
                        value: item.id,
                        label: `อำเภอ${item.name} (${nf.format(item.patients)})`,
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
                    ? 'กดที่แท่งของอำเภอ หรือเลือกจากรายการ เพื่อเจาะดูรายตำบล · สีเข้มกว่าคือมีผู้ป่วยมากกว่า'
                    : `${nf.format(view.areas.selected.patients)} ราย ใน ${nf.format(view.areas.selected.tambons.length)} ตำบล · สีเข้มกว่าคือมีผู้ป่วยมากกว่า`}
                </div>
                {view.areas.points.length > 0 ? (
                  <AreaChart
                    points={view.areas.points}
                    total={view.areas.selected?.patients ?? view.areas.inProvince}
                    onSelect={view.areas.selected == null ? setDistrict : undefined}
                    description="จำนวนผู้ป่วยในโรคหลอดเลือดสมองแยกตามพื้นที่ที่อยู่ตามทะเบียนบ้าน เรียงจากมากไปน้อย"
                  />
                ) : (
                  <Empty
                    description={
                      <span className="text-xs text-ink-3">ไม่มีผู้ป่วยในจังหวัดในช่วงนี้</span>
                    }
                  />
                )}
              </section>

            </section>




          </div>
        ) : loading ? (
          <div className="flex flex-col gap-4">
            <StatCardsSkeleton count={4} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" />
            <div className="grid gap-4 xl:grid-cols-2">
              <BlockSkeleton height={300} />
              <BlockSkeleton height={300} />
              <BlockSkeleton height={300} />
              <BlockSkeleton height={300} />
            </div>
            <section className="rounded-2xl border border-line bg-panel p-4 backdrop-blur">
              <TableRowsSkeleton columns={6} rows={5} />
            </section>
          </div>
        ) : stats ? (
          /* ช่วงที่ยังมาไม่ถึง — เลือกไตรมาสของปีงบที่ยังเดินไม่ถึงไตรมาสนั้น
             ไม่มีเดือนให้แสดงสักเดือน ต้องบอกว่าทำไม ไม่ใช่ปล่อยหน้าว่าง */
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
