'use client'
import { MedicineBoxOutlined } from '@ant-design/icons'
import DrugRegistryPage from '../drug-registry'

/**
 * ทะเบียนยา glibenclamide — ตัวตั้งของตัวชี้วัดการใช้ยาในผู้สูงอายุ
 *
 * ใส่รหัสทั้งสองรายการไว้ให้ตั้งแต่ต้น เพราะทั้งคู่ถูกตัดออกจากบัญชียาไปแล้ว
 * (istatus = 'N' ตั้งแต่ปี 2553) และหน้าตั้งค่ายกเฉพาะรายการที่เปิดใช้งานอยู่
 * หรือรายการที่อยู่ในทะเบียนแล้วมาให้เลือก — ถ้าไม่ใส่ไว้ก่อน คณะกรรมการจะหา
 * รหัสเหล่านี้ในหน้านี้ไม่เจอเลย
 */
export default function GlibenclamideSettingsPage() {
  return (
    <DrugRegistryPage
      registry="glibenclamide"
      icon={<MedicineBoxOutlined />}
      title="ยา glibenclamide"
      breadcrumb="ยา glibenclamide"
      targetTitle="ในทะเบียน glibenclamide"
      intro="เลือกรหัสยาของโรงพยาบาลที่นับเป็น glibenclamide (รวมยาผสม) ใช้กับตัวชี้วัดการใช้ยาในผู้ป่วยเบาหวานสูงอายุ"
    />
  )
}
