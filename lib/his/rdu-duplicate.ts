import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'
import { DISPENSED_QTY, OPD_ONLY } from '@/lib/his/rdu-visit-report'

/**
 * เครื่องมือค้นหาการใช้ยาซ้ำซ้อน — เลือกยาเองได้ ไม่ผูกกับทะเบียนตัวชี้วัด
 *
 * ต่างจากรายงานอื่นในหมวด RDU ทั้งหมด: รายงานอื่นเป็น**ตัวชี้วัดตามเอกสาร** ผูกกับ
 * ทะเบียนยาที่คณะกรรมการตกลงไว้แล้ว ส่วนอันนี้เป็น**เครื่องมือค้น** ที่เภสัชกร
 * ประกอบชุดยาขึ้นมาเองตอนนั้น จึงไม่มีเกณฑ์ ไม่มีตัวชี้วัด และไม่มีทะเบียนให้ตั้งค่า
 *
 * ทำไมต้องให้คนเลือกยาเอง ไม่ใช่ให้ระบบจัดกลุ่มยาให้:
 * ตรวจฐานแล้ว **ไม่มีคอลัมน์กลุ่มยาที่ใช้ได้เลย** — drugcategory ว่าง 1,056 จาก
 * 1,092 รายการที่เปิดใช้งาน (ที่เหลือเป็นรหัสยุคโควิด) และ hintcode ที่เติมครบ
 * ทุกแถวเอา 592 รายการมารวมเป็นรหัสเดียว ('7004' มีตั้งแต่ ABACAVIR ถึงวัคซีน)
 * จึงไม่ใช่กลุ่มการรักษา การให้คนเลือกชุดยาเองเป็นทางเดียวที่ได้ชุดที่ถูกต้อง
 *
 * **ความถูกต้องของรายงานนี้ขึ้นกับชุดยาที่เลือกทั้งหมด** — ถ้าเลือกยาที่ออกฤทธิ์
 * ซ้ำทางกันจริง (เช่น PPI ทุกตัว) ผลที่ได้คือการใช้ยาซ้ำซ้อน แต่ถ้าเลือกยาที่ใช้
 * ร่วมกันได้ตามปกติปนมา (เช่น พาราเซตามอล + NSAID) ผลที่ได้คือการสั่งยาร่วมกัน
 * ตามปกติ ไม่ใช่ความผิดพลาด วัดแล้วชุด 37 รหัสแบบนั้นให้ "ซ้ำซ้อน" 37,731 ครั้ง
 * ต่อปีงบ ซึ่งไม่มีความหมายอะไร หน้าจอจึงเตือนเรื่องนี้ไว้ตรง ๆ
 */

/** ช่วงวันที่ยาวสุดต่อการค้นหนึ่งครั้ง — เท่ากับรายงานอื่นในหมวดนี้ */
export const DUPLICATE_MAX_RANGE_DAYS = 366

/**
 * ระยะเวลาที่ถือว่า "ช่วงเดียวกัน" ของโหมดข้าม visit — ผู้ใช้กำหนดเองได้
 *
 * นับเป็นหน้าต่างเลื่อน (sliding window) เทียบกันเป็นคู่ ไม่ได้ตัดตามช่วงวันที่
 * ที่ผู้ใช้เลือก — ถ้าตัดตามช่วง ผู้ป่วยที่ได้ยาวันที่ 30 มี.ค. กับ 2 เม.ย.
 * จะถูกจับหรือไม่ถูกจับขึ้นกับว่าผู้ใช้ลากช่วงวันที่ไว้ตรงไหน ซึ่งไม่ใช่คำตอบ
 * ของคำถามทางคลินิก
 *
 * ตั้งต้น 90 วัน (ราวสามเดือน ตามรอบนัดของคลินิกโรคเรื้อรังที่พบบ่อยที่สุด)
 * แต่ความกว้างที่เหมาะสมขึ้นกับยาที่ตรวจ ยาที่จ่ายครั้งละเดือนกับยาที่จ่ายครั้งละ
 * สามเดือนไม่ควรใช้หน้าต่างเดียวกัน จึงเปิดให้กำหนดเอง
 *
 * ยอมรับ 0 วันด้วย ซึ่งหมายถึง**คนละครั้งแต่วันเดียวกัน** — เป็นคำถามที่มีจริง
 * (ได้ยาซ้ำจากสองแผนกในวันเดียว) ไม่ใช่ค่าที่ไม่มีความหมาย
 */
export const DUPLICATE_DEFAULT_WINDOW_DAYS = 90
export const DUPLICATE_MIN_WINDOW_DAYS = 0

/**
 * หน้าต่างกว้างสุด — เท่ากับช่วงวันที่กว้างสุด
 *
 * กว้างกว่าช่วงวันที่ไม่มีความหมายเพิ่ม เพราะไม่มีคู่ไหนห่างกันเกินช่วงที่อ่านมา
 * ได้อยู่แล้ว การตั้งเพดานไว้เท่ากันจึงไม่ตัดอะไรที่ใช้ได้ทิ้ง
 */
export const DUPLICATE_MAX_WINDOW_DAYS = DUPLICATE_MAX_RANGE_DAYS

/** จำนวนชนิดที่ถือว่าซ้ำซ้อน — ตั้งแต่สองชนิดขึ้นไป เหมือนตัวชี้วัด RAS */
const DUPLICATE_FROM = 2

/**
 * จำนวนรหัสยาสูงสุดต่อการค้นหนึ่งครั้ง
 *
 * ไม่ใช่เพดานทางเทคนิคล้วน ๆ — ชุดที่ใหญ่กว่านี้มักหมายความว่าเลือกยาที่ไม่ได้
 * ออกฤทธิ์ซ้ำทางกันปนเข้ามา ซึ่งทำให้ผลลัพธ์ไม่มีความหมาย (ดูคำอธิบายหัวไฟล์)
 * และเป็นตัวคุมเวลาด้วย เพราะเวลาที่ใช้โตตามจำนวนบรรทัดยาที่ต้องอ่าน
 */
export const DUPLICATE_MAX_ICODES = 60

/** จำนวนบรรทัดยาสูงสุดที่ยอมอ่านต่อครั้ง — เกินนี้ให้ผู้ใช้แคบช่วงหรือแคบชุดยา */
const MAX_EVENT_ROWS = 400_000

/** จำนวนเคสสูงสุดที่ส่งกลับ — เท่ากับรายงาน RAS */
const MAX_CASE_ROWS = 2000

