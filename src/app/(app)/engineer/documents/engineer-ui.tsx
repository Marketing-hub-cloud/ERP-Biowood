"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Download, FileText, Pencil, Plus, Trash2, Upload, UserPlus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ContactPicker } from "@/components/contact-picker";
import { cn } from "@/lib/utils";
import { api, errorMessage } from "@/lib/client-api";
import { formatDateTime, formatNumber } from "@/lib/format";
import {
  ENGINEER_FILE_ACCEPT,
  ENGINEER_STATUS_LABELS,
  engineerStepper,
  FILE_KIND_LABELS,
  checkEngineerFile,
  type EngineerFileKind,
  type EngineerStatus,
} from "@/lib/engineer-workflow";
import type { ContactOption } from "@/app/api/contact-options/route";
import type { ContactAddressOption } from "@/app/api/contact-options/[id]/route";

const STATUS_CLASS: Partial<Record<EngineerStatus, string>> = {
  DRAFT: "bg-amber-100 text-amber-800 hover:bg-amber-100",
  NEW: "bg-sky-100 text-sky-800 hover:bg-sky-100",
  REVIEWED: "bg-sky-100 text-sky-800 hover:bg-sky-100",
  QUEUED: "bg-indigo-100 text-indigo-800 hover:bg-indigo-100",
  ASSIGNED: "bg-violet-100 text-violet-800 hover:bg-violet-100",
  IN_PROGRESS: "bg-violet-100 text-violet-800 hover:bg-violet-100",
  INSPECTION: "bg-orange-100 text-orange-800 hover:bg-orange-100",
  ESTIMATE: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
  COMPLETED: "bg-emerald-600 text-white hover:bg-emerald-600",
  CANCELLED: "bg-muted text-muted-foreground line-through hover:bg-muted",
};

export function EngineerStatusBadge({ status }: { status: EngineerStatus }) {
  return <Badge className={STATUS_CLASS[status]}>{ENGINEER_STATUS_LABELS[status]}</Badge>;
}

export function UrgentBadge() {
  return <Badge className="bg-red-600 text-white hover:bg-red-600">ด่วน</Badge>;
}

/** stepper 9 ขั้นที่หัวเอกสาร */
export function EngineerStepper({ status, reached }: { status: EngineerStatus; reached?: EngineerStatus | null }) {
  const steps = engineerStepper(status, reached ?? null);
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 text-xs sm:text-sm" aria-label="ขั้นตอนเอกสาร" data-testid="engineer-stepper">
      {steps.map((s, i) => (
        <li key={s.status} className="flex items-center gap-1">
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1",
              s.state === "done" && "border-primary/40 bg-primary/10 text-primary",
              s.state === "current" && "border-primary bg-primary font-medium text-primary-foreground",
              s.state === "todo" && "text-muted-foreground",
            )}
          >
            {s.state === "done" ? <Check className="size-3.5" /> : <span className="tabular-nums">{i + 1}</span>}
            <span data-state={s.state} aria-current={s.state === "current" ? "step" : undefined}>
              {s.label}
            </span>
          </span>
          {i < steps.length - 1 && <span className="h-px w-2 bg-border sm:w-4" />}
        </li>
      ))}
      {status === "CANCELLED" && <EngineerStatusBadge status="CANCELLED" />}
    </ol>
  );
}

export type StepEntry = { id: string; fromStatus: EngineerStatus | null; toStatus: EngineerStatus; actorName: string; comment: string | null; createdAt: string };

