'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ยังทำที่ app/home/layout.tsx ซึ่งเป็น Server Component)
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Alert,
  Breadcrumb,
  Button,
  Checkbox,
  DatePicker,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Select,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { type Dayjs } from 'dayjs'
import {
  FileExcelOutlined,
  MedicineBoxOutlined,
  SearchOutlined,
  UserDeleteOutlined,
  UserSwitchOutlined,
} from '@ant-design/icons'
import { apiFetch } from '@/lib/client/session'
import type { DeliveryPatient, RiderCoverage } from '@/lib/his/drug-delivery'
import type { RiderStaff } from '@/lib/his/health-rider'

const { Text, Title } = Typography

/** รหัสประเภทในตาราง fiat_pyhos_health_rider_role */
const MANAGER_ROLE = 1

/** บัญชีผู้ดูแลระบบ — ไม่ใช่คน ไม่ต้องโผล่ในรายการผู้ส่งยาไม่ว่ากรณีใด */
const ADMIN_ROLE = 0

/** แปลง 'YYYY-MM-DD' เป็น วว/ดด/ปปปป พ.ศ. */
function toThaiDate(value: Dayjs): string {
  return `${value.format('DD/MM')}/${value.year() + 543}`
}

/**
 * แปลงรายชื่อเป็นไฟล์ CSV ที่ Excel เปิดได้ตรง ๆ
 *
 * ใส่ BOM ไว้หน้าไฟล์ เพราะ Excel บนวินโดวส์เดาว่า CSV เป็นรหัสภาษาไทยของเครื่อง
 * (CP874) ถ้าไม่มี BOM ตัวอักษรไทยจะกลายเป็นขยะทั้งไฟล์
 *
 * ครอบทุกช่องด้วยเครื่องหมายคำพูดและ escape คำพูดข้างในเป็นสองตัว — ที่อยู่มี
 * จุลภาคอยู่แล้ว ถ้าไม่ครอบไว้คอลัมน์จะเลื่อนทั้งแถว
 */
function toCsv(rows: string[][]): string {
  const cell = (value: string) => `"${value.replace(/"/g, '""')}"`
  return '﻿' + rows.map(row => row.map(cell).join(',')).join('\r\n')
}

/** ช่องว่างในตาราง — ใช้รูปแบบเดียวกันทุกคอลัมน์ ไม่ปนกับแท็กที่แปลว่าข้อมูลผิด */
const Blank = () => (
  <Text type="secondary" className="text-xs">
    —
  </Text>
)

const fullName = (staff: RiderStaff) =>
  [staff.pname, staff.fname, staff.lname].filter(Boolean).join(' ') || `รหัส ${staff.id}`

/** หมู่ในฐานเก็บเป็นข้อความ บางที่เป็น '06' บางที่ '6' เทียบเป็นตัวเลขจึงตรงกว่า */
const sameMoo = (a: string | null, b: string | null) => {
  if (!a || !b) return false
  const left = Number(a)
  const right = Number(b)
  return Number.isFinite(left) && Number.isFinite(right) ? left === right : a.trim() === b.trim()
}

/**
 * รายชื่อผู้ป่วยที่ต้องส่งยาถึงบ้านในแต่ละวัน
 *
 * ตั้งต้นจากรายการค่าบริการจัดส่งยาที่ห้องยาคิดไว้ในระบบ HIS — ถือว่าใครมี
 * ค่าบริการนี้ในวันไหน คนนั้นคือคิวส่งยาของวันนั้น ไม่ได้มีทะเบียนคิวแยกต่างหาก
 *
 * จ่ายงานได้จากหน้านี้เลย: กดปุ่มท้ายแถวแล้วเลือกผู้จัดการกับผู้ส่งยาในหน้าต่างเดียว
 * ระบบยกคนที่รับผิดชอบตำบล+หมู่ของผู้ป่วยขึ้นมาไว้กลุ่มบนให้ แต่เลือกคนอื่นได้เสมอ
 * — ตัดสินใจเป็นของผู้ใช้ ระบบแค่แนะนำ
 */
