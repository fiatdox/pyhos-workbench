'use client'
import { useMemo } from 'react'
import Highcharts from 'highcharts/esm/highcharts'
// ตั้งแต่ Highcharts v12 โมดูลลงทะเบียนตัวเองตอน import — ไม่ต้องเรียกเป็นฟังก์ชัน
// แต่ต้อง import หลัง 'highcharts' เพราะโมดูลอ่าน instance จากตัวหลัก
import 'highcharts/esm/modules/sankey'
import 'highcharts/esm/modules/accessibility'
import HighchartsReact from 'highcharts-react-official'
import { useTheme } from '@/app/theme'
import { FLOW, FLOW_NODES, type FlowNodeTone } from './mock-stats'

/**
 * เส้นทางของคำขอตลอดกระบวนการ — Sankey
 *
 * เลือก Sankey เพราะคำถามที่หน้านี้ต้องตอบคือ "คำขอที่ส่งเข้ามาไหลไปจบที่ไหนบ้าง
 * และหล่นหายตรงไหน" ซึ่งกราฟแท่งหรือวงกลมตอบไม่ได้ — มันบอกได้แค่ปลายทาง
 * ไม่บอกว่าใบที่ไม่ผ่านไปตกที่ขั้นไหน ความหนาของเส้นทำให้เห็นทันทีว่า
 * เส้น "ไม่อนุมัติ" กับ "รอประเมิน" ใหญ่แค่ไหนเมื่อเทียบกับทางหลัก
 *
 * สีของจุดผูกกับความหมาย (ผ่าน/ค้าง/ไม่ผ่าน) ไม่ใช่สีไล่ตามลำดับของไลบรารี
 * และต้องสลับชุดสีตามธีมเอง เพราะ Highcharts รับได้แต่ค่าสีจริง ใส่ var() ไม่ได้
 */

function toneColors(dark: boolean): Record<FlowNodeTone, string> {
  return dark
    ? {
        start: '#a78bfa',
        good: '#34d399',
        warn: '#fbbf24',
        bad: '#fb7185',
        neutral: '#38bdf8',
      }
    : {
        start: '#7c3aed',
        good: '#047857',
        warn: '#b45309',
        bad: '#be123c',
        neutral: '#0369a1',
      }
}

export default function FlowSankey({ height = 380 }: { height?: number }) {
  const { mode } = useTheme()

  const options = useMemo<Highcharts.Options>(() => {
    const dark = mode === 'dark'
    const ink = dark ? '#cbd5e1' : '#4b4165'
    const tones = toneColors(dark)

    return {
      chart: {
        height,
        backgroundColor: 'transparent',
        style: { fontFamily: 'inherit' },
        animation: false,
      },
      credits: { enabled: false },
      title: { text: undefined },
      accessibility: {
        description:
          'เส้นทางของคำขอใช้ยา DUE ตั้งแต่แพทย์ส่งคำขอ ผ่านการอนุมัติของแพทย์ผู้กำกับ ' +
          'การรับรายการของเภสัชกร จนถึงการประเมินการใช้ยา ความหนาของเส้นคือจำนวนใบคำขอ',
      },
      tooltip: {
        backgroundColor: dark ? '#1b1033' : '#ffffff',
        borderColor: dark ? 'rgba(255,255,255,0.12)' : 'rgba(124,58,237,0.2)',
        style: { color: ink },
        // ค่าที่คนดูอยากรู้คือจำนวนใบ ไม่ใช่คำว่า weight ตามศัพท์ของไลบรารี
        pointFormat: '{point.fromNode.name} → {point.toNode.name}: <b>{point.weight} ใบ</b>',
        nodeFormat: '{point.name}: <b>{point.sum} ใบ</b>',
      },
      series: [
        {
          type: 'sankey',
          name: 'เส้นทางคำขอ',
          keys: ['from', 'to', 'weight'],
          data: FLOW.map(link => [link.from, link.to, link.weight] as [string, string, number]),
          nodes: FLOW_NODES.map(node => ({ id: node.id, color: tones[node.tone] })),
          dataLabels: {
            style: { color: ink, fontSize: '11px', fontWeight: '500', textOutline: 'none' },
          },
          // เส้นจาง ๆ ให้เห็นจุดปลายชัด แต่ยังพอเห็นความหนาของสาย
          linkOpacity: dark ? 0.4 : 0.3,
        },
      ],
    }
  }, [height, mode])

  // key ผูกกับธีม — บังคับสร้างกราฟใหม่ตอนสลับ ไม่งั้นสีที่เขียนลง DOM ไปแล้วจะค้าง
  return <HighchartsReact key={mode} highcharts={Highcharts} options={options} />
}
