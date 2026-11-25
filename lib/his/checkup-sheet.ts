/**
 * ใบรายงานผลการตรวจสุขภาพ — ข้อมูลและโครงของรายงาน (ไม่แตะฐาน ใช้ได้ทั้งสองฝั่ง)
 *
 * ยกมาจากต้นแบบของ pyhosweb (lib/checkup-results/printout.ts) ซึ่งทำตามรายงานเดิม
 * ของโรงพยาบาล (คิวรี "ใบรายงานผลการตรวจสุขภาพ" ที่ทีมใช้อยู่):
 * - แต่ละบรรทัดผลแล็บผูกกับรหัส lab_items_code ของ HIS — รายการเดียวกันมีหลายรหัส
 *   ตามแพ็กเกจ (เช่น Creatinine = 1490 ตรวจสุขภาพข้าราชการ, 90, 881, 1218) ใช้รหัสแรกที่มีผล
 * - ข้อความแปลผล หน่วยงาน ตำแหน่ง ข้อสรุป คำแนะนำ มาจากแบบบันทึกการตรวจสุขภาพ
 *   อาชีวเวชกรรม (universal form 43) — ดู lib/his/checkup-sheet-data.ts
 * - แปลผลน้ำตาล, GFR (Cockcroft-Gault), BMI, ความดัน, รอบเอว ตามเกณฑ์เดียวกับคิวรีเดิม
 * หมวดที่ไม่มีผลตรวจเลยจะไม่แสดง
 *
 * ตรวจกับฐานของเราแล้ว (22 พ.ย. 2569) — ฐานเดียวกับ pyhosweb รหัสแล็บในรายงานมีอยู่
 * 75 จาก 76 รหัส ที่ไม่มีคือ 1216 (Hepatitis A IgM) ซึ่งแค่ทำให้บรรทัดนั้นไม่ขึ้น
 *
 * ต่างจากต้นแบบหนึ่งเรื่อง: **ไม่มีที่อยู่และเบอร์โทรของผู้ป่วย** — ต้นแบบพิมพ์ให้
 * ผู้ป่วยดูผลของตัวเองหลังยืนยันตัวตนด้วย OTP ส่วนระบบนี้เจ้าหน้าที่เปิดดูของ
 * ผู้ป่วยคนอื่น กติกาของระบบคือข้อมูลติดต่อและเลขบัตรต้องไม่ออกจากชั้น API
 */

export type LabValue = {
  value: string
  /** หน่วย (lab_items_unit) */
  unit?: string
  /** ค่าอ้างอิงที่บันทึกพร้อมผล (lab_items_normal_value_ref) */
  normal?: string
  /** ห้องแล็บระบุว่าผิดปกติ (abnormal_result = 'Y') */
  abnormal: boolean
}

/** ข้อความจากแบบบันทึกการตรวจสุขภาพ (form 43) — ชื่อ key = ช่องในแบบบันทึก */
export type FormNotes = {
  cbc?: string
  xray?: string
  kidney?: string
  liver?: string
  lipid?: string
  hepb?: string
  hepa?: string
  urine?: string
  uric?: string
  stoolParasite?: string
  stoolCulture?: string
  audiometry?: string
  spirometry?: string
  vision?: string
  visionNear?: string
  visionFar?: string
  other?: string
  conclusion?: string
  advice?: string
}

export type CheckupPrintout = {
  patient: {
    name: string
    /** อายุ (ปี) ณ วันที่มาตรวจ */
    age?: number
    /** "1" ชาย, "2" หญิง (patient.sex) */
    sex?: string
    hn: string
    /** หน่วยงาน, ตำแหน่ง, วัตถุประสงค์ของการตรวจ (form 43) */
    unit?: string
    position?: string
    purpose?: string
  }
  /** วันที่รับบริการ YYYY-MM-DD (ค.ศ.) */
  visitDate: string
  /** ประเภทการตรวจ (ชื่อสิทธิ pttype) */
  program?: string
  /** แพทย์ผู้ตรวจ — ชื่อรวมคำนำหน้า (doctor.name), เลขใบอนุญาตแบบ "ว.12345" */
  doctor?: { name: string; license?: string }
  /** จากห้องคัดกรอง (opdscreen) — ไม่ได้วัด = undefined */
  vitals: {
    weight?: number
    height?: number
    bmi?: number
    bps?: number
    bpd?: number
    pulse?: number
    waist?: number
  }
  /** ผลแล็บที่ยืนยันแล้ว แยกตาม lab_items_code */
  labs: Record<number, LabValue>
  notes: FormNotes
}

