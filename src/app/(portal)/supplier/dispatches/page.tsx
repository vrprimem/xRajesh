import type { Metadata } from "next";
import Link from "next/link";
import { DispatchList, MonthCartons } from "@/components/supplier/dispatch-list";
import { PageTitle, buttonClass } from "@/components/ui";
import { requirePortalUser } from "@/lib/auth";
import { loadDispatches, loadProductPhotos } from "@/server/supplier-data";

export const metadata: Metadata = { title: "Dispatches" };

export default async function SupplierDispatchesPage() {
  const user = await requirePortalUser();
  const owner = user.role === "supplier_owner";
  const [dispatches, photos] = await Promise.all([loadDispatches(user.supplierId), loadProductPhotos(user.supplierId)]);
  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Dispatches"
        sub="Cartons scanned against planned"
        action={
          owner ? (
            <Link href="/supplier/dispatches/new" className={buttonClass("primary")}>
              New dispatch
            </Link>
          ) : undefined
        }
      />
      <MonthCartons dispatches={dispatches} />
      <DispatchList dispatches={dispatches} base="/supplier/dispatches" who={owner ? "owner" : "scanner"} photos={photos} emptyBody={owner ? "Create a dispatch plan: its labels are made at once, one per carton." : "The owner has not planned a dispatch yet."} />
    </div>
  );
}
