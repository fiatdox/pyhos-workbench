/**
 * ตัวเลขจำลองสำหรับออกแบบหน้าภาพรวม DUE
 *
 * ทั้งไฟล์นี้แต่งขึ้น ไม่ได้มาจากฐานข้อมูลโรงพยาบาล ห้ามเอาไปอ้างอิงหรือรายงาน
 * มีไว้ให้เห็นว่าหน้าจอต้องรองรับข้อมูลรูปร่างแบบไหน และตัวเลขระดับไหน
 * จะทำให้กราฟอ่านออก (เช่นถ้าคิวค้างมีแค่ 2 ใบ กราฟแท่งจะดูไม่ออกว่าออกแบบดีไหม)
 *
 * ตัวเลขทุกชุดตั้งให้สอดคล้องกันเอง — ผลรวมของ Sankey ตรงกับ KPI ด้านบน
 * และจำนวนที่ประเมินแล้วตรงกับฐานของ % ความเหมาะสม ไม่งั้นตอนรีวิวหน้าจอ
 * จะเถียงกันเรื่องตัวเลขแทนที่จะดูการจัดวาง
 */

/** ช่วงข้อมูลที่แสดง — ของจริงต้องมีตัวเลือกช่วงเวลา ตอนนี้ตรึงไว้ก่อน */
export const PERIOD_LABEL = '1 มี.ค. – 31 ส.ค. 2569'
export const PERIOD_PREV_LABEL = 'ก.ย. 2568 – ก.พ. 2569'

export const TOTAL_REQUESTS = 248
export const EVALUATED = 198

/** ตัวเลขหัวหน้าหน้าจอ — direction ใช้บอกว่าดีขึ้นหรือแย่ลงเทียบรอบก่อน */
export type Kpi = {
  label: string
  value: string
  unit?: string
  /** เทียบกับรอบก่อน — 'up' = ตัวเลขเพิ่ม ไม่ได้แปลว่าดีเสมอไป */
  delta?: string
  direction?: 'up' | 'down'
  /** เพิ่มขึ้นแล้วดีหรือไม่ ใช้ตัดสินสีของลูกศร */
  upIsGood?: boolean
  hint?: string
}

export const KPIS: Kpi[] = [
  {
    label: 'คำขอทั้งหมด',
    value: '248',
    unit: 'ใบ',
    delta: '+12%',
    direction: 'up',
    upIsGood: true,
    hint: 'เทียบรอบก่อน 221 ใบ',
  },
  {
    label: 'งานค้างขณะนี้',
    value: '35',
    unit: 'ใบ',
    hint: 'รอรับ 6 · รออนุมัติ 3 · รอประเมิน 26',
  },
  {
    label: 'เวลารออนุมัติ (มัธยฐาน)',
    value: '4.6',
    unit: 'ชม.',
    delta: '+0.8 ชม.',
    direction: 'up',
    upIsGood: false,
    hint: 'นับจากส่งคำขอถึงแพทย์ผู้กำกับตัดสิน',
  },
  {
    label: 'ใช้ยาเหมาะสม',
    value: '78',
    unit: '%',
    delta: '+3%',
    direction: 'up',
    upIsGood: true,
    hint: 'เฉลี่ยจากข้อบ่งใช้ ขนาดยา และระยะเวลา',
  },
  {
    label: 'DDD / 1000 วันนอน',
    value: '92.4',
    delta: '+6%',
    direction: 'up',
    upIsGood: false,
    hint: 'ยาต้านจุลชีพกลุ่ม DUE ทั้งหมด',
  },
]

/**
 * คิวค้างแยกตามขั้น
 *
 * ต้องมีอายุของใบที่ค้างนานสุดคู่กับจำนวนเสมอ — ค้าง 26 ใบที่เพิ่งรับมาวันนี้
 * ต่างจากค้าง 3 ใบที่ค้างมา 19 ชั่วโมงโดยสิ้นเชิง จำนวนอย่างเดียวชี้เป้าไม่ได้
 */
export type QueueStage = {
  stage: string
  count: number
  oldest: string
  /** เกินเกณฑ์ที่ตกลงกันไว้ — ของจริงต้องมาจากข้อตกลงระดับหน่วยงาน */
  overdue: boolean
}

export const QUEUE: QueueStage[] = [
  { stage: 'รอเภสัชกรรับรายการ', count: 6, oldest: '5 ชม.', overdue: false },
  { stage: 'รอแพทย์ผู้กำกับอนุมัติ', count: 3, oldest: '19 ชม.', overdue: true },
  { stage: 'รับรายการแล้ว รอประเมิน', count: 26, oldest: '9 วัน', overdue: true },
]

/**
 * เส้นทางของคำขอทั้งรอบ — ใช้กับ Sankey
 *
 * weight คือจำนวนใบ ผลรวมขาเข้าของทุกจุดต้องเท่ากับขาออก ไม่งั้นกราฟจะเพี้ยน
 * โดยไม่ฟ้อง error (Sankey ยอมให้ไม่สมดุลแล้ววาดออกมาเฉย ๆ)
 */
export type FlowLink = { from: string; to: string; weight: number }

