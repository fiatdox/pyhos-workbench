import { char, date, integer, pgSchema, smallint, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { coreKonConfig } from '../env'

/** ทุกตารางของ CoreKon อยู่ใต้ schema นี้ (ค่าเริ่มต้น: core_kon) */
export const coreKon = pgSchema(coreKonConfig.schema)

/**
 * core_kon.users — บัญชีผู้ใช้ระบบ
 * ตารางนี้มีอยู่แล้วในฐานข้อมูล (CoreKon/HRIS) จึงประกาศให้ตรงของจริงเท่านั้น
 * ห้าม generate migration ทับ
 */
export const users = coreKon.table('users', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  pname: varchar('pname', { length: 20 }),
  fname: varchar('fname', { length: 100 }).notNull(),
  lname: varchar('lname', { length: 100 }).notNull(),
  idCard: varchar('id_card', { length: 13 }),
  gender: varchar('gender', { length: 10 }),
  birthday: date('birthday'),
  hireDate: date('hire_date'),
  userTypeId: integer('user_type_id'),
  userPositionId: integer('user_position_id'),
  userLevelId: integer('user_level_id'),
  userStatusId: integer('user_status_id'),
  missionId: integer('mission_id'),
  majorId: integer('major_id'),
  submajorId: integer('submajor_id'),
  attendanceId: integer('attendance_id'),
  salaryId: integer('salary_id'),
  username: varchar('username', { length: 50 }).notNull(),
  /** แฮช argon2id (รูปแบบ PHC string) */
  password: varchar('password', { length: 255 }).notNull(),
  /** 'Y' = ใช้งานได้, อื่น ๆ = ถูกระงับ */
  isActive: char('is_active', { length: 1 }).notNull().default('Y'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  hospitalLcPid: smallint('hospital_lc_pid'),
  workEndDate: date('work_end_date'),
  passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
})

export type User = typeof users.$inferSelect

/** core_kon.auth_settings — ค่าตั้งระบบ auth (MFA / นโยบายรหัสผ่าน / นโยบายชื่อผู้ใช้) */
export const authSettings = coreKon.table('auth_settings', {
  name: varchar('name', { length: 60 }).primaryKey(),
  value: varchar('value', { length: 200 }),
  description: varchar('description', { length: 300 }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: integer('updated_by'),
})

/** core_kon.auth_mfa_users — รายชื่อผู้ใช้ที่ถูกบังคับ MFA (ใช้เมื่อ mfa_scope = users) */
export const authMfaUsers = coreKon.table('auth_mfa_users', {
  userId: integer('user_id').primaryKey(),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  addedBy: integer('added_by'),
})

/** core_kon.auth_otp_challenges — รอบยืนยัน OTP หนึ่งรอบต่อการล็อกอินหนึ่งครั้ง */
export const authOtpChallenges = coreKon.table('auth_otp_challenges', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  challengeToken: uuid('challenge_token').notNull().unique(),
  userId: integer('user_id').notNull(),
  /** แฮช argon2id ของรหัส OTP — ไม่เก็บรหัสดิบ */
  otpHash: text('otp_hash').notNull(),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  resendCount: integer('resend_count').notNull().default(0),
  /** หมดอายุของ "รหัส" ชุดปัจจุบัน */
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  /** หมดอายุของ "รอบ" ทั้งหมด — ขอรหัสใหม่กี่ครั้งก็ไม่เกินเวลานี้ */
  challengeExpiresAt: timestamp('challenge_expires_at', { withTimezone: true }).notNull(),
  lastSentAt: timestamp('last_sent_at', { withTimezone: true }).notNull().defaultNow(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  /** ตั้งเมื่อรอบถูกตัด (กรอกผิดครบจำนวน) */
  failedAt: timestamp('failed_at', { withTimezone: true }),
  clientIp: varchar('client_ip', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** core_kon.auth_mfa_audit — ร่องรอยเหตุการณ์ MFA (otp_sent / otp_verified / otp_wrong / otp_resent) */
export const authMfaAudit = coreKon.table('auth_mfa_audit', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  userId: integer('user_id'),
  username: varchar('username', { length: 100 }),
  event: varchar('event', { length: 40 }).notNull(),
  detail: varchar('detail', { length: 400 }),
  /** เวลาที่ใช้ยิง API หมอพร้อม (ms) */
  sendMs: integer('send_ms'),
  clientIp: varchar('client_ip', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** core_kon.user_roles */
export const userRoles = coreKon.table('user_roles', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  roleName: varchar('role_name').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }),
})

/** core_kon.user_m_users_roles — ตารางเชื่อมผู้ใช้กับ role */
export const userMUsersRoles = coreKon.table('user_m_users_roles', {
  userId: integer('user_id').notNull(),
  roleId: integer('role_id').notNull(),
  assignedAt: timestamp('assigned_at', { withTimezone: true }),
})

/** core_kon.user_positions */
export const userPositions = coreKon.table('user_positions', {
  userPositionId: integer('user_position_id').primaryKey().generatedByDefaultAsIdentity(),
  positionName: varchar('position_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }),
})

/** core_kon.majors — หน่วยงาน/กลุ่มงาน */
export const majors = coreKon.table('majors', {
  majorId: integer('major_id').primaryKey().generatedByDefaultAsIdentity(),
  missionId: integer('mission_id'),
  name: varchar('name').notNull(),
  supervisorId: integer('supervisor_id'),
  actingSupervisorId: integer('acting_supervisor_id'),
  isActive: char('is_active', { length: 1 }),
  createdAt: timestamp('created_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
})

/** core_kon.user_types */
export const userTypes = coreKon.table('user_types', {
  userTypeId: integer('user_type_id').primaryKey().generatedByDefaultAsIdentity(),
  typeName: varchar('type_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }),
})
