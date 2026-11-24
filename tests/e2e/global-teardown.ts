import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { cleanupTestData, restoreCompany } from "./cleanup";

export default async function globalTeardown() {
  if (process.env.E2E_KEEP_DATA === "1") return console.log("[e2e] E2E_KEEP_DATA=1 — เก็บข้อมูลทดสอบไว้");
  const startedAt = new Date(await readFile(path.join(process.cwd(), "tests", "e2e", ".auth", "started-at.txt"), "utf8"));
  const n = await cleanupTestData();
  await restoreCompany(startedAt);
  console.log("[e2e] ลบข้อมูลทดสอบแล้ว:", n);
}
