'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ยังทำที่ app/home/layout.tsx ซึ่งเป็น Server Component)
import { useState } from 'react'
import { Segmented, Typography } from 'antd'
import { PartitionOutlined } from '@ant-design/icons'
import PageHint from '../page-hint'
import ArchitectureDiagram from './architecture'
import HealthRiderDiagram from './health-rider'
import PatientDataDiagram from './patient-data'
import RduPipelineDiagram from './rdu-pipeline'

const { Paragraph, Text, Title } = Typography

/**
 * ผังระบบ — เอกสารที่อยู่ในระบบ ไม่ใช่ไฟล์รูปที่วางไว้ที่อื่น
 *
 * วางเป็นหน้าในแอปเพื่อให้ผังถูก commit ไปกับโค้ด เวลาแก้โครงสร้างระบบจะเห็น
 * ในรีวิวเดียวกันว่าผังยังตรงอยู่หรือเปล่า ผังที่เป็นไฟล์รูปแยกจะล้าสมัยเงียบ ๆ
 * ภายในไม่กี่สัปดาห์แล้วกลายเป็นของที่หลอกคนอ่าน ซึ่งแย่กว่าไม่มีผังเลย
 *
 * หน้านี้ไม่มีข้อมูลผู้ป่วยและไม่เรียก API เลย — ไม่ได้ผูกสิทธิ์ตามตำแหน่ง
 * ทุกคนที่เข้าระบบได้เห็น และไม่มีอะไรให้บันทึกเป็นร่องรอยการเปิดดูข้อมูล
 *
 * วาดตามกฎของชุดออกแบบ cathrynlavery/diagram-design โดยปรับสามข้อให้เข้ากับ
 * ระบบนี้ — เหตุผลอยู่ที่หัวไฟล์ primitives.tsx
 */

type View = 'architecture' | 'patient-data' | 'rdu' | 'rider'

/** คำโปรยใต้หัวข้อของแต่ละผัง — บอกว่าผังนี้ตอบคำถามอะไร */
const ABOUT: Record<View, { label: string; title: string; note: string }> = {
  architecture: {
    label: 'สถาปัตยกรรม',
    title: 'อะไรต่อกับอะไร',
    note: 'ระบบอ่านจากฐานของโรงพยาบาลโดยตรงและไม่ทำฐานคู่ขนาน จุดที่ระบบเขียนข้อมูลมีที่เดียวคือตารางของตัวเอง',
  },
  'patient-data': {
    label: 'ข้อมูลผู้ป่วย',
    title: 'ข้อมูลผู้ป่วยไหลไปทางไหน และถูกกันไว้ที่ไหน',
    note: 'ชั้น API เป็นเส้นที่ข้อมูลระบุตัวตนข้ามไปไม่ได้ และทุกการเปิดดูถูกบันทึกไว้',
  },
  rdu: {
    label: 'ตัวชี้วัด RDU',
    title: 'ตัวเลขตัวชี้วัดมาจากไหน',
    note: 'ทะเบียนรหัสโรคและรหัสยาเป็นของเภสัชกร แก้ได้เองจากหน้าตั้งค่า ไม่ต้องรอแก้โค้ดเมื่อนิยามเปลี่ยน',
  },
  rider: {
    label: 'งานส่งยาถึงบ้าน',
    title: 'งานเดินจากคนไข้ถึงรายงานอย่างไร',
    note: 'งานเดียวในระบบที่เป็น workflow จริง — มีจุดที่คนตัดสินใจจ่ายงาน และมีการบันทึกผลกลับ',
  },
}

const DIAGRAM: Record<View, () => React.ReactNode> = {
  architecture: ArchitectureDiagram,
  'patient-data': PatientDataDiagram,
  rdu: RduPipelineDiagram,
  rider: HealthRiderDiagram,
}

export default function DiagramPage() {
  const [view, setView] = useState<View>('architecture')
  const about = ABOUT[view]
  const Diagram = DIAGRAM[view]

  return (
    <>
      <section className="mb-6">
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          <PartitionOutlined /> ผังระบบ
          <PageHint>
            ผังสี่ใบที่อธิบายว่าระบบต่อกับอะไร ข้อมูลผู้ป่วยถูกกันไว้ที่ไหน ตัวเลขตัวชี้วัด RDU
            มาจากไหน และงานส่งยาถึงบ้านเดินอย่างไร — ไม่มีข้อมูลผู้ป่วยในหน้านี้
            และผังอยู่ในรีโปเดียวกับโค้ด จะได้แก้พร้อมกันเมื่อโครงสร้างเปลี่ยน
          </PageHint>
        </Title>
        <div className="h-px w-24 bg-linear-to-r from-violet-400/70 to-transparent" />
      </section>

      <section className="rounded-2xl border border-line bg-panel p-5 backdrop-blur">
        <Segmented<View>
          className="mb-4"
          value={view}
          onChange={setView}
          options={(Object.keys(ABOUT) as View[]).map(key => ({
            value: key,
            label: ABOUT[key].label,
          }))}
        />

        <Title level={4} style={{ color: 'var(--ink)', marginTop: 0, marginBottom: 2 }}>
          {about.title}
        </Title>
        <Paragraph className="mb-4! text-xs! text-ink-3!">{about.note}</Paragraph>

        {/* key ผูกกับผังที่เลือก — บังคับให้สร้าง SVG ใหม่ตอนสลับ ไม่ให้ marker
            ของใบก่อนค้างอยู่ใน DOM แล้วหัวลูกศรไปอ้างตัวที่ไม่มีอยู่แล้ว */}
        <div key={view}>
          <Diagram />
        </div>

        <Text type="secondary" className="mt-4 block text-[11px]">
          วาดตามชุดออกแบบ diagram-design — เส้น 1px ไม่มีเงา สีเน้นไม่เกินสองจุดต่อผัง
          เส้นเชื่อมตั้งฉากเท่านั้น
        </Text>
      </section>
    </>
  )
}
