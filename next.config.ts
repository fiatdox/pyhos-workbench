import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // เปิดใต้ path ย่อยหลัง nginx (https://phayaohospital.moph.go.th/workbench)
  // ตั้ง NEXT_PUBLIC_BASE_PATH ก่อน build — จุดที่ Next ไม่เติมให้เองดู lib/base-path.ts
  basePath: (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, ""),
  // ตอน dev เปิดหน้าเว็บด้วย IP เครื่องในวง LAN ได้ — ถ้าไม่ประกาศไว้
  // Next จะตอบ 403 ให้ /_next/* ทุกตัว ทำให้ JS ฝั่ง client ไม่โหลด
  // (ฟอร์มล็อกอินกดแล้วไม่ยิง API) ใช้ * แทน octet สุดท้ายเผื่อ DHCP เปลี่ยนเลข
  allowedDevOrigins: ["192.168.1.*", "192.168.2.*", "192.168.100.*"],
  // ไม่อนุญาตรูปจากโดเมนภายนอกแล้ว — ที่เคยใช้คือภาพพื้นหลังหน้าเข้าสู่ระบบจาก
  // images.unsplash.com ซึ่งถูกเอาออกตอนปรับหน้าตาใหม่ ถ้าเปิดไว้โดยไม่มีใครใช้
  // ตัวปรับขนาดรูปของ Next จะยังรับดึงรูปจากโดเมนนั้นให้ใครก็ได้
};

export default nextConfig;
