import { ApiError, apiHandler } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ALL_DOC_PREFIXES, previewDocNumber } from "@/lib/doc-number";

// เลขที่เอกสารถัดไป (แสดงในฟอร์ม + ปุ่มรีเฟรช) — ไม่จองเลข เลขจริงออกตอนบันทึก
export const GET = apiHandler({}, async ({ req }) => {
  const prefix = req.nextUrl.searchParams.get("prefix") ?? "";
  if (!ALL_DOC_PREFIXES.includes(prefix)) throw new ApiError(400, "ประเภทเอกสารไม่ถูกต้อง");
  return { number: await previewDocNumber(prisma, prefix) };
});
