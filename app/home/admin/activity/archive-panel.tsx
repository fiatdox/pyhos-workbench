'use client'
import { useEffect, useState } from 'react'
import { Alert, Button, InputNumber, Popconfirm, Tag, Typography, message } from 'antd'
import { DatabaseOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons'
import { apiFetch } from '@/lib/client/session'

const { Text } = Typography

type Status = {
  rows: number
  size: string
  oldest: string | null
  newest: string | null
  archivable: number
  keepDays: number
  directory: string
}

/**
 * แผงสำรองและตัดร่องรอยเก่า
 *
 * แยกไฟล์จาก activity-view.tsx เพราะเป็นงานคนละเรื่องกัน — ฝั่งนั้นอ่านอย่างเดียว
 * ส่วนฝั่งนี้ลบข้อมูลจริง ปนกันแล้วจะแยกไม่ออกว่าส่วนไหนเป็นอันตราย
 *
 * ไม่ตัดอัตโนมัติเมื่อถึงเกณฑ์ ต้องมีคนกด — ระบบที่ลบหลักฐานได้เองโดยไม่มีใครสั่ง
 * เป็นสิ่งที่อธิบายกับผู้ตรวจยาก ที่หน้าจอทำได้คือบอกให้ชัดว่าถึงเวลาแล้ว
 */
export default function ArchivePanel({ onDone }: { onDone: () => void }) {
  const [toast, toastHolder] = message.useMessage()
  const [status, setStatus] = useState<Status | null>(null)
  const [keepDays, setKeepDays] = useState<number>(180)
  const [minKeepDays, setMinKeepDays] = useState(90)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [lastResult, setLastResult] = useState<string | null>(null)

  /** ขยับเพื่อให้โหลดสถานะใหม่ — ใช้ทั้งปุ่มรีเฟรชและหลังตัดข้อมูลเสร็จ */
  const [tick, setTick] = useState(0)

  // โหลดใหม่ทุกครั้งที่จำนวนวันเปลี่ยน เพราะ "ตัดได้กี่แถว" ขึ้นกับค่านั้นโดยตรง
  // ผู้ใช้จึงเห็นผลของการปรับตัวเลขทันทีก่อนตัดสินใจกด
  useEffect(() => {
    let alive = true
    const run = async () => {
      setLoading(true)
      try {
        const res = await apiFetch(`/api/activity/archive?keepDays=${keepDays}`)
        const json = await res.json()
        if (!alive) return
        if (!res.ok || !json.success) {
          toast.error(json.message ?? 'อ่านสถานะไม่สำเร็จ')
          return
        }
        setStatus(json.status as Status)
        setMinKeepDays(Number(json.minKeepDays ?? 90))
      } catch {
        if (alive) toast.error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')
      } finally {
        if (alive) setLoading(false)
      }
    }
    void run()
    return () => {
      alive = false
    }
  }, [keepDays, tick, toast])

  const run = async () => {
    setRunning(true)
    try {
      const res = await apiFetch('/api/activity/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keepDays }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        toast.error(json.message ?? 'สำรองข้อมูลไม่สำเร็จ')
        return
      }
      const moved = Number(json.moved ?? 0)
      if (moved === 0) {
        toast.info('ไม่มีร่องรอยที่เก่าพอให้ตัด')
      } else {
        const mb = (Number(json.bytes ?? 0) / 1024 / 1024).toFixed(2)
        setLastResult(`ย้าย ${moved.toLocaleString('th-TH')} แถวไปไว้ที่ ${json.file} (${mb} MB)`)
        toast.success(`สำรองและตัด ${moved.toLocaleString('th-TH')} แถวแล้ว`)
        onDone()
      }
      setTick(value => value + 1)
    } catch {
      toast.error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')
    } finally {
      setRunning(false)
    }
  }

  // เตือนเมื่อของเก่าเกินครึ่งตาราง — ตัวเลขนี้ไม่ใช่เกณฑ์ทางเทคนิค แค่จุดที่การตัด
  // เริ่มคุ้มค่าพอจะบอกคน ถ้ายังไม่ถึงก็ไม่ต้องรบกวน
  const worthTrimming =
    status != null && status.archivable > 0 && status.archivable >= status.rows / 2

  return (
    <section className="mb-4 rounded-2xl border border-line bg-panel p-4">
      {toastHolder}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <DatabaseOutlined className="text-accent" />
        <span className="text-xs font-semibold text-ink">สำรองและตัดร่องรอยเก่า</span>
        {status && (
          <Tag className="mr-0!">
            {status.rows.toLocaleString('th-TH')} แถว · {status.size}
          </Tag>
        )}
        {status && status.archivable > 0 && (
          <Tag color={worthTrimming ? 'orange' : 'default'} className="mr-0!">
            ตัดได้ {status.archivable.toLocaleString('th-TH')} แถว
          </Tag>
        )}
        <Button
          size="small"
          type="text"
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={() => setTick(value => value + 1)}
        >
          รีเฟรช
        </Button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Text type="secondary" className="text-xs">
          เก็บไว้ในตาราง
        </Text>
        <InputNumber
          size="small"
          className="w-24"
          min={minKeepDays}
          max={3650}
          step={30}
          value={keepDays}
          onChange={value => {
            const days = Number(value ?? minKeepDays)
            setKeepDays(days)
          }}
        />
        <Text type="secondary" className="text-xs">
          วันล่าสุด · ที่เก่ากว่านั้นย้ายออกเป็นไฟล์ (ระบบไม่ยอมให้ตั้งต่ำกว่า {minKeepDays} วัน)
        </Text>

        <Popconfirm
          title="สำรองและตัดร่องรอยเก่า"
          description={
            <span className="text-xs">
              ย้าย {(status?.archivable ?? 0).toLocaleString('th-TH')} แถวออกเป็นไฟล์บีบอัด
              แล้วลบออกจากตาราง — เขียนไฟล์เสร็จก่อนจึงลบเสมอ และการกดครั้งนี้จะถูกบันทึกไว้เอง
            </span>
          }
          okText="สำรองและตัด"
          cancelText="ยกเลิก"
          okButtonProps={{ danger: true }}
          onConfirm={run}
          disabled={!status || status.archivable === 0}
        >
          <Button
            danger
            size="small"
            className="ml-auto"
            icon={<DeleteOutlined />}
            loading={running}
            disabled={!status || status.archivable === 0}
          >
            สำรองและตัด
          </Button>
        </Popconfirm>
      </div>

      {status && (
        <div className="font-mono text-[11px] text-ink-3">
          ปลายทางไฟล์: {status.directory}
        </div>
      )}

      {worthTrimming && (
        <Alert
          className="mt-3"
          type="warning"
          showIcon
          title="ถึงเวลาตัดข้อมูลแล้ว"
          description={
            <span className="text-xs">
              ร่องรอยที่เก่ากว่า {keepDays} วันมีมากกว่าครึ่งหนึ่งของทั้งตาราง
              ย้ายออกได้โดยไม่กระทบการสอบเหตุการณ์ในช่วงที่ยังต้องใช้
            </span>
          }
        />
      )}

      {lastResult && (
        <Alert
          className="mt-3"
          type="success"
          showIcon
          title="สำรองเรียบร้อย"
          description={<span className="font-mono text-[11px] break-all">{lastResult}</span>}
        />
      )}
    </section>
  )
}
