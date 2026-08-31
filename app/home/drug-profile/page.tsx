'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ยังทำที่ app/home/layout.tsx ซึ่งเป็น Server Component)
import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  Alert,
  Button,
  Checkbox,
  Descriptions,
  Empty,
  Image,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  ExperimentOutlined,
  FileImageOutlined,
  LeftOutlined,
  MedicineBoxOutlined,
  PrinterOutlined,
  ProfileOutlined,
  RightOutlined,
  SearchOutlined,
  SwapOutlined,
  UndoOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { apiFetch } from '@/lib/client/session'
import { useSessionUser } from '../app-shell'
import { UsageSelect } from '../usage-select'
import type { ReconcilePrintData } from '../medication-history/reconcile-pdf'
import type { OpdScanItem } from '@/lib/his/opd-scan'
import LabCultureModal from '../lab-culture-modal'
import type {
  AdmissionMatch,
  AdmittedPatient,
  DrugPlan,
  DrugPlanItem,
  WardOption,
} from '@/lib/his/drug-profile'

const { Paragraph, Text, Title } = Typography

/**
 * ตัวแสดง PDF ของ @react-pdf/renderer ทำงานได้เฉพาะในเบราว์เซอร์ (ใช้ canvas/worker)
 * โหลดเมื่อกดพิมพ์เท่านั้น ไม่ถ่วงการเปิดหน้าของคนที่เข้ามาดูเฉย ๆ
 */
const ReconcilePdfViewer = dynamic(() => import('../medication-history/reconcile-pdf-viewer'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center gap-3">
      <Spin />
      <span className="text-xs text-ink-3">กำลังสร้างเอกสาร...</span>
    </div>
  ),
})

/** จำนวนวันที่แสดงต่อหนึ่งหน้าจอ */
const WINDOW = 15

/** แปลง 'YYYY-MM-DD' เป็น วว/ดด/ปปปป พ.ศ. */
function toThaiDate(value: string | null): string {
  if (!value) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return value
  const [, year, month, day] = match
  return `${day}/${month}/${Number(year) + 543}`
}

/** หัวคอลัมน์วัน — เอาแค่ วว/ดด ให้พอดีช่องแคบ ๆ */
function toShortDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  return match ? `${match[3]}/${match[2]}` : value
}

/** รหัสเพศของ HIS: 1 = ชาย, 2 = หญิง นอกนั้นไม่ระบุ */
function sexLabel(sex: string | null): string {
  if (sex === '1') return 'ชาย'
  if (sex === '2') return 'หญิง'
  return '—'
}

type Mode = 'ward' | 'search'

const mono = (value: string) => <span className="font-mono text-xs">{value}</span>

/**
 * ป้ายที่เภสัชกรติดไว้ในชื่อยาของ s_drugitems เอง — ไม่มีตารางแยก ต้องอ่านจากชื่อ
 *   [HAD] = High Alert Drug ยาความเสี่ยงสูง
 *   [DUE] = Drug Use Evaluation ยาที่ต้องขออนุมัติ/ติดตามการใช้
 *
 * ป้ายไม่ได้อยู่ลำพังในวงเล็บเสมอไป ของจริงในคลังมี [IPD, HAD] [เบิกได้,DUE] [สปสช,DUE]
 * ปนอยู่ด้วย จึงต้องแยกเนื้อในวงเล็บด้วยจุลภาคแล้วเทียบทีละคำ
 *
 * และห้ามค้นทั้งชื่อแบบ substring เด็ดขาด เพราะจะไปโดนชื่อยาจริง —
 * Met[HAD]one, Ca[DUE]T, ALP[HAD]3, S[HAD]E SELECTION ล้วนมีตัวอักษรชุดนี้อยู่ในชื่อ
 */
function bracketTokens(name: string): string[] {
  const tokens: string[] = []
  for (const group of name.matchAll(/\[([^\]]*)\]/g)) {
    for (const part of group[1].split(',')) tokens.push(part.trim().toUpperCase())
  }
  return tokens
}

/**
 * (ง) นำหน้าชื่อยา = ยาบัญชี ง ของบัญชียาหลักแห่งชาติ ต้องมีข้อบ่งใช้กำกับ
 * ยาที่ถูกสั่งจริงใน 3 เดือนติดป้ายนี้ 51 จาก 752 รายการ
 * (Meropenem, TAZOCIN, KEPPRA, Clopidogrel, Midazolam ฯลฯ)
 */
const isNlemG = (name: string) => /\(\s*ง\s*\)/.test(name)

/**
 * [MFG.อายุ N วัน] = ยาที่ห้องยาผสมเอง มีอายุหลังผสมสั้น ๆ
 * คืนจำนวนวัน หรือ null ถ้าไม่ใช่ยาผสม — ของจริงมี 7, 14, 30 วัน
 */
function prepShelfLife(name: string): number | null {
  const found = /MFG\.\s*อายุ\s*(\d+)\s*วัน/.exec(name)
  return found ? Number(found[1]) : null
}

/** จำนวนวันระหว่างสองวันที่รูปแบบ 'YYYY-MM-DD' */
function daysApart(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  )
}

/**
 * ชื่อยาตรงกับประวัติแพ้ยาของผู้ป่วยหรือไม่
 *
 * agent ใน opd_allergy เก็บเป็นชื่อสามัญตัวพิมพ์ใหญ่ (TRAMADOL, PHENYTOIN,
 * SULFAMETHOXAZOLE+TRIMETHOPRIM) จึงเทียบกับชื่อยาที่ทำให้เป็นตัวพิมพ์ใหญ่ได้ตรง ๆ
 * ตัวที่มีเครื่องหมาย + ถือเป็นยาผสม แยกเทียบทีละตัว
 *
 * ตัดคำที่สั้นกว่า 5 ตัวอักษรทิ้ง กันไม่ให้คำสั้น ๆ ไปโผล่กลางชื่อยาอื่นจนเตือนมั่ว
 *
 * เป็นการตรวจ "เบื้องต้นจากชื่อ" เท่านั้น ยาที่ระบบตั้งชื่อด้วยชื่อการค้าล้วน
 * จะจับไม่ได้ จึงห้ามใช้แทนการอ่านรายการแพ้ยาเต็ม ๆ ที่แสดงไว้ด้านบน
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

const isHad = (name: string) => bracketTokens(name).includes('HAD')
const isDue = (name: string) => bracketTokens(name).includes('DUE')

/**
 * ตัดวงเล็บที่มีแต่คำว่า HAD หรือ DUE ล้วน ๆ ออก เพราะแปลงเป็น Tag ไปแล้ว
 * วงเล็บที่มีข้อมูลอื่นปนอย่าง [IPD, HAD] คงไว้ทั้งก้อน — ตัดแล้วจะเสีย [IPD] ไปด้วย
 */
