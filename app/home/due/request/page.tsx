'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ยังทำที่ app/home/layout.tsx ซึ่งเป็น Server Component)
import { useRef, useState } from 'react'
import Link from 'next/link'
import {
  Alert,
  AutoComplete,
  Breadcrumb,
  Button,
  DatePicker,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import {
  AuditOutlined,
  DeleteOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  HistoryOutlined,
  PlusOutlined,
  SearchOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import buddhistEra from 'dayjs/plugin/buddhistEra'
import { apiFetch } from '@/lib/client/session'
import AssistPanel from './assist-panel'
import LabCultureModal from '@/app/home/lab-culture-modal'
import type { DueDrug as DueDrugItem, DuePatient, PriorAntimicrobial } from '@/lib/his/due'

// เปิด token BBBB (ปี พ.ศ.) ให้ dayjs — ถ้าไม่ extend ปฏิทินจะพิมพ์คำว่า BBBB ออกมาตรง ๆ
dayjs.extend(buddhistEra)

const { Text, Title } = Typography
const { TextArea } = Input

/**
 * ตัวเลือกสิ่งส่งตรวจ — ยังไม่ได้รายการจริงจากห้องแล็บ ชุดนี้เป็นตัวอย่างที่พบบ่อย
 * ต้องขอรายการที่โรงพยาบาลใช้จริงมาแทนก่อนเปิดใช้งาน
 */
const SPECIMEN_OPTIONS = [
  'Hemoculture',
  'Sputum',
  'Urine',
  'Pus / Wound swab',
  'Body fluid',
  'CSF',
  'Stool',
  'Tissue',
  'อื่น ๆ',
]

/**
 * ตัวช่วยเติมช่อง C/S — ยังไม่ได้รายการเชื้อจริงจากห้องแล็บ
 * ใช้ AutoComplete ไม่ใช่ Select เพราะรายการเชื้อมีเป็นร้อย พิมพ์เองได้ด้วย
 * จะได้ไม่ถูกล็อกอยู่กับรายการที่ผมเดามา
 */
const CS_SUGGESTIONS = [
  'No growth',
  'Escherichia coli',
  'Klebsiella pneumoniae',
  'Pseudomonas aeruginosa',
  'Acinetobacter baumannii',
  'Staphylococcus aureus',
  'MRSA',
  'Enterococcus faecalis',
  'Streptococcus pneumoniae',
  'Candida albicans',
]

/** สิ่งส่งตรวจหนึ่งแถวในตาราง Specimens */
type SpecimenRow = {
  /** id ฝั่งหน้าจอไว้ใช้เป็น key — ใช้ index ไม่ได้เพราะลบแถวกลางแล้วช่องจะสลับค่ากัน */
  id: number
  specimen: string
  cs: string
  gs: string
  susceptibility: string
}

/**
 * ตัวเลือกข้อบ่งใช้ — ยังไม่ได้รายการจริงจากคณะกรรมการยา ชุดนี้เป็นตัวอย่าง
 * ต้องขอรายการที่โรงพยาบาลใช้จริงมาแทนก่อนเปิดใช้งาน เหมือน SPECIMEN_OPTIONS
 */
const INDICATION_OPTIONS = [
  'ผลเพาะเชื้อพบเชื้อดื้อยา',
  'ผลเพาะเชื้อไม่พบเชื้อ แต่อาการไม่ดีขึ้น',
  'ไม่ทราบผล : ให้ยาแบบ Empirical',
  'ไม่ทราบผล : อื่นๆ',
  'แพ้ยากลุ่มอื่น',
  'อื่นๆ',
]

/** ยาต้านจุลชีพหนึ่งแถวในใบคำขอ */
type DueDrugRow = {
  /** id ฝั่งหน้าจอไว้ใช้เป็น key — เหตุผลเดียวกับ SpecimenRow */
  id: number
  /** icode ของยาใน drugitems */
  icode: string | null
  dose: string
  startedAt: Dayjs | null
  indication: string | null
  indicationOther: string
}

/** ค่าที่กรอกในส่วนข้อมูลประวัติ — ยังเก็บอยู่ในหน้าจอเท่านั้น ยังไม่ได้บันทึกที่ไหน */
type DueHistory = {
  /** วันที่เจาะ Creatinine ครั้งล่าสุด — เติมจากแล็บ แต่แก้เองได้ */
  creatinineAt: Dayjs | null
  cr: string
  /** น้ำหนัก (กก.) เติมจากใบคัดกรองครั้งล่าสุด แก้เองได้ — เป็นตัวตั้งของ CrCl */
  weight: string
  /** CrCl (mL/min) คำนวณจาก Cr และน้ำหนักด้วย Cockcroft-Gault */
  crcl: string
  /** เภสัชกรพิมพ์ CrCl เอง — พิมพ์แล้วหยุดคำนวณทับ ไม่งั้นค่าที่แก้จะถูกเขียนทิ้ง */
  crclEdited: boolean
  /** eGFR (mL/min/1.73m²) — ใช้ค่าจากห้องแล็บ ถ้าไม่มีจึงคิดเองด้วย CKD-EPI 2009 */
  egfr: string
  /** เภสัชกรพิมพ์ eGFR เอง — เหตุผลเดียวกับ crclEdited */
  egfrEdited: boolean
  /** ยังไม่มีผลค่าไต — เปิดแล้วช่องค่าไตถูกล้างและปิดการกรอก */
  awaitingCreatinine: boolean
  sepsis: 'none' | 'yes' | null
  infectionSource: 'community' | 'hospital' | null
  diagnosis: string
  diagnosisOther: string
  infectionSite: string
  specimen: string | null
  collectedAt: Dayjs | null
  awaitingResult: boolean
  specimens: SpecimenRow[]
  priorAntibiotic: string
  /** ไม่มีประวัติรับยาต้านจุลชีพมาก่อน — เปิดแล้วช่องด้านล่างถูกล้างและปิดการกรอก */
  noPriorAntibiotic: boolean
  priorStartedAt: Dayjs | null
  priorDays: number | null
  /** ยาต้านจุลชีพที่ขออนุมัติในใบนี้ */
  drugs: DueDrugRow[]
}

const EMPTY_HISTORY: DueHistory = {
  creatinineAt: null,
  cr: '',
  weight: '',
  crcl: '',
  crclEdited: false,
  egfr: '',
  egfrEdited: false,
  awaitingCreatinine: false,
  sepsis: null,
  infectionSource: null,
  diagnosis: '',
  diagnosisOther: '',
  infectionSite: '',
  specimen: null,
  collectedAt: null,
  awaitingResult: false,
  specimens: [],
  priorAntibiotic: '',
  noPriorAntibiotic: false,
  priorStartedAt: null,
  priorDays: null,
  drugs: [],
}

/**
 * ดอกจันหน้าหัวข้อที่ต้องกรอก — วางไว้หน้าป้ายเหมือน required mark ของ antd
 * ใส่ aria-hidden เพราะข้อความ "จำเป็นต้องกรอก" อ่านออกเสียงชัดกว่าอักขระดอกจัน
 */
function RequiredMark() {
  return (
    <>
      <span aria-hidden className="mr-1 text-danger">
        *
      </span>
      <span className="sr-only">จำเป็นต้องกรอก </span>
    </>
  )
}

/** ป้ายกำกับช่องกรอก — ใช้รูปแบบเดียวกับช่องอ่านอย่างเดียวด้านบน */
function Field({
  label,
  children,
  className,
  required,
}: {
  label: string
  children: React.ReactNode
  className?: string
  required?: boolean
}) {
  return (
    <label className={`block ${className ?? ''}`}>
      <span className="mb-1 block text-[11px] font-medium text-ink-3">
        {required && <RequiredMark />}
        {label}
      </span>
      {children}
    </label>
  )
}

/**
 * ช่องค่าแล็บ — ป้ายเป็นชิปเหลืองต่อชิดกับช่องกรอกเป็นชิ้นเดียว
 *
 * ไม่ได้ใช้ addonBefore ของ antd เพราะ DatePicker กับ InputNumber ไม่มี prop นั้น
 * ถ้าใช้จะได้หน้าตาไม่เหมือนกันระหว่างช่องวันที่กับช่องตัวเลข
 * สีมาจาก token --lab-* จึงเปลี่ยนตามธีมสว่าง/มืดที่ผู้ใช้เลือกเอง
 */
function LabField({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`flex items-stretch ${className ?? ''}`}>
      <span className="flex shrink-0 items-center gap-1.5 rounded-l-lg border border-lab-line bg-lab-chip px-2.5 text-xs font-semibold text-lab-chip-ink">
        <ExperimentOutlined />
        {label}
      </span>
      {/* min-w-0 กันช่องข้างในดันกล่องให้ล้นคอลัมน์เวลาจอแคบ */}
      <div className="lab-control min-w-0 flex-1">{children}</div>
    </div>
  )
}

/** HN ในฐาน HIS เก็บเป็นตัวเลข 9 หลักเติมศูนย์นำหน้า */
const HN_LENGTH = 9

/**
 * CrCl ด้วยสูตร Cockcroft-Gault
 *
 *   CrCl = (140 − อายุ) × น้ำหนัก(กก.) / (72 × Cr) × 0.85 ถ้าเป็นหญิง
 *
 * คำนวณฝั่งหน้าจอ ไม่ใช่ฝั่งเซิร์ฟเวอร์ เพราะเภสัชกรต้องแก้น้ำหนักได้เอง
 * (น้ำหนักที่ชั่งไว้อาจเก่า หรือต้องใช้ adjusted body weight ในคนอ้วน)
 * แล้วเห็นค่าใหม่ทันทีโดยไม่ต้องยิงกลับไปที่เซิร์ฟเวอร์
 *
 * คืน null เมื่อข้อมูลไม่ครบหรือค่าไม่สมเหตุสมผล — ปล่อยให้กรอกเองดีกว่าโชว์เลขมั่ว
 */
function cockcroftGault({
  age,
  sex,
  weightKg,
  cr,
}: {
  age: number | null
  sex: string | null
  weightKg: number
  cr: number
}): number | null {
  if (age == null || age < 0 || age >= 140) return null
  if (!(weightKg > 0) || !(cr > 0)) return null
  const female = sex === '2'
  const value = ((140 - age) * weightKg * (female ? 0.85 : 1)) / (72 * cr)
  if (!Number.isFinite(value)) return null
  return Math.round(value * 10) / 10
}

/**
 * สีป้ายของแต่ละกลุ่มโรค — ใช้ชื่อสีสำเร็จของ antd ไม่ใช่ค่าสีตรง ๆ
 * เพราะ antd สลับเฉดของสีชุดนี้ตาม algorithm ธีมสว่าง/มืดให้อยู่แล้ว
 * ถ้าใส่เป็นรหัสสีเองจะสว่างเกินหรือมืดเกินในธีมใดธีมหนึ่งเสมอ
 *
 * sepsis เป็นสีแดงเพราะเกี่ยวกับคำถามข้อแรกของฟอร์มโดยตรง
 * ที่เหลือแยกสีให้ต่างกันชัดพอจะกวาดตาเห็นทีเดียวว่ามีกลุ่มไหนบ้าง
 */
const CONDITION_COLORS: Record<string, string> = {
  sepsis: 'red',
  stroke: 'purple',
  heart: 'volcano',
  copd: 'geekblue',
  asthma: 'cyan',
  cancer: 'magenta',
}

/**
 * ชื่อสารที่แพ้ตัวไหนโผล่อยู่ในชื่อยา — ใช้กติกาเดียวกับหน้า Drug Profile
 *
 * ตัดอักขระที่ไม่ใช่ตัวอักษร/ตัวเลขในชื่อยาให้เป็นช่องว่างก่อน เพราะชื่อยาในฐาน
 * มีวงเล็บและเครื่องหมายคั่นเต็มไปหมด แล้วแยกสารที่แพ้ด้วย + สำหรับยาสูตรผสม
 *
 * ตัดคำที่สั้นกว่า 5 ตัวอักษรทิ้ง — คำสั้นอย่าง 'ASA' ไปโผล่ในชื่อยาอื่นได้ง่าย
 * ตอนทดสอบกับคู่ (คำสั่งยา × การแพ้) จริง 1,341 คู่ ได้ตรง 4 คู่ ผิด 0 คู่
 *
 * เป็นการจับแบบหยาบ ยาที่บันทึกด้วยชื่อการค้าอย่างเดียวจะจับไม่ได้ จึงยังต้อง
 * แสดงรายการแพ้ยาทั้งหมดไว้ให้อ่านเองด้วย ไม่ใช่พึ่งตัวจับคู่อย่างเดียว
 */
function matchedAllergies(drugName: string, allergies: { agent: string }[]): string[] {
  const haystack = drugName.toUpperCase().replace(/[^A-Z0-9+]+/g, ' ')
  return allergies
    .filter(allergy =>
      allergy.agent
        .toUpperCase()
        .split('+')
        .map(token => token.trim())
        .filter(token => token.length >= 5)
        .some(token => haystack.includes(token)),
    )
    .map(allergy => allergy.agent)
}

/**
 * CKD-EPI ใช้ได้กับผู้ใหญ่เท่านั้น เด็กต้องใช้ Schwartz ซึ่งต้องมีส่วนสูงและคนละสูตรกัน
 * อายุต่ำกว่านี้จึงไม่คำนวณให้ ปล่อยให้ใช้ค่าจากห้องแล็บหรือกรอกเอง
 */
const CKD_EPI_MIN_AGE = 18

/**
 * eGFR ด้วยสูตร CKD-EPI 2009 (creatinine) แบบไม่มีตัวคูณเชื้อชาติ
 *
 *   eGFR = 141 × min(Scr/κ,1)^α × max(Scr/κ,1)^−1.209 × 0.993^อายุ × 1.018 ถ้าเป็นหญิง
 *   κ = 0.7 (หญิง) / 0.9 (ชาย)   α = −0.329 (หญิง) / −0.411 (ชาย)
 *
 * เลือกสูตรนี้เพราะเทียบกับผลจริงจากห้องแล็บ 4,000 ใบในรอบ 30 วันแล้วตรงกัน
 * ทุกใบ (ต่างไม่เกิน 1 หน่วย 100% ค่ากลางของส่วนต่าง 0.20%) ขณะที่ CKD-EPI 2021
 * ตรงแค่ 13.6% และ MDRD ตรงแค่ 27.3% — ถ้าใช้สูตรอื่นตัวเลขบนหน้านี้จะไม่ตรง
 * กับที่แพทย์เห็นในระบบแล็บ
 *
 * หมายเหตุ: คิดจากอายุปัจจุบัน ส่วนห้องแล็บคิดจากอายุ ณ วันเจาะ ผลจึงต่างกัน
 * ได้เล็กน้อยถ้าผลเก่ามาก (0.993^1 = ต่างกัน 0.7% ต่อปี)
 */
function ckdEpi2009({
  age,
  sex,
  cr,
}: {
  age: number | null
  sex: string | null
  cr: number
}): number | null {
  if (age == null || age < CKD_EPI_MIN_AGE || age >= 140) return null
  if (!(cr > 0)) return null
  // เพศต้องระบุชัด — รหัสอื่นนอกจาก 1/2 เดาไม่ได้ว่าใช้ค่าคงที่ชุดไหน
  if (sex !== '1' && sex !== '2') return null
  const female = sex === '2'
  const kappa = female ? 0.7 : 0.9
  const alpha = female ? -0.329 : -0.411
  const ratio = cr / kappa
  const value =
    141 *
    Math.min(ratio, 1) ** alpha *
    Math.max(ratio, 1) ** -1.209 *
    0.993 ** age *
    (female ? 1.018 : 1)
  if (!Number.isFinite(value)) return null
  return Math.round(value * 10) / 10
}

/**
 * น้ำหนักเก่ากว่านี้ถือว่าเชื่อไม่ได้แล้ว ต้องเตือนให้ชั่งใหม่หรือแก้เอง
 *
 * จากการสุ่มดูผู้ป่วยที่มีผล Cr ในรอบ 3 วัน 12 ราย มี 2 รายที่น้ำหนักล่าสุด
 * เป็นของปี 2566 และ 2561 — เอาไปคิด CrCl ตรง ๆ จะคลาดเคลื่อนมาก
 */
const STALE_WEIGHT_DAYS = 365

/** อ่านตัวเลขจากช่องกรอก — คืน null เมื่อว่างหรือไม่ใช่ตัวเลข */
function num(value: string): number | null {
  const parsed = Number(value.trim())
  return value.trim() !== '' && Number.isFinite(parsed) ? parsed : null
}

/** แปลง 'YYYY-MM-DD' เป็น วว/ดด/ปปปป พ.ศ. */
function toThaiDate(value: string | null): string {
  if (!value) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return value
  const [, year, month, day] = match
  return `${day}/${month}/${Number(year) + 543}`
}

/** รหัสเพศของ HIS: 1 = ชาย, 2 = หญิง นอกนั้นไม่ระบุ */
function sexLabel(sex: string | null): string {
  if (sex === '1') return 'ชาย'
  if (sex === '2') return 'หญิง'
  return '—'
}

/** ช่องแสดงข้อมูลที่ดึงมา — อ่านอย่างเดียว ผู้ใช้แก้ไม่ได้ */
function ReadonlyField({
  label,
  value,
  extra,
  className,
}: {
  label: string
  value: string
  extra?: React.ReactNode
  className?: string
}) {
  return (
    <label className={`block ${className ?? ''}`}>
      <span className="mb-1 block text-[11px] font-medium text-ink-3">{label}</span>
      <Input readOnly value={value} suffix={extra} className="cursor-default!" />
    </label>
  )
}

export default function DueRequestPage() {
  const [hn, setHn] = useState('')
  const [patient, setPatient] = useState<DuePatient | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<DueHistory>(EMPTY_HISTORY)
  /** กัน HN เดิมถูกยิงซ้ำตอนพิมพ์ครบ 9 หลักแล้วแก้ตัวท้ายไปมา */
  const lastLookup = useRef('')
  /** เลขรันนิ่งของแถวสิ่งส่งตรวจ ใช้เป็น key ของ React */
  const nextSpecimenId = useRef(1)
  const [labCultureOpen, setLabCultureOpen] = useState(false)
  const [priorOpen, setPriorOpen] = useState(false)
  /** เลขรันนิ่งของแถวยา */
  const nextDrugId = useRef(1)
  /** รายการยา DUE ทั้งโรงพยาบาล — โหลดครั้งเดียวตอนกดเพิ่มแถวแรก */
  const [dueDrugs, setDueDrugs] = useState<DueDrugItem[]>([])
  const [drugsLoading, setDrugsLoading] = useState(false)
  const [drugsError, setDrugsError] = useState('')

  /**
   * ล้างใบคำขอทั้งใบให้เป็นของว่าง
   *
   * ต้องล้างทุกครั้งที่ "คนไข้ที่ผูกกับใบนี้" เปลี่ยน ไม่ใช่เฉพาะตอนลบ HN ทิ้ง
   * ถ้าเหลือค่าเก่าไว้แม้ช่องเดียว จะกลายเป็นบันทึกอาการ ผลเพาะเชื้อ หรือรายการยา
   * ของคนหนึ่งใส่ชื่ออีกคน ซึ่งเป็นความผิดพลาดที่มองไม่เห็นจากหน้าจอ
   *
   * ปิดหน้าต่างที่เปิดค้างด้วย — เนื้อหาข้างในเป็นของคนก่อนหน้า
   */
  const resetForm = () => {
    setHistory(EMPTY_HISTORY)
    setPriorOpen(false)
    setLabCultureOpen(false)
    setDrugsError('')
  }

  const lookup = async (value: string) => {
    const digits = value.replace(/\D/g, '')
    if (digits.length !== HN_LENGTH) return
    // HN เดิมที่ดึงไปแล้ว ไม่ต้องดึงซ้ำและต้องไม่ล้างของที่กรอกค้างไว้
    if (digits === lastLookup.current) return
    lastLookup.current = digits

    setLoading(true)
    setError('')
    setPatient(null)
    // ล้างก่อนยิง ไม่ใช่ล้างตอนได้ผล — ระหว่างรอผลต้องไม่มีข้อมูลคนเก่าค้างบนจอ
    // และถ้าดึงไม่สำเร็จก็ต้องไม่เหลือค้างไว้เหมือนกัน
    resetForm()
    try {
      const res = await apiFetch(`/api/his/due/patient?hn=${digits}`)
      const json = await res.json()
      if (!res.ok || !json.success) {
        setError(json.message ?? 'ดึงข้อมูลผู้ป่วยไม่สำเร็จ')
        return
      }
      const found = json.patient as DuePatient
      setPatient(found)
      // เติมค่าไตล่าสุดให้อัตโนมัติ แต่ยังแก้เองได้ — ถ้าไม่เคยเจาะเลยให้ติ๊ก "รอผล"
      // ไว้ก่อน เพื่อไม่ให้ช่องว่างถูกตีความว่าเภสัชกรลืมกรอก
      const lab = found.creatinine
      const weight = found.weight
      const crcl =
        lab && weight
          ? cockcroftGault({
              age: found.age,
              sex: found.sex,
              weightKg: weight.bw,
              cr: Number(lab.cr),
            })
          : null
      // ห้องแล็บออก eGFR มาด้วยแทบทุกใบ ที่คิดเองไว้เผื่อใบเก่าที่ไม่มีติดมา
      const egfr =
        lab?.egfr ?? (lab ? ckdEpi2009({ age: found.age, sex: found.sex, cr: Number(lab.cr) }) : null)
      // ตั้งต้นจากใบเปล่าเสมอ ไม่ใช่ต่อยอดจากค่าเดิม — กันค่าของคนไข้คนก่อน
      // ติดมากับใบของคนใหม่เวลาพิมพ์ทับ HN ทั้งชุดโดยไม่ผ่านการลบทีละตัว
      setHistory({
        ...EMPTY_HISTORY,
        creatinineAt: lab?.orderDate ? dayjs(lab.orderDate) : null,
        cr: lab?.cr ?? '',
        egfr: egfr == null ? '' : String(egfr),
        egfrEdited: false,
        weight: weight ? String(weight.bw) : '',
        crcl: crcl == null ? '' : String(crcl),
        crclEdited: false,
        awaitingCreatinine: lab == null,
      })
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setLoading(false)
    }
  }

  const onHnChange = (value: string) => {
    // รับเฉพาะตัวเลขและไม่เกิน 9 หลัก — กันพิมพ์ผิดตั้งแต่ต้นทาง
    const digits = value.replace(/\D/g, '').slice(0, HN_LENGTH)
    setHn(digits)
    if (digits.length < HN_LENGTH) {
      // แก้ HN ระหว่างทาง = ข้อมูลเดิมไม่ใช่ของคนที่กำลังพิมพ์แล้ว ต้องล้างทิ้ง
      setPatient(null)
      setError('')
      resetForm()
      lastLookup.current = ''
      return
    }
    // ครบ 9 หลักแล้วดึงให้เลย ไม่ต้องกดปุ่ม
    void lookup(digits)
  }

  const patch = (next: Partial<DueHistory>) => setHistory(prev => ({ ...prev, ...next }))

  /** น้ำหนักที่ดึงมาเก่าเกินไปจนไม่ควรเชื่อ — ใช้เตือนข้างช่องน้ำหนัก */
  const staleWeight =
    patient?.weight?.date != null &&
    dayjs().diff(dayjs(patient.weight.date), 'day') > STALE_WEIGHT_DAYS

  const addSpecimen = () =>
    setHistory(prev => ({
      ...prev,
      specimens: [
        ...prev.specimens,
        {
          id: nextSpecimenId.current++,
          specimen: '',
          cs: '',
          gs: '',
          susceptibility: '',
        },
      ],
    }))

  const editSpecimen = (id: number, next: Partial<SpecimenRow>) =>
    setHistory(prev => ({
      ...prev,
      specimens: prev.specimens.map(row => (row.id === id ? { ...row, ...next } : row)),
    }))

  /**
   * โหลดรายการยา DUE ครั้งแรกที่ต้องใช้ ไม่ใช่ตอนเปิดหน้า
   * — หน้านี้เริ่มที่ช่อง HN คนที่ยังไม่เลือกผู้ป่วยไม่ต้องดึงรายการยามารอ
   */
  const loadDueDrugs = async () => {
    if (dueDrugs.length > 0 || drugsLoading) return
    setDrugsLoading(true)
    setDrugsError('')
    try {
      const res = await apiFetch('/api/his/due/drugs')
      const json = await res.json()
      if (!res.ok || !json.success) {
        setDrugsError(json.message ?? 'ดึงรายการยาไม่สำเร็จ')
        return
      }
      setDueDrugs(json.drugs as DueDrugItem[])
    } catch {
      setDrugsError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setDrugsLoading(false)
    }
  }

  const addDrug = () => {
    void loadDueDrugs()
    setHistory(prev => ({
      ...prev,
      drugs: [
        ...prev.drugs,
        {
          id: nextDrugId.current++,
          icode: null,
          dose: '',
          startedAt: null,
          indication: null,
          indicationOther: '',
        },
      ],
    }))
  }

  const editDrug = (id: number, next: Partial<DueDrugRow>) =>
    setHistory(prev => ({
      ...prev,
      drugs: prev.drugs.map(row => (row.id === id ? { ...row, ...next } : row)),
    }))

  const removeDrug = (id: number) =>
    setHistory(prev => ({ ...prev, drugs: prev.drugs.filter(row => row.id !== id) }))

  const removeSpecimen = (id: number) =>
    setHistory(prev => ({
      ...prev,
      specimens: prev.specimens.filter(row => row.id !== id),
    }))

  /**
   * แก้ Cr หรือน้ำหนักแล้วคิด CrCl ใหม่ให้ทันที — เว้นแต่เภสัชกรพิมพ์ CrCl เองไว้แล้ว
   *
   * คำนวณตรงนี้แทนที่จะทำใน useEffect เพราะ React 19 ห้าม setState ในตัว effect
   * และการคิดตอนที่ค่าเปลี่ยนก็ตรงไปตรงมากว่า
   */
  const patchRenal = (next: Partial<DueHistory>) =>
    setHistory(prev => {
      const merged = { ...prev, ...next }
      const age = patient?.age ?? null
      const sex = patient?.sex ?? null
      const cr = num(merged.cr)
      const weightKg = num(merged.weight)

      if (!merged.crclEdited) {
        const crcl =
          cr != null && weightKg != null ? cockcroftGault({ age, sex, weightKg, cr }) : null
        merged.crcl = crcl == null ? '' : String(crcl)
      }
      // ค่าจากห้องแล็บชนะสูตรเสมอ ตราบใดที่ Cr ยังเป็นตัวเดิมที่แล็บใช้คิด
      // — พอเภสัชกรแก้ Cr เอง ค่าเดิมของแล็บก็ไม่ใช่ของ Cr ตัวนั้นแล้ว ต้องคิดใหม่
      if (!merged.egfrEdited) {
        const lab = patient?.creatinine
        if (lab?.egfr != null && lab.cr === merged.cr.trim()) {
          merged.egfr = lab.egfr
        } else {
          const egfr = cr != null ? ckdEpi2009({ age, sex, cr }) : null
          merged.egfr = egfr == null ? '' : String(egfr)
        }
      }
      return merged
    })

  /**
   * ติ๊ก "รอผล" แล้วล้างค่าไตทิ้ง — ปล่อยค่าค้างไว้ใบคำขอจะขัดแย้งกันเอง
   * (บอกว่ารอผลอยู่ แต่มีค่า Cr ติดไปด้วย) ปลดติ๊กแล้วดึงค่าจากแล็บกลับมาให้
   */
  const toggleAwaitingCreatinine = (checked: boolean) => {
    if (checked) {
      setHistory(prev => ({
        ...prev,
        awaitingCreatinine: true,
        creatinineAt: null,
        cr: '',
        egfr: '',
        egfrEdited: false,
        crcl: '',
        crclEdited: false,
      }))
      return
    }
    // ปลดติ๊กแล้วดึงค่าจากแล็บกลับมา และให้ patchRenal คิด CrCl ใหม่ให้
    const lab = patient?.creatinine
    patchRenal({
      awaitingCreatinine: false,
      creatinineAt: lab?.orderDate ? dayjs(lab.orderDate) : null,
      cr: lab?.cr ?? '',
      crclEdited: false,
      egfrEdited: false,
    })
  }

  /**
   * เติมยาต้านที่เลือกจากประวัติลงสามช่อง แล้วปิดหน้าต่าง
   * ยังแก้ต่อเองได้ทุกช่อง — ประวัติเป็นตัวตั้ง ไม่ใช่คำตอบสุดท้าย
   */
  const applyPriorAntimicrobial = (item: PriorAntimicrobial) => {
    patch({
      priorAntibiotic: item.name,
      priorStartedAt: item.firstDay ? dayjs(item.firstDay) : null,
      priorDays: item.days,
    })
    setPriorOpen(false)
  }

  /**
   * ติ๊ก "ไม่มีประวัติรับยาต้านมาก่อน" แล้วล้างช่องที่เกี่ยวข้องทิ้ง
   * ถ้าปล่อยค่าค้างไว้ ใบคำขอจะขัดแย้งกันเอง — บอกว่าไม่เคยได้ยา แต่มีชื่อยาและวันที่ติดไปด้วย
   */
  const toggleNoPrior = (checked: boolean) =>
    setHistory(prev => ({
      ...prev,
      noPriorAntibiotic: checked,
      priorAntibiotic: checked ? '' : prev.priorAntibiotic,
      priorStartedAt: checked ? null : prev.priorStartedAt,
      priorDays: checked ? null : prev.priorDays,
    }))

  return (
    <>
      <section className="mb-6">
        <Breadcrumb
          className="mb-2"
          items={[
            { title: <Link href="/home/due">DUE ขออนุมัติใช้ยา</Link> },
            { title: 'สร้างคำขอ' },
          ]}
        />
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          <AuditOutlined /> คำขอใช้ยา DUE
        </Title>
        <div className="h-px w-24 bg-linear-to-r from-violet-400/70 to-transparent" />
      </section>

      <section className="rounded-2xl border border-line bg-panel p-5 backdrop-blur">
        {/* HN กับข้อมูลผู้ป่วยอยู่แถวเดียวกัน — 12 คอลัมน์แบ่ง 3/3/2/2/2
            จอแคบกว่า xl ตกลงมาเป็น 2 คอลัมน์ แล้วเหลือ 1 คอลัมน์บนมือถือ */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-12">
          <label className="block xl:col-span-3">
            <span className="mb-1 block text-[11px] font-medium text-ink-3">HN (9 หลัก)</span>
            <Input
              autoFocus
              value={hn}
              onChange={event => onHnChange(event.target.value)}
              onPressEnter={() => void lookup(hn)}
              placeholder="000123456"
              inputMode="numeric"
              maxLength={HN_LENGTH}
              allowClear
              prefix={<SearchOutlined className="text-ink-3" />}
              suffix={
                <Text type="secondary" className="font-mono text-[11px]">
                  {hn.length}/{HN_LENGTH}
                </Text>
              }
              className="font-mono"
            />
          </label>

          {patient && (
            <>
              <ReadonlyField
                label="ชื่อ-สกุล"
                value={patient.name || '—'}
                className="xl:col-span-3"
              />
              <ReadonlyField
                label="อายุ"
                value={patient.age == null ? '—' : `${patient.age} ปี`}
                className="xl:col-span-2"
                extra={
                  <Text type="secondary" className="text-[11px]">
                    {sexLabel(patient.sex)}
                  </Text>
                }
              />
              <ReadonlyField
                label="ประเภทผู้ป่วย"
                value={patient.visitType}
                className="xl:col-span-2"
                extra={
                  patient.visitType === 'IPD' ? (
                    <Tag color={patient.admitted ? 'green' : 'default'} className="mr-0!">
                      {patient.admitted ? 'ยังนอนอยู่' : 'จำหน่ายแล้ว'}
                    </Tag>
                  ) : (
                    <Text type="secondary" className="text-[11px]">
                      {toThaiDate(patient.visitDate)}
                    </Text>
                  )
                }
              />
              {/* หอผู้ป่วยมีเฉพาะ IPD — ผู้ป่วยนอกแสดงห้องตรวจของครั้งล่าสุดแทน */}
              {patient.visitType === 'IPD' ? (
                <ReadonlyField
                  label="หอผู้ป่วย"
                  value={patient.wardName ?? '—'}
                  className="xl:col-span-2"
                  extra={
                    patient.an ? (
                      <Text type="secondary" className="font-mono text-[11px]">
                        AN {patient.an}
                      </Text>
                    ) : undefined
                  }
                />
              ) : (
                <ReadonlyField
                  label="ห้องตรวจล่าสุด"
                  value={patient.departmentName ?? '—'}
                  className="xl:col-span-2"
                />
              )}
            </>
          )}
        </div>

        {error && <Alert type="error" showIcon title={error} className="mt-4" />}

        {!patient && !error && !loading && (
          <Text type="secondary" className="mt-4 block text-xs">
            ข้อมูลผู้ป่วยจะขึ้นเองเมื่อกรอก HN ครบ 9 หลัก
          </Text>
        )}

        {loading && (
          <Text type="secondary" className="mt-4 block text-xs">
            กำลังดึงข้อมูล...
          </Text>
        )}
      </section>

      {/* ───────────── ข้อมูลประวัติ ─────────────
          ขึ้นเมื่อดึงผู้ป่วยได้แล้วเท่านั้น — เป็นข้อมูลทางคลินิกของคนไข้รายนั้น
          ถ้าให้กรอกก่อนเลือกคนไข้ จะกรอกค้างไว้แล้วผูกผิดคนได้ */}
      {patient && (
        <section className="mt-6 rounded-2xl border border-line bg-panel p-5 backdrop-blur">
          <Title level={4} style={{ color: 'var(--ink)', marginTop: 0, marginBottom: 16 }}>
            ข้อมูลประวัติ
          </Title>

          {/* แพ้ยาต้องเห็นก่อนเลือกยา ไม่ใช่ไปเจอตอนกดส่งคำขอ — ขึ้นเต็มความกว้าง
              เหนือทุกอย่างในส่วนนี้ และแสดงทุกรายการ ไม่ตัดให้เหลือแต่ที่จับคู่ได้
              เพราะตัวจับคู่จับยาที่บันทึกด้วยชื่อการค้าอย่างเดียวไม่ได้ */}
          {patient.allergies.length > 0 && (
            <Alert
              type="error"
              showIcon
              className="mb-4"
              title={`ผู้ป่วยมีประวัติแพ้ยา ${patient.allergies.length} รายการ`}
              description={
                <ul className="mt-1 space-y-0.5 text-xs leading-relaxed">
                  {patient.allergies.map(allergy => (
                    <li key={`${allergy.agent}-${allergy.reportDate}`}>
                      <b>{allergy.agent}</b>
                      {allergy.symptom && ` — ${allergy.symptom}`}
                      {allergy.seriousness && ` (${allergy.seriousness})`}
                      {allergy.reportDate && (
                        <span className="opacity-70"> · {toThaiDate(allergy.reportDate)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              }
            />
          )}

          {/* กลุ่มโรคจากรหัส ICD-10 ที่เคยวินิจฉัย — ประกอบการตอบสองคำถามแรก
              เป็นข้อมูลให้ดู ไม่ได้เลือกคำตอบให้ เพราะรหัสเก่าไม่ได้แปลว่าเป็นอยู่ตอนนี้ */}
          {patient.conditions.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              <Text type="secondary" className="text-[11px]">
                เคยวินิจฉัย
              </Text>
              {patient.conditions.map(condition => (
                <Tooltip
                  key={condition.key}
                  title={condition.codes
                    .map(code => `${code.icd10} ${code.name ?? ''}`.trim())
                    .join(' · ')}
                >
                  <Tag
                    color={CONDITION_COLORS[condition.key] ?? 'default'}
                    className="mr-0! cursor-help font-semibold"
                  >
                    {condition.label}
                    {condition.lastDate && (
                      <span className="ml-1 font-normal opacity-75">
                        {toThaiDate(condition.lastDate)}
                      </span>
                    )}
                  </Tag>
                </Tooltip>
              ))}
            </div>
          )}

          {/* ───── ค่าไต ─────
              เติมจาก lab_head/lab_order รายการ Creatinine ให้อัตโนมัติ แล้วยังแก้เองได้
              — ผลที่ห้องแล็บออกมาอาจไม่ใช่ค่าที่ใช้ตัดสินใจ เช่นเพิ่งเจาะซ้ำนอกระบบ */}
          <div className="mb-5 rounded-xl border border-lab-line bg-lab-bg p-3">
            {/* 24 ช่องเพราะห้าช่องกรอกต้องอยู่บรรทัดเดียวกันในจอกว้าง — 12 ช่องหารห้าไม่ลงตัว
                จอแคบกว่า xl ตกลงมาเรียงสองคอลัมน์ตามเดิม */}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-24">
              <LabField label="เจาะ Creatinine ล่าสุด" className="xl:col-span-6">
                <DatePicker
                  className="w-full"
                  format="DD/MM/BBBB"
                  value={history.creatinineAt}
                  onChange={value => patch({ creatinineAt: value })}
                  disabled={history.awaitingCreatinine}
                  maxDate={dayjs()}
                />
              </LabField>

              <LabField label="Cr" className="xl:col-span-4">
                <Input
                  value={history.cr}
                  onChange={event => patchRenal({ cr: event.target.value })}
                  disabled={history.awaitingCreatinine}
                  suffix={
                    <Text type="secondary" className="text-[11px]">
                      mg/dL
                    </Text>
                  }
                />
              </LabField>

              {/* น้ำหนักเป็นตัวตั้งของ CrCl จึงต้องเห็นและแก้ได้ ไม่ใช่ซ่อนไว้เบื้องหลัง */}
              <LabField label="น้ำหนัก" className="xl:col-span-6">
                <Input
                  value={history.weight}
                  onChange={event => patchRenal({ weight: event.target.value })}
                  disabled={history.awaitingCreatinine}
                  inputMode="decimal"
                  suffix={
                    <span className="text-[11px]">
                      <Text type="secondary" className="text-[11px]">
                        กก.
                      </Text>
                      {patient.weight?.date && (
                        <Tooltip
                          title={
                            staleWeight
                              ? 'น้ำหนักที่ชั่งไว้เก่ากว่า 1 ปี ควรตรวจสอบก่อนใช้คิด CrCl'
                              : undefined
                          }
                        >
                          <span
                            className={`ml-1 ${staleWeight ? 'font-semibold text-danger' : 'text-ink-3'}`}
                          >
                            · ชั่ง {toThaiDate(patient.weight.date)}
                          </span>
                        </Tooltip>
                      )}
                    </span>
                  }
                />
              </LabField>

              <LabField label="CrCl." className="xl:col-span-4">
                <Input
                  value={history.crcl}
                  onChange={event => patch({ crcl: event.target.value, crclEdited: true })}
                  disabled={history.awaitingCreatinine}
                  placeholder="ต้องมีทั้ง Cr และน้ำหนัก"
                  suffix={
                    <span className="flex items-center gap-2">
                      {history.crclEdited && (
                        <Button
                          type="link"
                          size="small"
                          className="h-auto px-0! text-[11px]!"
                          onClick={() => patchRenal({ crclEdited: false })}
                        >
                          คำนวณใหม่
                        </Button>
                      )}
                      <Text type="secondary" className="text-[11px]">
                        mL/min
                      </Text>
                    </span>
                  }
                />
              </LabField>

              <LabField label="eGFR." className="xl:col-span-4">
                <Input
                  value={history.egfr}
                  onChange={event => patch({ egfr: event.target.value, egfrEdited: true })}
                  disabled={history.awaitingCreatinine}
                  suffix={
                    <span className="flex items-center gap-2">
                      {history.egfrEdited && (
                        <Button
                          type="link"
                          size="small"
                          className="h-auto px-0! text-[11px]!"
                          onClick={() => patchRenal({ egfrEdited: false })}
                        >
                          คำนวณใหม่
                        </Button>
                      )}
                      <Text type="secondary" className="text-[11px]">
                        mL/min/1.73m²
                      </Text>
                    </span>
                  }
                />
              </LabField>

              <label className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:col-span-2 xl:col-span-24">
                <span className="flex items-center gap-2">
                  <Switch
                    checked={history.awaitingCreatinine}
                    onChange={toggleAwaitingCreatinine}
                  />
                  <span className="text-xs text-ink-2">รอผล</span>
                </span>
                {/* บอกที่มาของตัวเลขให้ชัด จะได้รู้ว่าค่าไหนมาจากแล็บ ค่าไหนพิมพ์เอง */}
                {patient.creatinine ? (
                  <Text type="secondary" className="text-[11px]">
                    ผลแล็บ {toThaiDate(patient.creatinine.orderDate)}
                    {patient.creatinine.reportDate &&
                      patient.creatinine.reportDate !== patient.creatinine.orderDate &&
                      ` (รายงาน ${toThaiDate(patient.creatinine.reportDate)})`}
                    {' · CrCl คิดด้วย Cockcroft-Gault, eGFR ด้วย CKD-EPI 2009'}
                  </Text>
                ) : (
                  <Text type="secondary" className="text-[11px]">
                    ไม่พบผล Creatinine ในระบบแล็บ
                  </Text>
                )}
              </label>
            </div>
          </div>

          {/* แบ่งครึ่ง — ซ้ายเป็นข้อบ่งชี้ที่เลือกเป็นตัวเลือก ขวาเป็นช่องกรอกอิสระ
              จอแคบกว่า lg ตกลงมาเรียงต่อกันตามเดิม */}
          <div className="grid gap-x-8 gap-y-5 lg:grid-cols-2">
            <div className="lg:col-span-1">
              <div className="mb-5">
                <span className="mb-2 block text-xs font-semibold text-ink">
                  <RequiredMark />
                  มีข้อบ่งชี้ว่ามีภาวะ Severe sepsis / septic shock
                </span>
                <Radio.Group
                  value={history.sepsis}
                  onChange={event => patch({ sepsis: event.target.value })}
                >
                  <div className="flex flex-col gap-1.5">
                    <Radio value="none">ไม่มี</Radio>
                    <Radio value="yes">
                      มี (Quick SOFA ≥2 หรือ SOS score ≥ 4 หรือ SIRS critieria 2 ใน 4 ข้อ)
                    </Radio>
                  </div>
                </Radio.Group>
              </div>

              <div className="mb-5">
                <span className="mb-2 block text-xs font-semibold text-ink">
                  <RequiredMark />
                  แหล่งที่มาของเชื้อ
                </span>
                <Radio.Group
                  value={history.infectionSource}
                  onChange={event => patch({ infectionSource: event.target.value })}
                >
                  <div className="flex flex-col gap-1.5">
                    <Radio value="community">Community Acquired Infection</Radio>
                    <Radio value="hospital">
                      <span className="leading-snug">
                        Hospital Acquired Infection (เคยนอนรักษาตัวใน รพ. 2 วัน ใน 90 วันที่ผ่านมา,
                        ได้รับยาต้านจุลชีพ / เคมีบำบัด / wound care หรือ Chronic dialtsis ภายใน 30
                        วัน อยู่ Nursing home care)
                      </span>
                    </Radio>
                  </div>
                </Radio.Group>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:col-span-1">
              <Field label="ผลการวินิจฉัยโรค" required className="sm:col-span-2">
                <Input
                  value={history.diagnosis}
                  onChange={event => patch({ diagnosis: event.target.value })}
                  placeholder="เช่น Infected bedsore"
                />
              </Field>

              <Field label="อื่น ๆ โปรดระบุ" className="sm:col-span-2">
                <TextArea
                  value={history.diagnosisOther}
                  onChange={event => patch({ diagnosisOther: event.target.value })}
                  autoSize={{ minRows: 2, maxRows: 4 }}
                />
              </Field>

              <Field label="ตำแหน่งที่ติดเชื้อ">
                <Input
                  value={history.infectionSite}
                  onChange={event => patch({ infectionSite: event.target.value })}
                />
              </Field>

              <Field label="การเก็บสิ่งส่งตรวจ">
                <Select
                  allowClear
                  className="w-full"
                  placeholder="--- เลือก ---"
                  value={history.specimen}
                  onChange={value => patch({ specimen: value ?? null })}
                  options={SPECIMEN_OPTIONS.map(item => ({
                    value: item,
                    label: item,
                  }))}
                />
              </Field>

              <Field label="เชื้อโรคที่ตรวจส่งวันที่">
                <DatePicker
                  className="w-full"
                  format="DD/MM/BBBB"
                  value={history.collectedAt}
                  onChange={value => patch({ collectedAt: value })}
                  // ส่งตรวจย้อนหลังได้ แต่ล่วงหน้าไม่ได้
                  maxDate={dayjs()}
                />
              </Field>

              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2">
                  <Switch
                    checked={history.awaitingResult}
                    onChange={checked => patch({ awaitingResult: checked })}
                  />
                  <span className="text-xs text-ink-2">สถานะรอผล</span>
                </label>
              </div>
            </div>
          </div>

          {/* ───── ตาราง Specimens ───── */}
          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-ink">สิ่งส่งตรวจและผลเพาะเชื้อ</span>
              <div className="flex items-center gap-2">
                {/* ผลเพาะเชื้อคือที่มาของข้อมูลที่จะกรอกลงตารางนี้ จึงวางปุ่มไว้ตรงนี้
                    ไม่มีใบรายงานก็ไม่ต้องขึ้นปุ่ม กดไปก็เจอรายการว่าง */}
                {patient.labCultureCount > 0 && (
                  <Button
                    size="small"
                    icon={<FileTextOutlined />}
                    onClick={() => setLabCultureOpen(true)}
                  >
                    Lab Culture ({patient.labCultureCount})
                  </Button>
                )}
                <Button size="small" icon={<PlusOutlined />} onClick={addSpecimen}>
                  Specimen
                </Button>
              </div>
            </div>

            {history.specimens.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-xs text-ink-3">
                ยังไม่มีสิ่งส่งตรวจ กดปุ่ม Specimen เพื่อเพิ่มแถว
              </div>
            ) : (
              // ตารางมี 4 ช่องกรอกต่อแถว จอแคบใส่ไม่ลง ให้เลื่อนแนวนอนแทนการบีบช่อง
              <div className="overflow-x-auto rounded-lg border border-line">
                {/* สี่ช่องกว้างเท่ากันช่องละ 24% เหลือ 4% ให้ปุ่มลบ
                    เดิม C/S ไม่ได้กำหนดความกว้างจึงกินพื้นที่ที่เหลือทั้งหมด
                    ทำให้สี่ช่องกว้างไม่เท่ากันทั้งที่ใช้กรอกข้อมูลระดับเดียวกัน */}
                <table className="w-full min-w-250 table-fixed border-collapse">
                  <thead>
                    <tr className="border-b border-line bg-accent-soft">
                      <th className="w-[24%] px-3 py-2 text-left text-[11px] font-semibold text-ink">
                        Specimens
                      </th>
                      <th className="w-[24%] px-3 py-2 text-left text-[11px] font-semibold text-ink">
                        C/S
                      </th>
                      <th className="w-[24%] px-3 py-2 text-left text-[11px] font-semibold text-ink">
                        G/S
                      </th>
                      <th className="w-[24%] px-3 py-2 text-left text-[11px] font-semibold text-ink">
                        Susceptibility
                      </th>
                      <th className="w-[4%] px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {history.specimens.map(row => (
                      <tr key={row.id} className="border-b border-line last:border-b-0">
                        <td className="px-3 py-2">
                          <Select
                            allowClear
                            className="w-full"
                            placeholder="--- เลือก ---"
                            value={row.specimen || undefined}
                            onChange={value => editSpecimen(row.id, { specimen: value ?? '' })}
                            options={SPECIMEN_OPTIONS.map(item => ({
                              value: item,
                              label: item,
                            }))}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <AutoComplete
                            allowClear
                            className="w-full"
                            placeholder="--- เลือก cs ---"
                            value={row.cs}
                            onChange={value => editSpecimen(row.id, { cs: value ?? '' })}
                            filterOption={(input, option) =>
                              String(option?.value ?? '')
                                .toLowerCase()
                                .includes(input.toLowerCase())
                            }
                            options={CS_SUGGESTIONS.map(item => ({
                              value: item,
                            }))}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            value={row.gs}
                            onChange={event => editSpecimen(row.id, { gs: event.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            value={row.susceptibility}
                            onChange={event =>
                              editSpecimen(row.id, {
                                susceptibility: event.target.value,
                              })
                            }
                          />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Button
                            danger
                            size="small"
                            icon={<DeleteOutlined />}
                            aria-label="ลบสิ่งส่งตรวจแถวนี้"
                            onClick={() => removeSpecimen(row.id)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ───── ยาต้านจุลชีพที่ได้รับมาก่อน ───── */}
          <div className="mt-6">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs font-semibold text-ink">
                <RequiredMark />
                ยาต้านจุลชีพที่ได้รับมาก่อน
              </span>
              <div className="flex items-center gap-3">
                {/* ข้อมูลมีอยู่ในฐานแล้ว ไม่ต้องให้พิมพ์เอง — ไม่มีประวัติก็ไม่ต้องขึ้นปุ่ม */}
                {patient.priorAntimicrobials.length > 0 && (
                  <Button
                    size="small"
                    icon={<HistoryOutlined />}
                    disabled={history.noPriorAntibiotic}
                    onClick={() => setPriorOpen(true)}
                  >
                    จากประวัติ ({patient.priorAntimicrobials.length})
                  </Button>
                )}
                <label className="flex items-center gap-2">
                  <Switch checked={history.noPriorAntibiotic} onChange={toggleNoPrior} />
                  <span className="text-xs text-ink-2">ไม่มีประวัติรับยาต้านมาก่อน</span>
                </label>
              </div>
            </div>

            {/* ชื่อยา วันที่ และจำนวนวันอยู่แถวเดียวกัน — ชื่อยากินครึ่งแถว
                ที่เหลือแบ่งให้วันที่กับจำนวนวันเท่า ๆ กัน จอแคบกว่า xl ตกลงมาเรียงต่อกัน */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-12">
              <Field label="ชื่อยา" className="xl:col-span-6">
                <Input
                  value={history.priorAntibiotic}
                  onChange={event => patch({ priorAntibiotic: event.target.value })}
                  disabled={history.noPriorAntibiotic}
                />
              </Field>

              <Field label="วันที่ได้รับยา" className="xl:col-span-3">
                <DatePicker
                  className="w-full"
                  format="DD/MM/BBBB"
                  value={history.priorStartedAt}
                  onChange={value => patch({ priorStartedAt: value })}
                  disabled={history.noPriorAntibiotic}
                  maxDate={dayjs()}
                />
              </Field>

              <Field label="จำนวนวันที่ได้ (วัน)" className="xl:col-span-3">
                <InputNumber
                  className="w-full"
                  min={0}
                  value={history.priorDays}
                  onChange={value => patch({ priorDays: value })}
                  disabled={history.noPriorAntibiotic}
                />
              </Field>
            </div>

            {/* ยังไม่ได้ไฟล์หรือลิงก์จริงของเอกสาร จึงยังกดไม่ได้ ไม่ผูก href มั่วไว้ก่อน */}
            <Tooltip title="ยังไม่ได้ผูกไฟล์เอกสาร">
              <Button type="link" icon={<FileTextOutlined />} disabled className="mt-2 px-0!">
                เอกสารประกอบการสั่งยาตามความเหมาะสม AntibiogramSheet2025
              </Button>
            </Tooltip>
          </div>

          {/* ───── ยาต้านจุลชีพที่ขออนุมัติ ───── */}
          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-ink">
                <RequiredMark />
                รายการยาต้านจุลชีพที่ขออนุมัติ
              </span>
              <Button size="small" icon={<PlusOutlined />} onClick={addDrug}>
                ยาต้าน
              </Button>
            </div>

            {drugsError && <Alert type="error" showIcon title={drugsError} className="mb-2" />}

            {history.drugs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-xs text-ink-3">
                ยังไม่มีรายการยา กดปุ่ม ยาต้าน เพื่อเพิ่มแถว
              </div>
            ) : (
              // 5 ช่องกรอกต่อแถว จอแคบใส่ไม่ลง ให้เลื่อนแนวนอนแทนการบีบช่อง
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full min-w-403 border-collapse">
                  <thead>
                    <tr className="border-b border-line bg-accent-soft">
                      {/* ชื่อยาในฐานยาวมาก (บางรายการ 80 ตัวอักษร) เพราะมีทั้งป้ายกำกับ
                          ชื่อสามัญ ชื่อการค้า และบริษัท จึงต้องกว้างกว่าช่องอื่นมาก */}
                      <th className="w-140 px-3 py-2 text-left text-[11px] font-semibold text-ink">
                        รายการยาต้านจุลชีพ
                      </th>
                      {/* วิธีใช้พิมพ์เต็มรูปแบบ เช่น '1 g IV drip q 8 hr in NSS 100 ml' จึงต้องกว้าง */}
                      <th className="w-64 px-3 py-2 text-left text-[11px] font-semibold text-ink">
                        ขนาดการใช้ยา
                      </th>
                      <th className="w-40 px-3 py-2 text-left text-[11px] font-semibold text-ink">
                        วันที่เริ่มยา
                      </th>
                      <th className="w-80 px-3 py-2 text-left text-[11px] font-semibold text-ink">
                        ข้อบ่งใช้
                      </th>
                      <th className="px-3 py-2 text-left text-[11px] font-semibold text-ink">
                        ข้อบ่งใช้อื่นๆ
                      </th>
                      <th className="w-14 px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {history.drugs.map(row => {
                      // เตือนตรงแถวที่เลือก ไม่ใช่รอไปเจอตอนกดส่ง
                      const chosen = dueDrugs.find(drug => drug.icode === row.icode)
                      const hits = chosen ? matchedAllergies(chosen.name, patient.allergies) : []
                      return (
                      <tr key={row.id} className="border-b border-line last:border-b-0">
                        <td className="px-3 py-2">
                          <Select
                            showSearch
                            allowClear
                            className="w-full"
                            placeholder="--- เลือกรายการยาต้านจุลชีพ ---"
                            loading={drugsLoading}
                            value={row.icode}
                            onChange={value => editDrug(row.id, { icode: value ?? null })}
                            // ให้รายการที่กางออกกว้างตามชื่อยา ไม่ต้องเท่าความกว้างช่อง
                            // ตอนเลือกจะได้เห็นชื่อเต็มก่อนกด ไม่ใช่เห็นแค่ท่อนหน้าที่เหมือนกันหมด
                            popupMatchSelectWidth={false}
                            // ชื่อยาในฐานยาวและมีป้ายกำกับเยอะ ต้องค้นจากทั้งชื่อ
                            // ไม่ใช่จากตัวขึ้นต้น ไม่งั้นพิมพ์ชื่อสามัญแล้วหาไม่เจอ
                            filterOption={(input, option) =>
                              String(option?.label ?? '')
                                .toLowerCase()
                                .includes(input.toLowerCase())
                            }
                            options={dueDrugs.map(drug => {
                              const label = drug.strength
                                ? `${drug.name} · ${drug.strength}`
                                : drug.name
                              // title ไว้ให้ชี้ค้างแล้วเห็นชื่อเต็ม เผื่อช่องยังแคบไปบนจอเล็ก
                              return { value: drug.icode, label, title: label }
                            })}
                          />
                          {hits.length > 0 && (
                            <div className="mt-1 flex items-start gap-1 text-[11px] font-semibold text-danger">
                              <WarningOutlined className="mt-0.5 shrink-0" />
                              <span>ตรงกับประวัติแพ้ยา: {hits.join(', ')}</span>
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            value={row.dose}
                            onChange={event => editDrug(row.id, { dose: event.target.value })}
                            placeholder="เช่น 1 g q 8 hr"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <DatePicker
                            className="w-full"
                            format="DD/MM/BBBB"
                            value={row.startedAt}
                            onChange={value => editDrug(row.id, { startedAt: value })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Select
                            allowClear
                            className="w-full"
                            placeholder="--- เลือก ---"
                            value={row.indication}
                            onChange={value => editDrug(row.id, { indication: value ?? null })}
                            popupMatchSelectWidth={false}
                            options={INDICATION_OPTIONS.map(item => ({
                              value: item,
                              label: item,
                              title: item,
                            }))}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            value={row.indicationOther}
                            onChange={event =>
                              editDrug(row.id, { indicationOther: event.target.value })
                            }
                          />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Button
                            danger
                            type="text"
                            icon={<DeleteOutlined />}
                            aria-label="ลบรายการยาแถวนี้"
                            onClick={() => removeDrug(row.id)}
                          />
                        </td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ผู้ช่วยสรุปข้อมูล — ขึ้นหลังได้ผู้ป่วยแล้ว และหายไปทั้งก้อนถ้าเครื่องนี้
          ไม่ได้ตั้งค่าโมเดลไว้ใน .env */}
      {patient && (
        <AssistPanel
          hn={patient.hn}
          drugName={
            history.drugs
              .map(row => dueDrugs.find(drug => drug.icode === row.icode)?.name)
              .filter(Boolean)
              .join(', ') || null
          }
        />
      )}

      {/* ส่วนส่งคำขอยังไม่ได้ทำ — รอตกลงเรื่องที่เก็บข้อมูลและสิทธิ์ผู้ใช้ก่อน */}
      <section className="mt-6">
        <Button type="primary" disabled>
          ส่งคำขอ (ยังไม่เปิดใช้งาน)
        </Button>
        <Text type="secondary" className="mt-2 block text-[11px]">
          ค่าที่กรอกทั้งหมดยังอยู่ในหน้าจอเท่านั้น ปิดหน้าแล้วหาย —
          ยังไม่มีที่เก็บข้อมูลฝั่งเซิร์ฟเวอร์
        </Text>
      </section>

      {/* ───── เลือกยาต้านที่เคยได้รับจากประวัติ ───── */}
      <Modal
        open={priorOpen}
        onCancel={() => setPriorOpen(false)}
        footer={null}
        // ชื่อยาในฐานยาวถึง 80 ตัวอักษร ความกว้างคงที่แคบเกินไปบนจอใหญ่
        // ผูกกับความกว้างจอแทน แล้วตั้งเพดานกันยืดเกินจนอ่านข้ามคอลัมน์ไม่ทัน
        width="92vw"
        style={{ maxWidth: 1400, top: 24 }}
        title="ยาต้านจุลชีพที่เคยได้รับ (ย้อนหลัง 1 ปี)"
      >
        <Text type="secondary" className="mb-3 block text-xs leading-relaxed">
          นับจากรายการจ่ายยาจริง ไม่ใช่คำสั่งที่สั่งไว้ · จำนวนวันนับจากวันที่มีการจ่าย
          ไม่ใช่ผลต่างของวันแรกกับวันสุดท้าย เพราะการให้ยาอาจไม่ต่อเนื่องกัน
        </Text>
        <div className="max-h-[calc(100vh-220px)] overflow-auto rounded-lg border border-line">
          <table className="w-full border-collapse">
            <thead className="sticky top-0">
              <tr className="border-b border-line bg-elevated">
                <th className="px-3 py-2 text-left text-[11px] font-semibold text-ink">ชื่อยา</th>
                <th className="w-28 px-3 py-2 text-left text-[11px] font-semibold text-ink">
                  วันแรก
                </th>
                <th className="w-28 px-3 py-2 text-left text-[11px] font-semibold text-ink">
                  วันล่าสุด
                </th>
                <th className="w-20 px-3 py-2 text-right text-[11px] font-semibold text-ink">
                  จำนวนวัน
                </th>
                <th className="w-20 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {patient?.priorAntimicrobials.map(item => (
                <tr key={item.icode} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-2 text-xs">
                    {item.name}
                    {item.inpatient && (
                      <Tag className="ml-1.5 mr-0!" color="blue">
                        IPD
                      </Tag>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">{toThaiDate(item.firstDay)}</td>
                  <td className="px-3 py-2 text-xs">{toThaiDate(item.lastDay)}</td>
                  <td className="px-3 py-2 text-right text-xs font-semibold">{item.days}</td>
                  <td className="px-3 py-2 text-right">
                    <Button size="small" type="link" onClick={() => applyPriorAntimicrobial(item)}>
                      เลือก
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>

      <LabCultureModal
        open={labCultureOpen}
        onClose={() => setLabCultureOpen(false)}
        hn={patient?.hn ?? null}
        patientName={patient?.name}
      />
    </>
  )
}
