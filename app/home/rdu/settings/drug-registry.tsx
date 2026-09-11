'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ยังทำที่ app/home/rdu/layout.tsx ซึ่งเป็น Server Component)
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Alert, Breadcrumb, Spin, Tag, Transfer, Typography, message } from 'antd'
import type { TransferDirection } from 'antd/es/transfer'
import type { Key } from 'react'
import { apiFetch } from '@/lib/client/session'
import type { DrugOption } from '@/lib/his/rdu-registry'

const { Text, Title } = Typography

/** Transfer ต้องการคีย์ในตัวรายการเอง — ใช้ icode ซึ่งเป็นคีย์หลักของทั้งสองตาราง */
type DrugItem = DrugOption & { key: string }

/**
 * จำนวนรายการต่อหน้าในกล่อง Transfer
 *
 * ยาที่เปิดใช้งานอยู่มีพันกว่ารายการ ถ้าไม่แบ่งหน้า Transfer จะเรนเดอร์ทั้งหมด
 * ลงใน DOM รอบเดียว แล้วการพิมพ์ค้นแต่ละตัวอักษรจะหน่วงจนใช้งานไม่ได้
 */
const PAGE_SIZE = 12

/**
 * หน้าตั้งค่าทะเบียนรายการยาของตัวชี้วัด RDU — ใช้ร่วมกันทุกทะเบียน
 *
 * ฐาน HIS ไม่มีคอลัมน์ไหนบอกว่ายาตัวไหนอยู่กลุ่มไหน (atc_code กับ
 * therapeuticgroup ว่างทั้งตาราง ส่วน dosageform บอกแค่รูปแบบยา) เภสัชกรจึงเลือก
 * เองจากรายการยาทั้งหมด แล้วเก็บเฉพาะ icode ลงตารางทะเบียน
 *
 * บันทึกทันทีที่ย้ายรายการ ไม่มีปุ่มบันทึกแยก — หน้านี้แก้ทีละไม่กี่รายการนาน ๆ ครั้ง
 * การมีปุ่มบันทึกแปลว่าย้ายเสร็จแล้วเดินจากไปโดยไม่กดปุ่มก็เสียงานทั้งหมด
 * ระหว่างที่คำสั่งยังไม่ตอบกลับจะล็อกทั้งกล่องไว้ กันสั่งซ้อนกันจนทะเบียนไม่ตรงหน้าจอ
 */
