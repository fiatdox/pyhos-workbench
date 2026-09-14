'use client'
import { FileSearchOutlined } from '@ant-design/icons'
import Icd10RegistryPage from '../icd10-registry'

/**
 * ทะเบียนรหัสวินิจฉัยบาดแผลสดจากอุบัติเหตุ (APL) — ตัวหารของตัวชี้วัด
 *
 * เหมือนข้อ AD ตรงที่ไม่มีหน้าตั้งค่ายาคู่กัน เพราะดูยาปฏิชีวนะจากคอลัมน์
 * drugitems.antibiotic ที่เภสัชกรติดธงไว้ในโปรแกรม HIS อยู่แล้ว
 */
export default function AplIcd10SettingsPage() {
  return (
    <Icd10RegistryPage
      registry="apl"
      icon={<FileSearchOutlined />}
      title="รหัสวินิจฉัยบาดแผลสดจากอุบัติเหตุ (ICD-10)"
      breadcrumb="รหัสวินิจฉัยแผลสด APL"
      targetTitle="ในทะเบียนแผลสด APL"
      poolLabel="หมวดการบาดเจ็บ (S00–T14)"
      intro="เลือกรหัส ICD-10 ที่นับเป็นบาดแผลสดจากอุบัติเหตุ ใช้กับตัวชี้วัดการใช้ยาปฏิชีวนะ"
      searchHint={
        <>
          เช่น <b>S01</b>, <b>open wound</b>, <b>บาดแผล</b>
        </>
      }
    />
  )
}
