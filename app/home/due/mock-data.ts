/**
 * ข้อมูลจำลองของคำขอใช้ยา DUE — ใช้ร่วมกันทั้งหน้างานเภสัชกรรมและหน้าแพทย์ผู้กำกับ
 *
 * วางไว้ระดับ due/ ไม่ใช่ในโฟลเดอร์ของหน้าใดหน้าหนึ่ง เพราะสองหน้านี้ทำงานกับ
 * คำขอใบเดียวกัน ถ้าแยกกันคนละชุดจะออกแบบเพี้ยน (เช่นสถานะที่หน้าหนึ่งมี
 * อีกหน้าไม่มี) แล้วพอต่อฐานจริงจะพบว่าหน้าจอรองรับข้อมูลคนละรูปร่าง
 *
 * ทั้งไฟล์นี้เป็นข้อมูลสมมติ ไม่ได้มาจากฐานข้อมูลโรงพยาบาล
 * — ชื่อผู้ป่วย HN AN และหอผู้ป่วยแต่งขึ้นทั้งหมด ห้ามเอาไปใช้อ้างอิงจริง
 * มีไว้เพื่อให้เห็นว่าหน้าจอต้องรองรับข้อมูลรูปร่างแบบไหนเท่านั้น
 *
 * ชื่อยาลอกรูปแบบมาจากของจริงใน drugitems (ป้ายกำกับ ชื่อสามัญ ชื่อการค้า บริษัท)
 * เพราะความยาวของชื่อมีผลต่อการจัดหน้าจอโดยตรง
 *
 * โครงของแต่ละคำขอตรงกับช่องที่กรอกในหน้า due/request ทุกช่อง
 * ถ้าหน้านั้นเพิ่มช่อง ต้องเพิ่มที่นี่ด้วย ไม่งั้นหน้างานเภสัชกรรมจะแสดงไม่ครบ
 */

/** ยาที่ต้องให้แพทย์ผู้กำกับอนุมัติก่อน เภสัชกรจึงจะรับรายการได้ */
export const SUPERVISOR_ONLY_DRUGS = ['colistin']

/**
 * ยาตัวนี้ต้องผ่านแพทย์ผู้กำกับหรือไม่
 *
 * เทียบจากชื่อยาแบบไม่สนตัวพิมพ์ใหญ่เล็ก เพราะในฐานเขียนได้หลายแบบ
 * (Colistin-150 Injection, Colistin-150mg. Injection)
 *
 * ของจริงไม่ควรตัดสินจากชื่อยา ควรมีคอลัมน์กำกับไว้ที่ทะเบียนยาหรือมีตาราง
 * รายการยาที่ต้องอนุมัติแยกต่างหาก — ที่ทำแบบนี้เพราะยังไม่มีที่เก็บข้อมูล
 */
export function needsSupervisor(drugName: string): boolean {
  const name = drugName.toLowerCase()
  return SUPERVISOR_ONLY_DRUGS.some(keyword => name.includes(keyword))
}

export type DueStatus =
  /** รอเภสัชกรรับรายการ — ยาทั่วไป รับได้เลย */
  | 'pending'
  /** รอแพทย์ผู้กำกับอนุมัติ — เภสัชกรยังรับไม่ได้ */
  | 'awaiting_approval'
  /** แพทย์ผู้กำกับอนุมัติแล้ว รอเภสัชกรรับรายการ */
  | 'approved'
  /** แพทย์ผู้กำกับไม่อนุมัติ */
  | 'denied'
  /** เภสัชกรรับรายการแล้ว */
  | 'accepted'
  /** เภสัชกรไม่รับรายการ */
  | 'rejected'

export type MockSpecimen = {
  specimen: string
  cs: string
  gs: string
  susceptibility: string
}

export type MockDrug = {
  /** เลขรันนิ่งในใบคำขอ — ใช้เป็น key และเป็นเลขลำดับที่โชว์หน้าแถว */
  id: number
  name: string
  dose: string
  /** 'YYYY-MM-DD' */
  startedAt: string
  indication: string
  indicationOther: string
  /** ผลประเมินของยาตัวนี้ — null แปลว่ายังไม่ได้ประเมิน */
  evaluation: DrugEvaluation | null
}

/* ───────────── ตัวเลือกในแบบประเมิน ─────────────
   ทั้งหมดถอดมาจากแบบฟอร์มกระดาษที่ใช้อยู่จริง
   ค่าที่เก็บเป็นข้อความเต็มตามฟอร์ม ไม่ได้ทำเป็นรหัส เพราะยังไม่มีตารางอ้างอิง
   ตอนต่อฐานข้อมูลจริงควรเปลี่ยนเป็นรหัสแล้วเก็บข้อความไว้ที่ตารางอ้างอิงแทน */

export const INDICATION_TYPES = [
  { value: 'empiric', label: 'Empiric treatment' },
  { value: 'specific', label: 'Specific treatment' },
]

/** ใช้ร่วมกันทั้งความเหมาะสมของข้อบ่งใช้และของขนาดยา — ตัวเลือกชุดเดียวกัน */
export const APPROPRIATE_OPTIONS = [
  { value: 'appropriate', label: 'เหมาะสม' },
  { value: 'consulted', label: 'ไม่เหมาะสม Consult แล้ว ยืนยันจ่ายยา' },
  { value: 'cannot', label: 'ประเมินไม่ได้' },
]

