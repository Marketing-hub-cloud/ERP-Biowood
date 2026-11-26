# Deploy production (VPS + Docker)

```
อินเทอร์เน็ต ──443──▶ Caddy (HTTPS อัตโนมัติ) ──▶ app (Next.js, worker แจ้งเตือน LINE) ──▶ Supabase (PostgreSQL)
                                                     └─ volume "uploads" (ไฟล์แนบ/รูปภาพ)
```

## 1. เตรียม

- **VPS** Ubuntu 24.04, อย่างน้อย 2 vCPU / 2 GB RAM (build ต้องใช้ RAM — ถ้า 1 GB ให้เพิ่ม swap 2 GB)
  เลือก region สิงคโปร์ ให้ใกล้ Supabase และผู้ใช้
- **โดเมน** เช่น `erp.biowood.co.th` → ตั้ง DNS **A record** ชี้ไป IP ของ VPS (ต้องเสร็จก่อนเริ่ม Caddy จึงออกใบรับรองได้)
- **Supabase project สำหรับ production** (แยกจาก dev) — Project Settings > Database > Connection string
  - `DATABASE_URL` = Transaction pooler (6543), `DIRECT_URL` = Session pooler (5432)
- เปิด firewall เฉพาะ 22, 80, 443:
  ```bash
  sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443/tcp && sudo ufw allow 443/udp && sudo ufw enable
  ```

## 2. ติดตั้ง Docker และโค้ด

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # แล้ว logout/login ใหม่
sudo mkdir -p /opt/biowood-erp && sudo chown $USER /opt/biowood-erp
git clone <repo-url> /opt/biowood-erp && cd /opt/biowood-erp
```

## 3. ตั้งค่า

```bash
cp .env.compose.example .env                  # DOMAIN, ACME_EMAIL
cp .env.production.example .env.production    # ค่าลับทั้งหมด
openssl rand -base64 32                       # → AUTH_SECRET (สร้างใหม่ ห้ามใช้ของ dev)
chmod 600 .env.production
```
กรอก `.env.production`: `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `AUTH_URL`/`APP_BASE_URL` = `https://<โดเมน>`,
`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`, `SEED_SAMPLE_DATA=false`, ค่า LINE

## 4. ติดตั้งครั้งแรก

```bash
docker compose -f docker-compose.prod.yml up -d --build      # build + migrate + เริ่มแอป + HTTPS
docker compose -f docker-compose.prod.yml run --rm tools npm run db:seed   # admin, กลุ่มสิทธิ์, ตัวเลือกพื้นฐาน, หน่วย
curl https://<โดเมน>/api/health                               # {"ok":true}
```
จากนั้นในระบบ:
1. ล็อกอิน admin → **เปลี่ยนรหัสผ่าน** (แก้ไขข้อมูลส่วนตัว) แล้วลบ `SEED_ADMIN_PASSWORD` ออกจาก `.env.production`
2. ตั้งค่า > ข้อมูลบริษัท (โลโก้, ที่อยู่, เลขผู้เสียภาษี — ใช้ในหน้าพิมพ์)
3. ตั้งค่า > ตั้งค่าคลัง (คลัง/สถานที่, หมวดหมู่, หน่วย, คุณสมบัติ), การอนุมัติ, หมายเหตุ
4. ผู้ใช้งาน: สร้างบัญชีพนักงาน + กำหนดสิทธิ์
5. นำเข้าข้อมูลเก่า — ดู [IMPORT.md](IMPORT.md)
6. LINE: webhook URL = `https://<โดเมน>/api/line/webhook` แล้วทำตาม README หัวข้อ "แจ้งเตือน LINE"

## 5. อัปเดตเวอร์ชัน

```bash
cd /opt/biowood-erp && git pull
docker compose -f docker-compose.prod.yml up -d --build      # migrate ใหม่อัตโนมัติก่อนแอปเริ่ม
docker image prune -f
```
- migration ล้มเหลว → แอปเวอร์ชันใหม่จะไม่เริ่ม (ตัวเก่าหยุดไปแล้ว) ดู `docker compose -f docker-compose.prod.yml logs migrate`
- สำรองข้อมูลก่อนอัปเดตที่มี migration เสมอ (ข้อ 6)

## 6. สำรองข้อมูล

```bash
sh deploy/backup.sh          # → backups/db-<เวลา>.dump + backups/uploads-<เวลา>.tar.gz (เก็บ 14 วัน)
crontab -e                   # 0 2 * * * cd /opt/biowood-erp && sh deploy/backup.sh >> backups/backup.log 2>&1
```
- **คัดลอกโฟลเดอร์ `backups/` ออกนอกเซิร์ฟเวอร์** (เช่น rclone ไป Google Drive / S3) — ถ้า VPS เสีย backup บนเครื่องก็หายด้วย
- Supabase มี backup รายวันของตัวเอง (แผน Pro ขึ้นไป) — ไฟล์แนบอยู่บน VPS เท่านั้น ต้องสำรองเอง
- กู้คืน:
  ```bash
  docker run --rm -v "$PWD/backups:/b" postgres:17-alpine pg_restore --no-owner --clean --if-exists -d "<DIRECT_URL>" /b/db-XXXX.dump
  docker run --rm -v biowood-erp_uploads:/data -v "$PWD/backups:/b" alpine sh -c "cd /data && tar xzf /b/uploads-XXXX.tar.gz"
  ```

## 7. ดูแลระบบ

| งาน | คำสั่ง |
|---|---|
| ดู log | `docker compose -f docker-compose.prod.yml logs -f app` |
| สถานะ | `docker compose -f docker-compose.prod.yml ps` (app ต้องเป็น healthy) |
| รีสตาร์ท | `docker compose -f docker-compose.prod.yml restart app` |
| เข้า shell เครื่องมือ | `docker compose -f docker-compose.prod.yml run --rm tools sh` |
| health check (monitoring ภายนอก เช่น UptimeRobot) | `GET https://<โดเมน>/api/health` → 200 `{"ok":true}` / 503 |

## หมายเหตุ

- **HTTPS จำเป็น**: เช็คอิน GPS บนมือถือใช้ได้เฉพาะ https; Caddy ออก/ต่ออายุใบรับรอง Let's Encrypt ให้อัตโนมัติ
- รันแอป **1 instance** (worker แจ้งเตือนทำงานในแอป ไฟล์แนบอยู่บน volume ของเครื่องนี้)
  ถ้าจะขยายหลายเครื่อง: ย้ายไฟล์แนบไป S3 (`src/lib/storage.ts`) และใช้ cron เรียก `/api/jobs/notifications` (ดู README)
- เวลาในระบบใช้ Asia/Bangkok ทั้งหมด (ไม่ขึ้นกับ timezone ของเซิร์ฟเวอร์)
- Image แอปรันด้วย user ที่ไม่ใช่ root; `.env.production` อ่านได้เฉพาะเจ้าของไฟล์
