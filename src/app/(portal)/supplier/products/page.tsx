import type { Metadata } from "next";
import { RecipeEditor } from "@/components/supplier/production-panel";
import { ProductsPanel } from "@/components/supplier/products-panel";
import { PageTitle } from "@/components/ui";
import { requirePortalUser } from "@/lib/auth";
import { loadProductPhotos, loadProducts } from "@/server/supplier-data";
import { ownerPage } from "@/server/staff-pages";
import { loadItemStock, loadReadyStock, loadRecipes } from "@/server/supplies-data";

export const metadata: Metadata = { title: "Products" };

/**
 * The supplier's products. The owner adds and changes them, adds a photo of each (`?add=1` opens a new one), and says
 * what each uses (its recipe), which "Made today" at the godown takes off the supplies.
 */
export default async function SupplierProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePortalUser();
  ownerPage(user);
  const [sp, products, photos, ready, stock, recipes] = await Promise.all([
    searchParams,
    loadProducts(user.supplierId),
    loadProductPhotos(user.supplierId),
    loadReadyStock(user.supplierId),
    loadItemStock(user.supplierId),
    loadRecipes(user.supplierId),
  ]);
  const owner = user.role === "supplier_owner";
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Products" sub={`${products.filter((p) => p.active).length} active`} />
      <ProductsPanel supplierId={user.supplierId} products={products} canEdit={owner} photos={photos} ownPhotos={owner} startAdding={sp.add === "1"} />
      {ready.installed && stock.installed ? <RecipeEditor products={ready.rows} items={stock.items} recipes={recipes} canEdit={owner} /> : null}
    </div>
  );
}
