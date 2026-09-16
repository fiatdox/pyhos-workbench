'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ยังทำที่ app/home/rdu/layout.tsx ซึ่งเป็น Server Component)
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Alert,
  Breadcrumb,
  Button,
  Empty,
  InputNumber,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd'
import { NumberOutlined, UndoOutlined } from '@ant-design/icons'
import { apiFetch } from '@/lib/client/session'
import type { AgeSettingValue, TargetSettingValue } from '@/lib/his/rdu-settings'

const { Paragraph, Text, Title } = Typography

/**
 * หน้าตั้งค่าเกณฑ์อายุของตัวชี้วัด
 *
 * แยกจากหน้าทะเบียนยาและทะเบียนรหัสวินิจฉัย เพราะเป็นคนละชนิดของการตั้งค่า —
 * ทะเบียนคือ "นับรายการไหนบ้าง" ส่วนหน้านี้คือ "นับใครบ้าง" และมีผลข้ามหลาย
 * ตัวชี้วัดพร้อมกัน จึงรวมไว้ที่เดียวให้เห็นทั้งหมดในหน้าจอเดียว
 *
 * บันทึกทีละช่องทันทีที่กดปุ่ม ไม่มีปุ่ม "บันทึกทั้งหมด" — ค่าพวกนี้เปลี่ยนตัวหาร
 * ของตัวชี้วัดโดยตรง การกดครั้งเดียวแล้วเปลี่ยนสามข้อพร้อมกันทำให้ไม่มีใคร
 * แน่ใจว่าตัวเลขที่ขยับมาจากการแก้ข้อไหน
 */

/** ค่าที่หน้าจอกำลังแก้อยู่ แยกจากค่าที่บันทึกแล้ว เพื่อรู้ว่ามีอะไรค้างไม่ได้บันทึก */
type Draft = Record<string, number>

