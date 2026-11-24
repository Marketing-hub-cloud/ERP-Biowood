import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePagePermission } from "@/lib/session";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { flattenTree, type TreeNode } from "@/lib/tree";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ProductsTable } from "./products-table";

export const metadata = { title: "สินค้า" };

export default async function ProductsPage() {
  const user = await requirePagePermission("inventory.product", "view");
  const [types, categories] = await Promise.all([
    prisma.lookupOption.findMany({ where: { kind: "PRODUCT_TYPE" }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] }),
    prisma.productCategory.findMany(),
  ]);
  return (
    <>
      <PageHeader
        title="สินค้า"
        breadcrumbs={[{ label: "คลังสินค้า" }, { label: "สินค้า" }]}
        actions={
          can(user.permissions, "inventory.product", "create") && (
            <Button asChild>
              <Link href="/inventory/products/new">
                <Plus /> สร้างสินค้า
              </Link>
            </Button>
          )
        }
      />
      <ProductsTable
        types={types.map((t) => ({ value: t.id, label: t.label }))}
        categories={flattenTree(categories as TreeNode[]).map((c) => ({ value: c.id, label: `${"  ".repeat(c.level - 1)}${c.name}` }))}
      />
    </>
  );
}
