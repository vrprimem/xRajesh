import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductsPanel } from "@/components/supplier/products-panel";
import { PageTitle, buttonClass } from "@/components/ui";
import { canManage, requireUser } from "@/lib/auth";
import { loadProductPhotos, loadProducts, loadSupplier } from "@/server/supplier-data";

export const metadata: Metadata = { title: "Supplier products" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SupplierProductsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!canManage(user)) notFound();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supplier = await loadSupplier(id);
  if (!supplier) notFound();
  // VRPRIME sets the photos of the master SKUs here: those alone, not the supplier's own.
  const [products, photos] = await Promise.all([loadProducts(id), loadProductPhotos(id, { masterOnly: true })]);
  return (
    <>
      <PageTitle
        title={`${supplier.name}: products`}
        sub={`${products.filter((p) => p.active).length} active`}
        action={
          <Link href={`/suppliers/${id}`} className={buttonClass("row")}>
            Back to {supplier.name}
          </Link>
        }
      />
      <ProductsPanel supplierId={id} products={products} canEdit photos={photos} canPhoto />
    </>
  );
}
