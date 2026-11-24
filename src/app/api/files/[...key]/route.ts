import { ApiError, apiHandler } from "@/lib/api";
import { storage } from "@/lib/storage";

// ไฟล์ที่อัปโหลดทั้งหมด ต้องล็อกอินก่อนจึงเปิดได้
export const GET = apiHandler<{ key: string[] }>({}, async ({ params }) => {
  const key = params.key.map(decodeURIComponent).join("/");
  if (key.includes("..")) throw new ApiError(400, "invalid key");
  const file = await storage.get(key);
  if (!file) throw new ApiError(404, "ไม่พบไฟล์");
  return new Response(new Uint8Array(file.data), {
    headers: { "Content-Type": file.contentType, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" },
  });
});