/**
 * หน่วยที่ใช้นับว่าซ้ำ
 *
 *   generic  ชื่อสามัญต่างกันตั้งแต่สองชื่อ — ตอบ "ได้ยาที่ออกฤทธิ์ซ้ำทางกันไหม"
 *   item     รายการยาต่างกันตั้งแต่สองรายการ — ตอบ "ได้ยาซ้ำรายการไหม" รวมกรณี
 *            ชื่อสามัญเดียวกันแต่คนละรหัส
 *
 * ต้องเลือกได้ทั้งสองแบบเพราะตอบคำถามคนละข้อ และตัวเลขต่างกันมาก วัดจากฐานจริง
 * ช่วง 3 เดือน: กลุ่ม PPI (6 รหัส) ระดับชื่อสามัญพบ 3 ครั้ง แต่ระดับรายการยาพบ
 * 321 ครั้ง — ส่วนต่างคือผู้ป่วยที่ได้ OMEPRAZOLE คนละรหัสในครั้งเดียวกัน ซึ่ง
 * เป็นการปรับรูปแบบยา/ขนาดยาตัวเดียวกัน ไม่ใช่การใช้ยาซ้ำซ้อน
 *
 * กลับกัน PARACETAMOL (7 รหัส ชื่อสามัญเดียว) ระดับชื่อสามัญพบ 0 ตลอด เพราะ
 * ชื่อสามัญไม่เคยต่างกันได้ แต่ระดับรายการยาพบ 3 ครั้งใน visit เดียวกันและ
 * 38 คนข้าม visit — ซึ่งคือสิ่งที่ต้องการเห็นสำหรับชุดยาที่มีชื่อสามัญเดียว
 */
export const DUPLICATE_UNITS = ['generic', 'item'] as const
export type DuplicateUnit = (typeof DUPLICATE_UNITS)[number]

/**
 * ขอบเขตที่ถือว่าซ้ำ
 *
 *   visit   ภายในครั้งที่มารับบริการเดียวกัน — ความผิดพลาดของการสั่งยาครั้งนั้น
 *   across  ข้ามครั้ง ภายในหน้าต่างที่ผู้ใช้กำหนด — มักเป็นการสั่งจากคนละแผนก
 *           ที่ไม่เห็นกัน
 *
 * โหมด across บังคับว่าต้องมาจาก vn ต่างกัน ไม่ใช่แค่ต่างวัน — ถ้าไม่บังคับ
 * เคสของโหมด visit จะโผล่ซ้ำในโหมด across ทั้งหมด ทั้งที่เป็นคำถามคนละข้อ
 */
export const DUPLICATE_SCOPES = ['visit', 'across'] as const
export type DuplicateScope = (typeof DUPLICATE_SCOPES)[number]

/**
 * คู่แบบไหนที่นับว่าซ้ำ — ใช้กับโหมดข้าม visit เท่านั้น
 *
 *   different  คนละหน่วย — ยาต่างตัวที่ออกฤทธิ์ซ้ำทางกัน (เช่น omeprazole
 *              คู่กับ pantoprazole)
 *   same       หน่วยเดียวกัน — **ยาตัวเดิมได้ซ้ำ** เช่นเมื่อวานได้ gabapentin
 *              วันนี้มาอีกครั้งแล้วได้ gabapentin อีก ผู้ป่วยจึงมียาซ้อนกันสองชุด
 *   any        ทั้งสองแบบ
 *
 * **ยาตัวเดิมซ้ำเป็นการซ้ำซ้อนจริงเมื่อห่างกันสั้น และเป็นการรับยาตามนัดเมื่อ
 * ห่างกันนาน** ตัวแยกคือความกว้างของหน้าต่าง ไม่ใช่ตัวยา วัดจากฐานจริง
 * (GABAPENTIN + PREGABALIN หนึ่งปีงบ คู่ชื่อสามัญเดียวกันคนละ visit):
 *
 *   ห่างวันเดียวกัน 18 คู่ · 1-3 วัน 70 · 4-7 วัน 204 · 8-14 วัน 403
 *   15-30 วัน 1,646 · 31-60 วัน 2,476 · 61-90 วัน 4,049   รวม 8,866 คู่
 *
 * ยอดพุ่งขึ้นตามระยะห่างเพราะคลินิกโรคเรื้อรังนัดทุก 1-3 เดือน คู่ที่ห่าง 61-90
 * วันจึงเกือบทั้งหมดเป็นการรับยาต่อเนื่องตามนัด ไม่ใช่ความผิดพลาด ส่วนหางสั้น
 * (35 คนภายใน 1 วัน · 85 คนภายใน 3 วัน) คือเคสที่ต้องไปดูจริง
 *
 * ด้วยเหตุนี้กฎ same กับ any จึงควรใช้กับหน้าต่างแคบ หน้าจอเตือนเรื่องนี้ไว้
 * และค่าตั้งต้นยังเป็น different เพื่อไม่ให้ผลลัพธ์เดิมเปลี่ยนไปเงียบ ๆ
 *
 * ไม่มีผลกับโหมด visit — ภายในครั้งเดียวกัน หน่วยเดียวกันถูกยุบเป็นแถวเดียว
 * ตั้งแต่ตอนอ่านข้อมูลแล้ว การซ้ำของยาตัวเดิมในครั้งเดียวจึงตอบด้วยหน่วย
 * 'item' (คนละรหัสแต่ชื่อสามัญเดียวกัน) ไม่ใช่ด้วยกฎนี้
 */
export const DUPLICATE_PAIR_RULES = ['different', 'same', 'any'] as const
export type DuplicatePairRule = (typeof DUPLICATE_PAIR_RULES)[number]

export const DUPLICATE_DEFAULT_PAIR_RULE: DuplicatePairRule = 'different'

export const isDuplicateUnit = (value: string): value is DuplicateUnit =>
  (DUPLICATE_UNITS as readonly string[]).includes(value)

export const isDuplicateScope = (value: string): value is DuplicateScope =>
  (DUPLICATE_SCOPES as readonly string[]).includes(value)

export const isDuplicatePairRule = (value: string): value is DuplicatePairRule =>
  (DUPLICATE_PAIR_RULES as readonly string[]).includes(value)

const rows = (result: unknown) => result as unknown as Record<string, unknown>[]

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v).trim() || null)

const MS_PER_DAY = 86_400_000

/** ยาหนึ่งรายการที่ยกไปให้เลือกในหน้าจอ */
export type DuplicateDrugOption = {
  icode: string
  name: string
  strength: string | null
  generic: string | null
}

