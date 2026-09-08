'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ยังทำที่ app/home/layout.tsx ซึ่งเป็น Server Component)
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Alert, Breadcrumb, DatePicker, Empty, Segmented, Spin, Typography } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { BarChartOutlined } from '@ant-design/icons'
import { apiFetch } from '@/lib/client/session'
import type { DeliveryStats } from '@/lib/his/delivery-stats'
import {
  DailyVolumeChart,
  MonthlyTrendChart,
  RiderLoadChart,
  RoleShareChart,
  TambonChart,
  UptakeChart,
} from './charts'

const { RangePicker } = DatePicker
const { Text, Title } = Typography

/** ช่วงสำเร็จรูปที่ผู้บริหารใช้บ่อย — เลือกเองก็ยังได้จากตัวเลือกวันที่ */
const PRESETS = [
  { value: '7', label: '7 วัน' },
  { value: '30', label: '30 วัน' },
  { value: '90', label: '90 วัน' },
]

const rangeOf = (days: number): [Dayjs, Dayjs] => [dayjs().subtract(days - 1, 'day'), dayjs()]

const thaiDate = (value: Dayjs) => `${value.format('DD/MM')}/${value.year() + 543}`

const nf = new Intl.NumberFormat('th-TH')

/** การ์ดตัวเลขหนึ่งใบ — หัวข้อ ตัวเลขใหญ่ และคำขยายบรรทัดเดียว */
function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-4 backdrop-blur">
      <div className="text-xs text-ink-3">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-ink">{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-3">{hint}</div>}
    </div>
  )
}

/** กล่องกราฟหนึ่งใบ — หัวข้อกับคำอธิบายว่ากราฟนี้ตอบคำถามอะไร */
function Panel({
  title,
  desc,
  children,
}: {
  title: string
  desc: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-line bg-panel p-4 backdrop-blur">
      <div className="mb-1 text-sm font-semibold text-ink">{title}</div>
      <div className="mb-3 text-xs text-ink-3">{desc}</div>
      {children}
    </section>
  )
}

/**
 * ภาพรวมงานส่งยาถึงบ้าน
 *
 * ตอบคำถามระดับบริหารห้าข้อ: ปริมาณงานเท่าไร ตกค้างเท่าไร แนวโน้มขึ้นหรือลง
 * งานกระจุกที่พื้นที่ไหน และภาระตกที่ใครมากที่สุด
 *
 * ทุกตัวเลขสรุปมาจากฐานข้อมูลโดยตรง ไม่มีข้อมูลรายบุคคลของผู้ป่วยในหน้านี้
 */
