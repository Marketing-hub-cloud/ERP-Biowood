import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/session";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fileUrl } from "@/lib/storage";
import { formatDateTime } from "@/lib/format";
import { getProductFormOptions, productInclude } from "@/server/products";
import { PageHeader } from "@/components/page-header";
import { AuditHistory } from "@/components/audit-history";
import { Badge } from "@/components/ui/badge";
import { ProductForm } from "../product-form";

export default async function ProductDetailPage({ params }: PageProps<"/inventory/products/[id]">) {
  const { id } = await params;
  const user = await requirePagePermission("inventory.product", "view");
  const p = await prisma.product.findFirst({ where: { id, deletedAt: null }, include: productInclude });
  if (!p) notFound();
  const options = await getProductFormOptions();
  const canEdit = can(user.permissions, "inventory.product", "edit");

  return (
    <>
      <PageHeader
        title={`${p.code} · ${p.name}`}
        backHref="/inventory/products"
        breadcrumbs={[{ label: "คลังสินค้า" }, { label: "สินค้า", href: "/inventory/products" }, { label: p.code }]}
        actions={
          <>
            {!p.isActive && <Badge variant="secondary">ปิดใช้งาน</Badge>}
            <span className="hidden text-xs text-muted-foreground sm:inline">แก้ไขล่าสุด {formatDateTime(p.updatedAt)}</span>
            <AuditHistory entityType="Product" entityId={p.id} />
          </>
        }
      />
      <ProductForm
        key={p.updatedAt.toISOString()}
        mode="edit"
        productId={p.id}
        options={options}
        images={p.images.map((i) => ({ id: i.id, url: fileUrl(i.key)! }))}
        canEdit={canEdit}
        canDelete={can(user.permissions, "inventory.product", "delete")}
        canAddType={canEdit}
        initial={{
          code: p.code,
          name: p.name,
          productTypeId: p.productTypeId,
          categoryId: p.categoryId,
          description: p.description ?? "",
          isStockable: p.isStockable,
          stockUnitId: p.stockUnitId,
          isActive: p.isActive,
          attributes: Object.fromEntries(p.attributeValues.map((a) => [a.attributeId, a.value])),
        }}
      />
    </>
  );
}
