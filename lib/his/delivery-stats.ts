import 'server-only'
import { sql } from 'drizzle-orm'
import { hisDb } from '@/lib/db/his'
import { serviceCodes } from '@/lib/his/service-codes'

/**
 * ตัวเลขสรุปงานส่งยาถึงบ้าน สำหรับหน้าภาพรวมของผู้บริหาร
 *
 * ทุกชุดตั้งต้นจากตารางเดียวกัน: รายการค่าบริการจัดส่งยาใน opitemrece ยุบเป็น
 * หนึ่งแถวต่อหนึ่ง vn (หนึ่งครั้งที่มารับบริการ) แล้วค่อยต่อกับตารางจับคู่ผู้ส่งยา
 * ทะเบียนผู้ป่วย และทะเบียนเจ้าหน้าที่
 *
 * สรุปทั้งหมดทำที่ฐานข้อมูล ไม่ดึงรายแถวออกมานับเองที่แอป — ช่วงหนึ่งปีมีหลักพัน
 * ครั้ง การดึงออกมาทั้งหมดเพื่อทำตัวเลขไม่กี่ตัวเป็นการขนข้อมูลผู้ป่วยออกมาเกิน
 * ความจำเป็น และไม่มีข้อมูลรายบุคคลหลุดออกจากฟังก์ชันนี้เลย
 */

export type DeliveryDayStat = {
  date: string
  visits: number
  patients: number
  assigned: number
  amount: number
}

export type DeliveryMonthStat = {
  /** 'YYYY-MM' */
  month: string
  visits: number
  patients: number
  amount: number
}

/**
 * สัดส่วนการเข้าร่วมโครงการของกลุ่มหนึ่ง (ตำบลหรือสิทธิการรักษา)
 *
 * delivered = ครั้งที่มารับบริการแล้วได้ส่งยาถึงบ้าน
 * visits = ครั้งที่มารับบริการทั้งหมดของกลุ่มนั้นในช่วงเดียวกัน (ตัวหาร)
 * ตัวหารนับจากผู้ป่วยนอกทั้งหมด ไม่ได้กรองเฉพาะคนที่ได้รับยา — ตัวเลขที่ได้จึง
 * เป็นสัดส่วนต่อการมารับบริการทั้งหมด ไม่ใช่ต่อคนที่ "มีสิทธิ์ได้ส่งยา"
 */
export type DeliveryGroupStat = {
  name: string
  /** จำนวนครั้งที่ส่งยาถึงบ้าน */
  delivered: number
  /** ผู้ป่วยไม่ซ้ำที่ได้ส่งยาถึงบ้าน */
  patients: number
  /** การมารับบริการทั้งหมดของกลุ่มนี้ ใช้เป็นตัวหาร */
  visits: number
}

export type DeliveryRiderStat = {
  riderId: number
  name: string
  roleName: string
  visits: number
}

/** งานของเจ้าหน้าที่หนึ่งคน แยกลงถึงระดับหมู่ในตำบล */
export type DeliveryRiderAreaStat = {
  riderId: number
  riderName: string
  tambon: string
  /** '-' เมื่อที่อยู่ไม่ได้ระบุหมู่ */
  moo: string
  visits: number
}

export type DeliveryStats = {
  from: string
  to: string
  daily: DeliveryDayStat[]
  monthly: DeliveryMonthStat[]
  byTambon: DeliveryGroupStat[]
  /** สัดส่วนการใช้บริการแยกตามสิทธิการรักษา */
  byRight: DeliveryGroupStat[]
  byRider: DeliveryRiderStat[]
  /** ภาระงานรายบุคคลแยกตามพื้นที่ที่ไปส่งจริง (ตามที่อยู่ผู้ป่วย ไม่ใช่พื้นที่ที่รับผิดชอบ) */
  byRiderArea: DeliveryRiderAreaStat[]
  totals: {
    visits: number
    patients: number
    assigned: number
    amount: number
    /** การมารับบริการผู้ป่วยนอกทั้งหมดในช่วงนี้ — ตัวหารของสัดส่วนการเข้าร่วม */
    opdVisits: number
    /** จำนวนเจ้าหน้าที่ที่มีงานส่งอย่างน้อยหนึ่งครั้งในช่วงนี้ */
    activeRiders: number
    /** จำนวนวันที่มีงานส่งยา ใช้หาค่าเฉลี่ยต่อวันทำงานจริง */
    workingDays: number
  }
}

const rowsOf = (result: unknown) => result as unknown as Record<string, unknown>[]
const num = (value: unknown) => Number(value ?? 0)

/**
 * @param from,to วันที่รูปแบบ 'YYYY-MM-DD' (ผู้เรียกตรวจรูปแบบและความกว้างมาแล้ว)
 *
 * ยิงสี่คิวรีพร้อมกัน — ทั้งสี่อ่านช่วงเดียวกันแต่ยุบคนละแกน (วัน เดือน ตำบล คน)
 * ให้ฐานทำทีละอันขนานกันเร็วกว่าดึงชุดใหญ่ชุดเดียวมาแยกเองที่แอป
 */
