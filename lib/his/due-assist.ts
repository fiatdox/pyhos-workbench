import 'server-only'
import type { DuePatient } from '@/lib/his/due'
import {
  countRecentCultureReports,
  listRecentCultureReports,
  type LabCultureReport,
} from '@/lib/his/lab-culture'
import { chat, type ChatResult } from '@/lib/llm/client'

/**
 * สรุปข้อมูลช่วยตัดสินใจของใบคำขอ DUE ด้วยโมเดลภาษาในเครือข่าย
 *
 * กติกาสำคัญ: โมเดลได้เห็นเฉพาะข้อมูลที่ระบบดึงมาแล้วและส่งให้ในข้อความเดียวกัน
 * ห้ามให้เติมค่าแล็บ วันที่ หรือขนาดยาที่ไม่ได้อยู่ในนั้น — ตัวเลขที่ดูน่าเชื่อแต่ไม่มี
 * อยู่จริงอันตรายกว่าไม่มีระบบช่วยเลย ทั้งคำสั่งระบบและรูปแบบคำตอบจึงบังคับให้
 * อ้างอิงเฉพาะสิ่งที่เห็น และให้บอกตรง ๆ เมื่อข้อมูลไม่พอ
 *
 * ไม่ส่งชื่อผู้ป่วยและ HN เข้าโมเดล — การสรุปทางคลินิกไม่ต้องใช้ตัวระบุตัวตน
 * ผู้ใช้เห็นอยู่แล้วบนหน้าจอว่ากำลังดูของใคร
 */

const SYSTEM_PROMPT = `คุณเป็นผู้ช่วยเภสัชกรในโรงพยาบาลไทย ทำหน้าที่สรุปข้อมูลประกอบการพิจารณาใบขออนุมัติใช้ยา (DUE)

กติกาที่ห้ามฝ่าฝืน:
1. ใช้เฉพาะข้อมูลที่ปรากฏในข้อความของผู้ใช้เท่านั้น ห้ามเติมค่าแล็บ วันที่ ขนาดยา หรือผลเพาะเชื้อที่ไม่ได้ให้มา
2. ถ้าข้อมูลไม่พอสำหรับประเด็นใด ให้เขียนว่า "ไม่มีข้อมูล" สำหรับประเด็นนั้น ห้ามเดา
3. คัดลอกตัวเลขและหน่วยตามที่ให้มาเป๊ะ ๆ ห้ามเติมหน่วยเอง ห้ามแปลงหน่วย และห้ามคำนวณค่าใหม่
4. ห้ามสรุปว่าควรอนุมัติหรือไม่อนุมัติ หน้าที่ตัดสินเป็นของแพทย์และเภสัชกร
5. ตอบเป็นภาษาไทย สั้น กระชับ เป็นหัวข้อ ไม่เกิน 12 บรรทัด
6. ถ้ามีข้อควรระวังเรื่องการแพ้ยาหรือการปรับขนาดยาตามการทำงานของไต ให้ขึ้นเป็นข้อแรก

7. ในผลเพาะเชื้อ ให้คัดลอกชื่อเชื้อและผลความไวต่อยาตามที่รายงานไว้เท่านั้น
   (S = ไว, I = ก้ำกึ่ง, R = ดื้อ) ห้ามสรุปว่าเชื้อไวหรือดื้อต่อยาที่ไม่มีในตาราง

รูปแบบคำตอบ:
- ประเด็นที่ต้องดู: (สิ่งที่ต้องระวังจากข้อมูลที่ให้)
- ผลเพาะเชื้อ: (สิ่งส่งตรวจ วันที่ เชื้อที่ขึ้น และผลความไวต่อยาที่เกี่ยวกับยาที่กำลังขอ)
- การทำงานของไต: (สรุปค่าที่มี และบอกว่าต้องพิจารณาปรับขนาดยาหรือไม่)
- ประวัติยาต้านจุลชีพ: (เคยได้อะไร เมื่อไร นานเท่าไร)
- ข้อมูลที่ยังขาด: (สิ่งที่ควรมีเพิ่มก่อนพิจารณา)`

