'use client'
import { useEffect, useState } from 'react'
import { Alert, Button, Spin, Tag, Typography } from 'antd'
import { BulbOutlined, ReloadOutlined } from '@ant-design/icons'
import { apiFetch } from '@/lib/client/session'

const { Text } = Typography

/**
 * แผงสรุปข้อมูลช่วยพิจารณาจากโมเดลภาษาที่รันในเครือข่ายโรงพยาบาล
 *
 * ทั้งแผงหายไปทั้งก้อนเมื่อเครื่องนั้นไม่ได้ตั้งค่าโมเดลไว้ (ถาม API ครั้งเดียวตอน
 * เปิดหน้า) — เครื่องที่ไม่มีโมเดลจะไม่เห็นแม้แต่ปุ่ม ไม่ใช่เห็นปุ่มแล้วกดไปเจอ error
 *
 * ไม่ยิงอัตโนมัติทันทีที่ได้ HN แต่ให้กดเอง เพราะการเรียกหนึ่งครั้งกินเวลาหลายวินาที
 * และผู้ใช้ควรเลือกยาก่อนถึงจะได้บทสรุปที่ตรงกับเรื่องที่กำลังขอ
 */
export default function AssistPanel({ hn, drugName }: { hn: string; drugName: string | null }) {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [model, setModel] = useState<string | null>(null)
  /** ชื่อโมเดลใน .env ไม่ตรงกับที่ปลายทางโหลดไว้ — เตือนก่อนกดจะได้ไม่งงตอนพัง */
  const [modelMismatch, setModelMismatch] = useState<string[] | null>(null)
  const [summary, setSummary] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  /** HN ของบทสรุปที่แสดงอยู่ — เปลี่ยนคนไข้แล้วต้องไม่ค้างของคนเก่า */
  const [summaryHn, setSummaryHn] = useState('')

  useEffect(() => {
    let alive = true
    const run = async () => {
      try {
        const res = await apiFetch('/api/his/due/assist')
        const json = await res.json()
        if (!alive) return
        setAvailable(Boolean(json.available))
        setModel(typeof json.model === 'string' ? json.model : null)
        if (json.modelLoaded === false) {
          setModelMismatch(Array.isArray(json.availableModels) ? json.availableModels : [])
        }
      } catch {
        // ถามไม่ได้ก็ถือว่าปิด ดีกว่าขึ้นปุ่มที่กดแล้วพัง
        if (alive) setAvailable(false)
      }
    }
    void run()
    return () => {
      alive = false
    }
  }, [])

  const ask = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('/api/his/due/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hn, drugName }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        setSummary('')
        setError(json.message ?? 'สรุปข้อมูลไม่สำเร็จ')
        return
      }
      setSummary(String(json.summary ?? ''))
      setSummaryHn(hn)
    } catch {
      setSummary('')
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setLoading(false)
    }
  }

  if (available !== true) return null

  const stale = summary !== '' && summaryHn !== hn

  return (
    <section className="mt-6 rounded-2xl border border-line bg-panel p-5 backdrop-blur">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="text-sm font-semibold text-ink">
          <BulbOutlined /> ข้อมูลช่วยพิจารณา
        </div>
        {model && (
          <Tag className="mr-0!" color="default">
            {model}
          </Tag>
        )}
        <Button
          size="small"
          type={summary ? 'default' : 'primary'}
          icon={summary ? <ReloadOutlined /> : <BulbOutlined />}
          loading={loading}
          onClick={() => void ask()}
          className="ml-auto"
        >
          {summary ? 'สรุปใหม่' : 'ให้ช่วยสรุป'}
        </Button>
      </div>

      <Alert
        type="warning"
        showIcon
        className="mb-3"
        title="เป็นข้อมูลประกอบการพิจารณาเท่านั้น"
        description={
          <span className="text-xs">
            ข้อความสร้างจากข้อมูลผู้ป่วยที่ระบบดึงมาแสดงในหน้านี้ ต้องตรวจกับค่าจริงทุกครั้ง
            ก่อนใช้ประกอบการตัดสินใจ และไม่ใช่คำวินิจฉัยหรือคำสั่งการรักษา
          </span>
        }
      />

      {modelMismatch && (
        <Alert
          type="warning"
          showIcon
          className="mb-3"
          title={`ชื่อโมเดลใน .env (${model}) ไม่ตรงกับที่เครื่องนี้โหลดไว้`}
          description={
            <span className="text-xs">
              {modelMismatch.length > 0
                ? `ที่โหลดอยู่: ${modelMismatch.join(', ')} — แก้ LLM_MODEL ให้ตรงแล้วรีสตาร์ทเซิร์ฟเวอร์`
                : 'ปลายทางยังไม่ได้โหลดโมเดลไว้ กดสรุปตอนนี้จะไม่สำเร็จ'}
            </span>
          }
        />
      )}

      {error && <Alert type="error" showIcon title={error} className="mb-3" />}

      {stale && (
        <Alert
          type="info"
          showIcon
          className="mb-3"
          title="บทสรุปนี้เป็นของผู้ป่วยรายก่อนหน้า กดสรุปใหม่เพื่อดูของรายปัจจุบัน"
        />
      )}

      <Spin spinning={loading}>
        {summary ? (
          // ข้อความจากโมเดลเป็นข้อความล้วน แสดงตามบรรทัดที่มันขึ้นมา ไม่แปลง markdown
          // เพื่อไม่ให้เนื้อหาถูกตีความเป็น HTML
          <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-ink">
            {summary}
          </pre>
        ) : (
          <Text type="secondary" className="text-xs">
            {loading
              ? 'กำลังสรุป อาจใช้เวลาสักครู่'
              : 'กดปุ่มเพื่อให้ช่วยสรุปค่าไต ประวัติยาต้าน และประเด็นที่ต้องดูก่อนพิจารณา'}
          </Text>
        )}
      </Spin>
    </section>
  )
}
