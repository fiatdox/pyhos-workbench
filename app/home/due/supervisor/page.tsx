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
  Empty,
  Input,
  Modal,
  Segmented,
  Select,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  EyeOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import LabCultureModal from '@/app/home/lab-culture-modal'
import ReferenceTabs from '../reference-tabs'
import RequestDetail from '../request-detail'
import { sexLabel, STATUS_META, toThaiDate } from '../display'
import {
  MOCK_REQUESTS,
  MOCK_SUPERVISORS,
  needsSupervisor,
  type DueStatus,
  type MockRequest,
} from '../mock-data'

const { Text, Title } = Typography
const { TextArea } = Input

/**
 * คำขอที่ต้องผ่านโต๊ะนี้ — เฉพาะใบที่มียาซึ่งต้องขออนุมัติอย่างน้อยหนึ่งตัว
 *
 * ใบที่ขอยาทั่วไปเภสัชกรรับรายการได้เอง ไม่เคยเดินทางมาถึงแพทย์ผู้กำกับ
 * ถ้าเอามาแสดงด้วยจะกลายเป็นคิวปลอมที่กดอะไรไม่ได้ทั้งคิว
 */
function needsApprovalDesk(request: MockRequest): boolean {
  return request.drugs.some(drug => needsSupervisor(drug.name))
}

type Filter = 'queue' | 'decided' | 'all'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'queue', label: 'รออนุมัติ' },
  { value: 'decided', label: 'ตัดสินแล้ว' },
  { value: 'all', label: 'ทั้งหมด' },
]

/** ตัดสินไปแล้ว = แพทย์ผู้กำกับลงความเห็นแล้ว ไม่ว่าเภสัชกรจะรับรายการต่อหรือยัง */
const DECIDED: DueStatus[] = ['approved', 'denied', 'accepted', 'rejected']

