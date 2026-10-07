'use client'
import { Callout, DiagramFrame, Legend, Link, Node, Zone, ZoneLabel } from './primitives'

/**
 * การไหลของข้อมูลผู้ป่วยและการคุ้มครอง
 *
 * ภาพนี้มีเรื่องเดียวที่ต้องสื่อ: **ชั้น API เป็นเส้นที่ข้อมูลระบุตัวตนข้ามไม่ได้**
 * และทุกการเปิดดูถูกบันทึกไว้ สีเน้นจึงอยู่ที่สองกล่องนั้นเท่านั้น ที่เหลือเป็น
 * ทางผ่านธรรมดา
 *
 * หกกล่อง ห้าเส้น สองหมายเหตุ — ทุกเส้นเป็นเส้นตรง ไม่ต้องมีข้องอเลย เพราะ
 * เรื่องที่เล่าเป็นลำดับเดียวจากซ้ายไปขวา ไม่ใช่โครงข่าย
 */
export default function PatientDataDiagram() {
  return (
    <>
      <DiagramFrame
        slug="patient-data"
        title="การไหลของข้อมูลผู้ป่วยและการคุ้มครอง"
        desc="ข้อมูลผู้ป่วยถูกอ่านจากฐาน HIS ผ่านคิวรีฝั่งเซิร์ฟเวอร์ แล้วชั้น API ตัดข้อมูลระบุตัวตนออกก่อนส่งถึงเบราว์เซอร์ ทุกการเปิดดูถูกบันทึกเป็นร่องรอย และร่องรอยที่เก่ากว่ากำหนดถูกย้ายออกเป็นไฟล์บีบอัด"
        width={960}
        height={428}
      >
        <ZoneLabel x={36} y={32} text="SERVER ONLY" />
        <ZoneLabel x={716} y={32} text="BROWSER" />

        <Zone x={24} y={44} w={400} h={128} />

        <Link from={{ x: 180, y: 112 }} to={{ x: 228, y: 112 }} />
        <Link from={{ x: 396, y: 112 }} to={{ x: 452, y: 112 }} label="ผลดิบ" />
        <Link from={{ x: 652, y: 112 }} to={{ x: 716, y: 112 }} label="ที่ตัดแล้ว" tone="accent" />
        <Link
          from={{ x: 552, y: 148 }}
          to={{ x: 552, y: 232 }}
          label="ใครดูของใคร"
          tone="accent"
        />
        <Link from={{ x: 468, y: 262 }} to={{ x: 340, y: 262 }} label="เกิน 180 วัน" />

        <Node x={36} y={76} w={144} h={72} name="ฐาน HIS" sub="ovst · lab_* · ipt" tone="store" />
        <Node x={228} y={76} w={168} h={72} name="คิวรีฝั่งเซิร์ฟเวอร์" sub="lib/his/*" />
        <Node
          x={452}
          y={76}
          w={200}
          h={72}
          name="ชั้น API"
          sub="auth · rate limit · strip"
          tag="BOUNDARY"
          tone="accent"
        />
        <Node
          x={716}
          y={76}
          w={212}
          h={72}
          name="หน้าจอที่ผู้ใช้เห็น"
          sub="no id / phone / address"
          tone="user"
        />
        <Node
          x={468}
          y={232}
          w={168}
          h={60}
          name="ร่องรอยการใช้งาน"
          sub="core_kon activity"
          tone="accent"
        />
        <Node
          x={172}
          y={232}
          w={168}
          h={60}
          name="ไฟล์บีบอัดที่เก็บไว้"
          sub="archive .jsonl.gz"
          tone="store"
        />

        <Callout
          x={684}
          y={192}
          w={244}
          lines={['เลขบัตรประชาชน เบอร์โทร ที่อยู่', 'ใช้ค้นได้ฝั่งเซิร์ฟเวอร์', 'แต่ข้ามเส้นนี้ไปไม่ได้']}
        />
        <Callout
          x={36}
          y={332}
          w={372}
          lines={[
            'ร่องรอยระบุฟีเจอร์จาก path ของคำขอ',
            'หน้าใหม่ที่ยืมเส้น API ของหน้าอื่นจะถูกบันทึกผิดฟีเจอร์',
          ]}
        />
      </DiagramFrame>

      <Legend
        items={[
          { tone: 'accent', label: 'จุดที่คุ้มครองข้อมูล' },
          { tone: 'plain', label: 'ทางผ่านฝั่งเซิร์ฟเวอร์' },
          { tone: 'store', label: 'ที่เก็บข้อมูล' },
          { tone: 'user', label: 'สิ่งที่ผู้ใช้เห็น' },
        ]}
      />
    </>
  )
}
