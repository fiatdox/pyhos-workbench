'use client'
import { useMemo } from 'react'
import Highcharts from 'highcharts/esm/highcharts'
// ต้องนำเข้าจาก 'highcharts/esm/*' ทั้งตัวหลักและโมดูล — ไฟล์ใน 'highcharts/modules/*'
// เป็นบิลด์ UMD ที่อ่าน instance จากตัวแปร global (window._Highcharts) ซึ่งไม่มีอยู่
// เมื่อถูก bundle ใน Next แล้วพังตอนรันด้วย "Cannot read properties of undefined
// (reading 'Templating')" ส่วนบิลด์ ESM import ตัวหลักมาตรง ๆ จึงได้ instance เดียวกัน
// (โมดูลลงทะเบียนตัวเองตอน import ตั้งแต่ v12 จึงต้องอยู่หลังตัวหลักเสมอ)
// หน้านี้ใช้เฉพาะชนิดกราฟที่มากับตัวหลัก (column/bar/line/area/pie) จึงต้องการ
// แค่โมดูลการเข้าถึง ไม่ต้องโหลด highcharts-more
import 'highcharts/esm/modules/accessibility'
import HighchartsReact from 'highcharts-react-official'
import { useTheme } from '@/app/theme'
import type {
  DeliveryDayStat,
  DeliveryGroupStat,
  DeliveryMonthStat,
  DeliveryRiderAreaStat,
  DeliveryRiderStat,
} from '@/lib/his/delivery-stats'

/**
 * กราฟของหน้าภาพรวมงานส่งยาถึงบ้าน
 *
 * รวมไว้ไฟล์เดียวด้วยเหตุผลเดียวกับหน้าภาพรวม DUE — ทุกกราฟใช้ชุดสีและโครง
 * ตั้งค่าเดียวกัน แยกไฟล์แล้วจะต้องคัดลอกโครงซ้ำจนวันหนึ่งแก้ไม่ครบ
 *
 * ต่างจากหน้า DUE ตรงที่ข้อมูลมาจากฐานจริงผ่าน props ไม่ใช่ค่าจำลองในโมดูล
 * ตัวเลือกกราฟจึงต้องคำนวณใหม่เมื่อข้อมูลเปลี่ยน ไม่ใช่แค่ตอนสลับธีม
 */

function palette(dark: boolean) {
  return dark
    ? {
        ink: '#cbd5e1',
        faint: '#94a3b8',
        grid: 'rgba(255,255,255,0.08)',
        tooltipBg: '#1b1033',
        good: '#34d399',
        warn: '#fbbf24',
        bad: '#fb7185',
        info: '#38bdf8',
        accent: '#a78bfa',
        neutral: '#94a3b8',
      }
    : {
        ink: '#4b4165',
        faint: '#78708f',
        grid: 'rgba(124,58,237,0.12)',
        tooltipBg: '#ffffff',
        good: '#047857',
        warn: '#b45309',
        bad: '#be123c',
        info: '#0369a1',
        accent: '#7c3aed',
        neutral: '#64748b',
      }
}

type Palette = ReturnType<typeof palette>

function baseOptions(dark: boolean, height: number): Highcharts.Options {
  const color = palette(dark)
  return {
    chart: {
      height,
      backgroundColor: 'transparent',
      style: { fontFamily: 'inherit' },
      animation: false,
      spacing: [8, 4, 8, 4],
    },
    credits: { enabled: false },
    title: { text: undefined },
    legend: {
      itemStyle: { color: color.ink, fontWeight: '500', fontSize: '11px' },
      itemHoverStyle: { color: dark ? '#ffffff' : '#2b2140' },
    },
    xAxis: {
      labels: { style: { color: color.faint, fontSize: '11px' } },
      lineColor: color.grid,
      tickColor: color.grid,
    },
    yAxis: {
      title: { text: undefined },
      labels: { style: { color: color.faint, fontSize: '11px' } },
      gridLineColor: color.grid,
    },
    tooltip: {
      backgroundColor: color.tooltipBg,
      borderColor: color.grid,
      style: { color: color.ink, fontSize: '11px' },
    },
    plotOptions: { series: { animation: false } },
  }
}

