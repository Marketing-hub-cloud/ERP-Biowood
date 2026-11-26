#!/bin/sh
# สำรองข้อมูล: ฐานข้อมูล (pg_dump จาก Supabase) + ไฟล์แนบ (volume uploads)
# ใช้บนเซิร์ฟเวอร์ (โฟลเดอร์โปรเจกต์) — ตั้ง cron วันละครั้ง เช่น
#   0 2 * * * cd /opt/biowood-erp && sh deploy/backup.sh >> backups/backup.log 2>&1
# เก็บไว้ KEEP_DAYS วัน (ค่าเริ่มต้น 14) — ควรคัดลอกโฟลเดอร์ backups ออกนอกเซิร์ฟเวอร์ด้วย
set -eu
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M)"
OUT="backups"
mkdir -p "$OUT"

DIRECT_URL="$(grep -E '^DIRECT_URL=' .env.production | cut -d= -f2- | tr -d '"')"
[ -n "$DIRECT_URL" ] || { echo "ไม่พบ DIRECT_URL ใน .env.production"; exit 1; }

echo "[$STAMP] pg_dump..."
docker run --rm -e DATABASE="$DIRECT_URL" -v "$PWD/$OUT:/out" postgres:17-alpine \
  sh -c 'pg_dump --no-owner --no-privileges -Fc "$DATABASE" -f /out/db-'"$STAMP"'.dump'

echo "[$STAMP] uploads..."
docker run --rm -v biowood-erp_uploads:/data:ro -v "$PWD/$OUT:/out" alpine \
  tar czf "/out/uploads-$STAMP.tar.gz" -C /data .

find "$OUT" -name 'db-*.dump' -mtime +"$KEEP_DAYS" -delete
find "$OUT" -name 'uploads-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
echo "[$STAMP] เสร็จ: $OUT/db-$STAMP.dump, $OUT/uploads-$STAMP.tar.gz"
