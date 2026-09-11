'use client'
import { MonitorOutlined } from '@ant-design/icons'
import VisitReportPage from '../visit-report'

/**
 * ตัวชี้วัดที่ 18 — ร้อยละของผู้ป่วยเด็กที่ได้รับการวินิจฉัยเป็นโรคติดเชื้อของ
 * ทางเดินหายใจ (ตามรหัส ICD-10 ของ RUA-URI) และได้รับยาต้านฮิสตามีนชนิด
 * non-sedating
 *
 * ทิศทางเหมือน RI — ยิ่งได้รับยายิ่งต้องทบทวน เพราะยาต้านฮิสตามีนรุ่นที่สอง
 * ไม่มีหลักฐานว่าช่วยในโรคติดเชื้อทางเดินหายใจ กลุ่มที่เภสัชกรต้องตามจึงเป็น
 * กลุ่มที่ "ได้รับ" (followUp: 'with') เกณฑ์เป้าหมายตามเอกสารคือไม่เกินร้อยละ 20
 *
 * ตัวหารจำกัดอายุไม่เกิน 12 ปีตามนิยาม — ตัวกรองนั้นอยู่ฝั่งเซิร์ฟเวอร์
 * (ดู REPORTS ใน lib/his/rdu-visit-report.ts) ไม่ใช่กรองในเบราว์เซอร์
 */
export default function RuaUriChildReportPage() {
  return (
    <VisitReportPage
      kind="ruauri-child"
      labels={{
        title: 'ผู้ป่วยเด็กโรคติดเชื้อทางเดินหายใจกับการได้รับยาต้านฮิสตามีน non-sedating',
        breadcrumb: 'ผู้ป่วยเด็ก RUA-URI',
        icon: <MonitorOutlined />,
        intro:
          'ผู้ป่วยเด็กอายุไม่เกิน 12 ปี ที่วินิจฉัยด้วยรหัสในทะเบียน RUA-URI ในช่วงวันที่ที่เลือก พร้อมช่องบอกว่าครั้งนั้นได้รับยาต้านฮิสตามีนชนิด non-sedating หรือไม่ (เกณฑ์เป้าหมายไม่เกินร้อยละ 20)',
        drugLabel: 'ยาต้านฮิสตามีน',
        patientLabel: 'ผู้ป่วยเด็กโรคติดเชื้อทางเดินหายใจ',
        followUp: 'with',
        settings: {
          diagnosis: '/home/rdu/settings/ruauri-icd10',
          drug: '/home/rdu/settings/nonsedating-antihist',
        },
        fileName: 'ผู้ป่วยเด็ก-RUA-URI',
      }}
    />
  )
}
