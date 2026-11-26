import Link from "next/link";
import { FileBarChart } from "lucide-react";
import { requirePagePermission } from "@/lib/session";
import { REPORT_MODULES, type ReportModule } from "@/lib/reports";
import { todayBangkok } from "@/lib/stock-rules";
import { REPORTS, reportMeta } from "@/server/reports";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { ReportViewer } from "./report-viewer";

/** หน้ารายงานของโมดูล: เลือกรายงานจากรายการด้านซ้าย (?r=<key>) แล้วกรอง/ดูตัวอย่าง/Export CSV */
export async function ReportsPage({ module, searchParams }: { module: ReportModule; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const cfg = REPORT_MODULES[module];
  await requirePagePermission(cfg.menuKey, "view");
  const sp = await searchParams;
  const list = REPORTS[module];
  const selected = list.find((r) => r.key === sp.r) ?? list[0];
  const meta = await reportMeta(selected);

  return (
    <>
      <PageHeader title="รายงาน" breadcrumbs={[{ label: cfg.section }, { label: "รายงาน", href: cfg.href }, { label: selected.title }]} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <nav aria-label="รายการรายงาน" className="h-fit rounded-lg border bg-card p-1">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col">
            {list.map((r) => (
              <li key={r.key} className="shrink-0">
                <Link
                  href={`${cfg.href}?r=${r.key}`}
                  aria-current={r.key === selected.key ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted",
                    r.key === selected.key && "bg-primary/10 font-medium text-primary hover:bg-primary/10",
                  )}
                >
                  <FileBarChart className="size-4 shrink-0" />
                  {r.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <section className="min-w-0 space-y-3">
          <div>
            <h2 className="text-lg font-semibold">{meta.title}</h2>
            <p className="text-sm text-muted-foreground">{meta.description}</p>
          </div>
          <ReportViewer key={meta.key} module={module} meta={meta} today={todayBangkok()} />
        </section>
      </div>
    </>
  );
}
