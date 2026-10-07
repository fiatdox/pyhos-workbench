'use client'
import { useEffect, useMemo, useRef } from 'react'
import Highcharts from 'highcharts/esm/highcharts'
// ต้องนำเข้าจาก 'highcharts/esm/*' ทั้งตัวหลักและโมดูล — ไฟล์ใน 'highcharts/modules/*'
// เป็นบิลด์ UMD ที่อ่าน instance จากตัวแปร global ซึ่งไม่มีเมื่อถูก bundle ใน Next
// (เหตุผลเต็มอยู่ที่ app/home/health-rider/dashboard/charts.tsx)
import 'highcharts/esm/modules/accessibility'
// แกนสีสำหรับกราฟรายพื้นที่ — ใช้กับกราฟธรรมดาได้ ไม่ได้มีแต่ในแผนที่
import 'highcharts/esm/modules/coloraxis'
import HighchartsReact from 'highcharts-react-official'
import { useTheme } from '@/app/theme'

/**
 * กราฟของหน้า Service Plan สาขาโรคหลอดเลือดสมอง
 *
 * สองคำถามคนละอย่างจึงเป็นสองแบบ: "อัตราตายถึงเกณฑ์หรือยัง" เป็นแท่งซ้อน
 * จำนวนรายแยกสีผู้เสียชีวิต คู่กับเส้นร้อยละบนแกนขวาและเส้นเกณฑ์ ส่วน
 * "ผู้ป่วยชนิดไหนมากขึ้น" เป็นแท่งซ้อนแยกตามชนิดของโรค
 */

/**
 * ชุดสีพาสเทลสดใสของหน้านี้ ผูกกับธีมสว่าง/มืดคนละชุด
 *
 * Highcharts รับได้แต่ค่าสีจริง ใส่ var() ของ CSS ไม่ได้ จึงต้องเขียนค่าไว้ทั้งสองชุด
 * ชุดมืดวางบนพื้น #0c0716 จึงเป็นพาสเทลอ่อนได้เต็มที่ ส่วนชุดสว่างวางบนพื้น #faf7ff
 * ต้องเข้มขึ้นอีกขั้นให้ยังเห็นเป็นรูปทรงชัดบนพื้นขาว — พาสเทลตัวเดียวกันทั้งสองโหมด
 * จะจมหายไปในโหมดใดโหมดหนึ่งเสมอ
 *
 * แดงสงวนไว้ให้ "เสียชีวิต" อย่างเดียว กราฟแยกชนิดโรคจึงใช้ส้มพีชกับฟ้า (อุ่น/เย็น)
 * ไม่ใช้แดงกับชนิดเลือดออก ทั้งที่ชื่อชวนให้ใช้ — ไม่งั้นสีแดงจะมีสองความหมายใน
 * หน้าเดียวกัน แล้วแถบแดงในกราฟหนึ่งจะถูกอ่านว่าเป็นผู้เสียชีวิตของอีกกราฟ
 */
