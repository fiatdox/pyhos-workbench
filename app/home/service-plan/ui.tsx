'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
import type { ReactNode } from 'react'
import { Segmented, Select, Tag, Tooltip, Typography } from 'antd'
import { ArrowDownOutlined, ArrowUpOutlined, MinusOutlined } from '@ant-design/icons'
import PageHint from '../page-hint'

const { Text } = Typography

/**
 * ชิ้นส่วนที่หน้ารายงาน Service Plan ทุกสาขาใช้ร่วมกัน
 *
 * แยกออกมาตอนทำหน้า Sepsis เพราะมันต้องการตัวเลือกช่วงเวลา การ์ดตัวเลข ตาราง
 * ที่มีลูกศรเทียบช่วงก่อน และป้าย "ยังไม่จบ" แบบเดียวกับหน้า Stroke เป๊ะ ๆ
 * ถ้าคัดลอกไป วันหนึ่งสองหน้าจะอธิบายเลขเดียวกันคนละแบบ แล้วคนอ่านจะไม่รู้ว่า
 * ความต่างนั้นตั้งใจหรือหลุด
 *
 * ตัวเลขที่ทุกหน้าใช้มีรูปเดียวกันคือ { total, dead } จึงรับชนิดนั้นเป็นสัญญากลาง
 * ไม่ได้ผูกกับชนิดของสาขาใดสาขาหนึ่ง
 */

export const nf = new Intl.NumberFormat('th-TH')

/** ตัวนับคู่ที่ทุกหน้าใช้ — จำนวนทั้งหมดกับจำนวนที่เสียชีวิต */
export type Counted = { total: number; dead: number }

/** ร้อยละการเสียชีวิต — null เมื่อช่วงนั้นไม่มีผู้ป่วยเลย ไม่ใช่ 0% */
export const rateOf = (count: Counted): number | null =>
  count.total > 0 ? (count.dead / count.total) * 100 : null

/** ร้อยละสำหรับแสดง — '—' เมื่อไม่มีผู้ป่วยเลย ไม่ใช่ '0.00%' */
export const pctText = (count: Counted): string => {
  const rate = rateOf(count)
  return rate == null ? '—' : `${rate.toFixed(2)}%`
}

/** ผ่านเกณฑ์หรือไม่ — null เมื่อไม่มีตัวหาร หรือยังไม่ได้ตั้งเกณฑ์ */
export const verdictOf = (count: Counted, target: number | null): boolean | null => {
  const rate = rateOf(count)
  return rate == null || target == null ? null : rate <= target
}

/**
 * ค่าของช่วงก่อนหน้าสำหรับทำลูกศรเทียบ
 *
 * ช่วงที่ยังไม่จบไม่เทียบกับใคร — เอาเจ็ดวันแรกของปีไปลบกับทั้งปีก่อนแล้วได้ลูกศร
 * ลงสีเขียวทุกช่อง ซึ่งเป็นคำตอบที่ผิดชนิดที่อ่านแล้วไม่รู้ว่าผิด
 */
export const comparable = <T,>(row: { partial: boolean }, value: T): T | null =>
  row.partial ? null : value

const THAI_MONTHS = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
]

/**
 * ป้ายของช่วงเวลา — คีย์เป็น '2569' (ปีงบ) หรือ '2026-01' (เดือน)
 *
 * short ใช้บนแกนนอนและในตาราง full ใช้ในกล่องคำอธิบายของกราฟที่มีที่ให้เขียนยาว
 * ปี พ.ศ. ของเดือนคำนวณจากปี ค.ศ. ในคีย์ ไม่ได้ส่งมาจากฐาน เพราะคีย์ที่ฐานคืนมา
 * เป็นปฏิทินสากลตามชนิดคอลัมน์วันที่
 */
export function periodLabel(key: string): { short: string; full: string } {
  if (!key.includes('-')) return { short: key, full: `ปีงบ ${key}` }
  const [year, month] = key.split('-').map(Number)
  const name = THAI_MONTHS[month - 1] ?? key
  const buddhist = year + 543
  return { short: `${name} ${String(buddhist % 100).padStart(2, '0')}`, full: `${name} ${buddhist}` }
}

/** จำนวนปีงบที่มุมมองเทียบรายปีแสดง — ตรงกับ FISCAL_YEARS_SHOWN ฝั่งเซิร์ฟเวอร์ */
export const FISCAL_YEARS_SHOWN = 5

/** ตัวเลือกไตรมาส — 0 คือทั้งปีงบ */
export const QUARTERS = [0, 1, 2, 3, 4] as const
export type QuarterChoice = (typeof QUARTERS)[number]

