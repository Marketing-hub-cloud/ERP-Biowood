import { defineConfig } from "vitest/config";
import path from "node:path";
import "dotenv/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // เทส DB เรียก logic ฝั่ง server ได้โดยตรง
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/db/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    // เทส DB ใช้ฐานข้อมูลเดียวกันและแก้ค่ากลาง (เช่น ผังอนุมัติ) จึงรันทีละไฟล์
    fileParallelism: false,
  },
});
