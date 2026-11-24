import type { NextConfig } from "next";

// ไม่เปิด cacheComponents: ทุกหน้าของ ERP ต้องล็อกอินและแสดงข้อมูลตามสิทธิ์ผู้ใช้ (dynamic ทั้งหมด)
const nextConfig: NextConfig = {
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
  },
};

export default nextConfig;
