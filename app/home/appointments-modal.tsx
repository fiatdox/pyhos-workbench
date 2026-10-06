'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
import { useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Calendar,
  Empty,
  Modal,
  Segmented,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CheckOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { apiFetch } from '@/lib/client/session'
import type { Appointment, AppointmentStatus } from '@/lib/his/appointments'
import { CalendarSkeleton, TableRowsSkeleton } from './skeletons'

const { Text } = Typography

/**
 * ลิ้นชักประวัตินัดหมาย (ตาราง oapp)
 *
 * สองมุมมองของข้อมูลชุดเดียวกัน โหลดครั้งเดียวแล้วสลับได้ทันที
 *   รายการ — เรียงวันใกล้สุดก่อน ตอบว่า "เคยนัดอะไรไว้บ้าง"
 *   ปฏิทิน — ตอบว่า "เดือนนี้ต้องมาวันไหน" ซึ่งอ่านจากตารางยาว ๆ ไม่ออก
 *            คนไข้ฟอกไตมีนัดสัปดาห์ละสามวัน รูปแบบแบบนั้นเห็นได้จากปฏิทินเท่านั้น
 */

/** ป้ายและสีของแต่ละสถานะ — ลำดับในนี้คือลำดับที่ใช้เรียงป้ายสรุปด้านบนด้วย */
const STATUS_META: Record<
  AppointmentStatus,
  { label: string; color: string; dot: 'success' | 'processing' | 'warning' | 'default' }
> = {
  waiting: { label: 'รอถึงวันนัด', color: 'blue', dot: 'processing' },
  kept: { label: 'มาตามนัด', color: 'green', dot: 'success' },
  missed: { label: 'ไม่มาตามนัด', color: 'orange', dot: 'warning' },
  cancelled: { label: 'ยกเลิก', color: 'default', dot: 'default' },
}

type View = 'list' | 'calendar'

/** แปลง 'YYYY-MM-DD' เป็น วว/ดด/ปปปป พ.ศ. */
function toThaiDate(value: string | null): string {
  if (!value) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return value
  const [, year, month, day] = match
  return `${day}/${month}/${Number(year) + 543}`
}

/** ช่วงเวลานัด — ย่อให้เหลือค่าเดียวเมื่อต้นกับปลายตรงกัน (ในฐานมีแบบนั้นอยู่จริง) */
function timeRange(from: string | null, to: string | null): string {
  if (!from) return '—'
  return !to || to === from ? from : `${from}–${to}`
}

/**
 * เครื่องหมายถูกของสิ่งที่ต้องทำในวันนัด
 *
 * ขึ้นเฉพาะอันที่มี ไม่ใช่โชว์ทั้งสามช่องแล้วติ๊กบ้างไม่ติ๊กบ้าง — ในช่องปฏิทินที่
 * แคบอยู่แล้ว ช่องว่างสามช่องต่อหนึ่งนัดกินที่มากกว่าข้อมูลที่ได้
 *
 * LAB กับ X-ray มีรายชื่อรายการจริงให้กำกับไว้ในคำอธิบาย ส่วนผ่าตัดไม่มี เพราะ
 * ฐานนี้ไม่ได้ใช้โมดูลนัดผ่าตัด รู้ได้แค่ว่าเป็นนัดที่ห้องผ่าตัด/วิสัญญี
 */
function Marks({ item }: { item: Appointment }) {
  const marks: { key: string; label: string; title: string }[] = []
  if (item.hasLab) marks.push({ key: 'lab', label: 'LAB', title: item.labList ?? 'มีรายการแล็บ' })
  if (item.hasXray) {
    marks.push({ key: 'xray', label: 'X-ray', title: item.xrayList ?? 'มีรายการเอกซเรย์' })
  }
  if (item.hasOperation) {
    marks.push({ key: 'op', label: 'ผ่าตัด', title: 'นัดที่ห้องผ่าตัด/วิสัญญี' })
  }
  if (marks.length === 0) return null

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {marks.map(mark => (
        <Tooltip key={mark.key} title={mark.title}>
          <span className="inline-flex items-center gap-0.5 whitespace-nowrap text-accent">
            <CheckOutlined className="text-[10px]" />
            <span className="text-[10px]">{mark.label}</span>
          </span>
        </Tooltip>
      ))}
    </span>
  )
}

