import 'server-only'
import { chat, type ChatResult } from '@/lib/llm/client'

/**
 * วิเคราะห์ความสมเหตุผลของการใช้ยา (RDU) ประกอบแบบประเมินของเภสัชกร
 *
 * ต่างจาก due-assist ตรงเจตนา — ตัวนั้นสรุปข้อมูลให้อ่านง่ายก่อนพิจารณาคำขอ
 * ตัวนี้ตั้งคำถามตามหัวข้อที่แบบประเมินถามอยู่แล้ว (ข้อบ่งใช้ / ขนาดยา / ระยะเวลา /
 * ความสอดคล้องกับผลเพาะเชื้อ / DRP) เพื่อให้เภสัชกรมีจุดตั้งต้นในการตรวจสอบ
 * ไม่ใช่คำตอบสำเร็จรูปที่เอาไปกรอกตาม — คนกรอกยังต้องตัดสินเองทุกข้อ
 *
 * ข้อมูลมาจากหน้าจอที่เภสัชกรกำลังดูอยู่ ไม่ได้ดึงจากฐานใหม่ เพราะแบบประเมิน
 * ยังเป็นข้อมูลจำลองที่ยังไม่มีตารางจริงรองรับ ตอนต่อฐานจริงให้เปลี่ยนมาประกอบ
 * ข้อมูลฝั่งเซิร์ฟเวอร์เอง จะได้ไม่ต้องเชื่อสิ่งที่เบราว์เซอร์ส่งมา
 *
 * ไม่รับชื่อผู้ป่วยและ HN เข้ามาในโครงสร้างนี้เลย — การวิเคราะห์ทางคลินิก
 * ไม่ต้องใช้ตัวระบุตัวตน คนอ่านเห็นอยู่แล้วบนหน้าจอว่ากำลังดูของใคร
 */

const SYSTEM_PROMPT = `คุณเป็นเภสัชกรที่ทบทวนความสมเหตุผลของการใช้ยาต้านจุลชีพ (RDU) ในโรงพยาบาลไทย
ผู้อ่านคือเภสัชกรที่กำลังกรอกแบบประเมินการใช้ยา คุณช่วยตั้งประเด็นให้เขาตรวจสอบ ไม่ใช่ตัดสินแทน

กติกาที่ห้ามฝ่าฝืน:
1. ใช้เฉพาะข้อมูลที่ปรากฏในข้อความของผู้ใช้เท่านั้น ห้ามเติมค่าแล็บ วันที่ ขนาดยา หรือผลเพาะเชื้อที่ไม่ได้ให้มา
2. ถ้าข้อมูลไม่พอสำหรับหัวข้อใด ให้เขียนว่า "ข้อมูลไม่พอสรุป" พร้อมบอกว่าต้องใช้อะไรเพิ่ม ห้ามเดา
3. คัดลอกตัวเลขและหน่วยตามที่ให้มาเป๊ะ ๆ ห้ามเติมหน่วยเอง ห้ามแปลงหน่วย และห้ามคำนวณค่าใหม่
4. ห้ามสรุปว่าควรอนุมัติหรือไม่อนุมัติ และห้ามสั่งให้หยุดยา เปลี่ยนยา หรือปรับขนาดยา
   ให้เขียนเป็นประเด็นที่ควรตรวจสอบแทน เช่น "ควรทบทวนว่า..." "ควรตรวจสอบกับ..."
5. ในผลเพาะเชื้อ ให้อ้างชื่อเชื้อและผลความไวต่อยาตามที่รายงานไว้เท่านั้น (S = ไว, I = ก้ำกึ่ง, R = ดื้อ)
   ห้ามสรุปว่าเชื้อไวหรือดื้อต่อยาที่ไม่มีในผลที่ให้มา
6. ตอบเป็นภาษาไทย สั้น กระชับ หัวข้อละไม่เกิน 3 บรรทัด

ตอบตามหัวข้อนี้เท่านั้น:
- ข้อบ่งใช้: (สอดคล้องกับการวินิจฉัยและตำแหน่งติดเชื้อที่ให้มาหรือไม่ เป็น empiric หรือ specific)
- ขนาดยากับการทำงานของไต: (ขนาดที่สั่งเทียบกับค่าไตที่ให้มา ต้องทบทวนการปรับขนาดหรือไม่)
- ระยะเวลาการใช้: (เริ่มเมื่อไร ใช้มากี่วันแล้วตามข้อมูลที่ให้ มีประเด็นเรื่องระยะเวลาหรือไม่)
- ความสอดคล้องกับผลเพาะเชื้อ: (ผลที่มีสนับสนุนการใช้ยาตัวนี้หรือไม่ มีช่องให้ลดระดับยาหรือไม่)
- ประเด็นที่ควรตรวจสอบ: (ข้อควรระวัง การแพ้ยา ยาซ้ำซ้อน และข้อมูลที่ยังขาด)`

