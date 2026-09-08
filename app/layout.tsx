import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono, IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";
import Providers from "./providers";
import { normalizeMode, THEME_KEY } from "./theme-config";

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

// อ่านคุกกี้ธีมทำให้ทั้งแอปเป็น dynamic — ยอมรับได้เพราะทุกหน้าอ่านฐาน HIS
// ตามผู้ใช้ที่ล็อกอินอยู่แล้ว ไม่มีหน้าไหนที่ prerender เป็นไฟล์นิ่งได้จริง
export default async function RootLayout({ children }: LayoutProps<"/">) {
  // ธีมของผู้ใช้ต้องรู้ตั้งแต่ฝั่งเซิร์ฟเวอร์ ไม่งั้น antd จะเรนเดอร์คลาสและสไตล์
  // จาก algorithm คนละชุดกับที่เบราว์เซอร์ใช้ แล้ว hydrate ไม่ตรงทั้งหน้า
  const mode = normalizeMode((await cookies()).get(THEME_KEY)?.value);

  return (
    <html
      lang="th"
      className={`${geistSans.variable} ${geistMono.variable} ${thaiSans.variable} h-full antialiased`}
      // ธีมมาจากคุกกี้ตั้งแต่ฝั่งเซิร์ฟเวอร์แล้ว ไม่มีสคริปต์ inline มาแก้ก่อน hydrate
      // อีก markup สองฝั่งจึงตรงกันเสมอ (เดิมมีสคริปต์ตั้ง data-theme ก่อน React
      // ทำงาน ซึ่งทำให้ React เตือนเรื่อง script tag ทุกครั้งในโหมด development)
      data-theme={mode}
    >
      <body className="min-h-full flex flex-col">
        <Providers initialMode={mode}>{children}</Providers>
      </body>
    </html>
  );
}