export default function AppointmentsModal({
  open,
  onClose,
  hn,
  patientName,
}: {
  open: boolean
  onClose: () => void
  hn: string | null
  patientName?: string | null
}) {
  const [items, setItems] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [view, setView] = useState<View>('list')
  /** เดือนที่ปฏิทินเปิดอยู่ — ตั้งให้ตามนัดที่ใกล้ปัจจุบันที่สุดตอนโหลดเสร็จ */
  const [month, setMonth] = useState<Dayjs>(dayjs())
  /** HN ที่โหลดไว้แล้ว — เปลี่ยนผู้ป่วยแล้วต้องโหลดใหม่ */
  const [loadedHn, setLoadedHn] = useState<string | null>(null)

  const load = async () => {
    if (!hn) return
    setLoading(true)
    setError('')
    setItems([])
    try {
      const res = await apiFetch(`/api/his/appointments?hn=${hn}`)
      const json = await res.json()
      if (!res.ok || !json.success) {
        setError(json.message ?? 'ดึงประวัตินัดหมายไม่สำเร็จ')
        return
      }
      const list = json.appointments as Appointment[]
      setItems(list)
      setLoadedHn(hn)
      // เปิดปฏิทินที่เดือนของนัดข้างหน้าที่ใกล้ที่สุด ถ้าไม่มีก็เดือนของนัดล่าสุด
      // — คนไข้ที่หยุดมาแล้วสองปี ถ้าเปิดที่เดือนนี้จะเห็นปฏิทินว่างเปล่า
      // (รายการเรียงวันใหม่ไปเก่า จึงไล่กลับหลังเพื่อเจอนัดข้างหน้าที่ใกล้ที่สุด)
      const today = dayjs().format('YYYY-MM-DD')
      const upcoming = [...list].reverse().find(item => item.date >= today)
      const anchor = upcoming ?? list[0]
      if (anchor) setMonth(dayjs(anchor.date))
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setLoading(false)
    }
  }

  // โหลดตอนลิ้นชักถูกเปิดจริงเท่านั้น — afterOpenChange ทำงานหลัง render
  // จึงไม่ใช่การ setState ตรง ๆ ใน effect body
  const handleOpenChange = (visible: boolean) => {
    if (visible && hn && hn !== loadedHn) void load()
  }

  /** นัดของแต่ละวัน ใช้วาดในช่องปฏิทิน — คีย์เป็น 'YYYY-MM-DD' ตรงกับที่ API ส่งมา */
  const byDate = useMemo(() => {
    const map = new Map<string, Appointment[]>()
    for (const item of items) {
      const same = map.get(item.date)
      if (same) same.push(item)
      else map.set(item.date, [item])
    }
    return map
  }, [items])

  const counts = useMemo(() => {
    const tally: Partial<Record<AppointmentStatus, number>> = {}
    for (const item of items) tally[item.status] = (tally[item.status] ?? 0) + 1
    return tally
  }, [items])

  const columns: ColumnsType<Appointment> = [
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
      title: 'วันนัด',
      dataIndex: 'date',
      key: 'date',
      width: 120,
      render: (value: string) => <span className="font-mono text-xs">{toThaiDate(value)}</span>,
    },
    {
      title: 'เวลา',
      key: 'time',
      width: 110,
      render: (_: unknown, row) => (
        <span className="font-mono text-xs">{timeRange(row.timeFrom, row.timeTo)}</span>
      ),
    },
    {
      title: 'สถานะ',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (value: AppointmentStatus) => (
        <Tag color={STATUS_META[value].color} className="mr-0!">
          {STATUS_META[value].label}
        </Tag>
      ),
    },
    {
      title: 'คลินิก',
      dataIndex: 'clinicName',
      key: 'clinicName',
      width: 190,
      render: (value: string | null) => value ?? '—',
    },
    {
      // ชื่อแผนกซ้ำกับชื่อคลินิกเป็นส่วนใหญ่ แต่ไม่เสมอไป (ไตเทียม → ห้องฟอกไต 2)
      // ซึ่งเป็นห้องที่คนไข้ต้องไปจริง จึงต้องมีทั้งสองช่อง
      title: 'แผนก/ห้อง',
      dataIndex: 'departmentName',
      key: 'departmentName',
      width: 190,
      render: (value: string | null) => value ?? '—',
    },
    {
      title: 'แพทย์',
      dataIndex: 'doctorName',
      key: 'doctorName',
      width: 180,
      render: (value: string | null) => value ?? '—',
    },
    {
      title: 'เหตุผลที่นัด',
      dataIndex: 'cause',
      key: 'cause',
      width: 150,
      render: (value: string | null) => value ?? '—',
    },
    {
      title: 'ต้องทำ',
      key: 'marks',
      width: 150,
      render: (_: unknown, row) =>
        row.hasLab || row.hasXray || row.hasOperation ? (
          <Marks item={row} />
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: 'หมายเหตุ',
      dataIndex: 'note',
      key: 'note',
      render: (value: string | null) =>
        value ? <span className="text-xs">{value}</span> : <Text type="secondary">—</Text>,
    },
    {
      title: 'วันออกใบนัด',
      dataIndex: 'issuedDate',
      key: 'issuedDate',
      width: 120,
      render: (value: string | null) => (
        <span className="font-mono text-xs text-ink-3">{toThaiDate(value)}</span>
      ),
    },
  ]

  return (
    <Modal
      title={
        hn ? `ประวัตินัดหมาย · HN ${hn}${patientName ? ` · ${patientName}` : ''}` : 'ประวัตินัดหมาย'
      }
      open={open}
      afterOpenChange={handleOpenChange}
      onCancel={onClose}
      footer={null}
      width={1180}
      destroyOnHidden
    >
      {error && <Alert type="error" showIcon title={error} className="mb-3" />}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Segmented<View>
          value={view}
          onChange={setView}
          options={[
            { label: 'รายการ', value: 'list' },
            { label: 'ปฏิทิน', value: 'calendar' },
          ]}
        />
        {/* นับให้เห็นตั้งแต่ยังไม่ต้องไล่อ่าน — 'ไม่มาตามนัด' เป็นตัวเลขที่ใช้คุยกับคนไข้ได้ */}
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(STATUS_META) as AppointmentStatus[])
            .filter(key => (counts[key] ?? 0) > 0)
            .map(key => (
              <Tag key={key} color={STATUS_META[key].color} className="mr-0!">
                {STATUS_META[key].label} {counts[key]}
              </Tag>
            ))}
        </div>
        <Text type="secondary" className="ml-auto text-xs">
          ย้อนหลัง 3 ปี ถึงล่วงหน้า 2 ปี · สูงสุด 400 นัด
        </Text>
      </div>

      {/* โครงร่างต่างกันตามมุมมอง — แถวตารางกับตารางปฏิทินคนละรูปร่างกัน
          ถ้าใช้วงกลมหมุนครอบทั้งสองแบบเหมือนเดิม จะไม่ได้บอกอะไรเลยว่ากำลังจะได้
          รายการหรือปฏิทิน ทั้งที่ผู้ใช้เพิ่งกดเลือกไปเอง */}
      <>
        {view === 'list' ? (
          <Table<Appointment>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={items}
            pagination={{ pageSize: 25, showSizeChanger: false, hideOnSinglePage: true }}
            scroll={{ x: 'max-content', y: 460 }}
            locale={{
              emptyText: loading ? (
                <TableRowsSkeleton columns={columns.length} rows={8} />
              ) : (
                <Empty description="ไม่มีประวัตินัดหมาย" />
              ),
            }}
          />
        ) : loading ? (
          <CalendarSkeleton />
        ) : items.length === 0 ? (
          <Empty description="ไม่มีประวัตินัดหมาย" />
        ) : (
          // ปฏิทินเต็มเดือนสูงกว่าจอโน้ตบุ๊กเมื่อรวมกับหัวลิ้นชัก จึงให้เลื่อนในกรอบ
          // แทนที่จะดันลิ้นชักยาวเลยจอไป
          <div className="max-h-[70vh] overflow-y-auto">
            <Calendar
              value={month}
              onChange={setMonth}
              onPanelChange={setMonth}
              // ปฏิทินแบบเต็มของ antd (fullscreen ซึ่งเป็นค่าตั้งต้น) — โหมดย่อมีช่องวัน
              // สูงไม่ถึงยี่สิบพิกเซล เนื้อในช่องจึงถูกตัดทิ้งแทบทั้งหมด ส่วนแบบเต็มออกแบบมา
              // ให้ใส่รายการในช่องวันได้จริง และมีกรอบเลื่อนในช่องให้เองเมื่อนัดวันนั้นมีหลายใบ
              cellRender={(current, info) => {
                if (info.type !== 'date') return info.originNode
                const same = byDate.get(current.format('YYYY-MM-DD'))
                if (!same) return info.originNode
                return (
                  <ul className="m-0 list-none p-0 leading-tight">
                    {same.map(item => (
                      <li key={item.id} className="mb-0.5 text-[11px]">
                        <Badge
                          status={STATUS_META[item.status].dot}
                          text={
                            <span className="text-[11px]">
                              {item.timeFrom ? `${item.timeFrom} ` : ''}
                              {item.clinicName ?? item.departmentName ?? 'ไม่ระบุคลินิก'}
                            </span>
                          }
                        />
                        {/* ชื่อแพทย์อยู่บรรทัดของตัวเอง ไม่ต่อท้ายคลินิก — ต่อกันแล้วยาวเกิน
                            ช่องปฏิทินจนถูกตัดทิ้งทั้งคู่ และชื่อแพทย์คือส่วนที่หายไปก่อน */}
                        {item.doctorName && (
                          <div className="truncate pl-2.5 text-[10px] text-ink-3">
                            {item.doctorName}
                        </div>
                      )}
                      {(item.hasLab || item.hasXray || item.hasOperation) && (
                        <div className="pl-2.5">
                          <Marks item={item} />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )
            }}
          />
          </div>
        )}
      </>
    </Modal>
  )
}
