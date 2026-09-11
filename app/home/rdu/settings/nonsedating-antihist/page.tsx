'use client'
import { MedicineBoxOutlined } from '@ant-design/icons'
import DrugRegistryPage from '../drug-registry'

/**
 * ทะเบียนยาต้านฮิสตามีนชนิด non-sedating — ตัวตั้งของตัวชี้วัดผู้ป่วยเด็ก RUA-URI
 *
 * นิยามตามเอกสารตัวชี้วัดคือ cetirizine, desloratadine, fexofenadine,
 * levocetirizine และ loratadine ทั้งชนิดยาเดี่ยวและยาผสม — ยาผสมไม่ได้ขึ้นชื่อ
 * ตัวยาไว้ในชื่อรายการเสมอ จึงต้องให้เภสัชกรไล่เลือกเอง ไม่ได้ค้นจากชื่อให้
 */
export default function NonSedatingAntihistSettingsPage() {
  return (
    <DrugRegistryPage
      registry="nonsedating-antihist"
      icon={<MedicineBoxOutlined />}
      title="ยาต้านฮิสตามีนชนิด non-sedating"
      breadcrumb="ยาต้านฮิสตามีน non-sedating"
      targetTitle="ในทะเบียน non-sedating"
      intro="เลือกรหัสยาของโรงพยาบาลที่นับเป็นยาต้านฮิสตามีนรุ่นที่สอง (cetirizine, desloratadine, fexofenadine, levocetirizine, loratadine ทั้งยาเดี่ยวและยาผสม)"
    />
  )
}
