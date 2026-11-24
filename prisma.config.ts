import "dotenv/config";
import { defineConfig } from "prisma/config";

// CLI (migrate) ใช้ DIRECT_URL (Supabase: session pooler / direct, port 5432)
// ส่วนแอปตอนรันใช้ DATABASE_URL ผ่าน driver adapter (ดู src/lib/db.ts)
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  },
});
