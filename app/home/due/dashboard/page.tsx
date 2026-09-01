'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ยังทำที่ app/home/layout.tsx ซึ่งเป็น Server Component)
import Link from 'next/link'
import { Breadcrumb, Tag, Tooltip, Typography } from 'antd'
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DashboardOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons'
import FlowSankey from './flow-sankey'
import {
  APPROPRIATENESS,
  CULTURE_ALIGNMENT,
  DDD,
  DRPS,
  EVALUATED,
  KPIS,
  PERIOD_LABEL,
  PERIOD_PREV_LABEL,
  QUEUE,
  TURNAROUND,
  type Kpi,
} from './mock-stats'

const { Text, Title } = Typography

/**
 * ภาพรวมการใช้ยา DUE
 *
 * หน้านี้ตอบคำถามระดับหน่วยงาน ไม่ใช่ระดับผู้ป่วย จึงไม่มี HN ไม่มีชื่อผู้ป่วย
 * ทั้งหน้า — อยากเจาะดูรายเคสต้องกลับไปหน้างานที่มีสิทธิ์อยู่แล้ว
 * ตัวเลขทุกตัวยังเป็นข้อมูลสมมติจาก mock-stats.ts
 */

/** กล่องหนึ่งส่วนของหน้า — หัวข้อ คำอธิบายสั้น และเนื้อหา */
function Panel({
  title,
  hint,
  extra,
  children,
  className,
}: {
  title: string
  hint?: string
  extra?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={`rounded-2xl border border-line bg-panel p-4 backdrop-blur ${className ?? ''}`}
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            {title}
            {hint && (
              <Tooltip title={hint}>
                <InfoCircleOutlined className="cursor-help text-xs text-ink-3" />
              </Tooltip>
            )}
          </div>
        </div>
        {extra}
      </div>
      {children}
    </section>
  )
}

/**
 * ตัวเลขหัวหน้าหน้าจอ
 *
 * ลูกศรขึ้นไม่ได้แปลว่าดีเสมอไป — คำขอเพิ่มขึ้นคือใช้งานระบบมากขึ้น (ดี)
 * แต่เวลารออนุมัติเพิ่มขึ้นคือแย่ลง จึงต้องมี upIsGood กำกับทีละตัว
 * ถ้าใช้สีเขียวกับลูกศรขึ้นทั้งหมด แดชบอร์ดจะโกหกคนอ่าน
 */
