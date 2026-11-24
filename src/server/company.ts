import "server-only";
import { prisma } from "@/lib/db";

export const ENTITY_COMPANY = "CompanySetting";

/** ข้อมูลบริษัท (singleton id=1) — ใช้ในหน้าพิมพ์เอกสารทุกชนิด */
export async function getCompany() {
  return (
    (await prisma.companySetting.findUnique({ where: { id: 1 } })) ?? {
      id: 1,
      nameTh: "",
      nameEn: null,
      address: null,
      taxId: null,
      branch: null,
      phone: null,
      email: null,
      website: null,
      logoKey: null,
      updatedAt: new Date(0),
    }
  );
}