/**
 * ตัวห่อร่วม — ผสมโครงกลางกับตั้งค่าเฉพาะกราฟ แล้ว remount ตอนสลับธีม
 *
 * Highcharts รับได้แต่ค่าสีจริง ใส่ var() ของ CSS ไม่ได้ จึงต้องสลับชุดสีเอง
 * และต้อง remount ด้วย key={mode} ไม่งั้นสีที่เขียนลง DOM ไปแล้วจะค้าง
 */
function Chart({
  height,
  data,
  build,
}: {
  height: number
  /** ข้อมูลที่ build ใช้ — ใส่ใน deps เพื่อให้กราฟตามข้อมูลใหม่ */
  data: unknown
  build: (color: Palette, dark: boolean) => Highcharts.Options
}) {
  const { mode } = useTheme()
  const dark = mode === 'dark'

  const options = useMemo(
    () => Highcharts.merge(baseOptions(dark, height), build(palette(dark), dark)),
    // build สร้างใหม่ทุก render ใส่ใน deps แล้วจะคำนวณใหม่ตลอด จึงตามที่ข้อมูลแทน
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dark, height, data],
  )

  return <HighchartsReact key={mode} highcharts={Highcharts} options={options} />
}

/** วว/ดด ของ 'YYYY-MM-DD' แบบสั้น พอให้อ่านแกนนอนได้ */
const shortDay = (value: string) => `${value.slice(8, 10)}/${value.slice(5, 7)}`

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

/** 'YYYY-MM' เป็น 'เดือน ปี พ.ศ. สองหลัก' */
const shortMonth = (value: string) => {
  const [year, month] = value.split('-')
  return `${THAI_MONTHS[Number(month) - 1] ?? month} ${String((Number(year) + 543) % 100).padStart(2, '0')}`
}

/**
 * ปริมาณงานรายวัน — แท่งซ้อนแยกจ่ายงานแล้ว/ยังไม่จ่าย
 *
 * ซ้อนกันเพื่อให้ความสูงรวมคือปริมาณงานของวันนั้น ส่วนสีบอกว่าตกค้างเท่าไร
 * ถ้าแยกเป็นสองแท่งจะเทียบ "วันไหนงานเยอะ" ยากขึ้นโดยไม่ได้อะไรเพิ่ม
 */
export function DailyVolumeChart({ daily }: { daily: DeliveryDayStat[] }) {
  return (
    <Chart
      height={280}
      data={daily}
      build={color => ({
        chart: { type: 'column' },
        accessibility: {
          description: 'จำนวนครั้งที่ต้องส่งยาในแต่ละวัน แยกส่วนที่จ่ายงานให้ผู้ส่งยาแล้วกับที่ยังไม่ได้จ่าย',
        },
        xAxis: { categories: daily.map(day => shortDay(day.date)) },
        yAxis: { min: 0, stackLabels: { enabled: false } },
        legend: { enabled: true },
        tooltip: { shared: true },
        plotOptions: { column: { stacking: 'normal', borderWidth: 0, groupPadding: 0.08 } },
        series: [
          {
            type: 'column',
            name: 'จ่ายงานแล้ว',
            color: color.good,
            data: daily.map(day => day.assigned),
          },
          {
            type: 'column',
            name: 'ยังไม่จ่ายงาน',
            color: color.warn,
            data: daily.map(day => Math.max(day.visits - day.assigned, 0)),
          },
        ],
      })}
    />
  )
}