function palette(dark: boolean) {
  return dark
    ? {
        ink: '#cbd5e1',
        faint: '#94a3b8',
        grid: 'rgba(255,255,255,0.08)',
        tooltipBg: '#1b1033',
        /* ผู้ป่วยที่รอดชีวิต — มิ้นต์ */
        alive: '#6ee7c7',
        /* ผู้เสียชีวิต — กุหลาบอ่อน */
        bad: '#fda4af',
        /* เส้นอัตราตาย — ม่วงเดียวกับ --accent-strong ของธีม */
        accent: '#c4b5fd',
        /* เส้นเกณฑ์ — เหลืองอำพัน */
        target: '#fcd34d',
        /* ชนิดเลือดออก — พีช */
        bleed: '#fdba74',
        /* ชนิดตีบ/อุดตัน — ฟ้า */
        isch: '#93c5fd',
        /* กลุ่มที่ไม่เข้าพวก — เทาอมม่วง ไม่ใช่เทาเย็นที่หลุดจากโทนทั้งหน้า */
        neutral: '#b4aecd',
        /* ไล่สีของแกนสีรายพื้นที่ — บนพื้นมืด ยิ่งสว่างยิ่งเด่น ค่ามากจึงสว่างกว่า */
        rampLow: '#2f5c87',
        rampMid: '#5fa8e8',
        rampHigh: '#c7e9ff',
      }
    : {
        ink: '#4b4165',
        faint: '#78708f',
        grid: 'rgba(124,58,237,0.12)',
        tooltipBg: '#ffffff',
        alive: '#3bc6a9',
        bad: '#f87f93',
        accent: '#8b5cf6',
        /* เส้นสองเส้นนี้เข้มกว่าสีพื้นที่ระบายในโหมดสว่าง เพราะเส้นหนา 2px มีพื้นที่
           ให้ตาจับน้อยกว่าแท่งมาก วัดคอนทราสต์บนพื้น #faf7ff แล้ว: เส้นเกณฑ์ 3.0
           เส้นอัตราตาย 4.0 ส่วนสีของแท่งอยู่ที่ 2.0-2.4 ซึ่งพอสำหรับพื้นที่ใหญ่ */
        target: '#c97f1a',
        bleed: '#f0a267',
        isch: '#5bb0ef',
        neutral: '#bfb8d4',
        /* บนพื้นขาวกลับทิศ — ยิ่งเข้มยิ่งเด่น ค่ามากจึงเข้มกว่า */
        rampLow: '#d6e9f9',
        rampMid: '#5bb0ef',
        rampHigh: '#1d6aa8',
      }
}

type Palette = ReturnType<typeof palette>

/**
 * ช่วงเวลาหนึ่งช่วงบนแกนนอน — ปีงบหรือเดือน แล้วแต่มุมมองที่หน้าจอเลือก
 *
 * กราฟไม่รู้ว่ากำลังวาดปีหรือเดือน รับมาแต่ป้ายที่เตรียมไว้แล้วสองแบบ: label
 * สำหรับแกนนอนซึ่งต้องสั้น และ title สำหรับหัวกล่องคำอธิบายซึ่งเขียนเต็มได้
 * การให้กราฟตัดสินใจเองว่าจะเรียกช่วงว่าอะไรแปลว่าต้องมีสองเส้นทางในทุกกราฟ
 *
 * partial = ช่วงที่ยังไม่จบ แท่งจะจางกว่าช่วงอื่นและป้ายแกนมีดอกจันต่อท้าย
 * ไม่ได้ซ่อน เพราะการหายไปเฉย ๆ ทำให้คนอ่านคิดว่าระบบยังไม่อัปเดต แต่ก็วางให้
 * เท่ากับช่วงที่ครบแล้วไม่ได้ เพราะยังนับไม่ครบและเวชระเบียนยังลงรหัสตามหลังอยู่
 */
type PeriodPoint = {
  /** ป้ายสั้นสำหรับแกนนอน เช่น '2569' หรือ 'ม.ค. 69' */
  label: string
  /** ป้ายเต็มสำหรับกล่องคำอธิบาย เช่น 'ปีงบ 2569' หรือ 'ม.ค. 2569' */
  title: string
  partial?: boolean
}

/** ความจางของแท่งช่วงที่ยังไม่จบ */
const PARTIAL_OPACITY = 0.35

/** ป้ายแกนนอน — ช่วงที่ยังไม่จบมีดอกจันต่อท้าย */
const axisLabel = (point: PeriodPoint) => (point.partial ? `${point.label}*` : point.label)

