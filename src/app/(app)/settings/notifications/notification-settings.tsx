"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, RotateCcw, Send, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField } from "@/components/form-field";
import { AuditHistory } from "@/components/audit-history";
import { DataTable, type DataColumn } from "@/components/data-table/data-table";
import { api, ApiClientError, errorMessage } from "@/lib/client-api";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { NOTIFY_MODULES } from "@/lib/notifications";
import type { NotificationSettingsView } from "@/server/notification-settings";
import type { DeliveryRow } from "@/app/api/settings/notifications/route";

const MANUAL = "__manual__";
const NONE = "__none__";

const STATUS: Record<DeliveryRow["status"], { label: string; className: string }> = {
  PENDING: { label: "รอส่ง", className: "bg-amber-100 text-amber-800 hover:bg-amber-100" },
  SENDING: { label: "กำลังส่ง", className: "bg-sky-100 text-sky-800 hover:bg-sky-100" },
  SENT: { label: "ส่งแล้ว", className: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" },
  FAILED: { label: "ส่งไม่สำเร็จ", className: "bg-red-100 text-red-800 hover:bg-red-100" },
};

export function NotificationSettings({ initial, canEdit }: { initial: NotificationSettingsView; canEdit: boolean }) {
  const [data, setData] = useState(initial);
  const [reload, setReload] = useState(0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">การเชื่อมต่อ LINE Messaging API</CardTitle>
          <CardDescription>ค่าลับตั้งในไฟล์ .env ของเซิร์ฟเวอร์เท่านั้น (ไม่บันทึกในหน้าเว็บ) ดูวิธีตั้งค่าใน README หัวข้อ &quot;แจ้งเตือน LINE&quot;</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-3">
          <EnvStatus ok={data.tokenConfigured} label="LINE_CHANNEL_ACCESS_TOKEN" hint={data.tokenConfigured ? "พร้อมส่ง" : "ยังไม่ได้ตั้ง — ข้อความจะรอในคิวจนกว่าจะตั้งค่า"} />
          <EnvStatus ok={data.secretConfigured} label="LINE_CHANNEL_SECRET" hint={data.secretConfigured ? "ใช้ตรวจ webhook" : "ยังไม่ได้ตั้ง — ระบบจะไม่รู้จักกลุ่มที่บอทเข้าร่วม"} />
          <EnvStatus ok={data.baseUrlConfigured} label="APP_BASE_URL" hint={`ลิงก์ในข้อความ: ${data.baseUrl}`} />
          <p className="text-muted-foreground sm:col-span-3">
            Webhook URL สำหรับตั้งใน LINE Developers: <code className="rounded bg-muted px-1">{data.baseUrl}/api/line/webhook</code>
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {data.modules.map((m) => (
          <ModuleCard
            key={m.module}
            m={m}
            groups={data.groups}
            canEdit={canEdit}
            onSaved={(next) => {
              setData(next);
              setReload((n) => n + 1);
            }}
            onSent={() => setReload((n) => n + 1)}
          />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">ประวัติการส่ง LINE</CardTitle>
          <CardDescription>ส่งไม่สำเร็จจะลองใหม่อัตโนมัติ (1 นาที → 5 นาที → 15 นาที → 1 ชม. → 6 ชม.) ครบแล้วกด &quot;ส่งซ้ำ&quot; ได้</CardDescription>
        </CardHeader>
        <CardContent>
          <DeliveriesTable key={reload} canEdit={canEdit} />
        </CardContent>
      </Card>
    </div>
  );
}

function EnvStatus({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <div className={cn("flex items-start gap-2 rounded-md border p-2.5", ok ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50")} data-testid={`env-${label}`}>
      {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-700" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-700" />}
      <div className="min-w-0">
        <div className="font-mono text-xs font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
    </div>
  );
}

type ModuleView = NotificationSettingsView["modules"][number];

function ModuleCard({
  m,
  groups,
  canEdit,
  onSaved,
  onSent,
}: {
  m: ModuleView;
  groups: NotificationSettingsView["groups"];
  canEdit: boolean;
  onSaved: (d: NotificationSettingsView) => void;
  onSent: () => void;
}) {
  const known = groups.some((g) => g.groupId === m.lineGroupId);
  const [enabled, setEnabled] = useState(m.lineEnabled);
  const [mode, setMode] = useState<string>(m.lineGroupId ? (known ? m.lineGroupId : MANUAL) : groups.length ? NONE : MANUAL);
  const [manual, setManual] = useState(known ? "" : (m.lineGroupId ?? ""));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const groupId = mode === MANUAL ? manual.trim() : mode === NONE ? "" : mode;
  const dirty = enabled !== m.lineEnabled || (groupId || null) !== m.lineGroupId;

  async function save() {
    setBusy(true);
    try {
      const next = await api<NotificationSettingsView>("/api/settings/notifications", { method: "PUT", body: { module: m.module, lineEnabled: enabled, lineGroupId: groupId || null } });
      setError(undefined);
      toast.success(`บันทึกการแจ้งเตือน${m.label}แล้ว`);
      onSaved(next);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.fields.lineGroupId);
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const r = await api<{ tokenConfigured: boolean }>("/api/settings/notifications/test", { method: "POST", body: { module: m.module } });
      toast.success(r.tokenConfigured ? "ส่งข้อความทดสอบเข้าคิวแล้ว ตรวจผลในประวัติการส่ง" : "เข้าคิวแล้ว แต่ยังไม่ได้ตั้ง LINE token — ข้อความจะรอในคิว");
      onSent();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid={`notify-${m.module}`}>
      <CardHeader className="flex flex-row items-start gap-2 space-y-0">
        <div className="mr-auto space-y-1">
          <CardTitle className="text-base">{m.label}</CardTitle>
          <CardDescription>
            กลุ่ม LINE แนะนำ: &quot;{m.suggestedGroup}&quot;
          </CardDescription>
        </div>
        <AuditHistory entityType="NotificationSetting" entityId={m.module} />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Switch id={`enabled-${m.module}`} checked={enabled} onCheckedChange={setEnabled} disabled={!canEdit} />
          <Label htmlFor={`enabled-${m.module}`}>ส่งแจ้งเตือนเข้ากลุ่ม LINE</Label>
        </div>
        <FormField label="กลุ่ม LINE" htmlFor={`group-${m.module}`} error={error} hint={groups.length ? undefined : "ยังไม่มีกลุ่มที่บอทเข้าร่วม — เชิญบอทเข้ากลุ่ม (ต้องตั้ง webhook) หรือกรอก groupId เอง"}>
          <Select value={mode} onValueChange={setMode} disabled={!canEdit}>
            <SelectTrigger id={`group-${m.module}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {groups.length > 0 && <SelectItem value={NONE}>- เลือกกลุ่ม -</SelectItem>}
              {groups.map((g) => (
                <SelectItem key={g.groupId} value={g.groupId}>
                  {g.name ?? "(ไม่ทราบชื่อ)"} · {g.groupId.slice(0, 10)}…
                </SelectItem>
              ))}
              <SelectItem value={MANUAL}>กรอก groupId เอง</SelectItem>
            </SelectContent>
          </Select>
          {mode === MANUAL && (
            <Input
              aria-label={`groupId ${m.label}`}
              className="mt-2 font-mono"
              placeholder="C0123456789abcdef..."
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              disabled={!canEdit}
            />
          )}
        </FormField>
        {m.lineGroupName && <p className="text-xs text-muted-foreground">กลุ่มปัจจุบัน: {m.lineGroupName}</p>}
        {canEdit && (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" onClick={test} disabled={busy || dirty || !m.lineEnabled}>
              <Send /> ทดสอบส่ง
            </Button>
            <Button size="sm" onClick={save} disabled={busy || !dirty}>
              บันทึก
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DeliveriesTable({ canEdit }: { canEdit: boolean }) {
  const [tick, setTick] = useState(0);
  async function retry(id: string) {
    try {
      await api(`/api/settings/notifications/deliveries/${id}/retry`, { method: "POST" });
      toast.success("เข้าคิวส่งซ้ำแล้ว");
      setTick((n) => n + 1);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }
  const columns: DataColumn<DeliveryRow>[] = [
    { id: "createdAt", header: "เวลา", sortable: true, cell: (r) => <span className="whitespace-nowrap text-xs">{formatDateTime(r.createdAt)}</span> },
    { id: "module", header: "โมดูล", cell: (r) => NOTIFY_MODULES[r.module as keyof typeof NOTIFY_MODULES]?.label ?? r.module },
    {
      id: "message",
      header: "ข้อความ",
      cell: (r) => <span className="line-clamp-2 max-w-md whitespace-pre-line text-xs">{r.message}</span>,
    },
    {
      id: "status",
      header: "สถานะ",
      cell: (r) => (
        <div className="space-y-0.5" data-testid="delivery-status">
          <Badge className={STATUS[r.status].className}>{STATUS[r.status].label}</Badge>
          {r.attempts > 0 && <div className="text-xs text-muted-foreground">ส่งแล้ว {r.attempts} ครั้ง</div>}
          {r.status === "PENDING" && r.attempts > 0 && <div className="text-xs text-muted-foreground">ครั้งถัดไป {formatDateTime(r.nextAttemptAt)}</div>}
        </div>
      ),
    },
    { id: "lastError", header: "สาเหตุ", cell: (r) => <span className="line-clamp-2 max-w-xs text-xs text-destructive">{r.lastError ?? ""}</span> },
    {
      id: "actions",
      header: "",
      cell: (r) =>
        canEdit && (r.status === "FAILED" || r.status === "PENDING") ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              void retry(r.id);
            }}
          >
            <RotateCcw /> ส่งซ้ำ
          </Button>
        ) : null,
    },
  ];
  return (
    <DataTable<DeliveryRow>
      key={tick}
      endpoint="/api/settings/notifications"
      fixedParams={{ view: "deliveries" }}
      storageKey="line-deliveries"
      columns={columns}
      searchPlaceholder="ค้นหาข้อความ / สาเหตุ..."
      filters={[
        { id: "status", label: "สถานะ", options: Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label })) },
        { id: "module", label: "โมดูล", options: Object.entries(NOTIFY_MODULES).map(([value, m]) => ({ value, label: m.label })) },
      ]}
    />
  );
}
