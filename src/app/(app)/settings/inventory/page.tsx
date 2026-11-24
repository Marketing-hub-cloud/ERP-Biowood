import { requirePagePermission } from "@/lib/session";
import { can } from "@/lib/rbac";
import { getInventorySettings } from "@/server/inventory-settings";
import { PageHeader } from "@/components/page-header";
import { InventorySettingsTabs } from "./settings-tabs";

export const metadata = { title: "ตั้งค่าคลัง" };

export default async function InventorySettingsPage({ searchParams }: PageProps<"/settings/inventory">) {
  const user = await requirePagePermission("settings.inventory", "view");
  const data = await getInventorySettings();
  const { tab } = await searchParams;
  return (
    <>
      <PageHeader title="ตั้งค่าคลัง" breadcrumbs={[{ label: "ตั้งค่า" }, { label: "ตั้งค่าคลัง" }]} />
      <InventorySettingsTabs data={data} canEdit={can(user.permissions, "settings.inventory", "edit")} initialTab={typeof tab === "string" ? tab : "locations"} />
    </>
  );
}