/** ผลหนึ่งช่วงเวลาของกลุ่มรหัสหนึ่งกลุ่ม */
export type MortalityPoint = PeriodPoint & {
  /** ร้อยละการเสียชีวิต — null เมื่อไม่มีผู้ป่วยเลยในช่วงนั้น */
  percent: number | null
  dead: number
  total: number
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

const nf = new Intl.NumberFormat('th-TH')

/**
 * อัตราตายรายปีงบเทียบกับเกณฑ์ — แท่งซ้อนจำนวนราย คู่กับเส้นร้อยละ
 *
 * ความสูงรวมของแท่งคือผู้ป่วยทั้งหมดของปีนั้น ส่วนสีแดงคือจำนวนที่เสียชีวิต
 * จึงอ่านได้ทั้งขนาดของงานและผลลัพธ์จากรูปเดียว — สิ่งที่แท่งเดี่ยวแบบร้อยละ
 * บอกไม่ได้คือปีที่อัตราเท่ากันแต่ผู้ป่วยต่างกันเป็นร้อยราย
 *
 * ร้อยละอยู่บนแกนขวาเป็นเส้น ไม่ใช่แท่ง เพราะมันเป็นผลของสองแท่งที่อยู่ข้างใต้
 * ไม่ใช่ปริมาณอีกชนิดที่เอามาวางเทียบกันได้ เส้นเกณฑ์จึงอยู่บนแกนเดียวกับเส้นนี้
 */
export function MortalityChart({
  points,
  target,
}: {
  points: MortalityPoint[]
  /** เกณฑ์ร้อยละ "ไม่เกิน" — null = ยังไม่ได้ตั้งเกณฑ์ไว้ ไม่ลากเส้นเกณฑ์ */
  target: number | null
}) {
  return (
    <Chart
      height={260}
      data={{ points, target }}
      build={color => ({
        chart: { type: 'column' },
        accessibility: {
          description:
            'จำนวนผู้ป่วยในโรคหลอดเลือดสมองแยกตามช่วงเวลา แท่งซ้อนแยกผู้ที่รอดชีวิตกับผู้ที่เสียชีวิต และเส้นร้อยละการเสียชีวิตเทียบกับเกณฑ์',
        },
        xAxis: { categories: points.map(axisLabel), crosshair: true },
        yAxis: [
          { min: 0, labels: { style: { color: color.faint, fontSize: '11px' } } },
          {
            min: 0,
            opposite: true,
            // เผื่อเหนือค่าที่สูงสุดระหว่างเกณฑ์กับตัวเลขจริง ให้ป้ายเส้นเกณฑ์มีที่วาง
            softMax: target == null ? undefined : target * 1.4,
            title: { text: undefined },
            gridLineWidth: 0,
            labels: { format: '{value}%', style: { color: color.faint, fontSize: '11px' } },
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
                        text: `เกณฑ์ไม่เกิน ${target}%`,
                        align: 'right',
                        x: -4,
                        y: -4,
                        style: { color: color.target, fontSize: '10px' },
                      },
                    },
                  ],
          },
        ],
        legend: { enabled: true },
        tooltip: {
          useHTML: true,
          formatter() {
            const point = points[this.index]
            if (point == null) return ''
            const partial = point.partial ? ' (ยังไม่จบช่วง)' : ''
            if (point.percent == null) {
              return (
                `<b>${point.title}${partial}</b><br/>` +
                (point.partial ? 'ยังไม่มีข้อมูลที่ลงรหัสแล้ว' : 'ไม่มีผู้ป่วยในช่วงนี้')
              )
            }
            // ปีที่ยังไม่จบไม่ตัดสินผ่าน/ไม่ผ่าน ตัวเลขยังขยับได้อีกมาก
            const verdict =
              target == null || point.partial
                ? ''
                : `<br/>${point.percent <= target ? '✓ ผ่านเกณฑ์' : '✗ ไม่ผ่านเกณฑ์'}`
            return (
              `<b>${point.title}${partial}</b><br/>` +
              `ผู้ป่วย ${nf.format(point.total)} ราย<br/>` +
              `เสียชีวิต ${nf.format(point.dead)} ราย = ${point.percent.toFixed(2)}%${verdict}`
            )
          },
        },
        plotOptions: { column: { stacking: 'normal', borderWidth: 0, groupPadding: 0.12 } },
        series: [
          {
            type: 'column',
            name: 'รอดชีวิต',
            color: color.alive,
            yAxis: 0,
            // ลำดับในกองวางผู้เสียชีวิตไว้บน ให้ทุกปีวัดส่วนแดงจากยอดแท่งเท่ากัน
            data: points.map(point => ({
              y: Math.max(point.total - point.dead, 0),
              opacity: point.partial ? PARTIAL_OPACITY : 1,
            })),
          },
          {
            type: 'column',
            name: 'เสียชีวิต',
            color: color.bad,
            yAxis: 0,
            data: points.map(point => ({
              y: point.dead,
              opacity: point.partial ? PARTIAL_OPACITY : 1,
            })),
          },
          {
            type: 'line',
            name: 'อัตราตาย',
            color: color.accent,
            yAxis: 1,
            lineWidth: 2,
            marker: { radius: 3 },
            data: points.map(point =>
              point.percent == null ? null : Number(point.percent.toFixed(2)),
            ),
            tooltip: { valueSuffix: '%' },
          },
        ],
      })}
    />
  )
}

