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
 * กราฟของหน้าวิเคราะห์ตัวชี้วัด RDU
 *
 * ทุกกราฟตอบคำถามเดียวกันคือ "สัดส่วนที่ได้รับยาเป็นเท่าไร" แยกตามมุมที่ต่างกัน
 * จึงใช้โครงสีและรูปแบบชุดเดียวกันหมด — แท่งคือจำนวนครั้ง เส้นคือร้อยละ
 *
 * สีของร้อยละขึ้นกับทิศทางของตัวชี้วัด ไม่ได้ตายตัว: ข้อที่ยิ่งได้รับยายิ่งดี
 * (โรคหืด) กับข้อที่ยิ่งได้รับยายิ่งต้องทบทวน (RI, AD, RUA-URI) ต้องอ่านคนละทาง
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
        accent: '#a78bfa',
        neutral: '#64748b',
      }
    : {
        ink: '#4b4165',
        faint: '#78708f',
        grid: 'rgba(124,58,237,0.12)',
        tooltipBg: '#ffffff',
        good: '#047857',
        warn: '#b45309',
        bad: '#be123c',
        accent: '#7c3aed',
        neutral: '#94a3b8',
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
      shared: true,
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

/** ยอดหนึ่งกลุ่ม — ใช้ร่วมกันทุกกราฟที่แยกตามมิติ */
export type Bucket = { label: string; total: number; withDrug: number }

/** ร้อยละที่ได้รับยา คืน null เมื่อไม่มีตัวหาร */
const percentOf = (bucket: Bucket) =>
  bucket.total === 0 ? null : (bucket.withDrug * 100) / bucket.total

/**
 * แนวโน้มตามช่วงเวลา — แท่งคือจำนวนครั้ง เส้นคือร้อยละที่ได้รับยา
 *
 * แกนขวาตรึงที่ 0–100 เสมอ ไม่ปล่อยให้ Highcharts ปรับตามข้อมูล — ถ้าปล่อย
 * เดือนที่ร้อยละแกว่งนิดเดียวจะดูเหมือนแกว่งรุนแรง และเทียบข้ามช่วงไม่ได้
 */
export function TrendChart({
  buckets,
  drugLabel,
  target,
  followUp,
}: {
  buckets: Bucket[]
  drugLabel: string
  /** เกณฑ์เป้าหมายเป็นร้อยละ — ไม่มีก็ไม่ลากเส้น */
  target?: number
  followUp: 'with' | 'without'
}) {
  return (
    <Chart
      height={300}
      data={buckets}
      build={color => ({
        xAxis: { categories: buckets.map(b => b.label), crosshair: true },
        yAxis: [
          { labels: { style: { color: color.faint, fontSize: '11px' } } },
          {
            min: 0,
            max: 100,
            opposite: true,
            title: { text: undefined },
            labels: { format: '{value}%', style: { color: color.faint, fontSize: '11px' } },
            gridLineWidth: 0,
            // เส้นเกณฑ์เป้าหมาย วาดบนแกนร้อยละเท่านั้น
            plotLines:
              target == null
                ? undefined
                : [
                    {
                      value: target,
                      color: color.warn,
                      width: 1,
                      dashStyle: 'Dash',
                      label: {
                        text: `เกณฑ์ ${target}%`,
                        style: { color: color.warn, fontSize: '10px' },
                      },
                      zIndex: 5,
                    },
                  ],
          },
        ],
        series: [
          {
            type: 'column',
            name: 'ครั้งที่มารับบริการ',
            data: buckets.map(b => b.total),
            color: color.neutral,
            borderWidth: 0,
          },
          {
            type: 'column',
            name: `ได้รับ${drugLabel}`,
            data: buckets.map(b => b.withDrug),
            color: color.accent,
            borderWidth: 0,
          },
          {
            type: 'line',
            name: `ร้อยละที่ได้รับ${drugLabel}`,
            yAxis: 1,
            data: buckets.map(b => percentOf(b)),
            color: followUp === 'with' ? color.bad : color.good,
            marker: { radius: 3 },
            tooltip: { valueSuffix: '%', valueDecimals: 1 },
          },
        ],
      })}
    />
  )
}

/**
 * แยกตามมิติหนึ่ง (ห้องตรวจ / แพทย์ / รหัสโรค) — แท่งนอนเรียงจากมากไปน้อย
 *
 * ป้ายที่ปลายแท่งเป็นร้อยละ ไม่ใช่จำนวน เพราะจำนวนอ่านได้จากความยาวแท่งอยู่แล้ว
 * ส่วนร้อยละคือสิ่งที่ตัวชี้วัดถาม และเทียบข้ามกลุ่มที่ขนาดต่างกันมากได้
 */
export function BreakdownChart({
  buckets,
  drugLabel,
  followUp,
  height,
}: {
  buckets: Bucket[]
  drugLabel: string
  followUp: 'with' | 'without'
  height: number
}) {
  return (
    <Chart
      height={height}
      data={buckets}
      build={color => ({
        chart: { type: 'bar' },
        xAxis: {
          categories: buckets.map(b => b.label),
          labels: { style: { color: color.faint, fontSize: '11px' } },
        },
        yAxis: { labels: { style: { color: color.faint, fontSize: '11px' } } },
        plotOptions: {
          bar: { stacking: 'normal', borderWidth: 0, groupPadding: 0.08 },
        },
        series: [
          {
            type: 'bar',
            name: `ได้รับ${drugLabel}`,
            data: buckets.map(b => b.withDrug),
            color: followUp === 'with' ? color.bad : color.good,
          },
          {
            type: 'bar',
            name: `ไม่ได้รับ${drugLabel}`,
            data: buckets.map(b => b.total - b.withDrug),
            color: color.neutral,
            dataLabels: {
              enabled: true,
              style: { color: color.ink, fontSize: '10px', textOutline: 'none' },
              // ป้ายเกาะที่แท่งท่อนที่สอง จึงได้อยู่ปลายสุดของแท่งรวมพอดี
              formatter() {
                const bucket = buckets[this.index]
                return bucket == null || bucket.total === 0
                  ? ''
                  : `${((bucket.withDrug * 100) / bucket.total).toFixed(1)}%`
              },
            },
          },
        ],
      })}
    />
  )
}

/** ยาที่ถูกจ่ายบ่อย — นับเป็นจำนวนครั้งที่มีการจ่ายยาตัวนั้น */
export function DrugChart({ buckets, height }: { buckets: Bucket[]; height: number }) {
  return (
    <Chart
      height={height}
      data={buckets}
      build={color => ({
        chart: { type: 'bar' },
        legend: { enabled: false },
        tooltip: { shared: false },
        xAxis: {
          categories: buckets.map(b => b.label),
          labels: { style: { color: color.faint, fontSize: '11px' } },
        },
        series: [
          {
            type: 'bar',
            name: 'จำนวนครั้งที่จ่าย',
            data: buckets.map(b => b.withDrug),
            color: color.accent,
            borderWidth: 0,
            dataLabels: {
              enabled: true,
              style: { color: color.ink, fontSize: '10px', textOutline: 'none' },
            },
          },
        ],
      })}
    />
  )
}
