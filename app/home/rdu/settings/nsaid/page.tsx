'use client'
import { MedicineBoxOutlined } from '@ant-design/icons'
import DrugRegistryPage from '../drug-registry'

/**
 * ทะเบียนยากลุ่ม NSAIDs — ตัวตั้งของตัวชี้วัดการใช้ NSAIDs ในผู้ป่วยโรคไตเรื้อรัง
 *
 * ในฐานมีคอลัมน์ pharmacology_group ที่จัดกลุ่มตาม BNF ไว้แล้ว (10.1.1 คือ NSAIDs)
 * แต่ติดไว้แค่ 50 รายการ เปิดใช้งานอยู่ 10 รายการ ซึ่งน้อยกว่าที่โรงพยาบาลมีจริง
 * — ยาแก้ปวดที่จัดไว้ในกลุ่มอื่นและยาทาเฉพาะที่ตกหล่นไปหลายตัว จึงให้เลือกจาก
 * รายการเต็มเหมือนทะเบียนยาข้ออื่น ไม่ได้กรองด้วยกลุ่ม BNF มาให้ก่อน
 */
export default function NsaidSettingsPage() {
  return (
    <DrugRegistryPage
      registry="nsaid"
      icon={<MedicineBoxOutlined />}
      title="ยากลุ่ม NSAIDs"
      breadcrumb="ยากลุ่ม NSAIDs"
      targetTitle="ในทะเบียน NSAIDs"
      intro="เลือกรหัสยาของโรงพยาบาลที่นับเป็นยาต้านการอักเสบที่ไม่ใช่สเตียรอยด์ (รวมยาทาเฉพาะที่และยาฉีด) ใช้กับตัวชี้วัดผู้ป่วยโรคไตเรื้อรัง"
    />
  )
}
