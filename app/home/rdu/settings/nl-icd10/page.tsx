'use client'
import { FileSearchOutlined } from '@ant-design/icons'
import Icd10RegistryPage from '../icd10-registry'

/**
 * ทะเบียนรหัสวินิจฉัยการคลอดปกติครบกำหนดทางช่องคลอด
 *
 * ใส่ O800 (Spontaneous vertex delivery / การคลอดปกติ) ไว้ให้ตั้งต้น ซึ่งเป็น
 * รหัสเดียวในหมวด O80 ที่โรงพยาบาลนี้ใช้จริง — ยกหมวด O80–O84 มาให้เลือก 32 รหัส
 * เผื่อคณะกรรมการตัดสินว่าการคลอดที่ใช้คีมหรือเครื่องดูด (O81) นับด้วย
 *
 * รหัส ICD-10 ไม่ได้บอกอายุครรภ์ คำว่า "ครบกำหนด" จึงยังไม่ได้ถูกกรองด้วยคิวรี
 */
export default function NlIcd10SettingsPage() {
  return (
    <Icd10RegistryPage
      registry="nl"
      icon={<FileSearchOutlined />}
      title="รหัสวินิจฉัยการคลอดปกติ"
      breadcrumb="รหัสวินิจฉัยการคลอดปกติ"
      targetTitle="ในทะเบียนการคลอดปกติ"
      poolLabel="หมวดการคลอด (O80–O84)"
      intro="เลือกรหัส ICD-10 ที่นับเป็นการคลอดปกติครบกำหนดทางช่องคลอด ใช้เป็นตัวหารของตัวชี้วัดการใช้ยาปฏิชีวนะในสตรีคลอดปกติ"
      searchHint={
        <>
          เช่น <b>O80</b>, <b>delivery</b>, <b>คลอด</b>
        </>
      }
    />
  )
}