function cleanDrugName(name: string): string {
  return name
    .replace(/\[\s*(HAD|DUE)\s*\]/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export default function DrugProfilePage() {
  // ผู้ที่กำลังใช้งาน — ใช้กำกับท้ายใบพิมพ์ว่าใครเป็นคนพิมพ์ออกมา
  const sessionUser = useSessionUser()
  const [mode, setMode] = useState<Mode>('ward')
  const [error, setError] = useState<string | null>(null)
  /**
   * ส่วนเลือกผู้ป่วยเปิดอยู่หรือไม่ — พอเลือกได้แล้วจะพับเก็บ
   * รายชื่อในตึกหนึ่งมีได้ถึง 48 ราย ถ้าคาไว้ ตารางยาจะถูกดันตกจอไปทั้งหมด
   */
  const [pickerOpen, setPickerOpen] = useState(true)
  const planRef = useRef<HTMLElement>(null)

  // ── โหมดเลือกตึก ──
  const [wards, setWards] = useState<WardOption[]>([])
  // เริ่มที่ true เลย — effect ด้านล่างยิงทันทีที่หน้าเปิด ถ้าตั้งค่าใน effect
  // จะเป็นการ setState ตรง ๆ ใน effect body ซึ่งทำให้เกิด render ซ้อน
  const [wardsLoading, setWardsLoading] = useState(true)
  const [ward, setWard] = useState<string | null>(null)
  const [patients, setPatients] = useState<AdmittedPatient[]>([])
  const [patientsLoading, setPatientsLoading] = useState(false)

  // ── โหมดค้นหา ──
  const [term, setTerm] = useState('')
  const [matches, setMatches] = useState<AdmissionMatch[]>([])
  const [searched, setSearched] = useState(false)
  const [searching, setSearching] = useState(false)

  // ── แผนการใช้ยาของ AN ที่เลือก ──
  const [plan, setPlan] = useState<DrugPlan | null>(null)
  const [planLoading, setPlanLoading] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)
  const [drugsOnly, setDrugsOnly] = useState(true)
  /** คำค้นในตารางยา — AN ที่ยาวที่สุดมีถึง 328 รายการ ไล่ด้วยตาไม่ไหว */
  const [planFilter, setPlanFilter] = useState('')
  /** ตำแหน่งวันสุดท้ายของกรอบที่กำลังดู (index ใน plan.days) */
  const [windowEnd, setWindowEnd] = useState(0)

  // ── โหมดเลือกยาเพื่อพิมพ์ใบยา ──
  const [selectOpen, setSelectOpen] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  /** ยาที่ติ๊กไว้ว่าจะเอาลงใบพิมพ์ เก็บตาม med_plan_number */
  const [picked, setPicked] = useState<number[]>([])
  /**
   * จำนวนกับวิธีใช้ที่ผู้ใช้แก้เอง เก็บตาม med_plan_number
   * เป็นค่าที่อยู่บนกระดาษเท่านั้น ไม่ได้เขียนกลับเข้า HIS
   */
  const [edits, setEdits] = useState<Record<number, { qty: string; usage: string }>>({})

  // ── ภาพสแกนเวชระเบียน (opdscan อยู่คนละเครื่องกับฐาน HIS) ──
  const [scanOpen, setScanOpen] = useState(false)
  const [scans, setScans] = useState<OpdScanItem[]>([])
  const [scanLoading, setScanLoading] = useState(false)
  const [scanError, setScanError] = useState('')
  const [scanVn, setScanVn] = useState<string | null>(null)

  // ── ผลแล็บ / เพาะเชื้อ — ตัวลิ้นชักอยู่ในคอมโพเนนต์ร่วม จัดการสถานะของตัวเอง ──
  const [labOpen, setLabOpen] = useState(false)

  // โหลดรายชื่อตึกครั้งเดียวตอนเปิดหน้า — จำนวนคนไข้ต่อตึกอยู่ในรายการเลย
  // จะได้รู้ว่าตึกไหนมีคนอยู่ก่อนกดเลือก
  useEffect(() => {
    let cancelled = false
    apiFetch('/api/his/drug-profile/wards')
      .then(res => res.json())
      .then((json: { success: boolean; message?: string; wards?: WardOption[] }) => {
        if (cancelled) return
        if (!json.success) {
          setError(json.message ?? 'ดึงรายชื่อตึกไม่สำเร็จ')
          return
        }
        setWards(json.wards ?? [])
      })
      .catch(() => {
        if (!cancelled) setError('เชื่อมต่อฐานข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
      })
      .finally(() => {
        if (!cancelled) setWardsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const loadWard = async (code: string) => {
    setWard(code)
    setError(null)
    setPatientsLoading(true)
    setPatients([])
    try {
      const res = await apiFetch(`/api/his/drug-profile/admitted?ward=${encodeURIComponent(code)}`)
      const json: { success: boolean; message?: string; patients?: AdmittedPatient[] } =
        await res.json()
      if (!json.success) {
        setError(json.message ?? 'ดึงรายชื่อผู้ป่วยไม่สำเร็จ')
        return
      }
      setPatients(json.patients ?? [])
    } catch {
      setError('เชื่อมต่อฐานข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setPatientsLoading(false)
    }
  }

  const search = async () => {
    const keyword = term.trim()
    if (!keyword) return
    setError(null)
    setSearching(true)
    setMatches([])
    try {
      const res = await apiFetch(`/api/his/drug-profile/search?q=${encodeURIComponent(keyword)}`)
      const json: { success: boolean; message?: string; matches?: AdmissionMatch[] } =
        await res.json()
      setSearched(true)
      if (!json.success) {
        setError(json.message ?? 'ค้นหาไม่สำเร็จ')
        return
      }
      setMatches(json.matches ?? [])
    } catch {
      setError('เชื่อมต่อฐานข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setSearching(false)
    }
  }

  /**
   * เลือก AN แล้วโหลดแผนการใช้ยาทันที
   * โหลดครั้งเดียวได้ทุกวันของการนอนครั้งนี้ — การเลื่อนดูวันย้อนหลังจึงไม่ต้องยิง API ซ้ำ
   */
  const pick = async (an: string) => {
    setPlanError(null)
    setPlanLoading(true)
    setPlan(null)
    try {
      const res = await apiFetch(`/api/his/drug-profile/plan?an=${encodeURIComponent(an)}`)
      const json: { success: boolean; message?: string; plan?: DrugPlan } = await res.json()
      if (!json.success || !json.plan) {
        setPlanError(json.message ?? 'ดึงแผนการใช้ยาไม่สำเร็จ')
        return
      }
      setPlan(json.plan)
      // เปิดมาให้เห็นวันล่าสุดก่อน แล้วค่อยเลื่อนย้อนกลับไปวันแรกเอง
      setWindowEnd(Math.max(0, json.plan.days.length - 1))
      setPickerOpen(false)
    } catch {
      setPlanError('เชื่อมต่อฐานข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setPlanLoading(false)
    }
  }

  /** กลับไปเลือกผู้ป่วยรายอื่น — คลี่ส่วนเลือกกลับมาและทิ้งตารางยาของคนเดิม */
  const reopenPicker = () => {
    setPlan(null)
    setPlanError(null)
    setPickerOpen(true)
  }

  /** โหลดรายการภาพสแกนตอนกดเปิด — ตารางเก็บภาพเป็น longblob ไม่ดึงมาพร้อมแผนยา */
  const openScans = async (patientHn: string) => {
    setScanOpen(true)
    setScanLoading(true)
    setScanError('')
    setScans([])
    setScanVn(null)
    try {
      const res = await apiFetch(`/api/his/opd-scan?hn=${patientHn}`)
      const json = await res.json()
      if (!res.ok || !json.success) {
        setScanError(json.message ?? 'ดึงรายการภาพสแกนไม่สำเร็จ')
        return
      }
      setScans(json.items as OpdScanItem[])
    } catch {
      setScanError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setScanLoading(false)
    }
  }

  /** จำนวนภาพต่อครั้งที่มารับบริการ ใช้ทำตัวกรองในลิ้นชักภาพ */
  const scanVnCount = new Map<string, number>()
  for (const scan of scans) {
    const key = scan.vn ?? ''
    if (key) scanVnCount.set(key, (scanVnCount.get(key) ?? 0) + 1)
  }
  const visibleScans = scanVn ? scans.filter(scan => scan.vn === scanVn) : scans

  // เลื่อนจอลงมาที่ตารางยาเมื่อได้ผู้ป่วยคนใหม่ — ส่วนเลือกเพิ่งพับไป
  // ถ้าไม่เลื่อนให้ ผู้ใช้จะเห็นแค่จอเปล่า ๆ แล้วนึกว่ากดไม่ติด
  const selectedAn = plan?.admission?.an ?? null
  useEffect(() => {
    if (!selectedAn) return
    planRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [selectedAn])

  const items = useMemo(
    () => (plan?.items ?? []).filter(item => !drugsOnly || item.itemType === '1'),
    [plan, drugsOnly],
  )

  /**
   * ข้อควรระวังของยาแต่ละรายการ คำนวณครั้งเดียวแล้วใช้ทั้งตารางหลักและโหมดเลือกยา
   * เก็บตาม med_plan_number เพื่อไม่ต้องไล่ regex ใหม่ทุกครั้งที่ re-render
   */
  const warnings = useMemo(() => {
    const allergies = plan?.allergies ?? []
    const today = new Date().toISOString().slice(0, 10)
    const map = new Map<
      number,
      { allergy: string[]; nlemG: boolean; prepDays: number | null; prepExpired: boolean }
    >()
    for (const item of plan?.items ?? []) {
      const prepDays = prepShelfLife(item.name)
      map.set(item.planNumber, {
        allergy: matchedAllergies(item.name, allergies),
        nlemG: isNlemG(item.name),
        prepDays,
        // เตือนเฉพาะคำสั่งที่ยังไม่หยุด และเริ่มมานานกว่าอายุยาที่ผสมไว้
        prepExpired:
          prepDays != null && item.ongoing && daysApart(item.startDate, today) > prepDays,
      })
    }
    return map
  }, [plan])

  /** จำนวนรายการที่ชื่อยาตรงกับประวัติแพ้ — ใช้ขึ้นเตือนรวมบนแถบแพ้ยา */
  const allergyHits = useMemo(
    () => items.filter(item => (warnings.get(item.planNumber)?.allergy.length ?? 0) > 0),
    [items, warnings],
  )

  /**
   * รายการที่ตารางบนหน้าจอแสดงจริง = items + คำค้น
   * แยกจาก items เพราะโหมดเลือกยายังต้องเห็นครบทุกตัว ไม่ให้คำค้นที่ค้างอยู่
   * ไปตัดยาหายจากใบพิมพ์โดยที่ผู้ใช้ไม่รู้ตัว
   */
  const visibleItems = useMemo(() => {
    const keyword = planFilter.trim().toLowerCase()
    if (!keyword) return items
    return items.filter(item =>
      [item.name, item.usage, item.usageShort, item.usageCode, item.note, item.doctorName, item.intervalName]
        .filter(Boolean)
        .some(field => (field as string).toLowerCase().includes(keyword)),
    )
  }, [items, planFilter])

  /**
   * เปิดโหมดเลือกยา — ตั้งค่าเริ่มต้นให้ติ๊กเฉพาะยาที่ยังให้อยู่
   * เพราะใบยาที่พิมพ์ออกไปคือ "ยาที่ผู้ป่วยกำลังได้รับ" ยาที่หยุดไปแล้วยังติ๊กเพิ่มเองได้
   */
  const openSelect = () => {
    setPicked(items.filter(item => item.ongoing).map(item => item.planNumber))
    setEdits({})
    setSelectOpen(true)
  }

  /** ค่าที่กำลังแสดงในช่องกรอก = ค่าที่แก้ไว้ ถ้ายังไม่แก้ก็เป็นค่าจากคำสั่งใช้ยา */
  const valueOf = (item: DrugPlanItem) =>
    edits[item.planNumber] ?? {
      qty: item.qty == null || item.qty === 0 ? '' : String(item.qty),
      // ค่าตั้งต้นเป็นวิธีใช้เต็ม เพราะนั่นคือข้อความที่จะไปอยู่บนใบยา
      usage: item.usage ?? '',
    }

  const editItem = (item: DrugPlanItem, patch: Partial<{ qty: string; usage: string }>) =>
    setEdits(prev => ({ ...prev, [item.planNumber]: { ...valueOf(item), ...patch } }))

  const pickedItems = items.filter(item => picked.includes(item.planNumber))

  /** ข้อมูลที่ส่งให้เอกสาร PDF — ประกอบตอนกดพิมพ์เท่านั้น */
  const buildPrintData = (): ReconcilePrintData | null => {
    const info = plan?.admission
    if (!info) return null
    return {
      hn: info.hn,
      name: info.name,
      age: info.age == null ? '—' : `${info.age} ปี`,
      an: info.an,
      // ใบของผู้ป่วยนอกนับเป็น "ย้อนหลัง N เดือน" ส่วนใบนี้ผูกกับการนอนครั้งเดียว
      periodLabel: `รับไว้ ${toThaiDate(info.admitDate)} ถึง ${
        info.admitted ? 'ปัจจุบัน' : toThaiDate(info.dischargeDate)
      }`,
      allergies: (plan?.allergies ?? []).map(item => item.agent),
      items: pickedItems.map(item => {
        const edited = valueOf(item)
        const original = {
          qty: item.qty == null || item.qty === 0 ? '' : String(item.qty),
          usage: item.usage ?? '',
        }
        return {
          drugName: item.name || item.icode,
          qty: edited.qty,
          usage: edited.usage,
          // แก้วิธีใช้ไปแล้วรหัสเดิมไม่ตรงกับข้อความอีก จึงไม่พิมพ์รหัสกำกับ
          usageCode: edited.usage === original.usage ? item.usageCode : null,
          date: toThaiDate(item.startDate),
          label: item.ongoing
            ? `${item.statusName ?? 'Continue'} · ยังให้อยู่`
            : `${item.statusName ?? 'Continue'} · หยุด ${toThaiDate(item.offDate)}`,
          edited: edited.qty !== original.qty || edited.usage !== original.usage,
        }
      }),
      printedAt: new Date().toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }),
      printedBy: sessionUser?.fullName || sessionUser?.username || '—',
    }
  }

  const selectColumns: ColumnsType<DrugPlanItem> = [
    {
      title: 'รายการยา',
      key: 'name',
      width: 300,
      render: (_: unknown, item) => (
        <div className="leading-snug">
          <div className="text-xs font-semibold">{cleanDrugName(item.name) || item.icode}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px]">
            {(warnings.get(item.planNumber)?.allergy.length ?? 0) > 0 && (
              <Tag color="red" icon={<WarningOutlined />}>
                แพ้ยา
              </Tag>
            )}
            {isHad(item.name) && <Tag color="red">HAD</Tag>}
            {isDue(item.name) && <Tag color="volcano">DUE</Tag>}
            {isNlemG(item.name) && <Tag color="gold">บัญชี ง</Tag>}
            {item.ongoing ? <Tag color="green">ให้อยู่</Tag> : <Tag>หยุดแล้ว</Tag>}
            <Text type="secondary" className="text-[11px]">
              สั่ง {toThaiDate(item.startDate)}
            </Text>
          </div>
        </div>
      ),
    },
    {
      title: 'จำนวน',
      key: 'qty',
      width: 130,
      render: (_: unknown, item) => (
        <InputNumber
          size="small"
          min={0}
          className="w-full"
          value={valueOf(item).qty === '' ? null : Number(valueOf(item).qty)}
          onChange={value => editItem(item, { qty: value == null ? '' : String(value) })}
        />
      ),
    },
    {
      title: 'วิธีใช้',
      key: 'usage',
      render: (_: unknown, item) => (
        <div className="leading-snug">
          <UsageSelect value={valueOf(item).usage} onChange={usage => editItem(item, { usage })} />
          {valueOf(item).usage !== (item.usage ?? '') && (
            <Text type="secondary" className="text-[11px]">
              เดิม {item.usage || '— ไม่ได้ระบุ —'}
            </Text>
          )}
        </div>
      ),
    },
    {
      title: '',
      key: 'reset',
      width: 90,
      align: 'center',
      render: (_: unknown, item) =>
        edits[item.planNumber] ? (
          <Button
            type="text"
            size="small"
            icon={<UndoOutlined />}
            onClick={() =>
              setEdits(prev => {
                const next = { ...prev }
                delete next[item.planNumber]
                return next
              })
            }
          >
            <span className="text-[11px]">คืนค่า</span>
          </Button>
        ) : null,
    },
  ]

  /** 15 วันที่กำลังแสดง (หรือน้อยกว่าถ้าการนอนสั้นกว่านั้น) */
  const shownDays = useMemo(() => {
    const days = plan?.days ?? []
    if (days.length === 0) return []
    const end = Math.min(windowEnd, days.length - 1)
    return days.slice(Math.max(0, end - WINDOW + 1), end + 1)
  }, [plan, windowEnd])

  const totalDays = plan?.days.length ?? 0
  const canGoBack = windowEnd > WINDOW - 1
  const canGoForward = windowEnd < totalDays - 1

  const dayColumns: ColumnsType<DrugPlanItem> = shownDays.map((day, index) => ({
    title: (
      <div className="text-center leading-tight">
        <div className="font-mono text-xs">{toShortDate(day)}</div>
        <div className="text-[10px] text-ink-3">
          วันที่ {plan ? plan.days.indexOf(day) + 1 : index + 1}
        </div>
      </div>
    ),
    key: day,
    width: 58,
    align: 'center' as const,
    render: (_: unknown, item: DrugPlanItem) => {
      if (day < item.startDate || day > item.endDate) return null
      const stat = item.status === 'S'
      return (
        <Tooltip title={`${item.name}${item.usage ? ` — ${item.usage}` : ''}`}>
          <span
            className={
              stat
                ? 'inline-block min-w-6 rounded bg-(--plan-stat-bg) px-1 py-0.5 text-xs font-semibold text-(--plan-stat-ink)'
                : 'inline-block min-w-6 rounded bg-(--plan-cont-bg) px-1 py-0.5 text-xs font-semibold text-(--plan-cont-ink)'
            }
          >
            {item.qty && item.qty > 0 ? item.qty : '●'}
          </span>
        </Tooltip>
      )
    },
  }))

  const planColumns: ColumnsType<DrugPlanItem> = [
    {
      title: 'รายการ',
      key: 'name',
      width: 300,
      fixed: 'left',
      render: (_: unknown, item) => (
        <div className="min-w-0">
          <div className="text-xs font-medium text-ink">
            {cleanDrugName(item.name) || item.icode}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-ink-3">
            {(warnings.get(item.planNumber)?.allergy.length ?? 0) > 0 && (
              <Tooltip
                title={`ผู้ป่วยมีประวัติแพ้ ${warnings
                  .get(item.planNumber)
                  ?.allergy.join(', ')} — ตรวจจากชื่อยา ต้องยืนยันกับเภสัชกรก่อน`}
              >
                <Tag color="red" icon={<WarningOutlined />}>
                  ตรงกับประวัติแพ้ยา
                </Tag>
              </Tooltip>
            )}
            {isHad(item.name) && (
              <Tooltip title="High Alert Drug — ยาความเสี่ยงสูง">
                <Tag color="red">HAD</Tag>
              </Tooltip>
            )}
            {isDue(item.name) && (
              <Tooltip title="Drug Use Evaluation — ยาที่ต้องขออนุมัติและติดตามการใช้">
                <Tag color="volcano">DUE</Tag>
              </Tooltip>
            )}
            {isNlemG(item.name) && (
              <Tooltip title="ยาบัญชี ง ของบัญชียาหลักแห่งชาติ — ต้องมีข้อบ่งใช้กำกับ">
                <Tag color="gold">บัญชี ง</Tag>
              </Tooltip>
            )}
            {warnings.get(item.planNumber)?.prepDays != null && (
              <Tooltip
                title={
                  warnings.get(item.planNumber)?.prepExpired
                    ? `ยาผสมเอง อายุ ${warnings.get(item.planNumber)?.prepDays} วัน แต่คำสั่งนี้เริ่มมานานกว่านั้นแล้ว — ตรวจว่าห้องยาผสมใหม่หรือยัง`
                    : `ยาผสมเอง อายุหลังผสม ${warnings.get(item.planNumber)?.prepDays} วัน`
                }
              >
                <Tag color={warnings.get(item.planNumber)?.prepExpired ? 'red' : 'blue'}>
                  ผสมเอง {warnings.get(item.planNumber)?.prepDays} วัน
                </Tag>
              </Tooltip>
            )}
            {item.ongoing && <Tag color="green">ให้อยู่</Tag>}
            {item.status === 'S' ? (
              <Tag color="orange">STAT</Tag>
            ) : (
              <Tag color="purple">{item.statusName ?? 'Continue'}</Tag>
            )}
            {item.intervalName && <span>· {item.intervalName}</span>}
            {item.note && <span>· {item.note}</span>}
          </div>

          {/* วิธีใช้เต็ม — ของเดิมแสดงแต่ shortlist ซึ่งเป็นรหัสย่อ อ่านแล้วต้องแปลอีกที */}
          {item.usage ? (
            <div className="mt-1 text-[11px] leading-snug text-ink-2">
              {item.usageCode && <span className="font-mono opacity-70">{item.usageCode} · </span>}
              {item.usage}
              {item.usageTyped && (
                <Tooltip title="แพทย์พิมพ์ข้อความสั่งเอง ไม่ได้เลือกจากรายการวิธีใช้มาตรฐาน (sp_use)">
                  <Tag color="blue" className="ml-1.5">
                    แพทย์พิมพ์เอง
                  </Tag>
                </Tooltip>
              )}
            </div>
          ) : (
            <div className="mt-1 text-[11px] text-ink-3">— ไม่มีข้อมูลวิธีใช้ —</div>
          )}
        </div>
      ),
    },
    {
      title: 'ช่วงที่ให้',
      key: 'range',
      width: 150,
      render: (_: unknown, item) => (
        <div className="text-[11px] leading-tight">
          <div className="font-mono">{toThaiDate(item.startDate)}</div>
          <div className="text-ink-3">
            {item.ongoing ? 'ยังให้อยู่' : `หยุด ${toThaiDate(item.offDate)}`}
          </div>
        </div>
      ),
    },
    ...dayColumns,
    {
      title: 'แพทย์',
      dataIndex: 'doctorName',
      key: 'doctorName',
      width: 150,
      render: (value: string | null) => <span className="text-[11px]">{value ?? '—'}</span>,
    },
  ]

  const wardColumns: ColumnsType<AdmittedPatient> = [
    { title: 'AN', dataIndex: 'an', key: 'an', width: 110, render: mono },
    { title: 'HN', dataIndex: 'hn', key: 'hn', width: 110, render: mono },
    { title: 'ชื่อ-สกุล', dataIndex: 'name', key: 'name' },
    {
      title: 'อายุ',
      dataIndex: 'age',
      key: 'age',
      width: 80,
      render: (value: number | null) => (value == null ? '—' : `${value} ปี`),
    },
    {
      title: 'เพศ',
      dataIndex: 'sex',
      key: 'sex',
      width: 70,
      render: (value: string | null) => sexLabel(value),
    },
    {
      title: 'วันที่รับไว้',
      dataIndex: 'admitDate',
      key: 'admitDate',
      width: 120,
      render: (value: string | null) => mono(toThaiDate(value)),
    },
    {
      title: 'นอนแล้ว',
      dataIndex: 'los',
      key: 'los',
      width: 90,
      render: (value: number | null) => (value == null ? '—' : `${value} วัน`),
    },
    {
      title: '',
      key: 'pick',
      width: 90,
      render: (_: unknown, row) => (
        <Button size="small" type="primary" onClick={() => pick(row.an)}>
          เลือก
        </Button>
      ),
    },
  ]

  const matchColumns: ColumnsType<AdmissionMatch> = [
    { title: 'AN', dataIndex: 'an', key: 'an', width: 110, render: mono },
    { title: 'HN', dataIndex: 'hn', key: 'hn', width: 110, render: mono },
    { title: 'ชื่อ-สกุล', dataIndex: 'name', key: 'name' },
    {
      title: 'ตึก',
      dataIndex: 'wardName',
      key: 'wardName',
      width: 190,
      render: (value: string | null) => value ?? '—',
    },
    {
      title: 'รับไว้',
      dataIndex: 'admitDate',
      key: 'admitDate',
      width: 120,
      render: (value: string | null) => mono(toThaiDate(value)),
    },
    {
      title: 'จำหน่าย',
      key: 'dischargeDate',
      width: 130,
      render: (_: unknown, row) =>
        row.admitted ? <Tag color="green">ยังนอนอยู่</Tag> : mono(toThaiDate(row.dischargeDate)),
    },
    {
      title: '',
      key: 'pick',
      width: 90,
      render: (_: unknown, row) => (
        <Button size="small" type="primary" onClick={() => pick(row.an)}>
          เลือก
        </Button>
      ),
    },
  ]

  const admission = plan?.admission

  return (
    <>
      <section className="mb-6">
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          <ProfileOutlined /> Drug Profile ผู้ป่วยใน
        </Title>
        <div className="mb-4 h-px w-24 bg-linear-to-r from-violet-400/70 to-transparent" />
        <Paragraph type="secondary" style={{ maxWidth: 720, marginBottom: 0 }}>
          ตรวจสอบการให้ยาของผู้ป่วยใน — เลือกผู้ป่วยจากตึกที่นอนอยู่ตอนนี้
          หรือค้นด้วยชื่อ-สกุล HN เลขบัตรประชาชน หรือ AN แล้วเลือก AN ที่ต้องการ
          เพราะใบยาผูกกับการนอนแต่ละครั้ง ไม่ใช่ผูกกับตัวผู้ป่วย
        </Paragraph>
      </section>

      {error && <Alert type="error" showIcon title={error} className="mb-5" />}

      {/* พับเก็บเมื่อเลือกผู้ป่วยได้แล้ว — เหลือแถบสรุปให้กดกลับมาเปลี่ยนคน */}
      {!pickerOpen && admission ? (
        <section className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-panel px-4 py-2.5 backdrop-blur">
          <Text className="text-xs text-ink-3">กำลังดู</Text>
          <span className="text-sm font-medium text-ink">{admission.name}</span>
          {mono(admission.an)}
          <Button size="small" icon={<SwapOutlined />} onClick={reopenPicker} className="ml-auto">
            เปลี่ยนผู้ป่วย
          </Button>
        </section>
      ) : (
        <section className="mb-6">
          <Segmented<Mode>
            value={mode}
            onChange={value => {
              setMode(value)
              setError(null)
            }}
            options={[
              { label: 'ผู้ป่วยที่นอนอยู่ในตึก', value: 'ward' },
              { label: 'ค้นหาผู้ป่วย', value: 'search' },
            ]}
          />
        </section>
      )}

      {!pickerOpen ? null : mode === 'ward' ? (
        <section className="mb-8">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Select<string>
              value={ward}
              onChange={loadWard}
              loading={wardsLoading}
              placeholder="เลือกตึก"
              showSearch
              optionFilterProp="label"
              style={{ minWidth: 320 }}
              options={wards.map(item => ({
                value: item.ward,
                label: `${item.name} (${item.admitted} ราย)`,
              }))}
            />
            {ward && (
              <Text type="secondary" className="text-xs">
                ยังนอนอยู่ {patients.length} ราย
              </Text>
            )}
          </div>

          <Spin spinning={patientsLoading}>
            <Table<AdmittedPatient>
              rowKey="an"
              size="small"
              dataSource={patients}
              columns={wardColumns}
              pagination={false}
              scroll={{ x: 'max-content', y: 420 }}
              locale={{
                emptyText: (
                  <Empty description={ward ? 'ไม่มีผู้ป่วยนอนอยู่ในตึกนี้' : 'เลือกตึกก่อน'} />
                ),
              }}
            />
          </Spin>
        </section>
      ) : (
        <section className="mb-8">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Input
              value={term}
              onChange={event => setTerm(event.target.value)}
              onPressEnter={search}
              allowClear
              placeholder="ชื่อ-สกุล / HN / เลขบัตรประชาชน / AN"
              style={{ maxWidth: 360 }}
            />
            <Button
              type="primary"
              icon={<SearchOutlined />}
              loading={searching}
              onClick={search}
              disabled={!term.trim()}
            >
              ค้นหา
            </Button>
          </div>

          <Spin spinning={searching}>
            <Table<AdmissionMatch>
              rowKey="an"
              size="small"
              dataSource={matches}
              columns={matchColumns}
              pagination={false}
              scroll={{ x: 'max-content' }}
              locale={{
                emptyText: (
                  <Empty
                    description={
                      searched ? 'ไม่พบการนอนโรงพยาบาลที่ตรงกับคำค้น' : 'พิมพ์คำค้นแล้วกดค้นหา'
                    }
                  />
                ),
              }}
            />
          </Spin>
        </section>
      )}

      {/* ───────────── แผนการใช้ยาของ AN ที่เลือก ───────────── */}
      {(planLoading || plan || planError) && (
        <section
          ref={planRef}
          className="scroll-mt-20 rounded-2xl border border-line bg-panel p-5 backdrop-blur"
        >
          {planError && <Alert type="error" showIcon title={planError} className="mb-4" />}

          <Spin spinning={planLoading}>
            {admission && (
              <>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <Title level={4} style={{ color: 'var(--ink)', margin: 0 }}>
                    {admission.name}
                  </Title>
                  <div className="flex items-center gap-2">
                    <Button
                      size="small"
                      type="primary"
                      icon={<MedicineBoxOutlined />}
                      onClick={openSelect}
                      disabled={items.length === 0}
                    >
                      เลือกยา / พิมพ์ใบยา
                    </Button>
                    {/* แสดงเฉพาะผู้ป่วยที่มีผลแล็บแบบเอกสารจริง — นับมาพร้อมแผนยาแล้ว */}
                    {plan.labCultureCount > 0 && (
                      <Button
                        size="small"
                        icon={<ExperimentOutlined />}
                        onClick={() => setLabOpen(true)}
                      >
                        Lab Culture ({plan.labCultureCount})
                      </Button>
                    )}
                    <Button
                      size="small"
                      icon={<FileImageOutlined />}
                      onClick={() => openScans(admission.hn)}
                    >
                      ภาพสแกนเวชระเบียน
                    </Button>
                    <Button size="small" icon={<UndoOutlined />} onClick={reopenPicker}>
                      เลือกผู้ป่วยใหม่
                    </Button>
                  </div>
                </div>

                <Descriptions column={{ xs: 1, sm: 2, lg: 4 }} size="small" colon={false}>
                  <Descriptions.Item label="AN">{mono(admission.an)}</Descriptions.Item>
                  <Descriptions.Item label="HN">{mono(admission.hn)}</Descriptions.Item>
                  <Descriptions.Item label="อายุ">
                    {admission.age == null ? '—' : `${admission.age} ปี`}
                  </Descriptions.Item>
                  <Descriptions.Item label="ตึก">{admission.wardName ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label="วันที่รับไว้">
                    {toThaiDate(admission.admitDate)}
                  </Descriptions.Item>
                  <Descriptions.Item label="จำหน่าย">
                    {admission.admitted ? 'ยังนอนอยู่' : toThaiDate(admission.dischargeDate)}
                  </Descriptions.Item>
                </Descriptions>

                {/* ── ประวัติแพ้ยา ── */}
                {(plan?.allergies.length ?? 0) > 0 ? (
                  <Alert
                    type="error"
                    showIcon
                    icon={<WarningOutlined />}
                    className="mt-4"
                    title={`แพ้ยา ${plan?.allergies.length} รายการ`}
                    description={
                      <div className="flex flex-col gap-1">
                        {plan?.allergies.map(allergy => (
                          <div key={allergy.agent} className="text-xs">
                            <span className="font-semibold">{allergy.agent}</span>
                            {allergy.symptom && <span> — {allergy.symptom}</span>}
                            {allergy.seriousness && (
                              <Tag color="red" className="ml-1.5">
                                {allergy.seriousness}
                              </Tag>
                            )}
                          </div>
                        ))}

                        {/* ผลเทียบชื่อยาในแผนกับรายการแพ้ — เป็นตัวช่วย ไม่ใช่คำตัดสิน */}
                        <div className="mt-1.5 border-t border-line pt-1.5 text-xs">
                          {allergyHits.length > 0 ? (
                            <span className="font-semibold">
                              ⚠ มีคำสั่งใช้ยาในแผนนี้ที่ชื่อตรงกับรายการแพ้ {allergyHits.length}{' '}
                              รายการ — ดูแถวที่ติดป้ายแดงในตาราง
                            </span>
                          ) : (
                            <span>
                              เทียบชื่อยาในแผนกับรายการแพ้แล้ว ไม่พบที่ตรงกัน
                            </span>
                          )}
                          <div className="mt-0.5 opacity-75">
                            เทียบด้วยชื่อสามัญเท่านั้น ยาที่ระบบตั้งชื่อด้วยชื่อการค้าล้วนจะจับไม่ได้
                            — ยังต้องอ่านรายการแพ้ยาข้างบนเองทุกครั้ง
                          </div>
                        </div>
                      </div>
                    }
                  />
                ) : (
                  /* ไม่มีประวัติ = ไม่เคยมีใครบันทึกไว้ ไม่ได้แปลว่าผู้ป่วยไม่แพ้ยา */
                  <Alert
                    type="info"
                    showIcon
                    className="mt-4"
                    title="ไม่พบประวัติแพ้ยาที่บันทึกไว้ในระบบ"
                  />
                )}

                {/* ── แถบเลื่อนวัน ── */}
                <div className="mt-5 mb-3 flex flex-wrap items-center gap-3 border-t border-line pt-4">
                  <Button
                    size="small"
                    icon={<LeftOutlined />}
                    disabled={!canGoBack}
                    onClick={() => setWindowEnd(value => Math.max(WINDOW - 1, value - WINDOW))}
                  >
                    ย้อนหลัง
                  </Button>
                  <Button
                    size="small"
                    disabled={!canGoForward}
                    onClick={() => setWindowEnd(value => Math.min(totalDays - 1, value + WINDOW))}
                  >
                    ถัดไป <RightOutlined />
                  </Button>
                  <Button
                    size="small"
                    type="text"
                    disabled={!canGoForward}
                    onClick={() => setWindowEnd(totalDays - 1)}
                  >
                    ล่าสุด
                  </Button>
                  <Text type="secondary" className="text-xs">
                    {shownDays.length > 0
                      ? `${toThaiDate(shownDays[0])} – ${toThaiDate(shownDays[shownDays.length - 1])} จากทั้งหมด ${totalDays} วัน`
                      : 'ไม่มีข้อมูล'}
                    {planFilter.trim() && ` · แสดง ${visibleItems.length} จาก ${items.length} รายการ`}
                  </Text>
                  <Input
                    size="small"
                    allowClear
                    prefix={<SearchOutlined className="text-ink-3" />}
                    placeholder="กรองด้วยชื่อยา / วิธีใช้ / แพทย์"
                    value={planFilter}
                    onChange={event => setPlanFilter(event.target.value)}
                    className="ml-auto"
                    style={{ maxWidth: 260 }}
                  />
                  <Checkbox
                    checked={drugsOnly}
                    onChange={event => setDrugsOnly(event.target.checked)}
                  >
                    <span className="text-xs">เฉพาะยา (ซ่อนค่าบริการ/เวชภัณฑ์)</span>
                  </Checkbox>
                </div>

                <Table<DrugPlanItem>
                  rowKey="planNumber"
                  size="small"
                  dataSource={visibleItems}
                  columns={planColumns}
                  pagination={false}
                  scroll={{ x: 'max-content', y: 560 }}
                  locale={{
                    emptyText: (
                      <Empty
                        description={
                          planFilter.trim() && items.length > 0
                            ? 'ไม่มีรายการที่ตรงกับคำกรอง'
                            : drugsOnly && (plan?.items.length ?? 0) > 0
                              ? 'การนอนครั้งนี้มีแต่ค่าบริการ ไม่มีรายการยา'
                              : 'ไม่มีแผนการใช้ยาของ AN นี้'
                        }
                      />
                    ),
                  }}
                />

                <Paragraph type="secondary" className="mt-3 mb-0 text-[11px]">
                  ช่องที่ระบายสีคือวันที่คำสั่งใช้ยายังมีผล (ม่วง = Continue, ส้ม = STAT)
                  ตัวเลขในช่องคือจำนวนที่จ่ายต่อวัน — ข้อมูลมาจากคำสั่งใช้ยา ไม่ใช่บันทึกว่าพยาบาลให้ยาจริงแล้ว
                </Paragraph>
              </>
            )}
          </Spin>
        </section>
      )}

      {/* ───────────── Modal: โหมดเลือกยา ───────────── */}
      <Modal
        title={
          plan?.admission
            ? `เลือกยา · AN ${plan.admission.an} · ${plan.admission.name}`
            : 'เลือกยา'
        }
        open={selectOpen}
        onCancel={() => setSelectOpen(false)}
        footer={null}
        width={1000}
      >
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Text type="secondary" className="text-xs">
            เลือกไว้ {picked.length} จาก {items.length} รายการ · แก้ไขแล้ว {Object.keys(edits).length}{' '}
            รายการ
          </Text>
          {Object.keys(edits).length > 0 && (
            <Button size="small" icon={<UndoOutlined />} onClick={() => setEdits({})}>
              คืนค่าที่แก้ทั้งหมด
            </Button>
          )}
          <Button
            type="primary"
            icon={<PrinterOutlined />}
            className="ml-auto"
            disabled={picked.length === 0}
            onClick={() => setPrintOpen(true)}
          >
            พิมพ์ ({picked.length})
          </Button>
        </div>

        <Table<DrugPlanItem>
          rowKey="planNumber"
          size="small"
          dataSource={items}
          columns={selectColumns}
          pagination={false}
          scroll={{ y: 460 }}
          rowSelection={{
            selectedRowKeys: picked,
            onChange: keys => setPicked(keys as number[]),
          }}
        />

        <Paragraph type="secondary" className="mt-3 mb-0 text-[11px]">
          จำนวนกับวิธีใช้ที่แก้ตรงนี้อยู่บนใบพิมพ์เท่านั้น ไม่ได้บันทึกกลับเข้า HIS
        </Paragraph>
      </Modal>

      {/* ───────────── Modal: ตัวอย่างใบยาก่อนพิมพ์ ───────────── */}
      <Modal
        title="ใบทบทวนรายการยา"
        open={printOpen}
        onCancel={() => setPrintOpen(false)}
        footer={null}
        width="92vw"
        style={{ top: 24, maxWidth: 1000 }}
        // destroyOnHidden: ปิดแล้วทิ้ง viewer ไปเลย เปิดใหม่จะได้สร้างเอกสารจากค่าล่าสุดเสมอ
        destroyOnHidden
      >
        <Text type="secondary" className="text-[11px]">
          สั่งพิมพ์หรือบันทึกไฟล์ได้จากแถบเครื่องมือของตัวอ่าน PDF ด้านล่าง
        </Text>
        {/* ตัว viewer เป็น iframe ต้องมีความสูงจริง ไม่งั้นจะยุบเหลือศูนย์ */}
        <div className="mt-2 h-[calc(100vh-200px)] overflow-hidden rounded-lg">
          {printOpen && (() => {
            const printData = buildPrintData()
            return printData ? <ReconcilePdfViewer data={printData} /> : null
          })()}
        </div>
      </Modal>
      {/* ───────────── Modal: ภาพสแกนเวชระเบียน (opdscan) ───────────── */}
      <Modal
        title={
          admission
            ? `ภาพสแกนเวชระเบียน · HN ${admission.hn} · ${admission.name}`
            : 'ภาพสแกนเวชระเบียน'
        }
        open={scanOpen}
        onCancel={() => setScanOpen(false)}
        footer={null}
        width="92vw"
        style={{ top: 32, maxWidth: 1400 }}
        styles={{ body: { maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' } }}
      >
        <Spin spinning={scanLoading}>
          {scanError && <Alert type="error" showIcon title={scanError} className="mb-3" />}

          {scans.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <Select
                allowClear
                size="small"
                placeholder="เลือกครั้งที่มารับบริการ (ทั้งหมด)"
                value={scanVn}
                onChange={value => setScanVn(value ?? null)}
                style={{ minWidth: 300 }}
                options={[...scanVnCount.entries()].map(([vn, count]) => ({
                  value: vn,
                  label: `VN ${vn} (${count} ภาพ)`,
                }))}
              />
              <Text type="secondary" className="text-[11px]">
                แสดง {visibleScans.length} จาก {scans.length} ภาพ (สูงสุด 60 ภาพล่าสุด)
              </Text>
            </div>
          )}

          {visibleScans.length > 0 ? (
            // โหลดภาพเมื่อเลื่อนถึงเท่านั้น — แต่ละใบเป็นไฟล์เต็มขนาดหลักร้อย KB ถึงหลาย MB
            <Image.PreviewGroup>
              <div className="flex flex-wrap gap-3">
                {visibleScans.map(scan => (
                  <div key={scan.scanId} className="w-44">
                    <Image
                      src={`/api/his/opd-scan/image?hn=${scan.hn}&scan_id=${scan.scanId}`}
                      alt={`สแกนหน้า ${scan.pageNo ?? '-'} วันที่ ${scan.scannedAt ?? '-'}`}
                      width={176}
                      height={220}
                      loading="lazy"
                      style={{ objectFit: 'cover', borderRadius: 8 }}
                    />
                    <div className="mt-1 leading-snug">
                      <div className="font-mono text-[11px]">{toThaiDate(scan.scannedAt)}</div>
                      <Text type="secondary" className="text-[11px]">
                        หน้า {scan.pageNo ?? '-'}
                        {scan.vn ? ` · VN ${scan.vn}` : ''}
                      </Text>
                    </div>
                  </div>
                ))}
              </div>
            </Image.PreviewGroup>
          ) : (
            !scanLoading && <Empty description="ไม่พบภาพสแกนของผู้ป่วยรายนี้" />
          )}
        </Spin>
      </Modal>
      <LabCultureModal
        open={labOpen}
        onClose={() => setLabOpen(false)}
        hn={admission?.hn ?? null}
        patientName={admission?.name}
      />
    </>
  )
}
