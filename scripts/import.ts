// นำเข้าข้อมูลเก่าจาก CSV (ดู docs/IMPORT.md)
//   npm run import -- templates [โฟลเดอร์]                      สร้างแม่แบบ CSV
//   npm run import -- <ชนิด> <ไฟล์.csv>                          ตรวจอย่างเดียว (dry run)
//   npm run import -- <ชนิด> <ไฟล์.csv> --commit [--date DD/MM/YYYY] [--as อีเมล]
import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { parseDate } from "@/lib/csv-parse";
import { adminPermissions } from "@/lib/rbac";
import { todayBangkok } from "@/lib/stock-rules";
import type { CurrentUser } from "@/lib/session";
import { errorsCsv, findImporter, IMPORTERS, runImport, templateCsv } from "@/server/import";

function usage(): never {
  console.log(`
ใช้งาน:
  npm run import -- templates [โฟลเดอร์]          สร้างแม่แบบ CSV (ค่าเริ่มต้น data/import-templates)
  npm run import -- <ชนิด> <ไฟล์.csv>             ตรวจข้อมูลอย่างเดียว ไม่เขียนฐานข้อมูล
  npm run import -- <ชนิด> <ไฟล์.csv> --commit    นำเข้าจริง (เมื่อไม่มี error)

ตัวเลือก:
  --date DD/MM/YYYY   วันที่ยอดยกมา (opening-stock) ค่าเริ่มต้น = วันนี้
  --as อีเมล          ผู้ทำรายการ (ต้องเป็น admin) ค่าเริ่มต้น = SEED_ADMIN_EMAIL

ชนิด (นำเข้าตามลำดับนี้):
${IMPORTERS.map((i, n) => `  ${n + 1}. ${i.kind.padEnd(16)} ${i.title}`).join("\n")}
`);
  process.exit(1);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function actor(email: string): Promise<CurrentUser> {
  const u = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!u || !u.isAdmin || u.status !== "ACTIVE") throw new Error(`ไม่พบผู้ดูแลระบบ ${email} (ต้องเป็น admin ที่ใช้งานอยู่)`);
  return { id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, department: u.department, position: u.position, avatarKey: u.avatarKey, isAdmin: true, permissions: adminPermissions() };
}

async function main() {
  const [cmd, file] = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !(i > 0 && all[i - 1].startsWith("--") && all[i - 1] !== "--commit"));
  if (!cmd) usage();

  if (cmd === "templates") {
    const dir = file ?? "data/import-templates";
    await mkdir(dir, { recursive: true });
    for (const imp of IMPORTERS) {
      const out = path.join(dir, `${imp.kind}.csv`);
      await writeFile(out, templateCsv(imp));
      console.log(`✔ ${out}  (${imp.title})`);
    }
    return;
  }

  const imp = findImporter(cmd);
  if (!imp || !file) usage();
  const dateArg = arg("--date");
  const date = dateArg ? parseDate(dateArg) : todayBangkok();
  if (!date) throw new Error(`--date ไม่ถูกต้อง: ${dateArg}`);
  const commit = process.argv.includes("--commit");
  const ctx = { actor: await actor(arg("--as") ?? process.env.SEED_ADMIN_EMAIL ?? "admin@biowood.local"), source: path.basename(file), date };

  console.log(`\n${imp.title} ← ${file}${commit ? "  [นำเข้าจริง]" : "  [ตรวจอย่างเดียว]"}`);
  const run = await runImport(imp, await readFile(file, "utf8"), ctx, commit);
  const s = run.summary;
  console.log(`ทั้งหมด ${s.total} แถว · นำเข้าได้ ${s.create} · ข้าม ${s.skip} · ผิดพลาด ${s.errors}`);
  for (const n of run.plan.notes) console.log(`  • ${n}`);
  const skips = run.plan.rows.filter((r) => r.action === "skip");
  if (skips.length) {
    console.log(`\nแถวที่ข้าม (มีอยู่แล้ว):`);
    for (const r of skips.slice(0, 20)) console.log(`  แถว ${r.row}: ${r.note}`);
    if (skips.length > 20) console.log(`  ... อีก ${skips.length - 20} แถว`);
  }
  if (run.plan.errors.length) {
    console.log(`\nข้อผิดพลาด:`);
    for (const e of run.plan.errors.slice(0, 50)) console.log(`  แถว ${e.row}${e.column ? ` [${e.column}]` : ""}: ${e.message}`);
    if (run.plan.errors.length > 50) console.log(`  ... อีก ${run.plan.errors.length - 50} รายการ`);
    const out = file.replace(/\.csv$/i, "") + ".errors.csv";
    await writeFile(out, errorsCsv(run.plan.errors));
    console.log(`\n✘ ยังไม่ได้นำเข้า — แก้ไฟล์ตามรายการ error (${out}) แล้วรันใหม่`);
    process.exitCode = 2;
    return;
  }
  if (!commit) {
    console.log(`\n✔ ไม่มีข้อผิดพลาด — รันซ้ำพร้อม --commit เพื่อนำเข้าจริง`);
    return;
  }
  console.log(`\n✔ นำเข้าแล้ว ${run.result!.created} รายการ (ข้าม ${run.result!.skipped})`);
  for (const n of run.result!.notes) console.log(`  • ${n}`);
}

main()
  .catch((e) => {
    console.error(`\n✘ ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
