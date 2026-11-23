import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DispatchPanel } from "@/components/supplier/dispatch-panel";
import { PageTitle, buttonClass } from "@/components/ui";
import { canManage, requireUser } from "@/lib/auth";
import { loadDispatch, loadProductPhotos, loadSupplier } from "@/server/supplier-data";

export const metadata: Metadata = { title: "Dispatch" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A supplier's dispatch as VRPRIME sees it: read only, plus "Mark as received" once it is closed. */
export default async function SupplierDispatchPage({ params }: { params: Promise<{ id: string; dispatchId: string }> }) {
  const user = await requireUser();
  if (!canManage(user)) notFound();
  const { id, dispatchId } = await params;
  if (!UUID.test(id) || !UUID.test(dispatchId)) notFound();
  const [supplier, detail, photos] = await Promise.all([loadSupplier(id), loadDispatch(dispatchId), loadProductPhotos(id)]);
  if (!supplier || !detail || detail.dispatch.supplier_id !== id) notFound();
  return (
    <>
      <PageTitle
        title={`${supplier.name}: dispatch ${detail.dispatch.number}`}
        action={
          <Link href={`/suppliers/${id}`} className={buttonClass("row")}>
            Back to {supplier.name}
          </Link>
        }
      />
      <DispatchPanel detail={detail} who="vrprime" base={`/suppliers/${id}/dispatches`} photos={photos} />
    </>
  );
}
