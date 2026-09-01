'use client'
import { Alert, Button, Tag, Tooltip, Typography } from 'antd'
import { FileTextOutlined, FormOutlined } from '@ant-design/icons'
import { labelOf, sexLabel, toThaiDate } from './display'
import {
  APPROPRIATE_OPTIONS,
  DURATION_OPTIONS,
  INDICATION_TYPES,
  needsSupervisor,
  type DrugEvaluation,
  type MockDrug,
  type MockRequest,
} from './mock-data'

const { Text } = Typography

/**
 * รายละเอียดคำขอหนึ่งใบ — ใช้ร่วมกันทั้งลิ้นชักของเภสัชกรและของแพทย์ผู้กำกับ
 *
 * เรียงตามลำดับเดียวกับหน้ากรอกคำขอ จะได้เทียบกันง่าย และสองฝ่ายต้องเห็น
 * ข้อมูลชุดเดียวกันก่อนตัดสินใจ ถ้าแยกกันเขียนแล้วฝ่ายหนึ่งเห็นไม่ครบ
 * จะกลายเป็นตัดสินใจกันคนละฐานข้อมูล
 */

/** ป้ายกำกับค่าหนึ่งค่าในลิ้นชักรายละเอียด */
export function Cell({
  label,
  value,
  className,
}: {
  label: string
  value: React.ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <div className="text-[11px] font-medium text-ink-3">{label}</div>
      <div className="text-sm text-ink">{value || '—'}</div>
    </div>
  )
}

/**
 * สรุปผลประเมินของยาหนึ่งตัว — แสดงใต้การ์ดยาเมื่อประเมินแล้ว
 * ย่อเฉพาะข้อที่ตอบไว้ ข้อที่เว้นว่างไม่ต้องขึ้นให้รก
 */
function EvaluationSummary({ evaluation }: { evaluation: DrugEvaluation }) {
  return (
    <div className="mt-3 rounded-lg border border-line bg-accent-soft/40 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-ink">ผลประเมินการใช้ยา</span>
        <Text type="secondary" className="text-[11px]">
          {evaluation.evaluatorName} · {toThaiDate(evaluation.evaluatedAt)}
        </Text>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Cell label="ข้อบ่งใช้" value={labelOf(INDICATION_TYPES, evaluation.indicationType)} />
        <Cell
          label="ความเหมาะสมข้อบ่งใช้"
          value={labelOf(APPROPRIATE_OPTIONS, evaluation.indicationAppropriate)}
        />
        <Cell
          label="ความเหมาะสมขนาดยา"
          value={labelOf(APPROPRIATE_OPTIONS, evaluation.doseAppropriate)}
        />
        <Cell
          label="ระยะเวลาการใช้"
          value={evaluation.durationDays == null ? null : `${evaluation.durationDays} วัน`}
        />
        <Cell
          label="ความเหมาะสมของระยะเวลา"
          value={labelOf(DURATION_OPTIONS, evaluation.durationAppropriate)}
          className="sm:col-span-2"
        />
        {evaluation.adr && (
          <Cell
            label="ADR"
            value={<span className="font-semibold text-danger">{evaluation.adr}</span>}
            className="sm:col-span-2"
          />
        )}
      </div>

      {(evaluation.drps.length > 0 || evaluation.drpOther) && (
        <div className="mt-3">
          <div className="text-[11px] font-medium text-ink-3">DRPs</div>
          <ul className="mt-0.5 list-inside list-disc text-xs leading-relaxed text-ink">
            {evaluation.drps.map(item => (
              <li key={item}>{item}</li>
            ))}
            {evaluation.drpOther && <li>{evaluation.drpOther}</li>}
          </ul>
        </div>
      )}

      {(evaluation.interventions.length > 0 || evaluation.interventionOther) && (
        <div className="mt-3">
          <div className="text-[11px] font-medium text-ink-3">Intervention</div>
          <ul className="mt-0.5 list-inside list-disc text-xs leading-relaxed text-ink">
            {evaluation.interventions.map(item => (
              <li key={item}>{item}</li>
            ))}
            {evaluation.interventionOther && <li>{evaluation.interventionOther}</li>}
          </ul>
        </div>
      )}

      {evaluation.pathogens.some(row => row.checked) && (
        <div className="mt-3">
          <div className="text-[11px] font-medium text-ink-3">เชื้อที่เป็นสาเหตุ</div>
          <ul className="mt-0.5 text-xs leading-relaxed text-ink">
            {evaluation.pathogens
              .filter(row => row.checked)
              .map(row => (
                <li key={row.source}>
                  <b>{row.source}</b>
                  {row.date && <span className="opacity-70"> · {toThaiDate(row.date)}</span>}
                  {row.detail && ` — ${row.detail}`}
                </li>
              ))}
          </ul>
        </div>
      )}

      {evaluation.note && (
        <div className="mt-3">
          <div className="text-[11px] font-medium text-ink-3">หมายเหตุ</div>
          <div className="text-xs leading-relaxed text-ink">{evaluation.note}</div>
        </div>
      )}
    </div>
  )
}