/** ข้อมูลเคสที่ใช้วิเคราะห์ — ไม่มีชื่อและ HN โดยตั้งใจ */
export type RduCase = {
  drug: { name: string; dose: string; startedAt: string; indication: string }
  age: number | null
  /** '1' = ชาย, '2' = หญิง ตามรหัสของ HIS */
  sex: string | null
  visitType: 'IPD' | 'OPD'
  wardName: string | null
  renal: {
    cr: string
    weight: string
    crcl: string
    egfr: string
    measuredAt: string | null
    awaiting: boolean
  }
  sepsis: boolean
  /** ติดเชื้อจากชุมชนหรือในโรงพยาบาล */
  infectionSource: string
  diagnosis: string
  infectionSite: string
  allergies: string[]
  conditions: string[]
  prior: { none: boolean; name: string; startedAt: string | null; days: number | null }
  specimens: { specimen: string; cs: string; gs: string; susceptibility: string }[]
  antibiotics: { rxAt: string; drugName: string; usage: string; qty: number }[]
}

/**
 * จำนวนแถวประวัติการสั่งยาที่ส่งเข้าโมเดล — เอาที่ใหม่ที่สุด
 *
 * ตารางจริงยาวได้เป็นสิบแถวและมีของเมื่อหลายปีก่อนปนอยู่ แต่คำถามของหัวข้อนี้คือ
 * "รอบนี้ได้อะไรมาก่อน" ของเก่ากว่านั้นทำให้โมเดลให้น้ำหนักผิดและทำให้คำถามยาว
 * จนตอบช้า (เคสทดสอบ: ตัดจาก 12 เหลือ 8 แถวแล้วเร็วขึ้นเห็นได้ชัด)
 */
const MAX_ANTIBIOTIC_ROWS = 8

const sexLabel = (sex: string | null) =>
  sex === '1' ? 'ชาย' : sex === '2' ? 'หญิง' : 'ไม่ระบุเพศ'

