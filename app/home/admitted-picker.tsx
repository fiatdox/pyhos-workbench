'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
import { useEffect, useState } from 'react'
import { Alert, Button, Empty, Select, Table, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { apiFetch } from '@/lib/client/session'
import type { AdmittedPatient, DoctorOption, WardOption } from '@/lib/his/admitted'
import { TableRowsSkeleton } from './skeletons'

const { Text } = Typography

/**
 * ตัวช่วยหาผู้ป่วยที่ยังนอนอยู่ แล้วคืน HN กลับไปให้ฟอร์มที่เรียก
 *
 * มีไว้เพราะหน้าที่เริ่มด้วยการกรอก HN สมมติว่าผู้ใช้มี HN อยู่ในมือแล้ว ซึ่งจริง
 * เฉพาะตอนที่คนไข้ยืนอยู่ตรงหน้า เภสัชกรที่ไล่ดูผู้ป่วยในของตึกหนึ่งหรือของแพทย์
 * คนหนึ่งไม่มี HN มาก่อน ต้องไปเปิดหาจากที่อื่นแล้วจดมาพิมพ์ ซึ่งเป็นจุดที่พิมพ์ผิดได้
 *
 * วางเป็นแผงในหน้า ไม่ใช่ลิ้นชักซ้อนขึ้นมา — แบบเดียวกับหน้า Drug Profile ที่สลับ
 * โหมดด้วย Segmented แล้วตารางเปลี่ยนอยู่ในหน้าเดียวกัน ตัวสลับโหมดอยู่ที่หน้า
 * ที่เรียก ไม่ใช่ในนี้ เพราะหน้านั้นมีโหมด "กรอก HN เอง" อยู่ในชุดเดียวกันด้วย
 */

/** แปลง 'YYYY-MM-DD' เป็น วว/ดด/ปปปป พ.ศ. */
function toThaiDate(value: string | null): string {
  if (!value) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return value
  const [, year, month, day] = match
  return `${day}/${month}/${Number(year) + 543}`
}

/**
 * เรียงข้อความไทยตามพจนานุกรม ไม่ใช่ตามรหัสอักขระ
 *
 * localeCompare แบบไทยจำเป็นจริง — เรียงด้วยค่าดิบจะได้ 'นพ.' กับ 'พญ.' สลับที่
 * และสระนำอย่าง เ แ ไ จะไปกองอยู่ท้ายสุดทั้งหมด
 *
 * ใช้ได้กับเลขเตียงด้วยทั้งที่มีตัวเลขปนอยู่ เพราะเลขท้ายเติมศูนย์ไว้เท่ากันทุกตัว
 * ในคำนำหน้าเดียวกัน (ตรวจแล้วครบทั้ง 25 กลุ่มที่ใช้อยู่) 'ศญ09' จึงมาก่อน 'ศญ12'
 * ตามที่ควรเป็น ไม่ต้องแยกตัวเลขออกมาเทียบเอง
 *
 * ช่องว่างไปท้ายเสมอตอนเรียงขึ้น (antd กลับผลของตัวเทียบเองเวลาเรียงลง ช่องว่าง
 * จึงขึ้นมาอยู่หัวตารางในทิศนั้น ซึ่งรับได้เพราะเป็นส่วนน้อยของแถว)
 */
const byThaiText = (a: string | null, b: string | null) => {
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  return a.localeCompare(b, 'th')
}

/** รหัสเพศของ HIS: 1 = ชาย, 2 = หญิง นอกนั้นไม่ระบุ */
function sexLabel(sex: string | null): string {
  if (sex === '1') return 'ชาย'
  if (sex === '2') return 'หญิง'
  return '—'
}

export default function AdmittedPicker({
  mode,
  onPick,
}: {
  /** โหมดที่หน้าที่เรียกเลือกไว้ — สลับแล้วแผงนี้โหลดตัวเลือกของโหมดนั้นให้เอง */
  mode: 'ward' | 'doctor'
  /** ส่ง HN ของแถวที่เลือกกลับไป ฟอร์มที่เรียกเป็นผู้ตัดสินว่าจะทำอะไรต่อ */
  onPick: (hn: string) => void
}) {
  const [error, setError] = useState('')
  const [wards, setWards] = useState<WardOption[]>([])
  const [ward, setWard] = useState<string | null>(null)
  const [doctors, setDoctors] = useState<DoctorOption[]>([])
  const [doctor, setDoctor] = useState<string | null>(null)
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [patients, setPatients] = useState<AdmittedPatient[]>([])
  const [patientsLoading, setPatientsLoading] = useState(false)

  /**
   * โหลดตัวเลือกของโหมดที่เปิดอยู่
   *
   * เก็บของทั้งสองโหมดไว้คนละชุด สลับกลับไปกลับมาจึงไม่ต้องยิงซ้ำ และไม่ดึงทั้งคู่
   * ตั้งแต่แรกเพราะคนที่เข้ามากรอก HN เองไม่ได้ใช้ทั้งสองอย่าง
   */
  useEffect(() => {
    let alive = true
    const run = async () => {
      if (mode === 'ward' ? wards.length > 0 : doctors.length > 0) return
      setOptionsLoading(true)
      setError('')
      try {
        const res = await apiFetch(`/api/his/admitted/${mode === 'ward' ? 'wards' : 'doctors'}`)
        const json = await res.json()
        if (!alive) return
        if (!res.ok || !json.success) {
          setError(json.message ?? 'ดึงรายการตัวเลือกไม่สำเร็จ')
          return
        }
        if (mode === 'ward') setWards(json.wards as WardOption[])
        else setDoctors(json.doctors as DoctorOption[])
      } catch {
        if (alive) setError('เชื่อมต่อฐานข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
      } finally {
        if (alive) setOptionsLoading(false)
      }
    }
    void run()
    // กันตั้ง state หลังผู้ใช้สลับโหมดหรือเปลี่ยนหน้าไปแล้ว
    return () => {
      alive = false
    }
    // ตั้งใจไม่ใส่ wards/doctors เป็น dependency — ใช้แค่เช็คว่าโหลดไปแล้วหรือยัง
    // ถ้าใส่ไป effect จะวนรอบตัวเองทุกครั้งที่โหลดเสร็จ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const loadPatients = async (query: string) => {
    setError('')
    setPatientsLoading(true)
    setPatients([])
    try {
      const res = await apiFetch(`/api/his/admitted/patients?${query}`)
      const json = await res.json()
      if (!res.ok || !json.success) {
        setError(json.message ?? 'ดึงรายชื่อผู้ป่วยไม่สำเร็จ')
        return
      }
      setPatients(json.patients as AdmittedPatient[])
    } catch {
      setError('เชื่อมต่อฐานข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setPatientsLoading(false)
    }
  }

  const pickWard = (code: string) => {
    setWard(code)
    void loadPatients(`ward=${encodeURIComponent(code)}`)
  }

  const pickDoctor = (code: string) => {
    setDoctor(code)
    void loadPatients(`doctor=${encodeURIComponent(code)}`)
  }

  const chosen = mode === 'ward' ? ward : doctor

  const columns: ColumnsType<AdmittedPatient> = [
    {
      title: 'ลำดับ',
      key: 'index',
      width: 70,
      align: 'center',
      render: (_: unknown, __: unknown, index: number) => (
        <span className="font-mono text-xs text-ink-3">{index + 1}</span>
      ),
    },
    {
      title: 'HN',
      dataIndex: 'hn',
      key: 'hn',
      width: 110,
      render: (value: string) => <span className="font-mono text-xs">{value}</span>,
    },
    { title: 'ชื่อ-สกุล', dataIndex: 'name', key: 'name', width: 210 },
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
      // โหมดเลือกตึกทุกแถวอยู่ตึกเดียวกัน แต่โหมดเลือกแพทย์คนไข้กระจายหลายตึก
      // คงช่องนี้ไว้ทั้งสองโหมดเพื่อให้ตารางหน้าตาเดียวกัน
      title: 'ตึก',
      dataIndex: 'wardName',
      key: 'wardName',
      width: 180,
      render: (value: string | null) => value ?? '—',
    },
    {
      title: 'เตียง',
      dataIndex: 'bed',
      key: 'bed',
      width: 90,
      // เรียงได้ทั้งสองโหมด ต่างจากช่องแพทย์ — โหมดเลือกตึกเรียงแล้วได้ลำดับเตียง
      // ที่เดินไล่ดูตามห้องได้จริง ส่วนโหมดเลือกแพทย์คนไข้กระจายหลายตึก เลขเตียง
      // มีคำนำหน้าของตึกอยู่แล้ว เรียงแล้วจึงจับกลุ่มตามตึกให้ในตัว
      sorter: (a: AdmittedPatient, b: AdmittedPatient) => byThaiText(a.bed, b.bed),
      // ขีดคือ "ยังไม่ได้ลงเตียง" ไม่ใช่ "ไม่มีเตียง" — ส่วนใหญ่คือคนที่เพิ่งรับเข้ามา
      render: (value: string | null) =>
        value ? (
          <span className="font-mono text-xs">{value}</span>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: 'วันที่รับไว้',
      dataIndex: 'admitDate',
      key: 'admitDate',
      width: 120,
      render: (value: string | null) => (
        <span className="font-mono text-xs">{toThaiDate(value)}</span>
      ),
    },
    {
      title: 'นอนแล้ว',
      dataIndex: 'los',
      key: 'los',
      width: 90,
      render: (value: number | null) => (value == null ? '—' : `${value} วัน`),
    },
    {
      title: 'แพทย์เจ้าของไข้',
      dataIndex: 'inchargeDoctor',
      key: 'inchargeDoctor',
      width: 190,
      // เรียงได้เฉพาะโหมดเลือกตึก — ตึกหนึ่งมีผู้ป่วยของแพทย์หลายคนปนกัน การจับ
      // กลุ่มตามเจ้าของไข้จึงช่วยให้ไล่ดูทีละคนได้ ส่วนโหมดเลือกแพทย์ทุกแถวเป็น
      // หมอคนเดียวกันอยู่แล้ว ปุ่มเรียงที่กดแล้วไม่มีอะไรขยับคือปุ่มที่หลอกให้กด
      sorter:
        mode === 'ward'
          ? (a: AdmittedPatient, b: AdmittedPatient) =>
              byThaiText(a.inchargeDoctor, b.inchargeDoctor)
          : undefined,
      render: (value: string | null) => value ?? '—',
    },
    {
      title: '',
      key: 'pick',
      width: 90,
      align: 'right',
      render: (_: unknown, row) => (
        <Button size="small" type="primary" onClick={() => onPick(row.hn)}>
          เลือก
        </Button>
      ),
    },
  ]

  return (
    <>
      {error && <Alert type="error" showIcon title={error} className="mb-3" />}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        {mode === 'ward' ? (
          <Select<string>
            value={ward}
            onChange={pickWard}
            loading={optionsLoading}
            placeholder="เลือกตึก"
            showSearch
            optionFilterProp="label"
            style={{ minWidth: 320 }}
            options={wards.map(item => ({
              value: item.ward,
              label: `${item.name} (${item.admitted} ราย)`,
            }))}
          />
        ) : (
          <Select<string>
            value={doctor}
            onChange={pickDoctor}
            loading={optionsLoading}
            placeholder="เลือกแพทย์"
            showSearch
            optionFilterProp="label"
            style={{ minWidth: 320 }}
            options={doctors.map(item => ({
              value: item.code,
              label: `${item.name} (${item.admitted} ราย)`,
            }))}
          />
        )}
        {chosen && (
          <Text type="secondary" className="text-xs">
            ยังนอนอยู่ {patients.length} ราย
          </Text>
        )}
      </div>

      {/* โครงร่างแถววางในช่อง emptyText ไม่ได้ครอบตารางด้วยวงกลมหมุน — หัวตาราง
          และความกว้างคอลัมน์จึงอยู่ที่เดิมตอนรายชื่อมาถึง ตารางนี้มี 11 คอลัมน์
          ถ้าของขยับตอนโหลดเสร็จจะกวาดตาหาคอลัมน์ที่ต้องการใหม่ทุกครั้ง */}
      <Table<AdmittedPatient>
        rowKey="an"
        size="small"
        columns={columns}
        dataSource={patients}
        pagination={false}
        scroll={{ x: 'max-content', y: 420 }}
        locale={{
          emptyText: patientsLoading ? (
            <TableRowsSkeleton columns={columns.length} rows={6} />
          ) : (
            <Empty
              description={
                chosen
                  ? 'ไม่มีผู้ป่วยนอนอยู่ตามที่เลือก'
                  : mode === 'ward'
                    ? 'เลือกตึกก่อน'
                    : 'เลือกแพทย์ก่อน'
              }
            />
          ),
        }}
      />
    </>
  )
}