/** เดือนที่อยู่ในแต่ละไตรมาสของปีงบ ใช้เป็นคำอธิบายบนตัวเลือก */
const QUARTER_MONTHS: Record<Exclude<QuarterChoice, 0>, string> = {
  1: 'ต.ค. - ธ.ค.',
  2: 'ม.ค. - มี.ค.',
  3: 'เม.ย. - มิ.ย.',
  4: 'ก.ค. - ก.ย.',
}

/** ค่าของตัวเลือก "เทียบรายปีงบ" — ไม่ใช่ปี จึงต้องเป็นค่าที่ชนกับปีไม่ได้ */
const ALL_YEARS = 'all'

/** ปีงบที่เลือกได้ เรียงจากใหม่ไปเก่า — คิดจากวันนี้ที่เครื่องของผู้ใช้ */
export function fiscalYearOptions(now = new Date()): number[] {
  const current = now.getFullYear() + 543 + (now.getMonth() >= 9 ? 1 : 0)
  return Array.from({ length: FISCAL_YEARS_SHOWN + 1 }, (_, i) => current - i)
}

/** คำกำกับช่วงที่กำลังดู ใช้ในหัวข้อตารางและการ์ดรวม */
export function rangeLabelOf(fiscalYear: number | null, quarter: QuarterChoice): string {
  if (fiscalYear == null) return `${FISCAL_YEARS_SHOWN} ปีงบประมาณ`
  return quarter === 0 ? `ปีงบ ${fiscalYear} รายเดือน` : `ปีงบ ${fiscalYear} ไตรมาส ${quarter}`
}

/**
 * แถบตัวเลือกช่วงเวลา — เทียบรายปีงบเป็นค่าตั้งต้น
 *
 * คำถามแรกของตัวชี้วัดคือ "ปีนี้เทียบปีก่อนเป็นอย่างไร" ส่วนรายเดือนไว้ไล่ดูว่า
 * ปีนั้นเกิดอะไรขึ้นเดือนไหน ซึ่งเป็นคำถามที่ตามมาทีหลังเสมอ
 *
 * note คือของที่แต่ละหน้าอยากแปะไว้ท้ายแถบ (เช่นป้ายบอกว่าปีงบปัจจุบันยังไม่จบ)
 * ตัวแถบเองไม่รู้จักข้อมูลของหน้าไหน
 */
export function PeriodPicker({
  fiscalYear,
  quarter,
  onChange,
  rangeLabel,
  from,
  to,
  note,
}: {
  fiscalYear: number | null
  quarter: QuarterChoice
  onChange: (fiscalYear: number | null, quarter: QuarterChoice) => void
  rangeLabel: string
  from?: string
  to?: string
  note?: ReactNode
}) {
  const years = fiscalYearOptions()
  return (
    <section className="mb-4 flex flex-wrap items-center gap-3">
      {/* ค่าของตัวเลือกเป็นสตริงทั้งชุด — antd เตือนเมื่อ option มี value เป็น null
          และใช้ค่านั้นเป็นคีย์ภายในไม่ได้ */}
      <Select<string>
        style={{ width: 190 }}
        value={fiscalYear == null ? ALL_YEARS : String(fiscalYear)}
        onChange={value =>
          value === ALL_YEARS
            ? // กลับไปมุมมองรายปีแล้วไตรมาสไม่มีความหมาย ต้องล้าง ไม่งั้นพอเลือกปี
              // ใหม่อีกครั้งจะเด้งเข้าไตรมาสเดิมที่ผู้ใช้ลืมไปแล้วว่าเคยเลือกไว้
              onChange(null, 0)
            : onChange(Number(value), quarter)
        }
        options={[
          { value: ALL_YEARS, label: `เทียบรายปีงบ (${FISCAL_YEARS_SHOWN} ปี)` },
          ...years.map(year => ({ value: String(year), label: `ปีงบ ${year} รายเดือน` })),
        ]}
      />
      {/* ไตรมาสขึ้นเฉพาะเมื่อเลือกปีงบแล้ว — ไตรมาสลอย ๆ ไม่มีความหมาย
          ต้องบอกว่าไตรมาสของปีไหน */}
      {fiscalYear != null && (
        <Segmented<QuarterChoice>
          value={quarter}
          onChange={value => onChange(fiscalYear, value)}
          options={QUARTERS.map(choice => ({
            value: choice,
            label: choice === 0 ? 'ทั้งปี' : `Q${choice}`,
            title: choice === 0 ? 'ทั้งปีงบประมาณ' : `ไตรมาส ${choice} (${QUARTER_MONTHS[choice]})`,
          }))}
        />
      )}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {note}
        {from != null && to != null && (
          <Text type="secondary" className="text-xs">
            {rangeLabel} · จำหน่าย {from} ถึง {to}
          </Text>
        )}
      </div>
    </section>
  )
}