/** ประวัติการเปลี่ยนขั้น */
export function StepTimeline({ steps }: { steps: StepEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">ประวัติขั้นตอน</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="relative space-y-3 border-l pl-4 text-sm" data-testid="engineer-steps">
          {steps.map((s) => (
            <li key={s.id} className="relative">
              <span className={cn("absolute top-1.5 -left-[21px] size-2.5 rounded-full", s.toStatus === "CANCELLED" ? "bg-destructive" : "bg-primary")} />
              <div className="font-medium">
                {s.fromStatus ? (
                  <>
                    {ENGINEER_STATUS_LABELS[s.fromStatus]} → {ENGINEER_STATUS_LABELS[s.toStatus]}
                  </>
                ) : (
                  "สร้างเอกสาร"
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {s.actorName} · {formatDateTime(s.createdAt)}
              </div>
              {s.comment && <p className="mt-0.5 text-muted-foreground">{s.comment}</p>}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

export type UserOption = { id: string; name: string; department: string | null; avatarUrl: string | null; inactive: boolean };

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join("");

export function UserAvatar({ user, className }: { user: Pick<UserOption, "name" | "avatarUrl">; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Avatar className={cn("size-8 ring-2 ring-background", className)}>
          {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
          <AvatarFallback className="bg-primary/15 text-xs text-primary">{initials(user.name)}</AvatarFallback>
        </Avatar>
      </TooltipTrigger>
      <TooltipContent>{user.name}</TooltipContent>
    </Tooltip>
  );
}

/** ผู้เกี่ยวข้อง: แสดงเป็น avatar + ปุ่มเพิ่ม/เอาออก */
export function ParticipantPicker({
  value,
  onChange,
  users,
  disabled,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  users: UserOption[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const byId = new Map(users.map((u) => [u.id, u]));
  const selected = value.map((id) => byId.get(id)).filter(Boolean) as UserOption[];
  const candidates = users.filter((u) => (!u.inactive || value.includes(u.id)) && (!q || u.name.toLowerCase().includes(q.toLowerCase())));

  return (
    <div className="flex flex-wrap items-center gap-1" data-testid="participants">
      {selected.length === 0 && disabled && <span className="text-sm text-muted-foreground">-</span>}
      <div className="flex -space-x-2">
        {selected.map((u) => (
          <UserAvatar key={u.id} user={u} />
        ))}
      </div>
      {!disabled && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="icon" className="size-8 rounded-full" aria-label="เลือกผู้เกี่ยวข้อง">
              <UserPlus />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-2">
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อ..." className="mb-2 h-8" aria-label="ค้นหาผู้ใช้" />
            <div role="listbox" aria-multiselectable className="max-h-64 overflow-y-auto">
              {candidates.map((u) => {
                const on = value.includes(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => onChange(on ? value.filter((x) => x !== u.id) : [...value, u.id])}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <Check className={cn("size-4", on ? "opacity-100" : "opacity-0")} />
                    <span className="flex-1 truncate">{u.name}</span>
                    {u.department && <span className="text-xs text-muted-foreground">{u.department}</span>}
                  </button>
                );
              })}
              {candidates.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">ไม่พบผู้ใช้</p>}
            </div>
          </PopoverContent>
        </Popover>
      )}
      {!disabled && selected.length > 0 && (
        <span className="ml-1 text-xs text-muted-foreground">{selected.map((u) => u.name).join(", ")}</span>
      )}
    </div>
  );
}

export type CustomerValue = { contact: ContactOption | null; addressLabel: string; siteAddress: string };

/** ลูกค้า: กดดินสอ > เลือกลูกค้า > เลือกที่อยู่ (จัดส่ง/จดทะเบียน) > เพิ่ม */
export function CustomerBox({ value, onChange, disabled, error }: { value: CustomerValue; onChange: (v: CustomerValue) => void; disabled?: boolean; error?: string }) {
  const [open, setOpen] = useState(false);
  const [contact, setContact] = useState<ContactOption | null>(value.contact);
  const [addresses, setAddresses] = useState<ContactAddressOption[]>([]);
  const [addrKey, setAddrKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !contact) return;
    let cancelled = false;
    fetch(`/api/contact-options/${contact.id}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d: ContactAddressOption[]) => {
        if (cancelled) return;
        setAddresses(d);
        setAddrKey((k) => (k && d.some((a) => a.key === k) ? k : (d[0]?.key ?? null)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, contact]);

  function openDialog() {
    setContact(value.contact);
    setAddresses([]);
    setAddrKey(null);
    setOpen(true);
  }

  function apply() {
    const a = addresses.find((x) => x.key === addrKey);
    onChange({ contact, addressLabel: a?.label ?? "", siteAddress: a?.text ?? "" });
    setOpen(false);
  }

  return (
    <div className={cn("rounded-md border p-3", error && "border-destructive")} data-testid="customer-box">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 text-sm">
          {value.contact ? (
            <>
              <div className="font-medium">
                <span className="font-mono text-xs text-muted-foreground">{value.contact.code}</span> {value.contact.name}
              </div>
              {value.addressLabel && <div className="mt-1 text-xs text-muted-foreground">{value.addressLabel}</div>}
            </>
          ) : (
            <span className="text-muted-foreground">ยังไม่ได้เลือกลูกค้า</span>
          )}
        </div>
        {!disabled && (
          <Button type="button" variant="outline" size="icon-sm" onClick={openDialog} aria-label="เลือกลูกค้า">
            <Pencil />
          </Button>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>เลือกลูกค้า</DialogTitle>
            <DialogDescription>เลือกลูกค้า แล้วเลือกที่อยู่ที่จะใช้ในใบถอดแบบ</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <ContactPicker
              id="customerPicker"
              value={contact}
              role="customer"
              onChange={(c) => {
                setContact(c);
                setAddresses([]);
                setAddrKey(null);
              }}
            />
            {contact && (
              <div role="radiogroup" aria-label="ที่อยู่" className="space-y-2">
                {addresses.length === 0 && <p className="text-sm text-muted-foreground">ผู้ติดต่อนี้ยังไม่มีที่อยู่</p>}
                {addresses.map((a) => (
                  <label key={a.key} className={cn("flex cursor-pointer gap-2 rounded-md border p-2 text-sm", addrKey === a.key && "border-primary bg-primary/5")}>
                    <input type="radio" name="addr" className="mt-1 accent-primary" checked={addrKey === a.key} onChange={() => setAddrKey(a.key)} />
                    <span>
                      <span className="block font-medium">{a.label}</span>
                      <span className="block text-muted-foreground">{a.text}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            {value.contact && (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto text-destructive"
                onClick={() => {
                  onChange({ contact: null, addressLabel: "", siteAddress: "" });
                  setOpen(false);
                }}
              >
                <X /> เอาลูกค้าออก
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              ปิด
            </Button>
            <Button type="button" onClick={apply} disabled={!contact}>
              <Plus /> เพิ่ม
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export type FileEntry = { id: string; kind: EngineerFileKind; fileName: string; size: number; uploadedBy: string; createdAt: string };

function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${formatNumber(n / 1024, 0)} KB`;
  return `${formatNumber(n / 1024 / 1024, 1)} MB`;
}

/** ไฟล์แนบ 1 ประเภท: รายการ + ลากวาง/เลือกไฟล์เพื่ออัปโหลด */
export function FilesPanel({
  docId,
  kind,
  files,
  canManage,
  hint,
}: {
  docId: string | null;
  kind: EngineerFileKind;
  files: FileEntry[];
  canManage: boolean;
  hint?: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const list = files.filter((f) => f.kind === kind);

  async function upload(fileList: FileList | File[]) {
    if (!docId) return;
    const all = Array.from(fileList);
    if (!all.length) return;
    setBusy(true);
    let ok = 0;
    try {
      for (const f of all) {
        const err = checkEngineerFile(f.name, f.size);
        if (err) {
          toast.error(`${f.name}: ${err}`);
          continue;
        }
        const fd = new FormData();
        fd.append("kind", kind);
        fd.append("file", f);
        try {
          await api(`/api/engineer/documents/${docId}/files`, { method: "POST", body: fd });
          ok++;
        } catch (e) {
          toast.error(`${f.name}: ${errorMessage(e)}`);
        }
      }
      if (ok) toast.success(`แนบไฟล์${FILE_KIND_LABELS[kind]} ${ok} ไฟล์แล้ว`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(f: FileEntry) {
    if (!confirm(`ลบไฟล์ "${f.fileName}" ?`)) return;
    setBusy(true);
    try {
      await api(`/api/engineer/documents/${docId}/files/${f.id}`, { method: "DELETE" });
      toast.success("ลบไฟล์แล้ว");
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2" data-testid={`files-${kind}`}>
      <div className="text-sm font-medium">{FILE_KIND_LABELS[kind]}</div>
      {list.length === 0 && !canManage && <p className="text-sm text-muted-foreground">ไม่มีไฟล์</p>}
      {list.length > 0 && (
        <ul className="divide-y rounded-md border">
          {list.map((f) => (
            <li key={f.id} className="flex items-center gap-2 px-2 py-1.5 text-sm" data-testid="engineer-file">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <a href={`/api/engineer/documents/${docId}/files/${f.id}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-primary hover:underline">
                {f.fileName}
              </a>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {formatSize(f.size)} · {f.uploadedBy} · {formatDateTime(f.createdAt)}
              </span>
              <Button asChild variant="ghost" size="icon-sm" aria-label={`ดาวน์โหลด ${f.fileName}`}>
                <a href={`/api/engineer/documents/${docId}/files/${f.id}?download=1`}>
                  <Download />
                </a>
              </Button>
              {canManage && (
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => remove(f)} disabled={busy} aria-label={`ลบ ${f.fileName}`}>
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && docId && (
        <button
          type="button"
          className={cn(
            "flex w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed bg-muted/40 p-4 text-center text-xs text-muted-foreground hover:bg-muted",
            drag && "border-primary bg-primary/5",
          )}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            void upload(e.dataTransfer.files);
          }}
          disabled={busy}
        >
          <Upload className="size-5" />
          {busy ? "กำลังอัปโหลด..." : `ลากไฟล์${FILE_KIND_LABELS[kind]}มาวาง หรือคลิกเพื่อเลือก`}
          <span>PDF, รูป, DWG, DXF, SKP, Excel, Word, ZIP · ไม่เกิน 25MB ต่อไฟล์</span>
        </button>
      )}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ENGINEER_FILE_ACCEPT}
        className="hidden"
        data-testid={`file-input-${kind}`}
        onChange={(e) => {
          if (e.target.files) void upload(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
