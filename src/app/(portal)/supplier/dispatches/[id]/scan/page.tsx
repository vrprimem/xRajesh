import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Scanner } from "@/components/supplier/scanner";
import { requirePortalUser } from "@/lib/auth";
import { dispatchCounts } from "@/lib/supplier";
import { loadDispatch } from "@/server/supplier-data";

export const metadata: Metadata = { title: "Scan cartons" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ScanPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePortalUser();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const detail = await loadDispatch(id);
  if (!detail || detail.dispatch.supplier_id !== user.supplierId) notFound();
  const back = `/supplier/dispatches/${id}`;
  if (detail.dispatch.status !== "planned" && detail.dispatch.status !== "loading") redirect(back);
  const counts = dispatchCounts(detail.lines, detail.cartons);
  return (
    <Scanner
      dispatchId={id}
      number={detail.dispatch.number}
      backHref={back}
      planned={{ H: counts.byType.H.planned, T: counts.byType.T.planned }}
      cartons={detail.cartons.map((c) => ({ barcode: c.barcode, carton_no: c.carton_no, carton_type: c.carton_type, product: c.product, status: c.status }))}
    />
  );
}