/**
 * ช่วงเวลาและจำนวนใบรายงานผลเพาะเชื้อที่ส่งเข้าโมเดล
 *
 * ผลเก่ากว่านี้บอกได้แค่ว่าผู้ป่วยเคยมีเชื้ออะไร ซึ่งเปลี่ยนไปแล้วเมื่อผ่านการรักษา
 * มาหลายรอบ การตัดสินใจเรื่องยาต้านจุลชีพรอบนี้ใช้ของใหม่เท่านั้น
 * ห้าใบล่าสุดครอบคลุมการนอนครั้งปัจจุบันของผู้ป่วยที่นอนนานได้พอสมควรแล้ว
 */
const CULTURE_DAYS = 180
const CULTURE_REPORTS = 5

/** ตัดใบเดียวที่ยาวเกินนี้ทิ้งส่วนท้าย — ใบยาวสุดที่เจอจริงคือ 2,731 ตัวอักษร */
const MAX_REPORT_CHARS = 2500

/**
 * โควตารวมของเนื้อผลเพาะเชื้อทั้งหมด
 *
 * ยาวขึ้นเท่าไรโมเดลก็ช้าลงเท่านั้น — เคสที่ทดสอบใช้บริบท 3,169 ตัวอักษร
 * ตอบใน 63 วินาที ถ้าปล่อยให้ห้าใบยาวเต็มโควตาใบละ 2,500 จะกลายเป็นสามเท่า
 * และไปชนเวลาที่รอไว้ ใบล่าสุดสำคัญที่สุดจึงได้ที่ก่อน ใบเก่าถูกตัดออกทั้งใบ
 */
const MAX_CULTURE_CHARS = 6000

/**
 * บรรทัดในใบรายงานที่ต้องตัดออกก่อนส่งเข้าโมเดล
 *
 * สองแบบแรกเป็นตัวระบุตัวตน — ตัวใบรายงานพิมพ์ HN และชื่อผู้ป่วยไว้ในเนื้อความ
 * ทั้งที่ส่วนอื่นของบริบทนี้ตั้งใจไม่ส่งไป จึงต้องตัดที่นี่ด้วย ไม่งั้นรั่วทางนี้แทน
 * ที่เหลือเป็นหัวกระดาษ ชื่อผู้รายงาน และเส้นคั่น ซึ่งไม่มีเนื้อหาทางคลินิก
 * แต่กินที่ในคำถามและดึงความสนใจของโมเดลไปจากผลจริง
 */
const DROP_LINE =
  /(\bHN\s*:|\bName\s*:|OrderID|Reported By|Approved By|Courier MonoThai|^[\s_]*$)/i

/** เอาเฉพาะเนื้อผลจริง ตัดตัวระบุตัวตนและหัวกระดาษออก */
function cleanReport(text: string): string {
  return text
    .split('\n')
    .filter(line => !DROP_LINE.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_REPORT_CHARS)
}

