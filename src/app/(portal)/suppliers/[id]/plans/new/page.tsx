import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PlanForm } from "@/components/supplier/plan-form";
import { PageTitle } from "@/components/ui";
import { canManage, requireUser } from "@/lib/auth";
import { addDays, todayIST } from "@/lib/format";
import { loadStock, loadSupplier } from "@/server/supplier-data";

export const metadata: Metadata = { title: "New send plan" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** VRPRIME tells a supplier what to send next. Owner and admin. */
export default async function NewPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!canManage(user)) notFound();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supplier = await loadSupplier(id);
  if (!supplier) notFound();
  const rows = await loadStock(id);
  return (
    <>
      <PageTitle title={`${supplier.name}: new send plan`} sub="Tell the supplier what to make and send next" />
      <PlanForm supplierId={id} supplierName={supplier.name} rows={rows} defaultDue={addDays(todayIST(), 3)} back={`/suppliers/${id}`} />
    </>
  );
}
