import 'server-only'
import { required } from '@/lib/db/env'

/**
 * รหัสรายการค่าบริการ (icode) ในตาราง opitemrece ของโรงพยาบาล
 *
 * เหตุผลเดียวกับรหัสแล็บใน lab-codes.ts — เป็นค่าเฉพาะของแต่ละโรงพยาบาล
 * ไม่ใช่ค่ามาตรฐาน จึงอ่านจาก .env ไม่ฝังไว้ในคิวรี
 *
 * เก็บเป็นข้อความไม่ใช่ตัวเลข เพราะคอลัมน์ icode เป็น varchar เทียบกับตัวเลข
 * แล้วฐานจะแปลงชนิดให้เอง ทำให้ใช้ index ix_icode ไม่ได้
 */
export const serviceCodes = {
  /** ค่าบริการจัดส่งยาไปยังผู้ป่วยที่บ้าน — ใช้หารายชื่อผู้ป่วยที่ต้องส่งยาในแต่ละวัน */
  drugDelivery: required('HIS_ICODE_DRUG_DELIVERY'),
}
