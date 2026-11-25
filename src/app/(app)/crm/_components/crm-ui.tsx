import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PROJECT_STATUS_LABELS, projectStepper, WORK_PLAN_STATUS_LABELS, type ProjectStatus, type WorkPlanStatus } from "@/lib/crm";

const PROJECT_CLASS: Record<ProjectStatus, string> = {
  NEW: "bg-sky-100 text-sky-800 hover:bg-sky-100",
  IN_PROGRESS: "bg-indigo-100 text-indigo-800 hover:bg-indigo-100",
  QUOTED: "bg-amber-100 text-amber-800 hover:bg-amber-100",
  WON: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
  CLOSED: "bg-emerald-600 text-white hover:bg-emerald-600",
  AFTERCARE: "bg-teal-100 text-teal-800 hover:bg-teal-100",
  ENGINEERING: "bg-violet-100 text-violet-800 hover:bg-violet-100",
  SHIPPING: "bg-orange-100 text-orange-800 hover:bg-orange-100",
  PAYMENT: "bg-lime-100 text-lime-800 hover:bg-lime-100",
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return <Badge className={PROJECT_CLASS[status]}>{PROJECT_STATUS_LABELS[status]}</Badge>;
}

/** stepper แนวนอนของสถานะโครงการ */
export function ProjectStepper({ status }: { status: ProjectStatus }) {
  const steps = projectStepper(status);
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 text-xs sm:text-sm" aria-label="สถานะโครงการ" data-testid="project-stepper">
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
            <span aria-current={s.state === "current" ? "step" : undefined}>{s.label}</span>
          </span>
          {i < steps.length - 1 && <span className="h-px w-2 bg-border sm:w-4" />}
        </li>
      ))}
    </ol>
  );
}

export const PLAN_CLASS: Record<WorkPlanStatus, string> = {
  PLANNED: "bg-sky-100 text-sky-800 hover:bg-sky-100",
  CHECKED_IN: "bg-amber-100 text-amber-800 hover:bg-amber-100",
  DONE: "bg-emerald-600 text-white hover:bg-emerald-600",
  CANCELLED: "bg-muted text-muted-foreground line-through hover:bg-muted",
};

export function PlanStatusBadge({ status }: { status: WorkPlanStatus }) {
  return <Badge className={PLAN_CLASS[status]}>{WORK_PLAN_STATUS_LABELS[status]}</Badge>;
}