/** การ์ดตัวเลขหนึ่งใบ — ป้าย ค่า และคำอธิบายใต้ค่า */
export function Kpi({
  label,
  value,
  hint,
  verdict,
}: {
  label: string
  value: string
  hint: string
  /** null = ไม่ได้ตั้งเกณฑ์ไว้ จึงไม่ตัดสินผ่าน/ไม่ผ่าน */
  verdict?: boolean | null
}) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-4 backdrop-blur">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs text-ink-3">{label}</div>
        {verdict != null && (
          <Tag className="mr-0!" color={verdict ? 'green' : 'red'}>
            {verdict ? 'ผ่านเกณฑ์' : 'ไม่ผ่านเกณฑ์'}
          </Tag>
        )}
      </div>
      <div className="mt-1 text-2xl font-semibold text-ink">{value}</div>
      <div className="mt-1 text-xs text-ink-3">{hint}</div>
    </div>
  )
}

/**
 * กล่องกราฟหนึ่งใบ — หัวข้อกับคำอธิบายว่ากราฟนี้ตอบคำถามอะไร
 *
 * hint คือข้อควรระวังที่ยาวกว่าหนึ่งบรรทัด เก็บไว้หลังไอคอนข้างหัวข้อ ไม่ได้วาง
 * เป็นกล่องข้อความใต้กราฟ — ข้อความพวกนี้อ่านรอบเดียวก็พอ แต่กินความสูงทุกครั้ง
 * ที่เปิดหน้า และดันกราฟใบถัดไปตกขอบจอไปเปล่า ๆ
 */
export function Panel({
  title,
  desc,
  hint,
  children,
}: {
  title: string
  desc: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-2xl border border-line bg-panel p-4 backdrop-blur">
      <div className="mb-1 text-sm font-semibold text-ink">
        {title}
        {hint && <PageHint>{hint}</PageHint>}
      </div>
      <div className="mb-3 text-xs text-ink-3">{desc}</div>
      {children}
    </section>
  )
}

/** หัวข้อของส่วนหนึ่งในหน้า — ข้อควรระวังของทั้งส่วนอยู่หลังไอคอนข้างหัวข้อ */
export function SectionHead({
  title,
  desc,
  hint,
}: {
  title: string
  desc: string
  hint?: ReactNode
}) {
  return (
    <>
      <h3 className="mb-1 text-sm font-semibold text-ink-2">
        {title}
        {hint && <PageHint>{hint}</PageHint>}
      </h3>
      <p className="mb-4 text-xs text-ink-3">{desc}</p>
    </>
  )
}

/**
 * ช่องช่วงเวลา — ช่วงที่ยังไม่จบติดป้ายไว้ ไม่ใช่แค่ตัวเลขเปล่า
 *
 * ป้ายมีคำอธิบายของตัวเองติดมาด้วย เพราะคนที่เลื่อนมาเจอตารางกลางหน้าไม่ได้
 * อ่านคำอธิบายด้านบนเสมอ และ "ยังไม่จบ" คำเดียวไม่ได้บอกว่าตัวเลขต่ำกว่าจริง
 */
export function PeriodCell({ value, partial }: { value: string; partial: boolean }) {
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      <span className="text-ink">{periodLabel(value).short}</span>
      {partial && (
        <Tooltip title="ช่วงนี้ยังไม่จบ และการลงรหัสโรคตามหลังวันจำหน่ายหลายสัปดาห์ ตัวเลขจึงต่ำกว่าความจริง เทียบกับช่วงที่ปิดแล้วไม่ได้">
          <Tag className="mr-0! cursor-help" color="orange">
            ยังไม่จบ
          </Tag>
        </Tooltip>
      )}
    </div>
  )
}

/**
 * ส่วนต่างเทียบช่วงก่อนหน้า
 *
 * ทิศทางกับความหมายเป็นคนละเรื่องกัน จึงแยกเป็นสองอย่าง: ลูกศรบอกว่าตัวเลข
 * ขึ้นหรือลง ส่วนสีบอกว่าดีขึ้นหรือแย่ลง ตัวชี้วัดพวกนี้ยิ่งน้อยยิ่งดีเกือบทั้งหมด
 * (อัตราตาย วันนอน ค่าใช้จ่าย) แต่จำนวนผู้ป่วยไม่ใช่ — มากขึ้นไม่ได้แปลว่าแย่ลง
 * คอลัมน์พวกนั้นจึงส่ง goal="none" แล้วลูกศรจะเป็นสีกลาง
 *
 * ช่วงแรกสุดของตารางไม่มีช่วงก่อนให้เทียบ ช่องนั้นเว้นว่างไว้ ไม่ใส่ 0 ซึ่งจะอ่าน
 * ผิดเป็น "เท่าเดิม"
 */
