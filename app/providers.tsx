'use client'
import type { ReactNode } from 'react'
import { AntdRegistry } from '@ant-design/nextjs-registry'
import { ConfigProvider, theme, type ThemeConfig } from 'antd'
import thTH from 'antd/locale/th_TH'
import { ThemeProvider, useTheme, type ThemeMode } from './theme'

/**
 * ธีมของ Ant Design — ค่าทุกตัวตรงกับ token ใน globals.css
 * ถ้าแก้สีที่นี่ต้องแก้ที่นั่นด้วย (antd อ่าน CSS variable ไม่ได้ในทุก token
 * เพราะมันคำนวณเฉดสีจากค่า hex ตอนสร้างสไตล์)
 *
 * แนวทาง: พื้นทึบ ขอบบาง เงาน้อย ข้อมูลแน่น — ม่วงเป็นสีเน้นอย่างเดียว
 */

/** ค่าที่เหมือนกันทั้งสองธีม — รูปทรงและตัวอักษรไม่ควรเปลี่ยนตามโหมดสี */
const shared = {
  borderRadius: 8,
  borderRadiusLG: 10,
  borderRadiusSM: 6,
  fontFamily: 'var(--font-app)',
  fontSize: 14,
  // หัวข้อหน้าเล็กลงหนึ่งขั้น — หน้าส่วนใหญ่เป็นตาราง หัวข้อใหญ่กินแถวข้อมูล
  fontSizeHeading2: 22,
  fontSizeHeading3: 19,
  fontSizeHeading4: 16,
  motionDurationMid: '0.18s',
  motionDurationSlow: '0.24s',
}

/** ค่าของคอมโพเนนต์ที่เหมือนกันทั้งสองธีม */
const sharedComponents = {
  Layout: { headerBg: 'transparent', bodyBg: 'transparent', siderBg: 'transparent' },
  Table: {
    cellPaddingBlockSM: 6,
    cellPaddingInlineSM: 8,
    headerBorderRadius: 8,
  },
  Menu: {
    itemHeight: 36,
    itemBorderRadius: 6,
    itemMarginInline: 8,
    itemMarginBlock: 2,
    iconSize: 15,
    collapsedIconSize: 16,
  },
  Card: { boxShadowTertiary: 'none' },
  Button: { primaryShadow: 'none', defaultShadow: 'none', dangerShadow: 'none' },
} satisfies ThemeConfig['components']

const violetLight: ThemeConfig = {
  algorithm: theme.defaultAlgorithm,
  token: {
    ...shared,
    colorPrimary: '#6d28d9',
    colorInfo: '#6d28d9',
    colorLink: '#6d28d9',
    colorBgBase: '#ffffff',
    colorBgLayout: '#f6f5fa',
    colorText: '#1c1729',
    colorTextSecondary: '#463f5a',
    colorTextDescription: '#6a6480',
    colorBorder: '#dad6e3',
    colorBorderSecondary: '#ebe8f0',
    colorFillAlter: '#f9f8fc',
    colorSplit: '#ebe8f0',
    boxShadow: '0 4px 16px rgba(28, 23, 41, 0.08)',
    boxShadowSecondary: '0 6px 20px rgba(28, 23, 41, 0.12)',
  },
  components: {
    ...sharedComponents,
    Table: {
      ...sharedComponents.Table,
      headerBg: '#f4f2f8',
      headerColor: '#463f5a',
      headerSplitColor: 'transparent',
      rowHoverBg: '#f3effc',
      borderColor: '#ebe8f0',
    },
    Menu: {
      ...sharedComponents.Menu,
      itemBg: 'transparent',
      subMenuItemBg: 'transparent',
      itemColor: '#463f5a',
      itemHoverBg: '#f4f2f8',
      itemSelectedBg: '#efe9fd',
      itemSelectedColor: '#5b21b6',
    },
    Card: { ...sharedComponents.Card, colorBgContainer: '#ffffff' },
  },
}

const violetDark: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    ...shared,
    // ปุ่มหลักใช้ม่วงเข้มกว่าสีเน้นของตัวอักษร (#a78bfa) — ตัวอักษรขาวบน #7c3aed
    // ได้ 5.7:1 ส่วนบน #8b5cf6 ได้ไม่ถึง 4.5
    colorPrimary: '#7c3aed',
    colorInfo: '#7c3aed',
    colorLink: '#c4b5fd',
    colorBgBase: '#111019',
    colorBgLayout: '#111019',
    colorBgContainer: '#18161f',
    colorBgElevated: '#201d2a',
    colorText: '#f1eff6',
    colorTextSecondary: '#c8c3d5',
    colorTextDescription: '#9c97ad',
    colorBorder: '#36324a',
    colorBorderSecondary: '#2c2938',
    colorFillAlter: '#1e1b27',
    colorSplit: '#2c2938',
  },
  components: {
    ...sharedComponents,
    Table: {
      ...sharedComponents.Table,
      headerBg: '#1e1b27',
      headerColor: '#c8c3d5',
      headerSplitColor: 'transparent',
      rowHoverBg: '#221c33',
      borderColor: '#2c2938',
    },
    Menu: {
      ...sharedComponents.Menu,
      darkItemBg: 'transparent',
      darkSubMenuItemBg: 'transparent',
      darkItemColor: '#c8c3d5',
      darkItemHoverBg: '#1e1b27',
      darkItemSelectedBg: '#261f3b',
      darkItemSelectedColor: '#ddd6fe',
    },
    // ลิ้นชักไม่ตั้งสีตรงนี้ — สไตล์ที่ cssinjs สร้างไว้ตอนธีมก่อนหน้าค้างอยู่
    // ทำให้พื้นไม่เปลี่ยนตามธีม จึงผูกกับ data-theme ใน globals.css แทน
    Card: { ...sharedComponents.Card, colorBgContainer: '#18161f' },
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

export default function Providers({
  initialMode,
  children,
}: {
  /** ธีมที่เซิร์ฟเวอร์อ่านได้จากคุกกี้ — ต้องส่งต่อลงไปให้ ConfigProvider เลือก
   *  algorithm ชุดเดียวกับที่เบราว์เซอร์จะใช้ ไม่งั้น hydrate ไม่ตรง */
  initialMode: ThemeMode
  children: ReactNode
}) {
  // AntdRegistry ดึง style ของ cssinjs มา inline ตอน SSR — กันหน้าจอกระพริบไร้สไตล์
  return (
    <AntdRegistry>
      <ThemeProvider initialMode={initialMode}>
        <AntdTheme>{children}</AntdTheme>
      </ThemeProvider>
    </AntdRegistry>
  )
}