export type ResourcePoint = PeriodPoint & {
  /** ค่าเฉลี่ยต่อผู้ป่วยหนึ่งราย — null เมื่อช่วงนั้นไม่มีผู้ป่วย */
  average: number | null
  /** ยอดรวมของทั้งช่วง */
  total: number
  patients: number
}

/**
 * ค่าเฉลี่ยต่อรายรายปีงบ คู่กับจำนวนผู้ป่วย
 *
 * ต้องมีจำนวนผู้ป่วยอยู่ในรูปเดียวกัน ไม่งั้นค่าเฉลี่ยที่ลดลงจะถูกอ่านว่าดีขึ้นเสมอ
 * ทั้งที่อาจเป็นเพราะปีนั้นรับผู้ป่วยอาการเบากว่าเข้ามามากขึ้น — ปีงบ 2569 เป็น
 * ตัวอย่างตรง ๆ วันนอนเฉลี่ยลดลงพร้อมกับผู้ป่วยที่เพิ่มขึ้นเกือบร้อยราย
 */
export function ResourceChart({
  points,
  unit,
  pairTotal = false,
}: {
  points: ResourcePoint[]
  unit: 'days' | 'baht'
  /**
   * วางแท่งยอดรวมคู่กับแท่งค่าเฉลี่ย
   *
   * ยอดรวมกับค่าเฉลี่ยต่างกันหลักพันเท่า (สี่หมื่นกับสี่สิบล้าน) จึงอยู่คนละแกน
   * และยอดรวมแปลงเป็นล้านบาทก่อนวาด ไม่งั้นแท่งค่าเฉลี่ยจะแบนติดพื้นจนไม่เห็น
   * สองแท่งนี้ตอบคนละคำถาม — เฉลี่ยคือ "ผู้ป่วยหนึ่งรายใช้ทรัพยากรแค่ไหน"
   * ส่วนยอดรวมคือ "โรคนี้กินทรัพยากรของโรงพยาบาลไปเท่าไร"
   */
  pairTotal?: boolean
}) {
  const unitLabel = unit === 'days' ? 'วัน' : 'บาท'
  const decimals = unit === 'days' ? 2 : 0
  /** ยอดรวมค่าบริการวาดเป็นล้านบาท ตัวเลขหลักสิบล้านบนแกนอ่านยากกว่าที่ควร */
  const totalScale = unit === 'baht' ? 1_000_000 : 1
  const totalUnit = unit === 'baht' ? 'ล้านบาท' : 'วัน'
  return (
    <Chart
      height={260}
      data={{ points, unit }}
      build={color => ({
        chart: { type: 'column' },
        accessibility: {
          description:
            unit === 'days'
              ? 'วันนอนเฉลี่ยต่อรายของผู้ป่วยในโรคหลอดเลือดสมองแยกตามช่วงเวลา'
              : 'ค่าบริการเฉลี่ยต่อรายของผู้ป่วยในโรคหลอดเลือดสมองแยกตามช่วงเวลา คู่กับยอดรวมค่าบริการ',
        },
        xAxis: { categories: points.map(axisLabel), crosshair: true },
        yAxis: [
          {
            min: 0,
            labels: {
              format: unit === 'days' ? '{value}' : '{value:,.0f}',
              style: { color: color.faint, fontSize: '11px' },
            },
          },
          {
            min: 0,
            opposite: true,
            title: { text: undefined },
            gridLineWidth: 0,
            labels: {
              format: pairTotal && unit === 'baht' ? '{value} ล.' : '{value}',
              style: { color: color.faint, fontSize: '11px' },
            },
          },
        ],
        legend: { enabled: true },
        tooltip: {
          useHTML: true,
          formatter() {
            const point = points[this.index]
            if (point == null) return ''
            const partial = point.partial ? ' (ยังไม่จบช่วง)' : ''
            if (point.average == null) {
              return (
                `<b>${point.title}${partial}</b><br/>` +
                (point.partial ? 'ยังไม่มีข้อมูลที่ลงรหัสแล้ว' : 'ไม่มีผู้ป่วยในช่วงนี้')
              )
            }
            return (
              `<b>${point.title}${partial}</b><br/>` +
              `เฉลี่ย ${point.average.toLocaleString('th-TH', {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals,
              })} ${unitLabel}/ราย<br/>` +
              `รวม ${nf.format(Math.round(point.total))} ${unitLabel} · ผู้ป่วย ${nf.format(point.patients)} ราย`
            )
          },
        },
        plotOptions: { column: { borderWidth: 0, groupPadding: 0.12 } },
        series: [
          {
            type: 'column',
            name: unit === 'days' ? 'วันนอนเฉลี่ย/ราย' : 'ค่าบริการเฉลี่ย/ราย',
            color: unit === 'days' ? color.isch : color.bleed,
            yAxis: 0,
            data: points.map(point =>
              point.average == null
                ? null
                : {
                    y: Number(point.average.toFixed(decimals)),
                    opacity: point.partial ? PARTIAL_OPACITY : 1,
                  },
            ),
          },
          // แท่งยอดรวมหรือเส้นจำนวนผู้ป่วย อย่างใดอย่างหนึ่ง ไม่ใส่ทั้งคู่ —
          // สามชุดข้อมูลบนสองแกนในกราฟเดียวอ่านไม่ออก และจำนวนผู้ป่วยยังเห็นได้
          // จากกราฟจำนวนผู้ป่วยรายช่วงที่อยู่ด้านบนอยู่แล้ว
          pairTotal
            ? {
                type: 'column' as const,
                name: `ยอดรวม (${totalUnit})`,
                color: color.accent,
                yAxis: 1,
                data: points.map(point => ({
                  y: Number((point.total / totalScale).toFixed(2)),
                  opacity: point.partial ? PARTIAL_OPACITY : 1,
                })),
              }
            : {
                type: 'line' as const,
                name: 'จำนวนผู้ป่วย',
                color: color.accent,
                yAxis: 1,
                lineWidth: 2,
                marker: { radius: 3 },
                data: points.map(point => point.patients),
              },
        ],
      })}
    />
  )
}

