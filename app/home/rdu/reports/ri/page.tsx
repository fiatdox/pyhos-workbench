'use client'
import { MonitorOutlined } from '@ant-design/icons'
import VisitReportPage from '../visit-report'

/**
 * รายงานผู้ป่วยนอกโรคติดเชื้อทางเดินหายใจส่วนบน — ได้รับยาปฏิชีวนะหรือไม่
 *
 * ทิศทางของตัวชี้วัดข้อนี้ตรงข้ามกับโรคหืด — ยิ่งได้รับยาปฏิชีวนะยิ่งต้องทบทวน
 * เพราะโรคกลุ่มนี้ส่วนใหญ่เกิดจากไวรัส กลุ่มที่เภสัชกรต้องตามจึงเป็นกลุ่มที่
 * "ได้รับ" (followUp: 'with') หน้าจอจะเน้นกลุ่มนั้นแทน
 */
export default function RiReportPage() {
  return (
    <VisitReportPage
      kind="ri"
      labels={{
        title: 'ผู้ป่วยนอกโรคติดเชื้อทางเดินหายใจส่วนบนกับการได้รับยาปฏิชีวนะ',
        breadcrumb: 'ผู้ป่วยนอกโรค RI',
        icon: <MonitorOutlined />,
        intro:
          'ผู้ป่วยนอกที่วินิจฉัยด้วยรหัสในทะเบียนโรคติดเชื้อทางเดินหายใจส่วนบน ในช่วงวันที่ที่เลือก พร้อมช่องบอกว่าครั้งนั้นได้รับยาในทะเบียนยาปฏิชีวนะหรือไม่',
        drugLabel: 'ยาปฏิชีวนะ',
        patientLabel: 'ผู้ป่วยโรคติดเชื้อทางเดินหายใจส่วนบน',
        followUp: 'with',
        settings: {
          diagnosis: '/home/rdu/settings/ri-icd10',
          drug: '/home/rdu/settings/ri-antibiotic',
        },
        fileName: 'ผู้ป่วยนอกโรค-RI',
      }}
    />
  )
}
