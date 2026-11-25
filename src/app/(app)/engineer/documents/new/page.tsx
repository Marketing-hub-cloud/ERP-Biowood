import { requirePagePermission } from "@/lib/session";
import { todayBangkok } from "@/lib/stock-rules";
import { getEngineerFormOptions } from "@/server/engineer-docs";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EngineerForm } from "../engineer-form";

export const metadata = { title: "สร้างใบถอดแบบ/ติดตั้ง" };

export default async function NewEngineerDocPage() {
  const user = await requirePagePermission("engineer.document", "create");
  const options = await getEngineerFormOptions();
  return (
    <>
      <PageHeader
        title="สร้างใบถอดแบบ/ติดตั้ง"
        backHref="/engineer/documents"
        breadcrumbs={[{ label: "ถอดแบบ/ติดตั้ง" }, { label: "ใบถอดแบบ/ติดตั้ง", href: "/engineer/documents" }, { label: "สร้างใหม่" }]}
      />
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_22rem]">
        <EngineerForm
          doc={null}
          options={options}
          canEdit
          canCancel={false}
          advance={null}
          initial={{
            docDate: todayBangkok(),
            startDate: "",
            dueDate: "",
            revision: "1",
            workTypes: ["SURVEY"],
            workDetail: "",
            projectName: "",
            urgency: "NORMAL",
            customer: null,
            addressLabel: "",
            siteAddress: "",
            assigneeId: "",
            participantIds: [user.id],
            note: "",
            estimateLines: [],
          }}
        />
        <Card className="h-fit">
          <CardContent className="pt-6 text-sm text-muted-foreground">บันทึกร่างก่อน จึงจะแนบไฟล์ &quot;แบบจากลูกค้า&quot; ได้</CardContent>
        </Card>
      </div>
    </>
  );
}
