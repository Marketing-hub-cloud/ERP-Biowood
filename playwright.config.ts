import { defineConfig, devices } from "@playwright/test";
import "dotenv/config";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  // ล้างข้อมูลทดสอบก่อนเริ่ม/หลังจบ (ดู tests/e2e/cleanup.ts) — ตั้ง E2E_KEEP_DATA=1 เพื่อเก็บไว้ดู
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: { baseURL, trace: "retain-on-failure", locale: "th-TH", timezoneId: "Asia/Bangkok" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
