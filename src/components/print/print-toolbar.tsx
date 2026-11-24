"use client";

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** แถบด้านบนของหน้าพิมพ์ (ไม่แสดงตอนพิมพ์) */
export function PrintToolbar({ backHref, title }: { backHref: string; title: string }) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background px-4 py-3 print:hidden">
      <Button variant="ghost" size="sm" asChild>
        <Link href={backHref}>
          <ArrowLeft /> ย้อนกลับ
        </Link>
      </Button>
      <span className="mr-auto font-semibold">{title}</span>
      <Button onClick={() => window.print()}>
        <Printer /> พิมพ์
      </Button>
    </div>
  );
}
