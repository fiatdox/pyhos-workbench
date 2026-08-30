import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ตอน dev เปิดหน้าเว็บด้วย IP เครื่องในวง LAN ได้ — ถ้าไม่ประกาศไว้
  // Next จะตอบ 403 ให้ /_next/* ทุกตัว ทำให้ JS ฝั่ง client ไม่โหลด
  // (ฟอร์มล็อกอินกดแล้วไม่ยิง API) ใช้ * แทน octet สุดท้ายเผื่อ DHCP เปลี่ยนเลข
  allowedDevOrigins: ["192.168.1.*", "192.168.2.*", "192.168.100.*"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
