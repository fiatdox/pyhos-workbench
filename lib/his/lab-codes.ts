import 'server-only'
import { optionalNumber, requiredNumber } from '@/lib/db/env'

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

/**
 * ค่าแล็บประกอบการพิจารณาใบคำขอ DUE — ตั้งหรือไม่ตั้งก็ได้
 *
 * ใช้ optionalNumber ไม่ใช่ requiredNumber เพราะค่าพวกนี้เป็นของเสริม ไม่ใช่แกน
 * ของการคำนวณ ไม่ตั้งก็แค่ไม่มีแถวนั้นในตาราง ระบบส่วนอื่นยังทำงานได้ครบ
 *
 * รหัสที่วัดมาจากฐานจริงพร้อมความครบของผู้ป่วยที่นอนอยู่ 367 ราย ย้อนหลัง 1 ปี:
 *   WBC 230 · NE% 243   — มีผล 87% ของผู้ป่วย (66% มีมากกว่าหนึ่งครั้ง)
 *   ALT 101 · AST 102   — 53% (33-34%)
 *   T-BILI 98           — 52% (32%)
 *   Albumin 97          — 53% (35%)
 *   hs-CRP 770          — 7% เท่านั้น (5%)
 *
 * ชื่อซ้ำกันในทะเบียนเยอะ ต้องเลือกให้ถูกใบ:
 *   WBC ของ CBC คือ 230 [cell/cu.mm] ไม่ใช่ 535004/33130 ที่เป็น WBC ในปัสสาวะ
 *     [cell/HPF] — คนละเรื่องกันแต่ชื่อเหมือนกันเป๊ะ
 *   bilirubin ในเลือดคือ 98 (T-BILI [mg/dL] 0.3-1.2) ไม่ใช่ 932 ที่ชื่อ
 *     "Bilirubin" เฉย ๆ ซึ่งเป็นแถบจุ่มปัสสาวะ (ค่าปกติ = Negative)
 *   albumin ในเลือดคือ 97 [g/dL] ไม่ใช่ 764 urine microalbumin
 *   CRP ที่ห้องแล็บออกจริงคือ hs-CRP (770) ส่วนรหัส CRP ธรรมดา (276) มีผลรวม
 *     ทั้งฐานแค่ 50 ครั้งและไม่มีของผู้ป่วยที่นอนอยู่เลย
 *
 * ไม่ใส่ Procalcitonin ทั้งที่มีรหัส (2041) — มีผลรวมทั้งฐาน 1 ครั้ง
 * และ Neutrophil ไม่มีรายการชื่อนั้น ตัวที่ห้องแล็บออกคือ NE% ในชุด CBC
 */
export const labTrendCodes = {
  /** WBC [cell/cu.mm] — ดูหมายเหตุเรื่องจุลภาคในผลที่ lib/his/lab-trend.ts */
  wbc: optionalNumber('HIS_LAB_CODE_WBC'),
  /** NE% — นิวโทรฟิลเป็นเปอร์เซ็นต์ ใช้คำนวณ ANC คู่กับ WBC */
  neutrophilPercent: optionalNumber('HIS_LAB_CODE_NEUTROPHIL_PCT'),
  /** hs-CRP (mg/L) */
  crp: optionalNumber('HIS_LAB_CODE_CRP'),
  alt: optionalNumber('HIS_LAB_CODE_ALT'),
  ast: optionalNumber('HIS_LAB_CODE_AST'),
  /** Total bilirubin (mg/dL) */
  bilirubin: optionalNumber('HIS_LAB_CODE_BILIRUBIN'),
  /** Albumin ในเลือด (g/dL) */
  albumin: optionalNumber('HIS_LAB_CODE_ALBUMIN'),
}
