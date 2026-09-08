import 'server-only'
import { requiredNumber } from '@/lib/db/env'

/**
 * รหัสรายการตรวจในตาราง lab_items ของโรงพยาบาล
 *
 * ย้ายมาไว้ที่ .env เพราะเป็นค่าเฉพาะของแต่ละโรงพยาบาล — โรงพยาบาลอื่นที่ใช้
 * HIS ตัวเดียวกันรหัสไม่ตรงกัน ค่าพวกนี้จึงไม่ควรฝังอยู่ในโค้ดที่แชร์ออกไปได้
 * และเวลาย้ายไปติดตั้งที่อื่นจะได้แก้ที่ .env ที่เดียว ไม่ต้องไล่แก้ในคิวรี
 *
 * อ่านค่าตอน import ถ้าไม่ได้ตั้งไว้จะโยน error ทันที ไม่ปล่อยให้คิวรีวิ่งด้วย
 * รหัสว่างแล้วคืนผลเปล่าเหมือนไม่มีข้อมูล ซึ่งอันตรายกว่าพังตั้งแต่แรกมาก
 *
 * หารหัสของโรงพยาบาลได้จาก:
 *   SELECT lab_items_code, lab_items_name FROM lab_items WHERE lab_items_name LIKE '%...%'
 */
export const labCodes = {
  /** Creatinine — ค่าตั้งต้นของการคำนวณ CrCl และ eGFR ในใบคำขอ DUE */
  creatinine: requiredNumber('HIS_LAB_CODE_CREATININE'),
  /**
   * eGFR — ห้องแล็บออกให้คู่กับ Creatinine ในใบเดียวกัน (lab_order_number เดียวกัน)
   * จึงดึงพร้อมกันได้ในคิวรีเดียว ไม่ต้องแยกคิวรี
   */
  egfr: requiredNumber('HIS_LAB_CODE_EGFR'),
  /**
   * HLA-B*5801 — ผลไม่ได้เก็บเป็นค่าตัวเลข ช่อง lab_order_result เขียนว่า
   * "ดูผลที่ image" ตัวผลจริงเป็นภาพสแกนในฐานภาพอีกเครื่อง
   */
  hlaB5801: requiredNumber('HIS_LAB_CODE_HLA_B5801'),
}
