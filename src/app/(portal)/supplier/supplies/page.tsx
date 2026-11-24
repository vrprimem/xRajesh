import type { Metadata } from "next";
import { SuppliesPanel } from "@/components/supplier/supplies-panel";
import { EmptyState, PageTitle } from "@/components/ui";
import { requirePortalUser } from "@/lib/auth";
import { addDays, todayIST } from "@/lib/format";
import { supplyDaysLeft } from "@/lib/production";
import { isLow } from "@/lib/supplies";
import { signedPhotos } from "@/server/supplier-data";
import { loadItemMoves, loadItemStock } from "@/server/supplies-data";
import { ownerPage } from "@/server/staff-pages";

export const metadata: Metadata = { title: "Supplies" };

/**
 * Bottles, triggers, chemicals, cartons and the rest: stock, how long it lasts, counts. The owner adds and changes them
 * (`?add=1` opens a new one).
 */
export default async function SupplierSuppliesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePortalUser();
  ownerPage(user);
  const today = todayIST();
  const [sp, stock, moves] = await Promise.all([searchParams, loadItemStock(user.supplierId), loadItemMoves(user.supplierId, addDays(today, -29))]);
  if (!stock.installed) return <EmptyState title="Not ready yet" body="Supplies are still being set up for your portal. Try again in a little while." />;
  const inUse = stock.items.filter((i) => i.active);
  const low = inUse.filter(isLow).length;
  const signed = await signedPhotos(stock.items.map((i) => i.photo_path));
  const photos = Object.fromEntries(stock.items.flatMap((i) => (i.photo_path && signed.get(i.photo_path) ? [[i.id, signed.get(i.photo_path) as string]] : [])));

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
        photos={photos}
        staff={user.role !== "supplier_owner"}
        startAdding={sp.add === "1"}
      />
    </>
  );
}
