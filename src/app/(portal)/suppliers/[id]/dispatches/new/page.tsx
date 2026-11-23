import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DispatchForm } from "@/components/supplier/dispatch-form";
import { PageTitle } from "@/components/ui";
import { canManage, requireUser } from "@/lib/auth";
import { addDays, todayIST } from "@/lib/format";
import { loadProductPhotos, loadProducts, loadSupplier } from "@/server/supplier-data";

export const metadata: Metadata = { title: "New dispatch" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewSupplierDispatchPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!canManage(user)) notFound();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supplier = await loadSupplier(id);
  if (!supplier) notFound();
  const [products, photos] = await Promise.all([loadProducts(id), loadProductPhotos(id)]);
  return (
    <>
      <PageTitle title={`${supplier.name}: new dispatch`} sub="The supplier prints the labels and scans the cartons" />
      <DispatchForm supplierId={id} products={products} base={`/suppliers/${id}/dispatches`} tomorrow={addDays(todayIST(), 1)} photos={photos} />
    </>
  );
}