/**
 * รายการยาที่เปิดใช้งานทั้งหมด ยกไปให้หน้าจอประกอบชุดเอง
 *
 * ส่งแค่รายการที่เปิดใช้งาน ต่างจากหน้าตั้งค่าทะเบียนที่ต้องพารายการที่ปิดไปแล้ว
 * มาด้วย — ที่นั่นมีทะเบียนเดิมค้างอยู่ซึ่งต้องเห็นให้ครบ ที่นี่ผู้ใช้ประกอบชุด
 * ขึ้นใหม่ทุกครั้ง ยาที่เลิกใช้แล้วจึงไม่มีเหตุให้เลือก
 */
export async function listDuplicateDrugOptions(): Promise<DuplicateDrugOption[]> {
  const [result] = await hisDb.execute(sql`
    SELECT icode, name, strength, generic_name
    FROM drugitems
    WHERE istatus = 'Y'
    ORDER BY name`)

  return rows(result).map(row => ({
    icode: String(row.icode ?? '').trim(),
    name: String(row.name ?? '').trim(),
    strength: str(row.strength),
    generic: str(row.generic_name),
  }))
}

/**
 * ยาหนึ่งบรรทัดที่จ่ายจริงในครั้งนั้น พร้อมจำนวนและวิธีใช้
 *
 * จำนวนกับวิธีใช้เป็นสิ่งที่ทำให้เคสอ่านรู้เรื่อง — ผู้ป่วยที่ได้ gabapentin
 * 120 แค็บซูลจากห้องตรวจกระดูก แล้วอีก 120 แค็บซูลวิธีใช้เดียวกันจากห้องตรวจ
 * ทั่วไปในวันเดียวกัน คือได้ยาไป 240 วันในวันเดียว ถ้าแสดงแต่ชื่อยาจะเห็นว่า
 * "ได้ยาซ้ำ" แต่ไม่รู้ว่าซ้ำมากแค่ไหน และเทียบวิธีใช้กันไม่ได้ว่าเป็นการปรับ
 * ขนาดยาหรือการสั่งทับกันจริง
 */
export type DuplicateDrugLine = {
  icode: string
  /** ชื่อรายการยาตามบัญชีของโรงพยาบาล */
  name: string
  /** ชื่อสามัญ */
  generic: string
  /** จำนวนที่จ่ายรวมทั้งครั้งนั้น — รวมหลายบรรทัดของรหัสเดียวกันเข้าด้วยกันแล้ว */
  qty: number | null
  /**
   * หน่วยนับของยานั้น เช่น เม็ด แค็บซูล ขวด (60 ml.)
   *
   * ต้องแสดงคู่กับจำนวนเสมอ ไม่เขียนกำกับว่า "เม็ด" เอาเอง — ในบัญชียาที่เปิด
   * ใช้งาน เม็ดเป็นหน่วยที่พบมากที่สุด (362 รายการ) แต่ยังมีแค็บซูล ขวดตามปริมาตร
   * Vial และ Ampule อีกหลายสิบแบบ ตรวจแล้วคอลัมน์นี้เติมครบทุกแถว ไม่มีค่าว่าง
   */
  units: string | null
  /** วิธีใช้ยา — จาก drugusage.shortlist ถ้าไม่มีใช้ sp_use.sp_name ที่แพทย์พิมพ์เอง */
  usage: string | null
  /** รหัสวิธีใช้ที่คนอ่านได้ เช่น '11ht' — เภสัชกรอ่านรหัสนี้ได้เร็วกว่าข้อความเต็ม */
  usageCode: string | null
}

/** ครั้งที่ได้รับยาซ้ำซ้อนภายใน visit เดียวกัน */
export type DuplicateVisitCase = {
  vn: string
  hn: string
  /** 'YYYY-MM-DD' */
  date: string | null
  patientName: string
  ageYears: number | null
  /** '1' = ชาย, '2' = หญิง ตามรหัสของ HIS */
  sex: string | null
  department: string | null
  doctor: string | null
  /** ชื่อสามัญที่ได้รับในครั้งนั้น (เฉพาะที่อยู่ในชุดที่เลือก) */
  generics: string[]
  /** ยาที่ได้รับในครั้งนั้น พร้อมจำนวนและวิธีใช้ */
  lines: DuplicateDrugLine[]
  /** จำนวนหน่วยที่ซ้ำ — นับตามหน่วยที่ผู้ใช้เลือก */
  units: number
}

/** หนึ่งครั้งที่ได้รับยาในชุดที่เลือก ใช้แสดงรายละเอียดของเคสข้าม visit */
export type DuplicateEvent = {
  vn: string
  /** 'YYYY-MM-DD' */
  date: string | null
  department: string | null
  doctor: string | null
  /** ยาที่ได้รับในครั้งนั้น พร้อมจำนวนและวิธีใช้ */
  lines: DuplicateDrugLine[]
  generics: string[]
}

/** ผู้ป่วยหนึ่งคนที่ได้รับยาซ้ำซ้อนข้าม visit ภายในหน้าต่างที่กำหนด */
export type DuplicatePatientCase = {
  hn: string
  patientName: string
  ageYears: number | null
  sex: string | null
  /** จำนวนหน่วยที่ซ้ำกันในหน้าต่างที่พบ */
  units: number
  /**
   * ยาที่ได้รับ**ตัวเดิมซ้ำ**จากคนละครั้ง — ว่างเมื่อกฎเป็น different
   *
   * เป็นคอลัมน์หลักของกฎ same เพราะคำถามคือ "ยาตัวไหนที่ได้ซ้ำ" ไม่ใช่
   * "ซ้ำกี่ชนิด" ซึ่งเป็นคำตอบของกฎ different
   */
  repeatedUnits: string[]
  /** จำนวนวันระหว่างคู่ที่ห่างกันน้อยสุด — ยิ่งน้อยยิ่งน่าสนใจ */
  closestGapDays: number
  /** ครั้งที่เกี่ยวข้องกับการซ้ำซ้อน เรียงตามวันที่ */
  events: DuplicateEvent[]
}

