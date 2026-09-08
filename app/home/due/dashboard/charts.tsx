'use client'
import { useMemo } from 'react'
import Highcharts from 'highcharts/esm/highcharts'
// โมดูลลงทะเบียนตัวเองตอน import (ตั้งแต่ v12) ต้องอยู่หลัง 'highcharts' เสมอ
// ชนิดกราฟหนึ่งชนิดต้องมีโมดูลของตัวเองครบ ไม่งั้นได้ Highcharts error #17
// (bullet แยกเป็นโมดูลของตัวเอง ไม่ได้มาพร้อม highcharts-more เหมือน box plot)
import 'highcharts/esm/highcharts-more'
import 'highcharts/esm/modules/bullet'
import 'highcharts/esm/modules/pareto'
import 'highcharts/esm/modules/treemap'
import 'highcharts/esm/modules/accessibility'
import HighchartsReact from 'highcharts-react-official'
import { useTheme } from '@/app/theme'
import {
  AGING_BUCKETS,
  APPROPRIATENESS_TREND,
  CULTURE_ALIGNMENT,
  DDD_TREND,
  DRPS,
  HEATMAP_DRUGS,
  MONTHS,
  QUEUE_AGING,
  TURNAROUND_DIST,
  WARD_DRUG_DDD,
  WARDS,
} from './mock-stats'

/**
 * กราฟทั้งหมดของหน้าภาพรวม รวมไว้ไฟล์เดียว
 *
 * เหตุผลที่รวม: ทุกกราฟต้องใช้ชุดสีและโครงตั้งค่าเดียวกัน (พื้นโปร่ง ฟอนต์ตาม
 * ระบบ ปิด credits ปิด animation ตอนสลับธีม) ถ้าแยกไฟล์ละกราฟจะต้องคัดลอก
 * โครงนี้ซ้ำหกรอบ แล้ววันหนึ่งจะแก้ไม่ครบจนสีเพี้ยนกันเองระหว่างกราฟ
 *
 * Highcharts รับได้แต่ค่าสีจริง ใส่ var() ของ CSS ไม่ได้ จึงต้องสลับชุดสีตาม
 * ธีมเอง และ remount ด้วย key={mode} ไม่งั้นสีที่เขียนลง DOM ไปแล้วจะค้าง
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
        heatLow: 'rgba(56,189,248,0.12)',
        heatHigh: '#fb7185',
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
        heatLow: 'rgba(2,132,199,0.08)',
        heatHigh: '#be123c',
      }
}

/** โครงร่วมของทุกกราฟ — ตัวกราฟแต่ละอันส่งเฉพาะส่วนที่ต่างมาผสม */
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
    plotOptions: {
      series: { animation: false },
    },
  }
}

/** ตัวห่อร่วม — ผสมโครงกลางกับตั้งค่าเฉพาะกราฟ แล้ว remount ตอนสลับธีม */
function Chart({
  height,
  build,
}: {
  height: number
  build: (color: ReturnType<typeof palette>, dark: boolean) => Highcharts.Options
}) {
  const { mode } = useTheme()
  const dark = mode === 'dark'

  const options = useMemo(
    () => Highcharts.merge(baseOptions(dark, height), build(palette(dark), dark)),
    // build อ่านแต่ค่าคงที่ระดับโมดูล ตัวเลือกจึงขึ้นกับธีมกับความสูงเท่านั้น
    // (ตัว build เองสร้างใหม่ทุก render ใส่ใน deps แล้วจะคำนวณใหม่ตลอด)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dark, height],
  )

  return <HighchartsReact key={mode} highcharts={Highcharts} options={options} />
}

/**
 * เวลารอคอย — box plot
 *
 * กล่องคือช่วงกลาง 50% ของใบทั้งหมด เส้นในกล่องคือมัธยฐาน หนวดคือช่วงปกติ
 * จุดที่หลุดออกไปคือใบที่รอนานผิดปกติ ซึ่งเป็นใบที่ต้องตามหาจริง ๆ
 */