export type VolumePoint = PeriodPoint & {
  hemorrhagic: number
  ischemic: number
  /** I62x ที่อยู่ในกลุ่มใหญ่แต่ตกช่องว่างระหว่างสองกลุ่มย่อย */
  other: number
}

/** จำนวนผู้ป่วยในรายปีงบ แยกชนิด — แท่งซ้อนเพื่อให้ความสูงรวมคือทั้งกลุ่มโรค */
export function VolumeChart({ points }: { points: VolumePoint[] }) {
  return (
    <Chart
      height={240}
      data={points}
      build={color => ({
        chart: { type: 'column' },
        accessibility: {
          description:
            'จำนวนผู้ป่วยในโรคหลอดเลือดสมองที่จำหน่ายในแต่ละช่วงเวลา แยกเป็นชนิดเลือดออก ชนิดตีบหรืออุดตัน และรหัส I62x ที่ไม่อยู่ในกลุ่มย่อยทั้งสอง',
        },
        xAxis: { categories: points.map(axisLabel), crosshair: true },
        yAxis: { min: 0 },
        legend: { enabled: true },
        tooltip: { shared: true, valueSuffix: ' ราย' },
        plotOptions: { column: { stacking: 'normal', borderWidth: 0, groupPadding: 0.12 } },
        series: [
          {
            type: 'column',
            name: 'เลือดออก (I60-I62)',
            color: color.bleed,
            data: points.map(point => ({
              y: point.hemorrhagic,
              opacity: point.partial ? PARTIAL_OPACITY : 1,
            })),
          },
          {
            type: 'column',
            name: 'ตีบ/อุดตัน (I63-I69)',
            color: color.isch,
            data: points.map(point => ({
              y: point.ischemic,
              opacity: point.partial ? PARTIAL_OPACITY : 1,
            })),
          },
          {
            type: 'column',
            name: 'I62x (ไม่อยู่ในกลุ่มย่อย)',
            color: color.neutral,
            data: points.map(point => ({
              y: point.other,
              opacity: point.partial ? PARTIAL_OPACITY : 1,
            })),
          },
        ],
      })}
    />
  )
}

