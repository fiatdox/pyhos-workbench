import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'

/**
 * งานตรวจสุขภาพ — รายชื่อผู้ที่มารับบริการตามสิทธิที่เลือก ในช่วงวันที่ที่เลือก
 *
 * รับสองอย่าง: **ชื่อสิทธิ** กับ **ช่วงวันที่** แล้วคืนรายชื่อ ไม่มีเงื่อนไขอื่นซ่อนอยู่
 * สิทธิที่เลือกคือคำนิยามของรายงาน — ครั้งที่ใช้สิทธินั้นในช่วงนั้นเข้าทุกครั้ง
 *
 * ตั้งต้นให้หน้าจอเลือก 18 สิทธิที่ชื่อมีคำว่า "ตรวจสุขภาพ" ไว้ให้ (ดู
 * CheckupRight.checkupNamed) แต่เลือกสิทธิอื่นได้ทั้งหมด เพราะงานตรวจสุขภาพจริง
 * ไม่ได้ใช้แต่สิทธิที่ชื่อตรงคำ — วัดปีงบ 2569 ที่ศูนย์ตรวจสุขภาพ (Wellness Center)
 * กลุ่มใหญ่สุด 3,370 จาก 6,449 ครั้งใช้สิทธิ "00 ชำระเงิน (ไม่มีสิทธิการรักษา)"
 * คือคนจ่ายเงินมาตรวจเอง ซึ่งไม่อยู่ใน 18 สิทธินั้น ถ้าต้องการกลุ่มนี้ต้องเลือก
 * สิทธิ 00 เพิ่มเอง
 *
 * ## ข้อมูลที่ไม่ส่งออกไป
 *
 * ตาราง patient กับ vn_stat มีเลขบัตรประชาชน เบอร์โทร และที่อยู่อยู่ด้วย
 * คิวรีในไฟล์นี้ไม่หยิบคอลัมน์เหล่านั้นเลย — หน้าจอต้องการแค่ชื่อ เพศ และอายุ
 */

/** ช่วงวันที่ยาวสุดต่อการค้นหนึ่งครั้ง — เท่ากับรายงานอื่นของระบบ */
export const CHECKUP_MAX_RANGE_DAYS = 366

/**
 * จำนวนแถวสูงสุดที่ส่งกลับไปหน้าจอ
 *
 * เลือกสิทธิใหญ่ได้ และสิทธิใหญ่ที่สุดในฐานมีถึง 94,724 ครั้งต่อปี ("40 ผู้มีอายุ
 * เกิน 60 ปีบริบูรณ์") ถ้าไม่ปิดเพดานไว้ การเลือกสิทธินั้นจะลากทั้งก้อนลง
 * เบราว์เซอร์ เพดานนี้ตัดแถว แต่ยอดรวมกับจำนวนคนยังนับจากทั้งหมดจริง (ดู
 * totalVisits/totalPatients) จึงบอกได้ว่าตัดไปเท่าไรและตัวเลขรวมไม่ผิด
 */
export const CHECKUP_MAX_ROWS = 15_000

/** อ่านผลคิวรีเป็นแถวดิบ */
const rows = (result: unknown) => result as unknown as Record<string, unknown>[]

/**
 * อักขระควบคุมและอักขระเสียที่หลงมาในข้อมูล — ตัดออกก่อนส่งถึงเบราว์เซอร์
 *
 * ไล่ชื่อผู้ป่วยทั้งตาราง 628,461 ราย เจอ 1 รายที่มี U+001E (record separator)
 * ติดท้ายนามสกุล ตัวเดียวแต่ต้องตัด เพราะค่านี้ไปต่อสามทาง: ตารางบนจอ (มองไม่เห็น
 * แต่คัดลอกไปแล้วติดไปด้วย) ไฟล์ CSV (อักขระควบคุมในไฟล์ทำให้โปรแกรมบางตัวอ่าน
 * แถวเพี้ยน) และใบที่พิมพ์ (ฟอนต์ไม่มี glyph ให้ U+001E)
 *
 * ขึ้นบรรทัดกับแท็บก็ตัดด้วย — ทุกช่องที่ไฟล์นี้อ่านเป็นข้อความบรรทัดเดียวทั้งหมด
 * (ชื่อ สิทธิ ห้องตรวจ แพทย์) ไม่มีช่องไหนที่การขึ้นบรรทัดมีความหมาย
 */
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F�]/g

