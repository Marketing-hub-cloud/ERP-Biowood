"use client";

import { useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { InventorySettings } from "@/server/inventory-settings";
import { TreeEditor } from "./tree-editor";
import { UnitsEditor } from "./units-editor";
import { AttributesEditor } from "./attributes-editor";

const TABS = [
  ["locations", "สถานที่จัดเก็บ"],
  ["categories", "หมวดหมู่สินค้า"],
  ["units", "หน่วย"],
  ["attributes", "คุณสมบัติ"],
] as const;

export function InventorySettingsTabs({ data, canEdit, initialTab }: { data: InventorySettings; canEdit: boolean; initialTab: string }) {
  const router = useRouter();
  const valid = TABS.some(([k]) => k === initialTab) ? initialTab : "locations";
  return (
    <Tabs
      defaultValue={valid}
      onValueChange={(t) => router.replace(`/settings/inventory?tab=${t}`, { scroll: false })}
      className="gap-4"
    >
      <TabsList className="flex-wrap">
        {TABS.map(([k, label]) => (
          <TabsTrigger key={k} value={k}>
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="locations">
        <TreeEditor kind="locations" nodes={data.locations} usage={data.usage.locations} canEdit={canEdit} />
      </TabsContent>
      <TabsContent value="categories">
        <TreeEditor kind="categories" nodes={data.categories} usage={data.usage.categories} canEdit={canEdit} />
      </TabsContent>
      <TabsContent value="units">
        <UnitsEditor units={data.units} usage={data.usage.units} canEdit={canEdit} />
      </TabsContent>
      <TabsContent value="attributes">
        <AttributesEditor attributes={data.attributes} usage={data.usage.attributes} canEdit={canEdit} />
      </TabsContent>
    </Tabs>
  );
}
