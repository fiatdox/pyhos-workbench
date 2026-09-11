'use client'
import { useState } from 'react'
import { Button } from 'antd'
import {
  DownOutlined,
  LoadingOutlined,
  ReloadOutlined,
  SearchOutlined,
  UpOutlined,
} from '@ant-design/icons'
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

type RefTab = 'renal' | 'culture' | 'antibiotic' | 'rdu'

/**
 * ผลวิเคราะห์ความสมเหตุผลของการใช้ยาจากโมเดลภาษา
 *
 * ผู้เรียกเป็นเจ้าของสถานะเอง เพราะการวิเคราะห์เริ่มตอน "เปิดแบบประเมิน"
 * ไม่ใช่ตอนกดแท็บ — แท็บนี้เป็นแค่ที่แสดงผล ถ้าย้ายการยิงคำขอมาไว้ในนี้
 * แท็บที่ยังไม่ได้กดดูจะไม่มีอะไรเริ่มทำงานเลย
 *
 * ไม่ส่ง prop นี้มา = ไม่มีแท็บนี้ (เครื่องที่ไม่ได้ตั้งค่าโมเดล และลิ้นชักของ
 * แพทย์ผู้กำกับที่ไม่ได้ใช้ตัวช่วยนี้)
 */
export type RationalUse = {
  status: 'loading' | 'done' | 'error'
  text: string
  message: string
  /** ชื่อโมเดลที่ตอบ — บอกที่มาให้ชัด ไม่ใช่กล่องดำ */
  model: string | null
  elapsedMs: number | null
  onRetry: () => void
}

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
  {
    value: 'rdu',
    label: 'วิเคราะห์การใช้ยาสมเหตุผล',
    active: 'border-ref-rdu-line bg-ref-rdu-bg text-ref-rdu',
    idle: 'border-line text-ink-3 hover:border-ref-rdu-line hover:text-ref-rdu',
    panel: 'border-ref-rdu-line',
    head: 'bg-ref-rdu-bg',
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
  rationalUse,
}: {
  request: MockRequest
  /** เปิดใบรายงานผลเพาะเชื้อฉบับเต็ม — ใช้ modal ตัวเดียวกับหน้าอื่น */
  onOpenCulture: () => void
  chartHeight?: number
  rationalUse?: RationalUse
}) {
  const [tab, setTab] = useState<RefTab>('renal')
  const [open, setOpen] = useState(true)

  const tabs = rationalUse ? REF_TABS : REF_TABS.filter(item => item.value !== 'rdu')

  /** สีประจำแท็บที่กำลังดู — ใช้กับกรอบเนื้อหาและหัวตารางให้เป็นชุดเดียวกัน */
  const tone = tabs.find(item => item.value === tab) ?? tabs[0]

  return (
    // -mx-6 px-6 ให้แถบกินเต็มความกว้างของกล่องที่มี padding 24px (Modal / Drawer)
    // ไม่งั้นเนื้อหาที่เลื่อนผ่านจะโผล่ตรงขอบซ้ายขวาของแถบที่ตรึงไว้
    <div className="sticky top-0 z-10 -mx-6 border-b border-line bg-elevated px-6 pb-3 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {tabs.map(item => {
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
                {/* แท็บวิเคราะห์เริ่มทำงานตั้งแต่เปิดแบบประเมิน ต้องเห็นจากปุ่มว่ากำลังทำอยู่
                    ไม่ใช่ต้องกดเข้าไปดูถึงจะรู้ */}
                {item.value === 'rdu' && rationalUse?.status === 'loading' && (
                  <LoadingOutlined className="ml-1.5" />
                )}
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

          {tab === 'rdu' && rationalUse && (
            <div className="max-h-72 overflow-auto p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="rounded bg-ref-rdu-bg px-2 py-0.5 text-[11px] font-semibold text-ref-rdu">
                  ข้อความจากโมเดล ไม่ใช่ผลตรวจ
                </span>
                <span className="text-[11px] leading-snug text-ink-3">
                  เป็นประเด็นตั้งต้นให้ตรวจสอบ ต้องยืนยันกับข้อมูลจริงก่อนใช้กรอกแบบประเมิน
                </span>
                {rationalUse.status !== 'loading' && (
                  <Button
                    type="link"
                    size="small"
                    className="ml-auto h-auto px-0! text-[11px]!"
                    icon={<ReloadOutlined />}
                    onClick={rationalUse.onRetry}
                  >
                    วิเคราะห์ใหม่
                  </Button>
                )}
              </div>

              {rationalUse.status === 'loading' && (
                <div className="px-3 py-8 text-center text-xs text-ink-3">
                  <LoadingOutlined className="mr-2" />
                  กำลังวิเคราะห์ อาจใช้เวลาสักครู่ — ระหว่างนี้กรอกแบบประเมินต่อได้
                </div>
              )}

              {rationalUse.status === 'error' && (
                <div className="px-3 py-8 text-center text-xs text-ink-3">
                  {rationalUse.message}
                </div>
              )}

              {rationalUse.status === 'done' && (
                <>
                  {/* ข้อความล้วนจากโมเดล แสดงตามบรรทัดที่มันขึ้นมา ไม่แปลง markdown
                      เพื่อไม่ให้เนื้อหาถูกตีความเป็น HTML */}
                  <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-ink">
                    {rationalUse.text}
                  </pre>
                  {rationalUse.model && (
                    <div className="mt-2 text-[11px] text-ink-3">
                      {rationalUse.model}
                      {rationalUse.elapsedMs != null &&
                        ` · ${(rationalUse.elapsedMs / 1000).toFixed(1)} วินาที`}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
