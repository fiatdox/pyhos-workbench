// อ่านค่า connection จาก .env — ใช้ร่วมกันทั้ง runtime ของแอปและ drizzle-kit
// Next.js โหลด .env ให้เองอยู่แล้ว ส่วน drizzle-kit โหลดผ่าน `bun --env-file` / defineConfig
// ที่ import ไฟล์นี้ (bun อ่าน .env ให้อัตโนมัติ)

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`ไม่พบค่า environment variable: ${name} (ตรวจสอบไฟล์ .env)`)
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
