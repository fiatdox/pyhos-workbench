'use client'
import { useMemo } from 'react'
import Highcharts from 'highcharts/esm/highcharts'
// เหตุผลที่ใส่โมดูล accessibility เหมือนกราฟค่าไต — ค่าแล็บเป็นข้อมูลทางคลินิก
// ที่ต้องอ่านค่าให้ได้จริง ไม่ใช่ภาพประกอบ
import 'highcharts/esm/modules/accessibility'
import HighchartsReact from 'highcharts-react-official'
import { useTheme } from '@/app/theme'
import type { LabAnalyteKey, LabTrendRow } from '@/lib/his/lab-trend'

/**
 * กราฟแนวโน้มค่าแล็บ — ใช้แกน y สองข้างเหมือนกราฟค่าไต
 *
 * เหตุผลเดียวกัน: ค่าที่อยู่คนละสเกลกันสิบถึงพันเท่าถ้าวางแกนเดียวกัน เส้นที่
 * ตัวเลขเล็กกว่าจะแบนติดพื้นจนดูแนวโน้มไม่ออก (albumin หลักหน่วยกับ ALT
 * ที่ขึ้นได้ถึงหลักพัน) ซึ่งมักเป็นเส้นที่ต้องดูที่สุด
 *
 * จับคู่ค่าที่สเกลใกล้กันไว้แกนเดียวกัน ไม่ได้จับตามหมวดความหมาย — ANC อยู่แกน
 * เดียวกับ WBC เพราะเป็นหน่วย cell/µL เหมือนกัน (ANC คิดจาก WBC อยู่แล้ว)
 * จึงอ่านคู่กันได้ตรงว่านิวโทรฟิลเป็นสัดส่วนเท่าไรของเม็ดเลือดขาวทั้งหมด
 */

/** สีของแต่ละค่า — ต่างกันชัดและอ่านออกบนพื้นทั้งธีมสว่างและมืด */
const SERIES_COLORS: Record<LabAnalyteKey, string> = {
  wbc: '#2a7fe0',
  neutrophilPercent: '#f0ad00',
  anc: '#7c3aed',
  crp: '#e0303c',
  alt: '#22a54b',
  ast: '#0e9aa7',
  bilirubin: '#d97706',
  albumin: '#db2777',
}

export type LabChartAxis = {
  title: string
  keys: LabAnalyteKey[]
}

export default function LabTrendChart({
  dates,
  rows,
  axes,
  height = 260,
}: {
  /** 'YYYY-MM-DD' เรียงเก่าไปใหม่ */
  dates: string[]
  rows: LabTrendRow[]
  /** แกนซ้ายและแกนขวา — ค่าที่ไม่อยู่ในแกนใดเลยจะไม่ถูกวาด */
  axes: [LabChartAxis, LabChartAxis]
  height?: number
}) {
  const { mode } = useTheme()

  const byKey = useMemo(() => new Map(rows.map(row => [row.key, row])), [rows])

  const options = useMemo<Highcharts.Options>(() => {
    const dark = mode === 'dark'
    const ink = dark ? '#cbd5e1' : '#4b4165'
    const inkFaint = dark ? '#94a3b8' : '#78708f'
    const grid = dark ? 'rgba(255,255,255,0.08)' : 'rgba(124,58,237,0.12)'
    const tooltipBg = dark ? '#1b1033' : '#ffffff'

    // ป้ายแกน x เป็น พ.ศ. ให้ตรงกับที่ใช้ทั้งระบบ
    const categories = dates.map(date => {
      const [year, month, day] = date.split('-')
      return `${day}/${month}/${Number(year) + 543}`
    })

    const series = axes.flatMap((axis, index) =>
      axis.keys
        .map(key => byKey.get(key))
        .filter((row): row is LabTrendRow => row != null)
        .map(row => ({
          type: 'line' as const,
          name: `${row.label} (${row.unit})`,
          color: SERIES_COLORS[row.key],
          yAxis: index,
          // ANC คิดเองจาก WBC × NE% จึงใช้เส้นประให้ต่างจากค่าที่ห้องแล็บออกมาจริง
          dashStyle: row.derived ? ('ShortDash' as const) : undefined,
          // ค่าที่เป็นไปไม่ได้ทางสรีรวิทยาไม่ลากเส้น — ตารางยังแสดงไว้พร้อมหมายเหตุ
          // ถ้าพลอตด้วย จุดเดียวจะกดสเกลจนเส้นที่เหลือแบนติดกันหมด
          data: row.cells.map(cell => (cell.suspect ? null : cell.value)),
        })),
    )

    return {
      chart: {
        type: 'line',
        height,
        backgroundColor: 'transparent',
        style: { fontFamily: 'inherit' },
        animation: false,
      },
      credits: { enabled: false },
      title: { text: undefined },
      accessibility: {
        description: `แนวโน้มค่าแล็บของผู้ป่วยรายนี้: ${axes
          .flatMap(axis => axis.keys.map(key => byKey.get(key)?.label).filter(Boolean))
          .join(', ')} เรียงตามวันที่เจาะเลือด`,
      },
      legend: {
        itemStyle: { color: ink, fontWeight: '500', fontSize: '11px' },
        itemHoverStyle: { color: dark ? '#ffffff' : '#2b2140' },
      },
      xAxis: {
        categories,
        labels: { style: { color: inkFaint, fontSize: '10px' }, rotation: -45 },
        lineColor: grid,
        tickColor: grid,
      },
      yAxis: axes.map((axis, index) => ({
        title: { text: axis.title, style: { color: inkFaint, fontSize: '10px' } },
        labels: { style: { color: inkFaint, fontSize: '10px' } },
        gridLineColor: grid,
        gridLineWidth: index === 0 ? 1 : 0,
        opposite: index === 1,
      })),
      tooltip: {
        shared: true,
        backgroundColor: tooltipBg,
        borderColor: grid,
        style: { color: ink, fontSize: '11px' },
      },
      plotOptions: {
        // เส้นขาดตรงวันที่ไม่ได้ตรวจค่านั้น ตรงกับความจริงว่า "ไม่รู้ค่า"
        // มากกว่าการลากเส้นข้ามไปเหมือนไม่มีอะไรขาด
        line: { marker: { radius: 3 }, lineWidth: 2, connectNulls: false },
      },
      series,
    }
  }, [dates, byKey, axes, height, mode])

  // key ผูกกับธีม บังคับให้สร้างกราฟใหม่ตอนสลับธีม ไม่งั้นสีที่เขียนลง DOM จะค้าง
  return <HighchartsReact key={mode} highcharts={Highcharts} options={options} />
}