export type PrintLine = {
  label: string
  /** ชื่อภาษาไทยประกอบ (ตัวเล็กต่อท้ายชื่อ) */
  hint?: string
  codes: number[]
  /** ค่าที่คำนวณเอง ไม่ได้มาจากแล็บ */
  derived?: 'gfr'
}
export type PrintGroup = { label?: string; lines: PrintLine[] }
export type NoteLine = { label?: string; key: keyof FormNotes }

export type LabSection = {
  kind: 'lab'
  title: string
  en: string
  groups: PrintGroup[]
  /** การแปลผล: ข้อความจากแบบบันทึก (key) หรือคำนวณจากระดับน้ำตาล */
  notes: (NoteLine | { label?: string; key: 'glucose' })[]
}
export type NoteSection = { kind: 'notes'; title: string; en: string; notes: NoteLine[] }
export type ReportSection = LabSection | NoteSection

const FBS_CODES = [772, 915, 91, 1491, 879, 1481]
const CR_CODES = [1490, 90, 881, 1218]

/** ลำดับหมวดในใบรายงาน (ต่อจากข้อมูลผู้รับบริการและการตรวจร่างกาย) */
export const REPORT: ReportSection[] = [
  {
    kind: 'lab',
    title: 'ความสมบูรณ์ของเม็ดเลือด',
    en: 'Complete Blood Count (CBC)',
    notes: [{ key: 'cbc' }],
    groups: [
      {
        label: 'เม็ดเลือดแดง',
        lines: [
          { label: 'Hemoglobin (Hb)', hint: 'ความเข้มข้นของฮีโมโกลบิน', codes: [233] },
          { label: 'Hematocrit (Hct)', hint: 'ความเข้มข้นของเลือด', codes: [234] },
          { label: 'MCV', hint: 'ขนาดเม็ดเลือดแดงเฉลี่ย', codes: [235] },
          { label: 'RBC Morphology', hint: 'ลักษณะเม็ดเลือดแดง', codes: [254] },
        ],
      },
      {
        label: 'เม็ดเลือดขาว',
        lines: [
          { label: 'WBC', hint: 'จำนวนเม็ดเลือดขาวรวม', codes: [230] },
          { label: 'Neutrophil', codes: [243] },
          { label: 'Lymphocyte', codes: [244] },
          { label: 'Monocyte', codes: [245] },
          { label: 'Eosinophil', codes: [246] },
          { label: 'Basophil', codes: [247] },
        ],
      },
      {
        label: 'เกล็ดเลือด',
        lines: [{ label: 'Platelet', hint: 'จำนวนเกล็ดเลือด', codes: [239] }],
      },
    ],
  },
  { kind: 'notes', title: 'เอกซเรย์ทรวงอก', en: 'Chest X-ray', notes: [{ key: 'xray' }] },
  {
    kind: 'lab',
    title: 'ระดับน้ำตาลในเลือด',
    en: 'Fasting Blood Sugar',
    notes: [{ key: 'glucose' }],
    groups: [{ lines: [{ label: 'FBS', hint: 'น้ำตาลในเลือดหลังงดอาหาร', codes: FBS_CODES }] }],
  },
  {
    kind: 'lab',
    title: 'ไขมันในเลือด',
    en: 'Lipid Profile',
    notes: [{ key: 'lipid' }],
    groups: [
      {
        lines: [
          { label: 'Cholesterol', hint: 'คอเลสเตอรอลรวม', codes: [1495, 105, 883, 1222] },
          { label: 'Triglyceride', hint: 'ไตรกลีเซอไรด์', codes: [1496, 107, 885] },
          { label: 'HDL-C', hint: 'ไขมันชนิดดี', codes: [1484, 106, 887] },
          { label: 'LDL-C', hint: 'ไขมันชนิดไม่ดี', codes: [889, 4] },
        ],
      },
    ],
  },
  {
    kind: 'lab',
    title: 'การทำงานของไต',
    en: 'Renal Function',
    notes: [{ key: 'kidney' }],
    groups: [
      {
        lines: [
          { label: 'BUN', codes: [1489, 89, 877] },
          { label: 'Creatinine', codes: CR_CODES },
          { label: 'GFR', hint: 'อัตราการกรองของไต (Cockcroft-Gault)', codes: [], derived: 'gfr' },
        ],
      },
    ],
  },
  {
    kind: 'lab',
    title: 'การทำงานของตับ',
    en: 'Liver Function',
    notes: [{ key: 'liver' }],
    groups: [
      {
        lines: [
          { label: 'AST (SGOT)', codes: [1494, 102, 891] },
          { label: 'ALT (SGPT)', codes: [1493, 101, 893] },
          { label: 'ALP', hint: 'Alkaline phosphatase', codes: [1492, 100] },
        ],
      },
    ],
  },
  {
    kind: 'lab',
    title: 'กรดยูริกในเลือด',
    en: 'Uric Acid',
    notes: [{ key: 'uric' }],
    groups: [{ lines: [{ label: 'Uric acid', codes: [1497, 108, 895] }] }],
  },
  {
    kind: 'lab',
    title: 'ไวรัสตับอักเสบบี',
    en: 'Hepatitis B',
    notes: [{ key: 'hepb' }],
    groups: [
      {
        lines: [
          { label: 'HBsAg', hint: 'เชื้อไวรัสตับอักเสบบี', codes: [293, 1224] },
          { label: 'HBsAb', hint: 'ภูมิคุ้มกัน', codes: [337] },
          { label: 'Anti-HBc', hint: 'เคยติดเชื้อ', codes: [295] },
        ],
      },
    ],
  },
  {
    kind: 'lab',
    title: 'ไวรัสตับอักเสบเอ',
    en: 'Hepatitis A',
    notes: [{ key: 'hepa' }],
    groups: [
      {
        lines: [
          { label: 'IgM', codes: [1216] },
          { label: 'IgG', codes: [1528] },
        ],
      },
    ],
  },
  {
    kind: 'lab',
    title: 'การตรวจปัสสาวะ',
    en: 'Urinalysis',
    notes: [{ key: 'urine' }],
    groups: [
      {
        label: 'ลักษณะทั่วไป',
        lines: [
          { label: 'Color', hint: 'สี', codes: [145] },
          { label: 'Appearance', hint: 'ความขุ่นใส', codes: [146] },
          { label: 'Specific gravity', hint: 'ความถ่วงจำเพาะ', codes: [147, 178, 1353] },
          { label: 'pH', hint: 'ความเป็นกรด-ด่าง', codes: [148] },
        ],
      },
      {
        label: 'การตรวจทางเคมี',
        lines: [
          { label: 'Protein', hint: 'โปรตีน', codes: [149] },
          { label: 'Sugar', hint: 'น้ำตาล', codes: [150] },
          { label: 'Ketone', codes: [934] },
          { label: 'Bilirubin', codes: [932] },
          { label: 'Urobilinogen', codes: [936] },
          { label: 'Blood', hint: 'เลือด', codes: [1166] },
          { label: 'Leukocyte', hint: 'เม็ดเลือดขาว', codes: [1168] },
          { label: 'Nitrite', codes: [938] },
        ],
      },
      {
        label: 'การตรวจด้วยกล้องจุลทรรศน์',
        lines: [
          { label: 'RBC', hint: 'เม็ดเลือดแดง', codes: [151] },
          { label: 'WBC', hint: 'เม็ดเลือดขาว', codes: [152] },
          { label: 'Squamous epithelial', hint: 'เซลล์เยื่อบุ', codes: [153] },
          { label: 'Bacteria', hint: 'แบคทีเรีย', codes: [156] },
        ],
      },
    ],
  },
  {
    kind: 'lab',
    title: 'การตรวจอุจจาระ',
    en: 'Stool Examination',
    notes: [
      { label: 'พยาธิ', key: 'stoolParasite' },
      { label: 'เพาะเชื้อ', key: 'stoolCulture' },
    ],
    groups: [
      {
        lines: [
          { label: 'Parasite', hint: 'ไข่พยาธิ', codes: [524, 192, 191] },
          { label: 'Occult blood (FOBT)', hint: 'เลือดแฝงในอุจจาระ', codes: [1486, 193] },
        ],
      },
    ],
  },
  {
    kind: 'notes',
    title: 'การตรวจตามความเสี่ยงจากการทำงาน',
    en: 'Occupational Health Screening',
    notes: [
      { label: 'สมรรถภาพการได้ยิน (Audiometry)', key: 'audiometry' },
      { label: 'สมรรถภาพปอด (Spirometry)', key: 'spirometry' },
      { label: 'สมรรถภาพการมองเห็น (Vision screening)', key: 'vision' },
      { label: 'สายตาระยะใกล้', key: 'visionNear' },
      { label: 'สายตาระยะไกล', key: 'visionFar' },
      { label: 'ผลตรวจอื่น ๆ', key: 'other' },
    ],
  },
]