export type AreaPoint = {
  /** รหัสอำเภอหรือตำบล ใช้เป็นค่าที่ส่งกลับตอนคลิก */
  id: string
  name: string
  patients: number
  /** ไม่ส่งมา = ไม่แสดงบรรทัดการเสียชีวิตในคำอธิบาย (หน้า Stroke ไม่ได้แยกตาย) */
  dead?: number
}

/**
 * ผู้ป่วยแยกตามพื้นที่ที่อยู่ — แท่งนอน เรียงจากมากไปน้อย พร้อมแกนสีและตัวเลขกำกับ
 *
 * แกนสีทำให้ลำดับความหนาแน่นอ่านได้โดยไม่ต้องไล่ความยาวของแท่งทีละอัน และตัวเลข
 * ที่ปลายแท่งทำให้ไม่ต้องเอาเมาส์ไปชี้เพื่อรู้ค่า — สองอย่างนี้สำคัญกับกราฟพื้นที่
 * มากกว่ากราฟตามเวลา เพราะคนอ่านกราฟพื้นที่มาหา "ที่ไหนมากที่สุด" ไม่ได้มาดูรูปทรง
 *
 * แท่งนอนเพราะชื่ออำเภอกับตำบลเป็นภาษาไทยที่ยาวกว่าจะวางใต้แท่งตั้งได้โดยไม่ต้อง
 * เอียงตัวอักษร และจำนวนพื้นที่ (เก้าอำเภอ หรือสิบกว่าตำบล) พอดีกับการไล่สายตา
 * จากบนลงล่าง
 *
 * onSelect ทำให้แท่งกดได้เพื่อเจาะลงตำบล — เก็บ callback ไว้ใน ref เพราะ
 * Highcharts จำ options ชุดที่สร้างตอน mount ไว้ ถ้าผูกฟังก์ชันตรง ๆ การคลิกจะ
 * ไปเรียก callback ของ render รอบแรกตลอด แล้วค่าที่ปิดทับอยู่ข้างในจะเก่าค้าง
 */
