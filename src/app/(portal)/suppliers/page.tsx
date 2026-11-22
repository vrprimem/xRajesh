import type { Metadata } from "next";
import Link from "next/link";
import { AddSupplier } from "@/components/supplier/supplier-admin";
import { SyncCard } from "@/components/supplier/sync-card";
import { Card, Chip, EmptyState, PageTitle } from "@/components/ui";
import { isOwner, requireUser } from "@/lib/auth";
import { loadSuppliers, loadSyncState, loadWarehouses } from "@/server/supplier-data";

export const metadata: Metadata = { title: "Suppliers" };

/** VRPRIME's home: the suppliers, each with its stock, minimums and dispatches, and the state of the stock sync. */
export default async function SuppliersPage() {
  const user = await requireUser();
  const [{ suppliers, installed }, warehouses, sync] = await Promise.all([loadSuppliers(), loadWarehouses(), loadSyncState()]);
  if (!installed) {
    return (
      <>
        <PageTitle title="Suppliers" />
        <EmptyState title="The database is not set up yet" body="Apply the three files in supabase/migrations to this Supabase project (see SETUP.md), then open this page again." />
      </>
    );
  }
  const name = (id: string) => warehouses.find((w) => w.id === id)?.name ?? "Unknown warehouse";
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Suppliers" sub="Stock they supply, minimums and dispatches" action={isOwner(user) && warehouses.length ? <AddSupplier warehouses={warehouses} /> : undefined} />
      <SyncCard state={sync} />
      {suppliers.length ? (
        <Card className="g-pad">
          <ul className="flex flex-col divide-y divide-line-soft">
            {suppliers.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
                <Link href={`/suppliers/${s.id}`} className="focus-ring text-[15px] font-semibold underline decoration-line underline-offset-4">
                  {s.name}
                </Link>
                <span className="flex items-center gap-2 text-[13px] text-muted">
                  Sends to {name(s.warehouse_id)}
                  {s.active ? null : <Chip tone="bad">Switched off</Chip>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <EmptyState
          title="No suppliers yet"
          body={
            !warehouses.length
              ? "First read the stock from the inventory software (Sync now): it brings the warehouses a supplier can send to."
              : isOwner(user)
                ? "Add the first supplier, then create its logins."
                : "The owner has not added a supplier yet."
          }
        />
      )}
    </div>
  );
}
