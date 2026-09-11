'use client'
import { MedicineBoxOutlined } from '@ant-design/icons'
import DrugRegistryPage from '../drug-registry'

/** ทะเบียนยาปฏิชีวนะที่นับในตัวชี้วัด RI — ตัวตั้งของตัวชี้วัด */
export default function RiAntibioticSettingsPage() {
  return (
    <DrugRegistryPage
      registry="ri-antibiotic"
      icon={<MedicineBoxOutlined />}
      title="ยาปฏิชีวนะที่นับในตัวชี้วัด RI"
      breadcrumb="ยาปฏิชีวนะ (RI)"
      targetTitle="ในทะเบียนยาปฏิชีวนะ"
      intro="เลือกรหัสยาของโรงพยาบาลที่นับเป็นยาปฏิชีวนะ ใช้กับตัวชี้วัดโรคติดเชื้อทางเดินหายใจส่วนบน"
    />
  )
}