export type DuplicateReport = {
  unit: DuplicateUnit
  scope: DuplicateScope
  /** กฎการจับคู่ที่ใช้ — สะท้อนกลับไปให้หน้าจอติดป้ายให้ตรงกัน */
  pairRule: DuplicatePairRule
  /** หน้าต่างที่ใช้คิดโหมดข้าม visit — สะท้อนกลับไปให้หน้าจอติดป้ายให้ตรงกัน */
  windowDays: number
  /** รหัสยาที่ค้นจริง หลังขยายชื่อสามัญเป็นรหัสแล้ว */
  icodes: string[]
  /** ชื่อสามัญที่อยู่ในชุด เรียงตามตัวอักษร */
  genericsInScope: string[]
  /** บรรทัดยาที่อ่านมา (หนึ่งแถวต่อ ครั้ง × รหัสยา) */
  eventRows: number
  /** ครั้งที่ได้รับยาในชุดนี้อย่างน้อยหนึ่งรายการ — ตัวหารของโหมด visit */
  totalVisits: number
  /** ผู้ป่วยที่ได้รับยาในชุดนี้อย่างน้อยหนึ่งรายการ — ตัวหารของโหมดข้าม visit */
  totalPatients: number
  /**
   * จำนวนเคสของทุกแบบ — หน่วย × (ใน visit, ข้าม visit แยกตามกฎการจับคู่สามแบบ)
   *
   * คิดมาให้ทุกแบบทุกครั้ง เพราะคิดจากข้อมูลชุดเดียวกันที่อ่านมาแล้ว ไม่ได้ยิง
   * ฐานเพิ่ม (การพับใช้เวลาหลักสิบมิลลิวินาที) — ผู้ใช้จึงเห็นทันทีว่าการสลับ
   * หน่วยหรือกฎเปลี่ยนผลแค่ไหนโดยไม่ต้องกดค้นใหม่
   *
   * สำคัญเป็นพิเศษสำหรับกฎการจับคู่ — ยอดของ different กับ same ต่างกันได้
   * หลายสิบเท่าในชุดยาเดียวกัน ถ้าเห็นแค่ยอดเดียวจะไม่รู้ว่ากำลังมองข้ามอะไร
   */
  counts: Record<
    DuplicateUnit,
    { visit: number; across: Record<DuplicatePairRule, number> }
  >
  /** เคสของโหมด visit — มีค่าเมื่อ scope เป็น 'visit' */
  visitCases: DuplicateVisitCase[]
  /** เคสของโหมดข้าม visit — มีค่าเมื่อ scope เป็น 'across' */
  patientCases: DuplicatePatientCase[]
  /** ถึงเพดานจำนวนเคสแล้วหรือยัง */
  truncated: boolean
}

/** บรรทัดยาหนึ่งแถวที่อ่านมาจากฐาน */
type Event = {
  hn: string
  vn: string
  date: string
  icode: string
  generic: string
}

/** ค่าของหน่วยที่ใช้นับ สำหรับแถวหนึ่ง */
const unitOf = (event: Event, unit: DuplicateUnit) =>
  unit === 'generic' ? event.generic : event.icode

/**
 * ครั้งที่ซ้ำซ้อนภายใน visit เดียวกัน — คืนเป็นชุดของ vn
 *
 * นับจำนวนหน่วยที่ต่างกันในแต่ละ vn แล้วเอาเฉพาะที่ตั้งแต่สองหน่วยขึ้นไป
 */
function visitHits(events: Event[], unit: DuplicateUnit): Map<string, number> {
  const unitsOf = new Map<string, Set<string>>()
  for (const event of events) {
    let set = unitsOf.get(event.vn)
    if (set == null) {
      set = new Set()
      unitsOf.set(event.vn, set)
    }
    set.add(unitOf(event, unit))
  }

  const hits = new Map<string, number>()
  for (const [vn, set] of unitsOf) {
    if (set.size >= DUPLICATE_FROM) hits.set(vn, set.size)
  }
  return hits
}

/** ผลการตรวจผู้ป่วยหนึ่งคนในโหมดข้าม visit */
type AcrossHit = {
  /** vn ที่เกี่ยวข้องกับคู่ที่ซ้ำกัน */
  visits: Set<string>
  /** หน่วยที่ซ้ำกัน */
  units: Set<string>
  /**
   * หน่วยที่ได้รับ**ตัวเดิมซ้ำ**จากคนละครั้ง — ว่างเมื่อกฎเป็น different
   *
   * แยกเก็บจาก units เพราะคู่แบบ same ทำให้ units มีสมาชิกเดียว ถ้าดูแต่
   * units.size คนอ่านจะเห็นเลข 1 แล้วเข้าใจว่า "ซ้ำ 1 ชนิด" ซึ่งไม่ได้บอก
   * ว่าเกิดอะไรขึ้น — สิ่งที่ต้องรู้คือยาตัวไหนที่ได้ซ้ำ
   */
  repeated: Set<string>
  /** จำนวนวันของคู่ที่ห่างกันน้อยสุด */
  closestGapDays: number
}

/**
 * ผู้ป่วยที่ซ้ำซ้อนข้าม visit ภายในหน้าต่างที่กำหนด
 *
 * เทียบเป็นคู่หลังเรียงตามวันที่ — คู่ที่นับต้องมาจากคนละ vn เสมอ (ถ้าเป็น vn
 * เดียวกันนั่นคือคำถามของโหมด visit) ส่วนจะนับคู่ที่หน่วยต่างกัน หน่วยเดียวกัน
 * หรือทั้งสองแบบ ขึ้นกับ pairRule ที่ส่งมา
 *
 * วนออกจาก j ทันทีที่ห่างเกินหน้าต่างได้ เพราะเรียงวันที่แล้ว คู่ถัดไปห่างกว่าเดิม
 * เสมอ — ทำให้ต้นทุนเป็นเชิงเส้นตามจำนวนครั้งในหน้าต่าง ไม่ใช่กำลังสองของทั้งช่วง
 * หน้าต่างที่กว้างขึ้นจึงแพงขึ้นตามจำนวนคู่ที่ต้องเทียบจริง ไม่ได้แพงคงที่
 */
