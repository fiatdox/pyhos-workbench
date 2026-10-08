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

/**
 * ที่มาของการติดเชื้อ คูณกับการรับส่งต่อ — หกชุดที่รายงานอัตราตายแยกกัน
 *
 * own = มาโรงพยาบาลเอง · referred = รับส่งต่อมาจากสถานพยาบาลอื่น
 * ci + hi ซ้อนกันได้ (AN เดียวมีได้ทั้งสอง) แต่ own + referred ของแต่ละฝั่ง
 * แบ่งกันหมดพอดีและบวกกันได้เท่ากับยอดของฝั่งนั้น
 */
export const SEPSIS_SPLITS = ['ci', 'ciOwn', 'ciReferred', 'hi', 'hiOwn', 'hiReferred'] as const

export type SepsisSplit = (typeof SEPSIS_SPLITS)[number]

export type SepsisPeriod = {
  /** คีย์ของช่วง — ปีงบเป็น '2569' เดือนเป็น '2026-01' */
  key: string
  partial: boolean
  groups: Record<SepsisGroup, SepsisCount>
  /**
   * CI/HI คูณกับการรับส่งต่อ พร้อมจำนวนที่เสียชีวิตของแต่ละชุด
   *
   * ไม่ได้อยู่ใน groups เพราะไม่ใช่ธงบนรหัสโรคเหมือนกลุ่มอื่น — การรับส่งต่อ
   * ต้องต่อทะเบียน referin ผ่าน ovst เข้ามา ไม่ได้อ่านจาก iptdiag
   */
  splits: Record<SepsisSplit, SepsisCount>
  /**
   * ผู้ป่วย CI ของอำเภอที่โรงพยาบาลตั้งอยู่ แยกว่ารับส่งต่อมาหรือมาเอง
   *
   * ต่างจาก splits ที่นับผู้ป่วยทุกคน ชุดนี้จำกัดอำเภอเดียวเพื่อตอบคำถามว่า
   * ในเขตรับผิดชอบมีสัดส่วนที่มาถึงผ่านการส่งต่อเท่าไร
   */
  homeReferral: {
    /** CI ทั้งหมดของอำเภอนั้นในช่วงนี้ — ตัวหารของอัตรารับส่งต่อ */
    ci: number
    referredIn: number
  }
  /**
   * การเข้าถึง ICU แยกตามระยะเวลาจากแรกรับ — ดู SEPSIS_ICU_BINS
   *
   * เก็บเป็นถังดิบไม่ใช่อัตราที่คิดแล้ว เพื่อให้หน้าจอเปลี่ยนเกณฑ์เวลาได้โดย
   * ไม่ต้องถามฐานใหม่ — อัตราของทุกเกณฑ์คิดจากถังชุดเดียวกันนี้ทั้งหมด
   */
  icu: Record<SepsisIcuScope, SepsisIcuCounts>
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

/** สถานพยาบาลต้นทางหนึ่งแห่งที่ส่งผู้ป่วย CI Sepsis มา */
export type SepsisReferral = {
  /** รหัสสถานพยาบาลห้าหลักตามทะเบียน hospcode */
  code: string
  name: string
  /** CI Sepsis ที่รับส่งต่อมาจากที่นี่ */
  ci: SepsisCount
  /**
   * ในกลุ่มนั้น ที่ลง R572 เป็นโรคร่วมแรกรับ (diagtype 2)
   *
   * แคบกว่ากลุ่ม ciShock ของกราฟตามเวลา ซึ่งนับ diagtype 1 ด้วย — ตามนิยามที่
   * ได้รับมาสำหรับรายงานนี้ วัดแล้วต่างกัน 83 AN จาก 2,434 ในห้าปีงบ
   */
  shock: SepsisCount
}

/**
 * ผู้ป่วย CI Sepsis ที่รับส่งต่อมา แยกตามสถานพยาบาลต้นทาง
 *
 * จำกัดผู้ป่วยที่ทะเบียนบ้านอยู่ในจังหวัดนี้แต่ **นอกอำเภอที่โรงพยาบาลตั้งอยู่**
 * ตามนิยามที่ได้รับมา — คนในอำเภอเดียวกันมาเองเป็นปกติ การนับรวมจะทำให้ตัวเลข
 * ของโรงพยาบาลชุมชนปนกับคนที่เดินเข้ามาเอง
 */
export type SepsisReferrals = {
  hospitals: SepsisReferral[]
  ci: SepsisCount
  shock: SepsisCount
}

/**
 * หอผู้ป่วยหนักที่นับเป็น ICU ของตัวชี้วัด early ICU access
 *
 * ห้ารหัสนี้มาจากคิวรีที่ได้รับมา ตรงกับทะเบียน ward ของโรงพยาบาล — ไม่ได้รวม
 * NICU (35) เพราะ sepsis ของทารกแรกเกิดลงรหัส P36 ไม่ใช่ A40-A41 จึงไม่เข้า
 * ขอบเขตของรายงานนี้ตั้งแต่ต้น
 *
 * เรียงตามลำดับที่อ่านง่าย (MICU 1 ก่อน MICU 2) ไม่ใช่ตามรหัส
 */
export const SEPSIS_ICU_WARDS = [
  { ward: '16', name: 'MICU 1' },
  { ward: '01', name: 'MICU 2' },
  { ward: '33', name: 'SICU' },
  { ward: '36', name: 'ICU 4' },
  { ward: '30', name: 'Sub ICU Med' },
] as const

/**
 * ระยะเวลาจากแรกรับถึงการเข้า ICU ครั้งแรก แบ่งเป็นถัง
 *
 * atAdmission = หอผู้ป่วยแรกรับเป็น ICU อยู่แล้ว (ipt.first_ward) · h3-h24 คือ
 * ย้ายเข้า ICU ภายใน 3, 6, 12 และ 24 ชั่วโมงนับจากเวลารับเข้านอน · later คือ
 * เกิน 24 ชั่วโมง · never คือไม่เคยอยู่ ICU เลยในการนอนครั้งนั้น
 *
 * unknownTime คือการนอนที่จำหน่ายจากหอ ICU แต่ไม่มีแถวย้ายเตียงใน iptbedmove
 * และหอแรกรับไม่ใช่ ICU — รู้ว่าเข้า ICU แต่ไม่รู้ว่าเมื่อไร จึงนับเป็น "เข้า ICU"
 * ได้ แต่นับเป็น "ทันเวลา" ไม่ได้ที่เกณฑ์ใด ๆ ต้องแยกถังไว้ให้เห็นว่ามีเท่าไร
 * (วัดแล้ว 49 รายในห้าปีงบ)
 *
 * ทุก AN ในขอบเขตตกถังใดถังหนึ่งถังเดียว ผลรวมของถังจึงเท่ากับ admissions พอดี
 */
export const SEPSIS_ICU_BINS = [
  'atAdmission',
  'h3',
  'h6',
  'h12',
  'h24',
  'later',
  'unknownTime',
  'never',
] as const

export type SepsisIcuBin = (typeof SEPSIS_ICU_BINS)[number]

/** เกณฑ์เวลา (ชั่วโมง) ที่หน้าจอให้เลือกดู */
export const SEPSIS_ICU_THRESHOLDS = [3, 6, 12, 24] as const

export type SepsisIcuThreshold = (typeof SEPSIS_ICU_THRESHOLDS)[number]

/** ถังที่นับเป็น "เข้า ICU ทันเวลา" ของแต่ละเกณฑ์ */
export const SEPSIS_ICU_WITHIN: Record<SepsisIcuThreshold, readonly SepsisIcuBin[]> = {
  3: ['atAdmission', 'h3'],
  6: ['atAdmission', 'h3', 'h6'],
  12: ['atAdmission', 'h3', 'h6', 'h12'],
  24: ['atAdmission', 'h3', 'h6', 'h12', 'h24'],
}

/**
 * ตัวหารของอัตรา early ICU access
 *
 * all = ผู้ป่วย sepsis ทั้งหมดตามที่ขอมา · ci = เฉพาะที่ติดเชื้อมาจากชุมชน
 * ต้องมีสองตัวเลือก เพราะผู้ป่วย HI ติดเชื้อหลังนอนไปแล้วหลายวัน การวัดเวลา
 * จากแรกรับถึง ICU ของกลุ่มนั้นไม่ได้แปลว่าเข้าถึง ICU ช้า — ตัวเลข "ทั้งหมด"
 * จึงต่ำกว่าความจริงอยู่เสมอ และต้องดูคู่กับ "เฉพาะ CI"
 */
export const SEPSIS_ICU_SCOPES = ['all', 'ci'] as const

export type SepsisIcuScope = (typeof SEPSIS_ICU_SCOPES)[number]

export type SepsisIcuCounts = {
  /** การนอนทั้งหมดในขอบเขตนั้น — ตัวหารของอัตรา */
  admissions: number
  bins: Record<SepsisIcuBin, number>
}

/** หอ ICU หนึ่งหอ กับการนอนที่เข้าหอนั้นเป็น ICU แห่งแรกของการนอนครั้งนั้น */
export type SepsisIcuWard = {
  ward: string
  name: string
  patients: number
  bins: Record<SepsisIcuBin, number>
}
