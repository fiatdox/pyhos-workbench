'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ยังทำที่ app/home/rdu/layout.tsx ซึ่งเป็น Server Component)
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Alert, Breadcrumb, Select, Spin, Tag, Transfer, Typography, message } from 'antd'
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
 *
 * ลดจาก 12 เหลือ 10 ตอนเพิ่มบรรทัดชื่อสามัญ — แต่ละแถวสูงขึ้นเกือบเท่าตัว
 * ถ้าคงไว้ที่ 12 หน้าหนึ่งจะล้นกรอบจนต้องเลื่อนในกล่องซ้อนกับการแบ่งหน้า
 */
const PAGE_SIZE = 10

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
  /** ชื่อสามัญที่เลือกกรอง — ว่าง = ไม่กรอง */
  const [generics, setGenerics] = useState<string[]>([])
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

  /**
   * ชื่อสามัญทั้งหมดที่มีในรายการ พร้อมจำนวนรหัสของแต่ละชื่อ
   *
   * บอกจำนวนไว้ในตัวเลือกเลย เพราะยาตัวเดียวกันมักมีหลายรหัสจากหลายยี่ห้อและ
   * หลายปีงบ (atorvastatin มี 10 รหัส) ตัวเลขนี้คือคำเตือนในตัวว่าการเลือก
   * ทีละรหัสจากชื่อการค้าจะตกหล่น และบอกล่วงหน้าว่ากดแล้วจะได้กี่รายการ
   *
   * บอกด้วยว่าอยู่ในทะเบียนแล้วกี่รหัส — ชื่อที่ยังเข้าไม่ครบคือจุดที่ต้องดู
   */
  const genericOptions = useMemo(() => {
    const groups = new Map<string, { total: number; inRegistry: number }>()
    const chosen = new Set(selected)
    for (const drug of drugs) {
      if (drug.generic == null) continue
      const group = groups.get(drug.generic) ?? { total: 0, inRegistry: 0 }
      group.total += 1
      if (chosen.has(drug.icode)) group.inRegistry += 1
      groups.set(drug.generic, group)
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([generic, group]) => ({
        value: generic,
        label:
          group.inRegistry === 0
            ? `${generic} (${group.total})`
            : `${generic} (${group.total} · ในทะเบียน ${group.inRegistry})`,
      }))
  }, [drugs, selected])

  /**
   * รายการที่ส่งเข้า Transfer หลังกรองด้วยชื่อสามัญ
   *
   * รายการที่อยู่ในทะเบียนแล้วต้องติดมาด้วยเสมอ แม้จะไม่เข้าเงื่อนไขกรอง —
   * Transfer แบ่งสองช่องจาก dataSource ชุดเดียวกัน ถ้ากรองทิ้งไปตรง ๆ ช่องขวา
   * จะดูเหมือนทะเบียนหายไปครึ่งหนึ่งทั้งที่ยังอยู่ครบในฐาน แล้วคนใช้จะเผลอ
   * เลือกซ้ำเข้าไปใหม่ การกรองจึงมีผลกับช่องซ้ายเท่านั้น
   */
  const visible = useMemo(() => {
    if (generics.length === 0) return drugs
    const wanted = new Set(generics)
    const chosen = new Set(selected)
    return drugs.filter(
      drug => chosen.has(drug.icode) || (drug.generic != null && wanted.has(drug.generic)),
    )
  }, [drugs, generics, selected])

  /** จำนวนที่เหลือในช่องซ้ายหลังกรอง — ใช้บอกผลของตัวกรองก่อนกดเลือก */
  const filteredAvailable = useMemo(
    () => visible.filter(drug => !selected.includes(drug.icode)).length,
    [visible, selected],
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
        {/* กรองด้วยชื่อสามัญก่อนเลือก — ยาตัวเดียวกันกระจายอยู่หลายรหัสตามยี่ห้อ
            และปีที่ซื้อ การกรองแล้วกด "เลือกทั้งหมด" ในช่องซ้ายจึงเป็นทางที่เก็บ
            ได้ครบโดยไม่ต้องไล่จำชื่อการค้าทีละยี่ห้อ */}
        <div className="mb-3">
          {/* ไม่ปิดตัวเลือกระหว่างโหลดหรือบันทึก ทั้งที่กล่อง Transfer ปิด —
              ตัวกรองนี้แค่ซ่อนแถวในเบราว์เซอร์ ไม่ได้สั่งงานไปที่ฐาน กดตอนไหนก็ได้
              และการปิดมันทำให้ hydration ไม่ตรงด้วย (เหตุผลเต็มอยู่ที่ไฟล์
              icd10-registry.tsx ซึ่งเจอปัญหาเดียวกัน) */}
          <Select<string[]>
            mode="multiple"
            allowClear
            showSearch
            value={generics}
            onChange={setGenerics}
            options={genericOptions}
            placeholder="กรองด้วยชื่อสามัญ — พิมพ์ค้นได้ เลือกได้หลายชื่อ"
            maxTagCount="responsive"
            className="w-full"
            size="large"
          />
          <Text type="secondary" className="mt-1.5 block text-[11px]">
            {generics.length === 0 ? (
              <>
                ตัวเลขในวงเล็บคือจำนวนรหัสของชื่อสามัญนั้น — ยาตัวเดียวกันมักมีหลายรหัสตามยี่ห้อ
                เลือกชื่อสามัญแล้วกด &ldquo;เลือกทั้งหมด&rdquo; ในช่องซ้ายจะได้ครบทุกรหัสในคราวเดียว
              </>
            ) : (
              <>
                กรองอยู่ {generics.length} ชื่อสามัญ · ช่องซ้ายเหลือ{' '}
                {filteredAvailable.toLocaleString('th-TH')} รายการที่ยังไม่อยู่ในทะเบียน ·
                ช่องขวายังแสดงทะเบียนครบทุกรายการเสมอ ไม่ว่าจะกรองอะไรอยู่
              </>
            )}
          </Text>
        </div>

        <Spin spinning={loading || saving}>
          <Transfer<DrugItem>
            dataSource={visible}
            targetKeys={selected}
            onChange={move}
            disabled={saving}
            showSearch
            pagination={{ pageSize: PAGE_SIZE }}
            titles={['รายการยาทั้งหมด', `${targetTitle} (${selected.length})`]}
            locale={{
              searchPlaceholder: 'ค้นจากชื่อยา ชื่อสามัญ หรือรหัส',
              itemUnit: 'รายการ',
              itemsUnit: 'รายการ',
              notFoundContent: 'ไม่พบรายการยา',
            }}
            // ค้นได้ทั้งชื่อยา ชื่อสามัญ และรหัส — เภสัชกรบางคนจำรหัสยาที่ใช้ประจำ
            // ได้ขึ้นใจ ส่วนชื่อสามัญเป็นทางเดียวที่ค้นยาตัวเดียวกันได้ครบทุกยี่ห้อ
            // ค่าตั้งต้นของ Transfer ค้นจาก title อย่างเดียวซึ่งที่นี่คือชื่อยา
            filterOption={(input, item) => {
              const keyword = input.trim().toLowerCase()
              return (
                item.name.toLowerCase().includes(keyword) ||
                item.icode.toLowerCase().includes(keyword) ||
                (item.generic?.toLowerCase().includes(keyword) ?? false)
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
                {/* ชื่อสามัญขึ้นบรรทัดล่าง ไม่ได้ต่อท้ายชื่อยา — ชื่อยายาวจนล้นช่อง
                    อยู่แล้ว ถ้าต่อท้ายจะโดนตัดหายไปพอดีในรายการที่ยาวที่สุด */}
                {item.generic && (
                  <span className="mt-0.5 block text-[11px] text-ink-3">{item.generic}</span>
                )}
              </span>
            )}
            styles={{ section: { width: '46%', minWidth: 260, height: 560 } }}
          />
        </Spin>
      </section>
    </>
  )
}
