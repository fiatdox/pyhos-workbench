'use client'
import { BusLink, Callout, DiagramFrame, Legend, Link, Node, ZoneLabel } from './primitives'

/**
 * ขั้นตอนงานส่งยาถึงบ้าน (Health Rider)
 *
 * นี่คืองานเดียวในระบบที่เป็น workflow จริง — มีการจ่ายงานและมีการบันทึกผล
 * ไม่ใช่การอ่านข้อมูลมาแสดงอย่างหน้าอื่น เรื่องที่ภาพต้องสื่อคือ **จุดที่คน
 * ตัดสินใจอยู่ตรงไหน** (การจ่ายงาน) และผลของมันไปจบที่ไหน (ภาพรวมของผู้บริหาร)
 * สีเน้นจึงอยู่สองจุดนั้น
 *
 * เจ็ดกล่อง หกเส้น · ภาพรวมรับเส้นมาจากการจ่ายงานเส้นเดียว ไม่ได้ลากจาก
 * บันทึกการส่งขึ้นมาอีกเส้น ทั้งที่มันก็นับรวมด้วย — เส้นที่สองต้องวิ่งเลียบ
 * ขอบขวาในช่องแคบ 36px ซึ่งจะไปเบียดเส้นแรกใกล้กว่า 12px ที่กฎอนุญาต
 * ข้อที่หายไปบอกไว้ในหมายเหตุแทน
 */
export default function HealthRiderDiagram() {
  return (
    <>
      <DiagramFrame
        slug="health-rider"
        title="ขั้นตอนงานส่งยาถึงบ้าน"
        desc="ผู้ป่วยที่มีรายการค่าบริการส่งยาถึงบ้านกลายเป็นรายการงานรายวัน หัวหน้างานจ่ายงานให้เจ้าหน้าที่ตามพื้นที่รับผิดชอบ เจ้าหน้าที่บันทึกผลการส่ง และตัวเลขทั้งหมดรวมเป็นภาพรวมที่ดูตามปีงบและไตรมาสได้"
        width={960}
        height={428}
      >
        <ZoneLabel x={36} y={32} text="FROM HIS" />
        <ZoneLabel x={344} y={32} text="WORKFLOW" />
        <ZoneLabel x={836} y={32} text="REPORTING" />

        <Link from={{ x: 236, y: 104 }} to={{ x: 344, y: 104 }} label="รหัสค่าบริการ" />
        <Link from={{ x: 528, y: 104 }} to={{ x: 620, y: 104 }} label="จ่ายงาน" tone="accent" />
        <Link from={{ x: 436, y: 144 }} to={{ x: 436, y: 212 }} label="ตำบล" />
        <Link from={{ x: 528, y: 244 }} to={{ x: 620, y: 244 }} label="ตามพื้นที่" />
        <Link from={{ x: 712, y: 144 }} to={{ x: 712, y: 212 }} label="ผู้รับงาน" />
        <Link from={{ x: 712, y: 276 }} to={{ x: 712, y: 320 }} label="บันทึกผล" />
        <BusLink
          from={{ x: 804, y: 108 }}
          to={{ x: 840, y: 176 }}
          via={{ midX: 822 }}
          label="นับรวม"
          tone="accent"
          labelAt={{ x: 822, y: 56 }}
        />

        <Node
          x={36}
          y={72}
          w={200}
          h={64}
          name="ผู้ป่วยที่ขอส่งยาถึงบ้าน"
          sub="opitemrece + ovst"
          tone="store"
        />
        <Node
          x={344}
          y={72}
          w={184}
          h={72}
          name="รายการที่ต้องส่งวันนี้"
          sub="one row per vn"
          tone="user"
        />
        <Node x={344} y={212} w={184} h={64} name="พื้นที่รับผิดชอบ" sub="rider_areas" tone="store" />
        <Node
          x={620}
          y={72}
          w={184}
          h={72}
          name="การจ่ายงาน"
          sub="rider_trace"
          tag="DECISION"
          tone="accent"
        />
        <Node
          x={620}
          y={212}
          w={184}
          h={64}
          name="เจ้าหน้าที่ส่งยา"
          sub="rider_users + role"
          tone="store"
        />
        <Node x={620} y={320} w={184} h={60} name="บันทึกการส่งถึงมือ" sub="rider_send" tone="store" />
        <Node x={840} y={140} w={96} h={72} name="ภาพรวม" sub="ปีงบ · ไตรมาส" tone="accent" />

        <Callout
          x={36}
          y={300}
          w={288}
          lines={[
            'ภาพรวมนับทั้งงานที่จ่ายแล้วและผลการส่ง',
            'งานโตจาก 134 ครั้งในปีงบ 2566',
            'เป็น 5,401 ครั้งในปีงบ 2569',
          ]}
        />
      </DiagramFrame>

      <Legend
        items={[
          { tone: 'accent', label: 'จุดที่คนตัดสินใจ และผลที่ได้' },
          { tone: 'user', label: 'หน้าจอที่ใช้ทำงาน' },
          { tone: 'store', label: 'ตารางของระบบนี้' },
        ]}
      />
    </>
  )
}
