import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Godown } from "@/components/supplier/godown";
import { EmptyState, PageTitle, buttonClass } from "@/components/ui";
import { canManage, requireUser } from "@/lib/auth";
import { loadGodown } from "@/server/godown-data";
import { loadSupplier } from "@/server/supplier-data";

export const metadata: Metadata = { title: "Supplier godown" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** VRPRIME's look at a supplier's godown, read only: materials, ready cartons, what can still be made, today's entries. */
export default async function SupplierGodownView({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!canManage(user)) notFound();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [supplier, data] = await Promise.all([loadSupplier(id), loadGodown(id)]);
  if (!supplier) notFound();
  return (
    <>
      <PageTitle
        title={`${supplier.name}: godown`}
        action={
          <Link href={`/suppliers/${id}`} className={buttonClass("row")}>
            Back to {supplier.name}
          </Link>
        }
      />
      {!data.installed ? (
        <EmptyState title="Not ready yet" body="The godown tables are not in the database yet." />
      ) : (
        <Godown items={data.items} products={data.products} events={data.events} view="vrprime" />
      )}
    </>
  );
}