export default function AgeCriteriaSettingsPage() {
  const [settings, setSettings] = useState<AgeSettingValue[]>([])
  const [targets, setTargets] = useState<TargetSettingValue[]>([])
  const [draft, setDraft] = useState<Draft>({})
  const [targetDraft, setTargetDraft] = useState<Record<string, number | null>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [toast, toastHolder] = message.useMessage()

  /** รับค่าจากเซิร์ฟเวอร์แล้วรีเซ็ตช่องกรอกให้ตรงกับฐานเสมอ */
  const apply = useCallback((list: AgeSettingValue[]) => {
    setSettings(list)
    setDraft(Object.fromEntries(list.map(item => [item.name, item.value])))
  }, [])

  const applyTargets = useCallback((list: TargetSettingValue[]) => {
    setTargets(list)
    setTargetDraft(Object.fromEntries(list.map(item => [item.name, item.value])))
  }, [])

  /* โหลดค่าตอนเปิดหน้า — เขียนไว้ในเอฟเฟกต์ทั้งก้อนตามแบบหน้าทะเบียน ไม่ได้แยก
     เป็นฟังก์ชันข้างนอกแล้วเรียกเข้ามา เพราะการ setState ตรง ๆ ในตัวเอฟเฟกต์
     ทำให้ React เรนเดอร์ซ้อนกันโดยไม่จำเป็น (loading เริ่มที่ true อยู่แล้ว
     จึงไม่ต้องสั่งอีกรอบ) ส่วน alive กันการ setState หลังผู้ใช้ออกจากหน้าไปแล้ว */
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        // ดึงพร้อมกันสองเส้นทาง — เป็นค่าคนละชนิดแต่แสดงในหน้าเดียว
        const [ageRes, targetRes] = await Promise.all([
          apiFetch('/api/his/rdu/settings/age'),
          apiFetch('/api/his/rdu/settings/target'),
        ])
        const ageJson = await ageRes.json()
        const targetJson = await targetRes.json()
        if (!alive) return
        if (!ageRes.ok || !ageJson.success) {
          setError(ageJson.message ?? 'ดึงค่าเกณฑ์ไม่สำเร็จ')
          return
        }
        apply(ageJson.settings as AgeSettingValue[])
        if (targetRes.ok && targetJson.success) {
          applyTargets(targetJson.targets as TargetSettingValue[])
        }
      } catch {
        if (alive) setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
      } finally {
        if (alive) setLoading(false)
      }
    }
    void load()
    return () => {
      alive = false
    }
  }, [apply, applyTargets])

  const save = async (name: string, value: number) => {
    setSaving(name)
    try {
      const res = await apiFetch('/api/his/rdu/settings/age', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, value }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        toast.error(json.message ?? 'บันทึกไม่สำเร็จ')
        return
      }
      apply(json.settings as AgeSettingValue[])
      toast.success('บันทึกเกณฑ์แล้ว — ตัวเลขของตัวชี้วัดข้อนี้จะเปลี่ยนตามทันที')
    } catch {
      toast.error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setSaving(null)
    }
  }

  const saveTargetValue = async (name: string, value: number | null) => {
    setSaving(name)
    try {
      const res = await apiFetch('/api/his/rdu/settings/target', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, value }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        toast.error(json.message ?? 'บันทึกไม่สำเร็จ')
        return
      }
      applyTargets(json.targets as TargetSettingValue[])
      toast.success(
        value == null ? 'ล้างเกณฑ์แล้ว — กราฟจะไม่ลากเส้นเป้าหมาย' : 'บันทึกเกณฑ์เป้าหมายแล้ว',
      )
    } catch {
      toast.error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setSaving(null)
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
            { title: 'เกณฑ์ของตัวชี้วัด' },
          ]}
        />
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          <NumberOutlined /> เกณฑ์ของตัวชี้วัด
        </Title>
        <div className="mb-2 h-px w-24 bg-linear-to-r from-violet-400/70 to-transparent" />
        <Paragraph type="secondary" style={{ maxWidth: 880, marginBottom: 0, fontSize: 12 }}>
          ตั้งว่าตัวชี้วัดแต่ละข้อนับผู้ป่วยช่วงอายุไหน และเทียบกับเกณฑ์เป้าหมายร้อยละเท่าไร —
          มีผลกับหน้ารายงาน หน้าวิเคราะห์ และหน้าสรุปสามปีทันทีที่กดบันทึก ไม่ต้องรอรอบแก้โปรแกรม
        </Paragraph>
      </section>

      {/* บอกไว้ก่อนแก้ ไม่ใช่หลังแก้ — คนที่เข้ามาลองขยับเส้นเล่นควรรู้ตั้งแต่ต้นว่า
          ตัวเลขที่เคยรายงานไปแล้วจะคำนวณใหม่ตามเกณฑ์ใหม่ทั้งหมด */}
      <Alert
        type="warning"
        showIcon
        className="mb-5"
        title="การแก้เกณฑ์อายุทำให้ตัวเลขย้อนหลังเปลี่ยนตามด้วย"
        description={
          <span className="text-xs leading-relaxed">
            หน้ารายงานกับหน้าวิเคราะห์คำนวณสดทุกครั้งที่เปิดดู ถ้าเปลี่ยนเกณฑ์อายุแล้วเปิดรายงาน
            ของเดือนที่ส่งไปแล้ว จะได้ตัวเลขไม่เท่ากับที่เคยส่ง ส่วนหน้าสรุปสามปีอ่านจากผลที่เก็บไว้
            จึงยังแสดงเลขเดิมจนกว่าจะกดคำนวณใหม่ — ควรตกลงในที่ประชุมก่อนแก้ และจดไว้ว่าเปลี่ยนเมื่อไร
          </span>
        }
      />

      {error && <Alert type="error" showIcon title={error} className="mb-4" />}

      <Spin spinning={loading}>
        {settings.length === 0 && !loading ? (
          <div className="rounded-2xl border border-line bg-panel py-16 backdrop-blur-md">
            <Empty description="ไม่มีเกณฑ์ให้ตั้งค่า" />
          </div>
        ) : (
          <div className="grid gap-3">
            <Title level={4} style={{ color: 'var(--ink)', margin: 0 }}>
              เกณฑ์อายุ
            </Title>
            {settings.map(item => {
              const value = draft[item.name] ?? item.value
              const dirty = value !== item.value
              return (
                <div
                  key={item.name}
                  className="rounded-xl border border-line bg-panel px-4 py-3 backdrop-blur"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                        {item.indicator}
                        {item.custom ? (
                          <Tag color="blue" className="mr-0! text-[11px]">
                            ตั้งเอง
                          </Tag>
                        ) : (
                          <Tag className="mr-0! text-[11px]">ค่าตั้งต้น</Tag>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-ink-3">{item.label}</div>
                      <div className="mt-0.5 text-[11px] text-ink-3">
                        ค่าตามเอกสารตัวชี้วัด {item.fallback} ปี · กรอกได้ {item.min}–{item.max} ปี
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <InputNumber
                        min={item.min}
                        max={item.max}
                        step={1}
                        precision={0}
                        value={value}
                        addonAfter="ปี"
                        style={{ width: 130 }}
                        onChange={next => {
                          if (typeof next === 'number') {
                            setDraft(prev => ({ ...prev, [item.name]: Math.round(next) }))
                          }
                        }}
                      />
                      <Button
                        type="primary"
                        disabled={!dirty}
                        loading={saving === item.name}
                        onClick={() => void save(item.name, value)}
                      >
                        บันทึก
                      </Button>
                      {/* ปุ่มคืนค่าตั้งต้นขึ้นเฉพาะข้อที่ตั้งเองไว้ — ข้อที่ยังเป็นค่าตั้งต้น
                          อยู่แล้วไม่มีอะไรให้คืน การมีปุ่มขึ้นมาเฉย ๆ ชวนให้กดโดยไม่จำเป็น */}
                      {item.custom && (
                        <Button
                          icon={<UndoOutlined />}
                          disabled={saving === item.name}
                          onClick={() => void save(item.name, item.fallback)}
                        >
                          คืนค่าตั้งต้น
                        </Button>
                      )}
                    </div>
                  </div>

                  {dirty && (
                    <Text type="warning" className="mt-2 block text-[11px]">
                      แก้เป็น {value} ปีแล้วแต่ยังไม่ได้บันทึก — ตัวชี้วัดยังใช้ {item.value} ปีอยู่
                    </Text>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ───── เกณฑ์เป้าหมาย ───── */}
        {targets.length > 0 && (
          <section className="mt-8">
            <Title level={4} style={{ color: 'var(--ink)', marginBottom: 4 }}>
              เกณฑ์เป้าหมาย (ร้อยละ)
            </Title>
            <Paragraph type="secondary" style={{ maxWidth: 880, fontSize: 12 }}>
              เส้นเป้าหมายที่ลากในกราฟหน้าสรุปสามปี และคำว่าผ่าน/ไม่ผ่านที่ขึ้นบนการ์ด —
              ต่างจากเกณฑ์อายุตรงที่{' '}
              <Text strong style={{ fontSize: 12 }}>
                ไม่ทำให้ตัวเลขของตัวชี้วัดเปลี่ยน
              </Text>{' '}
              เปลี่ยนแค่เส้นที่เอาไปเทียบ · ข้อที่ยังว่างคือข้อที่ยังไม่ได้ยืนยันเกณฑ์จากเอกสาร
              กราฟจะไม่ลากเส้นให้จนกว่าจะกรอก
            </Paragraph>

            <div className="grid gap-3">
              {targets.map(item => {
                const value = targetDraft[item.name] ?? null
                const dirty = value !== item.value
                return (
                  <div
                    key={item.name}
                    className="rounded-xl border border-line bg-panel px-4 py-3 backdrop-blur"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                          {item.indicator}
                          {item.value == null ? (
                            <Tag color="orange" className="mr-0! text-[11px]">
                              ยังไม่ได้ตั้งเกณฑ์
                            </Tag>
                          ) : item.custom ? (
                            <Tag color="blue" className="mr-0! text-[11px]">
                              ตั้งเอง
                            </Tag>
                          ) : (
                            <Tag className="mr-0! text-[11px]">ค่าตั้งต้น</Tag>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-ink-3">
                          {item.goal === 'low'
                            ? 'ยิ่งต่ำยิ่งดี — เกณฑ์คือเพดานที่ห้ามเกิน'
                            : 'ยิ่งสูงยิ่งดี — เกณฑ์คือพื้นที่ต้องไม่ต่ำกว่า'}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <InputNumber
                          min={0}
                          max={100}
                          step={1}
                          value={value}
                          addonAfter="%"
                          placeholder="ยังไม่ตั้ง"
                          style={{ width: 140 }}
                          onChange={next =>
                            setTargetDraft(prev => ({
                              ...prev,
                              [item.name]: typeof next === 'number' ? next : null,
                            }))
                          }
                        />
                        <Button
                          type="primary"
                          disabled={!dirty || value == null}
                          loading={saving === item.name}
                          onClick={() => void saveTargetValue(item.name, value)}
                        >
                          บันทึก
                        </Button>
                        {item.value != null && (
                          <Button
                            icon={<UndoOutlined />}
                            disabled={saving === item.name}
                            onClick={() => void saveTargetValue(item.name, null)}
                          >
                            ล้างเกณฑ์
                          </Button>
                        )}
                      </div>
                    </div>

                    {dirty && value != null && (
                      <Text type="warning" className="mt-2 block text-[11px]">
                        แก้เป็น {value}% แล้วแต่ยังไม่ได้บันทึก —{' '}
                        {item.value == null ? 'กราฟยังไม่มีเส้นเป้าหมาย' : `กราฟยังใช้ ${item.value}%`}
                      </Text>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}
      </Spin>
    </>
  )
}
