'use client'
import { withBase } from '@/lib/base-path'
import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Avatar, Button, Descriptions, Divider, Drawer, Menu, Tag, Tooltip, Typography } from 'antd'
import {
  ApartmentOutlined,
  DashboardOutlined,
  ExperimentOutlined,
  HeartOutlined,
  LogoutOutlined,
  MedicineBoxOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  PartitionOutlined,
  ProfileOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { MotorcycleOutlined } from './icons'
import { BrandMark } from '@/app/brand-mark'
import { ThemeSegmented, ThemeToggleButton, useTheme } from '@/app/theme'

const { Text, Title } = Typography

/** สีพื้นของรูปโปรไฟล์ — ม่วงเข้มเดียวกันทั้งสองธีม ตัวอักษรขาวบนนี้ได้ 7.1:1 */
const AVATAR_BG = '#6d28d9'

/** สิทธิ์รายงานที่เซิร์ฟเวอร์คำนวณให้ ใช้ซ่อนเมนูของงานที่ผู้ใช้ไม่มีสิทธิ์
 *  การกันจริงอยู่ที่ layout และ API ฝั่งเซิร์ฟเวอร์ ตรงนี้แค่ไม่โชว์ทางเข้า */
export type ShellPermissions = {
  rdu: boolean
  audit: boolean
  /** ตั้งค่า Health Rider ได้ไหม — เฉพาะหัวหน้ากลุ่มงานเภสัชกรรม */
  riderAdmin: boolean
}

/** งานที่จำกัดสิทธิ์ตามตำแหน่ง — ชื่อตรงกับคีย์ใน ShellPermissions */
export type RestrictedFeature = keyof ShellPermissions

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
// ค่าตั้งต้นของ audit เป็น false ต่างจาก RDU — ถ้า Provider หลุดไปด้วย
// เหตุใดก็ตาม เมนูของงานทั่วไปหายไปยังแค่กวนใจ แต่เมนูดูร่องรอยโผล่ให้ทุกคน
// เห็นคือการรั่วของข้อมูลที่บอกว่าใครเปิดดูคนไข้คนไหน
const PermissionsContext = createContext<ShellPermissions>({
  rdu: true,
  audit: false,
  riderAdmin: false,
})

export function useSessionUser(): ShellUser | null {
  return useContext(SessionUserContext)
}

/** สิทธิ์ของผู้ใช้ที่ล็อกอินอยู่ — หน้าลูกใช้ซ่อนการ์ดของงานที่เข้าไม่ได้ */
export function usePermissions(): ShellPermissions {
  return useContext(PermissionsContext)
}

/** เมนูของระบบ — key คือ path จริง กดแล้วพาไปหน้านั้นเลย
 *  feature = งานที่จำกัดตามตำแหน่ง ไม่ใส่ = ทุกคนที่เข้าระบบได้เห็น */
/**
 * รายการหน้าจอของระบบ — ใช้ทั้งเมนูในลิ้นชักซ้ายและการ์ดบนหน้าแรก
 *
 * เดิมหน้าแรกถือรายการของตัวเองแยกไว้ โดยมีคอมเมนต์กำกับว่าให้เพิ่มทั้งสองที่
 * พร้อมกัน — ซึ่งถูกมองข้ามมาสามรอบ (ร่องรอยการใช้งาน · ผังระบบ · Service Plan
 * ขึ้นเมนูแล้วแต่ไม่มีการ์ด) รายการจึงมาอยู่ที่เดียว และ desc เป็นฟิลด์บังคับ
 * เมนูใหม่ที่ลืมใส่คำอธิบายจะคอมไพล์ไม่ผ่าน ไม่ใช่หลุดจากหน้าแรกไปเงียบ ๆ
 */
export const MENU_ITEMS: {
  key: string
  icon: ReactNode
  label: string
  /** คำอธิบายใต้ชื่อเมนูบนการ์ดหน้าแรก — บังคับให้มีทุกเมนู ดูเหตุผลด้านบน */
  desc: string
  feature?: RestrictedFeature
}[] = [
  {
    key: '/home',
    icon: <DashboardOutlined />,
    label: 'หน้าแรก',
    desc: 'รวมทุกเมนูที่ท่านมีสิทธิ์ใช้งานไว้เป็นการ์ดให้เลือก',
  },
  {
    key: '/home/medication-history',
    icon: <MedicineBoxOutlined />,
    label: 'ประวัติการได้รับยา',
    desc: 'ดูรายการยาที่ผู้ป่วยเคยได้รับ ย้อนหลังตามช่วงเวลา พร้อมชื่อยาและวันที่จ่าย',
  },
  {
    key: '/home/hla-b5801',
    icon: <ExperimentOutlined />,
    label: 'ผลตรวจ HLA-B*5801 / 1502',
    desc: 'ผู้ป่วยที่รายงานผล HLA-B*5801 หรือ HLA-B*1502 แล้ว ค้นตามช่วงวันที่และเปิดดูรูปใบรายงาน',
  },
  {
    key: '/home/drug-profile',
    icon: <ProfileOutlined />,
    label: 'Drug Profile ผู้ป่วยใน',
    desc: 'ตรวจสอบการให้ยาของผู้ป่วยใน รายบุคคลตลอดการนอนโรงพยาบาล',
  },
  {
    key: '/home/rdu',
    icon: <SafetyCertificateOutlined />,
    label: 'RDU ตัวชี้วัดการใช้ยา',
    desc: 'ติดตามตัวชี้วัดการใช้ยาอย่างสมเหตุผล และตั้งค่าทะเบียนรายการยาของแต่ละตัวชี้วัด',
    feature: 'rdu',
  },
  {
    key: '/home/checkup',
    icon: <HeartOutlined />,
    label: 'ตรวจสุขภาพ',
    desc: 'เลือกสิทธิการรักษากับช่วงวันที่ แล้วได้รายชื่อผู้ที่มารับบริการด้วยสิทธินั้น พร้อมยอดสรุปแยกตามสิทธิ',
  },
  {
    key: '/home/health-rider',
    icon: <MotorcycleOutlined />,
    label: 'Health Rider',
    desc: 'ยังไม่ระบุขอบเขตงาน — เปิดหน้าไว้รอออกแบบ',
  },
  {
    key: '/home/service-plan',
    icon: <ApartmentOutlined />,
    label: 'Service Plan',
    desc: 'ตัวชี้วัดตามแผนพัฒนาระบบบริการสุขภาพ — Stroke, Sepsis, COPD และสาขาโรคหัวใจ ย้อนหลังห้าปีงบ',
  },
  {
    key: '/home/diagram',
    icon: <PartitionOutlined />,
    label: 'ผังระบบ',
    desc: 'ผังสี่ใบที่อธิบายว่าระบบต่อกับอะไร ข้อมูลผู้ป่วยถูกกันไว้ที่ไหน และงานแต่ละอย่างเดินอย่างไร',
  },
  {
    key: '/home/admin/activity',
    icon: <SafetyCertificateOutlined />,
    label: 'ร่องรอยการใช้งาน',
    desc: 'ร่องรอยว่าใครเปิดดูข้อมูลอะไรเมื่อไร สำหรับผู้ที่ต้องรับผิดชอบการใช้ข้อมูลผู้ป่วย',
    feature: 'audit',
  },
]

/**
 * เมนูที่ตรงกับหน้าปัจจุบัน — เลือก key ที่ยาวที่สุดที่เป็นต้นทางของ path
 * หน้าลูกอย่าง /home/rdu/reports/ed จึงยังไฮไลต์เมนู RDU ไว้ (เดิมเทียบตรงตัว
 * หน้าลูกทุกหน้าเลยไม่มีเมนูไหนถูกเลือก) ส่วน /home ต้องตรงตัวเท่านั้น
 */
function activeMenuItem(pathname: string) {
  let best: (typeof MENU_ITEMS)[number] | undefined
  for (const item of MENU_ITEMS) {
    const hit =
      item.key === '/home' ? pathname === '/home' : pathname === item.key || pathname.startsWith(`${item.key}/`)
    if (hit && (!best || item.key.length > best.key.length)) best = item
  }
  return best
}

/* ── สถานะย่อเมนูข้าง — จำไว้ในเบราว์เซอร์ ──
   อ่านผ่าน useSyncExternalStore: ฝั่งเซิร์ฟเวอร์ถือว่าไม่ย่อเสมอ แล้ว React สลับ
   เป็นค่าจริงหลัง hydrate เอง ไม่ต้อง setState ใน effect และไม่ hydrate ไม่ตรง */
const SIDEBAR_KEY = 'pyhos-sidebar-collapsed'
const sidebarListeners = new Set<() => void>()

function subscribeSidebar(onChange: () => void) {
  sidebarListeners.add(onChange)
  return () => {
    sidebarListeners.delete(onChange)
  }
}

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1'
  } catch {
    return false
  }
}