/** ประกอบข้อมูลผู้ป่วยเป็นข้อความที่โมเดลอ่านได้ โดยไม่มีตัวระบุตัวตน */
export function buildContext(
  patient: DuePatient,
  drugName: string | null,
  cultures: { reports: LabCultureReport[]; total: number },
): string {
  const lines: string[] = []

  lines.push(`ยาที่กำลังขออนุมัติ: ${drugName?.trim() || 'ยังไม่ได้เลือก'}`)
  lines.push(
    `ผู้ป่วย: ${patient.sex === '1' ? 'ชาย' : patient.sex === '2' ? 'หญิง' : 'ไม่ระบุเพศ'} ` +
      `อายุ ${patient.age ?? 'ไม่ทราบ'} ปี ประเภทการรักษา ${patient.visitType}` +
      (patient.visitType === 'IPD'
        ? ` (${patient.admitted ? 'ยังนอนอยู่' : 'จำหน่ายแล้ว'}${patient.wardName ? ` หอผู้ป่วย ${patient.wardName}` : ''})`
        : patient.departmentName
          ? ` (ห้องตรวจ ${patient.departmentName})`
          : ''),
  )

  lines.push(
    patient.weight
      ? `น้ำหนักล่าสุด: ${patient.weight.bw} กก. เมื่อ ${patient.weight.date ?? 'ไม่ทราบวันที่'}` +
          (patient.weight.height ? ` ส่วนสูง ${patient.weight.height} ซม.` : '')
      : 'น้ำหนักล่าสุด: ไม่มีข้อมูล',
  )

  lines.push(
    patient.creatinine
      ? `ผลค่าไตล่าสุด: Creatinine ${patient.creatinine.cr} mg/dL` +
          (patient.creatinine.egfr ? ` eGFR ${patient.creatinine.egfr}` : '') +
          ` รายงานผล ${patient.creatinine.reportDate ?? patient.creatinine.orderDate ?? 'ไม่ทราบวันที่'}`
      : 'ผลค่าไตล่าสุด: ไม่มีข้อมูล',
  )

  lines.push(
    patient.allergies.length > 0
      ? `ประวัติแพ้ยา: ${patient.allergies
          .map(item => `${item.agent}${item.symptom ? ` (${item.symptom})` : ''}`)
          .join('; ')}`
      : 'ประวัติแพ้ยา: ไม่มีบันทึก',
  )

  lines.push(
    patient.conditions.length > 0
      ? `โรคประจำตัวที่เคยได้รับการวินิจฉัย: ${patient.conditions.map(item => item.label).join(', ')}`
      : 'โรคประจำตัวที่เคยได้รับการวินิจฉัย: ไม่มีบันทึก',
  )

  if (patient.priorAntimicrobials.length > 0) {
    lines.push('ยาต้านจุลชีพที่เคยได้รับในรอบ 1 ปี:')
    // จำกัดจำนวนรายการ ไม่ใช่เพราะเรื่องความยาว แต่เพราะรายการยาวมากทำให้โมเดล
    // ให้น้ำหนักกับของเก่าเท่ากับของใหม่ ทั้งที่ของล่าสุดสำคัญกว่าในการตัดสินใจ
    for (const item of patient.priorAntimicrobials.slice(0, 15)) {
      lines.push(
        `- ${item.name}: ${item.firstDay ?? '?'} ถึง ${item.lastDay ?? '?'} รวม ${item.days} วัน` +
          (item.inpatient ? ' (ระหว่างนอนโรงพยาบาล)' : ''),
      )
    }
  } else {
    lines.push('ยาต้านจุลชีพที่เคยได้รับในรอบ 1 ปี: ไม่มีบันทึก')
  }

  const included: { orderDate: string | null; text: string }[] = []
  let budget = MAX_CULTURE_CHARS
  for (const report of cultures.reports) {
    const text = cleanReport(report.text)
    if (text === '' || text.length > budget) break
    budget -= text.length
    included.push({ orderDate: report.orderDate, text })
  }

  if (included.length > 0) {
    lines.push(
      `ผลเพาะเชื้อในรอบ ${CULTURE_DAYS} วัน: มี ${cultures.total} ใบ ` +
        `ส่งเนื้อผลมาให้ ${included.length} ใบล่าสุด` +
        (cultures.total > included.length ? ' (ใบที่เก่ากว่านี้ไม่ได้ส่งมา)' : '') +
        ' — เนื้อรายงานตามที่ห้องแล็บพิมพ์ไว้:',
    )
    for (const report of included) {
      lines.push(`--- ใบรายงานวันที่ ${report.orderDate ?? 'ไม่ทราบวันที่'} ---`)
      lines.push(report.text)
    }
    lines.push('--- จบผลเพาะเชื้อ ---')
  } else if (patient.labCultureCount > 0) {
    // มีใบรายงานอยู่ แต่ไม่ใช่ของงานจุลชีววิทยาหรือเก่ากว่าช่วงที่ดึงมา
    lines.push(
      `ผลเพาะเชื้อ: ไม่มีใบรายงานงานจุลชีววิทยาในรอบ ${CULTURE_DAYS} วัน ` +
        `(ผู้ป่วยมีใบรายงานแล็บแบบเอกสารทั้งหมด ${patient.labCultureCount} ใบ แต่อยู่นอกช่วงนี้)`,
    )
  } else {
    lines.push('ผลเพาะเชื้อ: ไม่มีใบรายงาน')
  }

  return lines.join('\n')
}

export async function summarizeDueCase(
  patient: DuePatient,
  drugName: string | null,
): Promise<ChatResult> {
  // ดึงเนื้อผลเพาะเชื้อตอนนี้ ไม่ได้ติดมากับ getDuePatient เพราะหน้าจอปกติไม่ต้องใช้
  // (ที่นั่นเปิดดูทีละใบเมื่อกด) มีแต่การสรุปที่ต้องอ่านทุกใบพร้อมกัน
  const [reports, total] = await Promise.all([
    listRecentCultureReports(patient.hn, { days: CULTURE_DAYS, max: CULTURE_REPORTS }),
    countRecentCultureReports(patient.hn, CULTURE_DAYS),
  ])

  return chat([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildContext(patient, drugName, { reports, total }) },
  ])
}
