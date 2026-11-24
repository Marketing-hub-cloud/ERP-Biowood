import "server-only";
import { prisma } from "@/lib/db";
import { fullName } from "@/lib/format";

/** รายชื่อผู้ใช้สำหรับเลือก (เช่น สมาชิกกลุ่มสิทธิ์, ผู้เกี่ยวข้อง) */
export async function getUserOptions() {
  const users = await prisma.user.findMany({
    select: { id: true, firstName: true, lastName: true, email: true, department: true, status: true },
    orderBy: [{ status: "asc" }, { firstName: "asc" }],
  });
  return users.map((u) => ({ id: u.id, name: fullName(u), email: u.email, department: u.department, inactive: u.status !== "ACTIVE" }));
}