export const DURATION_OPTIONS = [
  { value: 'appropriate', label: 'เหมาะสม' },
  { value: 'no_culture_change', label: 'ไม่เหมาะสม เพราะไม่เปลี่ยนยาตามผลเพาะเชื้อ' },
  { value: 'too_long', label: 'ไม่เหมาะสม เพราะใช้ยานานกว่าระยะเวลาการใช้ยาที่แนะนำ' },
  { value: 'too_short', label: 'ไม่เหมาะสม เพราะใช้ยาสั้นกว่าระยะเวลาการใช้ยาที่แนะนำ' },
  { value: 'no_specimen', label: 'ไม่ส่งตัวอย่างเพาะเชื้อ' },
]

/** Drug Related Problems — ติ๊กได้หลายข้อ */
export const DRP_OPTIONS = [
  'การเลือกใช้ยาที่ไม่เหมาะสม (Improper drug selection)',
  'ผู้ป่วยไม่ได้รับยาที่ควรจะได้รับ (Untreated indications)',
  'ขนาดยาที่ผู้ป่วยได้รับสูงเกินไป (Dosage too high)',
  'ขนาดยาที่ผู้ป่วยได้รับน้อยเกินไป (Dosage too low)',
  'เกิดอาการไม่พึงประสงค์จากการใช้ยา (Adverse drug reaction)',
  'ไม่เปลี่ยนยาตามผล Culture',
  'ผู้ป่วยได้รับยาไม่ครบตามแนวทางการรักษา (Need for additional drug therapy)',
]

/** การแทรกแซงของเภสัชกร — ติ๊กได้หลายข้อ */
export const INTERVENTION_OPTIONS = [
  'เปลี่ยนยาตามผล Culture',
  'เปลี่ยนยาเนื่องจากเปลี่ยนผลการวินิจฉัย',
  'เปลี่ยนขนาดยา',
  'เปลี่ยนความถี่',
  'เปลี่ยนยา ตามอาการทางคลินิก',
  'หยุดยาเนื่องจาก ADR',
  'เพิ่มยาตามแนวทางรักษา',
]

export const EVAL_STATUS_OPTIONS = [
  { value: 'evaluated', label: 'ประเมินแล้ว' },
  { value: 'pending', label: 'อยู่ระหว่างรอประเมิน' },
  { value: 'not_eligible', label: 'ไม่เข้าเกณฑ์ประเมิน' },
]

/** แถวของ "เชื้อที่เป็นสาเหตุ" ในช่องหมายเหตุ */
export const PATHOGEN_SOURCES = [
  'Grams stain',
  'Hemoculture',
  'Urine culture',
  'Sputum culture',
  'อื่นๆ',
]

/**
 * รายชื่อเภสัชกรผู้ประเมิน — ข้อมูลสมมติ
 * ของจริงควรดึงจากผู้ใช้ที่มีบทบาทเภสัชกรในฐาน core_kon ไม่ใช่รายชื่อตายตัว
 */
export const MOCK_PHARMACISTS = [
  'ภก.ศิริพร วงศ์คำ',
  'ภก.ณัฐพล ทองอินทร์',
  'ภญ.กมลชนก แสนสุข',
  'ภญ.พิมพ์ชนก ดวงแก้ว',
]

/**
 * รายชื่อแพทย์ผู้กำกับการใช้ยา — ข้อมูลสมมติ
 *
 * ของจริงคือคณะกรรมการควบคุมการใช้ยาต้านจุลชีพของโรงพยาบาล ต้องดึงจากผู้ใช้
 * ที่มีบทบาทนี้ในฐาน core_kon ไม่ใช่รายชื่อตายตัว และตอนนี้ให้เลือกเองว่าใคร
 * เป็นผู้อนุมัติ เพราะยังไม่มีระบบสิทธิ์ตามบทบาทผู้ใช้
 */
export const MOCK_SUPERVISORS = [
  'นพ.ประสิทธิ์ วรรณกิจ (แพทย์ผู้กำกับการใช้ยา)',
  'พญ.อรวรรณ ศรีสมบูรณ์ (แพทย์ผู้กำกับการใช้ยา)',
  'นพ.ธนกฤต เจริญพงศ์ (อายุรแพทย์โรคติดเชื้อ)',
]

/** ผลเพาะเชื้อหนึ่งแถวในช่องหมายเหตุ */
export type PathogenNote = {
  source: string
  checked: boolean
  /** 'YYYY-MM-DD' */
  date: string | null
  detail: string
}

/**
 * ผลประเมินการใช้ยา — หนึ่งชุดต่อยาหนึ่งตัว ไม่ใช่ต่อหนึ่งใบคำขอ
 *
 * ใบเดียวขอยาสองตัวก็ต้องประเมินแยกกันสองชุด เพราะความเหมาะสมของข้อบ่งใช้
 * ขนาดยา และระยะเวลา เป็นเรื่องของยาแต่ละตัว ไม่ใช่ของทั้งใบ
 * (แบบฟอร์มกระดาษก็มีเลขลำดับหน้าแถวยาด้วยเหตุผลเดียวกัน)
 */
