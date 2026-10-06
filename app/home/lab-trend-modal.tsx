'use client'
import { useState } from 'react'
import { Alert, Empty, Modal, Tooltip, Typography } from 'antd'
import { apiFetch } from '@/lib/client/session'
import type { LabTrend, LabTrendRow } from '@/lib/his/lab-trend'
import LabTrendChart, { type LabChartAxis } from './lab-trend-chart'
import { ChartSkeleton, TableRowsSkeleton } from './skeletons'

const { Text } = Typography

/**
 * ค่าแล็บย้อนหลังประกอบการพิจารณาใบคำขอ DUE
 *
 * ตารางไหลแผ่นเดียวแล้วต่อด้วยกราฟ ไม่แยกแท็บตามหมวด — ค่าอักเสบกับค่าตับเป็น
 * ข้อมูลต่างชุดที่ใช้เสริมกัน ไม่ใช่ข้อมูลชุดเดียวกันสองวิธีแสดง (ซึ่งเป็นกรณีที่
 * แท็บเหมาะ เช่นรายการกับปฏิทินในหน้าต่างประวัตินัดหมาย) ข้อสรุปแบบ "การอักเสบ
 * ดีขึ้นทุกตัวแต่ ALT กระโดดวันที่ 28" ต้องเห็นสองหมวดพร้อมกันจึงจะได้
 * แยกแท็บคือตัดความสามารถนี้ออกไปโดยไม่ได้อะไรกลับมา
 *
 * ใช้ตาราง HTML ธรรมดาไม่ใช่ antd Table เพราะนี่คือตารางไหล — หัวคอลัมน์เป็นวันที่
 * ที่จำนวนไม่คงที่ แถวแรกต้องตรึงไว้ตอนเลื่อนแนวนอน และทุกช่องต้องย้อมสีได้
 * ตามระดับความผิดปกติ ซึ่งเป็นสามเรื่องที่ต้องเขียน override สู้กับ antd ทั้งหมด
 */

/** หัวข้อของแต่ละหมวด เรียงตามลำดับที่แสดง */
const GROUPS: { key: LabTrendRow['group']; label: string }[] = [
  { key: 'inflammation', label: 'การอักเสบ' },
  { key: 'liver', label: 'ตับ' },
]

/**
 * แกนของกราฟแต่ละใบ
 *
 * จับคู่ตามสเกลของตัวเลข ไม่ใช่ตามความหมาย — ดูเหตุผลที่ lab-trend-chart.tsx
 */
const CHART_AXES: Record<LabTrendRow['group'], [LabChartAxis, LabChartAxis]> = {
  inflammation: [
    { title: 'NE% (%) · hs-CRP (mg/L)', keys: ['neutrophilPercent', 'crp'] },
    { title: 'WBC · ANC (cell/µL)', keys: ['wbc', 'anc'] },
  ],
  liver: [
    { title: 'ALT · AST (U/L)', keys: ['alt', 'ast'] },
    { title: 'Bilirubin (mg/dL) · Albumin (g/dL)', keys: ['bilirubin', 'albumin'] },
  ],
}

/**
 * สีพื้นของช่องตามระดับความผิดปกติ
 *
 * ใช้ชุดสีเดียวกับช่องค่าไตในฟอร์ม (--renal-*) ทั้งที่ชื่อ token พูดถึงไต
 * เพราะเป็นชุดสีระดับความรุนแรงกลาง ๆ ของระบบอยู่แล้ว การเพิ่มชุดที่สามที่
 * หน้าตาเหมือนกันแต่ชื่อต่างกันทำให้คนอ่านโค้ดต้องจำสองชุดโดยไม่ได้อะไรเพิ่ม
 *
 * ต้องเป็นสตริงเต็มใน Record — Tailwind มองไม่เห็นชื่อคลาสที่ประกอบจากตัวแปร
 */