/** รหัสแล็บทั้งหมดที่รายงานใช้ — ให้คิวรีดึงเฉพาะเท่านี้ */
export const REPORT_CODES = REPORT.flatMap(s =>
  s.kind === 'lab' ? s.groups.flatMap(g => g.lines.flatMap(l => l.codes)) : [],
)

/** ผลแล็บของบรรทัดหนึ่ง — รหัสแรกที่มีผล */
export const lineValue = (labs: CheckupPrintout['labs'], line: PrintLine) =>
  line.codes.map(c => labs[c]).find(Boolean)

const numeric = (v?: string) => {
  const n = Number(v?.replace(/,/g, '').trim())
  return v != null && v.trim() !== '' && Number.isFinite(n) ? n : undefined
}

/**
 * ตัวเลขยาวใส่จุลภาค (7490 → 7,490) ทศนิยมยาวผิดปกติ (≥ 4 ตำแหน่ง) ปัดเหลือ 2
 * (108.9743589 → 108.97) ทศนิยม 3 ตำแหน่งคงไว้ — ความถ่วงจำเพาะปัสสาวะเป็น 1.015
 */
export function formatValue(v: string) {
  const s = v.trim()
  if (/^\d{4,}$/.test(s)) return Number(s).toLocaleString('en-US')
  if (/^\d+\.\d{4,}$/.test(s)) return Number(s).toFixed(2)
  return s
}

