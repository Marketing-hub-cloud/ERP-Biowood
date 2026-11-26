import { ReportsPage } from "@/components/reports/reports-page";

export const metadata = { title: "รายงาน" };

export default function Page({ searchParams }: PageProps<"/purchase/reports">) {
  return <ReportsPage module="purchase" searchParams={searchParams} />;
}
