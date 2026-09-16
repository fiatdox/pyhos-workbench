'use client'
import { MedicineBoxOutlined } from '@ant-design/icons'
import DrugRegistryPage from '../drug-registry'

/**
 * ทะเบียนยาปฏิชีวนะที่นับในตัวชี้วัด APL — ตัวตั้งของตัวชี้วัด
 *
 * เดิมข้อนี้ดูยาจากธง drugitems.antibiotic เหมือนข้อ AD แล้วย้ายมาเป็นทะเบียน
 * ตามที่เภสัชกรขอปรับชุดยาเอง — ใส่ไว้ตั้งต้นครบทั้ง 249 รายการตามธงเดิม
 * ตัวเลขย้อนหลังจึงเท่าเดิมทุกปีจนกว่าจะเริ่มตัดรายการออก
 */
export default function AplAntibioticSettingsPage() {
  return (
    <DrugRegistryPage
      registry="apl-antibiotic"
      icon={<MedicineBoxOutlined />}
      title="ยาปฏิชีวนะที่นับในตัวชี้วัด APL"
      breadcrumb="ยาปฏิชีวนะ (APL)"
      targetTitle="ในทะเบียนยาปฏิชีวนะ"
      intro="เลือกรหัสยาของโรงพยาบาลที่นับเป็นยาปฏิชีวนะของตัวชี้วัดบาดแผลสดจากอุบัติเหตุ — ตั้งต้นไว้ตามธงยาปฏิชีวนะใน HIS ทั้ง 249 รายการ ตัดออกได้ตามที่คณะกรรมการตกลง แยกจากทะเบียนของตัวชี้วัด RI"
    />
  )
}