export default function DrugDeliveriesPage() {
  const [date, setDate] = useState<Dayjs>(dayjs())
  const [patients, setPatients] = useState<DeliveryPatient[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState('')
  const [staff, setStaff] = useState<RiderStaff[]>([])
  /** แยกจาก error ของรายชื่อผู้ป่วย — อันนี้กระทบแค่การจ่ายงาน ตารางยังดูได้ */
  const [staffError, setStaffError] = useState('')
  const [coverage, setCoverage] = useState<RiderCoverage[]>([])
  /** ผู้จัดการที่เลือกไว้ล่าสุด — ใช้เป็นค่าตั้งต้นเฉพาะรายที่ยังไม่เคยจ่ายงาน */
  const [lastManagerId, setLastManagerId] = useState<number | null>(null)
  /** แถวที่กำลังเปิดหน้าต่างจ่ายงานอยู่ */
  const [assignTarget, setAssignTarget] = useState<DeliveryPatient | null>(null)
  const [draftRider, setDraftRider] = useState<number | null>(null)
  const [draftManager, setDraftManager] = useState<number | null>(null)
  /** เปิดให้เลือกคนนอกพื้นที่รับผิดชอบของหมู่นั้น — ตั้งใหม่ทุกครั้งที่เปิดหน้าต่าง */
  const [showOutside, setShowOutside] = useState(false)
  /** vn ของแถวที่กำลังบันทึกการจ่ายงาน ใช้ล็อกเฉพาะแถวนั้น */
  const [savingVn, setSavingVn] = useState<string | null>(null)
  const [toast, toastHolder] = message.useMessage()

  // ทะเบียนเจ้าหน้าที่กับพื้นที่รับผิดชอบไม่เปลี่ยนตามวันที่เลือก โหลดครั้งเดียวพอ
  useEffect(() => {
    let alive = true
    const run = async () => {
      try {
        const [staffRes, coverageRes] = await Promise.all([
          apiFetch('/api/his/health-rider/staff'),
          apiFetch('/api/his/health-rider/coverage'),
        ])
        const staffJson = await staffRes.json()
        const coverageJson = await coverageRes.json()
        if (!alive) return
        // ล้มเหลวตรงนี้แปลว่าจ่ายงานไม่ได้ทั้งหน้า ต้องบอกให้เห็น ไม่ใช่ปล่อยให้
        // ช่องเลือกว่างเปล่าแล้วผู้ใช้เดาเองว่าทำไมกดไม่ได้
        if (!staffRes.ok || !staffJson.success) {
          setStaffError(staffJson.message ?? 'โหลดทะเบียนเจ้าหน้าที่ไม่สำเร็จ จ่ายงานไม่ได้')
        } else {
          setStaff(staffJson.staff as RiderStaff[])
        }
        if (!coverageRes.ok || !coverageJson.success) {
          setStaffError(coverageJson.message ?? 'โหลดพื้นที่รับผิดชอบไม่สำเร็จ ระบบจะไม่แนะนำผู้ส่งยาตามพื้นที่')
        } else {
          setCoverage(coverageJson.coverage as RiderCoverage[])
        }
      } catch {
        if (alive) setStaffError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ จ่ายงานไม่ได้ชั่วคราว')
      }
    }
    void run()
    return () => {
      alive = false
    }
  }, [toast])

  // สถานะกำลังโหลดตั้งไว้ตั้งแต่ตอนเลือกวัน ไม่ใช่ในตัว effect — ตั้ง state ตรง ๆ
  // ในบอดี้ของ effect ทำให้เกิดเรนเดอร์ซ้อนโดยไม่จำเป็น
  useEffect(() => {
    let alive = true
    const run = async () => {
      try {
        const res = await apiFetch(
          `/api/his/health-rider/deliveries?date=${date.format('YYYY-MM-DD')}`,
        )
        const json = await res.json()
        if (!alive) return
        if (!res.ok || !json.success) {
          setPatients([])
          setError(json.message ?? 'ดึงรายชื่อผู้ป่วยไม่สำเร็จ')
          return
        }
        setPatients(json.patients as DeliveryPatient[])
        setError('')
      } catch {
        if (!alive) return
        setPatients([])
        setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
      } finally {
        if (alive) setLoading(false)
      }
    }
    void run()
    // กันตั้ง state จากคำขอของวันเก่าเมื่อผู้ใช้เปลี่ยนวันเร็ว ๆ
    return () => {
      alive = false
    }
  }, [date])

  const visible = useMemo(() => {
    const term = keyword.trim().toLowerCase()
    if (!term) return patients
    return patients.filter(row =>
      [row.hn, row.name, row.phone, row.address, row.pttypeName, row.riderName, row.managerName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term),
    )
  }, [patients, keyword])

  /** นับ HN ไม่ซ้ำ — คนเดียวมาสองครั้งในวันเดียวได้ ต้องไม่นับเป็นสองคน */
  const patientCount = useMemo(() => new Set(patients.map(row => row.hn)).size, [patients])
  const total = useMemo(() => patients.reduce((sum, row) => sum + row.amount, 0), [patients])
  const assignedCount = useMemo(
    () => patients.filter(row => row.riderId != null).length,
    [patients],
  )

  const managers = useMemo(
    () => staff.filter(item => item.roleId === MANAGER_ROLE && item.active === 'Y'),
    [staff],
  )
  /** รหัสคนที่มีพื้นที่รับผิดชอบอย่างน้อยหนึ่งหมู่ ไม่ว่าจะตำบลไหน */
  const hasCoverage = useMemo(
    () => new Set(coverage.map(item => item.riderId)),
    [coverage],
  )

  /**
   * ผู้ส่งยา = คนที่ยังใช้งานอยู่ ยกเว้นบัญชีผู้ดูแลระบบ
   *
   * ผู้จัดการนับเป็นผู้ส่งยาได้ด้วยถ้ามีการกำหนดเขตรับผิดชอบไว้ — ในทางปฏิบัติ
   * ผู้จัดการที่ดูแลพื้นที่ก็ออกไปส่งยาเอง (ข้อมูลเดิมมีการจ่ายงานให้แล้วจริง)
   * ส่วนผู้จัดการที่ไม่มีเขตรับผิดชอบเลย ถือว่าเป็นคนจ่ายงานอย่างเดียว
   */
  const riders = useMemo(
    () =>
      staff.filter(item => {
        if (item.active !== 'Y' || item.roleId === ADMIN_ROLE) return false
        if (item.roleId === MANAGER_ROLE) return hasCoverage.has(item.id)
        return true
      }),
    [staff, hasCoverage],
  )
  const riderById = useMemo(() => new Map(riders.map(item => [item.id, item])), [riders])
  const managerById = useMemo(() => new Map(managers.map(item => [item.id, item])), [managers])

  /**
   * รหัสเจ้าหน้าที่ที่รับผิดชอบพื้นที่ของผู้ป่วยรายนี้
   *
   * ต้องตรงทั้งรหัสตำบลและหมู่ ไม่ใช่ตำบลอย่างเดียว — คนละหมู่ในตำบลเดียวกันคือ
   * คนละพื้นที่รับผิดชอบ และในข้อมูลจริงหลายตำบลก็แบ่งกันดูแลรายหมู่อยู่แล้ว
   */
  const areaRiderIds = (row: DeliveryPatient) =>
    new Set(
      coverage
        .filter(item => item.tambonId === row.tambonId && sameMoo(item.moo, row.moo))
        .map(item => item.riderId),
    )

  /**
   * ตัวเลือกผู้ส่งยาของแถวหนึ่ง
   *
   * ค่าเริ่มต้นให้เฉพาะคนที่รับผิดชอบตำบล+หมู่นั้นจริง ๆ ส่วนคนอื่นต้องติ๊กเปิดเอง
   * — เก็บทางออกไว้เพราะวันที่คนในพื้นที่ลา หรือที่อยู่ในฐานไม่ตรงกับความจริง
   * ยังต้องจ่ายงานให้ได้ แต่ต้องเป็นการตัดสินใจที่ตั้งใจ ไม่ใช่เผลอเลือกจากรายการ
   */
  const riderOptions = (row: DeliveryPatient, includeOutside: boolean) => {
    const inArea = areaRiderIds(row)
    const label = (item: RiderStaff) =>
      `${fullName(item)}${item.roleName ? ` · ${item.roleName}` : ''}`

    const groups = [
      {
        label: 'รับผิดชอบตำบลและหมู่นี้',
        options: riders
          .filter(item => inArea.has(item.id))
          .map(item => ({ value: item.id, label: label(item) })),
      },
    ]

    if (includeOutside) {
      groups.push({
        label: 'นอกพื้นที่รับผิดชอบ',
        options: riders
          .filter(item => !inArea.has(item.id))
          .map(item => ({ value: item.id, label: label(item) })),
      })
    }
    return groups.filter(group => group.options.length > 0)
  }

  /**
   * ดาวน์โหลดรายชื่อที่เห็นอยู่เป็นไฟล์ CSV
   *
   * ส่งออกชุดเดียวกับที่กรองอยู่บนหน้าจอ ไม่ใช่ทั้งวันเสมอ — ถ้าค้นหาไว้แล้วได้ไฟล์
   * ที่มีทุกคน จะเข้าใจผิดว่าไฟล์ไม่ตรงกับที่เห็น
   *
   * ไฟล์นี้มีชื่อและที่อยู่ผู้ป่วย เตือนไว้ตรงปุ่มด้วยว่าอย่าส่งต่อออกนอกงาน
   */
  const exportCsv = () => {
    if (visible.length === 0) {
      toast.info('ไม่มีรายการให้ส่งออก')
      return
    }
    const header = [
      'เวลา',
      'HN',
      'ชื่อ-สกุล',
      'เพศ',
      'อายุ',
      'เบอร์โทร',
      'ที่อยู่',
      'ตำบล',
      'หมู่',
      'สิทธิการรักษา',
      'ผู้ส่งยา',
      'ผู้จัดการ',
      'ค่าบริการ',
    ]
    const body = visible.map(row => [
      row.visitTime ?? '',
      row.hn,
      row.name ?? '',
      row.sex ?? '',
      row.age == null ? '' : String(row.age),
      // นำหน้าด้วย ' เพื่อให้ Excel เก็บเป็นข้อความ ไม่ตัดศูนย์หน้าเบอร์ทิ้ง
      row.phone ? `'${row.phone}` : '',
      row.address ?? '',
      row.tambonName ?? '',
      row.moo ?? '',
      row.pttypeName ?? '',
      row.riderName ?? (row.riderId != null ? `ไม่พบเจ้าหน้าที่ ${row.riderId}` : ''),
      row.managerName ?? '',
      row.amount.toFixed(2),
    ])

    const blob = new Blob([toCsv([header, ...body])], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `ส่งยาถึงบ้าน-${date.format('YYYY-MM-DD')}.csv`
    link.click()
    // คืนหน่วยความจำของ blob หลังเบราว์เซอร์เริ่มดาวน์โหลดแล้ว
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success(`ส่งออก ${body.length} รายการแล้ว`)
  }

  /**
   * ยกเลิกการจ่ายงานของแถวหนึ่ง — เอาทั้งผู้ส่งยาและผู้จัดการออก
   *
   * ใช้เมื่อจ่ายผิดคนหรือผู้ป่วยยกเลิกการส่ง ไม่ใช่การแก้ตัวผู้ส่ง (อันนั้นเลือกคนใหม่
   * แล้วบันทึกทับได้เลย)
   */
  const cancelAssign = async (row: DeliveryPatient) => {
    setSavingVn(row.vn)
    try {
      const res = await apiFetch(`/api/his/health-rider/deliveries/assign?vn=${row.vn}`, {
        method: 'DELETE',
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        toast.error(json.message ?? 'ยกเลิกการจ่ายงานไม่สำเร็จ')
        return
      }
      setPatients(current =>
        current.map(item =>
          item.vn === row.vn
            ? { ...item, riderId: null, riderName: null, managerId: null, managerName: null }
            : item,
        ),
      )
      toast.success(`ยกเลิกการจ่ายงาน ${row.name ?? row.hn} แล้ว`)
      setAssignTarget(null)
    } catch {
      toast.error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setSavingVn(null)
    }
  }

  /** จำนวนคนที่รับผิดชอบตำบล+หมู่ของแถวที่เปิดหน้าต่างอยู่ */
  const areaCount = assignTarget ? areaRiderIds(assignTarget).size : 0

  /**
   * บันทึกการจ่ายงานหนึ่งแถว
   *
   * อัปเดตแถวในหน้าจอจากค่าที่เพิ่งบันทึกสำเร็จ ไม่โหลดรายชื่อทั้งวันใหม่ เพราะ
   * ผู้ใช้กำลังไล่จ่ายทีละคน การโหลดใหม่ทุกครั้งจะทำให้ตารางกระพริบและเสียตำแหน่ง
   */
  const assign = async (row: DeliveryPatient, rider: number, manager: number) => {
    setSavingVn(row.vn)
    try {
      const res = await apiFetch('/api/his/health-rider/deliveries/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vn: row.vn, rider, manager }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        toast.error(json.message ?? 'บันทึกการจ่ายงานไม่สำเร็จ')
        return
      }
      const riderStaff = riderById.get(rider)
      const managerStaff = managerById.get(manager)
      setPatients(current =>
        current.map(item =>
          item.vn === row.vn
            ? {
                ...item,
                riderId: rider,
                riderName: riderStaff ? fullName(riderStaff) : null,
                managerId: manager,
                managerName: managerStaff ? fullName(managerStaff) : item.managerName,
              }
            : item,
        ),
      )
      toast.success(`จ่ายงาน ${row.name ?? row.hn} แล้ว`)
      setLastManagerId(manager)
      setAssignTarget(null)
    } catch {
      toast.error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setSavingVn(null)
    }
  }

  /**
   * เปิดหน้าต่างจ่ายงานของแถวหนึ่ง
   *
   * ค่าตั้งต้นเอาของเดิมในฐานก่อนเสมอ — กดปุ่ม "เปลี่ยน" แล้วเห็นชื่อผู้จัดการคนอื่น
   * ค้างอยู่ จะทำให้บันทึกทับผู้จัดการเดิมโดยไม่ตั้งใจ ถ้ารายนั้นยังไม่เคยจ่ายงาน
   * ค่อยใช้คนที่เลือกไว้ครั้งก่อน (ทั้งวันมักเป็นคนเดิม)
   */
  const openAssign = (row: DeliveryPatient) => {
    const known = (id: number | null) => (id != null && managerById.has(id) ? id : null)
    const inArea = areaRiderIds(row)
    setAssignTarget(row)
    setDraftRider(row.riderId != null && riderById.has(row.riderId) ? row.riderId : null)
    setDraftManager(known(row.managerId) ?? known(lastManagerId))
    // เปิดรายชื่อนอกพื้นที่ให้เองเมื่อไม่มีใครรับผิดชอบหมู่นั้น หรือคนที่จ่ายไว้เดิม
    // เป็นคนนอกพื้นที่ ไม่งั้นช่องจะว่างเปล่าโดยไม่มีตัวเลือกให้เลือกเลย
    setShowOutside(
      inArea.size === 0 || (row.riderId != null && !inArea.has(row.riderId)),
    )
  }

  const columns: ColumnsType<DeliveryPatient> = [
    {
      title: 'เวลา',
      dataIndex: 'visitTime',
      width: 80,
      render: (value: string | null) =>
        value ? <span className="font-mono text-xs">{value}</span> : <Blank />,
    },
    {
      title: 'HN',
      dataIndex: 'hn',
      width: 110,
      render: (value: string) => <span className="font-mono text-xs">{value}</span>,
    },
    {
      title: 'ชื่อ-สกุล',
      dataIndex: 'name',
      render: (value: string | null) =>
        value ? (
          <span className="text-xs text-ink">{value}</span>
        ) : (
          // หาในทะเบียนผู้ป่วยไม่เจอ — ต้องเห็นว่าเป็นข้อมูลที่ผิด ไม่ใช่ช่องว่างเฉย ๆ
          <Tag color="orange" className="mr-0!">
            ไม่พบชื่อ
          </Tag>
        ),
    },
    {
      title: 'เพศ/อายุ',
      dataIndex: 'age',
      width: 110,
      render: (age: number | null, row) => {
        const text = [row.sex, age == null ? null : `${age} ปี`].filter(Boolean).join(' · ')
        return text ? <span className="text-xs text-ink-2">{text}</span> : <Blank />
      },
    },
    {
      title: 'เบอร์โทร',
      dataIndex: 'phone',
      width: 150,
      render: (value: string | null) =>
        value ? <span className="font-mono text-xs">{value}</span> : <Blank />,
    },
    {
      title: 'ที่อยู่',
      dataIndex: 'address',
      width: 300,
      render: (value: string | null) =>
        value ? (
          <span className="text-xs text-ink-2">{value}</span>
        ) : (
          // ที่อยู่คือปลายทางที่ต้องเอายาไปส่ง ว่างแปลว่าต้องไปตามจากที่อื่นก่อน
          <Tag color="orange" className="mr-0!">
            ไม่มีที่อยู่
          </Tag>
        ),
    },
    {
      title: 'สิทธิการรักษา',
      dataIndex: 'pttypeName',
      width: 240,
      render: (value: string | null) =>
        value ? <span className="text-xs text-ink-2">{value}</span> : <Blank />,
    },
    {
      title: 'ผู้ส่งยา',
      dataIndex: 'riderName',
      width: 220,
      // ยังไม่จ่ายงานใช้ขีดกลางเหมือนช่องว่างอื่นในตาราง (ปุ่มท้ายแถวบอกอยู่แล้วว่า
      // ยังไม่ได้จ่าย) เก็บแท็กสีส้มไว้เฉพาะกรณีข้อมูลผิดที่ต้องไปตามแก้จริง ๆ
      render: (value: string | null, row) => {
        if (value) return <span className="text-xs text-ink">{value}</span>
        if (row.riderId == null) return <Blank />
        return (
          <Tag color="orange" className="mr-0!">
            ไม่พบเจ้าหน้าที่ {row.riderId}
          </Tag>
        )
      },
    },
    {
      title: 'ผู้จัดการ',
      dataIndex: 'managerName',
      width: 190,
      render: (value: string | null) =>
        value ? <span className="text-xs text-ink-2">{value}</span> : <Blank />,
    },
    {
      title: 'ค่าบริการ',
      dataIndex: 'amount',
      width: 100,
      align: 'right',
      render: (value: number) => <span className="font-mono text-xs">{value.toFixed(2)}</span>,
    },
    {
      title: '',
      key: 'assign',
      width: 110,
      align: 'right',
      render: (_, row) => (
        <Button
          size="small"
          type={row.riderId == null ? 'primary' : 'default'}
          icon={<UserSwitchOutlined />}
          loading={savingVn === row.vn}
          disabled={riders.length === 0}
          // แถวที่จ่ายไปแล้วใช้เขียวอ่อน บอกว่าเรียบร้อยแล้วแต่ยังกดแก้ได้
          // (โทเคนเปลี่ยนตามธีมเอง จึงไม่ต้องมีคลาสของธีมมืดแยก)
          className={
            row.riderId == null
              ? undefined
              : 'border-ok-line! bg-ok-bg! text-ok! hover:border-ok! hover:text-ok!'
          }
          onClick={() => openAssign(row)}
        >
          {row.riderId == null ? 'จ่ายงาน' : 'เปลี่ยน'}
        </Button>
      ),
    },
  ]

  return (
    <>
      {toastHolder}
      <section className="mb-6">
        <Breadcrumb
          className="mb-2"
          items={[
            { title: <Link href="/home/health-rider">Health Rider</Link> },
            { title: 'รายชื่อผู้ป่วยส่งยาถึงบ้าน' },
          ]}
        />
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          <MedicineBoxOutlined /> รายชื่อผู้ป่วยส่งยาถึงบ้าน
        </Title>
        <div className="mb-2 h-px w-24 bg-linear-to-r from-violet-400/70 to-transparent" />
        <Text type="secondary" className="text-xs">
          ผู้ป่วยที่มีค่าบริการจัดส่งยาไปยังบ้านในวันที่เลือก — ข้อมูลจากระบบ HIS อ่านอย่างเดียว
        </Text>
      </section>

      {error && <Alert type="error" showIcon title={error} className="mb-4" />}
      {staffError && <Alert type="warning" showIcon title={staffError} className="mb-4" />}
      {!staffError && managers.length === 0 && staff.length > 0 && (
        <Alert
          type="warning"
          showIcon
          title="ไม่มีผู้จัดการให้เลือก"
          description={
            <span className="text-xs">
              ต้องมีเจ้าหน้าที่ที่ประเภทเป็น Manager และเปิดใช้งานอยู่อย่างน้อยหนึ่งคน
              จึงจะจ่ายงานได้ ตรวจได้ที่หน้าทะเบียนเจ้าหน้าที่
            </span>
          }
          className="mb-4"
        />
      )}

      <section className="mb-4 flex flex-wrap items-center gap-3">
        <DatePicker
          allowClear={false}
          value={date}
          onChange={value => {
            if (!value) return
            setLoading(true)
            setDate(value)
          }}
          format={value => toThaiDate(value)}
          // วันข้างหน้ายังไม่มีรายการ เลือกไปก็ได้ตารางว่างเปล่าอย่างเดียว
          maxDate={dayjs()}
          className="w-44"
        />
        <Input
          allowClear
          className="min-w-56 flex-1 sm:max-w-80"
          value={keyword}
          onChange={event => setKeyword(event.target.value)}
          placeholder="ค้นหา HN ชื่อ เบอร์โทร ที่อยู่ หรือผู้ส่งยา"
          prefix={<SearchOutlined className="text-ink-3" />}
        />
        {/* ไม่ปิดปุ่มตอนไม่มีข้อมูล แต่เช็คตอนกดแทน — ค่า disabled ที่ต่างกันระหว่าง
            สองฝั่งเป็นต้นเหตุของคำเตือน hydration ที่เจอมาแล้วทั้งหน้านี้และหน้า areas
            (ฝั่งเซิร์ฟเวอร์ไม่ใส่แอตทริบิวต์ ฝั่ง client ใส่ true) */}
        <Tooltip title="ไฟล์มีชื่อ เบอร์โทร และที่อยู่ผู้ป่วย ใช้เฉพาะในงานส่งยาเท่านั้น">
          <Button icon={<FileExcelOutlined />} onClick={exportCsv}>
            ส่งออก Excel
          </Button>
        </Tooltip>
        <Text type="secondary" className="ml-auto text-xs">
          {keyword.trim()
            ? `พบ ${visible.length} จาก ${patients.length} รายการ`
            : `${patientCount} คน · จ่ายงานแล้ว ${assignedCount}/${patients.length} · ${total.toFixed(2)} บาท`}
        </Text>
      </section>

      <section className="data-sheet rounded-2xl border border-line bg-panel p-2 backdrop-blur">
        <Spin spinning={loading}>
          <Table<DeliveryPatient>
            // คิวรียุบให้เหลือหนึ่งแถวต่อหนึ่ง vn แล้ว ใช้ vn เป็นคีย์ได้ตรง ๆ
            rowKey="vn"
            size="small"
            columns={columns}
            dataSource={visible}
            pagination={{ pageSize: 25, showSizeChanger: false, hideOnSinglePage: true }}
            scroll={{ x: 'max-content' }}
            locale={{
              emptyText: (
                <Empty
                  description={
                    loading
                      ? 'กำลังโหลด'
                      : keyword.trim()
                        ? 'ไม่พบผู้ป่วยตามคำค้น'
                        : `ไม่มีรายการส่งยาวันที่ ${toThaiDate(date)}`
                  }
                />
              ),
            }}
          />
        </Spin>
      </section>

      {/* ───────── จ่ายงาน ─────────
          เลือกทั้งผู้จัดการและผู้ส่งยาในหน้าต่างเดียว ผู้จัดการค้างค่าที่เลือกไว้ครั้งก่อน
          เพราะทั้งวันมักเป็นคนเดิม แต่ยังเปลี่ยนได้ทีละราย */}
      <Modal
        title={assignTarget ? `จ่ายงานส่งยา · ${assignTarget.name ?? assignTarget.hn}` : 'จ่ายงานส่งยา'}
        open={assignTarget != null}
        onCancel={() => setAssignTarget(null)}
        onOk={() => {
          if (assignTarget && draftRider != null && draftManager != null) {
            void assign(assignTarget, draftRider, draftManager)
          }
        }}
        okText="บันทึก"
        cancelText="ยกเลิก"
        okButtonProps={{ disabled: draftRider == null || draftManager == null }}
        confirmLoading={assignTarget != null && savingVn === assignTarget.vn}
        width={560}
        destroyOnHidden
        // ปุ่มยกเลิกการจ่ายงานอยู่ชิดซ้าย แยกจากปุ่มบันทึก/ปิดที่อยู่ขวา เพราะเป็น
        // การกระทำคนละทิศทางกัน วางติดกันแล้วกดผิดง่าย
        footer={
          assignTarget && (
            <div className="flex items-center gap-2">
              {assignTarget.riderId != null && (
                <Popconfirm
                  title="ยกเลิกการจ่ายงาน"
                  description={
                    <span className="text-xs">
                      เอาผู้ส่งยาและผู้จัดการออกทั้งคู่ กลับเป็นยังไม่ได้จ่ายงาน
                    </span>
                  }
                  okText="ยกเลิกการจ่ายงาน"
                  cancelText="ไม่ใช่"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => cancelAssign(assignTarget)}
                >
                  <Button danger icon={<UserDeleteOutlined />} loading={savingVn === assignTarget.vn}>
                    ยกเลิกการจ่ายงาน
                  </Button>
                </Popconfirm>
              )}
              <Button className="ml-auto" onClick={() => setAssignTarget(null)}>
                ปิด
              </Button>
              <Button
                type="primary"
                disabled={draftRider == null || draftManager == null}
                loading={savingVn === assignTarget.vn}
                onClick={() => {
                  if (draftRider != null && draftManager != null) {
                    void assign(assignTarget, draftRider, draftManager)
                  }
                }}
              >
                บันทึก
              </Button>
            </div>
          )
        }
      >
        {assignTarget && (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-line bg-panel p-3">
              <div className="text-xs text-ink-2">
                HN {assignTarget.hn} · {assignTarget.visitTime ?? '—'} น.
                {assignTarget.phone && ` · โทร ${assignTarget.phone}`}
              </div>
              <div className="mt-1 text-xs text-ink">{assignTarget.address ?? 'ไม่มีที่อยู่ในทะเบียน'}</div>
              {/* ตำบลกับหมู่คือสองค่าที่ใช้จับคู่ผู้รับผิดชอบ แสดงแยกให้ตรวจได้ว่าตรงกัน */}
              <div className="mt-2 flex flex-wrap gap-1">
                <Tag className="mr-0!">
                  {assignTarget.tambonName ? `ต.${assignTarget.tambonName}` : 'ไม่ระบุตำบล'}
                </Tag>
                <Tag className="mr-0!">
                  {assignTarget.moo ? `หมู่ ${assignTarget.moo}` : 'ไม่ระบุหมู่'}
                </Tag>
                <Tag color={areaCount > 0 ? 'green' : 'orange'} className="mr-0!">
                  ผู้รับผิดชอบพื้นที่ {areaCount} คน
                </Tag>
              </div>
            </div>

            <label className="flex flex-col gap-1">
              <Text className="text-xs font-semibold text-ink">ผู้จัดการ</Text>
              <Select
                showSearch
                placeholder="เลือกผู้จัดการ"
                value={draftManager}
                onChange={setDraftManager}
                optionFilterProp="label"
                options={managers.map(item => ({ value: item.id, label: fullName(item) }))}
              />
              {assignTarget.managerId != null && !managerById.has(assignTarget.managerId) && (
                <Text type="secondary" className="text-xs">
                  ผู้จัดการเดิม ({assignTarget.managerName ?? `รหัส ${assignTarget.managerId}`})
                  ไม่อยู่ในรายชื่อที่เลือกได้แล้ว ต้องเลือกใหม่
                </Text>
              )}
            </label>

            <label className="flex flex-col gap-1">
              <Text className="text-xs font-semibold text-ink">ผู้ส่งยา</Text>
              <Select
                showSearch
                placeholder="เลือกผู้ส่งยา"
                value={draftRider}
                onChange={setDraftRider}
                optionFilterProp="label"
                options={riderOptions(assignTarget, showOutside)}
                notFoundContent="ไม่มีเจ้าหน้าที่ให้เลือก"
              />
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Checkbox
                  checked={showOutside}
                  onChange={event => {
                    setShowOutside(event.target.checked)
                    // ปิดรายชื่อนอกพื้นที่ทั้งที่เลือกคนนอกพื้นที่ไว้ = ค่าที่ค้างอยู่
                    // จะไม่มีในตัวเลือกแล้ว ล้างทิ้งให้เลือกใหม่ ไม่ปล่อยให้บันทึกค่าที่มองไม่เห็น
                    if (!event.target.checked && draftRider != null) {
                      if (!areaRiderIds(assignTarget).has(draftRider)) setDraftRider(null)
                    }
                  }}
                >
                  <span className="text-xs">แสดงเจ้าหน้าที่นอกพื้นที่รับผิดชอบด้วย</span>
                </Checkbox>
                {areaCount === 0 && (
                  <Tag color="orange" className="mr-0!">
                    ไม่มีใครรับผิดชอบหมู่นี้
                  </Tag>
                )}
              </div>
              <Text type="secondary" className="text-xs">
                รายชื่อตั้งต้นคือคนที่รับผิดชอบ{' '}
                {assignTarget.tambonName ? `ต.${assignTarget.tambonName} ` : ''}
                {assignTarget.moo ? `ม.${assignTarget.moo}` : 'หมู่ที่ไม่ได้ระบุ'} เท่านั้น
              </Text>
            </label>

            {assignTarget.riderId != null && (
              <Alert
                type="info"
                showIcon
                title="รายนี้จ่ายงานไว้แล้ว"
                description={
                  <span className="text-xs">
                    บันทึกใหม่จะทับของเดิม (
                    {assignTarget.riderName ?? `รหัส ${assignTarget.riderId}`})
                  </span>
                }
              />
            )}
          </div>
        )}
      </Modal>
    </>
  )
}
