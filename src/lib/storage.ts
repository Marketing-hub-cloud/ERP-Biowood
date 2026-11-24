// Storage abstraction: dev เก็บที่ local disk, production เปลี่ยนเป็น S3-compatible ได้
// (เพิ่ม S3Storage ที่ implement interface เดียวกัน แล้วเลือกจาก env STORAGE_DRIVER)
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface Storage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ data: Buffer; contentType: string } | null>;
  remove(key: string): Promise<void>;
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
};

class LocalStorage implements Storage {
  constructor(private root: string) {}

  private resolve(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("invalid storage key");
    return full;
  }

  async put(key: string, data: Buffer) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  async get(key: string) {
    try {
      const data = await readFile(this.resolve(key));
      const contentType = MIME_BY_EXT[path.extname(key).toLowerCase()] ?? "application/octet-stream";
      return { data, contentType };
    } catch {
      return null;
    }
  }

  async remove(key: string) {
    try {
      await unlink(this.resolve(key));
    } catch {
      /* ไม่มีไฟล์ก็ไม่เป็นไร */
    }
  }
}

export const storage: Storage = new LocalStorage(process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads"));

export const IMAGE_TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function newKey(folder: string, ext: string) {
  return `${folder}/${randomUUID()}${ext}`;
}

export function fileUrl(key: string | null | undefined): string | null {
  return key ? `/api/files/${key}` : null;
}