function acrossHits(
  events: Event[],
  unit: DuplicateUnit,
  windowDays: number,
  pairRule: DuplicatePairRule,
): Map<string, AcrossHit> {
  const byPatient = new Map<string, Event[]>()
  for (const event of events) {
    const list = byPatient.get(event.hn)
    if (list == null) byPatient.set(event.hn, [event])
    else list.push(event)
  }

  const hits = new Map<string, AcrossHit>()
  for (const [hn, list] of byPatient) {
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

    let hit: AcrossHit | null = null
    for (let i = 0; i < list.length; i++) {
      const startedAt = Date.parse(`${list[i].date}T00:00:00Z`)
      for (let j = i + 1; j < list.length; j++) {
        const gap = (Date.parse(`${list[j].date}T00:00:00Z`) - startedAt) / MS_PER_DAY
        if (gap > windowDays) break
        if (list[j].vn === list[i].vn) continue

        const earlier = unitOf(list[i], unit)
        const later = unitOf(list[j], unit)
        const sameUnit = earlier === later
        // กฎการจับคู่ตัดสินที่นี่ที่เดียว — different = ยาต่างตัวที่ซ้ำทางกัน
        // same = ยาตัวเดิมได้ซ้ำ any = ทั้งสองแบบ
        if (pairRule === 'different' && sameUnit) continue
        if (pairRule === 'same' && !sameUnit) continue

        if (hit == null) {
          hit = {
            visits: new Set(),
            units: new Set(),
            repeated: new Set(),
            closestGapDays: gap,
          }
        }
        hit.visits.add(list[i].vn)
        hit.visits.add(list[j].vn)
        hit.units.add(earlier)
        hit.units.add(later)
        if (sameUnit) hit.repeated.add(earlier)
        if (gap < hit.closestGapDays) hit.closestGapDays = gap
      }
    }
    if (hit != null) hits.set(hn, hit)
  }
  return hits
}

/**
 * ค้นการใช้ยาซ้ำซ้อนในชุดยาที่เลือก — ไม่มีข้อมูลระบุตัวตนนอกจาก HN และชื่อ
 *
 * อ่านบรรทัดยามารอบเดียวแล้วพับใน TypeScript ไม่ได้ให้ฐานทำทั้งหมด:
 * โหมดข้าม visit ถ้าเขียนเป็น self-join ในฐาน ต้องสร้างตารางกลางสองรอบ วัดแล้ว
 * ช้ากว่าเท่าตัว (กลุ่ม PPI ช่วง 3 เดือน: อ่านมาพับเอง 3.4 วินาที เทียบ self-join
 * 7.0 วินาที) และยังได้ผลเท่ากันทุกตัวเลข — ตรวจแล้วทั้งสองทางให้ชุดเดียวกัน
 * การพับเองยังคิดได้ทุกแบบในคราวเดียว (สองหน่วย × สามกฎการจับคู่ สำหรับโหมด
 * ข้าม visit บวกสองหน่วยของโหมด visit) ซึ่งฐานทำให้ไม่ได้ถ้าไม่ยิงแปดรอบ
 *
 * เวลาที่ใช้จริง: กลุ่ม PPI (6 รหัส) 3 เดือน 3.4 วินาที · หนึ่งปีงบ 3.9 วินาที ·
 * ชุด 37 รหัสหนึ่งปีงบ 14.6 วินาที (ส่วนการพับใช้ 15-220 มิลลิวินาที ไม่มีผล)
 */
