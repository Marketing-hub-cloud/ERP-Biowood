"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { NotificationItem } from "@/app/api/notifications/route";

const POLL_MS = 30_000;

/** กระดิ่งแจ้งเตือน: ถามเซิร์ฟเวอร์ทุก 30 วินาที และทุกครั้งที่เปลี่ยนหน้า */
export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<NotificationItem[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=10", { cache: "no-store" });
      if (!res.ok) return;
      const d = (await res.json()) as { items: NotificationItem[]; unread: number };
      setItems(d.items);
      setUnread(d.unread);
    } catch {
      /* ลองใหม่รอบหน้า */
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- โหลดจาก server (setState หลัง fetch เสร็จ) ทุกครั้งที่เปลี่ยนหน้า
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [load, pathname]);

  async function markRead(body: { ids?: string[]; all?: boolean }) {
    const res = await fetch("/api/notifications/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) {
      const d = (await res.json()) as { unread: number };
      setUnread(d.unread);
      const now = new Date().toISOString();
      setItems((xs) => xs?.map((x) => (body.all || body.ids?.includes(x.id) ? { ...x, readAt: x.readAt ?? now } : x)) ?? null);
    }
  }

  async function openItem(n: NotificationItem) {
    setOpen(false);
    if (!n.readAt) await markRead({ ids: [n.id] });
    if (n.link) router.push(n.link);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) void load();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`การแจ้งเตือน ${unread} รายการ`} data-testid="notification-bell">
          <Bell />
          {unread > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white"
              data-testid="notification-badge"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <span className="mr-auto font-semibold">การแจ้งเตือน</span>
          {unread > 0 && (
            <Button variant="ghost" size="sm" onClick={() => markRead({ all: true })}>
              <CheckCheck /> อ่านทั้งหมด
            </Button>
          )}
        </div>
        <ul className="max-h-96 overflow-y-auto" data-testid="notification-list">
          {items === null && <li className="p-6 text-center text-sm text-muted-foreground">กำลังโหลด...</li>}
          {items?.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">ยังไม่มีการแจ้งเตือน</li>}
          {items?.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => openItem(n)}
                className={cn("flex w-full gap-2 border-b px-3 py-2.5 text-left text-sm hover:bg-muted", !n.readAt && "bg-primary/5")}
                data-unread={n.readAt ? "no" : "yes"}
              >
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-primary")} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block", !n.readAt && "font-semibold")}>{n.title}</span>
                  {n.body && <span className="block truncate text-muted-foreground">{n.body}</span>}
                  <span className="block text-xs text-muted-foreground">{formatDateTime(n.createdAt)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="p-2 text-center">
          <Button variant="link" size="sm" asChild onClick={() => setOpen(false)}>
            <Link href="/notifications">ดูทั้งหมด</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
