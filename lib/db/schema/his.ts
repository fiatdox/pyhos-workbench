// ตาราง HIS (MariaDB) — ฐานข้อมูลมีอยู่แล้ว ไม่ได้สร้างจาก migration
// ดึงโครงสร้างจริงมาเขียนทับไฟล์นี้ได้ด้วย:  bun run db:pull:his
// ระหว่างนี้ประกาศเฉพาะตารางที่ใช้จริงทีละตัวได้เลย เช่น
//
// import { mysqlTable, varchar, date } from 'drizzle-orm/mysql-core'
//
// export const patient = mysqlTable('patient', {
//   hn: varchar('hn', { length: 9 }).primaryKey(),
//   firstName: varchar('fname', { length: 100 }),
//   birthday: date('birthday'),
// })

export {}