export async function loadDuplicateReport(input: {
  from: string
  to: string
  /** ชื่อสามัญที่เลือก — ขยายเป็นรหัสยาทุกรหัสของชื่อนั้น */
  generics: string[]
  /** รหัสยาที่เลือกทีละรายการ */
  icodes: string[]
  unit: DuplicateUnit
  scope: DuplicateScope
  /** คู่แบบไหนที่นับว่าซ้ำ — ใช้กับโหมดข้าม visit เท่านั้น */
  pairRule: DuplicatePairRule
  /**
   * ความกว้างของหน้าต่างโหมดข้าม visit เป็นวัน
   *
   * มีผลกับตัวเลขของโหมดข้าม visit ทั้งสองหน่วย รวมถึงช่องเทียบสี่แบบด้วย —
   * โหมด visit ไม่ใช้ค่านี้เลย แต่ยังต้องส่งมาเพราะคิดทั้งสี่แบบทุกครั้ง
   */
  windowDays: number
}): Promise<DuplicateReport> {
  const empty = (icodes: string[], genericsInScope: string[]): DuplicateReport => ({
    unit: input.unit,
    scope: input.scope,
    pairRule: input.pairRule,
    windowDays: input.windowDays,
    icodes,
    genericsInScope,
    eventRows: 0,
    totalVisits: 0,
    totalPatients: 0,
    counts: {
      generic: { visit: 0, across: { different: 0, same: 0, any: 0 } },
      item: { visit: 0, across: { different: 0, same: 0, any: 0 } },
    },
    visitCases: [],
    patientCases: [],
    truncated: false,
  })

  if (input.generics.length === 0 && input.icodes.length === 0) return empty([], [])

  /* ขยายชื่อสามัญเป็นรหัสยา และรวมกับรหัสที่เลือกมาทีละรายการ
     ทำในคิวรีเดียวด้วย OR ไม่ใช่สองรอบ — ผลที่ต้องการคือชุดรวม และ drugitems
     มีแค่พันกว่าแถว การอ่านทีเดียวจึงถูกกว่าการยิงสองครั้งแล้วมารวมใน TS */
  const conditions = [
    input.icodes.length > 0
      ? sql`d.icode IN (${sql.join(
          input.icodes.map(icode => sql`${icode}`),
          sql`, `,
        )})`
      : null,
    input.generics.length > 0
      ? sql`d.generic_name IN (${sql.join(
          input.generics.map(generic => sql`${generic}`),
          sql`, `,
        )})`
      : null,
  ].filter(part => part != null)

  const [targetRows] = await hisDb.execute(sql`
    SELECT d.icode, d.name, d.generic_name
    FROM drugitems d
    WHERE d.istatus = 'Y'
      AND (${sql.join(conditions, sql` OR `)})
    ORDER BY d.icode`)

  /** รหัสยา → ชื่อสามัญและชื่อรายการ — ใช้แทนการ join drugitems ตอนพับ */
  const nameOf = new Map<string, { generic: string; name: string }>()
  for (const row of rows(targetRows)) {
    const icode = String(row.icode ?? '').trim()
    if (icode === '') continue
    nameOf.set(icode, {
      // ชื่อสามัญว่างไม่มีในฐาน (ตรวจแล้วเติมครบ 1,092 รายการ) แต่ถ้าวันหนึ่งมี
      // ต้องไม่ยุบรวมเป็นหน่วยเดียวกันหมด จึงใช้รหัสแทนเพื่อให้ยังแยกกันได้
      generic: str(row.generic_name) ?? `(ไม่มีชื่อสามัญ) ${icode}`,
      name: str(row.name) ?? icode,
    })
  }

  const icodes = [...nameOf.keys()]
  const genericsInScope = [...new Set([...nameOf.values()].map(item => item.generic))].sort(
    (a, b) => a.localeCompare(b),
  )

  if (icodes.length === 0) return empty([], [])
  if (icodes.length > DUPLICATE_MAX_ICODES) {
    throw new Error(
      `ชุดยาที่เลือกขยายเป็น ${icodes.length} รหัส เกินเพดาน ${DUPLICATE_MAX_ICODES} รหัสต่อการค้นหนึ่งครั้ง`,
    )
  }

  const codeList = sql.join(
    icodes.map(icode => sql`${icode}`),
    sql`, `,
  )

  /**
   * บรรทัดยาที่ได้รับจริงในช่วงที่เลือก หนึ่งแถวต่อ (ครั้ง × รหัสยา)
   *
   * ส่งรายการรหัสเป็นค่าคงที่ ไม่ได้ฝังคิวรีย่อยไว้ใน IN — ฝังแล้วฐานไม่ใช้ดัชนี
   * opitemrece.icode แล้วกวาดทั้งตาราง (บทเรียนจากรายงาน RAS: 104 วินาที เทียบ
   * 1.8 วินาที) ปลอดภัยเพราะค่ามาจาก drugitems และส่งเป็นพารามิเตอร์
   *
   * JOIN vn_stat ไว้ทั้งที่ไม่ได้ใช้คอลัมน์ของมันเลยในขั้นนี้ — มันทำหน้าที่
   * **กรองแถว** ด้วย ไม่ใช่แค่พาคอลัมน์มา วัดแล้วถ้าตัดออก กลุ่ม PPI ช่วง 3 เดือน
   * ได้ 25,791 แถวแทน 9,175 แถว (ต่างกัน 2.8 เท่า) เพราะ opitemrece มีบรรทัดยา
   * ที่ไม่ได้ผูกกับครั้งที่มารับบริการซึ่งนับในสถิติ และรายงานอื่นทุกข้อก็ต่อ
   * vn_stat เหมือนกัน ถ้าตัดออกที่นี่ ตัวเลขของหน้านี้จะไม่ตรงกับหน้าอื่นทั้งหมด
   */
  const [eventRows] = await hisDb.execute(sql`
    SELECT v.hn, v.vn, DATE_FORMAT(v.vstdate, '%Y-%m-%d') AS d, o.icode
    FROM opitemrece o
    JOIN vn_stat v ON v.vn = o.vn
    LEFT OUTER JOIN ovst ov ON ov.vn = v.vn
    WHERE o.icode IN (${codeList})
      AND o.qty > ${DISPENSED_QTY}
      AND o.vstdate BETWEEN ${input.from} AND ${input.to}
      AND ${OPD_ONLY}
    GROUP BY v.hn, v.vn, v.vstdate, o.icode
    LIMIT ${MAX_EVENT_ROWS + 1}`)

  const raw = rows(eventRows)
  if (raw.length > MAX_EVENT_ROWS) {
    throw new Error(
      `ช่วงวันที่กับชุดยาที่เลือกมีบรรทัดยามากกว่า ${MAX_EVENT_ROWS.toLocaleString('th-TH')} บรรทัด กรุณาแคบช่วงวันที่หรือลดจำนวนยา`,
    )
  }

  const events: Event[] = []
  for (const row of raw) {
    const icode = String(row.icode ?? '').trim()
    const names = nameOf.get(icode)
    // รหัสที่ไม่อยู่ในชุดเป้าหมายไม่ควรหลุดมาถึงตรงนี้ แต่ถ้าหลุดมาต้องทิ้ง
    // ไม่ใช่ปล่อยให้กลายเป็นหน่วยลึกลับที่ทำให้ยอดซ้ำซ้อนบวมขึ้นเงียบ ๆ
    if (names == null) continue
    events.push({
      hn: String(row.hn ?? '').trim(),
      vn: String(row.vn ?? '').trim(),
      date: String(row.d ?? '').trim(),
      icode,
      generic: names.generic,
    })
  }

  const totalVisits = new Set(events.map(event => event.vn)).size
  const totalPatients = new Set(events.map(event => event.hn)).size

  /* คิดทั้งสี่แบบจากข้อมูลชุดเดียวกัน — การพับใช้เวลาหลักสิบมิลลิวินาที
     ถูกกว่าการให้ผู้ใช้กดค้นใหม่เพื่อดูว่าสลับหน่วยแล้วผลเปลี่ยนแค่ไหน */
  const visitByUnit = {
    generic: visitHits(events, 'generic'),
    item: visitHits(events, 'item'),
  }
  /* ไล่ทุกหน่วย × ทุกกฎการจับคู่ = หกชุด — การพับหนึ่งชุดใช้เวลาหลักสิบ
     มิลลิวินาที จึงถูกกว่าการให้ผู้ใช้กดค้นใหม่เพื่อดูว่าสลับกฎแล้วผลเปลี่ยนแค่ไหน
     ซึ่งเป็นข้อมูลที่ต้องเห็นเพื่อเลือกกฎให้ถูก (ยอด different กับ same ต่างกันได้
     หลายสิบเท่าในชุดยาเดียวกัน) */
  const acrossByUnit = {
    generic: Object.fromEntries(
      DUPLICATE_PAIR_RULES.map(rule => [
        rule,
        acrossHits(events, 'generic', input.windowDays, rule),
      ]),
    ) as Record<DuplicatePairRule, Map<string, AcrossHit>>,
    item: Object.fromEntries(
      DUPLICATE_PAIR_RULES.map(rule => [
        rule,
        acrossHits(events, 'item', input.windowDays, rule),
      ]),
    ) as Record<DuplicatePairRule, Map<string, AcrossHit>>,
  }

  const acrossCountsOf = (unit: DuplicateUnit) =>
    Object.fromEntries(
      DUPLICATE_PAIR_RULES.map(rule => [rule, acrossByUnit[unit][rule].size]),
    ) as Record<DuplicatePairRule, number>

  const counts: Record<
    DuplicateUnit,
    { visit: number; across: Record<DuplicatePairRule, number> }
  > = {
    generic: { visit: visitByUnit.generic.size, across: acrossCountsOf('generic') },
    item: { visit: visitByUnit.item.size, across: acrossCountsOf('item') },
  }

  const base = {
    unit: input.unit,
    scope: input.scope,
    pairRule: input.pairRule,
    windowDays: input.windowDays,
    icodes,
    genericsInScope,
    eventRows: events.length,
    totalVisits,
    totalPatients,
    counts,
  }

  if (input.scope === 'visit') {
    const hits = visitByUnit[input.unit]
    /* เรียงใหม่วันล่าสุดก่อน แล้วตัดที่เพดาน — ต้องเรียงก่อนตัด ไม่ใช่ตัดก่อนเรียง
       ไม่งั้นเคสที่เหลือจะเป็นชุดที่ขึ้นกับลำดับที่ฐานคืนมา ซึ่งไม่มีความหมาย */
    const picked = [...hits.keys()]
      .map(vn => ({ vn, date: events.find(event => event.vn === vn)?.date ?? '' }))
      .sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0))

    const kept = picked.slice(0, MAX_CASE_ROWS)
    /* ยิงพร้อมกัน — ทั้งสองคิวรีถามด้วยชุด vn เดียวกันและไม่ได้ใช้ผลของกัน */
    const [details, lines] = await Promise.all([
      visitDetails(kept.map(item => item.vn)),
      drugLinesOf(
        kept.map(item => item.vn),
        icodes,
        nameOf,
      ),
    ])

    const genericsOf = new Map<string, Set<string>>()
    for (const event of events) {
      if (!hits.has(event.vn)) continue
      const set = genericsOf.get(event.vn)
      if (set == null) genericsOf.set(event.vn, new Set([event.generic]))
      else set.add(event.generic)
    }

    return {
      ...base,
      visitCases: kept.map(({ vn }) => {
        const detail = details.get(vn)
        return {
          vn,
          hn: detail?.hn ?? '',
          date: detail?.date ?? null,
          patientName: detail?.patientName ?? '—',
          ageYears: detail?.ageYears ?? null,
          sex: detail?.sex ?? null,
          department: detail?.department ?? null,
          doctor: detail?.doctor ?? null,
          generics: [...(genericsOf.get(vn) ?? [])].sort((a, b) => a.localeCompare(b)),
          lines: lines.get(vn) ?? [],
          units: hits.get(vn) ?? 0,
        }
      }),
      patientCases: [],
      truncated: picked.length > MAX_CASE_ROWS,
    }
  }

  const hits = acrossByUnit[input.unit][input.pairRule]
  /* เรียงจากคู่ที่ห่างกันน้อยสุดก่อน — คู่ที่ได้ยาห่างกันไม่กี่วันคือเคสที่
     น่าจะเป็นการสั่งซ้ำจากคนละแผนกจริง ส่วนคู่ที่ห่างเกือบเต็มหน้าต่างมักเป็น
     การเปลี่ยนยา ต่างจากโหมด visit ที่เรียงตามวันเพราะทุกเคสหนักเท่ากัน */
  const ranked = [...hits.entries()].sort(
    ([, a], [, b]) => a.closestGapDays - b.closestGapDays || b.units.size - a.units.size,
  )
  const kept = ranked.slice(0, MAX_CASE_ROWS)

  const visitIds = kept.flatMap(([, hit]) => [...hit.visits])
  /* สามคิวรียิงพร้อมกัน — ไม่มีอันไหนใช้ผลของอีกอัน ทีละอันก็ได้แต่จ่ายเวลาฟรี */
  const [details, patients, lines] = await Promise.all([
    visitDetails(visitIds),
    patientDetails(kept.map(([hn]) => hn)),
    drugLinesOf(visitIds, icodes, nameOf),
  ])

  /** ชื่อสามัญของแต่ละ vn ที่เกี่ยวข้อง — ใช้เติมรายละเอียดใต้แถวผู้ป่วย */
  const genericsOfVisit = new Map<string, Set<string>>()
  const wanted = new Set(visitIds)
  for (const event of events) {
    if (!wanted.has(event.vn)) continue
    const set = genericsOfVisit.get(event.vn)
    if (set == null) genericsOfVisit.set(event.vn, new Set([event.generic]))
    else set.add(event.generic)
  }

  return {
    ...base,
    visitCases: [],
    patientCases: kept.map(([hn, hit]) => {
      const patient = patients.get(hn)
      return {
        hn,
        patientName: patient?.patientName ?? '—',
        ageYears: patient?.ageYears ?? null,
        sex: patient?.sex ?? null,
        units: hit.units.size,
        repeatedUnits: [...hit.repeated].sort((a, b) => a.localeCompare(b)),
        closestGapDays: hit.closestGapDays,
        events: [...hit.visits]
          .map(vn => {
            const detail = details.get(vn)
            return {
              vn,
              date: detail?.date ?? null,
              department: detail?.department ?? null,
              doctor: detail?.doctor ?? null,
              generics: [...(genericsOfVisit.get(vn) ?? [])].sort((a, b) => a.localeCompare(b)),
              lines: lines.get(vn) ?? [],
            }
          })
          .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')),
      }
    }),
    truncated: ranked.length > MAX_CASE_ROWS,
  }
}

