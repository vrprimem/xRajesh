import type { Metadata } from "next";
import { ProductsPanel } from "@/components/supplier/products-panel";
import { PageTitle } from "@/components/ui";
import { requirePortalUser } from "@/lib/auth";
import { loadProducts } from "@/server/supplier-data";

export const metadata: Metadata = { title: "Products" };

export default async function SupplierProductsPage() {
  const user = await requirePortalUser();
  const products = await loadProducts(user.supplierId);
  return (
    <>
      <PageTitle title="Products" sub={`${products.filter((p) => p.active).length} active`} />
      <ProductsPanel supplierId={user.supplierId} products={products} canEdit={user.role === "supplier_owner"} />
    </>
  );
}
