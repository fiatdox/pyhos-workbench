'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ยังทำที่ app/home/rdu/layout.tsx ซึ่งเป็น Server Component)
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Key } from 'react'
import Link from 'next/link'
import { Alert, Breadcrumb, Select, Spin, Tag, Transfer, Typography, message } from 'antd'
import type { TransferDirection } from 'antd/es/transfer'
import { apiFetch } from '@/lib/client/session'
import type { Icd10Option } from '@/lib/his/rdu-registry'
import PageHint from '../../page-hint'

const { Text, Title } = Typography

/** Transfer ต้องการคีย์ในตัวรายการเอง — ใช้ code ซึ่งเป็นคีย์หลักของทั้งสองตาราง */
type CodeItem = Icd10Option & { key: string }

/**
 * จำนวนรายการต่อหน้าในกล่อง Transfer
 *
 * ผลค้นจากเซิร์ฟเวอร์จำกัดไว้ 200 รายการ ถ้าไม่แบ่งหน้าก็ยังพอไหว แต่หมวดตั้งต้น
 * มี 294 รหัส และช่องขวาจะยาวขึ้นเรื่อย ๆ ตามที่เลือก — แบ่งหน้าไว้ตั้งแต่แรกดีกว่า
 *
 * ลดจาก 12 เหลือ 10 ตอนเพิ่มบรรทัดจำนวนการใช้ — แต่ละแถวสูงขึ้นเกือบเท่าตัว
 */
const PAGE_SIZE = 10

/**
 * หน่วงก่อนยิงคำค้น (มิลลิวินาที)
 *
 * ทุกตัวอักษรที่พิมพ์คือคำขอหนึ่งครั้งไปยังฐาน ถ้าไม่หน่วง การพิมพ์ว่า 'asthma'
 * จะกลายเป็นหกคำขอที่ผลของห้าอันแรกถูกทิ้งทันที
 */
const SEARCH_DELAY_MS = 350

const toItems = (codes: Icd10Option[]): CodeItem[] =>
  codes.map(code => ({ ...code, key: code.code }))

const usesOf = (item: Icd10Option) => item.opdUses + item.ipdUses

/**
 * ตัวกรองตามการใช้งานจริง
 *
 * มีไว้แก้ปัญหาที่เกิดขึ้นจริง: ตาราง icd101 วางรหัสหมวดสามหลักปนกับรหัสย่อย
 * ที่หมอลงจริง และหน้าตาแทบไม่ต่างกัน (S00 กับ S000) แต่ระบบเทียบรหัสแบบตรงตัว
 * การเผลอใส่รหัสหมวดจึงทำให้ตัวชี้วัดกลายเป็นศูนย์โดยไม่มีอะไรเตือน
 *
 * มีแค่สองตัวเลือก ไม่มี "เฉพาะรหัสที่ไม่มีการใช้" — ตัวกรองนี้มีผลกับกล่องซ้าย
 * ซึ่งเป็นฝั่งที่ยังไม่ได้เลือก การดูรหัสที่ไม่มีใครใช้ในฝั่งนั้นไม่ได้ช่วยอะไร
 * ส่วนการตรวจว่าทะเบียนมีรหัสแบบนั้นค้างอยู่หรือเปล่าเป็นคนละงาน และมีคำเตือน
 * แยกอยู่แล้ว (unusedSelected ข้างล่าง) ซึ่งเห็นตลอดโดยไม่ต้องไปกดกรอง
 */
type UsageFilter = 'all' | 'used'

const USAGE_OPTIONS: { value: UsageFilter; label: string }[] = [
  { value: 'all', label: 'ทุกรหัส รวมรหัสที่ไม่มีใครใช้' },
  { value: 'used', label: 'เฉพาะรหัสที่มีการใช้จริงใน 12 เดือน' },
]

/**
 * หน้าตั้งค่าทะเบียนรหัสวินิจฉัยของตัวชี้วัด RDU — ใช้ร่วมกันทุกทะเบียน
 *
 * ต่างจากหน้าทะเบียนรายการยาตรงที่ตาราง icd101 มี 43,825 รหัส ยกมาทั้งตาราง
 * ให้เบราว์เซอร์ค้นเองไม่ไหว — ช่องค้นของกล่องซ้ายจึงยิงไปค้นที่ฐานแทน
 * (ดู onSearch กับ filterOption ข้างล่าง) ส่วนกล่องขวาเป็นทะเบียนซึ่งมีไม่กี่รหัส
 * จึงค้นในเบราว์เซอร์ตามปกติ
 *
 * บันทึกทันทีที่ย้ายรายการ ไม่มีปุ่มบันทึกแยก ด้วยเหตุผลเดียวกับหน้าทะเบียนรายการยา
 */