/**
 * บรรทัดยาของครั้งที่เป็นเคส — จำนวนและวิธีใช้
 *
 * แยกเป็นคิวรีของตัวเอง ถามเฉพาะ vn ที่เป็นเคสจริง ด้วยเหตุผลเดียวกับ visitDetails:
 * คิวรีที่อ่านบรรทัดยาทั้งช่วงมีหลักหมื่นถึงแสนแถว ส่วนเคสมีหลักร้อยถึงสองพัน
 * การลาก drugusage กับ sp_use ไปด้วยตั้งแต่รอบแรกคือการต่อตารางเพิ่มให้แถวที่
 * เกือบทั้งหมดไม่ได้ใช้
 *
 * รูปแบบการอ่านวิธีใช้ลอกจาก lib/his/medication-history.ts ซึ่งเป็นฝั่งผู้ป่วยนอก
 * เหมือนกัน — ใช้ drugusage.shortlist ก่อน ถ้าบรรทัดนั้นไม่มีรหัสวิธีใช้จึงใช้
 * sp_use.sp_name ที่แพทย์พิมพ์เอง (ตรวจเดือน ส.ค. 2569: บรรทัดยาผู้ป่วยนอก
 * 187,529 บรรทัด ไม่มีรหัสวิธีใช้ 15,842 บรรทัด = 8.4% และในนั้นมี sp_use
 * ให้ใช้แทนอยู่ 13,541 บรรทัด)
 *
 * ต่อ MAX(CONCAT(รหัส, tab, ข้อความ)) เป็นสายเดียวแล้วค่อยแยกใน TypeScript
 * ไม่ได้ใช้ MAX() แยกสองคอลัมน์ — ยาตัวเดียวกันในครั้งเดียวมีได้หลายบรรทัด
 * ถ้า MAX() แยกกัน รหัสกับข้อความจะมาจากคนละบรรทัดแล้วไม่ตรงกัน
 */
