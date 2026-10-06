// อ่านค่า connection จาก .env — ใช้ร่วมกันทั้ง runtime ของแอปและ drizzle-kit
// Next.js โหลด .env ให้เองอยู่แล้ว ส่วน drizzle-kit โหลดผ่าน `bun --env-file` / defineConfig
// ที่ import ไฟล์นี้ (bun อ่าน .env ให้อัตโนมัติ)

export function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`ไม่พบค่า environment variable: ${name} (ตรวจสอบไฟล์ .env)`)
  return value
}

/** ค่าที่ต้องเป็นตัวเลข — กันพิมพ์ผิดแล้วไปกลายเป็น NaN ในคิวรีโดยไม่มีใครรู้ */
export function requiredNumber(name: string): number {
  const value = Number(required(name))
  if (!Number.isFinite(value)) {
    throw new Error(`ค่า environment variable: ${name} ต้องเป็นตัวเลข (ตรวจสอบไฟล์ .env)`)
  }
  return value
}

/**
 * ค่าตัวเลขที่ไม่ตั้งก็ได้ — ไม่ตั้งแปลว่า "ไม่มีของนี้ที่โรงพยาบาลนี้"
 *
 * ต่างจาก requiredNumber ที่ใช้กับค่าซึ่งขาดแล้วระบบทำงานผิด เช่นรหัส creatinine
 * ที่เป็นแกนของการคำนวณขนาดยา ส่วนรหัสแล็บประกอบอย่าง albumin หรือ CRP
 * โรงพยาบาลที่ไม่ได้ตรวจหรือใช้รหัสอื่นก็ยังต้องใช้ระบบส่วนที่เหลือได้
 * จะให้แอปบูตไม่ขึ้นเพราะไม่ได้ตั้งรหัส albumin ไม่สมเหตุสมผล
 *
 * ตั้งมาแต่ไม่ใช่ตัวเลขยังโยน error เหมือนเดิม — นั่นคือพิมพ์ผิด ไม่ใช่เจตนาไม่ตั้ง
 */
export function optionalNumber(name: string): number | null {
  const raw = process.env[name]
  if (raw == null || raw.trim() === '') return null
  const value = Number(raw)
  if (!Number.isFinite(value)) {
    throw new Error(`ค่า environment variable: ${name} ต้องเป็นตัวเลข (ตรวจสอบไฟล์ .env)`)
  }
  return value
}

/** HIS — MariaDB (อ่านข้อมูลโรงพยาบาล) */
export const hisConfig = {
  host: required('HIS_HOST'),
  port: Number(process.env.HIS_PORT ?? 3306),
  user: required('HIS_USER'),
  password: required('HIS_PASSWORD'),
  database: required('HIS_NAME'),
}

/** HIS Images Scan — MariaDB อีกเครื่อง เก็บภาพสแกนเวชระเบียน (ตาราง opdscan) */
export const hisScanConfig = {
  host: required('HIS_SCAN_HOST'),
  port: Number(process.env.HIS_SCAN_PORT ?? 3306),
  user: required('HIS_SCAN_USER'),
  password: required('HIS_SCAN_PASSWORD'),
  database: required('HIS_SCAN_NAME'),
}

/** CoreKon — PostgreSQL (ผู้ใช้/สิทธิ์ HRIS) */
export const coreKonConfig = {
  host: required('CORE_KON_HOST'),
  port: Number(process.env.CORE_KON_PORT ?? 5432),
  user: required('CORE_KON_USER'),
  password: required('CORE_KON_PASSWORD'),
  database: required('CORE_KON_DB_NAME'),
  schema: process.env.CORE_KON_SCHEMA ?? 'public',
}
