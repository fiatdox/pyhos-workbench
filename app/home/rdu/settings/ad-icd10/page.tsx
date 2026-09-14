'use client'
import { FileSearchOutlined } from '@ant-design/icons'
import Icd10RegistryPage from '../icd10-registry'

/**
 * ทะเบียนรหัสวินิจฉัยโรคอุจจาระร่วงเฉียบพลัน (AD) — ตัวหารของตัวชี้วัด
 *
 * ตัวชี้วัดข้อนี้ไม่มีหน้าตั้งค่ายาคู่กัน เพราะดูยาปฏิชีวนะจากคอลัมน์
 * drugitems.antibiotic ที่เภสัชกรติดธงไว้ในโปรแกรม HIS อยู่แล้ว
 */
export default function AdIcd10SettingsPage() {
  return (
    <Icd10RegistryPage
      registry="ad"
      icon={<FileSearchOutlined />}
      title="รหัสวินิจฉัยโรคอุจจาระร่วงเฉียบพลัน (ICD-10)"
      breadcrumb="รหัสวินิจฉัยโรค AD"
      targetTitle="ในทะเบียนโรค AD"
      poolLabel="หมวดลำไส้ติดเชื้อ (A00–A09)"
      intro="เลือกรหัส ICD-10 ที่นับเป็นโรคอุจจาระร่วงเฉียบพลัน ใช้กับตัวชี้วัดการใช้ยาปฏิชีวนะ"
      searchHint={
        <>
          เช่น <b>A09</b>, <b>diarrhoea</b>, <b>อุจจาระร่วง</b>
        </>
      }
    />
  )
}