const str = (v: unknown): string | null =>
  v == null || v === '' ? null : String(v).replace(CONTROL_CHARS, '').trim() || null

/**
 * วันที่จากฐาน — วันที่ศูนย์ถือว่าไม่มีวันที่
 *
 * MariaDB ยอมให้เก็บ '0000-00-00' ได้และในฐานนี้มีจริง **21,286 แถวจาก 7,540,746**
 * ของ vn_stat (เจอตอนค้นข้ามทุกสิทธิซึ่งไปแตะแถวเก่า ๆ) ถ้าปล่อยผ่านไปจนถึง
 * หน้าจอ ตัวแปลงวันเป็น พ.ศ. จะเติม 543 ให้ปีศูนย์แล้วพิมพ์ว่า "00/00/543"
 * ซึ่งอ่านเหมือนเป็นวันที่จริง การคืน null ทำให้หน้าจอแสดงขีดตามที่ควร
 */
const dateStr = (v: unknown): string | null => {
  const text = str(v)
  return text == null || text.startsWith('0000') ? null : text
}

/** สิทธิการรักษาหนึ่งรายการ สำหรับช่องเลือกสิทธิ */
export type CheckupRight = {
  /** รหัสสิทธิ (pttype.pttype) */
  code: string
  name: string
  /** ชื่อสิทธิมีคำว่า "ตรวจสุขภาพ" — หน้าจอใช้เลือกไว้ให้ตั้งต้น */
  checkupNamed: boolean
}

/**
 * สิทธิการรักษาที่เปิดใช้งาน
 *
 * เอาเฉพาะ isuse = 'Y' (207 จาก 211 รายการ) — สี่รายการที่ปิดไปแล้วไม่ควรให้เลือก
 * ใหม่ แต่ถ้ามีครั้งเก่าที่ใช้สิทธินั้นอยู่ ชื่อสิทธิในตารางผลยังอ่านได้ปกติ
 * เพราะส่วนนั้น join ตรงกับ pttype ไม่ได้กรอง isuse
 */
export async function listCheckupRights(): Promise<CheckupRight[]> {
  const [result] = await hisDb.execute(sql`
    SELECT pttype, name
    FROM pttype
    WHERE isuse = 'Y'
    ORDER BY pttype`)

  return rows(result)
    .map(row => {
      const code = String(row.pttype ?? '').trim()
      const name = str(row.name) ?? code
      return { code, name, checkupNamed: name.includes('ตรวจสุขภาพ') }
    })
    .filter(right => right.code !== '')
}

/** การมารับบริการหนึ่งครั้ง */
export type CheckupVisit = {
  vn: string
  hn: string
  date: string | null
  patientName: string
  ageYears: number | null
  /**
   * เพศเป็นคำอ่านได้ มาจากตาราง sex ของ HIS ไม่ใช่รหัสที่หน้าจอต้องแปลเอง
   *
   * ตาราง sex มีสองแถว ('1' ชาย · '2' หญิง) ถ้าแปลรหัสเองในหน้าจอแล้ววันหนึ่ง
   * โรงพยาบาลเพิ่มรหัสใหม่ หน้าจอจะขึ้นขีดโดยไม่มีใครรู้ว่าฐานมีค่าอยู่
   *
   * null = รหัสเพศไม่ตรงกับตาราง sex (ในทะเบียนผู้ป่วยมีค่า '0' อยู่ 83 ราย
   * และ '7' อยู่ 1 ราย ซึ่งไม่ใช่รหัสที่ใช้ได้) หรือไม่มีค่าทั้งสองที่
   */
  sex: string | null
  pttype: string | null
  pttypeName: string | null
  department: string | null
  doctor: string | null
}

/** ยอดรวมของสิทธิหนึ่งรายการ */
export type CheckupRightSummary = {
  pttype: string | null
  name: string
  visits: number
  patients: number
}