export default function DueSupervisorPage() {
  const [requests, setRequests] = useState<MockRequest[]>(MOCK_REQUESTS)
  const [filter, setFilter] = useState<Filter>('queue')
  const [keyword, setKeyword] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  /** ผู้อนุมัติ — เลือกเองเพราะยังไม่มีระบบสิทธิ์ตามบทบาทผู้ใช้ */
  const [supervisor, setSupervisor] = useState<string | null>(null)
  const [labCulturePatient, setLabCulturePatient] = useState<MockRequest | null>(null)

  const desk = useMemo(() => requests.filter(needsApprovalDesk), [requests])

  const counts = useMemo(
    () => ({
      queue: desk.filter(request => request.status === 'awaiting_approval').length,
      decided: desk.filter(request => DECIDED.includes(request.status)).length,
      all: desk.length,
    }),
    [desk],
  )

  const visible = useMemo(() => {
    const term = keyword.trim().toLowerCase()
    return desk.filter(request => {
      if (filter === 'queue' && request.status !== 'awaiting_approval') return false
      if (filter === 'decided' && !DECIDED.includes(request.status)) return false
      if (!term) return true
      return [request.id, request.hn, request.patientName, ...request.drugs.map(drug => drug.name)]
        .join(' ')
        .toLowerCase()
        .includes(term)
    })
  }, [desk, filter, keyword])

  const opened = requests.find(request => request.id === openId) ?? null

  const closeDetail = () => {
    setOpenId(null)
    setNote('')
  }

  /**
   * บันทึกผลการตัดสิน
   *
   * เก็บชื่อผู้อนุมัติและเวลาไว้ด้วยเสมอ ไม่ใช่แค่สถานะ เพราะเภสัชกรที่รับ
   * รายการต่อต้องรู้ว่าใครอนุมัติและอนุมัติด้วยเงื่อนไขอะไร (เช่นให้กี่วัน)
   */
  const decide = (id: string, status: 'approved' | 'denied') => {
    if (!supervisor) return
    setRequests(prev =>
      prev.map(item =>
        item.id === id
          ? {
              ...item,
              status,
              supervisorName: supervisor,
              supervisorNote: note.trim() === '' ? null : note.trim(),
              supervisorDecidedAt: dayjs().format('YYYY-MM-DD HH:mm'),
            }
          : item,
      ),
    )
    closeDetail()
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
      width: 210,
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
          {/* ใบหนึ่งอาจขอหลายตัวแต่ต้องอนุมัติแค่บางตัว — ตัวที่ต้องตัดสินขึ้นก่อน
              และติดป้ายไว้ ไม่งั้นแพทย์ผู้กำกับต้องไล่อ่านเองว่าตัวไหนคือเรื่องของตน */}
          {[...drugs]
            .sort((a, b) => Number(needsSupervisor(b.name)) - Number(needsSupervisor(a.name)))
            .map(drug => {
              const restricted = needsSupervisor(drug.name)
              return (
                <div key={drug.id}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`text-xs ${restricted ? 'text-ink' : 'text-ink-3'}`}>
                      {drug.name}
                    </span>
                    {restricted && (
                      <Tag color="orange" className="mr-0!">
                        ต้องอนุมัติ
                      </Tag>
                    )}
                  </div>
                  <Text type="secondary" className="text-[11px]">
                    {drug.dose}
                  </Text>
                </div>
              )
            })}
          {row.allergies.length > 0 && (
            <div className="flex items-center gap-1 text-[11px] font-semibold text-danger">
              <WarningOutlined /> แพ้ยา: {row.allergies.join(', ')}
            </div>
          )}
        </div>
      ),
    },
    {
      // ค่าไตอยู่ในตารางเลย เพราะเป็นตัวตัดสินหลักของยากลุ่มนี้ (ต้องปรับขนาดตาม CrCl)
      // ถ้าไม่ใส่ ต้องเปิดลิ้นชักทีละใบเพื่อดูเลขตัวเดียว
      title: 'ค่าไต',
      dataIndex: 'crcl',
      width: 130,
      render: (_: string, row) =>
        row.awaitingCreatinine ? (
          <Tag color="gold" className="mr-0!">
            รอผล
          </Tag>
        ) : (
          <div className="text-[11px] leading-relaxed text-ink">
            <div>Cr {row.cr}</div>
            <div>CrCl {row.crcl}</div>
            <Text type="secondary" className="text-[11px]">
              {toThaiDate(row.creatinineAt)}
            </Text>
          </div>
        ),
    },
    {
      title: 'สถานะ',
      dataIndex: 'status',
      width: 160,
      render: (status: DueStatus, row) => (
        <div className="space-y-1">
          <Tag color={STATUS_META[status].color} className="mr-0!">
            {STATUS_META[status].label}
          </Tag>
          {row.supervisorName && (
            <Text type="secondary" className="block text-[11px]">
              {row.supervisorName.replace(/\s*\(.*\)$/, '')}
              {row.supervisorDecidedAt && ` · ${toThaiDate(row.supervisorDecidedAt)}`}
            </Text>
          )}
        </div>
      ),
    },
    {
      title: '',
      dataIndex: 'id',
      key: 'action',
      width: 120,
      render: (id: string) => (
        <Button size="small" icon={<EyeOutlined />} onClick={() => setOpenId(id)}>
          รายละเอียด
        </Button>
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
            { title: 'แพทย์ผู้กำกับการใช้ยา' },
          ]}
        />
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          <SafetyCertificateOutlined /> งานแพทย์ผู้กำกับการใช้ยา
        </Title>
        <div className="h-px w-24 bg-linear-to-r from-violet-400/70 to-transparent" />
      </section>

      <section className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={filter}
          onChange={value => setFilter(value as Filter)}
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
        <Input
          allowClear
          className="w-full sm:w-72"
          value={keyword}
          onChange={event => setKeyword(event.target.value)}
          placeholder="เลขคำขอ / HN / ชื่อ / ยา"
          prefix={<SearchOutlined className="text-ink-3" />}
        />
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
            emptyText: <Empty description="ไม่มีคำขอในกลุ่มนี้" />,
          }}
        />
      </section>

      {/* ───────── รายละเอียดคำขอ ─────────
          ใช้ Modal ไม่ใช่ลิ้นชัก เพราะข้อมูลที่ต้องดูก่อนอนุมัติมีทั้งกราฟค่าไต
          ตารางผลเพาะเชื้อ และประวัติยาต้าน ซึ่งเป็นตารางแนวนอนกว้าง ๆ
          ลิ้นชัก 720px บีบจนต้องเลื่อนซ้ายขวาอ่านทีละคอลัมน์

          ข้อมูลประกอบตรึงไว้บนสุด ใช้ตัวเดียวกับที่เภสัชกรใช้ตอนประเมิน */}
      <Modal
        open={opened != null}
        onCancel={closeDetail}
        width="94vw"
        style={{ maxWidth: 1400, top: 16 }}
        // padding เองเพื่อให้แถบ sticky ใช้ -mx-6 px-6 กินเต็มความกว้างได้
        styles={{
          body: { maxHeight: 'calc(100vh - 220px)', overflow: 'auto', padding: '0 24px' },
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
            <DecisionPanel
              request={opened}
              note={note}
              setNote={setNote}
              supervisor={supervisor}
              setSupervisor={setSupervisor}
              decide={decide}
            />
          )
        }
      >
        {opened && (
          <div className="space-y-5">
            <ReferenceTabs
              request={opened}
              onOpenCulture={() => setLabCulturePatient(opened)}
              chartHeight={240}
            />
            <RequestDetail request={opened} onOpenLabCulture={setLabCulturePatient} />
          </div>
        )}
      </Modal>

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
 * ปุ่มตัดสิน — อยู่ท้าย modal ให้อยู่กับที่ ไม่เลื่อนหายไปพร้อมเนื้อหา
 *
 * ต้องเลือกผู้อนุมัติก่อนถึงกดได้ และการไม่อนุมัติต้องมีเหตุผลเสมอ —
 * แพทย์ผู้สั่งกับเภสัชกรต้องรู้ว่าทำไมถึงไม่ให้ใช้ ไม่งั้นจะกลับมาถามซ้ำทุกใบ
 * ส่วนการอนุมัติเขียนเงื่อนไขได้ (เช่นให้กี่วัน ให้ปรับขนาดตาม CrCl) แต่ไม่บังคับ
 */
