'use client'
import { FileSearchOutlined } from '@ant-design/icons'
import Icd10RegistryPage from '../icd10-registry'

/**
 * ทะเบียนรหัสวินิจฉัยโรคเบาหวาน — ตัวหารของตัวชี้วัด glibenclamide ในผู้สูงอายุ
 *
 * ใส่รหัสหมวด E10–E14 ไว้ให้ครบทั้ง 55 รหัสตั้งแต่ต้น เพราะทุกรหัสในหมวดนี้เป็น
 * เบาหวานทั้งหมด ไม่มีรหัสที่ต้องตัดสินใจเหมือนทะเบียนข้ออื่น — ในฐานใช้จริง
 * แค่ E11 (28,356 ครั้งต่อปี) E14 (1,842) E10 (314) และ E13 (16)
 */
export default function DmIcd10SettingsPage() {
  return (
    <Icd10RegistryPage
      registry="dm"
      icon={<FileSearchOutlined />}
      title="รหัสวินิจฉัยโรคเบาหวาน (ICD-10)"
      breadcrumb="รหัสวินิจฉัยเบาหวาน"
      targetTitle="ในทะเบียนเบาหวาน"
      poolLabel="หมวดเบาหวาน (E10–E14)"
      intro="เลือกรหัส ICD-10 ที่นับเป็นโรคเบาหวาน ใช้กับตัวชี้วัดการใช้ยา glibenclamide ในผู้สูงอายุ"
      searchHint={
        <>
          เช่น <b>E11</b>, <b>diabetes</b>, <b>เบาหวาน</b>
        </>
      }
    />
  )
}
