"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { NOTIFY_MODULES } from "@/lib/notifications";
import type { NotificationItem } from "@/app/api/notifications/route";

const PAGE = 30;

export function NotificationsList({ initial, initialUnread }: { initial: NotificationItem[]; initialUnread: number }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [unread, setUnread] = useState(initialUnread);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [more, setMore] = useState(initial.length === PAGE);
  const [loading, setLoading] = useState(false);

  async function fetchPage(reset: boolean, unreadOnly = onlyUnread) {
    setLoading(true);
    try {
      const sp = new URLSearchParams({ limit: String(PAGE) });
      if (unreadOnly) sp.set("unread", "1");
      const last = items.at(-1);
      if (!reset && last) sp.set("before", last.createdAt);
      const res = await fetch(`/api/notifications?${sp}`, { cache: "no-store" });
      const d = (await res.json()) as { items: NotificationItem[]; unread: number };
      setItems((xs) => (reset ? d.items : [...xs, ...d.items]));
      setUnread(d.unread);
      setMore(d.items.length === PAGE);
    } finally {
      setLoading(false);
    }
  }

  async function markRead(body: { ids?: string[]; all?: boolean }) {
    const res = await fetch("/api/notifications/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) return;
    setUnread(((await res.json()) as { unread: number }).unread);
    const now = new Date().toISOString();
    setItems((xs) => xs.map((x) => (body.all || body.ids?.includes(x.id) ? { ...x, readAt: x.readAt ?? now } : x)));
    router.refresh();
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={onlyUnread ? "default" : "outline"}
            size="sm"
            onClick={() => {
              const next = !onlyUnread;
              setOnlyUnread(next);
              void fetchPage(true, next);
            }}
          >
            ยังไม่อ่าน ({unread})
          </Button>
          <span className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => markRead({ all: true })} disabled={!unread}>
            <CheckCheck /> อ่านทั้งหมด
          </Button>
        </div>
        <ul className="divide-y rounded-md border">
          {items.length === 0 && <li className="p-8 text-center text-sm text-muted-foreground">ไม่มีการแจ้งเตือน</li>}
          {items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className={cn("flex w-full gap-3 px-4 py-3 text-left hover:bg-muted", !n.readAt && "bg-primary/5")}
                onClick={async () => {
                  if (!n.readAt) await markRead({ ids: [n.id] });
                  if (n.link) router.push(n.link);
                }}
                data-testid="notification-row"
                data-unread={n.readAt ? "no" : "yes"}
              >
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-primary")} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block", !n.readAt && "font-semibold")}>{n.title}</span>
                  {n.body && <span className="block text-sm text-muted-foreground">{n.body}</span>}
                  <span className="block text-xs text-muted-foreground">
                    {NOTIFY_MODULES[n.module as keyof typeof NOTIFY_MODULES]?.label ?? n.module} · {formatDateTime(n.createdAt)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {more && (
          <div className="text-center">
            <Button variant="outline" onClick={() => fetchPage(false)} disabled={loading}>
              {loading ? "กำลังโหลด..." : "ดูเพิ่มเติม"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