export function AreaChart({
  points,
  total,
  onSelect,
  shareLabel = 'ของผู้ป่วยในจังหวัด',
  description = 'จำนวนผู้ป่วยในแยกตามพื้นที่ที่อยู่ตามทะเบียนบ้าน เรียงจากมากไปน้อย',
}: {
  points: AreaPoint[]
  /** ตัวหารของสัดส่วนในคำอธิบาย — ผู้ป่วยในจังหวัดทั้งหมดของช่วงนั้น */
  total: number
  /** ไม่ส่งมา = แท่งกดไม่ได้ (ชั้นตำบลไม่มีชั้นถัดไปให้เจาะ) */
  onSelect?: (id: string) => void
  /** ข้อความต่อท้ายร้อยละในคำอธิบาย — บอกว่าสัดส่วนนี้เทียบกับอะไร */
  shareLabel?: string
  description?: string
}) {
  const select = useRef(onSelect)
  // อัปเดตใน effect ไม่ใช่ระหว่าง render — การเขียน ref ตอน render ทำให้ผลของการ
  // render ขึ้นกับลำดับการเรียก ซึ่ง React ไม่รับประกัน (และ eslint ห้ามไว้)
  useEffect(() => {
    select.current = onSelect
  }, [onSelect])

  const most = points.reduce((max, point) => Math.max(max, point.patients), 0)

  return (
    <Chart
      // สูงขึ้นกว่าเดิมเล็กน้อยเพราะมีแถบแกนสีกินที่ด้านล่าง
      height={Math.max(240, points.length * 26 + 84)}
      data={{ points, total, clickable: onSelect != null, shareLabel, description }}
      build={color => ({
        chart: { type: 'bar' },
        accessibility: { description },
        xAxis: { categories: points.map(point => point.name) },
        // เผื่อที่ปลายแกนให้ตัวเลขกำกับที่อยู่นอกแท่ง ไม่ให้ถูกตัดที่ขอบกราฟ
        yAxis: { min: 0, max: most === 0 ? undefined : Math.ceil(most * 1.12), title: { text: undefined } },
        /**
         * แกนสีไล่ตามจำนวนผู้ป่วย
         *
         * ไล่จากศูนย์เสมอ ไม่ได้ไล่จากค่าต่ำสุดที่มีจริง — ถ้าเริ่มที่ค่าต่ำสุด
         * พื้นที่ที่มีผู้ป่วยน้อยที่สุดจะได้สีอ่อนสุดเท่ากันทุกครั้งที่เปลี่ยนช่วงเวลา
         * ทั้งที่จำนวนจริงต่างกัน แล้วสีจะกลายเป็นลำดับที่ ไม่ใช่ปริมาณ
         */
        colorAxis: {
          min: 0,
          max: most === 0 ? 1 : most,
          stops: [
            [0, color.rampLow],
            [0.5, color.rampMid],
            [1, color.rampHigh],
          ],
          labels: { style: { color: color.faint, fontSize: '10px' } },
          lineColor: color.grid,
          gridLineColor: color.grid,
          tickLength: 0,
        },
        legend: {
          enabled: true,
          align: 'center',
          verticalAlign: 'bottom',
          layout: 'horizontal',
          symbolWidth: 220,
          symbolHeight: 10,
          margin: 4,
          itemStyle: { color: color.faint, fontSize: '10px' },
        },
        tooltip: {
          useHTML: true,
          formatter() {
            const point = points[this.index]
            if (point == null) return ''
            const share = total > 0 ? ((point.patients / total) * 100).toFixed(1) : null
            const rate =
              point.dead == null || point.patients === 0
                ? null
                : ((point.dead / point.patients) * 100).toFixed(1)
            return (
              `<b>${point.name}</b><br/>` +
              `${nf.format(point.patients)} ราย` +
              (point.dead == null
                ? ''
                : `<br/>เสียชีวิต ${nf.format(point.dead)} ราย${rate == null ? '' : ` = ${rate}%`}`) +
              (share == null ? '' : `<br/>${share}% ${shareLabel}`) +
              (select.current == null ? '' : '<br/><i>กดเพื่อดูรายตำบล</i>')
            )
          },
        },
        plotOptions: {
          bar: {
            borderWidth: 0,
            groupPadding: 0.08,
            // ตัวเลขอยู่นอกปลายแท่ง ไม่ใช่ข้างใน — แท่งสั้น ๆ ของตำบลเล็กไม่มีที่
            // พอให้ตัวเลขอยู่ข้างใน และถ้าสลับไปมาตามความยาวจะอ่านยากกว่าเดิม
            dataLabels: {
              enabled: true,
              inside: false,
              crop: false,
              overflow: 'allow',
              style: { color: color.ink, fontSize: '11px', fontWeight: '500', textOutline: 'none' },
              formatter() {
                return nf.format(Number(this.y ?? 0))
              },
            },
          },
          series: {
            cursor: onSelect == null ? undefined : 'pointer',
            point: {
              events: {
                click() {
                  const point = points[this.index]
                  if (point != null) select.current?.(point.id)
                },
              },
            },
          },
        },
        series: [
          {
            type: 'bar',
            name: 'ผู้ป่วย (ราย)',
            // ไม่กำหนดสีของชุดข้อมูล ปล่อยให้แกนสีเป็นคนให้สีรายจุด
            colorKey: 'y',
            data: points.map(point => point.patients),
          },
        ],
      })}
    />
  )
}

