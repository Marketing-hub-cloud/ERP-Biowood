import type { NextConfig } from "next";

// ไม่เปิด cacheComponents: ทุกหน้าของ ERP ต้องล็อกอินและแสดงข้อมูลตามสิทธิ์ผู้ใช้ (dynamic ทั้งหมด)
// dev server: อนุญาตให้เปิดผ่าน IP ในวงแลน (เช่น http://192.168.1.188:3000 จากมือถือ/เครื่องอื่น)
// ถ้าไม่ตั้ง Next.js จะบล็อก JS/HMR ของ dev → หน้าเว็บไม่ทำงาน (ปุ่มกดไม่ได้, ล็อกอินค้าง)
// มีผลเฉพาะตอน `next dev` เท่านั้น; เพิ่มโดเมน/IP อื่นได้ทาง env DEV_ALLOWED_ORIGINS (คั่นด้วย comma)
const devOrigins = [
  "192.168.*.*",
  "10.*.*.*",
  "172.*.*.*",
  ...(process.env.DEV_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
];

const nextConfig: NextConfig = {
  allowedDevOrigins: devOrigins,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
    // proxy (src/proxy.ts) buffer body ก่อนส่งต่อ — ไฟล์แนบใบถอดแบบใหญ่ได้ถึง 25MB
    proxyClientMaxBodySize: "30mb",
  },
};

export default nextConfig;
