import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";

/** แสดงเมื่อเปิดเอกสาร/หน้าที่ไม่มีอยู่ (เช่น ลิงก์จากแจ้งเตือนของเอกสารที่ถูกลบ) */
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center" data-testid="not-found">
      <FileQuestion className="size-14 text-muted-foreground" />
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">ไม่พบเอกสารหรือหน้าที่ต้องการ</h1>
        <p className="text-sm text-muted-foreground">เอกสารนี้อาจถูกลบไปแล้ว หรือลิงก์ไม่ถูกต้อง</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild variant="outline">
          <Link href="/notifications">ไปที่การแจ้งเตือน</Link>
        </Button>
        <Button asChild>
          <Link href="/">กลับหน้าแรก</Link>
        </Button>
      </div>
    </div>
  );
}