/** ประกอบข้อมูลเคสเป็นข้อความที่โมเดลอ่านได้ */
export function buildRduContext(input: RduCase): string {
  const lines: string[] = []

  lines.push(
    `ยาที่กำลังประเมิน: ${input.drug.name}` +
      (input.drug.dose ? ` ขนาด/วิธีใช้ ${input.drug.dose}` : '') +
      (input.drug.startedAt ? ` เริ่มใช้ ${input.drug.startedAt}` : ''),
  )
  if (input.drug.indication) lines.push(`ข้อบ่งใช้ที่แพทย์ระบุ: ${input.drug.indication}`)

  lines.push(
    `ผู้ป่วย: ${sexLabel(input.sex)} อายุ ${input.age ?? 'ไม่ทราบ'} ปี ` +
      `ประเภทการรักษา ${input.visitType}` +
      (input.wardName ? ` (หอผู้ป่วย ${input.wardName})` : ''),
  )

  lines.push(`การวินิจฉัย: ${input.diagnosis || 'ไม่มีข้อมูล'}`)
  lines.push(`ตำแหน่งที่ติดเชื้อ: ${input.infectionSite || 'ไม่มีข้อมูล'}`)
  lines.push(`แหล่งที่มาของการติดเชื้อ: ${input.infectionSource || 'ไม่มีข้อมูล'}`)
  lines.push(`ภาวะ severe sepsis / septic shock: ${input.sepsis ? 'มี' : 'ไม่มีระบุ'}`)

  lines.push(
    input.renal.awaiting
      ? 'ค่าไต: รอผล Creatinine'
      : `ค่าไต: Creatinine ${input.renal.cr || 'ไม่มีข้อมูล'} mg/dL, ` +
          `CrCl ${input.renal.crcl || 'ไม่มีข้อมูล'} mL/min, ` +
          `eGFR ${input.renal.egfr || 'ไม่มีข้อมูล'} mL/min/1.73m2, ` +
          `น้ำหนัก ${input.renal.weight || 'ไม่มีข้อมูล'} กก.` +
          (input.renal.measuredAt ? ` เจาะเมื่อ ${input.renal.measuredAt}` : ''),
  )

  lines.push(
    input.allergies.length > 0
      ? `ประวัติแพ้ยา: ${input.allergies.join('; ')}`
      : 'ประวัติแพ้ยา: ไม่มีบันทึก',
  )
  lines.push(
    input.conditions.length > 0
      ? `โรคประจำตัว: ${input.conditions.join(', ')}`
      : 'โรคประจำตัว: ไม่มีบันทึก',
  )

  lines.push(
    input.prior.none
      ? 'ยาต้านจุลชีพที่ได้รับมาก่อนใบคำขอนี้: ไม่มี'
      : `ยาต้านจุลชีพที่ได้รับมาก่อนใบคำขอนี้: ${input.prior.name || 'ไม่ระบุชื่อ'}` +
          (input.prior.startedAt ? ` เริ่ม ${input.prior.startedAt}` : '') +
          (input.prior.days != null ? ` รวม ${input.prior.days} วัน` : ''),
  )

  if (input.specimens.length > 0) {
    lines.push('ผลเพาะเชื้อที่บันทึกไว้ในใบคำขอ:')
    for (const row of input.specimens) {
      lines.push(
        `- สิ่งส่งตรวจ ${row.specimen || 'ไม่ระบุ'}: ` +
          `C/S ${row.cs || 'ไม่มีข้อมูล'} | Gram stain ${row.gs || 'ไม่มีข้อมูล'} | ` +
          `ความไวต่อยา ${row.susceptibility || 'ไม่มีข้อมูล'}`,
      )
    }
  } else {
    lines.push('ผลเพาะเชื้อที่บันทึกไว้ในใบคำขอ: ไม่มี')
  }

  if (input.antibiotics.length > 0) {
    lines.push(`ประวัติการสั่งยาต้านจุลชีพล่าสุด ${input.antibiotics.length} รายการ:`)
    for (const row of input.antibiotics) {
      lines.push(
        `- ${row.rxAt} ${row.drugName} ${row.usage}` +
          // 0 = สั่งแล้วไม่ได้จ่าย ต้องบอกไว้ ไม่งั้นจะถูกนับเป็นยาที่ผู้ป่วยได้รับจริง
          (row.qty === 0 ? ' (สั่งแล้วไม่ได้จ่าย)' : ` จำนวน ${row.qty}`),
      )
    }
  } else {
    lines.push('ประวัติการสั่งยาต้านจุลชีพ: ไม่มีบันทึก')
  }

  return lines.join('\n')
}

export async function reviewRationalDrugUse(
  input: RduCase,
  abort?: AbortSignal,
): Promise<ChatResult> {
  return chat(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildRduContext(input) },
    ],
    abort,
  )
}

