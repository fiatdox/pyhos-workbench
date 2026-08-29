import 'server-only'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { coreKonConfig } from './env'
import * as schema from './schema/core-kon'

// เก็บ client ไว้บน globalThis เพื่อไม่ให้ dev hot-reload เปิด connection ใหม่ทุกครั้ง
const globalForCoreKon = globalThis as unknown as { coreKonClient?: postgres.Sql }

const client =
  globalForCoreKon.coreKonClient ??
  postgres({
    host: coreKonConfig.host,
    port: coreKonConfig.port,
    user: coreKonConfig.user,
    password: coreKonConfig.password,
    database: coreKonConfig.database,
    max: 10,
    // ตั้ง search_path ให้ตรง schema ที่ใช้จริง
    connection: { search_path: `${coreKonConfig.schema},public` },
  })

if (process.env.NODE_ENV !== 'production') globalForCoreKon.coreKonClient = client

/** ฐานข้อมูล CoreKon (PostgreSQL) — ผู้ใช้ สิทธิ์ และข้อมูล HRIS */
export const coreKonDb = drizzle(client, { schema })
