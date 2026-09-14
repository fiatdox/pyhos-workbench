'use client'
import { MedicineBoxOutlined } from '@ant-design/icons'
import DrugRegistryPage from '../drug-registry'

/**
 * ทะเบียนยากลุ่ม ARB — อีกครึ่งหนึ่งของตัวชี้วัด RAS blockade ซ้ำซ้อน
 *
 * รวม ARNI (sacubitril+valsartan) และยายับยั้งเรนินโดยตรง (aliskiren) ไว้ในทะเบียน
 * เดียวกัน เพราะทั้งคู่ออกฤทธิ์ที่ระบบเดียวกันและห้ามใช้ร่วมกับ ACEI เหมือนกัน
 * — การแยกอีกทะเบียนไม่ได้เปลี่ยนผลการนับ แต่ทำให้มีหน้าตั้งค่าเพิ่มมาโดยไม่ได้อะไร
 */
export default function RasArbSettingsPage() {
  return (
    <DrugRegistryPage
      registry="ras-arb"
      icon={<MedicineBoxOutlined />}
      title="ยากลุ่ม ARB / ARNI"
      breadcrumb="ยากลุ่ม ARB"
      targetTitle="ในทะเบียน ARB"
      intro="เลือกรหัสยาของโรงพยาบาลที่นับเป็นยาต้านตัวรับแองจิโอเทนซิน II (losartan, telmisartan, valsartan ฯลฯ รวมยาผสม) รวมถึง ARNI และยายับยั้งเรนินโดยตรง"
    />
  )
}
