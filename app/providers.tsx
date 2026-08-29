'use client'
import type { ReactNode } from 'react'
import { AntdRegistry } from '@ant-design/nextjs-registry'
import { ConfigProvider, theme } from 'antd'
import thTH from 'antd/locale/th_TH'

/** โทนม่วงชุดเดียวกับหน้าเข้าสู่ระบบ แปลงเป็น design token ของ Ant Design */
const violetDark = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: '#8b5cf6',
    colorInfo: '#8b5cf6',
    colorBgBase: '#0c0716',
    colorLink: '#c4b5fd',
    borderRadius: 10,
    fontFamily: 'var(--font-app)',
    fontSize: 14,
    // ข้อความรองในธีมมืดของ antd จางเกินไปสำหรับอักษรไทย — ดันคอนทราสต์ขึ้น
    colorTextSecondary: 'rgba(231, 227, 242, 0.72)',
    colorTextDescription: 'rgba(231, 227, 242, 0.65)',
  },
  components: {
    Layout: { headerBg: 'transparent', bodyBg: 'transparent' },
    Menu: { darkItemBg: 'transparent', darkSubMenuItemBg: 'transparent' },
    Drawer: { colorBgElevated: '#140b26' },
    Card: { colorBgContainer: 'rgba(255,255,255,0.03)' },
  },
}

export default function Providers({ children }: { children: ReactNode }) {
  // AntdRegistry ดึง style ของ cssinjs มา inline ตอน SSR — กันหน้าจอกระพริบไร้สไตล์
  return (
    <AntdRegistry>
      <ConfigProvider theme={violetDark} locale={thTH}>
        {children}
      </ConfigProvider>
    </AntdRegistry>
  )
}
