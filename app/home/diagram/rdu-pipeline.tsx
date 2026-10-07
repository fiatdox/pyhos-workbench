'use client'
import { BusLink, Callout, DiagramFrame, Legend, Link, Node, ZoneLabel } from './primitives'

/**
 * ท่อข้อมูลตัวชี้วัด RDU
 *
 * เรื่องที่ภาพนี้ต้องสื่อคือ **ทะเบียนเป็นของเภสัชกร ไม่ใช่ของโปรแกรมเมอร์**
 * นิยามตัวชี้วัดเปลี่ยนทุกปี ถ้าต้องรอแก้โค้ดทุกครั้งระบบจะตามไม่ทัน สีเน้นจึง
 * อยู่ที่กล่องทะเบียนกับกล่องผลสิบสี่ตัวชี้วัด — ต้นทางที่คนคุมได้ กับปลายทาง
 * ที่เอาไปใช้จริง
 *
 * แปดกล่อง หกเส้น · เส้นที่เข้ากล่องคำนวณจากสามทะเบียนใช้ช่องกลาง 312 กับ 328
 * ห่างกัน 16px และเข้าขอบซ้ายคนละระดับ (148 · 180 · 212) ห่างกัน 32px
 */
export default function RduPipelineDiagram() {
  return (
    <>
      <DiagramFrame
        slug="rdu-pipeline"
        title="ท่อข้อมูลตัวชี้วัด RDU"
        desc="ตัวชี้วัดสิบสี่ข้อคำนวณจากข้อมูลบริการในฐาน HIS ประกบกับทะเบียนรหัสโรค รหัสยา และเกณฑ์ที่เภสัชกรแก้ได้เองจากหน้าตั้งค่า ผลออกเป็นหน้ารายงานรายเคส หน้าสรุปเทียบสามปีงบ และตัวช่วยทบทวนด้วยโมเดลภาษา"
        width={960}
        height={468}
      >
        <ZoneLabel x={36} y={32} text="INPUT" />
        <ZoneLabel x={384} y={32} text="COMPUTE" />
        <ZoneLabel x={700} y={32} text="OUTPUT" />

        <BusLink from={{ x: 244, y: 96 }} to={{ x: 384, y: 148 }} via={{ midX: 312 }} label="ตัวหาร" />
        <Link from={{ x: 244, y: 180 }} to={{ x: 384, y: 180 }} label="รายการรหัส" tone="accent" />
        <BusLink from={{ x: 244, y: 264 }} to={{ x: 384, y: 212 }} via={{ midX: 328 }} label="เกณฑ์" />
        <Link from={{ x: 568, y: 180 }} to={{ x: 700, y: 180 }} label="ผลตัวชี้วัด" tone="accent" />
        <Link from={{ x: 790, y: 220 }} to={{ x: 790, y: 268 }} label="รายเคส" />
        <Link from={{ x: 476, y: 240 }} to={{ x: 476, y: 332 }} label="ทบทวน" />

        <Node
          x={36}
          y={64}
          w={208}
          h={64}
          name="ข้อมูลบริการจาก HIS"
          sub="ovst · opitemrece · ovstdiag"
          tone="store"
        />
        <Node
          x={36}
          y={148}
          w={208}
          h={64}
          name="ทะเบียนรหัสโรค/รหัสยา"
          sub="pyhos_*_icd10 · *_icode"
          tag="EDITABLE"
          tone="accent"
        />
        <Node
          x={36}
          y={232}
          w={208}
          h={64}
          name="เกณฑ์และค่าตั้ง"
          sub="pyhos_rdu_setting"
          tone="store"
        />
        <Node x={384} y={120} w={184} h={120} name="คิวรีตัวชี้วัด" sub="lib/his/rdu-*.ts" />
        <Node
          x={700}
          y={140}
          w={180}
          h={80}
          name="14 ตัวชี้วัด"
          sub="RI · AD · APL · NL · …"
          tone="accent"
        />
        <Node
          x={700}
          y={268}
          w={180}
          h={60}
          name="รายงานรายเคส"
          sub="drill-down to visit"
          tone="user"
        />
        <Node
          x={700}
          y={372}
          w={180}
          h={60}
          name="สรุปเทียบ 3 ปีงบ"
          sub="pyhos_rdu_yearly"
          tone="store"
        />
        <Node
          x={384}
          y={332}
          w={184}
          h={60}
          name="ทบทวนด้วยโมเดลภาษา"
          sub="optional"
          tone="external"
        />

        <Link from={{ x: 790, y: 328 }} to={{ x: 790, y: 372 }} />

        <Callout
          x={36}
          y={340}
          w={288}
          lines={['ทะเบียนแก้ได้จากหน้าตั้งค่า 21 หน้า', 'ไม่ต้องแก้โค้ดเมื่อนิยามตัวชี้วัดเปลี่ยน']}
        />
      </DiagramFrame>

      <Legend
        items={[
          { tone: 'accent', label: 'สิ่งที่เภสัชกรคุมเองและผลที่ได้' },
          { tone: 'plain', label: 'การคำนวณ' },
          { tone: 'store', label: 'ที่เก็บข้อมูล' },
          { tone: 'dashed', label: 'ส่วนเสริม' },
        ]}
      />
    </>
  )
}
