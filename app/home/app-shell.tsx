'use client'
import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import Cookies from 'js-cookie'
import { Avatar, Button, Descriptions, Divider, Drawer, Layout, Menu, Tag, Typography } from 'antd'
import {
  DashboardOutlined,
  ExperimentOutlined,
  LogoutOutlined,
  MedicineBoxOutlined,
  MenuOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
} from '@ant-design/icons'

const { Header, Content } = Layout
const { Text, Title } = Typography

export type ShellUser = {
  fullName: string
  username: string
  typeName: string | null
  positionName: string | null
  majorName: string | null
  mfaEnabled: boolean
  initials: string
}

/** เมนูของระบบ — key คือ path จริง กดแล้วพาไปหน้านั้นเลย */
export const MENU_ITEMS = [
  { key: '/home', icon: <DashboardOutlined />, label: 'หน้าแรก' },
  { key: '/home/medication-history', icon: <MedicineBoxOutlined />, label: 'ประวัติการได้รับยา' },
  { key: '/home/hla-b5801', icon: <ExperimentOutlined />, label: 'ผลตรวจ HLA-B*5801' },
]

export default function AppShell({ user, children }: { user: ShellUser; children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)

  const logout = async () => {
    if (leaving) return
    setLeaving(true)
    try {
      // แจ้งฝั่งเซิร์ฟเวอร์ก่อนล้าง cookie — ไม่งั้นเซิร์ฟเวอร์จะไม่รู้ว่าใครออก
      // keepalive: ให้ request รอดแม้เบราว์เซอร์เริ่มเปลี่ยนหน้าไปแล้ว
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        keepalive: true,
      })
    } catch (error) {
      // แจ้งเตือนล้มก็ยังต้องออกจากระบบให้ได้ — แต่ให้เห็นสาเหตุใน console
      console.error('[logout] แจ้งเซิร์ฟเวอร์ไม่สำเร็จ:', error)
    }
    Cookies.remove('auth_token')
    Cookies.remove('user_data')
    Cookies.remove('user_type_id')
    router.replace('/')
    router.refresh()
  }

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#0c0716] text-slate-200 selection:bg-violet-500/30">
      {/* พื้นหลังโทนม่วงชุดเดียวกับหน้าเข้าสู่ระบบ */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 h-120 w-120 rounded-full bg-violet-600/20 blur-[150px]" />
        <div className="absolute top-1/4 -right-40 h-130 w-130 rounded-full bg-purple-500/15 blur-[170px]" />
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
            backgroundSize: '56px 56px',
          }}
        />
      </div>

      <Layout className="relative z-10 min-h-screen bg-transparent">
        {/* ───────────── Navbar ───────────── */}
        <Header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-white/10 bg-[#0c0716]/80 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Button
              type="text"
              aria-label="เปิดเมนูระบบ"
              icon={<MenuOutlined />}
              onClick={() => setMenuOpen(true)}
              className="text-slate-300! hover:text-white!"
            />
            <Link href="/home" className="flex items-center gap-2.5">
              <span className="hidden text-base font-semibold tracking-[0.16em] text-white sm:inline">
                PYHOS WORKBENCH
              </span>
              <span className="text-base font-semibold tracking-[0.16em] text-white sm:hidden">PYHOS</span>
            </Link>
          </div>

          <button
            type="button"
            onClick={() => setProfileOpen(true)}
            aria-label="ข้อมูลผู้ใช้งาน"
            className="flex items-center gap-2.5 rounded-full border border-white/10 py-1 pl-3 pr-1 transition hover:border-violet-300/40"
          >
            <span className="hidden text-xs text-slate-300 sm:inline">{user.fullName}</span>
            <Avatar style={{ backgroundColor: '#6d28d9' }} size={32}>
              {user.initials || <UserOutlined />}
            </Avatar>
          </button>
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
            theme="dark"
            selectedKeys={[pathname]}
            onClick={() => setMenuOpen(false)}
            style={{ background: 'transparent', borderInlineEnd: 'none' }}
            items={MENU_ITEMS.map(item => ({
              key: item.key,
              icon: item.icon,
              label: <Link href={item.key}>{item.label}</Link>,
            }))}
          />
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
        <Content className="w-full px-4 py-8 sm:px-6 lg:px-8">{children}</Content>
      </Layout>
    </div>
  )
}
