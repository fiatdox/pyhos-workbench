'use client'
import { useState } from 'react'
import { Button } from 'antd'
import { DownOutlined, SearchOutlined, UpOutlined } from '@ant-design/icons'
import RenalChart from './renal-chart'
import { toThaiDateTime } from './display'
import type { MockRequest } from './mock-data'

/**
 * ข้อมูลประกอบการตัดสินใจ — กราฟค่าไต / ผลเพาะเชื้อ / ประวัติยาต้าน
 *
 * สามชุดนี้วางเรียงกันหมดไม่ไหว กินพื้นที่จนต้องเลื่อนหาเนื้อหาหลัก จึงทำเป็น
 * แท็บสลับดูทีละชุด แล้วตรึงไว้บนสุดของกล่องที่เลื่อน (sticky) ให้ยังเห็นอยู่
 * ตอนเลื่อนลงไปอ่าน/ตอบด้านล่าง ซึ่งเป็นเหตุผลทั้งหมดที่เอาข้อมูลพวกนี้มาไว้ตรงนี้
 * พับเก็บได้ด้วย เผื่อจอเตี้ยและอยากได้พื้นที่คืน
 *
 * ใช้ร่วมกันสองที่: แบบประเมินของเภสัชกร และลิ้นชักคำขอของแพทย์ผู้กำกับ
 * — คำถามที่สองฝ่ายต้องตอบต่างกัน แต่ข้อมูลที่ต้องดูประกอบเป็นชุดเดียวกัน
 */

type RefTab = 'renal' | 'culture' | 'antibiotic'

/**
 * ให้สีประจำชุดข้อมูลไปเลย ไม่ใช้ Segmented ของ antd เพราะ Segmented ทาสีปุ่ม
 * ที่เลือกได้สีเดียวทั้งชุด แยกไม่ออกว่าอยู่แท็บไหน
 *
 * สีมาจาก token ตามธีม (--ref-*) ไม่ใช่ dark: ของ Tailwind เพราะ dark:
 * ผูกกับ prefers-color-scheme ของเครื่อง ไม่ได้ผูกกับ data-theme ที่ผู้ใช้เลือก
 * class ต้องเขียนเป็นสตริงเต็ม ๆ ตรงนี้ Tailwind ถึงจะเก็บไปตอน scan ไฟล์
 */
const REF_TABS: {
  value: RefTab
  label: string
  /** ปุ่มตอนถูกเลือก */
  active: string
  /** ปุ่มตอนไม่ได้เลือก — คุมโทนไว้ไม่ให้แย่งสายตาไปจากเนื้อหาหลัก */
  idle: string
  /** ขอบกรอบเนื้อหา ใช้สีเดียวกับแท็บเพื่อให้เห็นว่าเนื้อหานี้มาจากแท็บไหน */
  panel: string
  /** พื้นหัวตาราง */
  head: string
}[] = [
  {
    value: 'renal',
    label: 'กราฟค่าไต',
    active: 'border-ref-renal-line bg-ref-renal-bg text-ref-renal',
    idle: 'border-line text-ink-3 hover:border-ref-renal-line hover:text-ref-renal',
    panel: 'border-ref-renal-line',
    head: 'bg-ref-renal-bg',
  },
  {
    value: 'culture',
    label: 'ผลเพาะเชื้อ',
    active: 'border-ref-culture-line bg-ref-culture-bg text-ref-culture',
    idle: 'border-line text-ink-3 hover:border-ref-culture-line hover:text-ref-culture',
    panel: 'border-ref-culture-line',
    head: 'bg-ref-culture-bg',
  },
  {
    value: 'antibiotic',
    label: 'ประวัติยาต้าน',
    active: 'border-ref-abx-line bg-ref-abx-bg text-ref-abx',
    idle: 'border-line text-ink-3 hover:border-ref-abx-line hover:text-ref-abx',
    panel: 'border-ref-abx-line',
    head: 'bg-ref-abx-bg',
  },
]

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={`px-2 py-1.5 text-left text-[11px] font-semibold text-ink ${className ?? ''}`}>
      {children}
    </th>
  )
}

