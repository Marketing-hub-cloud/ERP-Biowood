import { ReportsPage } from "@/components/reports/reports-page";

export const metadata = { title: "รายงาน" };

export default function Page({ searchParams }: PageProps<"/inventory/reports">) {
  return <ReportsPage module="inventory" searchParams={searchParams} />;
}