export async function getDeliveryStats(from: string, to: string): Promise<DeliveryStats> {
  const code = serviceCodes.drugDelivery

  const [dailyRes, monthlyRes, tambonRes, rightRes, riderRes, riderAreaRes] = await Promise.all([
    hisDb.execute(sql`
      SELECT DATE_FORMAT(d.vstdate, '%Y-%m-%d') AS day,
             COUNT(*) AS visits,
             COUNT(DISTINCT d.hn) AS patients,
             SUM(d.amount) AS amount,
             SUM(CASE WHEN tr.rider IS NOT NULL THEN 1 ELSE 0 END) AS assigned
      FROM (
        SELECT o.vn, o.hn, o.vstdate, SUM(o.sum_price) AS amount
        FROM opitemrece o
        WHERE o.icode = ${code} AND o.vstdate BETWEEN ${from} AND ${to}
        GROUP BY o.vn, o.hn, o.vstdate
      ) d
      LEFT OUTER JOIN fiat_pyhos_health_rider_trace tr ON tr.vn = d.vn
      GROUP BY d.vstdate
      ORDER BY d.vstdate`),

    // ย้อนหลัง 12 เดือนนับจากเดือนของวันสุดท้ายในช่วง — กราฟแนวโน้มระยะยาว
    // ไม่ควรสั้นตามช่วงที่เลือก ไม่งั้นเลือกช่วงสัปดาห์เดียวแล้วเห็นแท่งเดียว
    hisDb.execute(sql`
      SELECT DATE_FORMAT(d.vstdate, '%Y-%m') AS month,
             COUNT(*) AS visits,
             COUNT(DISTINCT d.hn) AS patients,
             SUM(d.amount) AS amount
      FROM (
        SELECT o.vn, o.hn, o.vstdate, SUM(o.sum_price) AS amount
        FROM opitemrece o
        WHERE o.icode = ${code}
          AND o.vstdate BETWEEN DATE_FORMAT(DATE_SUB(${to}, INTERVAL 11 MONTH), '%Y-%m-01')
                            AND ${to}
        GROUP BY o.vn, o.hn, o.vstdate
      ) d
      GROUP BY DATE_FORMAT(d.vstdate, '%Y-%m')
      ORDER BY month`),

    // ตั้งต้นจากการมารับบริการทั้งหมด (ovst) ไม่ใช่จากรายการส่งยา เพื่อให้ได้ทั้ง
    // ตัวเศษและตัวหารในคิวรีเดียว — ตำบลที่ไม่มีใครใช้บริการเลยก็ยังปรากฏ ซึ่งเป็น
    // ข้อมูลที่ต้องเห็น (แปลว่าโครงการยังไปไม่ถึงที่นั่น) ไม่ใช่หายไปเพราะไม่มีแถว
    hisDb.execute(sql`
      SELECT COALESCE(a.name, 'ไม่ระบุตำบล') AS tambon,
             COUNT(*) AS visits,
             SUM(CASE WHEN x.vn IS NOT NULL THEN 1 ELSE 0 END) AS delivered,
             COUNT(DISTINCT CASE WHEN x.vn IS NOT NULL THEN v.hn END) AS patients
      FROM ovst v
      LEFT OUTER JOIN patient p ON p.hn = v.hn
      LEFT OUTER JOIN thaiaddress a
        ON a.addressid = CONCAT(p.chwpart, p.amppart, p.tmbpart) AND a.codetype = '3'
      LEFT OUTER JOIN (
        SELECT DISTINCT o.vn FROM opitemrece o
        WHERE o.icode = ${code} AND o.vstdate BETWEEN ${from} AND ${to}
      ) x ON x.vn = v.vn
      WHERE v.vstdate BETWEEN ${from} AND ${to}
      GROUP BY tambon
      ORDER BY delivered DESC`),

    hisDb.execute(sql`
      SELECT COALESCE(t.name, 'ไม่ระบุสิทธิ') AS right_name,
             COUNT(*) AS visits,
             SUM(CASE WHEN x.vn IS NOT NULL THEN 1 ELSE 0 END) AS delivered,
             COUNT(DISTINCT CASE WHEN x.vn IS NOT NULL THEN v.hn END) AS patients
      FROM ovst v
      LEFT OUTER JOIN pttype t ON t.pttype = v.pttype
      LEFT OUTER JOIN (
        SELECT DISTINCT o.vn FROM opitemrece o
        WHERE o.icode = ${code} AND o.vstdate BETWEEN ${from} AND ${to}
      ) x ON x.vn = v.vn
      WHERE v.vstdate BETWEEN ${from} AND ${to}
      GROUP BY right_name
      ORDER BY delivered DESC`),

    // เฉพาะครั้งที่จ่ายงานแล้ว — คนที่ยังไม่ถูกจ่ายงานไม่มีภาระงานให้นับ
    hisDb.execute(sql`
      SELECT tr.rider AS rider_id,
             CONCAT_WS(' ', u.pname, u.fname, u.lname) AS rider_name,
             COALESCE(ro.name, 'ไม่ระบุประเภท') AS role_name,
             COUNT(*) AS visits
      FROM (
        SELECT o.vn
        FROM opitemrece o
        WHERE o.icode = ${code} AND o.vstdate BETWEEN ${from} AND ${to}
        GROUP BY o.vn
      ) d
      JOIN fiat_pyhos_health_rider_trace tr ON tr.vn = d.vn AND tr.rider IS NOT NULL
      LEFT OUTER JOIN fiat_pyhos_health_rider_users u ON u.id = tr.rider
      LEFT OUTER JOIN fiat_pyhos_health_rider_role ro ON ro.id = u.role
      GROUP BY tr.rider, rider_name, role_name
      ORDER BY visits DESC`),

    // แยกถึงระดับหมู่ — พื้นที่มาจากที่อยู่ของผู้ป่วยที่ไปส่งจริง ไม่ใช่พื้นที่ที่
    // เจ้าหน้าที่คนนั้นรับผิดชอบไว้ในทะเบียน สองอย่างนี้ไม่จำเป็นต้องตรงกัน และ
    // ส่วนที่ไม่ตรงคือสิ่งที่ผู้บริหารควรเห็น
    hisDb.execute(sql`
      SELECT tr.rider AS rider_id,
             CONCAT_WS(' ', u.pname, u.fname, u.lname) AS rider_name,
             COALESCE(a.name, 'ไม่ระบุตำบล') AS tambon,
             COALESCE(NULLIF(TRIM(p.moopart), ''), '-') AS moo,
             COUNT(*) AS visits
      FROM (
        SELECT o.vn, o.hn
        FROM opitemrece o
        WHERE o.icode = ${code} AND o.vstdate BETWEEN ${from} AND ${to}
        GROUP BY o.vn, o.hn
      ) d
      JOIN fiat_pyhos_health_rider_trace tr ON tr.vn = d.vn AND tr.rider IS NOT NULL
      LEFT OUTER JOIN fiat_pyhos_health_rider_users u ON u.id = tr.rider
      LEFT OUTER JOIN patient p ON p.hn = d.hn
      LEFT OUTER JOIN thaiaddress a
        ON a.addressid = CONCAT(p.chwpart, p.amppart, p.tmbpart) AND a.codetype = '3'
      GROUP BY tr.rider, rider_name, tambon, moo
      ORDER BY visits DESC`),
  ])

  const daily = rowsOf(dailyRes[0]).map(row => ({
    date: String(row.day),
    visits: num(row.visits),
    patients: num(row.patients),
    assigned: num(row.assigned),
    amount: num(row.amount),
  }))

  const monthly = rowsOf(monthlyRes[0]).map(row => ({
    month: String(row.month),
    visits: num(row.visits),
    patients: num(row.patients),
    amount: num(row.amount),
  }))

  const byTambon = rowsOf(tambonRes[0]).map(row => ({
    name: String(row.tambon),
    delivered: num(row.delivered),
    patients: num(row.patients),
    visits: num(row.visits),
  }))

  const byRight = rowsOf(rightRes[0]).map(row => ({
    name: String(row.right_name),
    delivered: num(row.delivered),
    patients: num(row.patients),
    visits: num(row.visits),
  }))

  const byRider = rowsOf(riderRes[0]).map(row => ({
    riderId: num(row.rider_id),
    // ชื่อว่างแปลว่ารหัสไม่มีในทะเบียนแล้ว ยังต้องนับงานให้เห็น ไม่ใช่ทิ้งไป
    name: String(row.rider_name ?? '').trim() || `ไม่พบเจ้าหน้าที่ ${num(row.rider_id)}`,
    roleName: String(row.role_name),
    visits: num(row.visits),
  }))

  const byRiderArea = rowsOf(riderAreaRes[0]).map(row => ({
    riderId: num(row.rider_id),
    riderName: String(row.rider_name ?? '').trim() || `ไม่พบเจ้าหน้าที่ ${num(row.rider_id)}`,
    tambon: String(row.tambon),
    moo: String(row.moo),
    visits: num(row.visits),
  }))

  const totals = {
    visits: daily.reduce((sum, day) => sum + day.visits, 0),
    // นับผู้ป่วยไม่ซ้ำข้ามทั้งช่วงไม่ได้จากผลรายวัน (คนเดิมมาหลายวัน) — ผลรวมนี้
    // จึงเป็น "ครั้ง" ส่วนจำนวนคนจริงคิดจากตำบลซึ่งยุบทั้งช่วงมาแล้ว
    patients: byTambon.reduce((sum, item) => sum + item.patients, 0),
    assigned: daily.reduce((sum, day) => sum + day.assigned, 0),
    amount: daily.reduce((sum, day) => sum + day.amount, 0),
    // นับจากชุดตำบลเพราะยุบมาจาก ovst ทั้งหมดแล้ว (ชุดสิทธิให้ผลเท่ากัน)
    opdVisits: byTambon.reduce((sum, item) => sum + item.visits, 0),
    activeRiders: byRider.length,
    workingDays: daily.length,
  }

  return { from, to, daily, monthly, byTambon, byRight, byRider, byRiderArea, totals }
}