/**
 * ค่าอ้างอิงตามเพศ — HIS เก็บรวมสองเพศ เช่น "M 0.72-1.18,F 0.55-1.02" หรือ "(ช)40-55(ญ)36-47"
 * รู้เพศแล้วแสดงเฉพาะของเพศนั้น อ่านรูปแบบไม่ออกก็แสดงตามที่บันทึก
 */
export function refForSex(ref: string | undefined, sex?: string) {
  if (!ref || (sex !== '1' && sex !== '2')) return ref
  const range = String.raw`(\d[\d.,]*\s*-\s*\d[\d.,]*)`
  const pattern =
    sex === '1'
      ? new RegExp(String.raw`(?:\bM\s*|\(ช\)\s*)` + range)
      : new RegExp(String.raw`(?:\bF\s*|\(ญ\)\s*)` + range)
  const m = pattern.exec(ref)
  return m ? m[1].replace(/\s+/g, '').replace(/,$/, '') : ref
}

/**
 * GFR สูตร Cockcroft-Gault ตามรายงานเดิม (มล./นาที)
 * ชาย (140 − อายุ) × น้ำหนัก / (72 × Cr), หญิง × 0.85 — ข้อมูลไม่ครบ = undefined
 */
export function gfr(d: CheckupPrintout) {
  const cr = numeric(CR_CODES.map(c => d.labs[c]).find(Boolean)?.value)
  const { age, sex } = d.patient
  const bw = d.vitals.weight
  if (!cr || age == null || !bw || (sex !== '1' && sex !== '2')) return undefined
  const clearance = ((140 - age) * bw) / (72 * cr)
  return sex === '2' ? clearance * 0.85 : clearance
}

/** แปลผลระดับน้ำตาลหลังงดอาหาร ตามเกณฑ์รายงานเดิม */
export function glucoseLabel(labs: CheckupPrintout['labs']) {
  const fbs = numeric(FBS_CODES.map(c => labs[c]).find(Boolean)?.value)
  if (fbs == null) return 'ไม่พบการตรวจน้ำตาลในโลหิต'
  if (fbs < 101) return 'ปกติ'
  if (fbs < 125) return 'เสี่ยงต่อโรคเบาหวาน'
  return 'อาจเป็นเบาหวาน'
}