export default function RequestDetail({
  request,
  onOpenLabCulture,
  onEvaluate,
}: {
  request: MockRequest
  onOpenLabCulture: (request: MockRequest) => void
  /** ไม่ส่งมา = หน้าจอนั้นไม่มีงานประเมิน (หน้าแพทย์ผู้กำกับมีแค่อนุมัติ/ไม่อนุมัติ) */
  onEvaluate?: (request: MockRequest, drug: MockDrug) => void
}) {
  return (
    // ค่าคอลัมน์ xl: มีไว้สำหรับ modal กว้าง ๆ ของแพทย์ผู้กำกับ (1400px)
    // ลิ้นชัก 720px ของเภสัชกรไม่ถึง breakpoint จึงคงหน้าตาเดิมไว้
    <div className="space-y-4">
      {request.allergies.length > 0 && (
        <Alert
          type="error"
          showIcon
          title={`ผู้ป่วยมีประวัติแพ้ยา ${request.allergies.length} รายการ`}
          description={<span className="text-xs">{request.allergies.join(', ')}</span>}
        />
      )}

      {request.supervisorNote && (
        <Alert
          type={request.status === 'denied' ? 'error' : 'success'}
          showIcon
          title={request.status === 'denied' ? 'แพทย์ผู้กำกับไม่อนุมัติ' : 'แพทย์ผู้กำกับอนุมัติแล้ว'}
          description={
            <div className="text-xs leading-relaxed">
              {request.supervisorNote}
              <div className="mt-1 opacity-75">
                {request.supervisorName}
                {request.supervisorDecidedAt && ` · ${toThaiDate(request.supervisorDecidedAt)}`}
              </div>
            </div>
          }
        />
      )}

      <div>
        <div className="mb-2 text-xs font-semibold text-ink">ผู้ป่วย</div>
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <Cell label="ชื่อ-สกุล" value={request.patientName} className="sm:col-span-2" />
          <Cell label="HN" value={<span className="font-mono">{request.hn}</span>} />
          <Cell label="อายุ" value={`${request.age} ปี ${sexLabel(request.sex)}`} />
          <Cell
            label="ประเภทผู้ป่วย"
            value={
              <>
                {request.visitType}
                {request.an && (
                  <span className="ml-1 font-mono text-xs opacity-70">AN {request.an}</span>
                )}
              </>
            }
          />
          <Cell label="หอผู้ป่วย" value={request.wardName} />
          {request.conditions.length > 0 && (
            <Cell
              label="เคยวินิจฉัย"
              value={
                <span className="flex flex-wrap gap-1">
                  {request.conditions.map(item => (
                    <Tag key={item} className="mr-0!">
                      {item}
                    </Tag>
                  ))}
                </span>
              }
              className="sm:col-span-3 xl:col-span-6"
            />
          )}
        </div>
      </div>

      <div>
        <div className="mb-2 text-xs font-semibold text-ink">ค่าไต</div>
        {request.awaitingCreatinine ? (
          <Text type="secondary" className="text-xs">
            รอผล — ยังไม่มีค่า Creatinine
          </Text>
        ) : (
          <div className="grid gap-3 sm:grid-cols-4 xl:grid-cols-5">
            <Cell label="เจาะเมื่อ" value={toThaiDate(request.creatinineAt)} />
            <Cell label="Cr" value={`${request.cr} mg/dL`} />
            <Cell label="น้ำหนัก" value={`${request.weight} กก.`} />
            <Cell label="CrCl" value={`${request.crcl} mL/min`} />
            <Cell
              label="eGFR"
              value={`${request.egfr} mL/min/1.73m²`}
              className="sm:col-span-2 xl:col-span-1"
            />
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 text-xs font-semibold text-ink">ข้อมูลประวัติ</div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Cell
            label="Severe sepsis / septic shock"
            value={
              request.sepsis === 'yes' ? (
                <Tag color="red" className="mr-0!">
                  มี
                </Tag>
              ) : (
                'ไม่มี'
              )
            }
          />
          <Cell
            label="แหล่งที่มาของเชื้อ"
            value={
              request.infectionSource === 'hospital'
                ? 'Hospital Acquired Infection'
                : 'Community Acquired Infection'
            }
          />
          <Cell label="ผลการวินิจฉัยโรค" value={request.diagnosis} />
          <Cell label="ตำแหน่งที่ติดเชื้อ" value={request.infectionSite} />
          {request.diagnosisOther && (
            <Cell
              label="อื่น ๆ"
              value={request.diagnosisOther}
              className="sm:col-span-2 xl:col-span-4"
            />
          )}
        </div>
      </div>

      {/* จอกว้างวางสองส่วนนี้เคียงกัน — ตารางสิ่งส่งตรวจกินสองส่วนสาม
          ที่เหลือพอให้ยาต้านที่ได้รับมาก่อน (3 ค่า) ไม่ต้องกินอีกหนึ่งแถวเต็ม */}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-ink">สิ่งส่งตรวจและผลเพาะเชื้อ</span>
            {/* ต้องอ่านใบรายงานเพาะเชื้อฉบับเต็มเพื่อตรวจว่าเชื้อและความไวต่อยา
                ที่แพทย์กรอกมาตรงกับผลจริงหรือไม่ ไม่ใช่เชื่อตามที่กรอกมาอย่างเดียว */}
            <Button
              size="small"
              icon={<FileTextOutlined />}
              onClick={() => onOpenLabCulture(request)}
            >
              Lab Culture
            </Button>
          </div>
          {request.specimens.length === 0 ? (
            <Text type="secondary" className="text-xs">
              แพทย์ไม่ได้กรอกสิ่งส่งตรวจมา
            </Text>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-150 table-fixed border-collapse">
                <thead>
                  <tr className="border-b border-line bg-accent-soft">
                    <th className="w-[25%] px-3 py-2 text-left text-[11px] font-semibold text-ink">
                      Specimen
                    </th>
                    <th className="w-[25%] px-3 py-2 text-left text-[11px] font-semibold text-ink">
                      C/S
                    </th>
                    <th className="w-[20%] px-3 py-2 text-left text-[11px] font-semibold text-ink">
                      G/S
                    </th>
                    <th className="w-[30%] px-3 py-2 text-left text-[11px] font-semibold text-ink">
                      Susceptibility
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {request.specimens.map(row => (
                    <tr key={row.specimen} className="border-b border-line last:border-b-0">
                      <td className="px-3 py-2 text-xs">{row.specimen}</td>
                      <td className="px-3 py-2 text-xs">{row.cs}</td>
                      <td className="px-3 py-2 text-xs">{row.gs}</td>
                      <td className="px-3 py-2 text-xs">{row.susceptibility}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold text-ink">ยาต้านจุลชีพที่ได้รับมาก่อน</div>
          {request.noPriorAntibiotic ? (
            <Text type="secondary" className="text-xs">
              ไม่มีประวัติรับยาต้านมาก่อน
            </Text>
          ) : (
            <div className="grid gap-3 sm:grid-cols-4 xl:grid-cols-2">
              <Cell label="ชื่อยา" value={request.priorAntibiotic} className="sm:col-span-2" />
              <Cell label="วันที่ได้รับ" value={toThaiDate(request.priorStartedAt)} />
              <Cell
                label="จำนวนวัน"
                value={request.priorDays == null ? null : `${request.priorDays} วัน`}
              />
            </div>
          )}
        </div>
      </div>

      <div>
        <div className="mb-2 text-xs font-semibold text-ink">ยาที่ขออนุมัติ</div>
        <div className="space-y-2">
          {request.drugs.map(drug => (
            <div key={drug.id} className="rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="text-xs text-ink-3">{drug.id}.</span>
                  <span className="text-xs font-semibold text-ink">{drug.name}</span>
                  {needsSupervisor(drug.name) && (
                    <Tooltip title="ยากลุ่มนี้ต้องผ่านการอนุมัติจากแพทย์ผู้กำกับการใช้ยาก่อน">
                      <Tag color="orange" className="mr-0! cursor-help">
                        ต้องอนุมัติ
                      </Tag>
                    </Tooltip>
                  )}
                </div>
                {/* ประเมินได้เฉพาะยาที่จ่ายไปแล้ว — ยาที่ยังไม่รับรายการไม่มีการใช้จริงให้ประเมิน */}
                {onEvaluate && request.status === 'accepted' && (
                  <Button
                    size="small"
                    type={drug.evaluation ? 'default' : 'primary'}
                    icon={<FormOutlined />}
                    onClick={() => onEvaluate(request, drug)}
                  >
                    {drug.evaluation ? 'แก้ไขผลประเมิน' : 'ประเมินการใช้ยา'}
                  </Button>
                )}
              </div>
              {/* ชื่อยายาวเกินกว่าจะอยู่บรรทัดเดียวกับค่าอื่นได้ แต่ค่าที่เหลือ
                  ต้องอยู่บรรทัดเดียวกันทั้งหมด ไม่ใช่ไล่ลงมาทีละค่า */}
              <div className="mt-2 grid gap-3 sm:grid-cols-3 xl:grid-cols-4">
                <Cell label="ขนาดการใช้ยา" value={drug.dose} />
                <Cell label="วันที่เริ่มยา" value={toThaiDate(drug.startedAt)} />
                <Cell label="ข้อบ่งใช้" value={drug.indication} />
                {drug.indicationOther && (
                  <Cell
                    label="ข้อบ่งใช้อื่นๆ"
                    value={drug.indicationOther}
                    className="sm:col-span-3 xl:col-span-1"
                  />
                )}
              </div>

              {drug.evaluation && <EvaluationSummary evaluation={drug.evaluation} />}
            </div>
          ))}
        </div>
      </div>

      <Text type="secondary" className="block text-[11px]">
        ผู้สั่ง {request.requesterName} · ส่งคำขอ {toThaiDate(request.requestedAt)}
      </Text>
    </div>
  )
}
