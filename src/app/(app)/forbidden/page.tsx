import Link from "next/link";
import { ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata = { title: "ไม่มีสิทธิ์ใช้งาน" };

export default function ForbiddenPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <ShieldX className="size-12 text-destructive" />
      <h1 className="text-xl font-semibold">ไม่มีสิทธิ์ใช้งาน (403)</h1>
      <p className="text-sm text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงหน้านี้ กรุณาติดต่อผู้ดูแลระบบ</p>
      <Button asChild variant="outline">
        <Link href="/">กลับหน้าแรก</Link>
      </Button>
    </div>
  );
}
