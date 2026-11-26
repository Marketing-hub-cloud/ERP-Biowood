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
| `npm run test:db` | test กับ DB จริง (เลขที่เอกสาร, stock ledger, จัดซื้อ, แจ้งเตือน, ถอดแบบ/ติดตั้ง, CRM, งานจัดส่ง + รายงาน) |
| `npm run test:e2e` | Playwright (ครั้งแรกให้รัน `npx playwright install chromium`) |
| `npm run db:studio` | เปิด Prisma Studio |

> หลัง `npm run db:migrate` / `prisma generate` ให้รีสตาร์ท `npm run dev` ถ้ายังเจอ error แปลกๆ เช่น
> `Cannot read properties of undefined (reading 'count')` แปลว่า dev server ยังใช้ Prisma client เก่าใน cache ให้ลบโฟลเดอร์ `.next` แล้วรันใหม่

## แจ้งเตือน LINE (Messaging API)

ระบบส่งแจ้งเตือนเข้ากลุ่ม LINE ผ่าน **LINE Messaging API** (push message) — ไม่ใช้ LINE Notify ซึ่งปิดบริการแล้ว
ข้อความเข้าคิวในฐานข้อมูลพร้อมการบันทึกเอกสาร แล้ว worker ในแอปส่งทุก 15 วินาที (ส่งล้มลองใหม่อัตโนมัติ ไม่กระทบเอกสาร)

1. **สร้าง channel**: [LINE Developers Console](https://developers.line.biz/console/) > สร้าง Provider > สร้าง **Messaging API channel**
   (จะได้ LINE Official Account ของบอทมาด้วย)
2. **ค่าลับใส่ใน `.env`** (ห้าม commit):
   - `LINE_CHANNEL_ACCESS_TOKEN` = แท็บ Messaging API > Channel access token (long-lived) > Issue
   - `LINE_CHANNEL_SECRET` = แท็บ Basic settings > Channel secret
   - `APP_BASE_URL` = URL ของระบบ เช่น `https://erp.biowood.co.th` (ใช้ทำลิงก์ในข้อความ)
3. **ตั้ง webhook** (ให้ระบบรู้ groupId ของกลุ่ม): แท็บ Messaging API > Webhook URL = `<APP_BASE_URL>/api/line/webhook` > Verify > เปิด **Use webhook**
   - ปิด Auto-reply / Greeting messages ใน LINE Official Account Manager (ไม่บังคับ)
   - เปิด **Allow bot to join group chats** ใน LINE Official Account Manager > Settings
   - ตอน dev ที่เครื่องตัวเอง LINE เรียก localhost ไม่ได้ ใช้ tunnel เช่น `cloudflared tunnel --url http://localhost:3000`
4. **เชิญบอทเข้ากลุ่ม** "Biowood - จัดซื้อ" (และ "Biowood - ถอดแบบติดตั้ง") แล้วพิมพ์ข้อความอะไรก็ได้ 1 ครั้งในกลุ่ม
5. รีสตาร์ทแอป แล้วไปที่ **ตั้งค่า > การแจ้งเตือน**: เปิด "ส่งแจ้งเตือนเข้ากลุ่ม LINE" > เลือกกลุ่ม > บันทึก > **ทดสอบส่ง**
   ดูผลในตาราง "ประวัติการส่ง LINE" (ถ้าไม่มี webhook กรอก groupId เองได้)

ถ้า deploy หลาย instance หรือ serverless ที่รัน background ไม่ได้: ตั้ง `NOTIFY_WORKER=off` + `CRON_SECRET`
แล้วให้ cron เรียก `POST /api/jobs/notifications` (header `Authorization: Bearer <CRON_SECRET>`) ทุก 1 นาที
(worker หลายตัวทำงานพร้อมกันได้ ไม่ส่งซ้ำ)

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
  stock-ledger.ts    นำเข้า/นำออก (lock + movement)
  approval.ts        approval engine (pure)
  engineer-workflow.ts  state machine ใบถอดแบบ/ติดตั้ง (ขั้น + สิทธิ์ต่อ transition)
  crm.ts             สถานะโครงการ + กติกาแผนการทำงาน/เช็คอิน
  distance.ts        ระยะทาง (Haversine, เปลี่ยน provider ได้)
  notifications.ts   แจ้งเตือนในระบบ + คิว LINE (outbox)
  notification-worker.ts  worker ส่ง LINE + retry
src/instrumentation.ts  เริ่ม worker ตอนเซิร์ฟเวอร์เริ่ม
src/server/          business logic ฝั่ง server
src/app/(app)/       หน้าจอหลังล็อกอิน
src/app/api/         Route handlers
tests/unit|db|e2e
```