export default function DrugRegistryPage({
  registry,
  icon,
  title,
  breadcrumb,
  intro,
  targetTitle,
}: {
  /** ชื่อทะเบียนตามที่ lib/his/rdu-registry.ts รู้จัก */
  registry: string
  icon: ReactNode
  title: string
  breadcrumb: string
  intro: string
  /** หัวข้อของกล่องขวา ไม่ต้องใส่จำนวน จะเติมให้เอง */
  targetTitle: string
}) {
  const [drugs, setDrugs] = useState<DrugItem[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [toast, toastHolder] = message.useMessage()

  const endpoint = `/api/his/rdu/registry/drug/${registry}`

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const res = await apiFetch(endpoint)
        const json = await res.json()
        if (!alive) return
        if (!res.ok || !json.success) {
          setError(json.message ?? 'ดึงทะเบียนรายการยาไม่สำเร็จ')
          return
        }
        setDrugs((json.drugs as DrugOption[]).map(drug => ({ ...drug, key: drug.icode })))
        setSelected(json.selected as string[])
      } catch {
        if (alive) setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
      } finally {
        if (alive) setLoading(false)
      }
    }
    void load()
    // กันตั้ง state หลังผู้ใช้เปลี่ยนหน้าไปแล้ว
    return () => {
      alive = false
    }
  }, [endpoint])

  /** ยาที่อยู่ในทะเบียนแต่ถูกปิดใช้งานไปแล้ว — เตือนให้ทบทวน ไม่ได้เอาออกให้เอง */
  const inactiveSelected = useMemo(
    () => drugs.filter(drug => !drug.active && selected.includes(drug.icode)).length,
    [drugs, selected],
  )

  const move = async (next: Key[], direction: TransferDirection, moved: Key[]) => {
    const icodes = moved.map(String)
    const previous = selected
    // ย้ายให้เห็นผลทันทีแล้วค่อยยิงคำสั่ง ถ้าล้มเหลวจะย้อนกลับเป็นค่าเดิม —
    // รอคำตอบก่อนแล้วค่อยขยับทำให้กดแล้วเหมือนปุ่มไม่ทำงาน
    setSelected(next.map(String))
    setSaving(true)
    try {
      const res =
        direction === 'right'
          ? await apiFetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ icodes }),
            })
          : await apiFetch(`${endpoint}?icodes=${encodeURIComponent(icodes.join(','))}`, {
              method: 'DELETE',
            })
      const json = await res.json()
      if (!res.ok || !json.success) {
        setSelected(previous)
        toast.error(json.message ?? 'บันทึกทะเบียนไม่สำเร็จ')
        return
      }
      // ยึดทะเบียนที่ฐานตอบกลับมา ไม่ใช่ค่าที่เดาไว้ตอนกด — รหัสที่ไม่มีใน drugitems
      // จะไม่ถูกเพิ่ม และอาจมีคนอื่นแก้ทะเบียนอยู่พร้อมกัน
      setSelected(json.selected as string[])
      if (direction === 'right') {
        const added = Number(json.added ?? 0)
        if (added > 0) toast.success(`เพิ่ม ${added} รายการเข้าทะเบียนแล้ว`)
        else toast.info('รายการที่เลือกอยู่ในทะเบียนอยู่แล้ว')
      } else {
        const removed = Number(json.removed ?? 0)
        if (removed > 0) toast.success(`เอา ${removed} รายการออกจากทะเบียนแล้ว`)
        else toast.info('รายการที่เลือกถูกเอาออกไปแล้ว')
      }
    } catch {
      setSelected(previous)
      toast.error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {toastHolder}

      <section className="mb-6">
        <Breadcrumb
          className="mb-2"
          items={[
            { title: <Link href="/home/rdu">RDU ติดตามตัวชี้วัดการใช้ยา</Link> },
            { title: breadcrumb },
          ]}
        />
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          {icon} {title}
        </Title>
        <div className="mb-2 h-px w-24 bg-linear-to-r from-violet-400/70 to-transparent" />
        <Text type="secondary" className="text-xs">
          {intro} — ย้ายรายการแล้วบันทึกทันที ไม่ต้องกดปุ่มบันทึก
        </Text>
      </section>

      {error && <Alert type="error" showIcon title={error} className="mb-4" />}

      {inactiveSelected > 0 && (
        <Alert
          type="warning"
          showIcon
          className="mb-4"
          title={`มียาที่ปิดใช้งานแล้วอยู่ในทะเบียน ${inactiveSelected} รายการ`}
          description={
            <span className="text-xs leading-relaxed">
              ยังเก็บไว้ให้ เพราะข้อมูลย้อนหลังที่นับตัวชี้วัดไปแล้วยังอ้างถึงรหัสเหล่านี้อยู่ —
              เอาออกได้ถ้าไม่ต้องการนับต่อ
            </span>
          }
        />
      )}

      <section className="rounded-2xl border border-line bg-panel p-4 backdrop-blur">
        <Spin spinning={loading || saving}>
          <Transfer<DrugItem>
            dataSource={drugs}
            targetKeys={selected}
            onChange={move}
            disabled={saving}
            showSearch
            pagination={{ pageSize: PAGE_SIZE }}
            titles={['รายการยาทั้งหมด', `${targetTitle} (${selected.length})`]}
            locale={{
              searchPlaceholder: 'ค้นจากชื่อยาหรือรหัส',
              itemUnit: 'รายการ',
              itemsUnit: 'รายการ',
              notFoundContent: 'ไม่พบรายการยา',
            }}
            // ค้นได้ทั้งชื่อยาและรหัส — เภสัชกรบางคนจำรหัสยาที่ใช้ประจำได้ขึ้นใจ
            // ค่าตั้งต้นของ Transfer ค้นจาก title อย่างเดียวซึ่งที่นี่คือชื่อยา
            filterOption={(input, item) => {
              const keyword = input.trim().toLowerCase()
              return (
                item.name.toLowerCase().includes(keyword) ||
                item.icode.toLowerCase().includes(keyword)
              )
            }}
            render={item => (
              <span className="text-xs">
                <span className="font-mono text-ink-3">{item.icode}</span> {item.name}
                {item.strength && <span className="text-ink-3"> — {item.strength}</span>}
                {!item.active && (
                  <Tag className="ml-1.5 mr-0!" color="default">
                    ปิดใช้งาน
                  </Tag>
                )}
              </span>
            )}
            styles={{ section: { width: '46%', minWidth: 260, height: 480 } }}
          />
        </Spin>
      </section>
    </>
  )
}
