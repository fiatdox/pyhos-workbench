'use client'
import { MedicineBoxOutlined } from '@ant-design/icons'
import DrugRegistryPage from '../drug-registry'

/**
 * ทะเบียนยากลุ่ม ACE inhibitor — ครึ่งหนึ่งของตัวชี้วัด RAS blockade ซ้ำซ้อน
 *
 * ต้องแยกทะเบียนจาก ARB แม้ตัวชี้วัดจะนับรวมกัน เพื่อให้เห็นบนหน้าจอว่าเคสหนึ่ง
 * ซ้ำข้ามกลไกหรือซ้ำในกลไกเดียวกัน ซึ่งเป็นคนละประเด็นตอนทบทวน
 */
export default function RasAceiSettingsPage() {
  return (
    <DrugRegistryPage
      registry="ras-acei"
      icon={<MedicineBoxOutlined />}
      title="ยากลุ่ม ACE inhibitor"
      breadcrumb="ยากลุ่ม ACEI"
      targetTitle="ในทะเบียน ACEI"
      intro="เลือกรหัสยาของโรงพยาบาลที่นับเป็นยายับยั้งเอนไซม์แปลงแองจิโอเทนซิน (enalapril, perindopril, ramipril, captopril ฯลฯ รวมยาผสม) ใช้กับตัวชี้วัด RAS blockade ซ้ำซ้อน"
    />
  )
}
