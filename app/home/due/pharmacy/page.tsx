'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ยังทำที่ app/home/layout.tsx ซึ่งเป็น Server Component)
import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Alert,
  Badge,
  Breadcrumb,
  Button,
  DatePicker,
  Drawer,
  Empty,
  Input,
  Segmented,
  Select,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  CheckCircleOutlined,
  ClearOutlined,
  CloseCircleOutlined,
  ExperimentOutlined,
  LockOutlined,
  SearchOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import LabCultureModal from '@/app/home/lab-culture-modal'
import dayjs, { type Dayjs } from 'dayjs'
import buddhistEra from 'dayjs/plugin/buddhistEra'
import EvaluationModal from './evaluation-modal'
import RequestDetail from '../request-detail'
import { sexLabel, STATUS_META, toThaiDate } from '../display'
import {
  evaluatedCount,
  isFullyEvaluated,
  MOCK_REQUESTS,
  needsSupervisor,
  type DrugEvaluation,
  type DueStatus,
  type MockRequest,
} from '../mock-data'

// เปิด token BBBB (ปี พ.ศ.) ให้ dayjs — ถ้าไม่ extend ปฏิทินจะพิมพ์คำว่า BBBB ออกมาตรง ๆ
dayjs.extend(buddhistEra)

const { RangePicker } = DatePicker

const { Text, Title } = Typography
const { TextArea } = Input

type Filter = 'queue' | 'awaiting' | 'done' | 'all'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'queue', label: 'รอรับรายการ' },
  { value: 'awaiting', label: 'รออนุมัติ' },
  { value: 'done', label: 'จบแล้ว' },
  { value: 'all', label: 'ทั้งหมด' },
]

function inFilter(request: MockRequest, filter: Filter): boolean {
  const meta = STATUS_META[request.status]
  if (filter === 'all') return true
  if (filter === 'queue') return meta.actionable
  if (filter === 'awaiting') return request.status === 'awaiting_approval'
  return meta.done
}

