import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DispatchForm } from "@/components/supplier/dispatch-form";
import { PageTitle } from "@/components/ui";
import { requirePortalUser } from "@/lib/auth";
import { addDays, todayIST } from "@/lib/format";
import { loadProductPhotos, loadProducts } from "@/server/supplier-data";

export const metadata: Metadata = { title: "New dispatch" };

export default async function NewDispatchPage() {
  const user = await requirePortalUser();
  if (user.role !== "supplier_owner") notFound();
  const [products, photos] = await Promise.all([loadProducts(user.supplierId), loadProductPhotos(user.supplierId)]);
  return (
    <>
      <PageTitle title="New dispatch" sub="Products and cartons going to VRPRIME" />
      <DispatchForm supplierId={user.supplierId} products={products} base="/supplier/dispatches" tomorrow={addDays(todayIST(), 1)} photos={photos} />
    </>
  );
}
