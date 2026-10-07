'use client'
import { BusLink, Callout, DiagramFrame, Legend, Link, Node, Zone, ZoneLabel } from './primitives'

/**
 * ภาพรวมสถาปัตยกรรม — อะไรต่อกับอะไร และทิศทางการอ่าน/เขียน
 *
 * สิ่งที่ภาพนี้ต้องทำให้เห็นในหนึ่งแวบคือ **ระบบไม่เคยเขียนลงตารางของ HIS**
 * เขียนเฉพาะตาราง fiat_pyhos_* ที่เป็นของเราเอง จึงให้สีเน้นกับสองกล่องนั้น
 * (ตัวแอปกับตารางของเราเอง) ตามงบที่ให้ใช้สีเน้นได้ไม่เกินสองกล่อง
 *
 * แปดกล่อง เจ็ดเส้น อยู่ในงบไม่เกินเก้ากล่องและสิบสองเส้น
 *
 * เส้นที่แตกจากกล่องแอปไปฐานสี่ตัวใช้ช่องกลางคนละค่า (588 · 604 · 620) ห่างกัน
 * 16px ตามกฎที่ห้ามเส้นขนานซ้อนกันใกล้กว่า 12px และออกจากขอบขวาคนละจุด
 * (88 · 120 · 152 · 184) ห่างกัน 32px ตามกฎจุดเกาะแบบพัด
 */
export default function ArchitectureDiagram() {
  return (
    <>
      <DiagramFrame
        slug="architecture"
        title="ภาพรวมสถาปัตยกรรม pyhos-workbench"
        desc="ระบบอ่านข้อมูลจากฐาน HIS ฐานผู้ใช้ และฐานภาพสแกนโดยตรง เขียนเฉพาะตารางของตัวเองในฐาน HIS และต่อออกไปที่โมเดลภาษาในเครือข่ายโรงพยาบาลกับบริการแจ้งเตือนหมอพร้อม"
        width={960}
        height={472}
      >
        <ZoneLabel x={36} y={32} text="PEOPLE" />
        <ZoneLabel x={296} y={32} text="APPLICATION" />
        <ZoneLabel x={640} y={32} text="DATA" />

        <Zone x={624} y={40} w={320} h={328} />

        {/* เส้นทั้งชุดวาดก่อนกล่อง — แผ่นทึบใต้ป้ายจะได้ไม่ไปทับกล่องที่วาดทีหลัง */}
        <Link from={{ x: 196, y: 112 }} to={{ x: 296, y: 112 }} label="เบราว์เซอร์" />
        {/* เส้นชุดพัดนี้ไม่มีป้ายกำกับ — ช่องว่างระหว่างกล่องแอปกับเลนตั้งกว้างแค่
            52-84px ป้ายอย่าง "อ่าน/เขียน" กว้างกว่านั้นและจะล้นไปบังเลนข้างเคียง
            ย้ายไปเป็นป้ายประเภทในกล่องปลายทางแทน ได้ความหมายเท่าเดิมโดยไม่ต้อง
            เบียดอะไรเลย และลดของบนภาพไปสี่ชิ้น */}
        <Link from={{ x: 536, y: 88 }} to={{ x: 640, y: 88 }} />
        <BusLink from={{ x: 536, y: 120 }} to={{ x: 640, y: 168 }} via={{ midX: 588 }} tone="accent" />
        <BusLink from={{ x: 536, y: 152 }} to={{ x: 640, y: 248 }} via={{ midX: 604 }} />
        <BusLink from={{ x: 536, y: 184 }} to={{ x: 640, y: 324 }} via={{ midX: 620 }} />
        <Link from={{ x: 372, y: 196 }} to={{ x: 372, y: 296 }} label="สรุปข้อความ" />
        <BusLink
          from={{ x: 316, y: 196 }}
          to={{ x: 144, y: 296 }}
          via={{ midY: 252 }}
          label="แจ้งเตือน"
        />

        <Node x={36} y={76} w={160} h={72} name="เภสัชกร · ผู้บริหาร" sub="login + OTP" tone="user" />
        <Node
          x={296}
          y={64}
          w={240}
          h={132}
          name="pyhos-workbench"
          sub="Next.js 16 · Node"
          tag="APP"
          tone="accent"
        />
        <Node
          x={640}
          y={56}
          w={288}
          h={64}
          name="ตารางของโรงพยาบาล"
          tag="READ ONLY"
          sub="ovst · opitemrece · lab_* · ipt"
          tone="store"
        />
        <Node
          x={640}
          y={136}
          w={288}
          h={64}
          name="ตารางของระบบนี้"
          tag="READ+WRITE"
          sub="fiat_pyhos_* + pyhos_rdu_*"
          tone="accent"
        />
        <Node
          x={640}
          y={216}
          w={288}
          h={64}
          name="ผู้ใช้ สิทธิ์ ร่องรอย"
          tag="READ+WRITE"
          sub="core_kon · PostgreSQL"
          tone="store"
        />
        <Node
          x={640}
          y={296}
          w={288}
          h={56}
          name="ภาพสแกนเวชระเบียน"
          tag="READ ONLY"
          sub="MariaDB · opdscan"
          tone="store"
        />
        <Node x={296} y={296} w={152} h={56} name="โมเดลภาษา" sub="in-network" tone="external" />
        <Node x={68} y={296} w={152} h={56} name="หมอพร้อม" sub="MOPH Alerting" tone="external" />

        <Callout
          x={36}
          y={388}
          w={408}
          lines={[
            'ตารางของระบบนี้อยู่ในฐาน HIS เครื่องเดียวกัน',
            'สร้างตรงในฐาน ไม่มีไฟล์ migration ในรีโป',
          ]}
        />
      </DiagramFrame>

      <Legend
        items={[
          { tone: 'accent', label: 'จุดที่ระบบเขียนข้อมูล' },
          { tone: 'store', label: 'ฐานข้อมูล' },
          { tone: 'dashed', label: 'บริการภายนอกแอป' },
          { tone: 'user', label: 'ผู้ใช้งาน' },
        ]}
      />
    </>
  )
}
