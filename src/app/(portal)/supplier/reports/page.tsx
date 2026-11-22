import type { Metadata } from "next";
import { ReportView } from "@/components/supplier/report-view";
import { requirePortalUser } from "@/lib/auth";
import { todayIST } from "@/lib/format";
import { monthBounds } from "@/lib/report";
import { loadReport } from "@/server/supplier-data";

export const metadata: Metadata = { title: "Reports" };

/** The supplier's carton report for a month. */
export default async function SupplierReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePortalUser();
  const sp = await searchParams;
  const asked = typeof sp.month === "string" ? sp.month : "";
  const month = monthBounds(asked) && asked <= todayIST().slice(0, 7) ? asked : todayIST().slice(0, 7);
  const bounds = monthBounds(month)!;
  const data = await loadReport(user.supplierId, bounds.from, bounds.to);
  return <ReportView data={data} month={month} base="/supplier/reports" title="Carton report" dispatchBase="/supplier/dispatches" />;
}
