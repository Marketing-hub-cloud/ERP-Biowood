import { ReportsPage } from "@/components/reports/reports-page";

export const metadata = { title: "รายงาน" };

export default function Page({ searchParams }: PageProps<"/crm/reports">) {
  return <ReportsPage module="crm" searchParams={searchParams} />;
}