export const FLOW: FlowLink[] = [
  { from: 'คำขอทั้งหมด', to: 'ยาทั่วไป', weight: 176 },
  { from: 'คำขอทั้งหมด', to: 'ยาที่ต้องอนุมัติ', weight: 72 },
  { from: 'ยาทั่วไป', to: 'รับรายการ', weight: 168 },
  { from: 'ยาทั่วไป', to: 'ไม่รับรายการ', weight: 8 },
  { from: 'ยาที่ต้องอนุมัติ', to: 'อนุมัติ', weight: 58 },
  { from: 'ยาที่ต้องอนุมัติ', to: 'ไม่อนุมัติ', weight: 11 },
  { from: 'ยาที่ต้องอนุมัติ', to: 'ยังรออนุมัติ', weight: 3 },
  { from: 'อนุมัติ', to: 'รับรายการ', weight: 56 },
  { from: 'อนุมัติ', to: 'ไม่รับรายการ', weight: 2 },
  { from: 'รับรายการ', to: 'ประเมินแล้ว', weight: 198 },
  { from: 'รับรายการ', to: 'รอประเมิน', weight: 26 },
]

/** จุดในเส้นทาง — จัดกลุ่มเพื่อให้ลงสีตามความหมาย ไม่ใช่สีสุ่มของไลบรารี */
export type FlowNodeTone = 'start' | 'good' | 'warn' | 'bad' | 'neutral'

export const FLOW_NODES: { id: string; tone: FlowNodeTone }[] = [
  { id: 'คำขอทั้งหมด', tone: 'start' },
  { id: 'ยาทั่วไป', tone: 'neutral' },
  { id: 'ยาที่ต้องอนุมัติ', tone: 'warn' },
  { id: 'อนุมัติ', tone: 'good' },
  { id: 'ไม่อนุมัติ', tone: 'bad' },
  { id: 'ยังรออนุมัติ', tone: 'warn' },
  { id: 'รับรายการ', tone: 'good' },
  { id: 'ไม่รับรายการ', tone: 'bad' },
  { id: 'ประเมินแล้ว', tone: 'good' },
  { id: 'รอประเมิน', tone: 'warn' },
]

/**
 * เวลารอคอย (มัธยฐาน ชั่วโมง) แยกตามเวร
 *
 * ใช้มัธยฐานไม่ใช่ค่าเฉลี่ย เพราะใบที่ค้างข้ามวันหยุดยาวไม่กี่ใบ
 * ดึงค่าเฉลี่ยขึ้นจนอ่านผิดว่าทั้งระบบช้า
 */
export const TURNAROUND: { step: string; inHours: number; offHours: number; holiday: number }[] = [
  { step: 'ส่งคำขอ → เภสัชกรรับรายการ', inHours: 1.2, offHours: 3.9, holiday: 5.1 },
  { step: 'ส่งคำขอ → แพทย์ผู้กำกับอนุมัติ', inHours: 2.4, offHours: 8.7, holiday: 12.3 },
]

/** ความเหมาะสมสามด้านตามที่แบบประเมินถาม — ฐาน 198 ใบที่ประเมินแล้ว */
export const APPROPRIATENESS: {
  dimension: string
  appropriate: number
  consulted: number
  cannot: number
}[] = [
  { dimension: 'ข้อบ่งใช้', appropriate: 168, consulted: 21, cannot: 9 },
  { dimension: 'ขนาดยา', appropriate: 152, consulted: 38, cannot: 8 },
  { dimension: 'ระยะเวลาการใช้', appropriate: 139, consulted: 47, cannot: 12 },
]

/** ปัญหาจากการใช้ยาที่พบบ่อย — เรียงมากไปน้อย */
export const DRPS: { label: string; count: number }[] = [
  { label: 'ขนาดยาสูงเกินไป (ไม่ปรับตาม CrCl)', count: 34 },
  { label: 'ไม่เปลี่ยนยาตามผล Culture', count: 29 },
  { label: 'การเลือกใช้ยาที่ไม่เหมาะสม', count: 22 },
  { label: 'ขนาดยาน้อยเกินไป', count: 14 },
  { label: 'เกิดอาการไม่พึงประสงค์จากยา (ADR)', count: 9 },
  { label: 'ได้รับยาไม่ครบตามแนวทางการรักษา', count: 6 },
]

/** ปริมาณการใช้ยา DDD ต่อ 1000 วันนอน เทียบกับรอบก่อน */
export const DDD: { drug: string; current: number; previous: number }[] = [
  { drug: 'Meropenem', current: 31.2, previous: 27.8 },
  { drug: 'Piperacillin + Tazobactam', current: 24.1, previous: 22.6 },
  { drug: 'Vancomycin', current: 18.4, previous: 17.9 },
  { drug: 'Colistin', current: 8.6, previous: 11.4 },
  { drug: 'Ertapenem', current: 6.3, previous: 7.2 },
  { drug: 'Fosfomycin', current: 3.8, previous: 2.4 },
]

/** ความสอดคล้องกับผลเพาะเชื้อ */
export const CULTURE_ALIGNMENT = {
  empiric: 61,
  specific: 39,
  /** ส่งสิ่งส่งตรวจก่อนเริ่มยาตัวแรก */
  sentBeforeStart: 82,
  /** ปรับยาลงตามผลเพาะเชื้อ (de-escalation) */
  deEscalated: 34,
}