export type CheckupReport = {
  from: string
  to: string
  /** สิทธิที่เลือก */
  pttypes: string[]
  /** คำค้นที่ใช้ — null = ค้นตามช่วงวันที่ */
  keyword: string | null
  /** ค้นด้วยคำค้นจึงไม่จำกัดช่วงวันที่ — หน้าจอต้องบอกว่าตัวเลขไม่ใช่ของช่วงที่เลือก */
  allTime: boolean
  /** รายชื่อ — ไม่เกิน CHECKUP_MAX_ROWS แถว เรียงวันใหม่สุดขึ้นก่อน */
  visits: CheckupVisit[]
  /** จำนวนครั้งทั้งหมดในช่วงนี้ตามสิทธิที่เลือก — นับจากทั้งหมด ไม่ใช่จากแถวที่ส่ง */
  totalVisits: number
  /** จำนวนคน (HN ไม่ซ้ำ) ทั้งหมดในช่วงนี้ — นับจากทั้งหมดเช่นกัน */
  totalPatients: number
  /** ยอดแยกตามสิทธิ — นับจากทั้งหมด ไม่ใช่จากแถวที่ส่ง */
  byRight: CheckupRightSummary[]
  /** เกิน CHECKUP_MAX_ROWS จึงตัดรายชื่อ ส่วนตัวเลขสรุปยังเป็นยอดจริงทั้งหมด */
  truncated: boolean
}

export type CheckupInput = {
  /** 'YYYY-MM-DD' */
  from: string
  to: string
  /** รหัสสิทธิที่ต้องการ — ต้องมีอย่างน้อยหนึ่งรหัส */
  pttypes: string[]
  /**
   * HN หรือชื่อ-สกุล — ใส่มาแล้วจะค้นทุกช่วงเวลา ไม่ใช้ from/to
   *
   * เพราะคนที่ถือ HN หรือชื่อมาคนหนึ่งมักไม่รู้ว่าคนนั้นมาตรวจวันไหน ซึ่งเป็น
   * เหตุผลเดียวกับหน้าผลตรวจ HLA-B*5801 ที่ค้นด้วยคำค้นแล้วข้ามช่วงวันที่ไป
   */
  keyword?: string
}

/** พิมพ์ชื่อสั้นกว่านี้ไม่ค้น — ตัวอักษรเดียวตรงกับคนเป็นหมื่น */
export const CHECKUP_MIN_KEYWORD = 2

/**
 * จำนวนผู้ป่วยสูงสุดที่คำค้นหนึ่งคำจะตรงได้
 *
 * เกินนี้**ปฏิเสธแล้วบอกให้พิมพ์เจาะจงขึ้น ไม่ได้ตัดเอาส่วนแรกมา** — ชื่อขึ้นต้น
 * "สม" ตรงกับผู้ป่วย 31,306 ราย ถ้าตัดเอาแค่ส่วนหนึ่ง คนใช้จะได้รายชื่อที่ดู
 * เหมือนครบแต่เป็นเพียงส่วนที่ฐานหยิบมาให้ โดยไม่มีอะไรบอกว่าขาดไป
 *
 * ตั้งไว้ 2,000 เพราะวัดมาจากสองด้าน:
 *
 * **ด้านความพอใช้** ชื่อต้นภาษาไทยทั่วไปตรงกับผู้ป่วยหลักร้อยถึงหลักพัน
 * (ขึ้นต้น "อนุชา" 463 · "ยุพิน" 898 · "สุดา" 941 · "สมชาย" 1,277) ถ้าตั้งเพดาน
 * ไว้หลักร้อย การค้นด้วยชื่อเดียวจะถูกปฏิเสธแทบทุกคำ เหลือใช้ได้แค่ชื่อ+สกุล
 * ที่ 2,000 ครอบได้เกือบทั้งหมด เหลือที่ยังปฏิเสธคือชื่อที่พบบ่อยที่สุดในฐานจริง ๆ
 * (จันทร์ 4,168 · แก้ว 4,104 · คำ 3,878) ซึ่งการค้นด้วยคำเดียวแบบนั้นไม่ใช่
 * การหาคนอยู่แล้ว
 *
 * **ด้านภาระฐาน** เวลาขึ้นเป็นเส้นตรงกับจำนวน HN และถูกมาก วัดกรณีแย่สุด
 * (คูณทุกสิทธิที่เปิดใช้งาน ทุกช่วงเวลา): 200 HN ใช้ 0.18+0.04 วินาที ·
 * 1,000 HN ใช้ 0.59+0.13 · **2,000 HN ใช้ 0.89+0.24** · 5,000 HN ใช้ 2.06+0.63
 * ที่ 2,000 จึงยังอยู่ระดับเดียวกับโหมดช่วงวันที่ (0.54-0.92 วินาที)
 */