export default function DuePharmacyPage() {
  const [requests, setRequests] = useState<MockRequest[]>(MOCK_REQUESTS)
  const [filter, setFilter] = useState<Filter>('queue')
  const [keyword, setKeyword] = useState('')
  /** กรองสถานะแบบเจาะจง — ว่างแปลว่าใช้กลุ่มจากแท็บแทน */
  const [statuses, setStatuses] = useState<DueStatus[]>([])
  const [doctors, setDoctors] = useState<string[]>([])
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  /** คำขอที่กำลังเปิดดูผลเพาะเชื้ออยู่ — เก็บทั้งก้อนเพราะต้องใช้ทั้ง hn และชื่อ */
  const [labCulturePatient, setLabCulturePatient] = useState<MockRequest | null>(null)
  /** ยาที่กำลังกรอกแบบประเมิน — ประเมินทีละตัว ไม่ใช่ทีละใบ */
  const [evalTarget, setEvalTarget] = useState<{ requestId: string; drugId: number } | null>(null)

  const evalRequest = requests.find(item => item.id === evalTarget?.requestId) ?? null
  const evalDrug = evalRequest?.drugs.find(drug => drug.id === evalTarget?.drugId) ?? null

  const saveEvaluation = (drugId: number, evaluation: DrugEvaluation) => {
    if (!evalTarget) return
    setRequests(prev =>
      prev.map(item =>
        item.id === evalTarget.requestId
          ? {
              ...item,
              drugs: item.drugs.map(drug => (drug.id === drugId ? { ...drug, evaluation } : drug)),
            }
          : item,
      ),
    )
    setEvalTarget(null)
  }

  /** รายชื่อแพทย์ผู้สั่งเท่าที่มีคำขอจริง — ไม่ได้ไล่จากทะเบียนแพทย์ทั้งโรงพยาบาล */
  const doctorOptions = useMemo(
    () =>
      Array.from(new Set(requests.map(request => request.requesterName)))
        .sort((a, b) => a.localeCompare(b, 'th'))
        .map(name => ({ value: name, label: name })),
    [requests],
  )

  const filtered = keyword.trim() !== '' || statuses.length > 0 || doctors.length > 0 || range != null

  const clearFilters = () => {
    setKeyword('')
    setStatuses([])
    setDoctors([])
    setRange(null)
  }

  /**
   * แท็บกับช่องเลือกสถานะกรองแกนเดียวกัน ถ้าปล่อยให้ทำงานพร้อมกันจะเลือก
   * แท็บ "รอรับรายการ" คู่กับสถานะ "รับรายการแล้ว" แล้วได้ผลว่างโดยไม่รู้สาเหตุ
   * — เลือกอย่างหนึ่งจึงล้างอีกอย่างเสมอ
   */
  const pickTab = (value: Filter) => {
    setFilter(value)
    setStatuses([])
  }

  const pickStatuses = (value: DueStatus[]) => {
    setStatuses(value)
    if (value.length > 0) setFilter('all')
  }

  const counts = useMemo(
    () => ({
      queue: requests.filter(r => STATUS_META[r.status].actionable).length,
      awaiting: requests.filter(r => r.status === 'awaiting_approval').length,
      done: requests.filter(r => STATUS_META[r.status].done).length,
      all: requests.length,
    }),
    [requests],
  )

  const visible = useMemo(() => {
    const term = keyword.trim().toLowerCase()
    // เทียบเฉพาะส่วนวันที่ ตัดเวลาทิ้ง — ไม่งั้นคำขอตอนบ่ายของวันสุดท้ายจะหลุดออก
    const from = range?.[0]?.format('YYYY-MM-DD') ?? null
    const to = range?.[1]?.format('YYYY-MM-DD') ?? null

    return requests.filter(request => {
      if (statuses.length > 0) {
        if (!statuses.includes(request.status)) return false
      } else if (!inFilter(request, filter)) {
        return false
      }

      if (doctors.length > 0 && !doctors.includes(request.requesterName)) return false

      const day = request.requestedAt.slice(0, 10)
      if (from && day < from) return false
      if (to && day > to) return false

      if (!term) return true
      // ค้นจากทุกช่องที่คนน่าจะใช้ค้น — เลขคำขอ HN ชื่อ และชื่อยา
      return [request.id, request.hn, request.patientName, ...request.drugs.map(d => d.name)]
        .join(' ')
        .toLowerCase()
        .includes(term)
    })
  }, [requests, filter, keyword, statuses, doctors, range])

  const opened = requests.find(request => request.id === openId) ?? null

  const decide = (id: string, status: DueStatus) => {
    setRequests(prev => prev.map(item => (item.id === id ? { ...item, status } : item)))
    setOpenId(null)
    setNote('')
  }

  const columns: ColumnsType<MockRequest> = [
    {
      title: 'เลขคำขอ',
      dataIndex: 'id',
      width: 130,
      render: (id: string, row) => (
        <div>
          <div className="font-mono text-xs font-semibold text-ink">{id}</div>
          <Text type="secondary" className="text-[11px]">
            {toThaiDate(row.requestedAt)}
          </Text>
        </div>
      ),
    },
    {
      title: 'ผู้ป่วย',
      dataIndex: 'patientName',
      width: 220,
      render: (name: string, row) => (
        <div>
          <div className="text-xs font-semibold text-ink">{name}</div>
          <Text type="secondary" className="text-[11px]">
            <span className="font-mono">{row.hn}</span> · {row.age} ปี {sexLabel(row.sex)}
            {row.wardName && ` · ${row.wardName}`}
          </Text>
        </div>
      ),
    },
    {
      title: 'ยาที่ขออนุมัติ',
      dataIndex: 'drugs',
      render: (drugs: MockRequest['drugs'], row) => (
        <div className="space-y-1">
          {drugs.map(drug => (
            <div key={drug.name}>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-ink">{drug.name}</span>
                {needsSupervisor(drug.name) && (
                  <Tag color="orange" className="mr-0!">
                    ต้องอนุมัติ
                  </Tag>
                )}
              </div>
              <Text type="secondary" className="text-[11px]">
                {drug.dose} · เริ่ม {toThaiDate(drug.startedAt)}
              </Text>
            </div>
          ))}
          {row.allergies.length > 0 && (
            <div className="flex items-center gap-1 text-[11px] font-semibold text-danger">
              <WarningOutlined /> แพ้ยา: {row.allergies.join(', ')}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'สถานะ',
      dataIndex: 'status',
      width: 170,
      render: (status: DueStatus, row) => (
        <div className="flex flex-wrap gap-1">
          <Tag color={STATUS_META[status].color} className="mr-0!">
            {STATUS_META[status].label}
          </Tag>
          {/* ใบที่รับรายการแล้วยังมีงานค้างอยู่จนกว่าจะประเมิน ต้องแยกให้เห็นจากตาราง
              ไม่ใช่ต้องเปิดเข้าไปดูทีละใบว่าใบไหนยังไม่ได้ประเมิน */}
          {status === 'accepted' &&
            (isFullyEvaluated(row) ? (
              <Tag color="green" className="mr-0!">
                ประเมินแล้ว
              </Tag>
            ) : (
              <Tag color="gold" className="mr-0!">
                รอประเมิน {evaluatedCount(row)}/{row.drugs.length}
              </Tag>
            ))}
        </div>
      ),
    },
  ]

  return (
    <>
      <section className="mb-6">
        <Breadcrumb
          className="mb-2"
          items={[
            { title: <Link href="/home/due">DUE ขออนุมัติใช้ยา</Link> },
            { title: 'งานเภสัชกรรม' },
          ]}
        />
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          <ExperimentOutlined /> งานเภสัชกรรม DUE
        </Title>
        <div className="h-px w-24 bg-linear-to-r from-violet-400/70 to-transparent" />
      </section>

      <section className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={filter}
          onChange={value => pickTab(value as Filter)}
          options={FILTERS.map(item => ({
            value: item.value,
            label: (
              <span className="px-1">
                {item.label}
                <Badge
                  count={counts[item.value]}
                  showZero
                  color={item.value === filter ? '#7c3aed' : '#94a3b8'}
                  className="ml-2"
                />
              </span>
            ),
          }))}
        />
        {filtered && (
          <Button size="small" type="link" icon={<ClearOutlined />} onClick={clearFilters}>
            ล้างตัวกรอง
          </Button>
        )}
      </section>

      {/* ตัวกรองละเอียด — 12 คอลัมน์ แบ่ง 4/3/3/2
          จอแคบกว่า xl ตกลงมาเป็น 2 คอลัมน์ แล้วเหลือ 1 คอลัมน์บนมือถือ */}
      <section className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-12">
        <label className="block xl:col-span-4">
          <span className="mb-1 block text-[11px] font-medium text-ink-3">ช่วงวันที่ส่งคำขอ</span>
          <RangePicker
            className="w-full"
            format="DD/MM/BBBB"
            value={range}
            onChange={value => setRange(value)}
            maxDate={dayjs()}
            allowEmpty={[true, true]}
          />
        </label>

        <label className="block xl:col-span-3">
          <span className="mb-1 block text-[11px] font-medium text-ink-3">แพทย์ที่สั่งรายการ</span>
          <Select
            mode="multiple"
            allowClear
            className="w-full"
            placeholder="ทุกคน"
            value={doctors}
            onChange={setDoctors}
            maxTagCount="responsive"
            options={doctorOptions}
          />
        </label>

        <label className="block xl:col-span-3">
          <span className="mb-1 block text-[11px] font-medium text-ink-3">
            สถานะ
            {statuses.length > 0 && (
              <span className="ml-1 font-normal opacity-70">(ทับแท็บด้านบน)</span>
            )}
          </span>
          <Select
            mode="multiple"
            allowClear
            className="w-full"
            placeholder="ตามแท็บด้านบน"
            value={statuses}
            onChange={pickStatuses}
            maxTagCount="responsive"
            options={(Object.keys(STATUS_META) as DueStatus[]).map(key => ({
              value: key,
              label: STATUS_META[key].label,
            }))}
          />
        </label>

        <label className="block sm:col-span-2 xl:col-span-2">
          <span className="mb-1 block text-[11px] font-medium text-ink-3">ค้นหา</span>
          <Input
            allowClear
            value={keyword}
            onChange={event => setKeyword(event.target.value)}
            placeholder="เลขคำขอ / HN / ชื่อ / ยา"
            prefix={<SearchOutlined className="text-ink-3" />}
          />
        </label>
      </section>

      <section className="data-sheet rounded-2xl border border-line bg-panel p-2 backdrop-blur">
        <Table<MockRequest>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={visible}
          pagination={false}
          scroll={{ x: 'max-content' }}
          onRow={row => ({ onClick: () => setOpenId(row.id), style: { cursor: 'pointer' } })}
          locale={{
            emptyText: (
              <Empty description={filtered ? 'ไม่พบคำขอตามตัวกรอง' : 'ไม่มีคำขอในกลุ่มนี้'}>
                {filtered && (
                  <Button size="small" icon={<ClearOutlined />} onClick={clearFilters}>
                    ล้างตัวกรอง
                  </Button>
                )}
              </Empty>
            ),
          }}
        />
      </section>

      {/* ───────── ลิ้นชักรายละเอียด ─────────
          แสดงทุกช่องที่แพทย์กรอกมาจากหน้า due/request เภสัชกรต้องเห็นครบ
          ก่อนตัดสินใจ ไม่ใช่เห็นแค่ชื่อยากับขนาด */}
      <Drawer
        placement="right"
        size={720}
        open={opened != null}
        onClose={() => {
          setOpenId(null)
          setNote('')
        }}
        title={
          opened && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm">{opened.id}</span>
              <Tag color={STATUS_META[opened.status].color} className="mr-0!">
                {STATUS_META[opened.status].label}
              </Tag>
            </div>
          )
        }
        footer={
          opened && (
            <DrawerActions
              request={opened}
              note={note}
              setNote={setNote}
              decide={decide}
            />
          )
        }
      >
        {opened && (
          <RequestDetail
            request={opened}
            onOpenLabCulture={setLabCulturePatient}
            onEvaluate={(request, drug) =>
              setEvalTarget({ requestId: request.id, drugId: drug.id })
            }
          />
        )}
      </Drawer>

      {/* แบบประเมินอยู่คนละไฟล์เพราะยาวและมีสถานะของตัวเอง
          ใช้ Modal ไม่ใช่ลิ้นชักซ้อนลิ้นชัก จะได้ยังเห็นข้อมูลคำขอด้านหลังไว้อ้างอิง */}
      <EvaluationModal
        open={evalTarget != null}
        request={evalRequest}
        drug={evalDrug}
        onClose={() => setEvalTarget(null)}
        onSave={saveEvaluation}
        onOpenCulture={() => evalRequest && setLabCulturePatient(evalRequest)}
      />

      <LabCultureModal
        open={labCulturePatient != null}
        onClose={() => setLabCulturePatient(null)}
        hn={labCulturePatient?.hn ?? null}
        patientName={labCulturePatient?.patientName}
      />
    </>
  )
}

/**
 * ปุ่มท้ายลิ้นชัก — เปิดให้กดเฉพาะคำขอที่ยังรอเภสัชกรอยู่
 *
 * คำขอที่ยังรอแพทย์ผู้กำกับต้องกดไม่ได้ และต้องบอกเหตุผลไว้ตรงนั้น
 * ไม่ใช่ซ่อนปุ่มเฉย ๆ เพราะคนใช้จะไม่รู้ว่าทำไมทำอะไรไม่ได้
 */
function DrawerActions({
  request,
  note,
  setNote,
  decide,
}: {
  request: MockRequest
  note: string
  setNote: (value: string) => void
  decide: (id: string, status: DueStatus) => void
}) {
  const meta = STATUS_META[request.status]

  if (request.status === 'awaiting_approval') {
    return (
      <Alert
        type="warning"
        showIcon
        icon={<LockOutlined />}
        title="รอแพทย์ผู้กำกับการใช้ยาอนุมัติก่อน"
        description={
          <span className="text-xs">
            คำขอนี้มียาที่ต้องผ่านการอนุมัติ เภสัชกรจะรับรายการได้หลังแพทย์ผู้กำกับอนุมัติแล้ว
          </span>
        }
      />
    )
  }

  // รับรายการแล้ว = จ่ายยาไปแล้ว ขั้นถัดไปคือตามไปประเมินการใช้จริง
  // ปุ่มประเมินอยู่ที่การ์ดยาแต่ละตัวด้านบน เพราะประเมินทีละตัว ไม่ใช่ทีละใบ
  if (request.status === 'accepted') {
    return (
      <Text type="secondary" className="text-xs">
        {isFullyEvaluated(request)
          ? 'ประเมินการใช้ยาครบทุกรายการแล้ว'
          : `รับรายการแล้ว ประเมินการใช้ยาไปแล้ว ${evaluatedCount(request)} จาก ${request.drugs.length} รายการ — กดปุ่มที่การ์ดยาด้านบนเพื่อประเมิน`}
      </Text>
    )
  }

  if (meta.done) {
    return (
      <Text type="secondary" className="text-xs">
        คำขอนี้ดำเนินการเรียบร้อยแล้ว
      </Text>
    )
  }

  return (
    <div className="space-y-3">
      <TextArea
        value={note}
        onChange={event => setNote(event.target.value)}
        placeholder="บันทึกผลการวิเคราะห์ของเภสัชกร (ไม่บังคับ)"
        autoSize={{ minRows: 2, maxRows: 4 }}
      />
      <div className="flex gap-2">
        <Button
          type="primary"
          icon={<CheckCircleOutlined />}
          onClick={() => decide(request.id, 'accepted')}
        >
          รับรายการ
        </Button>
        <Button
          danger
          icon={<CloseCircleOutlined />}
          onClick={() => decide(request.id, 'rejected')}
        >
          ไม่รับรายการ
        </Button>
      </div>
    </div>
  )
}