export type GroupPoint = {
  /** ชื่อที่ขึ้นบนแกน */
  name: string
  total: number
  dead: number
}

/**
 * เทียบหลายกลุ่มในช่วงเดียว — แท่งนอนคู่ จำนวนผู้ป่วยกับจำนวนที่เสียชีวิต
 *
 * ใช้กับกลุ่มที่ "ซ้อนกันได้" เช่นตำแหน่งการติดเชื้อของผู้ป่วย sepsis ซึ่งผู้ป่วย
 * คนเดียวติดได้หลายตำแหน่ง — จึงต้องเป็นแท่งคู่แยกกัน ไม่ใช่แท่งซ้อน เพราะการ
 * ซ้อนสื่อว่าผลรวมมีความหมาย ซึ่งไม่จริงเมื่อกลุ่มทับกัน
 *
 * เรียงลำดับมาจากผู้เรียก ไม่ได้เรียงเอง — บางหน้าต้องการลำดับคงที่เพื่อให้ตา
 * จำตำแหน่งได้ระหว่างสลับช่วงเวลา บางหน้าต้องการเรียงตามจำนวน
 */
export function GroupChart({ points }: { points: GroupPoint[] }) {
  return (
    <Chart
      height={Math.max(240, points.length * 30 + 70)}
      data={points}
      build={color => ({
        chart: { type: 'bar' },
        accessibility: {
          description: 'จำนวนผู้ป่วยและจำนวนที่เสียชีวิตของแต่ละกลุ่ม เทียบกันเป็นแท่งคู่',
        },
        xAxis: { categories: points.map(point => point.name) },
        yAxis: { min: 0, title: { text: undefined } },
        legend: { enabled: true },
        tooltip: {
          useHTML: true,
          formatter() {
            const point = points[this.index]
            if (point == null) return ''
            const rate = point.total > 0 ? ((point.dead / point.total) * 100).toFixed(1) : null
            return (
              `<b>${point.name}</b><br/>` +
              `ผู้ป่วย ${nf.format(point.total)} ราย<br/>` +
              `เสียชีวิต ${nf.format(point.dead)} ราย` +
              (rate == null ? '' : ` = ${rate}%`)
            )
          },
        },
        plotOptions: { bar: { borderWidth: 0, groupPadding: 0.1, pointPadding: 0.02 } },
        series: [
          {
            type: 'bar',
            name: 'ผู้ป่วย',
            color: color.alive,
            data: points.map(point => point.total),
          },
          {
            type: 'bar',
            name: 'เสียชีวิต',
            color: color.bad,
            data: points.map(point => point.dead),
          },
        ],
      })}
    />
  )
}
