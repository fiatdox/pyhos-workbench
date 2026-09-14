'use client'
import { MonitorOutlined } from '@ant-design/icons'
import VisitReportPage from '../visit-report'

/**
 * รายงานผู้ป่วยเบาหวานสูงอายุที่ได้รับยา glibenclamide
 *
 * ทิศทางเหมือนกลุ่มยาปฏิชีวนะ — ยิ่งได้รับยิ่งต้องทบทวน glibenclamide เป็น
 * ซัลโฟนิลยูเรียที่ออกฤทธิ์ยาวและขับออกทางไต ในผู้สูงอายุจึงเสี่ยงน้ำตาลในเลือดต่ำ
 * รุนแรงและยืดเยื้อกว่ายาตัวอื่นในกลุ่มเดียวกัน
 *
 * โรงพยาบาลนี้ตัด glibenclamide ออกจากบัญชียาไปตั้งแต่ปี 2553 แล้ว รายงานจึงควร
 * ว่างเปล่าตลอด — ซึ่งเป็นผลลัพธ์ที่ถูกต้องของตัวชี้วัด ไม่ใช่ความผิดพลาด
 * หน้านี้มีไว้ยืนยันข้อนั้นให้คณะกรรมการเห็นเป็นตัวเลขในแต่ละรอบ
 */
export default function GlibenclamideElderlyReportPage() {
  return (
    <VisitReportPage
      kind="glibenclamide-elderly"
      labels={{
        title: 'ผู้ป่วยเบาหวานสูงอายุกับการได้รับยา glibenclamide',
        breadcrumb: 'glibenclamide ในผู้สูงอายุ',
        icon: <MonitorOutlined />,
        intro:
          'ผู้ป่วยนอกที่วินิจฉัยด้วยรหัสในทะเบียนโรคเบาหวาน ในช่วงวันที่ที่เลือก พร้อมช่องบอกว่าครั้งนั้นได้รับยา glibenclamide หรือไม่',
        drugLabel: 'ยา glibenclamide',
        patientLabel: 'ผู้ป่วยเบาหวานสูงอายุ',
        followUp: 'with',
        settings: {
          diagnosis: '/home/rdu/settings/dm-icd10',
          drug: '/home/rdu/settings/glibenclamide',
        },
        fileName: 'glibenclamide-ในผู้สูงอายุ',
      }}
    />
  )
}
