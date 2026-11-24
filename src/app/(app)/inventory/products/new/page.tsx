import { requirePagePermission } from "@/lib/session";
import { can } from "@/lib/rbac";
import { getProductFormOptions } from "@/server/products";
import { PageHeader } from "@/components/page-header";
import { ProductForm } from "../product-form";

export const metadata = { title: "สร้างสินค้า" };

export default async function NewProductPage() {
  const user = await requirePagePermission("inventory.product", "create");
  const options = await getProductFormOptions();
  return (
    <>
      <PageHeader
        title="สร้างสินค้า"
        backHref="/inventory/products"
        breadcrumbs={[{ label: "คลังสินค้า" }, { label: "สินค้า", href: "/inventory/products" }, { label: "สร้างสินค้า" }]}
      />
      <ProductForm
        mode="create"
        options={options}
        images={[]}
        canEdit
        canAddType={can(user.permissions, "inventory.product", "create")}
        initial={{
          code: "",
          name: "",
          productTypeId: null,
          categoryId: null,
          description: "",
          isStockable: true,
          stockUnitId: null,
          isActive: true,
          attributes: {},
        }}
      />
    </>
  );
}