export type DrugEvaluation = {
  indicationType: string | null
  indicationAppropriate: string | null
  doseAppropriate: string | null
  /** ระยะเวลาการใช้ (วัน) */
  durationDays: number | null
  durationAppropriate: string | null
  drps: string[]
  drpOther: string
  interventions: string[]
  interventionOther: string
  evalStatus: string | null
  adr: string
  pathogens: PathogenNote[]
  note: string
  evaluatorName: string | null
  /** เวลาที่บันทึก 'YYYY-MM-DD HH:mm' */
  evaluatedAt: string
}

/**
 * ค่าไตหนึ่งจุดบนกราฟแนวโน้ม
 *
 * เก็บ cr เป็นค่าดิบจากห้องแล็บ ส่วน crcl กับ egfr คำนวณไว้แล้ว
 * ของจริง egfr ดึงจากห้องแล็บได้ตรง ๆ (lab_items_code 1571) ส่วน crcl
 * ต้องคำนวณเองด้วย Cockcroft-Gault เพราะห้องแล็บไม่ได้ออกให้
 */
export type RenalPoint = {
  /** 'YYYY-MM-DD' */
  date: string
  /** Creatinine (mg/dL) */
  cr: number
  /** CrCl (mL/min) */
  crcl: number
  /** eGFR (mL/min/1.73m²) */
  egfr: number
}

/** ใบรายงานผลเพาะเชื้อหนึ่งใบ */
export type CultureReport = {
  no: number
  /** 'YYYY-MM-DD HH:mm:ss' */
  requestedAt: string
  reportedAt: string
}

/**
 * ยาต้านจุลชีพที่เคยสั่งหนึ่งครั้ง — รายครั้ง ไม่ได้รวมเป็นรายตัวยา
 *
 * ต่างจาก priorAntibiotic ในใบคำขอที่สรุปเหลือตัวเดียว ตารางนี้ให้เห็นทุกครั้ง
 * ที่สั่ง พร้อมวิธีใช้และจำนวน เพราะเภสัชกรต้องดูว่าเคยได้ยาตัวไหน ขนาดเท่าไร
 * และเคยได้ซ้ำกี่รอบ ซึ่งเป็นคนละคำถามกับ "ยาที่ได้รับมาก่อนหน้านี้คือตัวอะไร"
 *
 * qty = 0 คือสั่งแล้วไม่ได้จ่าย เก็บไว้ให้เห็นด้วยเพราะบอกว่าเคยมีคำสั่งแล้วยกเลิก
 */
export type AntibioticRx = {
  no: number
  /** 'YYYY-MM-DD HH:mm:ss' */
  rxAt: string
  drugName: string
  usage: string
  qty: number
}

export type MockRequest = {
  id: string
  /** เวลาที่แพทย์ส่งคำขอ 'YYYY-MM-DD HH:mm' */
  requestedAt: string
  requesterName: string
  status: DueStatus
  /** บันทึกของแพทย์ผู้กำกับ (มีเมื่อสถานะเป็น approved / denied) */
  supervisorNote: string | null
  supervisorName: string | null
  /** เวลาที่แพทย์ผู้กำกับตัดสิน 'YYYY-MM-DD HH:mm' — แยกจากเวลาที่แพทย์ส่งคำขอ */
  supervisorDecidedAt: string | null

  hn: string
  patientName: string
  age: number
  /** '1' = ชาย, '2' = หญิง ตามรหัสของ HIS */
  sex: string
  visitType: 'IPD' | 'OPD'
  an: string | null
  wardName: string | null

  /** ค่าไต — ตรงกับแถวสีเหลืองในหน้า request */
  creatinineAt: string | null
  cr: string
  weight: string
  crcl: string
  egfr: string
  awaitingCreatinine: boolean

  /** ข้อมูลประวัติ */
  sepsis: 'none' | 'yes'
  infectionSource: 'community' | 'hospital'
  diagnosis: string
  diagnosisOther: string
  infectionSite: string
  specimens: MockSpecimen[]

  /** ยาต้านที่ได้รับมาก่อน */
  noPriorAntibiotic: boolean
  priorAntibiotic: string
  priorStartedAt: string | null
  priorDays: number | null

  /** ยาที่ขออนุมัติ */
  drugs: MockDrug[]

  /** ข้อมูลประกอบที่ดึงจาก HIS มาแสดงคู่กัน */
  allergies: string[]
  conditions: string[]

  /** แนวโน้มค่าไต ใช้ประกอบการประเมินความเหมาะสมของขนาดยา */
  renalTrend: RenalPoint[]
  /** ใบรายงานผลเพาะเชื้อของผู้ป่วยรายนี้ */
  cultureHistory: CultureReport[]
  /** ประวัติการสั่งยาต้านจุลชีพรายครั้ง */
  antibioticHistory: AntibioticRx[]
}

/**
 * ชุดค่าไตจำลอง — ไตแย่ลงแล้วค่อยดีขึ้น
 *
 * ตั้งใจให้ Cr กับ eGFR/CrCl สวนทางกันตามจริง (Cr ขึ้น = eGFR ลง)
 * เพราะกราฟที่สองเส้นนี้ไปทางเดียวกันจะดูออกทันทีว่าข้อมูลผิด
 */
