# Biowood ERP

ระบบ ERP ของ Biowood (CRM + คลังสินค้า + จัดซื้อ + ถอดแบบ/ติดตั้ง) ดูสเปกที่ [CLAUDE.md](CLAUDE.md)
และการตัดสินใจที่ [docs/DECISIONS.md](docs/DECISIONS.md)

## Stack
Next.js 16 · TypeScript · PostgreSQL (Supabase) · Prisma 7 · Auth.js v5 · Tailwind 4 + shadcn/ui · TanStack Table · Zod · Vitest · Playwright

## เริ่มต้น (dev)

```bash
npm install
cp .env.example .env          # กรอก DATABASE_URL, DIRECT_URL, AUTH_SECRET, SEED_ADMIN_PASSWORD
npx auth secret               # (หรือสร้าง AUTH_SECRET เอง)
npm run db:migrate            # สร้างตาราง
npm run db:seed               # admin + กลุ่มตัวอย่าง + ข้อมูลบริษัท
npm run dev                   # http://localhost:3000
```

ล็อกอินด้วย `admin@biowood.local` และรหัสผ่านที่ตั้งไว้ใน `SEED_ADMIN_PASSWORD`

## คำสั่ง

| คำสั่ง | ใช้ทำอะไร |
|---|---|
| `npm run dev` | รัน dev server |
| `npm run typecheck` | ตรวจ TypeScript |
| `npm run lint` | ESLint |
| `npm run test:unit` | unit test (ไม่ใช้ DB) |
| `npm run test:db` | test กับ DB จริง (เลขที่เอกสารพร้อมกัน 20 ใบ) |
| `npm run test:e2e` | Playwright (ครั้งแรกให้รัน `npx playwright install chromium`) |
| `npm run db:studio` | เปิด Prisma Studio |

## โครงสร้าง

```
prisma/              schema, migrations, seed
src/proxy.ts         ต้องล็อกอินก่อนเข้าทุกหน้า
src/auth.ts          Auth.js (Credentials + bcrypt)
src/lib/
  menu.ts            เมนู sidebar + menuKey สำหรับสิทธิ์
  rbac.ts            logic สิทธิ์ (pure)
  session.ts         getCurrentUser / requirePagePermission
  api.ts             apiHandler: ตรวจ 401/403 + จัดการ error ทุก route
  audit.ts           audit log
  doc-number.ts      เลขที่เอกสาร PREFIX+YYMMDD+0001
  storage.ts         ไฟล์ (local / S3)
  csv.ts, format.ts  CSV (BOM), วันที่/ตัวเลข
src/server/          business logic ฝั่ง server
src/app/(app)/       หน้าจอหลังล็อกอิน
src/app/api/         Route handlers
tests/unit|db|e2e
```
