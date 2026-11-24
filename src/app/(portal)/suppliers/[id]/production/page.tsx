import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DeliveryPlans } from "@/components/supplier/delivery-plans";
import { OutputChart } from "@/components/supplier/output-chart";
import { ProductionLog, ReadyStockTable } from "@/components/supplier/production-panel";
import { SuppliesPanel } from "@/components/supplier/supplies-panel";
import { Card, EmptyState, PageTitle, SectionHead, buttonClass } from "@/components/ui";
import { canManage, requireUser } from "@/lib/auth";
import { addDays, formatNumber } from "@/lib/format";
import { supplyDaysLeft } from "@/lib/production";
import { loadProductionView } from "@/server/production-view";
import { loadSupplier } from "@/server/supplier-data";
import { loadItemMoves } from "@/server/supplies-data";

export const metadata: Metadata = { title: "Supplier production" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * VRPRIME's view of a supplier's production, to look at only: what is made each day, what is ready, when the open send
 * plans can be ready, and the supplies behind them. The supplier's money is not here (the database never sends it).
 */
export default async function SupplierProductionView({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!canManage(user)) notFound();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supplier = await loadSupplier(id);
  if (!supplier) notFound();
  const v = await loadProductionView(id);
  const moves = v.installed ? await loadItemMoves(id, addDays(v.today, -29)) : [];
  const week = v.days.slice(-7).reduce((sum, d) => sum + d.units, 0);
  const back = (
    <Link href={`/suppliers/${id}`} className={buttonClass("row")}>
      Back to {supplier.name}
    </Link>
  );

  if (!v.installed) {
    return (
      <>
        <PageTitle title={`${supplier.name}: production`} action={back} />
        <EmptyState title="Not set up yet" body="Apply the production migrations (see SETUP.md) to see the supplier's production here." />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title={`${supplier.name}: production`} sub={`Today ${formatNumber(v.days.at(-1)?.units ?? 0)} units · last 7 days ${formatNumber(week)} · as the supplier enters it`} action={back} />
      <Card className="g-pad">
        <SectionHead title="Made each day" sub="Units of all products, the last 14 days." />
        <OutputChart days={v.days} today={v.today} title={`Units ${supplier.name} made each day, the last 14 days`} />
      </Card>
      <DeliveryPlans estimates={v.estimates} today={v.today} empty="No open send plan. Make one from the supplier's page; this shows when it can be ready." />
      <ReadyStockTable rows={v.ready} canCount={false} />
      <ProductionLog entries={v.entries} products={v.ready} today={v.today} canRemove={false} />
      <SuppliesPanel supplierId={id} items={v.items} moves={moves} daysLeft={Object.fromEntries(supplyDaysLeft(v.items, moves, v.today, 30))} canEdit={false} canCount={false} />
    </div>
  );
}
