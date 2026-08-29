'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
import { useState } from 'react'
import {
  Alert,
  Button,
  DatePicker,
  Empty,
  Image,
  Input,
  Modal,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { ExperimentOutlined, FileImageOutlined, SearchOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import buddhistEra from 'dayjs/plugin/buddhistEra'
import { apiFetch } from '@/lib/client/session'
import type { HlaResult } from '@/lib/his/hla-b5801'

// เปิด token BBBB (ปี พ.ศ.) ให้ dayjs — ถ้าไม่ extend ปฏิทินจะพิมพ์คำว่า BBBB ออกมาตรง ๆ
dayjs.extend(buddhistEra)

const { Paragraph, Text, Title } = Typography
const { RangePicker } = DatePicker

/** แปลง 'YYYY-MM-DD' เป็น วว/ดด/ปปปป พ.ศ. */
function toThaiDate(value: string | null): string | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return value
  const [, year, month, day] = match
  return `${day}/${month}/${Number(year) + 543}`
}

/** ค่าเริ่มต้น: ย้อนหลัง 30 วันถึงวันนี้ */
const DEFAULT_RANGE: [Dayjs, Dayjs] = [dayjs().subtract(30, 'day'), dayjs()]

export default function HlaB5801Page() {
  const [range, setRange] = useState<[Dayjs, Dayjs]>(DEFAULT_RANGE)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState<HlaResult[] | null>(null)
  const [keyword, setKeyword] = useState('')
  /** คำค้นของผลลัพธ์ที่แสดงอยู่ตอนนี้ — ว่างแปลว่ามาจากการค้นตามช่วงวันที่ */
  const [searchedKeyword, setSearchedKeyword] = useState('')
  const [selected, setSelected] = useState<HlaResult | null>(null)

  /**
   * ค้นสองแบบผ่าน endpoint เดียวกัน
   * - ไม่ส่งคำค้น = ตามช่วงวันที่ที่เลือก
   * - ส่งคำค้น (HN/ชื่อ-สกุล) = ค้นทั้งหมดไม่จำกัดช่วงวันที่
   */
  const search = async (options: { keyword?: string } = {}) => {
    const term = options.keyword?.trim() ?? ''
    if (options.keyword != null && term.length > 0 && term.length < 2) {
      setError('พิมพ์อย่างน้อย 2 ตัวอักษร')
      return
    }
    const query = term
      ? `q=${encodeURIComponent(term)}`
      : `from=${range[0].format('YYYY-MM-DD')}&to=${range[1].format('YYYY-MM-DD')}`

    setLoading(true)
    setError('')
    try {
      const res = await apiFetch(`/api/his/hla-b5801?${query}`)
      const json = await res.json()
      if (!res.ok || !json.success) {
        setResults(null)
        setError(json.message ?? 'ค้นหาไม่สำเร็จ')
        return
      }
      setResults(json.results as HlaResult[])
      setSearchedKeyword(term)
    } catch {
      setResults(null)
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setLoading(false)
    }
  }

  const columns: ColumnsType<HlaResult> = [
    {
      title: 'วันที่รายงานผล',
      dataIndex: 'reportDate',
      key: 'reportDate',
      width: 140,
      render: (value: string | null, row) => (
        <span className="font-mono text-xs">
          {[toThaiDate(value) ?? '—', row.reportTime].filter(Boolean).join(' ')}
        </span>
      ),
    },
    {
      title: 'วันที่สั่งตรวจ',
      dataIndex: 'orderDate',
      key: 'orderDate',
      width: 130,
      render: (value: string | null, row) => (
        <span className="font-mono text-xs opacity-75">
          {[toThaiDate(value) ?? '—', row.orderTime].filter(Boolean).join(' ')}
        </span>
      ),
    },
    {
      title: 'HN',
      dataIndex: 'hn',
      key: 'hn',
      width: 110,
      render: (value: string) => <span className="font-mono text-xs">{value}</span>,
    },
    {
      title: 'ชื่อ-สกุล',
      dataIndex: 'patientName',
      key: 'patientName',
      width: 220,
      render: (value: string | null, row) => (
        <div className="leading-snug">
          <div>{value ?? '—'}</div>
          {row.age != null && (
            <Text type="secondary" className="text-[11px]">
              {row.age} ปี
            </Text>
          )}
        </div>
      ),
    },
    {
      title: 'ผล',
      dataIndex: 'result',
      key: 'result',
      width: 160,
      render: (value: string | null) => value ?? <Text type="secondary">—</Text>,
    },
    {
      title: 'แพทย์ผู้สั่ง',
      dataIndex: 'doctor',
      key: 'doctor',
      width: 200,
      render: (value: string | null) => value ?? <Text type="secondary">—</Text>,
    },
    {
      title: 'รูปผลตรวจ',
      key: 'images',
      width: 150,
      render: (_: unknown, row) =>
        row.images.length > 0 ? (
          <Button size="small" icon={<FileImageOutlined />} onClick={() => setSelected(row)}>
            ดูรูป ({row.images.length})
          </Button>
        ) : (
          <Tag>ไม่มีรูป</Tag>
        ),
    },
  ]

  return (
    <>
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-violet-500/15 text-lg text-violet-200">
          <ExperimentOutlined />
        </div>
        <div>
          <Title level={3} style={{ color: '#fff', margin: 0 }}>ผลตรวจ HLA-B*5801</Title>
          <Paragraph type="secondary" style={{ margin: 0, fontSize: 12 }}>
            ผู้ป่วยที่มีการรายงานผลแล้วในช่วงวันที่ที่เลือก คลิกเพื่อดูรูปใบรายงาน
          </Paragraph>
        </div>
      </div>

      {/* ───────────── ช่วงวันที่ + ช่องกรอง ───────────── */}
      <div className="mb-5">
        <div className="flex flex-wrap items-center gap-3">
        <Space.Compact>
          <RangePicker
            size="large"
            allowClear={false}
            value={range}
            format="DD/MM/BBBB"
            // ห้ามเลือกวันในอนาคต — ผลที่ยังไม่รายงานย่อมไม่มี
            maxDate={dayjs()}
            onChange={dates => {
              if (dates?.[0] && dates[1]) setRange([dates[0], dates[1]])
            }}
          />
          <Button size="large" type="primary" loading={loading} onClick={() => void search()}>
            ค้นหา
          </Button>
        </Space.Compact>

          {/* ค้นด้วย HN หรือชื่อ-สกุล — ไม่จำกัดช่วงวันที่ */}
          <Input.Search
            allowClear
            size="large"
            placeholder="ค้นด้วย HN หรือชื่อ-สกุล"
            prefix={<SearchOutlined className="opacity-50" />}
            enterButton="ค้น"
            loading={loading}
            value={keyword}
            onChange={e => {
              setKeyword(e.target.value)
              // ล้างช่องค้น = กลับไปดูตามช่วงวันที่
              if (!e.target.value && searchedKeyword) void search({ keyword: '' })
            }}
            onSearch={value => void search({ keyword: value })}
            style={{ width: 320 }}
          />
        </div>
        {/* คำอธิบายอยู่บรรทัดของตัวเอง ใต้ช่องเลือกวันที่ */}
        <Text type="secondary" className="mt-1.5 block text-[11px]">
          ช่วงวันที่ = ค้นจากวันที่รายงานผล เลือกได้ไม่เกิน 366 วัน · ค้นด้วย HN
          หรือชื่อ-สกุล = ค้นทุกช่วงวันที่ · แสดงสูงสุด 500 รายการ
        </Text>
      </div>

      {error && <Alert type="error" showIcon title={error} className="mb-5" />}

      <Spin spinning={loading}>
        {results ? (
          <>
            <div className="mb-2.5 text-xs text-slate-400">
              พบ {results.length} รายการ
              {searchedKeyword
                ? ` จากคำค้น "${searchedKeyword}" (ทุกช่วงวันที่)`
                : ''}
            </div>
            <div className="data-sheet">
              <Table<HlaResult>
                rowKey="labOrderNumber"
                size="small"
                columns={columns}
                dataSource={results}
                pagination={false}
                scroll={{ x: 'max-content', y: 'calc(100vh - 330px)' }}
                locale={{
                  emptyText: (
                    <Empty
                      description={
                        searchedKeyword
                          ? 'ไม่พบผู้ป่วยที่ตรงกับคำค้น'
                          : 'ไม่พบผลตรวจในช่วงวันที่ที่เลือก'
                      }
                    />
                  ),
                }}
              />
            </div>
          </>
        ) : (
          !loading && (
            <div className="rounded-2xl border border-white/10 bg-white/3 py-16 backdrop-blur-md">
              <Empty description="เลือกช่วงวันที่แล้วกดค้นหา" />
            </div>
          )
        )}
      </Spin>

      {/* ───────────── Modal: รูปใบรายงานผล ───────────── */}
      <Modal
        title={
          selected
            ? `ผลตรวจ HLA-B*5801 · HN ${selected.hn} · ${selected.patientName ?? ''}`
            : 'ผลตรวจ HLA-B*5801'
        }
        open={selected != null}
        onCancel={() => setSelected(null)}
        footer={null}
        width="92vw"
        style={{ top: 24, maxWidth: 1400 }}
        styles={{ body: { maxHeight: 'calc(100vh - 140px)', overflowY: 'auto' } }}
      >
        {selected && (
          <>
            <div className="mb-3 text-xs text-slate-400">
              รายงานเมื่อ {toThaiDate(selected.reportDate) ?? '—'} {selected.reportTime ?? ''}
              {selected.formName ? ` · ${selected.formName}` : ''}
            </div>
            {/* โหลดรูปเมื่อเลื่อนถึงเท่านั้น แต่ละใบมีขนาดหลักร้อย KB */}
            <Image.PreviewGroup>
              <div className="flex flex-wrap gap-3">
                {selected.images.map(index => (
                  <Image
                    key={index}
                    src={`/api/his/hla-b5801/image?lab_order_number=${selected.labOrderNumber}&index=${index}`}
                    alt={`ใบรายงานผล HLA-B*5801 แผ่นที่ ${index}`}
                    width={260}
                    loading="lazy"
                    style={{ borderRadius: 8 }}
                  />
                ))}
              </div>
            </Image.PreviewGroup>
          </>
        )}
      </Modal>
    </>
  )
}