function writeSidebarCollapsed(next: boolean) {
  try {
    localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0')
  } catch {
    // โหมดส่วนตัว/ปิดการเก็บข้อมูลเว็บ — ย่อได้ตามปกติ แค่ไม่จำข้ามรอบ
  }
  sidebarListeners.forEach(listener => listener())
}

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
  const collapsed = useSyncExternalStore(subscribeSidebar, readSidebarCollapsed, () => false)

  const current = activeMenuItem(pathname)
  // งานที่จำกัดสิทธิ์ (RDU ตามตำแหน่งใน .env, ร่องรอยตาม role) — เอาออกจากเมนูไปเลย
  // ดีกว่าโชว์แล้วกดไปเจอเด้งกลับ
  const menuItems = MENU_ITEMS.filter(item => !item.feature || permissions[item.feature]).map(item => ({
    key: item.key,
    icon: item.icon,
    label: <Link href={item.key}>{item.label}</Link>,
  }))

  const logout = async () => {
    if (leaving) return
    setLeaving(true)
    try {
      // เซิร์ฟเวอร์เป็นผู้ล้าง cookie ให้ — auth_token เป็น httpOnly แล้ว
      // JS ลบเองไม่ได้ ถ้า request นี้ไม่ถึงปลายทาง เซสชันจะยังไม่ถูกล้าง
      // keepalive: ให้ request รอดแม้เบราว์เซอร์เริ่มเปลี่ยนหน้าไปแล้ว
      await fetch(withBase('/api/auth/logout'), {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        keepalive: true,
      })
    } catch (error) {
      // ถึงตรงนี้แปลว่า cookie อาจยังอยู่ — ใช้ replace ทั้งหน้าแทน router
      // เพื่อบังคับให้เซิร์ฟเวอร์ตรวจ cookie ใหม่ ไม่ใช่แค่เปลี่ยนหน้าฝั่ง client
      console.error('[logout] แจ้งเซิร์ฟเวอร์ไม่สำเร็จ:', error)
      window.location.replace(withBase('/'))
      return
    }
    router.replace('/')
    router.refresh()
  }

  return (
    // ห้ามใส่ overflow-hidden ที่ชั้นนอก — จะทำให้แถบบนและเมนูข้างที่เป็น sticky
    // ไม่ติดขอบ (ancestor ที่ overflow ไม่ใช่ visible จะกลายเป็น scroll container
    // ของ sticky แต่ตัวมันเองไม่ได้เลื่อน ทั้งสองจึงเลื่อนหายไปกับหน้า)
    <div className="flex min-h-screen w-full bg-background text-foreground selection:bg-accent-soft">
      {/* ───────────── เมนูข้าง (จอกว้างตั้งแต่ lg) ─────────────
          เดิมเมนูซ่อนอยู่ในลิ้นชักทุกขนาดจอ ต้องกดสองครั้งทุกครั้งที่ย้ายหน้า
          บนจอทำงานจึงวางไว้ถาวร และย่อเหลือแถบไอคอนได้เมื่อต้องการความกว้างให้ตาราง */}
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line bg-bar transition-[width] duration-200 motion-reduce:transition-none lg:flex ${
          collapsed ? 'w-16' : 'w-60'
        }`}
      >
        <Link
          href="/home"
          className={`flex h-14 shrink-0 items-center gap-2.5 border-b border-line ${collapsed ? 'justify-center' : 'px-4'}`}
          aria-label="PYHOS Workbench หน้าแรก"
        >
          <BrandMark size={28} />
          {!collapsed && (
            <span className="truncate text-sm font-semibold tracking-[0.14em] text-ink">PYHOS WORKBENCH</span>
          )}
        </Link>

        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2" aria-label="เมนูระบบ">
          <Menu
            mode="inline"
            theme={mode}
            inlineCollapsed={collapsed}
            selectedKeys={current ? [current.key] : []}
            style={{ background: 'transparent', borderInlineEnd: 'none' }}
            items={menuItems}
          />
        </nav>

        <div className={`shrink-0 border-t border-line p-2 ${collapsed ? 'flex justify-center' : ''}`}>
          <Tooltip title={collapsed ? 'ขยายเมนู' : undefined} placement="right">
            <Button
              type="text"
              block={!collapsed}
              aria-label={collapsed ? 'ขยายเมนู' : 'ย่อเมนู'}
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => writeSidebarCollapsed(!collapsed)}
              className="justify-start! text-ink-3! hover:text-ink!"
            >
              {!collapsed && 'ย่อเมนู'}
            </Button>
          </Tooltip>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ───────────── แถบบน ───────────── */}
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-bar px-3 sm:px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-2">
            {/* จอเล็กไม่มีเมนูข้าง — เปิดลิ้นชักแทน */}
            <Button
              type="text"
              aria-label="เปิดเมนูระบบ"
              icon={<MenuOutlined />}
              onClick={() => setMenuOpen(true)}
              className="text-ink-2! hover:text-ink! lg:hidden!"
            />
            <Link href="/home" className="flex items-center gap-2 lg:hidden" aria-label="PYHOS Workbench หน้าแรก">
              <BrandMark size={26} />
              <span className="hidden text-sm font-semibold tracking-[0.14em] text-ink sm:inline">PYHOS WORKBENCH</span>
            </Link>
            {/* จอกว้างมีชื่อระบบอยู่บนเมนูข้างแล้ว แถบบนจึงบอกว่าอยู่หน้าไหนแทน */}
            {current && (
              <div className="hidden min-w-0 items-center gap-2 text-sm text-ink-2 lg:flex">
                <span className="text-accent">{current.icon}</span>
                <span className="truncate font-medium">{current.label}</span>
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {/* สลับธีมได้จากทุกหน้า ไม่ต้องเปิดเมนูก่อน */}
            <ThemeToggleButton />
            <button
              type="button"
              onClick={() => setProfileOpen(true)}
              aria-label="ข้อมูลผู้ใช้งาน"
              className="flex cursor-pointer items-center gap-2 rounded-full border border-line py-0.5 pl-3 pr-0.5 transition-colors hover:border-accent-line hover:bg-accent-soft"
            >
              <span className="hidden max-w-48 truncate text-xs text-ink-2 sm:inline">{user.fullName}</span>
              <Avatar style={{ backgroundColor: AVATAR_BG }} size={30}>
                {user.initials || <UserOutlined />}
              </Avatar>
            </button>
          </div>
        </header>

        {/* ───────────── Drawer ซ้าย: เมนูระบบ (จอเล็ก) ───────────── */}
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
            selectedKeys={current ? [current.key] : []}
            onClick={() => setMenuOpen(false)}
            style={{ background: 'transparent', borderInlineEnd: 'none', paddingBlock: 8 }}
            items={menuItems}
          />

          {/* ตัวเลือกโทนสี — วางท้ายเมนู ไม่ปะปนกับรายการหน้าจอ
              ไม่ปิดลิ้นชักตอนกด จะได้เห็นผลทันทีแล้วเลือกซ้ำได้ */}
          <div className="border-t border-line px-4 py-4">
            <div className="mb-2 text-xs font-semibold text-ink-3">โทนสี</div>
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
            <Avatar style={{ backgroundColor: AVATAR_BG }} size={64}>
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

        {/* เต็มความกว้างที่เหลือ — ตารางประวัติยามีคอลัมน์เยอะ ยิ่งกว้างยิ่งเห็นหลายครั้งที่รับยาพร้อมกัน */}
        <main className="w-full min-w-0 flex-1 px-3 py-5 sm:px-4 lg:px-6 lg:py-6">
          <SessionUserContext.Provider value={user}>
            <PermissionsContext.Provider value={permissions}>{children}</PermissionsContext.Provider>
          </SessionUserContext.Provider>
        </main>
      </div>
    </div>
  )
}
