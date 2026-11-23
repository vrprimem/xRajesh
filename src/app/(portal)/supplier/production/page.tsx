import type { Metadata } from "next";
import { DeliveryPlans } from "@/components/supplier/delivery-plans";
import { OutputChart } from "@/components/supplier/output-chart";
import { ProductionForm, ProductionLog, ReadyStockTable, RecipeEditor } from "@/components/supplier/production-panel";
import { Card, EmptyState, PageTitle, SectionHead } from "@/components/ui";
import { requirePortalUser } from "@/lib/auth";
import { formatNumber } from "@/lib/format";
import { loadProductionView } from "@/server/production-view";

export const metadata: Metadata = { title: "Production" };

/**
 * Production, for both of the supplier's logins: enter what was made, see each day's output, what is ready, when VRPRIME's
 * send plans can be ready and (owner) what each product uses. VRPRIME sees the same figures on its side.
 */
export default async function SupplierProductionPage() {
  const user = await requirePortalUser();
  const v = await loadProductionView(user.supplierId);
  if (!v.installed) return <EmptyState title="Not ready yet" body="Production is still being set up for your portal. Try again in a little while." />;
  const today = v.days.at(-1)?.units ?? 0;
  const week = v.days.slice(-7).reduce((sum, d) => sum + d.units, 0);

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Production" sub={`Today ${formatNumber(today)} units · last 7 days ${formatNumber(week)}`} />
      <ProductionForm products={v.ready} today={v.today} />
      <Card className="g-pad">
        <SectionHead title="Made each day" sub="Units of all products, the last 14 days." />
        <OutputChart days={v.days} today={v.today} title="Units made each day, the last 14 days" />
      </Card>
      <DeliveryPlans estimates={v.estimates} today={v.today} empty="No open send plan from VRPRIME right now." />
      <ReadyStockTable rows={v.ready} canCount />
      <ProductionLog entries={v.entries} products={v.ready} today={v.today} days={7} canRemove />
      <RecipeEditor products={v.ready} items={v.items} recipes={v.recipes} canEdit={user.role === "supplier_owner"} />
    </div>
  );
}
