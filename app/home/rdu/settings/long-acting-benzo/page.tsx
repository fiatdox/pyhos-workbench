'use client'
import { MedicineBoxOutlined } from '@ant-design/icons'
import DrugRegistryPage from '../drug-registry'

/**
 * ทะเบียนยา benzodiazepine ที่ออกฤทธิ์ยาว
 *
 * เป็นทะเบียนที่ตั้งเองไม่ได้ทำให้เป็นอัตโนมัติเหมือนข้อ metformin — เส้นแบ่งของ
 * ข้อนี้คือค่าครึ่งชีวิตของยา ไม่ใช่ชื่อสามัญ ยาที่ลงท้าย -azepam เหมือนกัน
 * อยู่คนละฝั่งได้ (clonazepam ยาว · lorazepam สั้น) และไม่มีคอลัมน์ไหนในฐาน
 * HIS เก็บค่าครึ่งชีวิตไว้
 *
 * ใส่ไว้ให้ตั้งต้น 17 รหัส: diazepam, clonazepam, clorazepate, chlordiazepoxide
 * รวมของที่ตัดออกจากบัญชีไปแล้วเพราะข้อมูลย้อนหลังยังต้องใช้ — ที่ไม่ได้ใส่คือ
 * lorazepam, alprazolam, midazolam ซึ่งออกฤทธิ์สั้นถึงปานกลาง
 */
export default function LongActingBenzoSettingsPage() {
  return (
    <DrugRegistryPage
      registry="long-acting-benzo"
      icon={<MedicineBoxOutlined />}
      title="ยา long-acting benzodiazepine"
      breadcrumb="ยา benzodiazepine ออกฤทธิ์ยาว"
      targetTitle="ในทะเบียนยาออกฤทธิ์ยาว"
      intro="เลือกรหัสยากลุ่ม benzodiazepine ที่ออกฤทธิ์ยาว ใช้เป็นตัวตั้งของตัวชี้วัดการใช้ยาในผู้ป่วยนอกสูงอายุ — ไม่รวมยาที่ออกฤทธิ์สั้นอย่าง lorazepam, alprazolam, midazolam"
    />
  )
}
