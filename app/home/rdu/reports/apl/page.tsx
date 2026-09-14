'use client'
import { MonitorOutlined } from '@ant-design/icons'
import VisitReportPage from '../visit-report'

/**
 * รายงานผู้ป่วยนอกบาดแผลสดจากอุบัติเหตุ — ได้รับยาปฏิชีวนะหรือไม่
 *
 * ทิศทางเหมือน RI และ AD — ยิ่งได้รับยาปฏิชีวนะยิ่งต้องทบทวน เพราะบาดแผลสด
 * ที่ล้างและดูแลถูกวิธีส่วนใหญ่ไม่ต้องให้ยาปฏิชีวนะ กลุ่มที่เภสัชกรต้องตามจึงเป็น
 * กลุ่มที่ "ได้รับ"
 *
 * ไม่มีหน้าตั้งค่ายาเช่นเดียวกับข้อ AD — ยาปฏิชีวนะดูจากธง drugitems.antibiotic
 * ที่ติดไว้ในโปรแกรม HIS แล้ว
 */
export default function AplReportPage() {
  return (
    <VisitReportPage
      kind="apl"
      labels={{
        title: 'ผู้ป่วยนอกบาดแผลสดจากอุบัติเหตุกับการได้รับยาปฏิชีวนะ',
        breadcrumb: 'ผู้ป่วยนอกแผลสด APL',
        icon: <MonitorOutlined />,
        intro:
          'ผู้ป่วยนอกที่วินิจฉัยด้วยรหัสในทะเบียนบาดแผลสดจากอุบัติเหตุ ในช่วงวันที่ที่เลือก พร้อมช่องบอกว่าครั้งนั้นได้รับยาที่ติดธงยาปฏิชีวนะไว้ใน HIS หรือไม่',
        drugLabel: 'ยาปฏิชีวนะ',
        patientLabel: 'ผู้ป่วยบาดแผลสดจากอุบัติเหตุ',
        followUp: 'with',
        settings: { diagnosis: '/home/rdu/settings/apl-icd10' },
        fileName: 'ผู้ป่วยนอกแผลสด-APL',
      }}
    />
  )
}