const RENAL_TREND_DECLINE_RECOVER: RenalPoint[] = [
  { date: '2026-06-06', cr: 1.08, crcl: 47, egfr: 72 },
  { date: '2026-06-07', cr: 1.19, crcl: 42, egfr: 63 },
  { date: '2026-06-09', cr: 1.02, crcl: 51, egfr: 82 },
  { date: '2026-06-12', cr: 1.16, crcl: 45, egfr: 69 },
  { date: '2026-06-15', cr: 1.18, crcl: 44, egfr: 67 },
  { date: '2026-06-16', cr: 1.14, crcl: 45, egfr: 68 },
  { date: '2026-06-18', cr: 1.12, crcl: 46, egfr: 71 },
  { date: '2026-06-19', cr: 1.15, crcl: 43, egfr: 64 },
  { date: '2026-06-20', cr: 1.03, crcl: 44, egfr: 76 },
  { date: '2026-06-22', cr: 1.55, crcl: 38, egfr: 49 },
  { date: '2026-06-23', cr: 1.56, crcl: 34, egfr: 48 },
  { date: '2026-06-28', cr: 2.18, crcl: 23, egfr: 30 },
  { date: '2026-06-29', cr: 2.12, crcl: 24, egfr: 31 },
  { date: '2026-06-30', cr: 2.02, crcl: 24, egfr: 35 },
  { date: '2026-07-01', cr: 2.06, crcl: 25, egfr: 33 },
  { date: '2026-07-02', cr: 1.94, crcl: 28, egfr: 38 },
  { date: '2026-07-03', cr: 1.72, crcl: 33, egfr: 44 },
  { date: '2026-07-04', cr: 1.5, crcl: 39, egfr: 52 },
  { date: '2026-07-05', cr: 1.28, crcl: 47, egfr: 63 },
  { date: '2026-07-09', cr: 0.96, crcl: 56, egfr: 91 },
  { date: '2026-07-10', cr: 0.94, crcl: 58, egfr: 92 },
  { date: '2026-07-14', cr: 0.9, crcl: 60, egfr: 94 },
  { date: '2026-07-16', cr: 0.88, crcl: 62, egfr: 93 },
  { date: '2026-08-11', cr: 0.56, crcl: 85, egfr: 110 },
  { date: '2026-08-14', cr: 0.52, crcl: 96, egfr: 112 },
]

/** ชุดค่าไตจำลองอีกชุด — ไตเสื่อมต่อเนื่อง ใช้กับผู้ป่วย ICU */
const RENAL_TREND_WORSENING: RenalPoint[] = [
  { date: '2026-08-18', cr: 1.12, crcl: 41, egfr: 47 },
  { date: '2026-08-21', cr: 1.48, crcl: 31, egfr: 34 },
  { date: '2026-08-24', cr: 1.86, crcl: 25, egfr: 26 },
  { date: '2026-08-27', cr: 2.24, crcl: 20, egfr: 21 },
  { date: '2026-08-29', cr: 2.58, crcl: 18, egfr: 18 },
  { date: '2026-09-01', cr: 2.86, crcl: 16, egfr: 16 },
]

/**
 * ประวัติการสั่งยาต้านจำลอง — ชื่อยาและวิธีใช้ลอกรูปแบบจากของจริงใน HIS
 * (มีวงเล็บความแรงนำหน้า ชื่อไทยต่อท้าย และวิธีใช้แบบย่อของโรงพยาบาล)
 */