export default function Icd10RegistryPage({
  registry,
  icon,
  title,
  breadcrumb,
  intro,
  targetTitle,
  poolLabel,
  searchHint,
}: {
  /** ชื่อทะเบียนตามที่ lib/his/rdu-registry.ts รู้จัก */
  registry: string
  icon: ReactNode
  title: string
  breadcrumb: string
  intro: string
  /** หัวข้อของกล่องขวา ไม่ต้องใส่จำนวน จะเติมให้เอง */
  targetTitle: string
  /** ชื่อหมวดตั้งต้นที่กล่องซ้ายแสดงเมื่อยังไม่ได้พิมพ์ค้น */
  poolLabel: string
  /** ตัวอย่างคำค้นที่เหมาะกับตัวชี้วัดข้อนี้ */
  searchHint: ReactNode
}) {
  const [codes, setCodes] = useState<CodeItem[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [usage, setUsage] = useState<UsageFilter>('all')
  /** ตัวเลขการใช้คำนวณเมื่อไร 'YYYY-MM-DD HH:mm' — null = ยังไม่มีตัวเลข */
  const [usageAt, setUsageAt] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [toast, toastHolder] = message.useMessage()

  const endpoint = `/api/his/rdu/registry/diagnosis/${registry}`

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** ลำดับคำขอค้น — ใช้ทิ้งผลของคำค้นเก่าที่ตอบกลับมาช้ากว่าคำค้นใหม่ */
  const searchSeq = useRef(0)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const res = await apiFetch(endpoint)
        const json = await res.json()
        if (!alive) return
        if (!res.ok || !json.success) {
          setError(json.message ?? 'ดึงรหัสวินิจฉัยไม่สำเร็จ')
          return
        }
        setCodes(toItems(json.codes as Icd10Option[]))
        setSelected(json.selected as string[])
        setUsageAt((json.usageComputedAt as string | null) ?? null)
      } catch {
        if (alive) setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
      } finally {
        if (alive) setLoading(false)
      }
    }
    void load()
    // กันตั้ง state หลังผู้ใช้เปลี่ยนหน้าไปแล้ว และกันคำค้นที่ยังหน่วงอยู่ยิงตามมา
    return () => {
      alive = false
      if (timer.current) clearTimeout(timer.current)
    }
  }, [endpoint])

  /** รหัสที่อยู่ในทะเบียนแต่ถูกยกเลิกไปแล้ว — เตือนให้ทบทวน ไม่ได้เอาออกให้เอง */
  const inactiveSelected = useMemo(
    () => codes.filter(code => !code.active && selected.includes(code.code)).length,
    [codes, selected],
  )

  /**
   * รหัสในทะเบียนที่ไม่มีใครใช้เลยใน 12 เดือน — ตัวชี้วัดนับรหัสเหล่านี้ไม่ได้
   *
   * เกือบทุกครั้งแปลว่าใส่รหัสหมวดสามหลักมาแทนรหัสย่อยที่หมอลงจริง ซึ่งเป็น
   * ความผิดพลาดที่มองไม่เห็นเลยจากหน้าจอเดิม แล้วตัวชี้วัดจะเงียบไปทั้งข้อ
   *
   * เซิร์ฟเวอร์แนบรหัสในทะเบียนมาให้ทุกครั้งอยู่แล้วไม่ว่าจะค้นอะไรอยู่
   * รายการนี้จึงครบเสมอ ไม่ได้ครบเฉพาะตอนเปิดหน้า
   */
  const unusedSelected = useMemo(
    () => codes.filter(code => selected.includes(code.code) && usesOf(code) === 0),
    [codes, selected],
  )

  /**
   * รายการที่ส่งเข้า Transfer หลังกรองด้วยการใช้งานจริง
   *
   * รหัสที่อยู่ในทะเบียนแล้วต้องติดมาด้วยเสมอ แม้จะไม่เข้าเงื่อนไขกรอง —
   * Transfer แบ่งสองกล่องจากชุดข้อมูลเดียวกัน ถ้ากรองทิ้งตรง ๆ กล่องขวาจะดู
   * เหมือนทะเบียนหายไปครึ่งหนึ่งทั้งที่ยังอยู่ครบในฐาน (เหตุผลเดียวกับตัวกรอง
   * ชื่อสามัญในหน้าทะเบียนรายการยา)
   */
  const visible = useMemo(() => {
    if (usage === 'all') return codes
    const chosen = new Set(selected)
    return codes.filter(code => chosen.has(code.code) || usesOf(code) > 0)
  }, [codes, usage, selected])

  /** จำนวนที่เหลือให้เลือกในกล่องซ้ายหลังกรอง */
  const filteredAvailable = useMemo(
    () => visible.filter(code => !selected.includes(code.code)).length,
    [visible, selected],
  )

  /**
   * ช่องค้นของกล่องซ้ายยิงไปค้นที่ฐาน ไม่ใช่กรองรายการที่โหลดมาแล้ว
   *
   * ผลค้นที่ได้กลับมาจะแทนรายการในกล่องซ้ายทั้งชุด — เซิร์ฟเวอร์แนบรหัสที่อยู่ใน
   * ทะเบียนมาให้ทุกครั้งอยู่แล้ว กล่องขวาจึงไม่หายไปตามคำค้น
   */
  const search = (direction: TransferDirection, value: string) => {
    if (direction !== 'left') return
    setKeyword(value.trim())
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const seq = ++searchSeq.current
      setSearching(true)
      void (async () => {
        try {
          const res = await apiFetch(`${endpoint}?q=${encodeURIComponent(value.trim())}`)
          const json = await res.json()
          // ผลของคำค้นที่ถูกแทนที่ไปแล้วต้องทิ้ง ไม่งั้นรายการจะกระพริบกลับไปเป็นของเก่า
          if (seq !== searchSeq.current) return
          if (!res.ok || !json.success) {
            toast.error(json.message ?? 'ค้นรหัสวินิจฉัยไม่สำเร็จ')
            return
          }
          // เอาเฉพาะรายการที่ค้นได้ ไม่แตะทะเบียนที่ถืออยู่ — ถ้าผลค้นที่ค้างอยู่ใน
          // สายมาทับตอนที่เพิ่งกดเพิ่ม/ลบไป ทะเบียนบนหน้าจอจะย้อนกลับไปค่าเก่า
          setCodes(toItems(json.codes as Icd10Option[]))
        } catch {
          if (seq === searchSeq.current) toast.error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')
        } finally {
          if (seq === searchSeq.current) setSearching(false)
        }
      })()
    }, SEARCH_DELAY_MS)
  }

  const move = async (next: Key[], direction: TransferDirection, moved: Key[]) => {
    const list = moved.map(String)
    const previous = selected
    // ย้ายให้เห็นผลทันทีแล้วค่อยยิงคำสั่ง ถ้าล้มเหลวจะย้อนกลับเป็นค่าเดิม
    setSelected(next.map(String))
    setSaving(true)
    try {
      const res =
        direction === 'right'
          ? await apiFetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ codes: list }),
            })
          : await apiFetch(`${endpoint}?codes=${encodeURIComponent(list.join(','))}`, {
              method: 'DELETE',
            })
      const json = await res.json()
      if (!res.ok || !json.success) {
        setSelected(previous)
        toast.error(json.message ?? 'บันทึกทะเบียนไม่สำเร็จ')
        return
      }
      // ยึดทะเบียนที่ฐานตอบกลับมา ไม่ใช่ค่าที่เดาไว้ตอนกด
      setSelected(json.selected as string[])
      if (direction === 'right') {
        const added = Number(json.added ?? 0)
        if (added > 0) toast.success(`เพิ่ม ${added} รหัสเข้าทะเบียนแล้ว`)
        else toast.info('รหัสที่เลือกอยู่ในทะเบียนอยู่แล้ว')
      } else {
        const removed = Number(json.removed ?? 0)
        if (removed > 0) toast.success(`เอา ${removed} รหัสออกจากทะเบียนแล้ว`)
        else toast.info('รหัสที่เลือกถูกเอาออกไปแล้ว')
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
          <PageHint>
            {intro} — ย้ายรายการแล้วบันทึกทันที ไม่ต้องกดปุ่มบันทึก
          </PageHint>
        </Title>
        <div className="h-px w-24 bg-linear-to-r from-violet-400/70 to-transparent" />
      </section>

      {error && <Alert type="error" showIcon title={error} className="mb-4" />}

      {/* บอกกติกาของช่องค้นไว้ เพราะกล่องซ้ายไม่ได้แสดงรหัสทั้งหมดตั้งแต่แรก
          ถ้าไม่บอก จะเข้าใจว่าระบบมีแค่รหัสหมวด J ให้เลือก */}
      <Alert
        type="info"
        showIcon
        className="mb-4"
        title={`กล่องซ้ายตั้งต้นด้วย${poolLabel} พิมพ์ค้นเพื่อหารหัสอื่นทั้งตาราง`}
        description={
          <span className="text-xs leading-relaxed">
            ตาราง ICD-10 ของโรงพยาบาลมีสี่หมื่นกว่ารหัส จึงค้นที่ฐานข้อมูลแทนการยกมาทั้งหมด —
            ค้นได้ทั้งรหัส ชื่อภาษาอังกฤษ และชื่อภาษาไทย ({searchHint}) แสดงผลครั้งละไม่เกิน 200 รหัส
          </span>
        }
      />

      {/* คำเตือนที่สำคัญที่สุดในหน้านี้ — รหัสที่ไม่มีใครใช้คือรหัสที่ตัวชี้วัดนับไม่ได้
          ขึ้นก่อนคำเตือนเรื่องรหัสที่ถูกยกเลิก เพราะอันนั้นแค่ต้องทบทวน
          ส่วนอันนี้แปลว่าตัวเลขที่รายงานอยู่ตอนนี้ผิด */}
      {unusedSelected.length > 0 && (
        <Alert
          type="warning"
          showIcon
          className="mb-4"
          title={`ในทะเบียนมี ${unusedSelected.length} รหัสที่ไม่มีการใช้เลยใน 12 เดือน`}
          description={
            <span className="text-xs leading-relaxed">
              ตัวชี้วัดเทียบรหัสแบบตรงตัว รหัสเหล่านี้จึงนับอะไรไม่ได้เลย —
              ส่วนใหญ่เกิดจากการใส่รหัสหมวดสามหลักแทนรหัสย่อยที่แพทย์ลงจริง
              (เช่นใส่ <b>S00</b> ทั้งที่ในฐานลงเป็น <b>S000</b>) ลองพิมพ์รหัสหมวดในช่องค้น
              แล้วดูว่ารหัสย่อยตัวไหนมีเลขการใช้อยู่
              <span className="mt-1 block font-mono text-[11px] text-ink-3">
                {unusedSelected
                  .slice(0, 20)
                  .map(code => code.code)
                  .join(' · ')}
                {unusedSelected.length > 20 && ` … อีก ${unusedSelected.length - 20} รหัส`}
              </span>
            </span>
          }
        />
      )}

      {inactiveSelected > 0 && (
        <Alert
          type="warning"
          showIcon
          className="mb-4"
          title={`มีรหัสที่ถูกยกเลิกแล้วอยู่ในทะเบียน ${inactiveSelected} รหัส`}
          description={
            <span className="text-xs leading-relaxed">
              ยังเก็บไว้ให้ เพราะข้อมูลย้อนหลังที่นับตัวชี้วัดไปแล้วยังอ้างถึงรหัสเหล่านี้อยู่ —
              เอาออกได้ถ้าไม่ต้องการนับต่อ
            </span>
          }
        />
      )}

      <section className="rounded-2xl border border-line bg-panel p-4 backdrop-blur">
        {/* กรองด้วยการใช้งานจริงก่อนเลือก — รหัสหมวดกับรหัสย่อยอยู่ปนกันในตาราง
            icd101 และแยกด้วยตาไม่ออก ตัวเลขการใช้เป็นตัวเดียวที่แยกให้ได้ */}
        <div className="mb-3">
          {/* ไม่ปิดตัวเลือกระหว่างโหลดหรือบันทึก ทั้งที่กล่อง Transfer ปิด —
              สองอย่างนี้ต่างกัน: Transfer สั่งงานไปที่ฐาน ส่วนตัวกรองนี้แค่ซ่อนแถว
              ในเบราว์เซอร์ กดตอนไหนก็ไม่มีอะไรเสีย

              และการปิดมันทำให้หน้าพังจริง ๆ ด้วย — loading เริ่มต้นเป็น true
              ช่อง input ข้างในของ antd Select จึงออกมาเป็น disabled={null} ตอน
              เรนเดอร์ที่เซิร์ฟเวอร์ แต่เป็น disabled={true} ตอน hydrate
              React จะขึ้น hydration mismatch ทุกครั้งที่เปิดหน้า */}
          <Select<UsageFilter>
            value={usage}
            onChange={setUsage}
            options={USAGE_OPTIONS}
            className="w-full"
            size="large"
          />
          <Text type="secondary" className="mt-1.5 block text-[11px]">
            {usage === 'used' ? (
              <>
                กล่องซ้ายเหลือ {filteredAvailable.toLocaleString('th-TH')} รหัสที่มีการใช้จริงและยังไม่อยู่ในทะเบียน ·
                กล่องขวายังแสดงทะเบียนครบทุกรหัสเสมอ
              </>
            ) : (
              <>
                ตัวเลขท้ายแต่ละรหัสคือจำนวนครั้งที่แพทย์ลงรหัสนั้นจริงใน 12 เดือนล่าสุด —
                รหัสที่ขึ้นว่า &ldquo;ไม่มีการใช้&rdquo; ใส่เข้าทะเบียนไปก็นับอะไรไม่ได้
              </>
            )}
            {usageAt && ` · ข้อมูลการใช้คำนวณเมื่อ ${usageAt}`}
          </Text>
        </div>

        <Spin spinning={loading || searching || saving}>
          <Transfer<CodeItem>
            dataSource={visible}
            targetKeys={selected}
            onChange={move}
            onSearch={search}
            disabled={saving}
            showSearch
            pagination={{ pageSize: PAGE_SIZE }}
            titles={[
              keyword === '' ? poolLabel : `ผลค้น "${keyword}"`,
              `${targetTitle} (${selected.length})`,
            ]}
            locale={{
              searchPlaceholder: 'ค้นรหัส ชื่อโรค ไทย/อังกฤษ',
              itemUnit: 'รหัส',
              itemsUnit: 'รหัส',
              notFoundContent: searching ? 'กำลังค้น' : 'ไม่พบรหัสวินิจฉัย',
            }}
            /* กล่องซ้ายกรองมาจากฐานแล้ว ถ้าปล่อยให้ตัวกรองในเบราว์เซอร์ทำงานต่อ
               ผลค้นที่ตรงกับชื่อไทยจะถูกคัดทิ้งเมื่อผู้ใช้พิมพ์เป็นภาษาอังกฤษ
               ส่วนกล่องขวาเป็นทะเบียนที่โหลดมาครบแล้ว จึงกรองในเบราว์เซอร์ตามปกติ */
            filterOption={(input, item, direction) => {
              if (direction === 'left') return true
              const word = input.trim().toLowerCase()
              return (
                item.code.toLowerCase().includes(word) ||
                item.name.toLowerCase().includes(word) ||
                (item.tname ?? '').toLowerCase().includes(word)
              )
            }}
            render={item => (
              <span className="text-xs">
                <span className="font-mono text-ink-3">{item.code}</span> {item.name}
                {item.tname && <span className="text-ink-3"> — {item.tname}</span>}
                {!item.active && (
                  <Tag className="ml-1.5 mr-0!" color="default">
                    ยกเลิกใช้
                  </Tag>
                )}
                {/* บรรทัดการใช้งานแยกออกมา ไม่ได้ต่อท้ายชื่อโรค — ชื่อโรคยาวจน
                    ล้นกล่องอยู่แล้ว ถ้าต่อท้ายจะโดนตัดหายพอดีในรหัสที่ชื่อยาวที่สุด
                    ซึ่งคือรหัสที่ต้องเห็นตัวเลขที่สุด */}
                <span
                  className={`mt-0.5 block text-[11px] ${
                    usesOf(item) === 0 ? 'text-amber-500' : 'text-ink-3'
                  }`}
                >
                  {usesOf(item) === 0
                    ? 'ไม่มีการใช้ใน 12 เดือน'
                    : `ใช้ ${usesOf(item).toLocaleString('th-TH')} ครั้ง/ปี`}
                  {item.ipdUses > 0 &&
                    ` · ผู้ป่วยใน ${item.ipdUses.toLocaleString('th-TH')}`}
                </span>
              </span>
            )}
            styles={{ section: { width: '46%', minWidth: 260, height: 560 } }}
          />
        </Spin>
      </section>
    </>
  )
}
