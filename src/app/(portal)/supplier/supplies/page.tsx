import type { Metadata } from "next";
import { SuppliesPanel } from "@/components/supplier/supplies-panel";
import { EmptyState, PageTitle } from "@/components/ui";
import { requirePortalUser } from "@/lib/auth";
import { addDays, todayIST } from "@/lib/format";
import { supplyDaysLeft } from "@/lib/production";
import { isLow } from "@/lib/supplies";
import { loadItemMoves, loadItemStock } from "@/server/supplies-data";

export const metadata: Metadata = { title: "Supplies" };

/** Bottles, triggers, chemicals, cartons and the rest: stock, how long it lasts, counts. The owner adds and changes them. */
export default async function SupplierSuppliesPage() {
  const user = await requirePortalUser();
  const today = todayIST();
  const [stock, moves] = await Promise.all([loadItemStock(user.supplierId), loadItemMoves(user.supplierId, addDays(today, -29))]);
  if (!stock.installed) return <EmptyState title="Not ready yet" body="Supplies are still being set up for your portal. Try again in a little while." />;
  const inUse = stock.items.filter((i) => i.active);
  const low = inUse.filter(isLow).length;

  return (
    <>
      <PageTitle title="Supplies" sub={`${inUse.length} in use${low ? ` · ${low} running low` : ""}`} />
      <SuppliesPanel
        supplierId={user.supplierId}
        items={stock.items}
        moves={moves}
        daysLeft={Object.fromEntries(supplyDaysLeft(stock.items, moves, today, 30))}
        canEdit={user.role === "supplier_owner"}
        canCount
      />
    </>
  );
}
