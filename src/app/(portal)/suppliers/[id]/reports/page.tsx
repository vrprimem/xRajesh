import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReportView } from "@/components/supplier/report-view";
import { buttonClass } from "@/components/ui";
import { canManage, requireUser } from "@/lib/auth";
import { todayIST } from "@/lib/format";
import { monthBounds } from "@/lib/report";
import { loadReport, loadSupplier } from "@/server/supplier-data";

export const metadata: Metadata = { title: "Supplier report" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A supplier's carton report, as VRPRIME sees it (owner and admin). */
export default async function SupplierReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (!canManage(user)) notFound();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const supplier = await loadSupplier(id);
  if (!supplier) notFound();
  const asked = typeof sp.month === "string" ? sp.month : "";
  const month = monthBounds(asked) && asked <= todayIST().slice(0, 7) ? asked : todayIST().slice(0, 7);
  const bounds = monthBounds(month)!;
  const data = await loadReport(id, bounds.from, bounds.to);
  return (
    <>
      <div className="mb-2">
        <Link href={`/suppliers/${id}`} className={buttonClass("row")}>
          Back to {supplier.name}
        </Link>
      </div>
      <ReportView data={data} month={month} base={`/suppliers/${id}/reports`} title={`${supplier.name}: carton report`} dispatchBase={`/suppliers/${id}/dispatches`} />
    </>
  );
}
