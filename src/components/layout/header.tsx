"use client";

import Link from "next/link";
import { useState } from "react";
import { KeyRound, LogOut, Menu, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import type { MenuSection } from "@/lib/menu";
import { BrandLogo, SidebarBrand, SidebarNav } from "./sidebar";
import { logoutAction } from "./actions";
import { NotificationBell } from "./notification-bell";

type Props = {
  menu: MenuSection[];
  user: { name: string; email: string; position: string | null; avatarUrl: string | null };
  /** จำนวนแจ้งเตือนที่ยังไม่อ่าน (ค่าเริ่มต้น กระดิ่งอัปเดตเองทุก 30 วินาที) */
  notificationCount: number;
};

export function Header({ menu, user, notificationCount }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const initials = user.name.trim().slice(0, 1) || "?";

  return (
    <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-card px-3 md:px-6">
      <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileOpen(true)} aria-label="เปิดเมนู">
        <Menu />
      </Button>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 bg-sidebar p-0 text-sidebar-foreground">
          <SheetTitle className="sr-only">เมนู</SheetTitle>
          <SidebarBrand />
          <div className="overflow-y-auto">
            <SidebarNav menu={menu} onNavigate={() => setMobileOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      {/* มือถือ: sidebar ซ่อนอยู่ จึงแสดงโลโก้ใน header แทน */}
      <Link href="/" className="md:hidden" aria-label="หน้าแรก">
        <BrandLogo className="h-8" />
      </Link>

      <div className="flex-1" />

      <NotificationBell initialUnread={notificationCount} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted" data-testid="user-menu">
            <Avatar className="size-8">
              {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
              <AvatarFallback className="bg-primary/15 text-primary">{initials}</AvatarFallback>
            </Avatar>
            <span className="hidden text-left text-sm leading-tight sm:block">
              <span className="block font-medium">{user.name}</span>
              {user.position && <span className="block text-xs text-muted-foreground">{user.position}</span>}
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <div className="font-medium">{user.name}</div>
            <div className="text-xs text-muted-foreground">{user.email}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/profile">
              <UserRound /> แก้ไขข้อมูลส่วนตัว
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/profile#password">
              <KeyRound /> เปลี่ยนรหัสผ่าน
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => logoutAction()}>
            <LogOut /> ออกจากระบบ
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
