// เริ่ม background worker ตอนเซิร์ฟเวอร์เริ่ม (Node.js runtime เท่านั้น)
// ปิดได้ด้วย NOTIFY_WORKER=off (เช่น ถ้าใช้ cron ภายนอกเรียก /api/jobs/notifications แทน)
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NOTIFY_WORKER === "off") return;
  const { startNotificationWorker } = await import("./lib/notification-worker");
  startNotificationWorker();
}
