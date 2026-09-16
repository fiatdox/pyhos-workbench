'use client'
import { useMemo } from 'react'
import Highcharts from 'highcharts/esm/highcharts'
// ต้องนำเข้าจาก 'highcharts/esm/*' ทั้งตัวหลักและโมดูล — ไฟล์ใน 'highcharts/modules/*'
// เป็นบิลด์ UMD ที่อ่าน instance จากตัวแปร global ซึ่งไม่มีเมื่อถูก bundle ใน Next
// (เหตุผลเต็มอยู่ที่ app/home/health-rider/dashboard/charts.tsx)
import 'highcharts/esm/modules/accessibility'
import HighchartsReact from 'highcharts-react-official'
import { useTheme } from '@/app/theme'

/**
 * กราฟของหน้าสรุปเปรียบเทียบตัวชี้วัดสามปี
 *
 * ต่างจากกราฟในหน้าวิเคราะห์ตรงคำถาม — หน้านั้นถามว่า "ตัวเลขปีนี้มาจากไหน"
 * แยกตามห้องตรวจและแพทย์ ส่วนหน้านี้ถามว่า "ดีขึ้นหรือแย่ลงเทียบกับปีก่อน
 * และถึงเกณฑ์หรือยัง" จึงเป็นแท่งรายปีคู่กับเส้นเกณฑ์เส้นเดียว
 *
 * สีของแท่งบอกผ่าน/ไม่ผ่านทันที ไม่ต้องให้คนอ่านไปเทียบกับเส้นเอง — แต่จะทำได้
 * ต่อเมื่อมีเกณฑ์ ข้อที่ยังไม่ได้ตั้งเกณฑ์แท่งจะเป็นสีกลาง ๆ ทั้งแถบ
 */

function palette(dark: boolean) {
  return dark
    ? {
        ink: '#cbd5e1',
        faint: '#94a3b8',
        grid: 'rgba(255,255,255,0.08)',
        tooltipBg: '#1b1033',
        good: '#34d399',
        bad: '#fb7185',
        accent: '#a78bfa',
        neutral: '#64748b',
        target: '#fbbf24',
      }
    : {
        ink: '#4b4165',
        faint: '#78708f',
        grid: 'rgba(124,58,237,0.12)',
        tooltipBg: '#ffffff',
        good: '#047857',
        bad: '#be123c',
        accent: '#7c3aed',
        neutral: '#94a3b8',
        target: '#b45309',
      }
}

type Palette = ReturnType<typeof palette>

/** ผลหนึ่งปีงบของตัวชี้วัดหนึ่งข้อ */
export type YearPoint = {
  /** ปีงบประมาณ พ.ศ. */
  year: number
  /** ร้อยละ — null = ยังไม่ได้คำนวณ หรือไม่มีตัวหาร */
  percent: number | null
  numerator: number
  denominator: number
  /** ปีงบยังไม่จบ */
  partial: boolean
  /** ยังไม่เคยกดคำนวณปีนี้ */
  missing: boolean
}