export const CHECKUP_MAX_KEYWORD_PATIENTS = 2000

/** escape อักขระพิเศษของ LIKE ไม่ให้ % หรือ _ ที่ผู้ใช้พิมพ์กลายเป็น wildcard */
const likeValue = (value: string) => value.replace(/[\\%_]/g, ch => `\\${ch}`)

/**
 * แปลงคำค้นเป็นรายการ HN
 *
 * หา HN ให้ได้ก่อนแล้วค่อยถามครั้งที่มารับบริการด้วย HN — ไม่ได้ join patient
 * เข้าไปในคิวรีหลักแล้วกรองชื่อที่นั้น **วัดแล้วต่างกัน 540 เท่า**: แบบ join
 * แล้วกรองชื่อ ตัววางแผนจะไล่ดัชนี pttype ทั้งก้อน (สิทธิเดียวมีได้ถึง 1,254,293
 * ครั้ง) แล้วเช็กชื่อทีหลัง กรณีทุกสิทธิ + ชื่อที่พบบ่อยใช้ 49 วินาที ส่วนแบบหา HN
 * ก่อนใช้ 91 มิลลิวินาทีในกรณีเดียวกัน เพราะ vn_stat มีดัชนีที่ hn
 *
 * กติกาการตีความคำค้นเหมือน lib/his/patient-search.ts ที่ใช้อยู่ทั้งระบบ —
 * ตัวเลขล้วนคือ HN (เติมศูนย์หน้าให้) คำเดียวค้นทั้งชื่อและสกุล สองคำขึ้นไปถือว่า
 * คำแรกเป็นชื่อที่เหลือเป็นสกุล และค้นแบบ**ขึ้นต้น**เท่านั้นเพราะดัชนี ix_fname
 * กับ ix_lname ใช้ได้แค่แบบขึ้นต้น ถ้าใช้ LIKE '%คำ%' จะไล่ทั้งตาราง 628,462 แถว
 */
async function keywordHns(keyword: string): Promise<string[]> {
  const digits = keyword.replace(/\D/g, '')
  let where: ReturnType<typeof sql>

  if (/^\d{1,9}$/.test(keyword)) {
    where = sql`a.hn = ${digits.padStart(9, '0')}`
  } else {
    const parts = keyword.split(/\s+/).filter(Boolean)
    if (parts.length === 1) {
      const prefix = `${likeValue(parts[0])}%`
      where = sql`(a.fname LIKE ${prefix} OR a.lname LIKE ${prefix})`
    } else {
      const first = `${likeValue(parts[0])}%`
      const last = `${likeValue(parts.slice(1).join(' '))}%`
      where = sql`(a.fname LIKE ${first} AND a.lname LIKE ${last})`
    }
  }

  const [result] = await hisDb.execute(sql`
    SELECT a.hn FROM patient a
    WHERE ${where}
    LIMIT ${CHECKUP_MAX_KEYWORD_PATIENTS + 1}`)

  const hns = rows(result)
    .map(row => String(row.hn ?? '').trim())
    .filter(hn => hn !== '')

  if (hns.length > CHECKUP_MAX_KEYWORD_PATIENTS) {
    throw new Error(
      `คำค้นนี้ตรงกับผู้ป่วยมากกว่า ${CHECKUP_MAX_KEYWORD_PATIENTS} ราย กรุณาพิมพ์ให้เจาะจงขึ้น เช่น ใส่นามสกุลด้วย หรือค้นด้วย HN`,
    )
  }
  return hns
}

/**
 * ค้นรายชื่อผู้ที่มารับบริการตามสิทธิที่เลือก
 *
 * ขับจาก vn_stat ซึ่งมีดัชนีทั้งที่ vstdate, pttype และ hn — วัดแล้ว 18 สิทธิ
 * ตรวจสุขภาพทั้งปีงบใช้ 0.54 วินาที สิทธิที่ใหญ่ที่สุดในฐานอยู่ที่ 0.92 วินาที
 * และโหมดคำค้น (ถามด้วย HN ทุกช่วงเวลา) อยู่ที่ 0.09 วินาที
 *
 * ยอดสรุปแยกเป็นคิวรีของตัวเอง ยิงพร้อมกัน ไม่ได้นับจากแถวที่คืนมา — เพราะแถวที่
 * คืนมาถูก LIMIT ตัดไว้ ถ้านับจากแถวที่เหลือ ยอดรวมจะต่ำกว่าความจริงโดยที่คนอ่าน
 * ไม่รู้ และยอดนี้เบามาก (GROUP BY บนดัชนีเดียวกัน ไม่ต้อง join อะไรเลย)
 */
