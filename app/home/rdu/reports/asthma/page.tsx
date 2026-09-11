'use client'
import { MonitorOutlined } from '@ant-design/icons'
import VisitReportPage from '../visit-report'

/**
 * รายงานผู้ป่วยนอกโรคหอบหืด — ได้รับยาสูดพ่นคอร์ติโคสเตียรอยด์หรือไม่
 *
 * ทิศทางของตัวชี้วัดข้อนี้คือยิ่งได้รับยา ICS ยิ่งดี กลุ่มที่เภสัชกรต้องตามจึงเป็น
 * กลุ่มที่ "ไม่ได้รับ" (followUp: 'without')
 */
export default function AsthmaReportPage() {
  return (
    <VisitReportPage
      kind="asthma"
      labels={{
        title: 'ผู้ป่วยนอกโรคหอบหืดกับการได้รับยา ICS',
        breadcrumb: 'ผู้ป่วยนอกโรคหอบหืด',
        icon: <MonitorOutlined />,
        intro:
          'ผู้ป่วยนอกที่วินิจฉัยด้วยรหัสในทะเบียนโรคหอบหืด ในช่วงวันที่ที่เลือก พร้อมช่องบอกว่าครั้งนั้นได้รับยาในทะเบียนยาสูดพ่นหรือไม่',
        drugLabel: 'ยา ICS',
        patientLabel: 'ผู้ป่วยโรคหอบหืด',
        followUp: 'without',
        settings: {
          diagnosis: '/home/rdu/settings/asthma-icd10',
          drug: '/home/rdu/settings/inhaler',
        },
        fileName: 'ผู้ป่วยนอกโรคหืด',
      }}
    />
  )
}
