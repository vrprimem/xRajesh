import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, buttonClass } from "@/components/ui";
import { requirePortalUser } from "@/lib/auth";
import { loadDispatches } from "@/server/supplier-data";

export const metadata: Metadata = { title: "Scan" };

/**
 * Scan, for the warehouse person's bottom bar: straight to the scanner of the dispatch being loaded, else the next one
 * due; a plain message when no dispatch is waiting.
 */
export default async function SupplierScanPage() {
  const user = await requirePortalUser();
  const open = (await loadDispatches(user.supplierId))
    .filter((d) => d.status === "planned" || d.status === "loading")
    .sort((a, b) => Number(b.status === "loading") - Number(a.status === "loading") || a.due_on.localeCompare(b.due_on));
  if (open[0]) redirect(`/supplier/dispatches/${open[0].id}/scan`);
  return (
    <EmptyState
      title="Nothing to scan"
      body="No dispatch is waiting to be loaded. When the owner plans one, scan its cartons here."
      action={
        <Link href="/supplier/dispatches" className={buttonClass("outline")}>
          See dispatches
        </Link>
      }
    />
  );
}