/** แนวโน้ม 12 เดือน — พื้นที่คือจำนวนครั้ง เส้นคือจำนวนผู้ป่วยไม่ซ้ำของเดือนนั้น */
export function MonthlyTrendChart({ monthly }: { monthly: DeliveryMonthStat[] }) {
  return (
    <Chart
      height={280}
      data={monthly}
      build={color => ({
        accessibility: {
          description: 'แนวโน้มปริมาณงานส่งยารายเดือนย้อนหลังสิบสองเดือน เทียบจำนวนครั้งกับจำนวนผู้ป่วย',
        },
        xAxis: { categories: monthly.map(row => shortMonth(row.month)) },
        yAxis: { min: 0 },
        legend: { enabled: true },
        tooltip: { shared: true },
        series: [
          {
            type: 'area',
            name: 'จำนวนครั้ง',
            color: color.accent,
            fillOpacity: 0.18,
            lineWidth: 2,
            marker: { enabled: false },
            data: monthly.map(row => row.visits),
          },
          {
            type: 'line',
            name: 'ผู้ป่วย (ไม่ซ้ำ)',
            color: color.info,
            lineWidth: 2,
            marker: { radius: 3 },
            data: monthly.map(row => row.patients),
          },
        ],
      })}
    />
  )
}

/** พื้นที่ที่ต้องส่งยามากที่สุด — แนวนอนเพราะชื่อตำบลยาวกว่าจะวางแนวตั้งได้ */
export function TambonChart({ byTambon }: { byTambon: DeliveryGroupStat[] }) {
  const top = byTambon.slice(0, 12)
  return (
    <Chart
      height={Math.max(240, top.length * 26 + 60)}
      data={top}
      build={color => ({
        chart: { type: 'bar' },
        accessibility: { description: 'จำนวนครั้งที่ต้องส่งยาแยกตามตำบล เรียงจากมากไปน้อย' },
        xAxis: { categories: top.map(row => row.name) },
        yAxis: { min: 0 },
        tooltip: {
          pointFormat:
            '<b>{point.y}</b> ครั้ง · ผู้ป่วย {point.patients} คน<br/>' +
            'คิดเป็น {point.pct:.1f}% ของการมารับบริการ {point.visits} ครั้ง',
        },
        plotOptions: { bar: { borderWidth: 0, pointPadding: 0.08 } },
        series: [
          {
            type: 'bar',
            name: 'จำนวนครั้ง',
            color: color.info,
            data: top.map(row => ({
              y: row.delivered,
              patients: row.patients,
              visits: row.visits,
              pct: pct(row),
            })),
          },
        ],
      })}
    />
  )
}

/** สัดส่วนการใช้บริการของกลุ่มหนึ่ง เป็นเปอร์เซ็นต์ของการมารับบริการทั้งหมด */
const pct = (row: DeliveryGroupStat) => (row.visits > 0 ? (row.delivered / row.visits) * 100 : 0)

/**
 * อัตราการเข้าร่วมโครงการ — แท่งคือ % ของการมารับบริการที่จบด้วยการส่งยาถึงบ้าน
 *
 * เรียงตาม % ไม่ใช่ตามจำนวน เพราะคำถามคือ "พื้นที่ไหนโครงการเข้าถึงได้ดี" ซึ่ง
 * ต่างจากคำถาม "พื้นที่ไหนงานเยอะ" ที่กราฟปริมาณตอบอยู่แล้ว — ตำบลใหญ่มีจำนวน
 * ส่งเยอะได้ทั้งที่สัดส่วนต่ำ ถ้าดูแต่จำนวนจะเข้าใจผิดว่าที่นั่นเข้าถึงดีที่สุด
 *
 * @param minVisits ตัดกลุ่มที่มีคนมารับบริการน้อยเกินไปทิ้ง — ฐานเล็กทำให้ % แกว่ง
 *                  จนไม่มีความหมาย (มา 3 ครั้ง ส่ง 1 ครั้ง = 33%)
 */
