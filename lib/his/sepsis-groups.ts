/**
 * ชื่อกลุ่มและชนิดข้อมูลของรายงาน Sepsis — ส่วนที่ทั้งสองฝั่งต้องเห็นตรงกัน
 *
 * แยกออกจาก lib/his/sepsis-stats.ts เพราะไฟล์นั้นเป็น server-only (ต่อฐานข้อมูล)
 * ถ้าหน้าจอ import รายชื่อกลุ่มจากที่นั่น ตัว bundler จะลาก mysql2 เข้าไปใน
 * client bundle แล้ว build ล้ม — ที่นี่มีแต่ค่าคงที่กับชนิดข้อมูล ไม่มี import
 * ที่แตะฐานข้อมูลเลย จึงปลอดภัยทั้งสองฝั่ง
 *
 * ชนิดข้อมูลอยู่ที่นี่ด้วย ไม่ใช่เพราะจำเป็น (import type ถูกลบตอน compile อยู่แล้ว)
 * แต่เพื่อให้นิยามของรายงานอยู่รวมที่เดียว ไม่ต้องตามหาสองไฟล์
 */

/** ชื่อกลุ่มทั้งหมดที่หน้าจอใช้ — ลำดับนี้คือลำดับที่แสดงผล */
export const SEPSIS_GROUPS = [
  'all',
  'sepsisOnly',
  'shockOnly',
  'communityInfection',
  'hospitalInfection',
  'ciSepsis',
  'ciShock',
  'lrti',
  'uti',
  'bsi',
  'gi',
  'hbp',
  'skin',
  'musculo',
  'cns',
  'tropical',
  'arf',
  'aki',
  'dic',
  'encephalopathy',
  'cholestasis',
  'ckd',
  'dm',
  'cirrhosis',
  'lung',
  'heart',
  'hiv',
  'cancer',
  'autoimmune',
] as const

export type SepsisGroup = (typeof SEPSIS_GROUPS)[number]

/** ตำแหน่งการติดเชื้อทั้งเก้าระบบ */
export const SEPSIS_SITES: SepsisGroup[] = [
  'lrti',
  'uti',
  'bsi',
  'gi',
  'hbp',
  'skin',
  'musculo',
  'cns',
  'tropical',
]

/** ภาวะอวัยวะล้มเหลวและภาวะแทรกซ้อนรุนแรง (O1-O5) */
export const SEPSIS_ORGANS: SepsisGroup[] = ['arf', 'aki', 'dic', 'encephalopathy', 'cholestasis']

/** โรคประจำตัวที่เป็นปัจจัยเสี่ยง (P1-P8) */
export const SEPSIS_UNDERLYING: SepsisGroup[] = [
  'ckd',
  'dm',
  'cirrhosis',
  'lung',
  'heart',
  'hiv',
  'cancer',
  'autoimmune',
]

export type SepsisCount = {
  /** การนอนโรงพยาบาล (AN) ที่ติดธงกลุ่มนี้ */
  total: number
  dead: number
}

export type SepsisPeriod = {
  /** คีย์ของช่วง — ปีงบเป็น '2569' เดือนเป็น '2026-01' */
  key: string
  partial: boolean
  groups: Record<SepsisGroup, SepsisCount>
}

/** หนึ่งพื้นที่ (อำเภอหรือตำบล) ตามที่อยู่ในทะเบียนบ้านของผู้ป่วย */
export type SepsisArea = {
  /** รหัสอำเภอหรือตำบลสองหลัก */
  id: string
  name: string
  /** ติดเชื้อมาจากชุมชน — วินิจฉัยไว้ตั้งแต่แรกรับ */
  ci: SepsisCount
  /** ติดเชื้อระหว่างนอนโรงพยาบาล */
  hi: SepsisCount
  /**
   * CI ที่ไม่ได้รับส่งต่อมาจากที่อื่น
   *
   * มีความหมายเฉพาะกับอำเภอที่โรงพยาบาลตั้งอยู่ — อำเภออื่นผู้ป่วยส่วนใหญ่มาถึง
   * ผ่านการส่งต่อ ตัวเลขที่เหลือหลังตัดจึงไม่ได้สะท้อนอะไรของอำเภอนั้น
   */
  ciNonReferred: SepsisCount
  /** AN ในขอบเขต CI ที่ถูกตัดออกจาก ciNonReferred เพราะรับส่งต่อมา */
  referredIn: number
}

export type SepsisDistrict = SepsisArea & {
  /** ตำบลในอำเภอนี้ เรียงจากผู้ป่วย CI มากไปน้อย */
  tambons: SepsisArea[]
}

/** CI กับ HI ของกลุ่มพื้นที่หนึ่ง ใช้เป็นตัวหารของสัดส่วน */
export type SepsisAreaTotals = { ci: SepsisCount; hi: SepsisCount }

/**
 * ผู้ป่วยแยกตามพื้นที่ที่อยู่ ตลอดช่วงที่ดู (ไม่ได้แยกตามช่วงย่อย)
 *
 * ไม่แยกรายปี/รายเดือนเพราะคำถามของกราฟนี้คือ "คนไข้มาจากไหน" ซึ่งเป็นภาพรวม
 * ของช่วง ไม่ใช่แนวโน้ม — และการแยกจะทำให้ตำบลเล็ก ๆ เหลือช่องละศูนย์หรือหนึ่ง
 * จนอ่านอะไรไม่ได้
 */
export type SepsisAreas = {
  districts: SepsisDistrict[]
  /** ผู้ป่วยที่ทะเบียนบ้านอยู่นอกจังหวัด — ไม่อยู่ในกราฟรายอำเภอ */
  outside: SepsisAreaTotals
  inProvince: SepsisAreaTotals
  /** รหัสอำเภอที่โรงพยาบาลตั้งอยู่ — ส่วน "ไม่รับส่งต่อ" อ่านจากอำเภอนี้ */
  homeDistrict: string
}
