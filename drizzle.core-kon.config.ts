import { defineConfig } from 'drizzle-kit'
import { coreKonConfig } from './lib/db/env'

// CoreKon (PostgreSQL) — จำกัดขอบเขตไว้เฉพาะ schema ที่กำหนดใน CORE_KON_SCHEMA
export default defineConfig({
  dialect: 'postgresql',
  schema: './lib/db/schema/core-kon.ts',
  out: './drizzle/core-kon',
  schemaFilter: [coreKonConfig.schema],
  dbCredentials: {
    host: coreKonConfig.host,
    port: coreKonConfig.port,
    user: coreKonConfig.user,
    password: coreKonConfig.password,
    database: coreKonConfig.database,
    ssl: false,
  },
})
