import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { coreKonDb } from '@/lib/db/core-kon'
import { authMfaUsers, majors, userPositions, userTypes, users } from '@/lib/db/schema/core-kon'
import { canUseDue, isPositionAllowed } from '@/lib/auth/access'
import { verifyAuthToken } from '@/lib/auth/jwt'
import AppShell from './app-shell'

// ต้องอ่าน cookie ทุกครั้ง — ห้ามแคชส่วนนี้
export const dynamic = 'force-dynamic'

export default async function HomeLayout({ children }: LayoutProps<'/home'>) {
  const token = (await cookies()).get('auth_token')?.value
  const claims = token ? await verifyAuthToken(token) : null
  // ไม่มี token / token เสีย / หมดอายุ → กลับไปหน้าเข้าสู่ระบบ
  if (!claims?.sub) redirect('/?expired=1')

  const [user] = await coreKonDb
    .select({
      pname: users.pname,
      fname: users.fname,
      lname: users.lname,
      username: users.username,
      isActive: users.isActive,
      userPositionId: users.userPositionId,
      typeName: userTypes.typeName,
      positionName: userPositions.positionName,
      majorName: majors.name,
      mfaUserId: authMfaUsers.userId,
    })
    .from(users)
    .leftJoin(userTypes, eq(userTypes.userTypeId, users.userTypeId))
    .leftJoin(userPositions, eq(userPositions.userPositionId, users.userPositionId))
    .leftJoin(majors, eq(majors.majorId, users.majorId))
    .leftJoin(authMfaUsers, eq(authMfaUsers.userId, users.id))
    .where(eq(users.id, Number(claims.sub)))
    .limit(1)

  // บัญชีถูกลบหรือถูกระงับหลังออก token → ตัดออกจากระบบทันที
  // ไม่ใช้ expired=1 เพราะไม่ใช่เรื่องเซสชันหมดอายุ ข้อความจะทำให้เข้าใจผิด
  if (!user || user.isActive !== 'Y') redirect('/')

  // ตรวจตำแหน่งทุกครั้งที่เปิดหน้า ไม่ใช่ตอนล็อกอินอย่างเดียว — token มีอายุหลายชั่วโมง
  // ถ้าตรวจแค่ตอนเข้าระบบ คนที่ถูกถอดสิทธิ์ (หรือถูกตัดออกจากรายการใน .env)
  // จะใช้งานต่อได้จนกว่า token จะหมดอายุ เหตุผลที่เด้งกลับหน้าเข้าสู่ระบบเฉย ๆ
  // คือถ้าล็อกอินใหม่ /api/auth/login จะอธิบายให้เองว่าติดเรื่องสิทธิ์
  if (!isPositionAllowed(user.userPositionId)) redirect('/')

  return (
    <AppShell
      // สิทธิ์คำนวณที่นี่ที่เดียวแล้วส่งลงไป หน้าลูกจึงไม่ต้องรู้กติกาเอง
      permissions={{ due: canUseDue(user.userPositionId) }}
      user={{
        fullName: [user.pname, user.fname, user.lname].filter(Boolean).join(' '),
        username: user.username,
        typeName: user.typeName,
        positionName: user.positionName,
        majorName: user.majorName,
        mfaEnabled: Boolean(user.mfaUserId),
        initials: (user.fname?.[0] ?? '') + (user.lname?.[0] ?? ''),
      }}
    >
      {children}
    </AppShell>
  )
}
