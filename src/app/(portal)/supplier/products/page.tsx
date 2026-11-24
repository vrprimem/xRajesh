import type { Metadata } from "next";
import { ProductsPanel } from "@/components/supplier/products-panel";
import { PageTitle } from "@/components/ui";
import { requirePortalUser } from "@/lib/auth";
import { loadProductPhotos, loadProducts } from "@/server/supplier-data";
import { ownerPage } from "@/server/staff-pages";

export const metadata: Metadata = { title: "Products" };

/** The supplier's products. The owner adds and changes them, and adds a photo of each (`?add=1` opens a new one). */
export default async function SupplierProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePortalUser();
  ownerPage(user);
  const [sp, products, photos] = await Promise.all([searchParams, loadProducts(user.supplierId), loadProductPhotos(user.supplierId)]);
  const owner = user.role === "supplier_owner";
  return (
    <>
      <PageTitle title="Products" sub={`${products.filter((p) => p.active).length} active`} />
      <ProductsPanel supplierId={user.supplierId} products={products} canEdit={owner} photos={photos} ownPhotos={owner} startAdding={sp.add === "1"} />
    </>
  );
}
