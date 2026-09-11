'use client'
import { useEffect, useRef, useState } from 'react'
import { Checkbox, DatePicker, Input, InputNumber, Modal, Radio, Select, Typography } from 'antd'
import { UserOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import buddhistEra from 'dayjs/plugin/buddhistEra'
import { apiFetch } from '@/lib/client/session'
import ReferenceTabs, { type RationalUse } from '../reference-tabs'
import {
  APPROPRIATE_OPTIONS,
  DRP_OPTIONS,
  DURATION_OPTIONS,
  EVAL_STATUS_OPTIONS,
  INDICATION_TYPES,
  INTERVENTION_OPTIONS,
  MOCK_PHARMACISTS,
  PATHOGEN_SOURCES,
  type DrugEvaluation,
  type MockDrug,
  type MockRequest,
} from '../mock-data'

dayjs.extend(buddhistEra)

const { Text } = Typography
const { TextArea } = Input

/** ค่าเริ่มต้น — ไม่เลือกอะไรไว้ล่วงหน้า ให้เภสัชกรตอบเองทุกข้อ */
export function emptyEvaluation(): DrugEvaluation {
  return {
    indicationType: null,
    indicationAppropriate: null,
    doseAppropriate: null,
    durationDays: null,
    durationAppropriate: null,
    drps: [],
    drpOther: '',
    interventions: [],
    interventionOther: '',
    evalStatus: null,
    adr: '',
    // ตั้งครบทุกแถวไว้ตั้งแต่แรก จะได้ไม่ต้องคอยหาว่าแถวไหนมีอยู่แล้วตอนติ๊ก
    pathogens: PATHOGEN_SOURCES.map(source => ({
      source,
      checked: false,
      date: null,
      detail: '',
    })),
    note: '',
    evaluatorName: null,
    evaluatedAt: '',
  }
}

/** เติมแถวเชื้อที่ขาดให้ครบ — ข้อมูลเก่าอาจเก็บไว้เฉพาะแถวที่ติ๊ก */
function fillPathogens(evaluation: DrugEvaluation): DrugEvaluation {
  const bySource = new Map(evaluation.pathogens.map(row => [row.source, row]))
  return {
    ...evaluation,
    pathogens: PATHOGEN_SOURCES.map(
      source => bySource.get(source) ?? { source, checked: false, date: null, detail: '' },
    ),
  }
}

/** หัวคอลัมน์สีม่วงแบบเดียวกับแบบฟอร์มกระดาษ */
function Head({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-line bg-accent-soft px-3 py-1.5 text-center text-[11px] font-semibold text-ink">
      {children}
    </div>
  )
}

/** ตัวเลือกแบบเรียงลงเป็นคอลัมน์ — ข้อความยาว วางแนวนอนแล้วอ่านไม่ทัน */
function StackedRadio({
  value,
  onChange,
  options,
}: {
  value: string | null
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <Radio.Group value={value} onChange={event => onChange(event.target.value)}>
      <div className="flex flex-col gap-2">
        {options.map(option => (
          <Radio key={option.value} value={option.value} className="items-start!">
            <span className="text-xs leading-snug">{option.label}</span>
          </Radio>
        ))}
      </div>
    </Radio.Group>
  )
}

function StackedCheckbox({
  value,
  onChange,
  options,
}: {
  value: string[]
  onChange: (value: string[]) => void
  options: string[]
}) {
  return (
    <Checkbox.Group value={value} onChange={onChange as (value: unknown[]) => void}>
      <div className="flex flex-col gap-2">
        {options.map(option => (
          <Checkbox key={option} value={option} className="items-start!">
            <span className="text-xs leading-snug">{option}</span>
          </Checkbox>
        ))}
      </div>
    </Checkbox.Group>
  )
}

/** ผลวิเคราะห์ของยาหนึ่งตัวในใบคำขอหนึ่งใบ */
type Analysis = {
  /** ยาที่ผลนี้เป็นของมัน — กันเอาผลของยาตัวก่อนหน้ามาแสดงทับ */
  key: string
  status: 'done' | 'error'
  text: string
  message: string
  model: string | null
  elapsedMs: number | null
}

/**
 * วิเคราะห์ความสมเหตุผลของการใช้ยาให้อัตโนมัติตลอดเวลาที่แบบประเมินเปิดอยู่
 *
 * เริ่มทันทีที่เปิด ไม่รอให้กดแท็บ เพราะโมเดลใช้เวลาเป็นสิบวินาที ถ้าเริ่มตอนกด
 * เภสัชกรจะต้องนั่งรอ แต่ถ้าเริ่มตั้งแต่เปิด กว่าจะกรอกถึงหัวข้อที่ต้องใช้ก็เสร็จพอดี
 *
 * ปิดแบบประเมิน (หรือสลับไปยาตัวอื่น) = ยกเลิกคำขอที่ค้างอยู่ทันที ทั้งฝั่งเบราว์เซอร์
 * และฝั่งเซิร์ฟเวอร์ที่ส่งสัญญาณต่อไปให้ตัวรันโมเดล — ตัวรันโมเดลทำงานทีละคำขอ
 * ถ้าไม่ยกเลิก คำขอที่ไม่มีใครรอแล้วจะหน่วงคำขอถัดไปที่มีคนรออยู่จริง
 */
function useRationalUse(
  open: boolean,
  request: MockRequest | null,
  drug: MockDrug | null,
): RationalUse | undefined {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [result, setResult] = useState<Analysis | null>(null)
  /** เพิ่มค่าเพื่อสั่งวิเคราะห์ใหม่ทั้งที่ยาตัวเดิม */
  const [round, setRound] = useState(0)

  /** ข้อมูลเคสล่าสุด — อ่านผ่าน ref เพื่อไม่ให้การบันทึกผลประเมิน (ซึ่งสร้าง
      object ใหม่) ไปสั่งให้วิเคราะห์ใหม่ทั้งที่ข้อมูลที่ใช้วิเคราะห์ไม่ได้เปลี่ยน */
  const caseRef = useRef<{ request: MockRequest | null; drug: MockDrug | null }>({
    request: null,
    drug: null,
  })
  useEffect(() => {
    caseRef.current = { request, drug }
  })

  useEffect(() => {
    let alive = true
    const run = async () => {
      try {
        const res = await apiFetch('/api/his/due/assist')
        const json = await res.json()
        if (alive) setAvailable(Boolean(json.available))
      } catch {
        // ถามไม่ได้ก็ถือว่าปิด ดีกว่าขึ้นแท็บที่เปิดเข้าไปแล้วไม่มีอะไร
        if (alive) setAvailable(false)
      }
    }
    void run()
    return () => {
      alive = false
    }
  }, [])

  const key = open && request && drug ? `${request.id}#${drug.id}` : null

  useEffect(() => {
    if (key == null || available !== true) return
    const controller = new AbortController()

    const run = async () => {
      const { request: req, drug: item } = caseRef.current
      if (!req || !item) return
      try {
        const res = await apiFetch('/api/his/due/rational-use', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          // ส่งเฉพาะที่ใช้วิเคราะห์ ไม่มีชื่อและ HN — ฝั่งเซิร์ฟเวอร์คัดฟิลด์ซ้ำอีกชั้น
          body: JSON.stringify({
            drug: {
              name: item.name,
              dose: item.dose,
              startedAt: item.startedAt,
              indication: item.indicationOther
                ? `${item.indication} : ${item.indicationOther}`
                : item.indication,
            },
            age: req.age,
            sex: req.sex,
            visitType: req.visitType,
            wardName: req.wardName,
            renal: {
              cr: req.cr,
              weight: req.weight,
              crcl: req.crcl,
              egfr: req.egfr,
              measuredAt: req.creatinineAt,
              awaiting: req.awaitingCreatinine,
            },
            sepsis: req.sepsis === 'yes',
            infectionSource:
              req.infectionSource === 'hospital' ? 'ติดเชื้อในโรงพยาบาล' : 'ติดเชื้อจากชุมชน',
            diagnosis: req.diagnosisOther
              ? `${req.diagnosis} : ${req.diagnosisOther}`
              : req.diagnosis,
            infectionSite: req.infectionSite,
            allergies: req.allergies,
            conditions: req.conditions,
            prior: {
              none: req.noPriorAntibiotic,
              name: req.priorAntibiotic,
              startedAt: req.priorStartedAt,
              days: req.priorDays,
            },
            specimens: req.specimens,
            antibiotics: req.antibioticHistory.map(row => ({
              rxAt: row.rxAt,
              drugName: row.drugName,
              usage: row.usage,
              qty: row.qty,
            })),
          }),
        })
        const json = await res.json()
        if (controller.signal.aborted) return
        if (!res.ok || !json.success) {
          setResult({
            key,
            status: 'error',
            text: '',
            message: json.message ?? 'วิเคราะห์ไม่สำเร็จ',
            model: null,
            elapsedMs: null,
          })
          return
        }
        setResult({
          key,
          status: 'done',
          text: String(json.analysis ?? ''),
          message: '',
          model: typeof json.model === 'string' ? json.model : null,
          elapsedMs: typeof json.elapsedMs === 'number' ? json.elapsedMs : null,
        })
      } catch {
        // ยกเลิกเองไม่ใช่ข้อผิดพลาด อย่าไปเขียนทับหน้าจอที่กำลังปิด
        if (controller.signal.aborted) return
        setResult({
          key,
          status: 'error',
          text: '',
          message: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้',
          model: null,
          elapsedMs: null,
        })
      }
    }

    void run()
    return () => controller.abort()
  }, [key, available, round])

  if (key == null || available !== true) return undefined

  // ผลของยาตัวอื่นถือว่ายังไม่มีผล — สถานะจึงกลับไปเป็นกำลังวิเคราะห์เอง
  // โดยไม่ต้องสั่ง setState ตอนสลับยา
  const current = result?.key === key ? result : null

  return {
    status: current?.status ?? 'loading',
    text: current?.text ?? '',
    message: current?.message ?? '',
    model: current?.model ?? null,
    elapsedMs: current?.elapsedMs ?? null,
    onRetry: () => {
      setResult(null)
      setRound(value => value + 1)
    },
  }
}

