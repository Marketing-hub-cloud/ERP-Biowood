import { ApiError, apiHandler } from "@/lib/api";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";
import { isInlineType } from "@/lib/engineer-workflow";
import { removeEngineerFile } from "@/server/engineer-docs";

type P = { id: string; fileId: string };

/** เปิด/ดาวน์โหลดไฟล์แนบ (ต้องมีสิทธิ์ดูใบถอดแบบ) — ?download=1 บังคับดาวน์โหลด */
export const GET = apiHandler<P>({ perm: ["engineer.document", "view"] }, async ({ req, params }) => {
  const f = await prisma.engineerFile.findFirst({ where: { id: params.fileId, docId: params.id } });
  if (!f) throw new ApiError(404, "ไม่พบไฟล์");
  const data = await storage.get(f.key);
  if (!data) throw new ApiError(404, "ไม่พบไฟล์");
  const inline = isInlineType(f.contentType) && req.nextUrl.searchParams.get("download") !== "1";
  const ascii = f.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(new Uint8Array(data.data), {
    headers: {
      "Content-Type": f.contentType,
      "Content-Length": String(data.data.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

/** ลบไฟล์แนบ (สิทธิ์เดียวกับการแนบ) */
export const DELETE = apiHandler<P>({ perm: ["engineer.document", "view"] }, async ({ user, params, ip }) => {
  const key = await removeEngineerFile(user, params.id, params.fileId, ip);
  await storage.remove(key);
  return { ok: true };
});