async function drugLinesOf(
  vns: string[],
  icodes: string[],
  nameOf: Map<string, { generic: string; name: string }>,
): Promise<Map<string, DuplicateDrugLine[]>> {
  const uniqueVns = [...new Set(vns.filter(vn => vn !== ''))]
  if (uniqueVns.length === 0 || icodes.length === 0) return new Map()

  const [result] = await hisDb.execute(sql`
    SELECT o.vn, o.icode, SUM(o.qty) AS qty, di.units,
           MAX(IF(o.drugusage <> '',
                  CONCAT(o.drugusage, '\t', COALESCE(du.shortlist, '')),
                  CONCAT('\t', COALESCE(sp.sp_name, '')))) AS usage_text
    FROM opitemrece o
    JOIN drugitems di ON di.icode = o.icode
    LEFT OUTER JOIN drugusage du ON du.drugusage = o.drugusage
    LEFT OUTER JOIN sp_use sp ON sp.sp_use = o.sp_use
    WHERE o.vn IN (${sql.join(
      uniqueVns.map(vn => sql`${vn}`),
      sql`, `,
    )})
      AND o.icode IN (${sql.join(
        icodes.map(icode => sql`${icode}`),
        sql`, `,
      )})
      AND o.qty > ${DISPENSED_QTY}
    GROUP BY o.vn, o.icode, di.units`)

  const map = new Map<string, DuplicateDrugLine[]>()
  for (const row of rows(result)) {
    const vn = String(row.vn ?? '').trim()
    const icode = String(row.icode ?? '').trim()
    const names = nameOf.get(icode)
    if (vn === '' || names == null) continue

    // รหัสวิธีใช้กับข้อความถูกต่อไว้ด้วย tab — ว่างได้ทั้งคู่เมื่อบรรทัดนั้นไม่มีทั้งสองอย่าง
    const [code, text] = String(row.usage_text ?? '').split('\t')

    const list = map.get(vn)
    const line: DuplicateDrugLine = {
      icode,
      name: names.name,
      generic: names.generic,
      qty: row.qty == null ? null : Number(row.qty),
      units: str(row.units),
      usage: str(text),
      usageCode: str(code),
    }
    if (list == null) map.set(vn, [line])
    else list.push(line)
  }

  // เรียงตามชื่อยาให้ลำดับคงที่ ไม่ขึ้นกับลำดับที่ฐานคืนมา
  for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name))
  return map
}

type VisitDetail = {
  hn: string
  date: string | null
  patientName: string
  ageYears: number | null
  sex: string | null
  department: string | null
  doctor: string | null
}

/**
 * รายละเอียดของครั้งที่มารับบริการ — ถามเฉพาะ vn ที่เป็นเคสจริง
 *
 * แยกออกมาเป็นคิวรีที่สอง ไม่ได้เอาไปรวมกับคิวรีอ่านบรรทัดยา เพราะจำนวน vn
 * ที่ต้องรู้รายละเอียดคือหลักร้อยถึงสองพัน ส่วนบรรทัดยาที่อ่านมาคือหลักหมื่นถึง
 * แสน การลาก patient/kskdepartment/doctor ไปด้วยตั้งแต่รอบแรกคือการ join
 * ตารางเพิ่มสามตารางให้กับแถวที่ 95% ไม่ได้ใช้
 */
async function visitDetails(vns: string[]): Promise<Map<string, VisitDetail>> {
  const unique = [...new Set(vns.filter(vn => vn !== ''))]
  if (unique.length === 0) return new Map()

  const [result] = await hisDb.execute(sql`
    SELECT v.vn, v.hn,
           DATE_FORMAT(v.vstdate, '%Y-%m-%d') AS vstdate,
           v.age_y, v.sex,
           CONCAT_WS(' ', p.pname, p.fname, p.lname) AS patient_name,
           dep.department AS dep_name, doc.name AS doctor_name
    FROM vn_stat v
    LEFT OUTER JOIN ovst ov ON ov.vn = v.vn
    LEFT OUTER JOIN patient p ON p.hn = v.hn
    LEFT OUTER JOIN kskdepartment dep ON dep.depcode = ov.main_dep
    LEFT OUTER JOIN doctor doc ON doc.code = ov.doctor
    WHERE v.vn IN (${sql.join(
      unique.map(vn => sql`${vn}`),
      sql`, `,
    )})`)

  const map = new Map<string, VisitDetail>()
  for (const row of rows(result)) {
    map.set(String(row.vn ?? '').trim(), {
      hn: String(row.hn ?? '').trim(),
      date: str(row.vstdate),
      patientName: str(row.patient_name) ?? '—',
      ageYears: row.age_y == null ? null : Number(row.age_y),
      sex: str(row.sex),
      department: str(row.dep_name),
      doctor: str(row.doctor_name),
    })
  }
  return map
}

type PatientDetail = { patientName: string; ageYears: number | null; sex: string | null }

/**
 * ชื่อและอายุของผู้ป่วย — ใช้กับโหมดข้าม visit ที่แถวเป็นคน ไม่ใช่ครั้ง
 *
 * อายุอ่านจาก patient.birthday ไม่ได้อ่านจาก vn_stat.age_y เหมือนโหมด visit —
 * โหมดนั้นแถวหนึ่งคือครั้งหนึ่ง อายุ ณ ครั้งนั้นจึงเป็นค่าที่ถูก แต่โหมดนี้
 * แถวหนึ่งคือคนหนึ่งที่มาหลายครั้ง ถ้าหยิบ age_y ของครั้งใดครั้งหนึ่งมาจะได้
 * อายุที่ขึ้นกับว่าหยิบครั้งไหน
 */
async function patientDetails(hns: string[]): Promise<Map<string, PatientDetail>> {
  const unique = [...new Set(hns.filter(hn => hn !== ''))]
  if (unique.length === 0) return new Map()

  const [result] = await hisDb.execute(sql`
    SELECT p.hn, p.sex,
           CONCAT_WS(' ', p.pname, p.fname, p.lname) AS patient_name,
           TIMESTAMPDIFF(YEAR, p.birthday, CURDATE()) AS age_y
    FROM patient p
    WHERE p.hn IN (${sql.join(
      unique.map(hn => sql`${hn}`),
      sql`, `,
    )})`)

  const map = new Map<string, PatientDetail>()
  for (const row of rows(result)) {
    map.set(String(row.hn ?? '').trim(), {
      patientName: str(row.patient_name) ?? '—',
      ageYears: row.age_y == null ? null : Number(row.age_y),
      sex: str(row.sex),
    })
  }
  return map
}