/**
 * แบบประเมินการใช้ยาหนึ่งตัว
 *
 * วางผังตามแบบฟอร์มกระดาษที่ใช้อยู่จริง — แถวบนเป็นความเหมาะสมของการสั่งใช้
 * (6 คอลัมน์) แถวล่างเป็น DRPs / Intervention / สถานะ / หมายเหตุ (4 คอลัมน์)
 * จอแคบกว่า xl ตกลงมาเรียงต่อกันเป็นคอลัมน์เดียว
 */
export default function EvaluationModal({
  open,
  request,
  drug,
  onClose,
  onSave,
  onOpenCulture,
}: {
  open: boolean
  request: MockRequest | null
  drug: MockDrug | null
  onClose: () => void
  onSave: (drugId: number, evaluation: DrugEvaluation) => void
  /** เปิดใบรายงานผลเพาะเชื้อฉบับเต็ม — ใช้ modal ตัวเดียวกับหน้าอื่น */
  onOpenCulture: () => void
}) {
  const rationalUse = useRationalUse(open, request, drug)
  const [form, setForm] = useState<DrugEvaluation>(emptyEvaluation())
  /** ยาตัวที่โหลดค่าเข้าฟอร์มไปแล้ว — กันโหลดทับค่าที่กำลังกรอกอยู่ทุกครั้งที่ re-render */
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  const formKey = request && drug ? `${request.id}#${drug.id}` : null
  if (open && formKey && formKey !== loadedFor) {
    // มีผลประเมินเดิมก็แก้ต่อจากของเดิม ไม่ใช่เริ่มกรอกใหม่
    setForm(drug!.evaluation ? fillPathogens(drug!.evaluation) : emptyEvaluation())
    setLoadedFor(formKey)
  }

  const patch = (next: Partial<DrugEvaluation>) => setForm(prev => ({ ...prev, ...next }))

  const patchPathogen = (source: string, next: Partial<DrugEvaluation['pathogens'][number]>) =>
    setForm(prev => ({
      ...prev,
      pathogens: prev.pathogens.map(row => (row.source === source ? { ...row, ...next } : row)),
    }))

  const save = () => {
    if (!drug) return
    onSave(drug.id, {
      ...form,
      evaluatedAt: dayjs().format('YYYY-MM-DD HH:mm'),
    })
    setLoadedFor(null)
  }

  const close = () => {
    setLoadedFor(null)
    onClose()
  }

  return (
    <Modal
      open={open}
      onCancel={close}
      onOk={save}
      okText="บันทึกผลประเมิน"
      cancelText="ยกเลิก"
      // ฟอร์มนี้มี 6 คอลัมน์ในแถวบน แคบกว่านี้ตัวเลือกจะตัดคำจนอ่านไม่ออก
      width="96vw"
      style={{ maxWidth: 1700, top: 16 }}
      // กำหนด padding เองเพื่อให้แถบ sticky ใช้ -mx-6 px-6 กินเต็มความกว้างได้
      // ถ้าปล่อยเป็นค่าเริ่มต้น เนื้อหาที่เลื่อนผ่านจะโผล่ตรงขอบซ้ายขวาของแถบ
      styles={{
        body: { maxHeight: 'calc(100vh - 190px)', overflow: 'auto', padding: '0 24px' },
      }}
      title="ประเมินการใช้ยา"
      okButtonProps={{ disabled: form.evaluatorName == null }}
    >
      {request && drug && (
        <div className="space-y-4 pb-2">
          <ReferenceTabs
            request={request}
            onOpenCulture={onOpenCulture}
            rationalUse={rationalUse}
          />

          {/* ───── แถวบน: ความเหมาะสมของการสั่งใช้ ───── */}
          <div className="overflow-hidden rounded-lg border border-line">
            <div className="grid xl:grid-cols-12">
              <div className="xl:col-span-3">
                <Head>รายการยาต้านจุลชีพ</Head>
                <div className="flex gap-2 p-3">
                  <span className="text-xs text-ink-3">{drug.id}</span>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-accent italic">{drug.name}</div>
                    <div className="text-xs text-ink">/ {drug.dose}</div>
                    <div className="mt-1 text-xs text-ink">
                      <b>Rx date. :</b> {drug.startedAt}
                    </div>
                    <div className="mt-1 text-xs leading-snug text-ink">
                      {drug.indication}
                      {drug.indicationOther && ` : ${drug.indicationOther}`}
                    </div>
                    <div className="mt-1 text-xs text-ink">
                      สถานะการจ่ายยา :{' '}
                      <span className="font-semibold text-lab-chip">
                        {request.status === 'accepted' ? 'จ่ายแล้ว' : 'รออนุมัติ'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t border-line xl:col-span-2 xl:border-l xl:border-t-0">
                <Head>ข้อบ่งใช้</Head>
                <div className="p-3">
                  <StackedRadio
                    value={form.indicationType}
                    onChange={value => patch({ indicationType: value })}
                    options={INDICATION_TYPES}
                  />
                </div>
              </div>

              <div className="border-t border-line xl:col-span-2 xl:border-l xl:border-t-0">
                <Head>ความเหมาะสมข้อบ่งใช้</Head>
                <div className="p-3">
                  <StackedRadio
                    value={form.indicationAppropriate}
                    onChange={value => patch({ indicationAppropriate: value })}
                    options={APPROPRIATE_OPTIONS}
                  />
                </div>
              </div>

              <div className="border-t border-line xl:col-span-2 xl:border-l xl:border-t-0">
                <Head>ความเหมาะสมขนาดยา</Head>
                <div className="p-3">
                  <StackedRadio
                    value={form.doseAppropriate}
                    onChange={value => patch({ doseAppropriate: value })}
                    options={APPROPRIATE_OPTIONS}
                  />
                </div>
              </div>

              <div className="border-t border-line xl:col-span-1 xl:border-l xl:border-t-0">
                <Head>ระยะเวลาการใช้</Head>
                <div className="p-3">
                  <InputNumber
                    className="w-full"
                    min={0}
                    value={form.durationDays}
                    onChange={value => patch({ durationDays: value })}
                    aria-label="ระยะเวลาการใช้ (วัน)"
                  />
                </div>
              </div>

              <div className="border-t border-line xl:col-span-2 xl:border-l xl:border-t-0">
                <Head>ความเหมาะสมของระยะเวลาการใช้ยา</Head>
                <div className="p-3">
                  <StackedRadio
                    value={form.durationAppropriate}
                    onChange={value => patch({ durationAppropriate: value })}
                    options={DURATION_OPTIONS}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ───── แถวล่าง: DRPs / Intervention / สถานะ / หมายเหตุ ───── */}
          <div className="overflow-hidden rounded-lg border border-line">
            <div className="grid xl:grid-cols-12">
              <div className="xl:col-span-3">
                <Head>DRPs</Head>
                <div className="space-y-2 p-3">
                  <StackedCheckbox
                    value={form.drps}
                    onChange={value => patch({ drps: value })}
                    options={DRP_OPTIONS}
                  />
                  <Input
                    placeholder="อื่นๆ"
                    value={form.drpOther}
                    onChange={event => patch({ drpOther: event.target.value })}
                  />
                </div>
              </div>

              <div className="border-t border-line xl:col-span-3 xl:border-l xl:border-t-0">
                <Head>Intervention</Head>
                <div className="space-y-2 p-3">
                  <StackedCheckbox
                    value={form.interventions}
                    onChange={value => patch({ interventions: value })}
                    options={INTERVENTION_OPTIONS}
                  />
                  <Input
                    placeholder="อื่นๆ"
                    value={form.interventionOther}
                    onChange={event => patch({ interventionOther: event.target.value })}
                  />
                </div>
              </div>

              <div className="border-t border-line xl:col-span-2 xl:border-l xl:border-t-0">
                <Head>สถานะการประเมิน</Head>
                <div className="space-y-3 p-3">
                  <StackedRadio
                    value={form.evalStatus}
                    onChange={value => patch({ evalStatus: value })}
                    options={EVAL_STATUS_OPTIONS}
                  />
                  {/* ป้าย ADR ต่อชิดกับช่องเป็นชิ้นเดียวตามแบบฟอร์ม
                      ไม่ใช้ addonBefore ของ antd เพราะเลิกใช้แล้วใน v6
                      ทำเองแบบเดียวกับ LabField ในหน้า due/request */}
                  <div className="flex items-stretch">
                    <span className="flex shrink-0 items-center rounded-l-md border border-line bg-raised px-2.5 text-xs font-medium text-ink-2">
                      ADR
                    </span>
                    <Input
                      className="rounded-l-none!"
                      value={form.adr}
                      onChange={event => patch({ adr: event.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-line xl:col-span-4 xl:border-l xl:border-t-0">
                <Head>หมายเหตุ</Head>
                <div className="space-y-3 p-3">
                  <div>
                    <div className="mb-1.5 text-xs font-medium text-ink">เชื้อที่เป็นสาเหตุ :</div>
                    <div className="space-y-1.5">
                      {form.pathogens.map(row => (
                        <div key={row.source} className="grid grid-cols-12 items-center gap-2">
                          <Checkbox
                            className="col-span-4 text-xs!"
                            checked={row.checked}
                            onChange={event =>
                              patchPathogen(row.source, { checked: event.target.checked })
                            }
                          >
                            <span className="text-xs">{row.source}</span>
                          </Checkbox>
                          <DatePicker
                            className="col-span-3"
                            format="DD/MM/BBBB"
                            placeholder="วว/ดด/ปปปป"
                            // ยังไม่ติ๊กก็ยังไม่ต้องกรอกวันที่และรายละเอียด
                            disabled={!row.checked}
                            value={row.date ? dayjs(row.date) : null}
                            onChange={(value: Dayjs | null) =>
                              patchPathogen(row.source, {
                                date: value ? value.format('YYYY-MM-DD') : null,
                              })
                            }
                          />
                          <Input
                            className="col-span-5"
                            placeholder={row.source === 'อื่นๆ' ? 'โปรดระบุ' : 'ระบุรายละเอียด'}
                            disabled={!row.checked}
                            value={row.detail}
                            onChange={event =>
                              patchPathogen(row.source, { detail: event.target.value })
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <TextArea
                    value={form.note}
                    onChange={event => patch({ note: event.target.value })}
                    autoSize={{ minRows: 4, maxRows: 8 }}
                    placeholder="บันทึกเพิ่มเติม"
                  />

                  <div>
                    <div className="mb-1.5 text-xs font-medium text-ink">
                      เภสัชกรผู้ประเมินการใช้ยา :
                    </div>
                    <Select
                      showSearch
                      allowClear
                      className="w-full"
                      placeholder="--- เลือกเภสัชกรผู้ประเมินการใช้ยา ---"
                      suffixIcon={<UserOutlined />}
                      value={form.evaluatorName}
                      onChange={value => patch({ evaluatorName: value ?? null })}
                      options={MOCK_PHARMACISTS.map(name => ({ value: name, label: name }))}
                    />
                    {form.evaluatorName == null && (
                      <Text type="secondary" className="mt-1 block text-[11px]">
                        ต้องเลือกผู้ประเมินก่อนจึงจะบันทึกได้
                      </Text>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
