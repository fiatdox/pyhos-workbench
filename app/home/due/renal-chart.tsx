'use client'
import { useMemo } from 'react'
import Highcharts from 'highcharts/esm/highcharts'
// เปิดโมดูล accessibility — เลื่อนดูจุดข้อมูลด้วยคีย์บอร์ดและอ่านด้วย screen reader ได้
// (ตั้งแต่ v12 โมดูลลงทะเบียนตัวเองตอน import ต้องอยู่หลัง 'highcharts')
// ปิดทิ้งด้วย accessibility.enabled: false ก็ได้ แต่กราฟค่าไตเป็นข้อมูลทางคลินิก
// ที่ต้องอ่านค่าให้ได้จริง ไม่ใช่ภาพประกอบ จึงเลือกใส่โมดูลแทนการปิดคำเตือน
import 'highcharts/esm/modules/accessibility'
import HighchartsReact from 'highcharts-react-official'
import { useTheme } from '@/app/theme'
import type { RenalPoint } from './mock-data'

/**
 * กราฟแนวโน้มค่าไต — Creatinine / CrCl / eGFR พร้อมเส้นอายุไว้เทียบ
 *
 * ใช้แกน y สองข้างเพราะหน่วยคนละสเกลกันมาก: CrCl กับ eGFR อยู่หลักสิบถึงร้อย
 * ส่วน Creatinine อยู่หลักหน่วย ถ้าใช้แกนเดียวเส้น Creatinine จะแบนติดพื้น
 * จนดูแนวโน้มไม่ออก ซึ่งเป็นเส้นที่เภสัชกรต้องดูที่สุด
 *
 * สีของกราฟผูกกับธีมที่ผู้ใช้เลือก (data-theme) ไม่ใช่ prefers-color-scheme
 * ของเครื่อง — Highcharts รับได้แต่ค่าสีจริง ใส่ var() ไม่ได้ จึงต้องสลับชุดสี
 * ตาม mode เอง ไม่สามารถใช้ token ของ CSS ได้เหมือนส่วนอื่นของหน้า
 */

/** สีของเส้นข้อมูล — เลือกให้ต่างกันชัดและอ่านออกบนพื้นทั้งสองแบบ */
const SERIES_COLORS = {
  age: '#f0ad00',
  crcl: '#22a54b',
  egfr: '#2a7fe0',
  cr: '#e0303c',
}

export default function RenalChart({
  points,
  age,
  height = 340,
}: {
  points: RenalPoint[]
  /** อายุผู้ป่วย — วาดเป็นเส้นประไว้เทียบกับ CrCl/eGFR ตามแบบที่ใช้อยู่ */
  age: number
  height?: number
}) {
  const { mode } = useTheme()

  const options = useMemo<Highcharts.Options>(() => {
    const dark = mode === 'dark'
    const ink = dark ? '#cbd5e1' : '#4b4165'
    const inkFaint = dark ? '#94a3b8' : '#78708f'
    const grid = dark ? 'rgba(255,255,255,0.08)' : 'rgba(124,58,237,0.12)'
    const tooltipBg = dark ? '#1b1033' : '#ffffff'

    // แปลงปี ค.ศ. เป็น พ.ศ. ที่ป้ายแกน x ให้ตรงกับที่ใช้ทั้งระบบ
    const categories = points.map(point => {
      const [year, month, day] = point.date.split('-')
      return `${Number(year) + 543}-${month}-${day}`
    })

    return {
      chart: {
        type: 'line',
        height,
        backgroundColor: 'transparent',
        style: { fontFamily: 'inherit' },
        // ปิด animation ตอนเปลี่ยนธีม ไม่งั้นกราฟจะวาดใหม่ทั้งชุดทุกครั้งที่สลับ
        animation: false,
      },
      credits: { enabled: false },
      title: { text: undefined },
      accessibility: {
        description:
          'แนวโน้มค่าไตของผู้ป่วยรายนี้ แสดง Creatinine, CrCl และ eGFR เรียงตามวันที่เจาะเลือด ' +
          'พร้อมเส้นอายุไว้เทียบ',
      },
      legend: {
        itemStyle: { color: ink, fontWeight: '500' },
        itemHoverStyle: { color: dark ? '#ffffff' : '#2b2140' },
      },
      xAxis: {
        categories,
        labels: { style: { color: inkFaint, fontSize: '10px' }, rotation: -45 },
        lineColor: grid,
        tickColor: grid,
      },
      yAxis: [
        {
          title: { text: 'Value / Age', style: { color: inkFaint } },
          labels: { style: { color: inkFaint } },
          gridLineColor: grid,
        },
        {
          title: { text: 'Creatinine', style: { color: inkFaint } },
          labels: { style: { color: inkFaint } },
          gridLineWidth: 0,
          opposite: true,
        },
      ],
      tooltip: {
        shared: true,
        backgroundColor: tooltipBg,
        borderColor: grid,
        style: { color: ink },
      },
      plotOptions: {
        line: { marker: { radius: 3 }, lineWidth: 2 },
      },
      series: [
        {
          type: 'line',
          name: 'Age (อายุ)',
          color: SERIES_COLORS.age,
          dashStyle: 'ShortDash',
          // อายุคงที่ทุกจุด เป็นเส้นอ้างอิงไม่ใช่ข้อมูลที่เปลี่ยนตามวัน
          data: points.map(() => age),
          marker: { enabled: false },
        },
        {
          type: 'line',
          name: 'CrCl',
          color: SERIES_COLORS.crcl,
          data: points.map(point => point.crcl),
        },
        {
          type: 'line',
          name: 'eGFR',
          color: SERIES_COLORS.egfr,
          data: points.map(point => point.egfr),
        },
        {
          type: 'line',
          name: 'Creatinine (CR)',
          color: SERIES_COLORS.cr,
          yAxis: 1,
          data: points.map(point => point.cr),
        },
      ],
    }
  }, [points, age, height, mode])

  if (points.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-xs text-ink-3">
        ไม่มีผลค่าไตย้อนหลัง
      </div>
    )
  }

  // key ผูกกับธีม — บังคับให้สร้างกราฟใหม่ตอนสลับธีม
  // ไม่งั้นสีที่ Highcharts เขียนลง DOM ไปแล้วจะค้างเป็นชุดเดิม
  return <HighchartsReact key={mode} highcharts={Highcharts} options={options} />
}
