'use client'
import { useState } from 'react'
import { Alert, Checkbox, Empty, Modal, Spin, Table, Typography } from 'antd'
import { apiFetch } from '@/lib/client/session'
import type { LabCultureItem } from '@/lib/his/lab-culture'

const { Text } = Typography

/**
 * สองค่านี้ซ้ำกับ lib/his/lab-culture.ts เพราะโมดูลนั้นเป็น server-only
 * จะ import ค่าจริงเข้ามาใน client component ไม่ได้ (import แบบ type เท่านั้นที่ทำได้)
 * ฝั่งเซิร์ฟเวอร์เป็นตัวจริง ค่าที่นี่ใช้แค่จัดหน้าจอ
 */
const MICROBIOLOGY_FORM = 'จุลชีววิทยา'
const EMPTY_RTF_LENGTH = 130

/** แปลง 'YYYY-MM-DD' เป็น วว/ดด/ปปปป พ.ศ. */
function toThaiDate(value: string | null): string {
  if (!value) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return value
  const [, year, month, day] = match
  return `${day}/${month}/${Number(year) + 543}`
}

/**
 * ลิ้นชักผลแล็บแบบเอกสาร (lab_head.result_rtf) — ส่วนใหญ่คือผลเพาะเชื้อ
 *
 * ใช้ร่วมกันทั้งหน้าประวัติการได้รับยาและหน้า Drug Profile ผู้ป่วยใน
 * โหลดรายการเมื่อเปิดเท่านั้น และดึงเนื้อรายงานทีละใบตอนกด เพราะ result_rtf
 * เป็น longtext ถ้าลากมาทั้งชุดจะหนักโดยไม่จำเป็น
 */
export default function LabCultureModal({
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
  const [labs, setLabs] = useState<LabCultureItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  /** เปิดมาให้เห็นเฉพาะงานจุลชีววิทยาก่อน ติ๊กออกเพื่อดูฟอร์มอื่น */
  const [microOnly, setMicroOnly] = useState(true)
  const [labNo, setLabNo] = useState<number | null>(null)
  const [report, setReport] = useState('')
  const [reportLoading, setReportLoading] = useState(false)
  /** HN ที่โหลดรายการไว้แล้ว — เปลี่ยนผู้ป่วยแล้วต้องโหลดใหม่ */
  const [loadedHn, setLoadedHn] = useState<string | null>(null)

  const load = async () => {
    if (!hn) return
    setLoading(true)
    setError('')
    setLabs([])
    setLabNo(null)
    setReport('')
    try {
      const res = await apiFetch(`/api/his/lab-culture?hn=${hn}`)
      const json = await res.json()
      if (!res.ok || !json.success) {
        setError(json.message ?? 'ดึงรายการผลแล็บไม่สำเร็จ')
        return
      }
      setLabs(json.items as LabCultureItem[])
      setLoadedHn(hn)
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

  const openReport = async (no: number) => {
    if (!hn) return
    setLabNo(no)
    setReport('')
    setReportLoading(true)
    try {
      const res = await apiFetch(`/api/his/lab-culture/report?hn=${hn}&lab_no=${no}`)
      const json = await res.json()
      if (!res.ok || !json.success) {
        setReport(json.message ?? 'ดึงผลแล็บไม่สำเร็จ')
        return
      }
      setReport(String(json.report ?? '').trim() || '— ใบรายงานนี้ไม่มีเนื้อความ —')
    } catch {
      setReport('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setReportLoading(false)
    }
  }

  const visible = microOnly ? labs.filter(lab => lab.formName === MICROBIOLOGY_FORM) : labs

  return (
    <Modal
      title={hn ? `Lab Culture · HN ${hn}${patientName ? ` · ${patientName}` : ''}` : 'Lab Culture'}
      open={open}
      afterOpenChange={handleOpenChange}
      onCancel={onClose}
      footer={null}
      // ผลเพาะเชื้อจัดหน้าแบบ monospace กว้างหลายสิบคอลัมน์ ยิ่งกว้างยิ่งไม่ต้องเลื่อนอ่าน
      width="96vw"
      style={{ top: 16, maxWidth: 1600 }}
      styles={{ body: { maxHeight: 'calc(100vh - 110px)', overflow: 'hidden' } }}
    >
      <Spin spinning={loading}>
        {error && <Alert type="error" showIcon title={error} className="mb-3" />}

        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Checkbox checked={microOnly} onChange={event => setMicroOnly(event.target.checked)}>
            <span className="text-xs">เฉพาะงานจุลชีววิทยา (ผลเพาะเชื้อ)</span>
          </Checkbox>
          <Text type="secondary" className="text-[11px]">
            แสดง {visible.length} จาก {labs.length} ใบ (สูงสุด 150 ใบล่าสุด)
          </Text>
        </div>

        {visible.length > 0 ? (
          <div className="flex flex-col gap-4 lg:flex-row">
            <div className="lg:w-[380px] lg:shrink-0">
              <Table<LabCultureItem>
                rowKey="labNo"
                size="small"
                dataSource={visible}
                pagination={false}
                scroll={{ y: 'calc(100vh - 290px)' }}
                onRow={row => ({
                  onClick: () => void openReport(row.labNo),
                  style: { cursor: 'pointer' },
                })}
                rowClassName={row => (row.labNo === labNo ? 'bg-accent-soft' : '')}
                columns={[
                  {
                    title: 'วันที่สั่ง',
                    key: 'date',
                    render: (_: unknown, row) => (
                      <div className="leading-snug">
                        <div className="font-mono text-[11px]">{toThaiDate(row.orderDate)}</div>
                        <Text type="secondary" className="text-[11px]">
                          {row.formName ?? '—'}
                        </Text>
                      </div>
                    ),
                  },
                  {
                    title: 'รายงาน',
                    key: 'report',
                    width: 130,
                    render: (_: unknown, row) => (
                      <div className="leading-snug">
                        <div className="font-mono text-[11px]">
                          {toThaiDate(row.reportDate)}
                          {row.reportTime ? ` ${row.reportTime}` : ''}
                        </div>
                        {/* โครง RTF เปล่าไม่มีเนื้อความ บอกไว้ก่อนจะได้ไม่ต้องกดเปิดดู */}
                        {row.rtfLength <= EMPTY_RTF_LENGTH && (
                          <Text type="secondary" className="text-[11px]">
                            ไม่มีเนื้อรายงาน
                          </Text>
                        )}
                      </div>
                    ),
                  },
                ]}
              />
            </div>

            <div className="min-w-0 flex-1">
              {labNo == null ? (
                <Empty description="เลือกใบรายงานทางซ้ายเพื่อดูผล" />
              ) : (
                <Spin spinning={reportLoading}>
                  {/* ผลเพาะเชื้อจัดหน้าด้วยช่องว่างแบบ monospace ต้องคงระยะไว้ให้ตรงตามต้นฉบับ */}
                  <pre className="h-[calc(100vh-250px)] overflow-auto rounded-lg border border-line bg-panel p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                    {report}
                  </pre>
                </Spin>
              )}
            </div>
          </div>
        ) : (
          !loading && (
            <Empty
              description={
                microOnly && labs.length > 0
                  ? 'ผู้ป่วยรายนี้ไม่มีผลงานจุลชีววิทยา (ติ๊กออกเพื่อดูฟอร์มอื่น)'
                  : 'ไม่พบผลแล็บแบบเอกสารของผู้ป่วยรายนี้'
              }
            />
          )
        )}
      </Spin>
    </Modal>
  )
}