export async function searchCheckups(input: CheckupInput): Promise<CheckupReport> {
  const pttypes = [...new Set(input.pttypes.filter(code => code !== ''))]
  if (pttypes.length === 0) throw new Error('กรุณาเลือกสิทธิอย่างน้อยหนึ่งรายการ')

  const keyword = input.keyword?.trim() ?? ''
  if (keyword !== '' && keyword.length < CHECKUP_MIN_KEYWORD) {
    throw new Error(`พิมพ์คำค้นอย่างน้อย ${CHECKUP_MIN_KEYWORD} ตัวอักษร`)
  }

  const codeList = sql.join(
    pttypes.map(code => sql`${code}`),
    sql`, `,
  )

  /**
   * เงื่อนไขขอบเขตของทั้งสองโหมด — ใช้ร่วมกันทั้งคิวรีรายชื่อและคิวรียอดสรุป
   *
   * เขียนไว้ที่เดียวแล้วส่งเข้าไปทั้งสองคิวรี ไม่ได้เขียนซ้ำสองที่ — ถ้าเขียนซ้ำ
   * แล้ววันหนึ่งแก้ที่เดียว รายชื่อกับยอดสรุปจะมาจากคนละขอบเขตโดยไม่มีใครรู้
   */
  let scope: ReturnType<typeof sql>
  if (keyword === '') {
    scope = sql`v.vstdate BETWEEN ${input.from} AND ${input.to}`
  } else {
    const hns = await keywordHns(keyword)
    // ไม่เจอผู้ป่วยที่ตรงคำค้นเลย — คืนผลว่างไปตรง ๆ ไม่ต้องถามฐานต่อ
    // (IN () ที่ว่างเปล่าเป็น syntax error ของ MySQL อยู่แล้ว)
    if (hns.length === 0) {
      return {
        from: input.from,
        to: input.to,
        pttypes,
        keyword,
        allTime: true,
        visits: [],
        totalVisits: 0,
        totalPatients: 0,
        byRight: [],
        truncated: false,
      }
    }
    scope = sql`v.hn IN (${sql.join(
      hns.map(hn => sql`${hn}`),
      sql`, `,
    )})`
  }

  const [listResult, summaryResult] = await Promise.all([
    hisDb.execute(sql`
      SELECT v.vn, v.hn,
             DATE_FORMAT(v.vstdate, '%Y-%m-%d') AS vstdate,
             v.age_y, v.pttype,
             sx.name AS sex_name,
             pt.name AS pttype_name,
             dep.department AS dep_name,
             doc.name AS doctor_name,
             CONCAT_WS(' ', p.pname, p.fname, p.lname) AS patient_name
      FROM vn_stat v
      LEFT OUTER JOIN ovst ov ON ov.vn = v.vn
      LEFT OUTER JOIN pttype pt ON pt.pttype = v.pttype
      LEFT OUTER JOIN kskdepartment dep ON dep.depcode = ov.main_dep
      LEFT OUTER JOIN doctor doc ON doc.code = ov.doctor
      LEFT OUTER JOIN patient p ON p.hn = v.hn
      /* เพศเอาจากทะเบียนผู้ป่วยก่อน แล้วถอยมาใช้ของ vn_stat
         — vn_stat.sex เป็นค่าที่ HOSxP เติมย้อนหลัง แถวของเดือนปัจจุบันจึงยังว่าง
         อยู่บางส่วน (วัดเดือน ต.ค. 2569: ว่าง 130 จาก 17,980 ครั้ง ขณะที่หกเดือน
         ก่อนหน้าว่างรวมกันแค่ 2 ครั้ง) ส่วน patient.sex เติมครบทุกคนที่มาใน 30 วัน
         (43,514 จาก 43,514) และเมื่อสองที่ไม่ตรงกัน ทะเบียนผู้ป่วยคือค่าที่ถูก
         NULLIF กันค่าว่างที่เก็บเป็นสตริงว่าง ซึ่ง COALESCE เฉย ๆ จะไม่ข้ามให้ */
      LEFT OUTER JOIN sex sx ON sx.code = COALESCE(NULLIF(p.sex, ''), NULLIF(v.sex, ''))
      WHERE ${scope}
        AND v.pttype IN (${codeList})
      ORDER BY v.vstdate DESC, v.vn DESC
      LIMIT ${CHECKUP_MAX_ROWS}`),
    /* ห้องตรวจกับชื่อผู้ป่วยไม่ต้องใช้ตรงนี้ จึงไม่ join — ยอดแยกตามสิทธิอ่านชื่อ
       สิทธิจาก pttype ตารางเดียว ส่วน COUNT(DISTINCT hn) ของทุกสิทธิรวมกันต้องนับ
       แยกอีกแถว เพราะคนเดียวใช้ได้หลายสิทธิในช่วงเดียวกัน ผลบวกของแต่ละสิทธิจึง
       ไม่เท่ากับจำนวนคนทั้งหมด (WITH ROLLUP ให้แถวรวมนั้นมาในคิวรีเดียวกัน)

       GROUP BY ต้องมี v.pttype คอลัมน์เดียว ชื่อสิทธิหยิบด้วย MAX() —
       ถ้าใส่ชื่อสิทธิเข้าไปใน GROUP BY ด้วย ROLLUP จะสร้างแถวรวม**สองชั้น**
       (ชั้นของ pttype+ชื่อ และชั้นของ pttype เฉย ๆ ที่ชื่อเป็น NULL) ทุกสิทธิ
       จะออกมาสองแถว ยอดรวมของตารางสรุปเลยเบิ้ลเป็นสองเท่า ชื่อสิทธิขึ้นกับรหัส
       อยู่แล้ว MAX() จึงได้ชื่อเดียวที่ถูกต้องเสมอ */
    hisDb.execute(sql`
      SELECT v.pttype, MAX(pt.name) AS pttype_name,
             COUNT(*) AS visits, COUNT(DISTINCT v.hn) AS patients
      FROM vn_stat v
      LEFT OUTER JOIN pttype pt ON pt.pttype = v.pttype
      WHERE ${scope}
        AND v.pttype IN (${codeList})
      GROUP BY v.pttype WITH ROLLUP`),
  ])

  const visits: CheckupVisit[] = []
  for (const row of rows(listResult[0])) {
    const vn = String(row.vn ?? '').trim()
    if (vn === '') continue
    visits.push({
      vn,
      hn: String(row.hn ?? '').trim(),
      date: dateStr(row.vstdate),
      patientName: str(row.patient_name) ?? '—',
      ageYears: row.age_y == null ? null : Number(row.age_y),
      sex: str(row.sex_name),
      pttype: str(row.pttype),
      pttypeName: str(row.pttype_name),
      department: str(row.dep_name),
      doctor: str(row.doctor_name),
    })
  }

  let totalVisits = 0
  let totalPatients = 0
  const byRight: CheckupRightSummary[] = []
  for (const row of rows(summaryResult[0])) {
    const visitCount = Number(row.visits ?? 0)
    const patientCount = Number(row.patients ?? 0)
    // แถวรวมของ ROLLUP มี pttype เป็น NULL — ต่างจากสิทธิว่างในข้อมูลจริงซึ่ง
    // เป็นสตริงว่าง ไม่ใช่ NULL จึงแยกกันได้
    if (row.pttype == null) {
      totalVisits = visitCount
      totalPatients = patientCount
      continue
    }
    const code = String(row.pttype).trim()
    byRight.push({
      pttype: code === '' ? null : code,
      name: str(row.pttype_name) ?? (code === '' ? 'ไม่ระบุสิทธิ' : code),
      visits: visitCount,
      patients: patientCount,
    })
  }
  byRight.sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name))

  return {
    from: input.from,
    to: input.to,
    pttypes,
    keyword: keyword === '' ? null : keyword,
    allTime: keyword !== '',
    visits,
    totalVisits,
    totalPatients,
    byRight,
    truncated: totalVisits > visits.length,
  }
}
