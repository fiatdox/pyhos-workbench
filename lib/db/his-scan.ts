import 'server-only'
import mysql from 'mysql2/promise'
import { hisScanConfig } from './env'

/**
 * ฐานภาพสแกนเวชระเบียน (คนละเครื่องกับ HIS หลัก)
 *
 * ใช้ mysql2 ตรง ๆ ไม่ผ่าน drizzle เพราะอ่านแค่ตารางเดียวและต้องรับค่าเป็น Buffer
 * ตาราง opdscan มีราว 1.7 ล้านแถวและเก็บภาพเป็น longblob — ทุกคิวรีต้องมี LIMIT
 * และห้าม SELECT scan_image เว้นแต่ตอนดึงภาพทีละใบ
 */

const globalForScan = globalThis as unknown as { hisScanPool?: mysql.Pool }

export const hisScanPool =
  globalForScan.hisScanPool ??
  mysql.createPool({
    ...hisScanConfig,
    // ต่ำกว่า pool ของ HIS หลัก เพราะแต่ละคิวรีดึงภาพหลักหลายร้อย KB
    connectionLimit: 5,
    connectTimeout: 10_000,
  })

if (process.env.NODE_ENV !== 'production') globalForScan.hisScanPool = hisScanPool
