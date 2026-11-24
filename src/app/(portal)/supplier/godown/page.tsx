import type { Metadata } from "next";
import { GodownLive } from "@/components/supplier/godown-live";
import { EmptyState } from "@/components/ui";
import { requirePortalUser } from "@/lib/auth";
import { loadGodown } from "@/server/godown-data";

export const metadata: Metadata = { title: "Godown" };

/**
 * The godown, for both of the supplier's logins: every material and finished product as a picture with a big number,
 * and three big buttons (goods in, made today, count) in Hindi, Marathi or English. The owner also sees what can still
 * be made. Materials, their packs and photos, and recipes are set up on Supplies and Production.
 */
export default async function SupplierGodownPage() {
  const user = await requirePortalUser();
  const data = await loadGodown(user.supplierId);
  if (!data.installed) return <EmptyState title="Not ready yet" body="The godown is still being set up for your portal. Try again in a little while." />;
  if (!data.items.length && !data.products.length) {
    return <EmptyState title="Nothing in the godown yet" body={user.role === "supplier_owner" ? "Add your materials on Supplies first: bottles, triggers, stickers, liquids and cartons, with what each comes in." : "The owner has not added the materials yet."} />;
  }
  return <GodownLive supplierId={user.supplierId} items={data.items} products={data.products} events={data.events} view={user.role === "supplier_owner" ? "owner" : "staff"} />;
}