export function TurnaroundBoxPlot() {
  return (
    <Chart
      height={300}
      build={color => ({
        chart: { type: 'boxplot' },
        accessibility: {
          description:
            'การกระจายของเวลารอคอยเป็นชั่วโมง แยกตามเวรราชการ นอกเวลา และวันหยุด ' +
            'เทียบระหว่างขั้นรับรายการของเภสัชกรกับขั้นอนุมัติของแพทย์ผู้กำกับ',
        },
        xAxis: { categories: TURNAROUND_DIST[0].byShift.map(row => row.shift) },
        yAxis: { title: { text: 'ชั่วโมง', style: { color: color.faint } }, min: 0 },
        legend: { enabled: true },
        plotOptions: {
          boxplot: { fillColor: color.tooltipBg, medianWidth: 2, whiskerLength: '60%' },
        },
        series: TURNAROUND_DIST.flatMap((step, index) => {
          const tone = index === 0 ? color.info : color.warn
          return [
            {
              type: 'boxplot' as const,
              id: `box-${index}`,
              name: step.step,
              color: tone,
              medianColor: tone,
              data: step.byShift.map(row => row.box),
            },
            {
              // จุดหลุดต้องเป็น series แยกของ Highcharts — ผูกกับกล่องด้วย linkedTo
              // จะได้ไม่โผล่เป็นรายการซ้ำใน legend
              type: 'scatter' as const,
              name: `${step.step} (ใบที่รอนานผิดปกติ)`,
              linkedTo: `box-${index}`,
              color: tone,
              marker: { radius: 3, symbol: 'circle' },
              data: step.byShift.flatMap((row, shiftIndex) =>
                row.outliers.map(value => [shiftIndex, value] as [number, number]),
              ),
              tooltip: { pointFormat: 'รอ {point.y} ชม.' },
            },
          ]
        }),
      })}
    />
  )
}

/** ปริมาณการใช้ยารายเดือน — เส้นแนวโน้ม ไม่ใช่การเรียงอันดับ */
export function DddTrendChart() {
  return (
    <Chart
      height={300}
      build={color => {
        const tones = [color.bad, color.accent, color.info, color.good, color.warn, color.neutral]
        return {
          chart: { type: 'line' },
          accessibility: {
            description: 'แนวโน้ม DDD ต่อ 1000 วันนอนของยาต้านจุลชีพแต่ละตัว ย้อนหลัง 6 เดือน',
          },
          xAxis: { categories: MONTHS },
          yAxis: { title: { text: 'DDD / 1000 วันนอน', style: { color: color.faint } }, min: 0 },
          legend: { enabled: true },
          tooltip: { shared: true },
          plotOptions: { line: { marker: { radius: 3 }, lineWidth: 2 } },
          series: DDD_TREND.map((item, index) => ({
            type: 'line' as const,
            name: item.drug,
            color: tones[index % tones.length],
            data: item.values,
          })),
        }
      }}
    />
  )
}

/** ความเหมาะสมรายเดือน — คอลัมน์ซ้อน เห็นทั้งสัดส่วนและทิศทาง */
export function AppropriatenessTrendChart() {
  return (
    <Chart
      height={260}
      build={color => ({
        chart: { type: 'column' },
        accessibility: {
          description:
            'จำนวนใบที่ประเมินแล้วในแต่ละเดือน แยกเป็นเหมาะสม ไม่เหมาะสมแต่ Consult แล้ว และประเมินไม่ได้',
        },
        xAxis: { categories: APPROPRIATENESS_TREND.map(row => row.month) },
        yAxis: { title: { text: 'จำนวนใบ', style: { color: color.faint } } },
        legend: { enabled: true, reversed: true },
        tooltip: { shared: true },
        plotOptions: { column: { stacking: 'normal', borderWidth: 0, groupPadding: 0.12 } },
        series: [
          {
            type: 'column',
            name: 'ประเมินไม่ได้',
            color: color.neutral,
            data: APPROPRIATENESS_TREND.map(row => row.cannot),
          },
          {
            type: 'column',
            name: 'Consult แล้ว',
            color: color.warn,
            data: APPROPRIATENESS_TREND.map(row => row.consulted),
          },
          {
            type: 'column',
            name: 'เหมาะสม',
            color: color.good,
            data: APPROPRIATENESS_TREND.map(row => row.appropriate),
          },
        ],
      })}
    />
  )
}

