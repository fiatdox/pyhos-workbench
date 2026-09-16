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
 * ยาปฏิชีวนะมาจากทะเบียนของข้อนี้เอง ไม่ใช่ธง drugitems.antibiotic เหมือนข้อ AD —
 * เภสัชกรขอปรับชุดยาเอง เพราะแผลสดถามถึงยาที่ให้ป้องกันการติดเชื้อที่แผล
 * ซึ่งแคบกว่ายาปฏิชีวนะทุกตัวในโรงพยาบาล
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
          'ผู้ป่วยนอกที่วินิจฉัยด้วยรหัสในทะเบียนบาดแผลสดจากอุบัติเหตุ ในช่วงวันที่ที่เลือก พร้อมช่องบอกว่าครั้งนั้นได้รับยาในทะเบียนยาปฏิชีวนะของข้อนี้หรือไม่',
        drugLabel: 'ยาปฏิชีวนะ',
        patientLabel: 'ผู้ป่วยบาดแผลสดจากอุบัติเหตุ',
        followUp: 'with',
        settings: {
          diagnosis: '/home/rdu/settings/apl-icd10',
          drug: '/home/rdu/settings/apl-antibiotic',
        },
        fileName: 'ผู้ป่วยนอกแผลสด-APL',
      }}
    />
  )
}
