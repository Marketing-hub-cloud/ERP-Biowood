import { ApiError, apiHandler } from "@/lib/api";
import { newKey, storage } from "@/lib/storage";
import { checkEngineerFile, ENGINEER_FILE_TYPES, fileExt, FILE_KIND_LABELS, type EngineerFileKind } from "@/lib/engineer-workflow";
import { addEngineerFile, assertCanAttach } from "@/server/engineer-docs";

type P = { id: string };

/** อัปโหลดไฟล์แนบ (multipart: kind, file) — สิทธิ์ละเอียดตรวจใน server (แก้ไข หรือผู้รับผิดชอบสำหรับเอกสารส่งกลับ) */
export const POST = apiHandler<P>({ perm: ["engineer.document", "view"] }, async ({ req, user, params, ip }) => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ApiError(400, "อัปโหลดไม่สำเร็จ (ไฟล์อาจใหญ่เกินไป)");
  }
  const kind = form.get("kind");
  if (typeof kind !== "string" || !(kind in FILE_KIND_LABELS)) throw new ApiError(400, "ประเภทไฟล์แนบไม่ถูกต้อง");
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "กรุณาเลือกไฟล์");
  const fileName = file.name.replace(/[\\/]/g, "_").slice(0, 255) || "file";
  const err = checkEngineerFile(fileName, file.size);
  if (err) throw new ApiError(400, err);
  await assertCanAttach(user, params.id, kind as EngineerFileKind);

  const ext = fileExt(fileName);
  const contentType = ENGINEER_FILE_TYPES[ext];
  const key = newKey(`engineer/${params.id}`, ext);
  await storage.put(key, Buffer.from(await file.arrayBuffer()), contentType);
  try {
    const f = await addEngineerFile(user, params.id, { kind: kind as EngineerFileKind, key, fileName, contentType, size: file.size }, ip);
    return { id: f.id };
  } catch (e) {
    await storage.remove(key);
    throw e;
  }
});
