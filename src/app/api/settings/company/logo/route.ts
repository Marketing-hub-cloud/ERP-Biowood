import { ApiError, apiHandler } from "@/lib/api";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, newKey, storage } from "@/lib/storage";
import { ENTITY_COMPANY } from "@/server/company";

export const POST = apiHandler({ perm: ["settings.company", "edit"] }, async ({ req, user, ip }) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "กรุณาเลือกไฟล์");
  const ext = IMAGE_TYPES[file.type];
  if (!ext) throw new ApiError(400, "รองรับเฉพาะไฟล์รูปภาพ PNG, JPG, WEBP, GIF");
  if (file.size > MAX_IMAGE_BYTES) throw new ApiError(400, "ไฟล์ต้องมีขนาดไม่เกิน 5MB");

  const key = newKey("company", ext);
  await storage.put(key, Buffer.from(await file.arrayBuffer()), file.type);

  const before = await prisma.companySetting.findUnique({ where: { id: 1 } });
  await prisma.$transaction(async (tx) => {
    const after = await tx.companySetting.upsert({
      where: { id: 1 },
      create: { id: 1, nameTh: "", logoKey: key },
      update: { logoKey: key },
    });
    await writeAudit(tx, { actorId: user.id, entityType: ENTITY_COMPANY, entityId: "1", action: "UPDATE", before, after, note: "เปลี่ยนโลโก้", ip });
  });
  if (before?.logoKey) await storage.remove(before.logoKey);
  return { logoKey: key };
});

export const DELETE = apiHandler({ perm: ["settings.company", "edit"] }, async ({ user, ip }) => {
  const before = await prisma.companySetting.findUnique({ where: { id: 1 } });
  if (!before?.logoKey) return { ok: true };
  await prisma.$transaction(async (tx) => {
    const after = await tx.companySetting.update({ where: { id: 1 }, data: { logoKey: null } });
    await writeAudit(tx, { actorId: user.id, entityType: ENTITY_COMPANY, entityId: "1", action: "UPDATE", before, after, note: "ลบโลโก้", ip });
  });
  await storage.remove(before.logoKey);
  return { ok: true };
});
