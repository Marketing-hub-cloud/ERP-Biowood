import { ApiError, apiHandler } from "@/lib/api";
import { lookupSerial } from "@/server/goods-issues";

/** ข้อมูล SN + คงเหลือ สำหรับสแกนนำออก: ?barcode= */
export const GET = apiHandler({ perm: ["inventory.issue", "view"] }, async ({ req }) => {
  const barcode = (req.nextUrl.searchParams.get("barcode") ?? "").trim();
  if (!barcode) throw new ApiError(400, "กรุณาสแกน barcode");
  return lookupSerial(barcode);
});