function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-1.5 text-[11px] ${className ?? ''}`}>{children}</td>
}

/** โครงตารางข้อมูลประกอบ — สูงคงที่ หัวตารางตรึงไว้ตอนเลื่อน */
function RefTable({
  head,
  children,
  rows,
  empty,
}: {
  head: React.ReactNode
  children: React.ReactNode
  rows: number
  empty: string
}) {
  if (rows === 0) {
    return <div className="px-3 py-8 text-center text-xs text-ink-3">{empty}</div>
  }
  return (
    <div className="max-h-72 overflow-auto">
      <table className="w-full min-w-200 border-collapse">
        {/* หัวตารางต้องมีพื้นทึบ ไม่งั้นแถวที่เลื่อนผ่านจะทะลุขึ้นมาซ้อน */}
        <thead className="sticky top-0 bg-elevated">{head}</thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export default function ReferenceTabs({
  request,
  onOpenCulture,
  chartHeight = 280,
}: {
  request: MockRequest
  /** เปิดใบรายงานผลเพาะเชื้อฉบับเต็ม — ใช้ modal ตัวเดียวกับหน้าอื่น */
  onOpenCulture: () => void
  chartHeight?: number
}) {
  const [tab, setTab] = useState<RefTab>('renal')
  const [open, setOpen] = useState(true)

  /** สีประจำแท็บที่กำลังดู — ใช้กับกรอบเนื้อหาและหัวตารางให้เป็นชุดเดียวกัน */
  const tone = REF_TABS.find(item => item.value === tab) ?? REF_TABS[0]

  return (
    // -mx-6 px-6 ให้แถบกินเต็มความกว้างของกล่องที่มี padding 24px (Modal / Drawer)
    // ไม่งั้นเนื้อหาที่เลื่อนผ่านจะโผล่ตรงขอบซ้ายขวาของแถบที่ตรึงไว้
    <div className="sticky top-0 z-10 -mx-6 border-b border-line bg-elevated px-6 pb-3 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {REF_TABS.map(item => {
            const count =
              item.value === 'culture'
                ? request.cultureHistory.length
                : item.value === 'antibiotic'
                  ? request.antibioticHistory.length
                  : null
            const on = tab === item.value
            return (
              <button
                key={item.value}
                type="button"
                aria-pressed={on}
                onClick={() => setTab(item.value)}
                className={`rounded-md border px-3 py-1 text-xs transition-colors ${
                  on ? `font-semibold ${item.active}` : item.idle
                }`}
              >
                {item.label}
                {count != null && ` (${count})`}
              </button>
            )
          })}
        </div>
        <Button
          type="text"
          size="small"
          icon={open ? <UpOutlined /> : <DownOutlined />}
          onClick={() => setOpen(value => !value)}
        >
          {open ? 'ซ่อนข้อมูลประกอบ' : 'แสดงข้อมูลประกอบ'}
        </Button>
      </div>

      {open && (
        <div className={`mt-2 overflow-hidden rounded-lg border ${tone.panel}`}>
          {tab === 'renal' && (
            <div className="p-2">
              <RenalChart points={request.renalTrend} age={request.age} height={chartHeight} />
            </div>
          )}

          {tab === 'culture' && (
            <RefTable
              empty="ไม่มีใบรายงานผลเพาะเชื้อ"
              rows={request.cultureHistory.length}
              head={
                <tr className={`border-b border-line ${tone.head}`}>
                  <Th className="w-12">#</Th>
                  <Th className="w-52">Request Datetime</Th>
                  <Th className="w-52">Report Datetime</Th>
                  <Th className="w-20">Result</Th>
                  <Th />
                </tr>
              }
            >
              {request.cultureHistory.map(report => (
                <tr key={report.no} className="border-b border-line last:border-b-0">
                  <Td>{report.no}</Td>
                  <Td className="font-mono">{toThaiDateTime(report.requestedAt)}</Td>
                  <Td className="font-mono">{toThaiDateTime(report.reportedAt)}</Td>
                  <Td>
                    <button
                      type="button"
                      aria-label={`เปิดผลเพาะเชื้อใบที่ ${report.no}`}
                      onClick={onOpenCulture}
                      className="text-accent hover:text-accent-strong"
                    >
                      <SearchOutlined />
                    </button>
                  </Td>
                  <Td />
                </tr>
              ))}
            </RefTable>
          )}

          {tab === 'antibiotic' && (
            <RefTable
              empty="ไม่มีประวัติการใช้ยาต้านจุลชีพ"
              rows={request.antibioticHistory.length}
              head={
                <tr className={`border-b border-line ${tone.head}`}>
                  <Th className="w-12">#</Th>
                  <Th className="w-44">RX Datetime</Th>
                  <Th>Drugname</Th>
                  <Th className="w-72">Drug Usage</Th>
                  <Th className="w-16 text-right!">Qty</Th>
                </tr>
              }
            >
              {request.antibioticHistory.map(row => (
                <tr key={row.no} className="border-b border-line last:border-b-0">
                  <Td>{row.no}</Td>
                  <Td className="font-mono">{toThaiDateTime(row.rxAt)}</Td>
                  <Td>{row.drugName}</Td>
                  <Td>{row.usage}</Td>
                  {/* จำนวน 0 = สั่งแล้วไม่ได้จ่าย ทำให้จางลงจะได้ไม่อ่านสลับกับที่จ่ายจริง */}
                  <Td className={`text-right ${row.qty === 0 ? 'text-ink-3' : 'font-semibold'}`}>
                    {row.qty}
                  </Td>
                </tr>
              ))}
            </RefTable>
          )}
        </div>
      )}
    </div>
  )
}
