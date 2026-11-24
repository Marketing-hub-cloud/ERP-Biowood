# Decisions

บันทึกการตัดสินใจเมื่อสเปกไม่ชัด (CLAUDE.md: "เลือกแบบที่เรียบง่ายที่สุด แล้วจดไว้")

## เฟส 1: Foundation (24/11/2026)

### ฐานข้อมูล: Supabase
- เครื่อง dev ไม่มี Docker / Postgres ผู้ใช้เลือก Supabase
- `DATABASE_URL` = transaction pooler (6543) ใช้ตอนแอปรัน ผ่าน `@prisma/adapter-pg`
- `DIRECT_URL` = session pooler/direct (5432) ใช้ตอน `prisma migrate`
- docker-compose ยังมี service `postgres` (profile `localdb`) ไว้ใช้ภายหลัง

### เวอร์ชัน
- Next.js 16 (middleware เปลี่ยนชื่อเป็น `src/proxy.ts`), Prisma 7 (driver adapter + `prisma.config.ts`),
  Auth.js = `next-auth@5` (beta เพราะยังไม่มี v5 stable), Zod 4, TanStack Table v8 (v9 API ใหม่ ยังไม่ใช้)

### Session / Auth
- ใช้ JWT session (Credentials provider ใช้ database session ไม่ได้)
- **ตรวจสถานะผู้ใช้จาก DB ทุก request** (`getCurrentUser()`) ผู้ใช้ที่ถูกหยุดใช้งานจะหลุดทันที ไม่ต้องรอ token หมดอายุ
- session อายุ 12 ชั่วโมง
- บอกว่า "บัญชีถูกหยุดใช้งาน" เฉพาะเมื่อกรอกรหัสผ่านถูกเท่านั้น (ไม่เปิดเผยว่าอีเมลมีในระบบ)

### ผู้ใช้
- แผนก/ตำแหน่ง เป็นข้อความอิสระ (ยังไม่ทำ master data)
- รหัสผ่านอย่างน้อย 8 ตัวอักษร
- ผู้ใช้เปลี่ยนรหัสผ่านตัวเองต้องกรอกรหัสผ่านปัจจุบัน; เปลี่ยนอีเมลตัวเองไม่ได้ (ให้ admin เปลี่ยน)
- กันพลาด: หยุดใช้งานตัวเองไม่ได้ / ต้องมี admin ที่ใช้งานอยู่อย่างน้อย 1 คน /
  บัญชี admin แก้ไขหรือเปลี่ยนสถานะได้เฉพาะ admin / เฉพาะ admin กำหนด flag admin ได้

### สิทธิ์ (RBAC)
- รายการเมนู (menuKey) อยู่ในโค้ด `src/lib/menu.ts` ไม่ได้เก็บใน DB เพราะเมนูผูกกับหน้าจอที่ต้องเขียนโค้ดอยู่แล้ว
- แต่ละเมนูกำหนดว่ารองรับสิทธิ์ไหนบ้าง เช่น รายงานมีแค่ "ดู", ตั้งค่ามี "ดู/แก้ไข"
- "หยุดใช้งาน/เปิดใช้งาน" ผู้ใช้ ใช้สิทธิ์ `cancel` ของเมนูบัญชีผู้ใช้ (ไม่มีการลบผู้ใช้ จึงไม่มีสิทธิ์ `delete`)
- "แก้ไขข้อมูลส่วนตัว" เป็นเมนู public ทุกคนเห็น
- ไม่มีสิทธิ์ใน page → redirect ไป `/forbidden` (403); ใน API → JSON 403
- "ผู้ติดต่อ > ทั้งหมด": จะแสดงเมื่อมีสิทธิ์ view ลูกค้าหรือผู้ขายอย่างใดอย่างหนึ่ง (ทำในเฟส 2)

### เลขที่เอกสาร
- ตาราง `document_counters (prefix, dateKey)` + `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` (atomic, row lock)
- วันที่ (YYMMDD) คิดตามเวลา Asia/Bangkok
- **ฟอร์มแสดงเลขถัดไปเป็นตัวอย่าง (ไม่จองเลข) ปุ่มรีเฟรช = ขอเลขถัดไปล่าสุด เลขจริงออกตอนบันทึก**
  ถ้ามีคนบันทึกตัดหน้า จะได้เลขถัดไปและแจ้งผู้ใช้ ข้อดีคือเลขไม่ข้าม (transaction ที่ rollback ไม่กินเลข)
- เกิน 9999 ใบ/วัน/ประเภท → error

### Audit log
- เก็บ before/after/changes (เฉพาะฟิลด์ที่เปลี่ยน) ใน transaction เดียวกับการบันทึก
- ไม่เก็บ passwordHash; การเปลี่ยนรหัสผ่านบันทึกเป็นหมายเหตุ "เปลี่ยนรหัสผ่าน"
- กลุ่มสิทธิ์เก็บ snapshot เป็นข้อความอ่านง่าย เช่น `purchase.request: view,create`
- ไม่ log การล็อกอิน (เก็บแค่ `lastLoginAt`)

### หน้ารายการ (DataTable)
- ทำ component กลางตั้งแต่เฟส 1 (เดิมอยู่เฟส 2) เพราะหน้าผู้ใช้/กลุ่มสิทธิ์ต้องใช้
- pagination/ค้นหา/กรอง/เรียง ทำฝั่ง server; Export CSV ส่งออกทุกแถวตามตัวกรองปัจจุบัน (ไม่ใช่แค่หน้าที่เห็น)
- Density และ Columns จำค่าไว้ใน localStorage ของเบราว์เซอร์
- CSV: UTF-8 BOM + CRLF และกัน CSV injection (ขึ้นต้นด้วย `= + - @` จะเติม `'` นำหน้า ยกเว้นตัวเลข)

### ไฟล์
- dev เก็บที่ `./uploads` ผ่าน interface `Storage` (`src/lib/storage.ts`) เปลี่ยนเป็น S3 ได้ภายหลัง
- ไฟล์ทุกไฟล์เปิดผ่าน `/api/files/...` และต้องล็อกอินก่อน
- โลโก้: PNG/JPG/WEBP/GIF ไม่เกิน 5MB

### การแจ้งเตือน
- เฟส 1 มีแค่ไอคอนกระดิ่ง (badge = 0) ระบบจริงทำในเฟส 6

### Next.js config
- ปิด `cacheComponents` / `partialPrefetching` ที่ create-next-app เปิดไว้ เพราะทุกหน้าต้องล็อกอินและขึ้นกับสิทธิ์ผู้ใช้ (dynamic ทั้งหมด) ทำให้โค้ดเรียบง่ายกว่า
