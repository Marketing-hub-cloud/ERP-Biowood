import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Fragment, type ReactNode } from "react";

export type Crumb = { label: string; href?: string };

type Props = {
  title: string;
  breadcrumbs?: Crumb[];
  /** แสดงปุ่ม "← ย้อนกลับ" ไปยัง href นี้ (หน้ารายละเอียด) */
  backHref?: string;
  actions?: ReactNode;
};

export function PageHeader({ title, breadcrumbs, backHref, actions }: Props) {
  return (
    <div className="mb-4 space-y-2">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumb>
          <BreadcrumbList>
            {breadcrumbs.map((c, i) => (
              <Fragment key={i}>
                {i > 0 && <BreadcrumbSeparator />}
                <BreadcrumbItem>
                  {c.href && i < breadcrumbs.length - 1 ? (
                    <BreadcrumbLink asChild>
                      <Link href={c.href}>{c.label}</Link>
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>{c.label}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {backHref && (
          <Button variant="outline" size="sm" asChild>
            <Link href={backHref}>
              <ArrowLeft /> ย้อนกลับ
            </Link>
          </Button>
        )}
        <h1 className="flex-1 text-xl font-semibold">{title}</h1>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
