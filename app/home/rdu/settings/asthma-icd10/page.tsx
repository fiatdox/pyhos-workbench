'use client'
import { FileSearchOutlined } from '@ant-design/icons'
import Icd10RegistryPage from '../icd10-registry'

/** ทะเบียนรหัสวินิจฉัยโรคหอบหืด — ตัวหารของตัวชี้วัดผู้ป่วยโรคหืด */
export default function AsthmaIcd10SettingsPage() {
  return (
    <Icd10RegistryPage
      registry="asthma"
      icon={<FileSearchOutlined />}
      title="รหัสวินิจฉัยโรคหอบหืด (ICD-10)"
      breadcrumb="รหัสวินิจฉัยโรคหอบหืด"
      targetTitle="ในทะเบียนโรคหอบหืด"
      poolLabel="หมวดโรคระบบหายใจ (J00–J99)"
      intro="เลือกรหัส ICD-10 ที่นับเป็นโรคหอบหืด ใช้กับตัวชี้วัดผู้ป่วยโรคหืดที่ได้รับยา ICS"
      searchHint={
        <>
          เช่น <b>J45</b>, <b>asthma</b>, <b>หอบหืด</b>
        </>
      }
    />
  )
}