/** ดัชนีมวลกาย ตามเกณฑ์รายงานเดิม (คนเอเชีย) */
export function bmiLabel(bmi?: number) {
  if (!bmi) return ''
  if (bmi < 18.5) return 'ผอม'
  if (bmi < 23) return 'สมส่วน'
  if (bmi < 25) return 'น้ำหนักเกิน'
  if (bmi < 30) return 'อ้วน'
  return 'อ้วนอันตราย'
}

/** ความดันโลหิต ตามเกณฑ์รายงานเดิม (≥ 140/90 สูงกว่าปกติ) */
export function bpLabel(bps?: number, bpd?: number) {
  if (!bps || !bpd) return ''
  return bps >= 140 || bpd >= 90 ? 'สูงกว่าปกติ' : 'ปกติ'
}

/** รอบเอว ตามเกณฑ์รายงานเดิม (ชาย ≥ 90, หญิง ≥ 80 ซม. = ลงพุง) */
export function waistLabel(waist?: number, sex?: string) {
  if (!waist || (sex !== '1' && sex !== '2')) return ''
  return waist >= (sex === '1' ? 90 : 80) ? 'ลงพุง' : 'ปกติ'
}

/** ผลแปลที่ถือว่าปกติ — ป้ายสีเขียว ที่เหลือสีส้ม */
export const isNormalLabel = (label: string) => label === 'ปกติ' || label === 'สมส่วน'

/** ค่าที่ต้องใช้ในบรรทัด (GFR คำนวณ ที่เหลือจากแล็บ) */
export function valueOf(d: CheckupPrintout, line: PrintLine): LabValue | undefined {
  if (line.derived === 'gfr') {
    const v = gfr(d)
    return v == null ? undefined : { value: v.toFixed(2), unit: 'มล./นาที', abnormal: false }
  }
  return lineValue(d.labs, line)
}

/** ข้อความแปลผลของหมวด (ตามลำดับใน notes) */
export function sectionNotes(d: CheckupPrintout, s: ReportSection) {
  return s.notes
    .map(n => ({
      label: n.label,
      text: n.key === 'glucose' ? glucoseLabel(d.labs) : d.notes[n.key],
    }))
    .filter((n): n is { label: string | undefined; text: string } => !!n.text)
}

/** หมวดที่มีผลตรวจอย่างน้อยหนึ่งค่า (หรือมีข้อความจากแบบบันทึก) — ที่เหลือไม่แสดง */
export function hasData(d: CheckupPrintout, s: ReportSection) {
  if (s.kind === 'lab')
    return (
      s.groups.some(g => g.lines.some(l => valueOf(d, l))) ||
      s.notes.some(n => n.key !== 'glucose' && d.notes[n.key])
    )
  return s.notes.some(n => d.notes[n.key])
}

/** รายการที่อยู่นอกเกณฑ์ทั้งหมด สำหรับหน้าสรุป — ข้อเท็จจริงจากผลตรวจ ไม่ใช่การวินิจฉัย */
export function findings(d: CheckupPrintout) {
  const out: string[] = []
  const { vitals: v, patient: p } = d
  const bmi = bmiLabel(v.bmi)
  if (bmi && !isNormalLabel(bmi)) out.push(`ดัชนีมวลกาย ${v.bmi?.toFixed(1)} กก./ม² (${bmi})`)
  const bp = bpLabel(v.bps, v.bpd)
  if (bp && !isNormalLabel(bp)) out.push(`ความดันโลหิต ${v.bps}/${v.bpd} มม.ปรอท (${bp})`)
  const waist = waistLabel(v.waist, p.sex)
  if (waist && !isNormalLabel(waist)) out.push(`รอบเอว ${v.waist} ซม. (${waist})`)
  for (const s of REPORT) {
    if (s.kind !== 'lab') continue
    for (const g of s.groups)
      for (const l of g.lines) {
        const val = valueOf(d, l)
        if (val?.abnormal)
          out.push(`${s.title}: ${l.label} ${formatValue(val.value)}${val.unit ? ` ${val.unit}` : ''}`)
      }
  }
  const glucose = glucoseLabel(d.labs)
  if (glucose !== 'ปกติ' && glucose !== 'ไม่พบการตรวจน้ำตาลในโลหิต')
    out.push(`ระดับน้ำตาลในเลือด: ${glucose}`)
  return out
}
