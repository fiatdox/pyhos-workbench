'use client'
import { useRef, useState } from 'react'
import { Alert, Descriptions, Empty, Modal, Spin, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { apiFetch } from '@/lib/client/session'
import type { VisitDetail, VisitDiagnosis, VisitOrder } from '@/lib/his/visit-detail'

const { Text } = Typography

/** แปลง 'YYYY-MM-DD' เป็น วว/ดด/ปปปป พ.ศ. */
function toThaiDate(value: string | null): string {
  if (!value) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return value
  const [, year, month, day] = match
  return `${day}/${month}/${Number(year) + 543}`
}

/**
 * รายละเอียดการมารับบริการหนึ่งครั้ง สำหรับกดดูจากรายงานตัวชี้วัด RDU
 *
 * ดึงจาก /api/his/visit-detail ซึ่งหน้าประวัติการได้รับยาใช้อยู่แล้ว — ปลายทาง
 * ผูก hn ไว้ในทุกคิวรี เดา vn ของคนอื่นแล้วเปิดดูข้ามคนไม่ได้
 *
 * แสดงแค่ส่วนที่ตอบคำถามของรายงาน (วินิจฉัยอะไร ได้รับยาอะไร) ไม่ได้ยกมาทั้งหน้า
 * เหมือนหน้าประวัติการได้รับยา — ผลแล็บกับบันทึกตรวจร่างกายไม่เกี่ยวกับการทบทวน
 * ว่าเคสนี้ได้รับยาในทะเบียนหรือไม่ และการเปิดข้อมูลผู้ป่วยเกินที่งานต้องใช้
 * ก็ไม่ควรทำ
 *
 * สิ่งที่ต่างจากหน้านั้นคือไฮไลต์บรรทัดยาที่อยู่ในทะเบียนของตัวชี้วัด ให้เห็นทันทีว่า
 * แถวไหนคือยาที่ตัวชี้วัดนับ ไม่ต้องไล่เทียบชื่อยากับทะเบียนเอง
 *
 * ใช้ร่วมกันทุกตัวชี้วัด ป้ายกำกับยาจึงรับเข้ามาเป็น prop — ตัวชี้วัดโรคหืดเรียกว่า
 * "ยา ICS" ส่วนโรคติดเชื้อทางเดินหายใจส่วนบนเรียกว่า "ยาปฏิชีวนะ"
 */
export default function VisitDetailModal({
  open,
  onClose,
  hn,
  vn,
  patientName,
  drugIcodes,
  drugLabel,
}: {
  open: boolean
  onClose: () => void
  hn: string | null
  vn: string | null
  patientName?: string | null
  /** icode ของยาในทะเบียนของตัวชี้วัดข้อนี้ — ใช้ไฮไลต์บรรทัดยา */
  drugIcodes: string[]
  /** ป้ายที่ติดบนบรรทัดยาที่อยู่ในทะเบียน เช่น 'ยา ICS' */
  drugLabel: string
}) {
  const [visit, setVisit] = useState<VisitDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  /** vn ที่โหลดไว้แล้ว — เปิดแถวเดิมซ้ำจะได้ไม่ยิงคำขอใหม่ */
  const [loadedVn, setLoadedVn] = useState<string | null>(null)
  /** ลำดับคำขอ — ใช้ทิ้งผลของแถวก่อนหน้าที่ตอบกลับมาช้ากว่าแถวที่เปิดอยู่ */
  const seq = useRef(0)

  const load = async () => {
    if (!hn || !vn) return
    const mine = ++seq.current
    setLoading(true)
    setError('')
    setVisit(null)
    try {
      const res = await apiFetch(`/api/his/visit-detail?hn=${hn}&vn=${vn}`)
      const json = await res.json()
      if (mine !== seq.current) return
      if (!res.ok || !json.success) {
        setError(json.message ?? 'ดึงรายละเอียดการมารับบริการไม่สำเร็จ')
        return
      }
      setVisit(json.visit as VisitDetail)
      setLoadedVn(vn)
    } catch {
      if (mine === seq.current) setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }

  // โหลดตอน modal ถูกเปิดจริงเท่านั้น — afterOpenChange ทำงานหลัง render
  // จึงไม่ใช่การ setState ตรง ๆ ใน effect body (แบบเดียวกับ lab-culture-modal)
  const handleOpenChange = (visible: boolean) => {
    if (visible && vn && vn !== loadedVn) void load()
  }

  // ใช้ Set เทียบ ไม่ใช่ includes ในทุกแถว — รายการยาหนึ่งครั้งยาวได้หลายสิบบรรทัด
  const registrySet = new Set(drugIcodes)

  const diagnosisColumns: ColumnsType<VisitDiagnosis> = [
    {
      title: 'รหัส',
      dataIndex: 'icd10',
      width: 90,
      render: (code: string) => <span className="font-mono text-xs">{code}</span>,
    },
    { title: 'ชื่อโรค', dataIndex: 'name', render: (name: string | null) => name ?? '—' },
    { title: 'ประเภท', dataIndex: 'typeName', width: 230, render: (v: string | null) => v ?? '—' },
    { title: 'แพทย์', dataIndex: 'doctor', width: 180, render: (v: string | null) => v ?? '—' },
  ]

  const orderColumns: ColumnsType<VisitOrder> = [
    {
      title: 'รายการ',
      dataIndex: 'name',
      render: (name: string, row) => (
        <span className="text-xs">
          {name}
          {registrySet.has(row.key) && (
            <Tag color="green" className="ml-1.5 mr-0!">
              {drugLabel}
            </Tag>
          )}
        </span>
      ),
    },
    { title: 'จำนวน', dataIndex: 'qty', width: 90, align: 'right', className: 'qty' },
    {
      title: 'หมวดค่าใช้จ่าย',
      dataIndex: 'incomeName',
      width: 260,
      render: (v: string | null) => v ?? '—',
    },
  ]

  return (
    <Modal
      title={
        <span>
          รายละเอียดการมารับบริการ
          {patientName && <Text type="secondary" className="ml-2 text-xs">{patientName}</Text>}
        </span>
      }
      open={open}
      onCancel={onClose}
      afterOpenChange={handleOpenChange}
      footer={null}
      width="92vw"
      style={{ top: 24, maxWidth: 1200 }}
      styles={{ body: { maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' } }}
    >
      <Spin spinning={loading}>
        {error && <Alert type="error" showIcon title={error} className="mb-3" />}
        {visit && (
          <div className="flex flex-col gap-5">
            <Descriptions
              size="small"
              bordered
              column={{ xs: 1, sm: 2, lg: 3 }}
              items={[
                {
                  key: 'date',
                  label: 'วันที่มารับบริการ',
                  children:
                    [toThaiDate(visit.header.date), visit.header.time].filter(Boolean).join(' ') ||
                    '—',
                },
                { key: 'dep', label: 'ห้องตรวจ', children: visit.header.department ?? '—' },
                { key: 'clinic', label: 'แผนก', children: visit.header.clinic ?? '—' },
                { key: 'doctor', label: 'แพทย์ผู้ตรวจ', children: visit.header.doctor ?? '—' },
                { key: 'payment', label: 'สิทธิการรักษา', children: visit.header.payment ?? '—' },
                { key: 'vn', label: 'VN', children: <span className="font-mono">{visit.header.vn}</span> },
              ]}
            />

            {visit.chiefComplaint && (
              <section>
                <div className="mb-1.5 text-sm font-semibold text-ink">อาการสำคัญ</div>
                <div className="rounded-lg border border-line bg-panel p-3 text-sm whitespace-pre-wrap">
                  {visit.chiefComplaint}
                </div>
              </section>
            )}

            <section>
              <div className="mb-1.5 text-sm font-semibold text-ink">
                การวินิจฉัย ({visit.diagnoses.length})
              </div>
              <Table<VisitDiagnosis>
                rowKey={row => `${row.icd10}-${row.typeName ?? ''}`}
                size="small"
                columns={diagnosisColumns}
                dataSource={visit.diagnoses}
                pagination={false}
                scroll={{ x: 'max-content' }}
                locale={{ emptyText: <Empty description="ไม่มีการวินิจฉัยที่บันทึกไว้" /> }}
              />
            </section>

            <section>
              <div className="mb-1.5 text-sm font-semibold text-ink">
                รายการที่ได้รับ ({visit.orders.length})
              </div>
              <Table<VisitOrder>
                rowKey="key"
                size="small"
                columns={orderColumns}
                dataSource={visit.orders}
                pagination={false}
                scroll={{ x: 'max-content', y: 360 }}
                // ไฮไลต์ทั้งแถว ไม่ใช่แค่ติดป้าย — ตารางยาวหลายสิบบรรทัด
                // ป้ายเล็ก ๆ กลางตารางหาไม่เจอถ้าไม่ไล่อ่านทีละบรรทัด
                // ต้องลงสีที่ td ไม่ใช่ tr เพราะ antd ทาสีพื้นของ td ไว้แล้ว สีที่ tr จะถูกบัง
                rowClassName={row => (registrySet.has(row.key) ? '[&>td]:bg-accent-soft!' : '')}
                locale={{ emptyText: <Empty description="ไม่มีรายการในครั้งนี้" /> }}
              />
            </section>
          </div>
        )}
      </Spin>
    </Modal>
  )
}
