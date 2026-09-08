'use client'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { Button, Segmented, Tooltip } from 'antd'
import { MoonOutlined, SunOutlined } from '@ant-design/icons'

// ค่าคงที่ของธีมอยู่ใน theme-config.ts เพราะ root layout (Server Component)
// ต้องเรียก normalizeMode ได้จริง — ฟังก์ชันที่ export จากไฟล์ 'use client'
// จะกลายเป็น client reference เรียกจากฝั่งเซิร์ฟเวอร์ไม่ได้
import { DEFAULT_MODE, THEME_KEY, themeCookie, type ThemeMode } from './theme-config'

export type { ThemeMode }

/** แหล่งความจริงของธีมคือ data-theme บน <html> ไม่ใช่ state ของ React
 *  (root layout ตั้งค่าจากคุกกี้ตั้งแต่ฝั่งเซิร์ฟเวอร์) จึงอ่านผ่าน
 *  useSyncExternalStore แทนการ setState ใน effect — ไม่มีเรนเดอร์ซ้อน
 *
 *  ค่าฝั่งเซิร์ฟเวอร์มาจากคุกกี้ ไม่ใช่ค่าคงที่ 'dark' — ถ้าฝืนคืน 'dark' ให้ทุกคน
 *  ผู้ใช้ธีมสว่างจะ hydrate ไม่ตรง เพราะ antd สร้างคลาสและสไตล์จาก algorithm
 *  คนละชุดกับที่เซิร์ฟเวอร์ส่งมา (React ฟ้องว่า "won't be patched up") */
const listeners = new Set<() => void>()

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

function readMode(): ThemeMode {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

function applyMode(next: ThemeMode) {
  document.documentElement.dataset.theme = next
  // คุกกี้เขียนก่อน localStorage — ถ้าเบราว์เซอร์บล็อกที่เก็บข้อมูลเว็บ อย่างน้อย
  // เซิร์ฟเวอร์ยังเรนเดอร์ธีมถูกในรอบถัดไป
  document.cookie = themeCookie(next)
  try {
    localStorage.setItem(THEME_KEY, next)
  } catch {
    // โหมดส่วนตัว/ปิดการเก็บข้อมูลเว็บ — สลับได้ตามปกติ แค่ไม่จำข้ามรอบ
  }
  listeners.forEach(listener => listener())
}

type ThemeContextValue = {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: DEFAULT_MODE,
  setMode: () => {},
  toggle: () => {},
})

export function useTheme() {
  return useContext(ThemeContext)
}

/** ธีมที่ควรใช้จริงบนเครื่องนี้ — ค่าที่เคยเลือกไว้ก่อน ถ้าไม่เคยเลือกใช้ค่าของเครื่อง */
function preferredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // โหมดส่วนตัว/ปิดการเก็บข้อมูลเว็บ — ตกไปใช้ค่าของเครื่อง
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

/**
 * initialMode มาจากคุกกี้ที่ root layout อ่านให้ — ใช้เป็นค่าตอน SSR และตอน
 * hydrate เพื่อให้สองฝั่งเรนเดอร์ธีมเดียวกัน หลัง hydrate เสร็จค่าจริงมาจาก
 * data-theme บน <html> ตามปกติ
 *
 * ผู้ใช้ที่เข้าครั้งแรก (ยังไม่มีคุกกี้) เซิร์ฟเวอร์ส่งธีมมืดมาก่อนเสมอ effect
 * ด้านล่างจึงเทียบกับค่าที่ควรเป็นแล้วสลับให้หลัง hydrate — คนที่ตั้งเครื่องเป็น
 * ธีมสว่างจะเห็นจอมืดวาบหนึ่งครั้งในชีวิตของเบราว์เซอร์นั้น จากนั้นคุกกี้จะทำให้
 * เซิร์ฟเวอร์ส่งธีมถูกมาตั้งแต่แรกทุกครั้ง
 *
 * เดิมกันวาบนี้ด้วยสคริปต์ inline ใน <head> แต่ React เตือนเรื่อง script tag
 * ทุกครั้งในโหมด development และตอนนี้มีคุกกี้แล้ว สคริปต์จึงเหลือประโยชน์แค่
 * การเข้าครั้งแรกครั้งเดียว ไม่คุ้มกับเสียงรบกวนที่ได้มา
 */
export function ThemeProvider({
  initialMode = DEFAULT_MODE,
  children,
}: {
  initialMode?: ThemeMode
  children: ReactNode
}) {
  const readInitial = useCallback(() => initialMode, [initialMode])
  const mode = useSyncExternalStore(subscribe, readMode, readInitial)

  // รันครั้งเดียวหลัง hydrate — ปรับให้ตรงกับค่าที่ควรเป็น และเขียนคุกกี้ไว้เสมอ
  // เพื่อให้เซิร์ฟเวอร์เรนเดอร์ธีมถูกตั้งแต่คำขอถัดไป (เผื่อคุกกี้หมดอายุหรือถูกล้าง)
  useEffect(() => {
    const preferred = preferredMode()
    if (preferred === readMode()) document.cookie = themeCookie(preferred)
    else applyMode(preferred)
  }, [])

  const toggle = useCallback(
    () => applyMode(mode === 'dark' ? 'light' : 'dark'),
    [mode],
  )

  return (
    <ThemeContext.Provider value={{ mode, setMode: applyMode, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}

/** ปุ่มสลับธีมแบบไอคอนเดียว — ใช้บนแถบบนและหน้าเข้าสู่ระบบ */
export function ThemeToggleButton({ className = '' }: { className?: string }) {
  const { mode, toggle } = useTheme()
  const toLight = mode === 'dark'
  const label = toLight ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด'

  return (
    <Tooltip title={label}>
      <Button
        type="text"
        aria-label={label}
        onClick={toggle}
        icon={toLight ? <SunOutlined /> : <MoonOutlined />}
        className={`text-ink-2! hover:text-accent! ${className}`}
      />
    </Tooltip>
  )
}

/** ตัวเลือกธีมแบบเห็นทั้งสองตัวเลือก — ใช้ในลิ้นชักเมนูระบบ */
export function ThemeSegmented() {
  const { mode, setMode } = useTheme()

  return (
    <Segmented
      block
      value={mode}
      onChange={value => setMode(value as ThemeMode)}
      options={[
        { value: 'dark', label: 'มืด', icon: <MoonOutlined /> },
        { value: 'light', label: 'สว่าง', icon: <SunOutlined /> },
      ]}
    />
  )
}
