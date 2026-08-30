'use client'
import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from 'react'
import { Button, Segmented, Tooltip } from 'antd'
import { MoonOutlined, SunOutlined } from '@ant-design/icons'

export type ThemeMode = 'dark' | 'light'

const STORAGE_KEY = 'pyhos-theme'

/** สคริปต์ที่ฝังใน <head> ให้รันก่อน React จะ hydrate
 *  ถ้าปล่อยให้ React ตั้งธีมเอง หน้าจะถูกวาดด้วยธีมมืดหนึ่งเฟรมแล้วค่อยกระพริบ
 *  เป็นธีมสว่าง — เขียนเป็นสตริงเพราะต้องรันแบบ synchronous ก่อน paint แรก */
export const THEME_INIT_SCRIPT = `(function(){try{var m=localStorage.getItem(${JSON.stringify(
  STORAGE_KEY,
)});if(m!=='light'&&m!=='dark'){m=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}document.documentElement.dataset.theme=m}catch(e){document.documentElement.dataset.theme='dark'}})()`

/** แหล่งความจริงของธีมคือ data-theme บน <html> ไม่ใช่ state ของ React
 *  (สคริปต์ใน <head> ตั้งค่าไว้ตั้งแต่ก่อน React เริ่มทำงาน) จึงอ่านผ่าน
 *  useSyncExternalStore แทนการ setState ใน effect — ไม่มีเรนเดอร์ซ้อน
 *  และ hydrate ได้ตรงเพราะฝั่งเซิร์ฟเวอร์คืนค่า 'dark' เท่ากับ markup ที่ส่งมา */
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

function readServerMode(): ThemeMode {
  return 'dark'
}

function applyMode(next: ThemeMode) {
  document.documentElement.dataset.theme = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
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
  mode: 'dark',
  setMode: () => {},
  toggle: () => {},
})

export function useTheme() {
  return useContext(ThemeContext)
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const mode = useSyncExternalStore(subscribe, readMode, readServerMode)

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
