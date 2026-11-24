import Link from "next/link";
import { requireUser } from "@/lib/session";
import { visibleMenu } from "@/lib/rbac";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function HomePage() {
  const user = await requireUser();
  const menu = visibleMenu(user.permissions);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">สวัสดี คุณ{user.firstName}</h1>
        <p className="text-sm text-muted-foreground">เลือกเมนูที่ต้องการใช้งาน</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {menu.map((s) => (
          <Card key={s.key}>
            <CardHeader>
              <CardTitle className="text-base">{s.label}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {s.items.map((i) => (
                <Link key={i.key} href={i.href} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
                  {i.label}
                </Link>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