export function UptakeChart({
  rows,
  minVisits = 100,
  limit = 12,
  target,
}: {
  rows: DeliveryGroupStat[]
  minVisits?: number
  limit?: number
  /** เส้นอ้างอิง เช่น ค่าเฉลี่ยรวมทั้งโรงพยาบาล */
  target?: number
}) {
  const top = rows
    .filter(row => row.visits >= minVisits)
    .sort((a, b) => pct(b) - pct(a))
    .slice(0, limit)

  return (
    <Chart
      height={Math.max(240, top.length * 26 + 60)}
      data={[top, target]}
      build={color => ({
        chart: { type: 'bar' },
        accessibility: {
          description:
            'สัดส่วนการมารับบริการที่จบด้วยการส่งยาถึงบ้าน คิดเป็นเปอร์เซ็นต์ เรียงจากสูงไปต่ำ',
        },
        xAxis: { categories: top.map(row => row.name) },
        yAxis: {
          min: 0,
          labels: { format: '{value}%' },
          plotLines:
            target == null
              ? undefined
              : [
                  {
                    value: target,
                    color: color.warn,
                    width: 2,
                    dashStyle: 'Dash',
                    zIndex: 5,
                    label: {
                      text: `เฉลี่ยรวม ${target.toFixed(1)}%`,
                      style: { color: color.warn, fontSize: '10px' },
                    },
                  },
                ],
        },
        tooltip: {
          pointFormat: '<b>{point.y:.1f}%</b><br/>ส่งยา {point.delivered} จาก {point.visits} ครั้ง',
        },
        plotOptions: { bar: { borderWidth: 0, pointPadding: 0.08 } },
        series: [
          {
            type: 'bar',
            name: 'สัดส่วนที่ส่งยาถึงบ้าน',
            color: color.good,
            data: top.map(row => ({
              y: pct(row),
              delivered: row.delivered,
              visits: row.visits,
            })),
          },
        ],
      })}
    />
  )
}

/** ชุดสีสำหรับกราฟซ้อน — ไล่โทนให้ต่างกันพอจะแยกออกด้วยตาโดยไม่ต้องพึ่งป้าย */
function stackColors(dark: boolean) {
  return dark
    ? ['#a78bfa', '#38bdf8', '#34d399', '#fbbf24', '#fb7185', '#f472b6', '#22d3ee', '#a3e635', '#fb923c', '#94a3b8']
    : ['#7c3aed', '#0369a1', '#047857', '#b45309', '#be123c', '#9d174d', '#0e7490', '#4d7c0f', '#c2410c', '#64748b']
}

/** จำนวนตำบลที่แยกเป็นสีของตัวเอง ที่เหลือยุบเป็น "ตำบลอื่น" */
const STACK_LIMIT = 9

/**
 * ภาระงานรายบุคคล แยกเป็นชั้นตามตำบลที่ไปส่ง
 *
 * ความยาวแท่งคืองานรวมของคนนั้น ชั้นสีบอกว่างานกระจายไปกี่ตำบล — คนที่แท่งเดียว
 * สีเดียวคือรับผิดชอบพื้นที่เดียว ส่วนคนที่มีหลายสีคือวิ่งข้ามตำบล ซึ่งเป็นสัญญาณ
 * ว่าพื้นที่นั้นอาจไม่มีคนรับผิดชอบพอ
 *
 * ระดับหมู่ไม่ทำเป็นชั้นแยก เพราะหนึ่งตำบลมีสิบกว่าหมู่ ป้ายสีจะเกินร้อยรายการ
 * จนอ่านไม่ได้ — ใส่ไว้ในคำอธิบายเมื่อชี้แทน
 */
