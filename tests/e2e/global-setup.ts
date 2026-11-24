import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { cleanupTestData, snapshotApproval, snapshotCompany } from "./cleanup";

export default async function globalSetup() {
  const left = await cleanupTestData();
  const total = Object.values(left).reduce((a, b) => a + b, 0);
  if (total) console.log("[e2e] ล้างข้อมูลทดสอบที่ค้างจากรอบก่อน:", left);
  await snapshotCompany();
  await snapshotApproval();
  const dir = path.join(process.cwd(), "tests", "e2e", ".auth");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "started-at.txt"), new Date().toISOString());
}