const CELL_LEVEL: Record<1 | 2, string> = {
  1: 'bg-renal-1-bg text-renal-1',
  2: 'bg-renal-3-bg text-renal-3 font-semibold',
}

/** วันที่แบบย่อสำหรับหัวคอลัมน์ — วว/ดด พร้อม พ.ศ. สองหลัก */
function shortDate(value: string): string {
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${String(Number(year) + 543).slice(-2)}`
}

/**
 * จัดรูปตัวเลขให้อ่านเทียบกันได้ในคอลัมน์แคบ
 *
 * ค่าหลักร้อยขึ้นไปปัดเป็นจำนวนเต็มพร้อมจุลภาค (WBC และ ANC เป็นหลักพัน
 * หลักหมื่น) ที่เล็กกว่านั้นเก็บทศนิยมหนึ่งตำแหน่งไว้ — ALT 1,240.7 ไม่ได้มี
 * ความหมายต่างจาก 1,241 แต่กินที่กว้างกว่าจนคอลัมน์เบียดกัน ส่วน albumin 2.9
 * กับ 2 คนละเรื่อง
 */
function formatValue(value: number): string {
  if (Math.abs(value) >= 100) return Math.round(value).toLocaleString('en-US')
  return value.toFixed(1).replace(/\.0$/, '')
}

export default function LabTrendModal({
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
  const [trend, setTrend] = useState<LabTrend | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  /** HN ที่โหลดไว้แล้ว — เปลี่ยนผู้ป่วยแล้วต้องโหลดใหม่ */
  const [loadedHn, setLoadedHn] = useState<string | null>(null)

  const load = async () => {
    if (!hn) return
    setLoading(true)
    setError('')
    setTrend(null)
    try {
      const res = await apiFetch(`/api/his/lab-trend?hn=${hn}`)
      const json = await res.json()
      if (!res.ok || !json.success) {
        setError(json.message ?? 'ดึงค่าแล็บย้อนหลังไม่สำเร็จ')
        return
      }
      setTrend(json.trend as LabTrend)
      setLoadedHn(hn)
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setLoading(false)
    }
  }

  // โหลดตอนเปิดจริงเท่านั้น — afterOpenChange ทำงานหลัง render จึงไม่ใช่การ
  // setState ตรง ๆ ใน effect body
  const handleOpenChange = (visible: boolean) => {
    if (visible && hn && hn !== loadedHn) void load()
  }

  const rowsOf = (group: LabTrendRow['group']) =>
    (trend?.rows ?? []).filter(row => row.group === group)

  const hasData = trend != null && trend.dates.length > 0 && trend.rows.length > 0

  return (
    // destroyOnHidden จำเป็นกับกราฟ — Highcharts วัดความกว้างตอน mount
    // ถ้าค้างตัวเดิมไว้ในกล่องที่ซ่อนอยู่ ครั้งต่อไปจะได้ความกว้างศูนย์
    <Modal
      title={
        hn
          ? `ค่าแล็บย้อนหลัง · HN ${hn}${patientName ? ` · ${patientName}` : ''}`
          : 'ค่าแล็บย้อนหลัง'
      }
      open={open}
      onCancel={onClose}
      afterOpenChange={handleOpenChange}
      footer={null}
      width={1100}
      destroyOnHidden
    >
      {error && <Alert type="error" showIcon title={error} className="mb-3" />}

      {/* โครงร่างเท่าของจริง: ตารางไหลแปดแถวแล้วต่อด้วยกราฟสองใบ
          หน้าต่างนี้สูงเกือบเต็มจอ ถ้าขึ้นวงกลมหมุนกลางที่ว่างแล้วของโผล่มาทีเดียว
          ตาจะต้องไปหาใหม่ว่าตารางเริ่มที่ไหน */}
      {loading && (
        <div className="space-y-4">
          <div className="rounded-lg border border-line px-3 py-2">
            <TableRowsSkeleton columns={9} rows={8} />
          </div>
          <div className="rounded-lg border border-line">
            <ChartSkeleton />
          </div>
          <div className="rounded-lg border border-line">
            <ChartSkeleton />
          </div>
        </div>
      )}

      {!loading && !error && !hasData && (
        <Empty description="ไม่มีผลแล็บย้อนหลังในรอบ 1 ปี" />
      )}

      {!loading && hasData && (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="min-w-full border-collapse text-xs">
              <thead>
                <tr className="bg-raised">
                  <th className="sticky left-0 z-10 min-w-44 bg-raised px-3 py-2 text-left font-medium text-ink-2">
                    ค่า
                  </th>
                  {trend.dates.map(date => (
                    <th
                      key={date}
                      className="min-w-16 px-2 py-2 text-right font-medium whitespace-nowrap text-ink-2"
                    >
                      {shortDate(date)}
                    </th>
                  ))}
                </tr>
              </thead>
              {GROUPS.map(group => {
                const groupRows = rowsOf(group.key)
                if (groupRows.length === 0) return null
                return (
                  <tbody key={group.key}>
                    <tr>
                      <td
                        colSpan={trend.dates.length + 1}
                        className="border-t border-line bg-panel px-3 py-1 text-[11px] font-medium text-ink-3"
                      >
                        {group.label}
                      </td>
                    </tr>
                    {groupRows.map(row => (
                      <tr key={row.key} className="border-t border-line-faint">
                        <td className="sticky left-0 z-10 bg-card px-3 py-1.5 whitespace-nowrap">
                          <span className="text-ink">{row.label}</span>
                          {row.derived && (
                            <Tooltip title="คำนวณจาก WBC × NE% ไม่ใช่ค่าที่ห้องแล็บออกมา">
                              <span className="ml-1 text-[10px] text-ink-3">(คำนวณ)</span>
                            </Tooltip>
                          )}
                          <span className="ml-1 text-[10px] text-ink-3">
                            {row.unit} · ปกติ {row.normal}
                          </span>
                        </td>
                        {row.cells.map((cell, index) => (
                          <td
                            key={trend.dates[index]}
                            className={`px-2 py-1.5 text-right tabular-nums whitespace-nowrap ${
                              cell.value == null || cell.suspect
                                ? 'text-ink-3'
                                : cell.level === 0
                                  ? 'text-ink'
                                  : CELL_LEVEL[cell.level]
                            }`}
                          >
                            {cell.value == null ? (
                              '—'
                            ) : cell.suspect ? (
                              <Tooltip title="ต่ำกว่าระดับที่เป็นไปได้ทางสรีรวิทยา — ไม่น่าใช่ค่าของเลือดผู้ป่วยรายนี้ ไม่นำไปลากเส้นในกราฟ">
                                <span className="cursor-help underline decoration-dotted">
                                  {formatValue(cell.value)}?
                                </span>
                              </Tooltip>
                            ) : (
                              `${cell.qualifier ?? ''}${formatValue(cell.value)}`
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                )
              })}
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-3">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block size-3 rounded-sm bg-renal-1-bg" />
              นอกช่วงอ้างอิง
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block size-3 rounded-sm bg-renal-3-bg" />
              ผิดปกติมาก
            </span>
            <span>ขีด — คือวันนั้นไม่ได้ตรวจค่านั้น ไม่ใช่ค่าปกติ</span>
            <span>เลขมีเครื่องหมาย ? คือค่าที่เป็นไปไม่ได้ทางสรีรวิทยา</span>
          </div>

          {GROUPS.map(group => {
            const groupRows = rowsOf(group.key)
            if (groupRows.length === 0) return null
            return (
              <div key={group.key} className="rounded-lg border border-line px-2 pt-2">
                <Text className="px-1 text-xs! text-ink-2!">{group.label}</Text>
                <LabTrendChart
                  dates={trend.dates}
                  rows={groupRows}
                  axes={CHART_AXES[group.key]}
                />
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
