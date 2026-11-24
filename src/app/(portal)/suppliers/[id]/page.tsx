import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DispatchList, MonthCartons } from "@/components/supplier/dispatch-list";
import { PlanList } from "@/components/supplier/plan-list";
import { ProduceList } from "@/components/supplier/produce-list";
import { StockTable } from "@/components/supplier/stock-table";
import { EditSupplier, SupplierLogins, type SupplierLogin } from "@/components/supplier/supplier-admin";
import { Card, PageTitle, SectionHead, buttonClass } from "@/components/ui";
import { canManage, isOwner, requireUser } from "@/lib/auth";
import { getAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { SUPPLIER_ROLES } from "@/lib/types";
import { loadDispatches, loadPlans, loadProduce, loadProductPhotos, loadStock, loadSupplier, loadWarehouses } from "@/server/supplier-data";

export const metadata: Metadata = { title: "Supplier" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One supplier, as VRPRIME sees it: what is low, stock with the minimums to set, dispatches, and (owner) its logins. */
export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!canManage(user)) notFound();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supplier = await loadSupplier(id);
  if (!supplier) notFound();

  const supabase = await createClient();
  const [plans, stock, produce, dispatches, warehouses, logins, photos] = await Promise.all([
    loadPlans(id, false, 15),
    loadStock(id),
    loadProduce(id),
    loadDispatches(id),
    loadWarehouses(),
    isOwner(user) ? supabase.from("profiles").select("id, name, role, active").eq("supplier_id", id).in("role", [...SUPPLIER_ROLES]).order("name") : Promise.resolve({ data: [] }),
    loadProductPhotos(id),
  ]);
  const base = `/suppliers/${id}`;
  // Sign-in emails live in the login system, which only the server key can read; owner only.
  const loginRows = (logins.data ?? []) as Omit<SupplierLogin, "email">[];
  const emails = new Map<string, string | null>();
  if (isOwner(user) && loginRows.length) {
    const { admin } = getAdmin();
    if (admin) {
      await Promise.all(
        loginRows.map(async (l) => {
          const { data } = await admin.auth.admin.getUserById(l.id);
          emails.set(l.id, data?.user?.email ?? null);
        }),
      );
    }
  }
  const warehouse = warehouses.find((w) => w.id === supplier.warehouse_id)?.name ?? "Unknown warehouse";

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title={supplier.name}
        sub={supplier.active ? `Sends to ${warehouse}` : `Switched off · sends to ${warehouse}`}
        action={
          <>
            <Link href="/suppliers" className={buttonClass("row")}>
              All suppliers
            </Link>
            {isOwner(user) ? <EditSupplier supplier={supplier} warehouses={warehouses} /> : null}
            <Link href={`${base}/godown`} className={buttonClass("outline")}>
              Godown
            </Link>
            <Link href={`${base}/production`} className={buttonClass("outline")}>
              Production
            </Link>
            <Link href={`${base}/reports`} className={buttonClass("outline")}>
              Reports
            </Link>
            <Link href={`${base}/products`} className={buttonClass("outline")}>
              Products
            </Link>
            <Link href={`${base}/dispatches/new`} className={buttonClass("outline")}>
              New dispatch
            </Link>
            <Link href={`${base}/plans/new`} className={buttonClass("primary")}>
              New send plan
            </Link>
          </>
        }
      />

      <Card className="g-pad">
        <SectionHead
          title="Send plans"
          sub={`What you have asked ${supplier.name} to send next, and the answers.`}
          action={
            <Link href={`${base}/plans/new`} className={buttonClass("row")}>
              New send plan
            </Link>
          }
        />
        {plans.length ? <PlanList plans={plans} who="vrprime" dispatchBase={`${base}/dispatches`} photos={photos} /> : <p className="t-caption">No send plan yet. Make one to tell the supplier exactly what to send next, in whole cartons.</p>}
      </Card>

      <Card className="g-pad">
        <SectionHead title="Produce now" sub="What the supplier has been asked to make, and its answer." />
        {produce.length ? <ProduceList rows={produce} canAnswer={false} photos={photos} /> : <p className="t-caption">Nothing is below its minimum. Set a minimum per product below; it is checked after every stock sync.</p>}
      </Card>

      <StockTable rows={stock} warehouse={warehouse} canSetMin />

      <MonthCartons dispatches={dispatches} />
      <DispatchList dispatches={dispatches} base={`${base}/dispatches`} who="vrprime" photos={photos} warehouse={warehouse} emptyBody="Create a dispatch plan here, or let the supplier create one." />

      {isOwner(user) ? <SupplierLogins supplierId={id} supplierName={supplier.name} logins={loginRows.map((l) => ({ ...l, email: emails.get(l.id) ?? null }))} /> : null}
    </div>
  );
}
