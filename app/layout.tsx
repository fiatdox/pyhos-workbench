import type { Metadata } from "next";
import { Geist, Geist_Mono, IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";
import Providers from "./providers";
import { THEME_INIT_SCRIPT } from "./theme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// ฟอนต์ไทย — เดิมตกไปใช้ Arial ทำให้สระ/วรรณยุกต์ซ้อนกันและอ่านยาก
// เบราว์เซอร์เลือกฟอนต์ทีละตัวอักษร: ละตินได้จาก Geist ส่วนอักษรไทยตกมาที่ตัวนี้
const thaiSans = IBM_Plex_Sans_Thai({
  variable: "--font-thai",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "PYHOS Workbench",
  description: "พื้นที่ทำงานสำหรับสืบค้นและสรุปข้อมูลโรงพยาบาล",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="th"
      className={`${geistSans.variable} ${geistMono.variable} ${thaiSans.variable} h-full antialiased`}
      // สคริปต์ธีมแก้ data-theme ก่อน hydrate — markup ฝั่งเซิร์ฟเวอร์จึงไม่ตรงโดยตั้งใจ
      suppressHydrationWarning
    >
      <head>
        {/* ต้องรันก่อน paint แรก ไม่งั้นผู้ใช้ธีมสว่างจะเห็นหน้าจอมืดกระพริบก่อน */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