const ANTIBIOTIC_HISTORY: AntibioticRx[] = [
  {
    no: 1,
    rxAt: '2022-02-10 17:11:22',
    drugName: '[500mg] AMOXICILLIN CAP:อะม็อกซี่ซิลลิน',
    usage: '22pt ( ครั้งละ 2 เม็ด x2pc. เช้า-เย็น )',
    qty: 4,
  },
  {
    no: 2,
    rxAt: '2023-01-18 21:55:34',
    drugName: 'Augmentin Tablet 1Gm.[Rabies,M=6]',
    usage: '1x2pc เช้า - เย็น',
    qty: 6,
  },
  {
    no: 3,
    rxAt: '2024-01-11 14:45:24',
    drugName: '[1Gm] cef-TRI-AXONE Inj.# CEF-3',
    usage: 'IV drip OD 2g. in 30-60 min',
    qty: 0,
  },
  {
    no: 4,
    rxAt: '2024-01-11 14:45:24',
    drugName: '[CAP] AZITHROmycin 250 mg:อะซิโทร',
    usage: '2 เม็ด ก่อนอาหารเช้า',
    qty: 0,
  },
  {
    no: 5,
    rxAt: '2024-01-11 14:01:25',
    drugName: '[1Gm] cef-TRI-AXONE Inj.# CEF-3',
    usage: 'IV drip OD 2g. in 30-60 min',
    qty: 4,
  },
  {
    no: 6,
    rxAt: '2024-01-11 14:01:25',
    drugName: '[CAP] AZITHROmycin 250 mg:อะซิโทร',
    usage: '2 เม็ด ก่อนอาหารเช้า',
    qty: 2,
  },
  {
    no: 7,
    rxAt: '2024-01-12 07:56:16',
    drugName: '[CAP] AZITHROmycin 250 mg:อะซิโทร',
    usage: '2 เม็ด ก่อนอาหารเช้า',
    qty: 2,
  },
  {
    no: 8,
    rxAt: '2024-01-12 07:56:16',
    drugName: '[1Gm] cef-TRI-AXONE Inj.# CEF-3',
    usage: 'IV drip OD 2g. in 30-60 min',
    qty: 2,
  },
  {
    no: 9,
    rxAt: '2024-01-13 10:51:33',
    drugName: '[1Gm] cef-TRI-AXONE Inj.# CEF-3',
    usage: 'IV drip OD 2g. in 30-60 min',
    qty: 0,
  },
  {
    no: 10,
    rxAt: '2024-01-13 01:35:06',
    drugName: '[1Gm] cef-TRI-AXONE Inj.# CEF-3',
    usage: 'IV drip OD 2g. in 30-60 min',
    qty: 2,
  },
  {
    no: 11,
    rxAt: '2024-01-14 00:57:01',
    drugName: '[1Gm] cef-TRI-AXONE Inj.# CEF-3',
    usage: 'IV drip OD 2g. in 30-60 min',
    qty: 2,
  },
  {
    no: 12,
    rxAt: '2025-07-05 23:27:12',
    drugName: '[1Gm] cef-TRI-AXONE Inj.# CEF-3',
    usage: 'IV drip OD 2g. in 30-60 min',
    qty: 4,
  },
  {
    no: 13,
    rxAt: '2025-07-05 23:27:12',
    drugName: '[CAP] Zithromax 250 mg. :อะซิโทรมัยซิน',
    usage: '2 เม็ด ก่อนอาหารเช้า',
    qty: 2,
  },
  {
    no: 14,
    rxAt: '2025-07-06 06:56:45',
    drugName: '[CAP] Zithromax 250 mg. :อะซิโทรมัยซิน',
    usage: '2 เม็ด ก่อนอาหารเช้า',
    qty: 2,
  },
]

const CULTURE_HISTORY: CultureReport[] = [
  { no: 1, requestedAt: '2026-08-26 12:00:01', reportedAt: '2026-08-31 12:00:01' },
  { no: 2, requestedAt: '2026-08-26 12:00:01', reportedAt: '2026-08-31 12:00:01' },
  { no: 3, requestedAt: '2026-08-26 10:04:02', reportedAt: '2026-08-28 10:04:02' },
  { no: 4, requestedAt: '2026-08-21 10:03:41', reportedAt: '2026-08-24 10:03:41' },
  { no: 5, requestedAt: '2026-08-11 12:00:01', reportedAt: '2026-08-16 12:00:01' },
  { no: 6, requestedAt: '2026-08-11 12:00:01', reportedAt: '2026-08-16 12:00:01' },
  { no: 7, requestedAt: '2026-08-11 11:07:17', reportedAt: '2026-08-14 11:07:17' },
  { no: 8, requestedAt: '2026-08-11 15:22:11', reportedAt: '2026-08-11 15:22:11' },
]

/** ประเมินครบทุกตัวยาแล้วหรือยัง — ใช้ตัดสินป้ายบนตาราง */
export function isFullyEvaluated(request: MockRequest): boolean {
  return request.drugs.length > 0 && request.drugs.every(drug => drug.evaluation != null)
}

/** ประเมินไปแล้วกี่ตัวจากทั้งหมด */
export function evaluatedCount(request: MockRequest): number {
  return request.drugs.filter(drug => drug.evaluation != null).length
}