/* ───────────── ตรวจข้อมูลที่รับมาจากเบราว์เซอร์ ─────────────
   รับเฉพาะฟิลด์ที่รู้จักและจำกัดความยาวทุกช่อง — สิ่งที่ส่งมาจะกลายเป็นคำถาม
   ที่ยิงเข้าโมเดล ถ้ารับตามใจผู้เรียกก็เท่ากับเปิดให้ใช้โมเดลทำอะไรก็ได้ */

const text = (value: unknown, max = 300): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

const optionalText = (value: unknown, max = 60): string | null => {
  const out = text(value, max)
  return out === '' ? null : out
}

const list = (value: unknown, max: number, maxLength = 120): string[] =>
  Array.isArray(value)
    ? value
        .slice(0, max)
        .map(item => text(item, maxLength))
        .filter(Boolean)
    : []

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/** อ่านเคสจาก body — คืน null เมื่อไม่มีแม้แต่ชื่อยาที่จะประเมิน */
export function parseRduCase(body: Record<string, unknown>): RduCase | null {
  const drug = record(body.drug)
  const name = text(drug.name, 200)
  if (name === '') return null

  const renal = record(body.renal)
  const prior = record(body.prior)

  return {
    drug: {
      name,
      dose: text(drug.dose, 200),
      startedAt: text(drug.startedAt, 30),
      indication: text(drug.indication, 300),
    },
    age: typeof body.age === 'number' && Number.isFinite(body.age) ? body.age : null,
    sex: optionalText(body.sex, 2),
    visitType: body.visitType === 'IPD' ? 'IPD' : 'OPD',
    wardName: optionalText(body.wardName, 120),
    renal: {
      cr: text(renal.cr, 20),
      weight: text(renal.weight, 20),
      crcl: text(renal.crcl, 20),
      egfr: text(renal.egfr, 20),
      measuredAt: optionalText(renal.measuredAt, 30),
      awaiting: renal.awaiting === true,
    },
    sepsis: body.sepsis === true,
    infectionSource: text(body.infectionSource, 60),
    diagnosis: text(body.diagnosis, 300),
    infectionSite: text(body.infectionSite, 200),
    allergies: list(body.allergies, 20),
    conditions: list(body.conditions, 20),
    prior: {
      none: prior.none === true,
      name: text(prior.name, 200),
      startedAt: optionalText(prior.startedAt, 30),
      days: typeof prior.days === 'number' && Number.isFinite(prior.days) ? prior.days : null,
    },
    specimens: (Array.isArray(body.specimens) ? body.specimens.slice(0, 10) : []).map(item => {
      const row = record(item)
      return {
        specimen: text(row.specimen, 120),
        cs: text(row.cs, 300),
        gs: text(row.gs, 300),
        susceptibility: text(row.susceptibility, 600),
      }
    }),
    // เรียงใหม่ก่อนตัด ไม่ใช่ตัดตามลำดับที่ส่งมา — ที่ส่งมาเรียงจากเก่าไปใหม่
    // ถ้าตัดตรง ๆ จะเหลือแต่ของเมื่อหลายปีก่อนและทิ้งของรอบนี้ซึ่งเป็นตัวที่ต้องดู
    // (รูปแบบวันที่เป็น 'YYYY-MM-DD HH:mm:ss' จึงเทียบเป็นข้อความได้ตรงตามเวลา)
    antibiotics: (Array.isArray(body.antibiotics) ? body.antibiotics.slice(0, 100) : [])
      .map(item => {
        const row = record(item)
        return {
          rxAt: text(row.rxAt, 30),
          drugName: text(row.drugName, 200),
          usage: text(row.usage, 200),
          qty: typeof row.qty === 'number' && Number.isFinite(row.qty) ? row.qty : 0,
        }
      })
      .sort((a, b) => b.rxAt.localeCompare(a.rxAt))
      .slice(0, MAX_ANTIBIOTIC_ROWS)
      .reverse(),
  }
}