function StatCard({ kpi }: { kpi: Kpi }) {
  const good = kpi.direction === 'up' ? kpi.upIsGood : !kpi.upIsGood
  return (
    <div className="rounded-2xl border border-line bg-panel p-4 backdrop-blur">
      <div className="text-[11px] font-medium text-ink-3">{kpi.label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold text-ink">{kpi.value}</span>
        {kpi.unit && <span className="text-xs text-ink-3">{kpi.unit}</span>}
        {kpi.delta && (
          <span
            className={`ml-auto flex items-center gap-0.5 text-[11px] font-semibold ${
              good ? 'text-ref-abx' : 'text-ref-culture'
            }`}
          >
            {kpi.direction === 'up' ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
            {kpi.delta}
          </span>
        )}
      </div>
      {kpi.hint && (
        <Text type="secondary" className="mt-1 block text-[11px] leading-snug">
          {kpi.hint}
        </Text>
      )}
    </div>
  )
}

/** แถบสัดส่วนแบบ CSS — ข้อมูลชุดนี้ไม่ต้องใช้ไลบรารีกราฟ แค่เทียบความยาวกัน */
function Bar({ ratio, className }: { ratio: number; className: string }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-line-faint">
      <div className={`h-full rounded-full ${className}`} style={{ width: `${ratio * 100}%` }} />
    </div>
  )
}

export default function DueDashboardPage() {
  const maxDrp = Math.max(...DRPS.map(item => item.count))
  // เทียบความยาวแท่งจากค่ารอบนี้อย่างเดียว ค่ารอบก่อนแสดงเป็นตัวเลขส่วนต่างข้างท้าย
  const maxDdd = Math.max(...DDD.map(item => item.current))
  const maxHours = Math.max(...TURNAROUND.map(row => row.holiday))

  return (
    <>
      <section className="mb-6">
        <Breadcrumb
          className="mb-2"
          items={[
            { title: <Link href="/home/due">DUE ขออนุมัติใช้ยา</Link> },
            { title: 'ภาพรวมและตัวชี้วัด' },
          ]}
        />
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          <DashboardOutlined /> ภาพรวมการใช้ยา DUE{' '}
          <Tag color="orange" className="align-middle">
            ตัวอย่าง
          </Tag>
        </Title>
        <div className="mb-2 h-px w-24 bg-linear-to-r from-violet-400/70 to-transparent" />
        <Text type="secondary" className="text-xs">
          ข้อมูล {PERIOD_LABEL} · เทียบกับ {PERIOD_PREV_LABEL} · ตัวเลขทั้งหมดเป็นข้อมูลสมมติ
        </Text>
      </section>

      <section className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {KPIS.map(kpi => (
          <StatCard key={kpi.label} kpi={kpi} />
        ))}
      </section>

      {/* ───── เส้นทางของคำขอ ─────
          วางไว้บนสุดต่อจาก KPI เพราะเป็นภาพเดียวที่อธิบายทั้งกระบวนการได้
          คนที่ไม่เคยเห็นระบบนี้มาก่อนดูกราฟนี้แล้วเข้าใจว่าใครทำอะไรต่อจากใคร */}
      <Panel
        className="mb-4"
        title="เส้นทางของคำขอตลอดกระบวนการ"
        hint="ความหนาของเส้น = จำนวนใบ ดูได้ว่าคำขอหล่นออกจากทางหลักที่ขั้นไหนบ้าง"
        extra={
          <Text type="secondary" className="text-[11px]">
            หน่วย: ใบคำขอ
          </Text>
        }
      >
        <FlowSankey />
      </Panel>

      <div className="mb-4 grid gap-4 xl:grid-cols-3">
        {/* ───── คิวค้าง ───── */}
        <Panel
          title="งานค้างขณะนี้"
          hint="จำนวนอย่างเดียวชี้เป้าไม่ได้ ต้องดูอายุของใบที่ค้างนานสุดคู่กันเสมอ"
        >
          <div className="space-y-3">
            {QUEUE.map(row => (
              <div key={row.stage}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs text-ink">{row.stage}</span>
                  <span className="text-sm font-semibold text-ink">{row.count}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <Text type="secondary" className="text-[11px]">
                    ค้างนานสุด {row.oldest}
                  </Text>
                  {row.overdue && (
                    <Tag color="red" className="mr-0!">
                      เกินเกณฑ์
                    </Tag>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Panel>

        {/* ───── เวลารอคอย ─────
            แยกตามเวรเพราะนี่คือข้อค้นพบที่เอาไปทำอะไรต่อได้จริง — ถ้านอกเวลา
            ช้ากว่าในเวลาสามเท่า ปัญหาคือเรื่องเวรไม่ใช่เรื่องคนทำงานช้า */}
        <Panel
          className="xl:col-span-2"
          title="เวลารอคอยแยกตามเวร (มัธยฐาน)"
          hint="ใช้มัธยฐานไม่ใช่ค่าเฉลี่ย เพราะใบที่ค้างข้ามวันหยุดยาวไม่กี่ใบดึงค่าเฉลี่ยจนอ่านผิด"
        >
          <div className="space-y-4">
            {TURNAROUND.map(row => (
              <div key={row.step}>
                <div className="mb-1.5 text-xs font-medium text-ink">{row.step}</div>
                <div className="space-y-1.5">
                  {(
                    [
                      { label: 'ในเวลาราชการ', value: row.inHours, tone: 'bg-ref-abx' },
                      { label: 'นอกเวลา', value: row.offHours, tone: 'bg-lab-chip' },
                      { label: 'วันหยุด', value: row.holiday, tone: 'bg-ref-culture' },
                    ] as const
                  ).map(item => (
                    <div key={item.label} className="flex items-center gap-3">
                      <span className="w-24 shrink-0 text-[11px] text-ink-3">{item.label}</span>
                      <div className="min-w-0 flex-1">
                        <Bar ratio={item.value / maxHours} className={item.tone} />
                      </div>
                      <span className="w-14 shrink-0 text-right text-[11px] font-semibold text-ink">
                        {item.value} ชม.
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-2">
        {/* ───── ความเหมาะสม ─────
            แยกสามด้านไม่รวมเป็นตัวเลขเดียว เพราะมาตรการแก้คนละเรื่องกัน
            ข้อบ่งใช้ไม่เหมาะสมแก้ด้วยแนวทางการรักษา ขนาดยาแก้ด้วยตารางปรับตาม CrCl */}
        <Panel
          title="ความเหมาะสมของการใช้ยา"
          hint={`ฐาน ${EVALUATED} ใบที่ประเมินแล้ว`}
          extra={
            <div className="flex flex-wrap gap-3 text-[11px] text-ink-3">
              <span className="flex items-center gap-1">
                <i className="inline-block h-2 w-2 rounded-full bg-ref-abx" /> เหมาะสม
              </span>
              <span className="flex items-center gap-1">
                <i className="inline-block h-2 w-2 rounded-full bg-lab-chip" /> Consult แล้ว
              </span>
              <span className="flex items-center gap-1">
                <i className="inline-block h-2 w-2 rounded-full bg-ink-3/40" /> ประเมินไม่ได้
              </span>
            </div>
          }
        >
          <div className="space-y-4">
            {APPROPRIATENESS.map(row => {
              const total = row.appropriate + row.consulted + row.cannot
              const percent = Math.round((row.appropriate / total) * 100)
              return (
                <div key={row.dimension}>
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="text-xs text-ink">{row.dimension}</span>
                    <span className="text-sm font-semibold text-ink">{percent}%</span>
                  </div>
                  {/* แถบเดียวสามสี เห็นสัดส่วนที่ไม่เหมาะสมพร้อมกับที่ประเมินไม่ได้
                      ซึ่งเป็นคนละปัญหากันแต่ต้องเห็นคู่กัน */}
                  <div className="flex h-2.5 overflow-hidden rounded-full bg-line-faint">
                    <div
                      className="bg-ref-abx"
                      style={{ width: `${(row.appropriate / total) * 100}%` }}
                    />
                    <div
                      className="bg-lab-chip"
                      style={{ width: `${(row.consulted / total) * 100}%` }}
                    />
                    <div
                      className="bg-ink-3/40"
                      style={{ width: `${(row.cannot / total) * 100}%` }}
                    />
                  </div>
                  <Text type="secondary" className="mt-1 block text-[11px]">
                    เหมาะสม {row.appropriate} · Consult แล้ว {row.consulted} · ประเมินไม่ได้{' '}
                    {row.cannot}
                  </Text>
                </div>
              )
            })}
          </div>
        </Panel>

        {/* ───── DRPs ───── */}
        <Panel
          title="ปัญหาจากการใช้ยาที่พบบ่อย (DRPs)"
          hint="เรียงจากมากไปน้อย ใช้เลือกหัวข้อที่จะทำแนวทางหรืออบรมรอบถัดไป"
        >
          <div className="space-y-2.5">
            {DRPS.map(item => (
              <div key={item.label} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-[11px] text-ink" title={item.label}>
                  {item.label}
                </span>
                <div className="w-28 shrink-0 sm:w-40">
                  <Bar ratio={item.count / maxDrp} className="bg-ref-culture" />
                </div>
                <span className="w-8 shrink-0 text-right text-[11px] font-semibold text-ink">
                  {item.count}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* ───── ปริมาณการใช้ยา ─────
            หัวข้อเดียวในหน้านี้ที่ดึงจาก HIS ได้เลยโดยไม่ต้องรอที่เก็บข้อมูลของ DUE
            (opitemrece + วันนอนจาก ipt) แต่ยังต้องมีตารางค่า DDD มาตรฐานต่อรายการยาก่อน */}
        <Panel
          className="xl:col-span-2"
          title="ปริมาณการใช้ยาต้านจุลชีพ (DDD / 1000 วันนอน)"
          hint="ตัวเลขมาตรฐานที่คณะกรรมการควบคุมการใช้ยาต้านจุลชีพต้องรายงาน"
        >
          <div className="space-y-2.5">
            {DDD.map(item => {
              const diff = item.current - item.previous
              return (
                <div key={item.drug} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 truncate text-[11px] text-ink" title={item.drug}>
                    {item.drug}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Bar ratio={item.current / maxDdd} className="bg-accent" />
                  </div>
                  <span className="w-12 shrink-0 text-right text-[11px] font-semibold text-ink">
                    {item.current}
                  </span>
                  {/* ยาต้านจุลชีพใช้มากขึ้นไม่ใช่เรื่องดี สีจึงกลับด้านกับ KPI ทั่วไป */}
                  <span
                    className={`w-14 shrink-0 text-right text-[11px] ${
                      diff > 0 ? 'text-ref-culture' : 'text-ref-abx'
                    }`}
                  >
                    {diff > 0 ? '+' : ''}
                    {diff.toFixed(1)}
                  </span>
                </div>
              )
            })}
          </div>
        </Panel>

        {/* ───── ความสอดคล้องกับผลเพาะเชื้อ ───── */}
        <Panel
          title="ความสอดคล้องกับผลเพาะเชื้อ"
          hint="พฤติกรรมที่แก้ได้ด้วยการสื่อสาร ต่างจากตัวเลขภาพรวมที่บอกแค่ว่าแย่"
        >
          <div className="space-y-4">
            <div>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-xs text-ink">Empiric / Specific</span>
                <span className="text-[11px] text-ink-3">
                  {CULTURE_ALIGNMENT.empiric}% / {CULTURE_ALIGNMENT.specific}%
                </span>
              </div>
              <div className="flex h-2.5 overflow-hidden rounded-full bg-line-faint">
                <div className="bg-lab-chip" style={{ width: `${CULTURE_ALIGNMENT.empiric}%` }} />
                <div className="bg-ref-abx" style={{ width: `${CULTURE_ALIGNMENT.specific}%` }} />
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-xs text-ink">ส่งเพาะเชื้อก่อนเริ่มยา</span>
                <span className="text-sm font-semibold text-ink">
                  {CULTURE_ALIGNMENT.sentBeforeStart}%
                </span>
              </div>
              <Bar ratio={CULTURE_ALIGNMENT.sentBeforeStart / 100} className="bg-ref-abx" />
            </div>

            <div>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-xs text-ink">ปรับยาลงตามผล (de-escalation)</span>
                <span className="text-sm font-semibold text-ink">
                  {CULTURE_ALIGNMENT.deEscalated}%
                </span>
              </div>
              <Bar ratio={CULTURE_ALIGNMENT.deEscalated / 100} className="bg-ref-renal" />
            </div>

            {/* ไม่แต่งตัวเลขให้ช่องที่ระบบยังไม่ได้เก็บ — เขียนไว้ตรง ๆ ว่าขาดอะไร
                ถ้าใส่ตัวเลขปลอมไว้ก่อน พอถึงเวลาต่อจริงจะไม่มีใครจำได้ว่าอันไหนของจริง */}
            <div className="rounded-lg border border-dashed border-line px-3 py-2.5">
              <div className="text-[11px] font-medium text-ink-3">
                อัตราที่แพทย์ยอมรับการแทรกแซงของเภสัชกร
              </div>
              <div className="mt-0.5 text-xs text-ink">
                ยังรายงานไม่ได้ — แบบประเมินยังไม่มีช่องบันทึกว่าแพทย์ยอมรับหรือไม่
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </>
  )
}