export const MOCK_REQUESTS: MockRequest[] = [
  {
    id: 'DUE-6900412',
    requestedAt: '2026-09-01 09:12',
    requesterName: 'นพ.ธนกฤต ศรีวิชัย',
    status: 'pending',
    supervisorNote: null,
    supervisorName: null,
    supervisorDecidedAt: null,
    hn: '999000101',
    patientName: 'นายสมชาย ใจดี',
    age: 68,
    sex: '1',
    visitType: 'IPD',
    an: '690017234',
    wardName: 'อายุรกรรมชาย 1',
    creatinineAt: '2026-08-31',
    cr: '1.42',
    weight: '58',
    crcl: '38.5',
    egfr: '49.6',
    awaitingCreatinine: false,
    sepsis: 'yes',
    infectionSource: 'hospital',
    diagnosis: 'Hospital-acquired pneumonia',
    diagnosisOther: '',
    infectionSite: 'ปอดขวากลีบล่าง',
    specimens: [
      {
        specimen: 'Sputum',
        cs: 'Klebsiella pneumoniae',
        gs: 'GNB 3+',
        susceptibility: 'ESBL producer, S ต่อ carbapenem',
      },
      { specimen: 'Hemoculture', cs: 'No growth', gs: '—', susceptibility: '—' },
    ],
    noPriorAntibiotic: false,
    priorAntibiotic: 'Ceftriaxone Injection 1GM. [ช](CEF-3,บ.GED) 1 g. Vial (1gm.)',
    priorStartedAt: '2026-08-26',
    priorDays: 5,
    drugs: [
      {
        id: 1,
        name: '[DUE][IPD,Emed,Med] (ง)Meropenem Injection (MONEM,บ.ไบโอฟาร์ม) 1 g. Vial',
        dose: '1 g IV drip q 8 hr',
        startedAt: '2026-09-01',
        indication: 'ผลเพาะเชื้อพบเชื้อดื้อยา',
        indicationOther: 'ESBL producer จาก sputum ไม่ตอบสนองต่อ ceftriaxone',
        evaluation: null,
      },
    ],
    allergies: [],
    conditions: ['เบาหวาน/ไตเรื้อรัง', 'COPD'],
    renalTrend: RENAL_TREND_DECLINE_RECOVER,
    cultureHistory: CULTURE_HISTORY,
    antibioticHistory: ANTIBIOTIC_HISTORY,
  },
  {
    id: 'DUE-6900413',
    requestedAt: '2026-09-01 10:40',
    requesterName: 'พญ.ณัฐริกา พงศ์ไพบูลย์',
    status: 'awaiting_approval',
    supervisorNote: null,
    supervisorName: null,
    supervisorDecidedAt: null,
    hn: '999000102',
    patientName: 'นางบุญมี ทองสุข',
    age: 74,
    sex: '2',
    visitType: 'IPD',
    an: '690017988',
    wardName: 'ICU อายุรกรรม',
    creatinineAt: '2026-09-01',
    cr: '2.86',
    weight: '46',
    crcl: '13.6',
    egfr: '16.4',
    awaitingCreatinine: false,
    sepsis: 'yes',
    infectionSource: 'hospital',
    diagnosis: 'VAP with septic shock',
    diagnosisOther: 'on ventilator วันที่ 9',
    infectionSite: 'ปอดสองข้าง',
    specimens: [
      {
        specimen: 'Sputum',
        cs: 'Acinetobacter baumannii',
        gs: 'GNCB 4+',
        susceptibility: 'R ต่อ carbapenem, S ต่อ colistin เท่านั้น',
      },
      {
        specimen: 'Hemoculture',
        cs: 'Acinetobacter baumannii',
        gs: '—',
        susceptibility: 'XDR',
      },
    ],
    noPriorAntibiotic: false,
    priorAntibiotic: '[DUE][IPD,Emed] (ง)TAZOCIN Injection (Piperacillin+Tazobactam, บ.ภิญโญ)',
    priorStartedAt: '2026-08-25',
    priorDays: 7,
    drugs: [
      {
        id: 1,
        name: '[DUE][IPD,Emed] (ง)Colistin-150 Injection ( KOLIMYCIN, บ.เอเบิลเมดิคอล ) 150 mg. Vial',
        dose: 'LD 300 mg IV then 150 mg IV q 12 hr',
        startedAt: '2026-09-01',
        indication: 'ผลเพาะเชื้อพบเชื้อดื้อยา',
        indicationOther: 'XDR Acinetobacter ไวต่อ colistin ตัวเดียว',
        evaluation: null,
      },
    ],
    allergies: ['PENICILLIN'],
    conditions: ['ไตเรื้อรัง'],
    // เคส ICU ไตเสื่อมต่อเนื่อง — ตรงกับที่ต้องใช้ colistin และต้องปรับขนาดตาม CrCl
    renalTrend: RENAL_TREND_WORSENING,
    cultureHistory: CULTURE_HISTORY,
    antibioticHistory: ANTIBIOTIC_HISTORY,
  },
  {
    id: 'DUE-6900409',
    requestedAt: '2026-08-31 14:05',
    requesterName: 'นพ.กิตติพงษ์ อินทร์แก้ว',
    status: 'approved',
    supervisorName: 'นพ.ประสิทธิ์ วรรณกิจ (แพทย์ผู้กำกับการใช้ยา)',
    supervisorNote: 'อนุมัติ 7 วัน ให้ปรับขนาดตาม CrCl และติดตามค่าไตทุก 2 วัน',
    supervisorDecidedAt: '2026-08-31 15:20',
    hn: '999000103',
    patientName: 'นายวิรัตน์ แซ่ลิ้ม',
    age: 61,
    sex: '1',
    visitType: 'IPD',
    an: '690017640',
    wardName: 'ศัลยกรรมชาย',
    creatinineAt: '2026-08-30',
    cr: '1.05',
    weight: '70',
    crcl: '64.1',
    egfr: '75.3',
    awaitingCreatinine: false,
    sepsis: 'none',
    infectionSource: 'hospital',
    diagnosis: 'Surgical site infection',
    diagnosisOther: '',
    infectionSite: 'แผลผ่าตัดหน้าท้อง',
    specimens: [
      {
        specimen: 'Pus / Wound swab',
        cs: 'Pseudomonas aeruginosa',
        gs: 'GNB 2+',
        susceptibility: 'R ต่อ carbapenem และ cephalosporin',
      },
    ],
    noPriorAntibiotic: false,
    priorAntibiotic: 'Ceftazidime Injection 1 g. Vial',
    priorStartedAt: '2026-08-24',
    priorDays: 6,
    drugs: [
      {
        id: 1,
        name: '[DUE][สำหรับพ่น] (ง)Colistin-150mg. Injection 150 mg. Vial',
        dose: '150 mg IV q 12 hr',
        startedAt: '2026-08-31',
        indication: 'ผลเพาะเชื้อพบเชื้อดื้อยา',
        indicationOther: '',
        evaluation: null,
      },
    ],
    allergies: [],
    conditions: [],
    renalTrend: RENAL_TREND_DECLINE_RECOVER,
    cultureHistory: CULTURE_HISTORY,
    antibioticHistory: ANTIBIOTIC_HISTORY,
  },
  {
    id: 'DUE-6900411',
    requestedAt: '2026-09-01 08:20',
    requesterName: 'พญ.สุธาสินี เรืองเดช',
    status: 'pending',
    supervisorNote: null,
    supervisorName: null,
    supervisorDecidedAt: null,
    hn: '999000104',
    patientName: 'นางสาวปิยะดา คำมูล',
    age: 34,
    sex: '2',
    visitType: 'OPD',
    an: null,
    wardName: null,
    creatinineAt: null,
    cr: '',
    weight: '55',
    crcl: '',
    egfr: '',
    awaitingCreatinine: true,
    sepsis: 'none',
    infectionSource: 'community',
    diagnosis: 'Complicated UTI',
    diagnosisOther: '',
    infectionSite: 'ทางเดินปัสสาวะส่วนบน',
    specimens: [
      {
        specimen: 'Urine',
        cs: 'Escherichia coli',
        gs: '—',
        susceptibility: 'ESBL producer',
      },
    ],
    noPriorAntibiotic: true,
    priorAntibiotic: '',
    priorStartedAt: null,
    priorDays: null,
    drugs: [
      {
        id: 1,
        name: '[DUE][IPD,Emed] (ง)Ertapenem Injection (INVANZ,บ.MSD) 1 g. Vial',
        dose: '1 g IV OD',
        startedAt: '2026-09-01',
        indication: 'ผลเพาะเชื้อพบเชื้อดื้อยา',
        indicationOther: 'OPD parenteral therapy',
        evaluation: null,
      },
    ],
    allergies: ['SULFA'],
    conditions: [],
    renalTrend: RENAL_TREND_DECLINE_RECOVER,
    cultureHistory: CULTURE_HISTORY,
    antibioticHistory: ANTIBIOTIC_HISTORY,
  },
  {
    id: 'DUE-6900405',
    requestedAt: '2026-08-30 16:48',
    requesterName: 'นพ.ธนกฤต ศรีวิชัย',
    status: 'accepted',
    supervisorNote: null,
    supervisorName: null,
    supervisorDecidedAt: null,
    hn: '999000105',
    patientName: 'นายอำนวย พรมมา',
    age: 55,
    sex: '1',
    visitType: 'IPD',
    an: '690017501',
    wardName: 'อายุรกรรมชาย 2',
    creatinineAt: '2026-08-29',
    cr: '0.94',
    weight: '64',
    crcl: '78.4',
    egfr: '88.1',
    awaitingCreatinine: false,
    sepsis: 'none',
    infectionSource: 'community',
    diagnosis: 'MRSA bacteremia',
    diagnosisOther: '',
    infectionSite: 'กระแสเลือด',
    specimens: [
      { specimen: 'Hemoculture', cs: 'MRSA', gs: 'GPC in cluster', susceptibility: 'S ต่อ vancomycin' },
    ],
    noPriorAntibiotic: false,
    priorAntibiotic: 'Cloxacillin Injection 1 g. Vial',
    priorStartedAt: '2026-08-27',
    priorDays: 3,
    drugs: [
      {
        id: 1,
        name: '[DUE][IPD,Med,Emed](ง)Vancomycin Injection (VANGACIN, บ.เอเบิล เมดิคอล) 500 mg. Vial',
        dose: '1 g IV q 12 hr',
        startedAt: '2026-08-30',
        indication: 'ผลเพาะเชื้อพบเชื้อดื้อยา',
        indicationOther: '',
        // ตัวนี้ประเมินไปแล้ว ไว้ให้เห็นหน้าตาตอนมีผลประเมินครบ
        evaluation: {
          indicationType: 'specific',
          indicationAppropriate: 'appropriate',
          doseAppropriate: 'consulted',
          durationDays: 10,
          durationAppropriate: 'appropriate',
          drps: ['ขนาดยาที่ผู้ป่วยได้รับน้อยเกินไป (Dosage too low)'],
          drpOther: '',
          interventions: ['เปลี่ยนขนาดยา'],
          interventionOther: '',
          evalStatus: 'evaluated',
          adr: '',
          pathogens: [
            {
              source: 'Hemoculture',
              checked: true,
              date: '2026-08-28',
              detail: 'MRSA, S ต่อ vancomycin (MIC 1)',
            },
          ],
          note: 'ปรับเป็น 1 g q 12 hr ตามระดับยาในเลือด ติดตาม trough level ซ้ำวันที่ 5',
          evaluatorName: 'ภก.ศิริพร วงศ์คำ',
          evaluatedAt: '2026-08-31 15:20',
        },
      },
    ],
    allergies: [],
    conditions: ['หัวใจ'],
    renalTrend: RENAL_TREND_DECLINE_RECOVER,
    cultureHistory: CULTURE_HISTORY,
    antibioticHistory: ANTIBIOTIC_HISTORY,
  },
  {
    id: 'DUE-6900401',
    requestedAt: '2026-08-29 11:02',
    requesterName: 'นพ.กิตติพงษ์ อินทร์แก้ว',
    status: 'denied',
    supervisorName: 'นพ.ประสิทธิ์ วรรณกิจ (แพทย์ผู้กำกับการใช้ยา)',
    supervisorNote: 'ผลเพาะเชื้อยังไวต่อ carbapenem ให้ใช้ meropenem ก่อน ยังไม่จำเป็นต้องใช้ colistin',
    supervisorDecidedAt: '2026-08-29 13:35',
    hn: '999000106',
    patientName: 'นางเพ็ญศรี จันทร์หอม',
    age: 70,
    sex: '2',
    visitType: 'IPD',
    an: '690017388',
    wardName: 'อายุรกรรมหญิง',
    creatinineAt: '2026-08-28',
    cr: '1.68',
    weight: '52',
    crcl: '25.1',
    egfr: '31.4',
    awaitingCreatinine: false,
    sepsis: 'yes',
    infectionSource: 'hospital',
    diagnosis: 'Catheter-related bloodstream infection',
    diagnosisOther: '',
    infectionSite: 'กระแสเลือด',
    specimens: [
      {
        specimen: 'Hemoculture',
        cs: 'Klebsiella pneumoniae',
        gs: 'GNB 2+',
        susceptibility: 'S ต่อ meropenem',
      },
    ],
    noPriorAntibiotic: false,
    priorAntibiotic: 'Ceftriaxone Injection 1GM. 1 g. Vial',
    priorStartedAt: '2026-08-23',
    priorDays: 6,
    drugs: [
      {
        id: 1,
        name: '[DUE][IPD,Emed] (ง)Colistin-150 Injection ( KOLIMYCIN, บ.เอเบิลเมดิคอล ) 150 mg. Vial',
        dose: '150 mg IV q 12 hr',
        startedAt: '2026-08-29',
        indication: 'ไม่ทราบผล : ให้ยาแบบ Empirical',
        indicationOther: '',
        evaluation: null,
      },
    ],
    allergies: ['CEPHALOSPORIN'],
    conditions: ['ไตเรื้อรัง', 'มะเร็ง'],
    renalTrend: RENAL_TREND_DECLINE_RECOVER,
    cultureHistory: CULTURE_HISTORY,
    antibioticHistory: ANTIBIOTIC_HISTORY,
  },
  {
    // ใบนี้ขอยาสองตัว โดยมีตัวเดียวที่ต้องผ่านแพทย์ผู้กำกับ — ตั้งใจใส่ไว้
    // ให้เห็นว่าหน้าจออนุมัติต้องบอกได้ว่ากำลังตัดสินยาตัวไหนในใบ
    id: 'DUE-6900414',
    requestedAt: '2026-09-01 13:15',
    requesterName: 'นพ.กิตติพงษ์ อินทร์แก้ว',
    status: 'awaiting_approval',
    supervisorNote: null,
    supervisorName: null,
    supervisorDecidedAt: null,
    hn: '999000107',
    patientName: 'นายสุรพล มีชัย',
    age: 66,
    sex: '1',
    visitType: 'IPD',
    an: '690018012',
    wardName: 'ICU ศัลยกรรม',
    creatinineAt: '2026-08-31',
    cr: '1.42',
    weight: '64',
    crcl: '39.8',
    egfr: '50.7',
    awaitingCreatinine: false,
    sepsis: 'yes',
    infectionSource: 'hospital',
    diagnosis: 'Intra-abdominal infection with septic shock',
    diagnosisOther: 'หลังผ่าตัดลำไส้ทะลุวันที่ 5',
    infectionSite: 'ช่องท้อง',
    specimens: [
      {
        specimen: 'Peritoneal fluid',
        cs: 'Acinetobacter baumannii + E. coli',
        gs: 'GNB 3+',
        susceptibility: 'Acinetobacter R ต่อ carbapenem, S ต่อ colistin',
      },
    ],
    noPriorAntibiotic: false,
    priorAntibiotic: 'Ceftazidime Injection 1 g. Vial',
    priorStartedAt: '2026-08-27',
    priorDays: 5,
    drugs: [
      {
        id: 1,
        name: '[DUE][IPD,Emed,Med] (ง)Meropenem Injection (MONEM,บ.ไบโอฟาร์ม) 1 g. Vial',
        dose: '1 g IV q 8 hr',
        startedAt: '2026-09-01',
        indication: 'ผลเพาะเชื้อพบเชื้อดื้อยา',
        indicationOther: 'คุม E. coli ESBL',
        evaluation: null,
      },
      {
        id: 2,
        name: '[DUE][IPD,Emed] (ง)Colistin-150 Injection ( KOLIMYCIN, บ.เอเบิลเมดิคอล ) 150 mg. Vial',
        dose: 'LD 300 mg IV then 150 mg IV q 12 hr',
        startedAt: '2026-09-01',
        indication: 'ผลเพาะเชื้อพบเชื้อดื้อยา',
        indicationOther: 'Acinetobacter ไวต่อ colistin ตัวเดียว',
        evaluation: null,
      },
    ],
    allergies: [],
    conditions: ['เบาหวาน/ไตเรื้อรัง'],
    renalTrend: RENAL_TREND_WORSENING,
    cultureHistory: CULTURE_HISTORY,
    antibioticHistory: ANTIBIOTIC_HISTORY,
  },
]