export default function HealthRiderDashboardPage() {
  const [range, setRange] = useState<[Dayjs, Dayjs]>(rangeOf(30))
  const [preset, setPreset] = useState<string | null>('30')
  const [stats, setStats] = useState<DeliveryStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    const run = async () => {
      try {
        const query = `from=${range[0].format('YYYY-MM-DD')}&to=${range[1].format('YYYY-MM-DD')}`
        const res = await apiFetch(`/api/his/health-rider/deliveries/stats?${query}`)
        const json = await res.json()
        if (!alive) return
        if (!res.ok || !json.success) {
          setStats(null)
          setError(json.message ?? 'ดึงข้อมูลสรุปไม่สำเร็จ')
          return
        }
        setStats(json.stats as DeliveryStats)
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
    // กันตั้ง state จากคำขอของช่วงเก่าเมื่อผู้ใช้เปลี่ยนช่วงเร็ว ๆ
    return () => {
      alive = false
    }
  }, [range])

  const kpis = useMemo(() => {
    if (!stats) return null
    const { totals } = stats
    const pending = Math.max(totals.visits - totals.assigned, 0)
    const assignedPct = totals.visits > 0 ? Math.round((totals.assigned / totals.visits) * 100) : 0
    const perDay = totals.workingDays > 0 ? totals.visits / totals.workingDays : 0
    const perRider = totals.activeRiders > 0 ? totals.assigned / totals.activeRiders : 0
    // สัดส่วนการเข้าร่วมโครงการ: ครั้งที่ส่งยาถึงบ้าน หารด้วยการมารับบริการทั้งหมด
    const uptake = totals.opdVisits > 0 ? (totals.visits / totals.opdVisits) * 100 : 0
    return { pending, assignedPct, perDay, perRider, uptake }
  }, [stats])

  const pick = (days: string) => {
    setPreset(days)
    setLoading(true)
    setRange(rangeOf(Number(days)))
  }

  return (
    <>
      <section className="mb-6">
        <Breadcrumb
          className="mb-2"
          items={[
            { title: <Link href="/home/health-rider">Health Rider</Link> },
            { title: 'ภาพรวมงานส่งยา' },
          ]}
        />
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          <BarChartOutlined /> ภาพรวมงานส่งยา
        </Title>
        <div className="mb-2 h-px w-24 bg-linear-to-r from-violet-400/70 to-transparent" />
        <Text type="secondary" className="text-xs">
          สรุปปริมาณงาน การจ่ายงาน พื้นที่ และภาระของเจ้าหน้าที่ — ไม่มีข้อมูลรายบุคคลของผู้ป่วย
        </Text>
      </section>

      {error && <Alert type="error" showIcon title={error} className="mb-4" />}

      <section className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          value={preset ?? ''}
          options={PRESETS}
          onChange={value => pick(String(value))}
        />
        <RangePicker
          allowClear={false}
          value={range}
          onChange={value => {
            if (!value?.[0] || !value[1]) return
            setPreset(null)
            setLoading(true)
            setRange([value[0], value[1]])
          }}
          format={thaiDate}
          maxDate={dayjs()}
        />
        <Text type="secondary" className="ml-auto text-xs">
          {thaiDate(range[0])} – {thaiDate(range[1])}
        </Text>
      </section>

      <Spin spinning={loading}>
        {stats && kpis ? (
          <div className="flex flex-col gap-4">
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
              <Kpi
                label="ครั้งที่ต้องส่งยา"
                value={nf.format(stats.totals.visits)}
                hint={`${nf.format(stats.totals.workingDays)} วันที่มีงาน · เฉลี่ย ${kpis.perDay.toFixed(1)} ครั้ง/วัน`}
              />
              <Kpi
                label="เข้าร่วมโครงการ"
                value={`${kpis.uptake.toFixed(1)}%`}
                hint={`ส่งยา ${nf.format(stats.totals.visits)} จากมารับบริการ ${nf.format(stats.totals.opdVisits)} ครั้ง`}
              />
              <Kpi
                label="ผู้ป่วย (ไม่ซ้ำ)"
                value={nf.format(stats.totals.patients)}
                hint="นับ HN ไม่ซ้ำทั้งช่วง"
              />
              <Kpi
                label="จ่ายงานแล้ว"
                value={`${kpis.assignedPct}%`}
                hint={`${nf.format(stats.totals.assigned)} จาก ${nf.format(stats.totals.visits)} ครั้ง`}
              />
              <Kpi
                label="ยังไม่จ่ายงาน"
                value={nf.format(kpis.pending)}
                hint={kpis.pending > 0 ? 'ต้องตามจ่ายให้ครบ' : 'จ่ายครบทุกครั้งในช่วงนี้'}
              />
              <Kpi
                label="เจ้าหน้าที่ที่มีงาน"
                value={nf.format(stats.totals.activeRiders)}
                hint={`เฉลี่ย ${kpis.perRider.toFixed(1)} ครั้ง/คน`}
              />
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
              <Panel
                title="ปริมาณงานรายวัน"
                desc="ความสูงคือจำนวนครั้งของวันนั้น สีเหลืองคือส่วนที่ยังไม่ได้จ่ายให้ใคร"
              >
                <DailyVolumeChart daily={stats.daily} />
              </Panel>
              <Panel
                title="แนวโน้ม 12 เดือน"
                desc="ดูทิศทางระยะยาว ไม่ขึ้นกับช่วงวันที่ที่เลือกด้านบน"
              >
                <MonthlyTrendChart monthly={stats.monthly} />
              </Panel>
              <Panel
                title="พื้นที่ที่ต้องส่งมากที่สุด"
                desc="สิบสองตำบลแรก ใช้ดูว่าควรเพิ่มคนรับผิดชอบที่ไหน"
              >
                {stats.byTambon.length > 0 ? (
                  <TambonChart byTambon={stats.byTambon} />
                ) : (
                  <Empty description="ไม่มีข้อมูลในช่วงนี้" />
                )}
              </Panel>
              <Panel
                title="อัตราเข้าร่วมโครงการรายตำบล"
                desc="กี่ % ของการมารับบริการจากตำบลนั้นจบด้วยการส่งยาถึงบ้าน (นับเฉพาะตำบลที่มีผู้มารับบริการตั้งแต่ 100 ครั้งขึ้นไป)"
              >
                {stats.byTambon.length > 0 ? (
                  <UptakeChart rows={stats.byTambon} target={kpis.uptake} />
                ) : (
                  <Empty description="ไม่มีข้อมูลในช่วงนี้" />
                )}
              </Panel>
              <Panel
                title="อัตราเข้าร่วมโครงการตามสิทธิการรักษา"
                desc="สิทธิไหนใช้บริการส่งยามาก สิทธิไหนแทบไม่ได้ใช้เลย"
              >
                {stats.byRight.length > 0 ? (
                  <UptakeChart rows={stats.byRight} minVisits={200} target={kpis.uptake} />
                ) : (
                  <Empty description="ไม่มีข้อมูลในช่วงนี้" />
                )}
              </Panel>
              <Panel
                title="ภาระงานรายบุคคล แยกตามตำบลที่ไปส่ง"
                desc="ความยาวแท่งคืองานรวมของคนนั้น ชั้นสีคือตำบลปลายทาง — ชี้ที่แท่งเพื่อดูว่าลงหมู่ไหนบ้าง"
              >
                {stats.byRiderArea.length > 0 ? (
                  <RiderLoadChart byRiderArea={stats.byRiderArea} />
                ) : (
                  <Empty description="ยังไม่มีการจ่ายงานในช่วงนี้" />
                )}
              </Panel>
              <Panel
                title="สัดส่วนตามประเภทเจ้าหน้าที่"
                desc="อสม. กับเจ้าหน้าที่โรงพยาบาลรับงานกันคนละเท่าไร"
              >
                {stats.byRider.length > 0 ? (
                  <RoleShareChart byRider={stats.byRider} />
                ) : (
                  <Empty description="ยังไม่มีการจ่ายงานในช่วงนี้" />
                )}
              </Panel>
              <Panel
                title="ค่าบริการจัดส่งรวม"
                desc="ยอดรวมค่าบริการจัดส่งยาที่คิดในช่วงที่เลือก"
              >
                <div className="flex h-full flex-col justify-center gap-2 py-6">
                  <div className="text-3xl font-semibold text-ink">
                    {nf.format(stats.totals.amount)} บาท
                  </div>
                  <Text type="secondary" className="text-xs">
                    เฉลี่ย{' '}
                    {stats.totals.visits > 0
                      ? (stats.totals.amount / stats.totals.visits).toFixed(2)
                      : '0.00'}{' '}
                    บาทต่อครั้ง
                  </Text>
                </div>
              </Panel>
            </section>
          </div>
        ) : (
          !loading && <Empty description="ไม่มีข้อมูลในช่วงที่เลือก" />
        )}
      </Spin>
    </>
  )
}
