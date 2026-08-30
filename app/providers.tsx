'use client'
import type { ReactNode } from 'react'
import { AntdRegistry } from '@ant-design/nextjs-registry'
import { ConfigProvider, theme, type ThemeConfig } from 'antd'
import thTH from 'antd/locale/th_TH'
import { ThemeProvider, useTheme } from './theme'

/** ค่าที่เหมือนกันทั้งสองธีม — รูปทรงและตัวอักษรไม่ควรเปลี่ยนตามโหมดสี */
const shared = {
  borderRadius: 10,
  fontFamily: 'var(--font-app)',
  fontSize: 14,
}

/** โทนม่วงเข้มชุดเดิม แปลงเป็น design token ของ Ant Design */
const violetDark: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    ...shared,
    colorPrimary: '#8b5cf6',
    colorInfo: '#8b5cf6',
    colorBgBase: '#0c0716',
    colorLink: '#c4b5fd',
    // ข้อความรองในธีมมืดของ antd จางเกินไปสำหรับอักษรไทย — ดันคอนทราสต์ขึ้น
    colorTextSecondary: 'rgba(231, 227, 242, 0.72)',
    colorTextDescription: 'rgba(231, 227, 242, 0.65)',
  },
  components: {
    Layout: { headerBg: 'transparent', bodyBg: 'transparent' },
    Menu: { darkItemBg: 'transparent', darkSubMenuItemBg: 'transparent' },
    // ลิ้นชักไม่ตั้งสีตรงนี้ — สไตล์ที่ cssinjs สร้างไว้ตอนธีมก่อนหน้าค้างอยู่
    // ทำให้พื้นไม่เปลี่ยนตามธีม จึงย้ายไปผูกกับ data-theme ใน globals.css
    Card: { colorBgContainer: 'rgba(255,255,255,0.03)' },
  },
}

/** พาสเทลม่วง–ขาว — ตรงกับ token ชุด light ใน globals.css
 *  พื้นเป็นขาวนวลอมม่วง ไม่ใช่ขาวล้วน ไม่งั้นการ์ดขาวจะจมไปกับพื้นหลัง */
const violetLight: ThemeConfig = {
  algorithm: theme.defaultAlgorithm,
  token: {
    ...shared,
    colorPrimary: '#7c3aed',
    colorInfo: '#7c3aed',
    colorBgBase: '#ffffff',
    colorLink: '#6d28d9',
    colorText: '#2b2140',
    colorTextSecondary: '#4b4165',
    colorTextDescription: '#78708f',
    colorBorder: 'rgba(124, 58, 237, 0.22)',
    colorBorderSecondary: 'rgba(124, 58, 237, 0.12)',
  },
  components: {
    Layout: { headerBg: 'transparent', bodyBg: 'transparent' },
    Menu: { itemBg: 'transparent', subMenuItemBg: 'transparent' },
    // ลิ้นชักไม่ตั้งสีตรงนี้ — เหตุผลเดียวกับธีมมืด ดู globals.css
    Card: { colorBgContainer: 'rgba(255,255,255,0.72)' },
  },
}

function AntdTheme({ children }: { children: ReactNode }) {
  const { mode } = useTheme()
  return (
    <ConfigProvider theme={mode === 'light' ? violetLight : violetDark} locale={thTH}>
      {children}
    </ConfigProvider>
  )
}

export default function Providers({ children }: { children: ReactNode }) {
  // AntdRegistry ดึง style ของ cssinjs มา inline ตอน SSR — กันหน้าจอกระพริบไร้สไตล์
  return (
    <AntdRegistry>
      <ThemeProvider>
        <AntdTheme>{children}</AntdTheme>
      </ThemeProvider>
    </AntdRegistry>
  )
}
