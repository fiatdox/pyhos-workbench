'use client'
import { createContext, useContext, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Avatar, Button, Descriptions, Divider, Drawer, Layout, Menu, Tag, Typography } from 'antd'
import {
  AuditOutlined,  DashboardOutlined,
  ExperimentOutlined,
  LogoutOutlined,
  MedicineBoxOutlined,
  MenuOutlined,
  ProfileOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { MotorcycleOutlined } from './icons'
import { ThemeSegmented, ThemeToggleButton, useTheme } from '@/app/theme'

const { Header, Content } = Layout
const { Text, Title } = Typography

/** สิทธิ์รายงานที่เซิร์ฟเวอร์คำนวณให้ ใช้ซ่อนเมนูของงานที่ผู้ใช้ไม่มีสิทธิ์
 *  การกันจริงอยู่ที่ layout และ API ฝั่งเซิร์ฟเวอร์ ตรงนี้แค่ไม่โชว์ทางเข้า */
export type ShellPermissions = { due: boolean }

export type ShellUser = {
  fullName: string
  username: string
  typeName: string | null
  positionName: string | null
  majorName: string | null
  mfaEnabled: boolean
  initials: string
}

/**
 * ข้อมูลผู้ใช้ที่กำลังล็อกอิน ส่งต่อให้หน้าลูกที่เป็น client component
 *
 * เดิมหน้าลูกอ่านจาก cookie user_data ซึ่งเป็น cookie ธรรมดาที่ JS อ่านได้
 * และมีข้อมูลระบุตัวตนอยู่ข้างใน ตอนนี้ home/layout.tsx ดึงจากฐานข้อมูล
 * แล้วส่งลงมาเป็น prop อยู่แล้ว จึงกระจายต่อผ่าน context แทน — ไม่ต้องมี
 * ข้อมูลผู้ใช้ค้างอยู่ในเบราว์เซอร์
 */
const SessionUserContext = createContext<ShellUser | null>(null)
const PermissionsContext = createContext<ShellPermissions>({ due: true })

export function useSessionUser(): ShellUser | null {
  return useContext(SessionUserContext)
}

/** สิทธิ์ของผู้ใช้ที่ล็อกอินอยู่ — หน้าลูกใช้ซ่อนการ์ดของงานที่เข้าไม่ได้ */
export function usePermissions(): ShellPermissions {
  return useContext(PermissionsContext)
}

/** เมนูของระบบ — key คือ path จริง กดแล้วพาไปหน้านั้นเลย */
export const MENU_ITEMS = [
  { key: '/home', icon: <DashboardOutlined />, label: 'หน้าแรก' },
  { key: '/home/medication-history', icon: <MedicineBoxOutlined />, label: 'ประวัติการได้รับยา' },
  { key: '/home/hla-b5801', icon: <ExperimentOutlined />, label: 'ผลตรวจ HLA-B*5801' },
  { key: '/home/drug-profile', icon: <ProfileOutlined />, label: 'Drug Profile ผู้ป่วยใน' },
  { key: '/home/due', icon: <AuditOutlined />, label: 'DUE ขออนุมัติใช้ยา' },
  { key: '/home/health-rider', icon: <MotorcycleOutlined />, label: 'Health Rider' },
]

export default function AppShell({
  user,
  permissions,
  children,
}: {
  user: ShellUser
  permissions: ShellPermissions
  children: ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const { mode } = useTheme()
  const [menuOpen, setMenuOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)

  const logout = async () => {
    if (leaving) return
    setLeaving(true)
    try {
      // เซิร์ฟเวอร์เป็นผู้ล้าง cookie ให้ — auth_token เป็น httpOnly แล้ว
      // JS ลบเองไม่ได้ ถ้า request นี้ไม่ถึงปลายทาง เซสชันจะยังไม่ถูกล้าง
      // keepalive: ให้ request รอดแม้เบราว์เซอร์เริ่มเปลี่ยนหน้าไปแล้ว
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        keepalive: true,
      })
    } catch (error) {
      // ถึงตรงนี้แปลว่า cookie อาจยังอยู่ — ใช้ replace ทั้งหน้าแทน router
      // เพื่อบังคับให้เซิร์ฟเวอร์ตรวจ cookie ใหม่ ไม่ใช่แค่เปลี่ยนหน้าฝั่ง client
      console.error('[logout] แจ้งเซิร์ฟเวอร์ไม่สำเร็จ:', error)
      window.location.replace('/')
      return
    }
    router.replace('/')
    router.refresh()
  }

  return (
    // ห้ามใส่ overflow-hidden ที่ตัวนี้ — จะทำให้ Header ที่เป็น sticky ไม่ติดขอบบน
    // (ancestor ที่ overflow ไม่ใช่ visible จะกลายเป็น scroll container ของ sticky
    //  แต่ตัวมันเองไม่ได้เลื่อน หัวข้อจึงเลื่อนหายไปกับหน้า) การตัดขอบแสงพื้นหลัง
    // ทำที่ชั้น absolute ข้างล่างซึ่ง overflow-hidden ของมันเองอยู่แล้ว
    <div className="relative min-h-screen w-full bg-background text-foreground selection:bg-accent-soft">
      {/* พื้นหลังโทนม่วงชุดเดียวกับหน้าเข้าสู่ระบบ — สีมาจาก token ตามธีม */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 h-120 w-120 rounded-full bg-(--glow-1) blur-[150px]" />
        <div className="absolute top-1/4 -right-40 h-130 w-130 rounded-full bg-(--glow-2) blur-[170px]" />
        <div
          className="absolute inset-0"
          style={{
            opacity: 'var(--grid-opacity)',
            backgroundImage:
              'linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px)',
            backgroundSize: '56px 56px',
          }}
        />
      </div>

      <Layout className="relative z-10 min-h-screen bg-transparent">
        {/* ───────────── Navbar ───────────── */}
        <Header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-line bg-bar px-4 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Button
              type="text"
              aria-label="เปิดเมนูระบบ"
              icon={<MenuOutlined />}
              onClick={() => setMenuOpen(true)}
              className="text-ink-2! hover:text-ink!"
            />
            <Link href="/home" className="flex items-center gap-2.5">
              <span className="hidden text-base font-semibold tracking-[0.16em] text-ink sm:inline">
                PYHOS WORKBENCH
              </span>
              <span className="text-base font-semibold tracking-[0.16em] text-ink sm:hidden">PYHOS</span>
            </Link>
          </div>

          <div className="flex items-center gap-1.5">
            {/* สลับธีมได้จากทุกหน้า ไม่ต้องเปิดเมนูก่อน */}
            <ThemeToggleButton />
            <button
              type="button"
              onClick={() => setProfileOpen(true)}
              aria-label="ข้อมูลผู้ใช้งาน"
              className="flex items-center gap-2.5 rounded-full border border-line py-1 pl-3 pr-1 transition hover:border-accent"
            >
              <span className="hidden text-xs text-ink-2 sm:inline">{user.fullName}</span>
              <Avatar style={{ backgroundColor: '#6d28d9' }} size={32}>
                {user.initials || <UserOutlined />}
              </Avatar>
            </button>
          </div>
        </Header>

        {/* ───────────── Drawer ซ้าย: เมนูระบบ ───────────── */}
        <Drawer
          title="เมนูระบบ"
          placement="left"
          size={280}
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          styles={{ body: { padding: 0 } }}
        >
          <Menu
            mode="inline"
            theme={mode}
            selectedKeys={[pathname]}
            onClick={() => setMenuOpen(false)}
            style={{ background: 'transparent', borderInlineEnd: 'none' }}
            // งาน DUE เห็นเฉพาะตำแหน่งที่กำหนดไว้ใน .env — เอาออกจากเมนูไปเลย
            // ดีกว่าโชว์แล้วกดไปเจอเด้งกลับ
            items={MENU_ITEMS.filter(item => permissions.due || item.key !== '/home/due').map(item => ({
              key: item.key,
              icon: item.icon,
              label: <Link href={item.key}>{item.label}</Link>,
            }))}
          />

          {/* ตัวเลือกโทนสี — วางท้ายเมนู ไม่ปะปนกับรายการหน้าจอ
              ไม่ปิดลิ้นชักตอนกด จะได้เห็นผลทันทีแล้วเลือกซ้ำได้ */}
          <div className="border-t border-line px-4 py-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">
              โทนสี
            </div>
            <ThemeSegmented />
          </div>
        </Drawer>

        {/* ───────────── Drawer ขวา: ข้อมูลผู้ใช้งาน ───────────── */}
        <Drawer
          title="ข้อมูลผู้ใช้งาน"
          placement="right"
          size={320}
          open={profileOpen}
          onClose={() => setProfileOpen(false)}
        >
          <div className="flex flex-col items-center gap-2 pb-2 text-center">
            <Avatar style={{ backgroundColor: '#6d28d9' }} size={64}>
              {user.initials || <UserOutlined />}
            </Avatar>
            <Title level={5} style={{ margin: 0 }}>{user.fullName}</Title>
            <Text type="secondary">{user.username}</Text>
            {user.mfaEnabled && (
              <Tag icon={<SafetyCertificateOutlined />} color="purple">
                ยืนยัน 2 ชั้นผ่าน Line หมอพร้อม
              </Tag>
            )}
          </div>

          <Divider />

          <Descriptions column={1} size="small" colon={false}>
            <Descriptions.Item label="ประเภทบุคลากร">{user.typeName ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="ตำแหน่ง">{user.positionName ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="หน่วยงาน">{user.majorName ?? '—'}</Descriptions.Item>
          </Descriptions>

          <Divider />

          <Button
            danger
            block
            icon={<LogoutOutlined />}
            loading={leaving}
            onClick={logout}
          >
            {leaving ? 'กำลังออกจากระบบ...' : 'ออกจากระบบ'}
          </Button>
        </Drawer>

        {/* เต็มความกว้างจอ — ตารางประวัติยามีคอลัมน์เยอะ ยิ่งกว้างยิ่งเห็นหลายครั้งที่รับยาพร้อมกัน */}
        <Content className="w-full px-4 py-8 sm:px-6 lg:px-8">
          <SessionUserContext.Provider value={user}>
            <PermissionsContext.Provider value={permissions}>{children}</PermissionsContext.Provider>
          </SessionUserContext.Provider>
        </Content>
      </Layout>
    </div>
  )
}
