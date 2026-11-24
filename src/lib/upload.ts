import "server-only";
import type { NextRequest } from "next/server";
import { ApiError } from "./api";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, newKey, storage } from "./storage";

/** อ่านไฟล์รูปจาก multipart (ฟิลด์ "file") ตรวจชนิด/ขนาด แล้วบันทึกลง storage คืน key */
export async function saveImageUpload(req: NextRequest, folder: string): Promise<string> {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "กรุณาเลือกไฟล์");
  const ext = IMAGE_TYPES[file.type];
  if (!ext) throw new ApiError(400, "รองรับเฉพาะไฟล์รูปภาพ PNG, JPG, WEBP, GIF");
  if (file.size > MAX_IMAGE_BYTES) throw new ApiError(400, "ไฟล์ต้องมีขนาดไม่เกิน 5MB");
  const key = newKey(folder, ext);
  await storage.put(key, Buffer.from(await file.arrayBuffer()), file.type);
  return key;
}
