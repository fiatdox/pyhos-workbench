'use client'
import { useRef, useState } from 'react'
import { Select, Spin, Typography } from 'antd'
import { apiFetch } from '@/lib/client/session'
import type { DrugUsageOption } from '@/lib/his/drug-usage'

const { Text } = Typography

/**
 * ต้องพิมพ์กี่ตัวอักษรถึงจะเริ่มค้นวิธีใช้ยา
 * ซ้ำกับ MIN_USAGE_SEARCH ใน lib/his/drug-usage.ts เพราะโมดูลนั้นเป็น server-only
 * ฝั่งเซิร์ฟเวอร์เป็นตัวบังคับจริง ค่านี้ใช้แค่บอกผู้ใช้ก่อนยิง API
 */
export const MIN_USAGE_SEARCH = 3

/**
 * ช่องเลือกวิธีใช้ยา — ค้นจาก drugusage.code (พิมพ์อย่างน้อย 3 ตัวอักษร)
 * เมื่อเลือกแล้วจะเก็บ shortlist ซึ่งเป็นข้อความที่ใช้พิมพ์ฉลากยาจริง
 *
 * อยู่นอกโฟลเดอร์ของหน้าใดหน้าหนึ่งเพราะทั้งหน้าประวัติการได้รับยาและ
 * หน้า Drug Profile ผู้ป่วยในใช้ช่องเดียวกัน
 */
export function UsageSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const [options, setOptions] = useState<DrugUsageOption[]>([])
  const [searching, setSearching] = useState(false)
  const [hint, setHint] = useState(`พิมพ์อย่างน้อย ${MIN_USAGE_SEARCH} ตัวอักษรเพื่อค้น`)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = (term: string) => {
    if (timer.current) clearTimeout(timer.current)
    const keyword = term.trim()
    if (keyword.length < MIN_USAGE_SEARCH) {
      setOptions([])
      setSearching(false)
      setHint(`พิมพ์อย่างน้อย ${MIN_USAGE_SEARCH} ตัวอักษรเพื่อค้น`)
      return
    }
    setSearching(true)
    // หน่วงไว้ก่อน ไม่ยิงทุกตัวอักษรที่พิมพ์
    timer.current = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/his/drug-usage?q=${encodeURIComponent(keyword)}`)
        const json = await res.json()
        if (!res.ok || !json.success) {
          setOptions([])
          setHint(json.message ?? 'ค้นวิธีใช้ยาไม่สำเร็จ')
          return
        }
        const found = json.options as DrugUsageOption[]
        setOptions(found)
        setHint(found.length === 0 ? 'ไม่พบวิธีใช้ที่ตรงกับคำค้น' : '')
      } catch {
        setOptions([])
        setHint('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')
      } finally {
        setSearching(false)
      }
    }, 300)
  }

  return (
    <Select
      size="small"
      allowClear
      className="w-full"
      placeholder="ค้นรหัสวิธีใช้ เช่น 1x3pc"
      // ค้นที่ฝั่งฐานข้อมูล จึงไม่ให้ antd กรองตัวเลือกซ้ำอีกชั้น
      showSearch={{ onSearch: search, filterOption: false }}
      value={value || undefined}
      loading={searching}
      onChange={next => onChange(next ?? '')}
      notFoundContent={
        searching ? <Spin size="small" /> : <Text type="secondary" className="text-[11px]">{hint}</Text>
      }
      // ค่าที่เก็บคือ shortlist — ข้อความที่ใช้พิมพ์ฉลากยา ส่วน code ใช้แค่ตอนค้น
      options={options.map(option => ({ value: option.shortlist, label: option.shortlist }))}
      optionRender={option => (
        <div className="leading-snug">
          <div className="font-mono text-xs">
            {options.find(item => item.shortlist === option.value)?.code}
          </div>
          <div className="text-[11px] opacity-70">{option.value}</div>
        </div>
      )}
    />
  )
}
