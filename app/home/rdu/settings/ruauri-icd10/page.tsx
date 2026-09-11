'use client'
import { FileSearchOutlined } from '@ant-design/icons'
import Icd10RegistryPage from '../icd10-registry'

/**
 * ทะเบียนรหัสวินิจฉัยโรคติดเชื้อทางเดินหายใจตามนิยาม RUA-URI — ตัวหารของตัวชี้วัด
 *
 * ชุดรหัสตามเอกสารตัวชี้วัดมี 50 รหัส และ 14 รหัสในนั้นเป็นหมวดหูชั้นกลางอักเสบ
 * (H65–H72) ซึ่งอยู่นอกหมวดโรคระบบหายใจ — หมวดตั้งต้นของทะเบียนนี้จึงยกมาทั้ง
 * สองช่วง (ตั้งไว้ที่ lib/his/rdu-registry.ts) ไม่งั้นครึ่งหนึ่งของชุดรหัสจะเลือกไม่ได้
 * จนกว่าจะเดาเองว่าต้องพิมพ์ค้น
 */
export default function RuaUriIcd10SettingsPage() {
  return (
    <Icd10RegistryPage
      registry="ruauri"
      icon={<FileSearchOutlined />}
      title="รหัสวินิจฉัยโรคติดเชื้อทางเดินหายใจ (RUA-URI)"
      breadcrumb="รหัสวินิจฉัย RUA-URI"
      targetTitle="ในทะเบียน RUA-URI"
      poolLabel="หมวดโรคระบบหายใจและหูชั้นกลาง (J00–J99, H65–H72)"
      intro="เลือกรหัส ICD-10 ตามนิยาม RUA-URI ของโครงการ Antibiotic Smart Use ใช้กับตัวชี้วัดผู้ป่วยเด็กที่ได้รับยาต้านฮิสตามีนชนิด non-sedating"
      searchHint={
        <>
          เช่น <b>J00</b>, <b>H650</b>, <b>otitis</b>, <b>หวัด</b>
        </>
      }
    />
  )
}