export function Delta({
  current,
  previous,
  digits = 2,
  suffix = '',
  goal = 'low',
}: {
  current: number | null
  previous: number | null
  digits?: number
  /** หน่วยที่ต่อท้ายส่วนต่าง เช่น ' จุด' สำหรับร้อยละ */
  suffix?: string
  /**
   * ทิศที่ถือว่าดีขึ้น — 'low' ยิ่งน้อยยิ่งดี · 'high' ยิ่งมากยิ่งดี ·
   * 'none' ไม่ตัดสิน แสดงเป็นสีกลาง
   *
   * ต้องเลือกได้ เพราะหน้านี้มีทั้งตัวชี้วัดที่ยิ่งน้อยยิ่งดี (อัตราตาย) และที่
   * ยิ่งมากยิ่งดี (การเข้าถึง ICU ทันเวลา) ถ้าใช้ทิศเดียวกันหมด ลูกศรเขียว/แดง
   * จะบอกกลับทางในครึ่งหนึ่งของหน้า
   */
  goal?: 'low' | 'high' | 'none'
}) {
  if (current == null || previous == null) return null
  const diff = current - previous
  const shown = Number(diff.toFixed(digits))
  if (shown === 0) {
    return (
      <span className="text-ink-3">
        <MinusOutlined /> เท่าเดิม
      </span>
    )
  }
  const up = shown > 0
  const better = goal === 'high' ? up : !up
  const tone = goal === 'none' ? 'text-ink-3' : better ? 'text-emerald-500' : 'text-rose-500'
  const size = Math.abs(shown).toLocaleString('th-TH', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  return (
    <span className={tone}>
      {up ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {size}
      {suffix}
    </span>
  )
}

/** ช่องตัวเลขพร้อมส่วนต่างจากช่วงก่อนบรรทัดล่าง */
export function NumberCell({
  value,
  previous,
  digits = 0,
  goal = 'low',
}: {
  value: number | null
  previous: number | null
  digits?: number
  goal?: 'low' | 'none'
}) {
  return (
    <div>
      <span className="text-ink">
        {value == null
          ? '—'
          : value.toLocaleString('th-TH', {
              minimumFractionDigits: digits,
              maximumFractionDigits: digits,
            })}
      </span>
      <div className="text-xs">
        <Delta current={value} previous={previous} digits={digits} goal={goal} />
      </div>
    </div>
  )
}

/** ช่องตารางที่บอกทั้งร้อยละและที่มาของเศษส่วน */
export function RateCell({
  count,
  target,
  previous,
  goal = 'low',
}: {
  count: Counted
  target: number | null
  /** ค่าของช่วงก่อนหน้า — ไม่ส่งมาก็ได้ ตารางที่ไม่ได้เรียงตามเวลาจะไม่มีความหมาย */
  previous?: Counted | null
  /** ทิศที่ถือว่าดีขึ้น — มีผลทั้งการตัดสินเกณฑ์และสีของลูกศรเทียบช่วงก่อน */
  goal?: 'low' | 'high' | 'none'
}) {
  const rate = rateOf(count)
  if (rate == null) return <Text type="secondary">—</Text>
  const pass = target == null ? null : goal === 'high' ? rate >= target : rate <= target
  return (
    <div>
      <span
        className={
          pass == null
            ? 'text-ink'
            : pass
              ? 'font-semibold text-emerald-500'
              : 'font-semibold text-rose-500'
        }
      >
        {rate.toFixed(2)}%
      </span>
      <div className="text-xs text-ink-3">
        {nf.format(count.dead)}/{nf.format(count.total)}
      </div>
      {previous !== undefined && (
        <div className="text-xs">
          {/* เทียบเป็น "จุด" ไม่ใช่ "%" — ผลต่างของร้อยละสองค่าเป็นจุดร้อยละ
              การเขียนว่า +2% จะถูกอ่านว่าเพิ่มขึ้นสองเปอร์เซ็นต์ของค่าเดิม */}
          <Delta
            current={rate}
            previous={previous == null ? null : rateOf(previous)}
            digits={2}
            suffix=" จุด"
            goal={goal}
          />
        </div>
      )}
    </div>
  )
}