export function RiderLoadChart({ byRiderArea }: { byRiderArea: DeliveryRiderAreaStat[] }) {
  const { riders, tambons, cell, moos } = useMemo(() => {
    const riderTotal = new Map<string, number>()
    const tambonTotal = new Map<string, number>()
    // นับต่อคู่ (คน, ตำบล) และเก็บรายละเอียดหมู่ไว้โชว์ตอนชี้
    const cell = new Map<string, number>()
    const moos = new Map<string, { moo: string; visits: number }[]>()

    for (const row of byRiderArea) {
      riderTotal.set(row.riderName, (riderTotal.get(row.riderName) ?? 0) + row.visits)
      tambonTotal.set(row.tambon, (tambonTotal.get(row.tambon) ?? 0) + row.visits)
      const key = `${row.riderName}|${row.tambon}`
      cell.set(key, (cell.get(key) ?? 0) + row.visits)
      moos.set(key, [...(moos.get(key) ?? []), { moo: row.moo, visits: row.visits }])
    }

    const riders = [...riderTotal.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name]) => name)
    const ranked = [...tambonTotal.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name)
    const tambons = ranked.length > STACK_LIMIT ? [...ranked.slice(0, STACK_LIMIT), 'ตำบลอื่น'] : ranked

    return { riders, tambons, cell, moos, ranked }
  }, [byRiderArea])

  /** ยอดของช่อง (คน, ตำบล) — คอลัมน์ 'ตำบลอื่น' รวมทุกตำบลที่ไม่ได้มีสีของตัวเอง */
  const valueOf = (rider: string, tambon: string) => {
    if (tambon !== 'ตำบลอื่น') return cell.get(`${rider}|${tambon}`) ?? 0
    let sum = 0
    for (const [key, visits] of cell) {
      const [name, area] = key.split('|')
      if (name === rider && !tambons.includes(area)) sum += visits
    }
    return sum
  }

  /** 'ม.2 (26), ม.6 (22)' — เรียงจากมากไปน้อย เอาแค่ห้าอันดับแรกพอ */
  const mooOf = (rider: string, tambon: string) => {
    if (tambon === 'ตำบลอื่น') return ''
    const list = [...(moos.get(`${rider}|${tambon}`) ?? [])].sort((a, b) => b.visits - a.visits)
    return list
      .slice(0, 5)
      .map(item => (item.moo === '-' ? `ไม่ระบุหมู่ (${item.visits})` : `ม.${item.moo} (${item.visits})`))
      .join(', ')
  }

  return (
    <Chart
      height={Math.max(280, riders.length * 30 + 90)}
      data={byRiderArea}
      build={(_color, dark) => ({
        chart: { type: 'bar' },
        accessibility: {
          description: 'จำนวนครั้งที่แต่ละคนรับไปส่ง แยกเป็นชั้นตามตำบลปลายทาง',
        },
        xAxis: { categories: riders },
        yAxis: { min: 0, reversedStacks: false },
        legend: { enabled: true },
        tooltip: {
          headerFormat: '<span style="font-size:11px">{point.key}</span><br/>',
          pointFormat: '{series.name}: <b>{point.y}</b> ครั้ง<br/><span style="opacity:.75">{point.moo}</span>',
        },
        plotOptions: { bar: { stacking: 'normal', borderWidth: 0, pointPadding: 0.06 } },
        series: tambons.map((tambon, index) => ({
          type: 'bar' as const,
          name: tambon,
          color: stackColors(dark)[index % 10],
          data: riders.map(rider => ({ y: valueOf(rider, tambon), moo: mooOf(rider, tambon) })),
        })),
      })}
    />
  )
}

/** สัดส่วนงานตามประเภทเจ้าหน้าที่ — อสม. กับ จนท.รพ. แบ่งกันคนละเท่าไร */
export function RoleShareChart({ byRider }: { byRider: DeliveryRiderStat[] }) {
  const byRole = new Map<string, number>()
  for (const rider of byRider) {
    byRole.set(rider.roleName, (byRole.get(rider.roleName) ?? 0) + rider.visits)
  }
  const slices = [...byRole.entries()].sort((a, b) => b[1] - a[1])

  return (
    <Chart
      height={240}
      data={slices}
      build={color => ({
        chart: { type: 'pie' },
        accessibility: { description: 'สัดส่วนจำนวนครั้งที่ส่ง แยกตามประเภทของเจ้าหน้าที่' },
        tooltip: { pointFormat: '<b>{point.y}</b> ครั้ง ({point.percentage:.0f}%)' },
        plotOptions: {
          pie: {
            innerSize: '62%',
            borderWidth: 0,
            dataLabels: {
              style: { color: color.ink, fontSize: '11px', textOutline: 'none', fontWeight: '500' },
              format: '{point.name}<br/>{point.percentage:.0f}%',
            },
          },
        },
        series: [
          {
            type: 'pie',
            name: 'จำนวนครั้ง',
            colors: [color.good, color.info, color.warn, color.bad, color.neutral],
            data: slices.map(([name, visits]) => ({ name, y: visits })),
          },
        ],
      })}
    />
  )
}
