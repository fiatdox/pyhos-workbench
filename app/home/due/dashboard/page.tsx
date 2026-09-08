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
  AppropriatenessTrendChart,
  CultureBulletChart,
  DddTrendChart,
  DrpParetoChart,
  QueueAgingChart,
  TurnaroundBoxPlot,
  WardDrugTreemap,
} from './charts'
import {
  APPROPRIATENESS,
  CULTURE_ALIGNMENT,
  EVALUATED,
  KPIS,
  PERIOD_LABEL,
  PERIOD_PREV_LABEL,
  QUEUE,
  type Kpi,
} from './mock-stats'

const { Text, Title } = Typography

/**
 * ภาพรวมการใช้ยา DUE
 *
 * หน้านี้ตอบคำถามระดับหน่วยงาน ไม่ใช่ระดับผู้ป่วย จึงไม่มี HN ไม่มีชื่อผู้ป่วย
 * ทั้งหน้า — อยากเจาะดูรายเคสต้องกลับไปหน้างานที่มีสิทธิ์อยู่แล้ว
 * ตัวเลขทุกตัวยังเป็นข้อมูลสมมติจาก mock-stats.ts
 *
 * ชนิดกราฟเลือกตามคำถามของข้อมูลแต่ละชุด ไม่ได้ใช้แบบเดียวทั้งหน้า —
 * ค่าที่ต้องดูการกระจายใช้ box plot ค่าที่ต้องดูทิศทางใช้เส้น/คอลัมน์ตามเวลา
 * ค่าที่ต้องเรียงลำดับความสำคัญใช้ Pareto และค่าที่ต้องหาจุดกระจุกใช้ heatmap
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
        <div className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          {title}
          {hint && (
            <Tooltip title={hint}>
              <InfoCircleOutlined className="cursor-help text-xs text-ink-3" />
            </Tooltip>
          )}
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

export default function DueDashboardPage() {
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
        {/* ───── คิวค้าง ─────
            แบ่งตามอายุ ไม่ใช่บอกแค่จำนวนรวม — คิว 26 ใบที่กระจุกใน 24 ชั่วโมงแรก
            สุขภาพดีกว่าคิว 6 ใบที่ครึ่งหนึ่งค้างเกิน 3 วัน */}
        <Panel
          title="งานค้างขณะนี้"
          hint="สีของแท่งบอกความรุนแรง ยิ่งค้างนานยิ่งแดง ไม่ต้องอ่านป้ายก็เห็น"
        >
          <QueueAgingChart />
          <div className="mt-2 space-y-1 border-t border-line pt-2">
            {QUEUE.map(row => (
              <div key={row.stage} className="flex items-center justify-between gap-2">
                <Text type="secondary" className="text-[11px]">
                  {row.stage} · ค้างนานสุด {row.oldest}
                </Text>
                {row.overdue && (
                  <Tag color="red" className="mr-0!">
                    เกินเกณฑ์
                  </Tag>
                )}
              </div>
            ))}
          </div>
        </Panel>

        {/* ───── เวลารอคอย ─────
            box plot แทนแท่งค่ากลาง เพราะค่ากลางซ่อนใบที่รอนานผิดปกติไว้หมด
            ซึ่งเป็นใบที่ต้องตามหาจริง ๆ */}
        <Panel
          className="xl:col-span-2"
          title="การกระจายของเวลารอคอย แยกตามเวร"
          hint="กล่อง = ช่วงกลาง 50% ของใบทั้งหมด เส้นในกล่อง = มัธยฐาน จุดที่หลุดออกไป = ใบที่รอนานผิดปกติ"
        >
          <TurnaroundBoxPlot />
        </Panel>
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-2">
        {/* ───── ความเหมาะสม ───── */}
        <Panel
          title="ความเหมาะสมของการใช้ยารายเดือน"
          hint={`ฐาน ${EVALUATED} ใบที่ประเมินแล้วตลอดช่วง`}
        >
          <AppropriatenessTrendChart />
          {/* แยกสามด้านไม่รวมเป็นตัวเลขเดียว เพราะมาตรการแก้คนละเรื่องกัน
              ข้อบ่งใช้แก้ด้วยแนวทางการรักษา ขนาดยาแก้ด้วยตารางปรับตาม CrCl */}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-2">
            {APPROPRIATENESS.map(row => {
              const total = row.appropriate + row.consulted + row.cannot
              return (
                <Text key={row.dimension} type="secondary" className="text-[11px]">
                  {row.dimension}{' '}
                  <span className="font-semibold text-ink">
                    {Math.round((row.appropriate / total) * 100)}%
                  </span>
                </Text>
              )
            })}
          </div>
        </Panel>

        {/* ───── DRPs ─────
            Pareto: แท่งคือจำนวน เส้นคือ % สะสม ใช้เลือกว่าจะทำแนวทางเรื่องไหนก่อน
            ให้คุ้มแรงที่สุด เป็นรูปแบบมาตรฐานของงานพัฒนาคุณภาพ */}
        <Panel
          title="ปัญหาจากการใช้ยาที่พบบ่อย (DRPs)"
          hint="เส้น % สะสมบอกว่ากี่หมวดแรกรวมกันเป็นกี่เปอร์เซ็นต์ของปัญหาทั้งหมด"
        >
          <DrpParetoChart />
        </Panel>
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-3">
        {/* ───── ปริมาณการใช้ยา ─────
            หัวข้อเดียวในหน้านี้ที่ดึงจาก HIS ได้เลยโดยไม่ต้องรอที่เก็บข้อมูลของ DUE
            (opitemrece + วันนอนจาก ipt) แต่ยังต้องมีตารางค่า DDD มาตรฐานก่อน */}
        <Panel
          className="xl:col-span-2"
          title="ปริมาณการใช้ยาต้านจุลชีพ (DDD / 1000 วันนอน)"
          hint="คำถามของตัวเลขนี้คือทิศทางตามเวลา ไม่ใช่อันดับของเดือนนี้"
        >
          <DddTrendChart />
        </Panel>

        {/* ───── ความสอดคล้องกับผลเพาะเชื้อ ───── */}
        <Panel
          title="ความสอดคล้องกับผลเพาะเชื้อ"
          hint="พฤติกรรมที่แก้ได้ด้วยการสื่อสาร ต่างจากตัวเลขภาพรวมที่บอกแค่ว่าแย่"
        >
          <div className="mb-3">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="text-xs text-ink">Empiric / Specific</span>
              <span className="text-[11px] text-ink-3">
                {CULTURE_ALIGNMENT.empiric}% / {CULTURE_ALIGNMENT.specific}%
              </span>
            </div>
            {/* อันนี้เป็นสัดส่วนของก้อนเดียว แท่งเดียวสองสีตรงกับคำถามที่สุด
                ไม่ต้องเปลี่ยนเป็นกราฟอย่างอื่นให้ซับซ้อนเกินจำเป็น */}
            <div className="flex h-2.5 overflow-hidden rounded-full bg-line-faint">
              <div className="bg-lab-chip" style={{ width: `${CULTURE_ALIGNMENT.empiric}%` }} />
              <div className="bg-ref-abx" style={{ width: `${CULTURE_ALIGNMENT.specific}%` }} />
            </div>
          </div>

          {/* ตัวชี้วัดสองตัวนี้มีเกณฑ์กำกับ bullet จึงตรงกว่าแท่ง % เปล่า ๆ
              เส้นทึบคือเป้าหมาย แถบพื้นหลังคือช่วงคุณภาพ */}
          <CultureBulletChart />

          {/* ไม่แต่งตัวเลขให้ช่องที่ระบบยังไม่ได้เก็บ — เขียนไว้ตรง ๆ ว่าขาดอะไร
              ถ้าใส่ตัวเลขปลอมไว้ก่อน พอถึงเวลาต่อจริงจะไม่มีใครจำได้ว่าอันไหนของจริง */}
          <div className="mt-3 rounded-lg border border-dashed border-line px-3 py-2.5">
            <div className="text-[11px] font-medium text-ink-3">
              อัตราที่แพทย์ยอมรับการแทรกแซงของเภสัชกร
            </div>
            <div className="mt-0.5 text-xs text-ink">
              ยังรายงานไม่ได้ — แบบประเมินยังไม่มีช่องบันทึกว่าแพทย์ยอมรับหรือไม่
            </div>
          </div>
        </Panel>
      </div>

      {/* ───── หอผู้ป่วย × ตัวยา ─────
          ตัวเลขรวมทั้งโรงพยาบาลชี้เป้าไม่ได้ว่าต้องไปคุยกับใคร ภาพนี้บอกได้ทันที
          ว่าการใช้ยากระจุกอยู่ที่หอไหน และในหอนั้นเป็นยาตัวไหน */}
      <Panel
        title="ปริมาณการใช้ยารายหอผู้ป่วย"
        hint="ขนาดของช่อง = ปริมาณการใช้ กล่องใหญ่คือหอที่ควรไปทบทวนการใช้ยาก่อน"
        extra={
          <Text type="secondary" className="text-[11px]">
            หน่วย: DDD / 1000 วันนอน
          </Text>
        }
      >
        <WardDrugTreemap />
      </Panel>
    </>
  )
}