function baseOptions(dark: boolean, height: number): Highcharts.Options {
  const color = palette(dark)
  return {
    chart: {
      height,
      backgroundColor: 'transparent',
      style: { fontFamily: 'inherit' },
      animation: false,
      spacing: [10, 6, 6, 2],
    },
    credits: { enabled: false },
    title: { text: undefined },
    legend: { enabled: false },
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
 * ตัวห่อร่วม — remount ตอนสลับธีมด้วย key={mode}
 *
 * Highcharts รับได้แต่ค่าสีจริง ใส่ var() ของ CSS ไม่ได้ จึงต้องสลับชุดสีเอง
 * และต้อง remount ไม่งั้นสีที่เขียนลง DOM ไปแล้วจะค้าง
 */
function Chart({
  height,
  data,
  build,
}: {
  height: number
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

/** ผ่านเกณฑ์หรือไม่ — null เมื่อยังไม่มีเกณฑ์หรือยังไม่มีตัวเลข */
export function meetsTarget(
  percent: number | null,
  target: number | null,
  goal: 'low' | 'high',
): boolean | null {
  if (percent == null || target == null) return null
  return goal === 'low' ? percent <= target : percent >= target
}

/**
 * ตัวชี้วัดหนึ่งข้อ เทียบสามปีงบ
 *
 * แกน y ไม่ได้ตรึงที่ 0–100 เหมือนกราฟแนวโน้มในหน้าวิเคราะห์ — ข้อที่ตัวเลขอยู่
 * แถว 2–5% (benzodiazepine, RAS) ถ้าตรึงเต็มร้อยแท่งจะแบนติดพื้นจนดูไม่ออกว่า
 * ปีไหนต่างกัน ซึ่งขัดกับจุดประสงค์ทั้งหมดของหน้านี้ ปล่อยให้ปรับตามข้อมูลแทน
 * แต่บังคับให้เริ่มที่ 0 เสมอ ไม่งั้นความต่างเล็ก ๆ จะถูกขยายจนเกินจริง
 */
export function YearlyChart({
  points,
  target,
  goal,
  unit,
}: {
  points: YearPoint[]
  /** เกณฑ์เป็นร้อยละ — null = ไม่ลากเส้น และแท่งจะไม่มีสีผ่าน/ไม่ผ่าน */
  target: number | null
  goal: 'low' | 'high'
  unit: 'visits' | 'patients' | 'admissions' | 'items'
}) {
  const unitLabel =
    unit === 'patients'
      ? 'คน'
      : unit === 'admissions'
        ? 'ราย'
        : unit === 'items'
          ? 'รายการยา'
          : 'ครั้ง'

  return (
    <Chart
      height={230}
      data={{ points, target, goal }}
      build={color => ({
        chart: { type: 'column' },
        xAxis: {
          categories: points.map(p => `${p.year}${p.partial ? '*' : ''}`),
          crosshair: true,
        },
        yAxis: {
          min: 0,
          labels: {
            format: '{value}%',
            style: { color: color.faint, fontSize: '11px' },
          },
          plotLines:
            target == null
              ? []
              : [
                  {
                    value: target,
                    color: color.target,
                    width: 2,
                    dashStyle: 'Dash',
                    zIndex: 5,
                    label: {
                      text: `เกณฑ์ ${goal === 'low' ? 'ไม่เกิน' : 'ตั้งแต่'} ${target}%`,
                      align: 'right',
                      x: -4,
                      y: -4,
                      style: { color: color.target, fontSize: '10px' },
                    },
                  },
                ],
        },
        tooltip: {
          useHTML: true,
          formatter() {
            const point = points[this.index]
            if (point == null) return ''
            if (point.missing) return `<b>ปีงบ ${point.year}</b><br/>ยังไม่ได้คำนวณ`
            if (point.percent == null) {
              return `<b>ปีงบ ${point.year}</b><br/>ไม่มีข้อมูล (ตัวหารเป็นศูนย์)`
            }
            const pass = meetsTarget(point.percent, target, goal)
            const verdict =
              pass == null ? '' : `<br/>${pass ? '✓ ผ่านเกณฑ์' : '✗ ไม่ผ่านเกณฑ์'}`
            return (
              `<b>ปีงบ ${point.year}${point.partial ? ' (ยังไม่จบปี)' : ''}</b><br/>` +
              `${point.percent.toFixed(2)}%<br/>` +
              `${point.numerator.toLocaleString('th-TH')} จาก ` +
              `${point.denominator.toLocaleString('th-TH')} ${unitLabel}${verdict}`
            )
          },
        },
        plotOptions: {
          column: {
            borderRadius: 3,
            borderWidth: 0,
            dataLabels: {
              enabled: true,
              // ปีที่ยังไม่ได้คำนวณกับปีที่ไม่มีข้อมูลต้องอ่านออกจากกัน ไม่ใช่ว่างทั้งคู่
              formatter() {
                const point = points[this.index]
                if (point?.missing === true) return 'ยังไม่คำนวณ'
                if (point?.percent == null) return '—'
                return `${point.percent.toFixed(1)}%`
              },
              style: { fontSize: '10px', fontWeight: '600', textOutline: 'none' },
              color: color.ink,
            },
          },
        },
        series: [
          {
            type: 'column',
            name: 'ร้อยละ',
            data: points.map(point => {
              const pass = meetsTarget(point.percent, target, goal)
              return {
                y: point.percent ?? 0,
                color: pass == null ? color.accent : pass ? color.good : color.bad,
                // ปีที่ยังไม่คำนวณวาดเป็นแท่งจาง ๆ ให้เห็นว่ามีช่องอยู่ แต่ยังไม่มีค่า
                opacity: point.missing ? 0.25 : 1,
              }
            }),
          },
        ],
      })}
    />
  )
}

/**
 * ภาพรวมทุกตัวชี้วัดในปีงบล่าสุดที่มีข้อมูล — แท่งนอนเรียงตามระยะห่างจากเกณฑ์
 *
 * ไม่ได้เอาร้อยละดิบมาเรียง เพราะข้อที่เกณฑ์คือ "ไม่เกิน 5%" กับข้อที่เกณฑ์คือ
 * "ตั้งแต่ 80%" เทียบกันตรง ๆ ไม่ได้เลย — ที่เทียบได้คือห่างจากเกณฑ์ของตัวเอง
 * กี่จุด ค่าบวกคือดีกว่าเกณฑ์ ค่าลบคือยังไม่ถึง
 */
export function GapChart({
  rows,
}: {
  rows: { label: string; gap: number; percent: number; target: number; goal: 'low' | 'high' }[]
}) {
  return (
    <Chart
      height={Math.max(220, rows.length * 38 + 60)}
      data={rows}
      build={color => ({
        chart: { type: 'bar' },
        xAxis: {
          categories: rows.map(r => r.label),
          labels: { style: { color: color.ink, fontSize: '11px' } },
        },
        yAxis: {
          title: { text: undefined },
          labels: { format: '{value}', style: { color: color.faint, fontSize: '11px' } },
          plotLines: [{ value: 0, color: color.faint, width: 1, zIndex: 5 }],
        },
        tooltip: {
          useHTML: true,
          formatter() {
            const row = rows[this.index]
            if (row == null) return ''
            return (
              `<b>${row.label}</b><br/>` +
              `ทำได้ ${row.percent.toFixed(2)}% · เกณฑ์ ${row.goal === 'low' ? 'ไม่เกิน' : 'ตั้งแต่'} ${row.target}%<br/>` +
              `${row.gap >= 0 ? 'ดีกว่าเกณฑ์' : 'ยังไม่ถึงเกณฑ์'} ${Math.abs(row.gap).toFixed(2)} จุด`
            )
          },
        },
        plotOptions: {
          bar: {
            borderRadius: 3,
            borderWidth: 0,
            dataLabels: {
              enabled: true,
              formatter() {
                const row = rows[this.index]
                return row == null ? '' : `${row.percent.toFixed(1)}%`
              },
              style: { fontSize: '10px', fontWeight: '600', textOutline: 'none' },
              color: color.ink,
            },
          },
        },
        series: [
          {
            type: 'bar',
            name: 'ห่างจากเกณฑ์ (จุด)',
            data: rows.map(row => ({
              y: row.gap,
              color: row.gap >= 0 ? color.good : color.bad,
            })),
          },
        ],
      })}
    />
  )
}
