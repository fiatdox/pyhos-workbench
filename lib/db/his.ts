import 'server-only'
import { drizzle } from 'drizzle-orm/mysql2'
import mysql from 'mysql2/promise'
import { hisConfig } from './env'
import * as schema from './schema/his'

// เก็บ pool ไว้บน globalThis เพื่อไม่ให้ dev hot-reload เปิด connection ใหม่ทุกครั้ง
const globalForHis = globalThis as unknown as { hisPool?: mysql.Pool }

const pool =
  globalForHis.hisPool ??
  mysql.createPool({
    ...hisConfig,
    connectionLimit: 10,
    // ระบบนี้อ่านข้อมูลเป็นหลัก — ตั้ง timeout กันคิวรีค้างยาว
    connectTimeout: 10_000,
    // ฐาน HIS ใช้ tis620 ทั้งเซิร์ฟเวอร์ ถ้าไม่ระบุ ไดรเวอร์จะส่งพารามิเตอร์เป็น utf8
    // ทำให้ค้นด้วยข้อความไทยไม่เจอสักแถว (ผลลัพธ์ที่อ่านกลับมาถูกอยู่แล้วทั้งสองแบบ)
    charset: 'TIS620_THAI_CI',
  })

if (process.env.NODE_ENV !== 'production') globalForHis.hisPool = pool

/** ฐานข้อมูล HIS (MariaDB) — โหมดอ่านข้อมูลเป็นหลัก */
export const hisDb = drizzle(pool, { schema, mode: 'default' })