/** คิวค้างแบ่งตามอายุ — รูปร่างของคิวสำคัญกว่าจำนวนรวม */
export function QueueAgingChart() {
  return (
    <Chart
      height={240}
      build={color => ({
        chart: { type: 'bar' },
        accessibility: {
          description: 'จำนวนคำขอที่ค้างในแต่ละขั้น แบ่งตามระยะเวลาที่ค้าง',
        },
        // ชื่อขั้นยาว วางเป็นแท่งนอนถึงอ่านออกโดยไม่ต้องเอียงตัวอักษร
        xAxis: { categories: QUEUE_AGING.map(row => row.stage) },
        yAxis: { title: { text: 'จำนวนใบ', style: { color: color.faint } }, allowDecimals: false },
        legend: { enabled: true },
        tooltip: { shared: true },
        plotOptions: { bar: { stacking: 'normal', borderWidth: 0 } },
        series: AGING_BUCKETS.map((bucket, index) => ({
          type: 'bar' as const,
          name: bucket,
          // ยิ่งค้างนานยิ่งแดง สีจึงบอกความรุนแรงได้โดยไม่ต้องอ่านป้าย
          color: [color.good, color.warn, color.bad][index],
          data: QUEUE_AGING.map(row => row.counts[index]),
        })),
      })}
    />
  )
}

/**
 * DRPs — Pareto
 *
 * แท่งคือจำนวนตามเดิม เส้นคือ % สะสม บอกว่ากี่หมวดแรกรวมกันเป็นกี่เปอร์เซ็นต์
 * ของปัญหาทั้งหมด ใช้เลือกว่าจะทำแนวทางเรื่องไหนก่อนให้คุ้มแรงที่สุด
 */
export function DrpParetoChart() {
  return (
    <Chart
      height={300}
      build={color => ({
        chart: { type: 'column' },
        accessibility: {
          description: 'จำนวนปัญหาจากการใช้ยาแยกตามหมวด พร้อมเส้นเปอร์เซ็นต์สะสม',
        },
        xAxis: {
          categories: DRPS.map(item => item.label),
          // ชื่อหมวดยาวมาก จำกัดความกว้างให้ตัดคำลงบรรทัดใหม่แทนที่จะเบียดกัน
          // (Highcharts รับ width เป็นตัวเลข px ไม่ใช่สตริง)
          labels: {
            style: { color: color.faint, fontSize: '10px', width: 110, whiteSpace: 'normal' },
            rotation: 0,
          },
        },
        yAxis: [
          { title: { text: 'จำนวน', style: { color: color.faint } } },
          {
            title: { text: '% สะสม', style: { color: color.faint } },
            labels: { style: { color: color.faint, fontSize: '11px' }, format: '{value}%' },
            min: 0,
            max: 100,
            opposite: true,
            gridLineWidth: 0,
          },
        ],
        legend: { enabled: true },
        series: [
          {
            type: 'pareto',
            name: '% สะสม',
            yAxis: 1,
            zIndex: 10,
            baseSeries: 1,
            color: color.warn,
            tooltip: { valueDecimals: 0, valueSuffix: '%' },
          },
          {
            type: 'column',
            name: 'จำนวนที่พบ',
            color: color.bad,
            borderWidth: 0,
            zIndex: 2,
          },
        ],
      })}
    />
  )
}

/**
 * หอผู้ป่วย × ตัวยา — treemap
 *
 * ขนาดของช่อง = ปริมาณการใช้ ทำให้ "หอไหนใช้ยาหนักที่สุด" กับ "ในหอนั้นเป็นยาตัวไหน"
 * อ่านได้จากภาพเดียวโดยไม่ต้องเทียบตัวเลข — กล่องใหญ่คือที่ที่ต้องไปคุยก่อน
 *
 * เลือกแทนตารางสีเพราะตารางสีบอกความเข้มได้ แต่ไม่ได้บอกว่าหอหนึ่ง ๆ
 * ใช้ยารวมกันมากแค่ไหน ต้องบวกในหัวเอง ส่วน treemap พื้นที่รวมของกลุ่มบอกให้เลย
 */
