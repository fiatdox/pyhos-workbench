import { defineConfig } from 'drizzle-kit'
import { hisConfig } from './lib/db/env'

// HIS (MariaDB) — ใช้สำหรับ `drizzle-kit pull` / `studio` เท่านั้น
// ฐานข้อมูลนี้บริหารโดยระบบ HIS อยู่แล้ว จึงไม่ generate/push migration ใส่
export default defineConfig({
  dialect: 'mysql',
  schema: './lib/db/schema/his.ts',
  out: './drizzle/his',
  dbCredentials: hisConfig,
})
