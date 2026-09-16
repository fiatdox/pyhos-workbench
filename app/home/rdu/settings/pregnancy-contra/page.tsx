'use client'
import { WarningOutlined } from '@ant-design/icons'
import DrugRegistryPage from '../drug-registry'

/**
 * ทะเบียนยาที่ห้ามใช้ในสตรีตั้งครรภ์
 *
 * ใส่ไว้ให้ตั้งต้น 40 รหัส ตามสามกลุ่มที่ตัวชี้วัดระบุชื่อไว้ — warfarin,
 * statins ทุกตัว (simvastatin, atorvastatin, rosuvastatin, pitavastatin
 * รวมสูตรผสมและรหัสเก่าที่ตัดออกจากบัญชีไปแล้ว เพราะข้อมูลย้อนหลังยังต้องใช้)
 * และ ergots ที่เป็นยาแก้ไมเกรน (ergotamine+caffeine)
 *
 * ที่ไม่ได้ใส่ไว้ให้ทั้งที่เป็น ergot เหมือนกันคือ methylergometrine —
 * ยาตัวนั้นใช้ห้ามเลือดหลังคลอด ซึ่งเป็นตอนที่ไม่มีทารกในครรภ์แล้ว
 * ถ้าใส่เข้ามาจะได้เคสปลอมของสตรีที่เพิ่งคลอดไปเต็มรายงาน
 *
 * ไม่ได้ใช้คอลัมน์ drugitems.pregnancy ที่เก็บหมวดความเสี่ยงไว้ เพราะกรอกไม่ครบ
 * และไม่สม่ำเสมอ (เหตุผลเต็มอยู่ที่ทะเบียน preg-contra ใน lib/his/rdu-registry.ts)
 */
export default function PregnancyContraSettingsPage() {
  return (
    <DrugRegistryPage
      registry="preg-contra"
      icon={<WarningOutlined />}
      title="ยาที่ห้ามใช้ในสตรีตั้งครรภ์"
      breadcrumb="ยาที่ห้ามใช้ในสตรีตั้งครรภ์"
      targetTitle="ในทะเบียนยาที่ห้ามใช้"
      intro="เลือกรายการยาที่ห้ามใช้ในสตรีตั้งครรภ์ ใช้เป็นตัวตั้งของตัวชี้วัด — ตามนิยามคือ warfarin, statins และ ergots ที่ใช้แก้ไมเกรน ไม่รวม methylergometrine ซึ่งใช้ห้ามเลือดหลังคลอด"
    />
  )
}