export function WardDrugTreemap() {
  return (
    <Chart
      height={320}
      build={(color, dark) => {
        const tones = [color.bad, color.warn, color.accent, color.info, color.good]
        return {
          accessibility: {
            description:
              'ปริมาณการใช้ยาต้านจุลชีพ DDD ต่อ 1000 วันนอน แยกตามหอผู้ป่วยและตัวยา ' +
              'ขนาดของช่องแทนปริมาณการใช้',
          },
          tooltip: {
            useHTML: true,
            pointFormat:
              '<b>{point.name}</b><br>{point.value} DDD / 1000 วันนอน',
          },
          series: [
            {
              type: 'treemap',
              layoutAlgorithm: 'squarified',
              // ปิดการคลิกเจาะเข้ากลุ่ม — หน้านี้ต้องการภาพรวมทั้งหมดพร้อมกัน
              // ไม่ใช่ให้ไล่กดเข้าไปทีละหอแล้วลืมว่าหออื่นเป็นยังไง
              allowTraversingTree: false,
              alternateStartingDirection: true,
              borderColor: dark ? 'rgba(12,7,22,0.85)' : '#ffffff',
              borderWidth: 2,
              levels: [
                {
                  // ระดับหอผู้ป่วย — ชื่อหอเป็นแถบหัวกลุ่มด้านบน
                  level: 1,
                  borderWidth: 3,
                  layoutAlgorithm: 'squarified',
                  dataLabels: {
                    enabled: true,
                    align: 'left',
                    verticalAlign: 'top',
                    style: {
                      fontSize: '11px',
                      fontWeight: '600',
                      color: dark ? '#0c0716' : '#ffffff',
                      textOutline: 'none',
                    },
                  },
                },
                {
                  // ระดับตัวยา — สีอ่อนลงจากสีของหอ จะได้รู้ว่าอยู่กลุ่มไหน
                  level: 2,
                  colorVariation: { key: 'brightness', to: dark ? -0.3 : 0.35 },
                  dataLabels: {
                    enabled: true,
                    format: '{point.name}<br>{point.value}',
                    style: {
                      fontSize: '10px',
                      fontWeight: '400',
                      color: dark ? '#0c0716' : '#1f1533',
                      textOutline: 'none',
                    },
                  },
                },
              ],
              data: [
                ...WARDS.map((ward, index) => ({
                  id: `ward-${index}`,
                  name: ward,
                  color: tones[index % tones.length],
                })),
                ...WARD_DRUG_DDD.flatMap((row, wardIndex) =>
                  row.map((value, drugIndex) => ({
                    name: HEATMAP_DRUGS[drugIndex],
                    parent: `ward-${wardIndex}`,
                    value,
                  })),
                ),
              ],
            },
          ],
        }
      }}
    />
  )
}

/**
 * ตัวชี้วัดที่มีเป้าหมาย — bullet
 *
 * แท่ง % เปล่า ๆ ไม่บอกว่าผ่านเกณฑ์หรือยัง bullet วางค่าจริงเทียบเส้นเป้าหมาย
 * บนแท่งเดียว เห็นทันทีว่าห่างเป้าเท่าไร
 */
export function CultureBulletChart() {
  return (
    <Chart
      height={150}
      build={(color, dark) => ({
        chart: { type: 'bullet', inverted: true, marginLeft: 150, spacing: [8, 8, 8, 8] },
        accessibility: {
          description: 'ตัวชี้วัดความสอดคล้องกับผลเพาะเชื้อ เทียบกับเป้าหมายที่ตั้งไว้',
        },
        xAxis: {
          categories: ['ส่งเพาะเชื้อก่อนเริ่มยา', 'ปรับยาลงตามผล'],
          labels: { style: { color: color.ink, fontSize: '11px' } },
        },
        yAxis: {
          min: 0,
          max: 100,
          labels: { format: '{value}%', style: { color: color.faint, fontSize: '10px' } },
          gridLineWidth: 0,
          // แถบพื้นหลังบอกช่วงคุณภาพ อ่อน = ยังไม่ถึงเกณฑ์
          plotBands: [
            { from: 0, to: 50, color: dark ? 'rgba(251,113,133,0.12)' : 'rgba(190,18,60,0.07)' },
            { from: 50, to: 80, color: dark ? 'rgba(251,191,36,0.10)' : 'rgba(180,83,9,0.07)' },
            { from: 80, to: 100, color: dark ? 'rgba(52,211,153,0.12)' : 'rgba(4,120,87,0.07)' },
          ],
        },
        legend: { enabled: false },
        plotOptions: {
          bullet: {
            pointPadding: 0.25,
            borderWidth: 0,
            targetOptions: { width: '200%', height: 3, color: color.ink },
          },
        },
        tooltip: { pointFormat: '<b>{point.y}%</b> (เป้าหมาย {point.target}%)' },
        series: [
          {
            type: 'bullet',
            name: 'ผลจริง',
            color: color.info,
            data: [
              {
                y: CULTURE_ALIGNMENT.sentBeforeStart,
                target: CULTURE_ALIGNMENT.sentBeforeStartTarget,
              },
              { y: CULTURE_ALIGNMENT.deEscalated, target: CULTURE_ALIGNMENT.deEscalatedTarget },
            ],
          },
        ],
      })}
    />
  )
}
