'use client'
import { MedicineBoxOutlined } from '@ant-design/icons'
import DrugRegistryPage from '../drug-registry'

/** ทะเบียนยาสูดพ่นคอร์ติโคสเตียรอยด์ — ตัวตั้งของตัวชี้วัดผู้ป่วยโรคหืด */
export default function InhalerSettingsPage() {
  return (
    <DrugRegistryPage
      registry="inhaler"
      icon={<MedicineBoxOutlined />}
      title="ยากลุ่ม Inhaled corticosteroid"
      breadcrumb="ยากลุ่ม Inhaled corticosteroid"
      targetTitle="ในทะเบียน ICS"
      intro="เลือกรหัสยาของโรงพยาบาลที่นับเป็นยาสูดพ่นคอร์ติโคสเตียรอยด์ ใช้กับตัวชี้วัดผู้ป่วยโรคหืด"
    />
  )
}
