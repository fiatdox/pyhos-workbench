'use client'
import { FileSearchOutlined } from '@ant-design/icons'
import Icd10RegistryPage from '../icd10-registry'

/**
 * ทะเบียนรหัสวินิจฉัยโรคติดเชื้อทางเดินหายใจส่วนบน (RI) — ตัวหารของตัวชี้วัด
 *
 * กลุ่มโรคนี้กว้างกว่าโรคหืด ครอบทั้งหวัด คออักเสบ ทอนซิลอักเสบ ไซนัสอักเสบ
 * และหลอดลมอักเสบเฉียบพลัน (J00–J06, J20–J22) ซึ่งอยู่ในหมวดตั้งต้นทั้งหมด
 * จึงเลือกได้โดยไม่ต้องพิมพ์ค้น
 */
export default function RiIcd10SettingsPage() {
  return (
    <Icd10RegistryPage
      registry="ri"
      icon={<FileSearchOutlined />}
      title="รหัสวินิจฉัยโรคติดเชื้อทางเดินหายใจส่วนบน (ICD-10)"
      breadcrumb="รหัสวินิจฉัยโรค RI"
      targetTitle="ในทะเบียนโรค RI"
      poolLabel="หมวดโรคระบบหายใจ (J00–J99)"
      intro="เลือกรหัส ICD-10 ที่นับเป็นโรคติดเชื้อทางเดินหายใจส่วนบนและหลอดลมอักเสบเฉียบพลัน ใช้กับตัวชี้วัดการใช้ยาปฏิชีวนะ"
      searchHint={
        <>
          เช่น <b>J00</b>, <b>pharyngitis</b>, <b>หวัด</b>
        </>
      }
    />
  )
}
