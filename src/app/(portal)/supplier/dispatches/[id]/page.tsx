import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DispatchPanel } from "@/components/supplier/dispatch-panel";
import { PageTitle, buttonClass } from "@/components/ui";
import { requirePortalUser } from "@/lib/auth";
import { loadDispatch, loadProductPhotos, loadProducts } from "@/server/supplier-data";

export const metadata: Metadata = { title: "Dispatch" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SupplierDispatchPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePortalUser();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const owner = user.role === "supplier_owner";
  // The owner can add products to a dispatch still being loaded, so the products come along for them.
  const [detail, photos, products] = await Promise.all([loadDispatch(id), loadProductPhotos(user.supplierId), owner ? loadProducts(user.supplierId) : Promise.resolve([])]);
  // Another supplier's dispatch is simply not found: the database returns nothing for it.
  if (!detail || detail.dispatch.supplier_id !== user.supplierId) notFound();
  return (
    <>
      <PageTitle
        title={`Dispatch ${detail.dispatch.number}`}
        action={
          <Link href="/supplier/dispatches" className={buttonClass("row")}>
            All dispatches
          </Link>
        }
      />
      <DispatchPanel detail={detail} who={owner ? "owner" : "scanner"} base="/supplier/dispatches" photos={photos} products={products} />
    </>
  );
}