function DecisionPanel({
  request,
  note,
  setNote,
  supervisor,
  setSupervisor,
  decide,
}: {
  request: MockRequest
  note: string
  setNote: (value: string) => void
  supervisor: string | null
  setSupervisor: (value: string) => void
  decide: (id: string, status: 'approved' | 'denied') => void
}) {
  if (request.status !== 'awaiting_approval') {
    return (
      <Text type="secondary" className="text-xs">
        คำขอนี้ตัดสินไปแล้ว — ผลการตัดสินแสดงอยู่ด้านบน
      </Text>
    )
  }

  const restricted = request.drugs.filter(drug => needsSupervisor(drug.name))

  return (
    <div className="space-y-3">
      {/* บอกให้ชัดว่ากำลังตัดสินยาตัวไหน — ใบที่ขอหลายตัวไม่ได้ต้องอนุมัติทุกตัว */}
      <Alert
        type="info"
        showIcon
        title={`กำลังพิจารณา ${restricted.length} รายการ`}
        description={
          <ul className="mt-0.5 list-inside list-disc text-xs leading-relaxed">
            {restricted.map(drug => (
              <li key={drug.id}>
                {drug.name} — {drug.dose}
              </li>
            ))}
          </ul>
        }
      />

      <Select
        className="w-full"
        placeholder="เลือกแพทย์ผู้กำกับที่ตัดสิน"
        value={supervisor}
        onChange={setSupervisor}
        options={MOCK_SUPERVISORS.map(name => ({ value: name, label: name }))}
      />

      <TextArea
        value={note}
        onChange={event => setNote(event.target.value)}
        placeholder="เงื่อนไขการอนุมัติ หรือเหตุผลที่ไม่อนุมัติ"
        autoSize={{ minRows: 2, maxRows: 5 }}
      />

      <div className="flex flex-wrap gap-2">
        <Button
          type="primary"
          icon={<CheckCircleOutlined />}
          disabled={supervisor == null}
          onClick={() => decide(request.id, 'approved')}
        >
          อนุมัติ
        </Button>
        <Button
          danger
          icon={<CloseCircleOutlined />}
          disabled={supervisor == null || note.trim() === ''}
          onClick={() => decide(request.id, 'denied')}
        >
          ไม่อนุมัติ
        </Button>
        {supervisor == null && (
          <Text type="secondary" className="self-center text-[11px]">
            เลือกผู้ตัดสินก่อน
          </Text>
        )}
        {supervisor != null && note.trim() === '' && (
          <Text type="secondary" className="self-center text-[11px]">
            การไม่อนุมัติต้องระบุเหตุผล
          </Text>
        )}
      </div>
    </div>
  )
}
