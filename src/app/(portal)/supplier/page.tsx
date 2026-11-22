import type { Metadata } from "next";
import Link from "next/link";
import { DispatchStatusChip } from "@/components/supplier/dispatch-panel";
import { MonthCartons } from "@/components/supplier/dispatch-list";
import { PlanList } from "@/components/supplier/plan-list";
import { ProduceList } from "@/components/supplier/produce-list";
import { StockTable } from "@/components/supplier/stock-table";
import { Card, PageTitle, SectionHead, buttonClass } from "@/components/ui";
import { requirePortalUser } from "@/lib/auth";
import { formatDate, formatNumber, todayIST } from "@/lib/format";
import { CARTON_TYPE_LABEL, dispatchCounts } from "@/lib/supplier";
import { loadDispatches, loadPlans, loadProduce, loadStock } from "@/server/supplier-data";

export const metadata: Metadata = { title: "Supplier portal" };

/**
 * The supplier's one screen, most urgent first: what VRPRIME needs made, the next dispatch and how far its loading is,
 * cartons sent this month, and stock at VRPRIME. The warehouse person sees the dispatch part only.
 */
export default async function SupplierHome() {
  const user = await requirePortalUser();
  const owner = user.role === "supplier_owner";
  const [plans, produce, dispatches, stock] = await Promise.all([
    loadPlans(user.supplierId, true),owner ? loadProduce(user.supplierId) : [], loadDispatches(user.supplierId), owner ? loadStock(user.supplierId) : []]);
  const today = todayIST();
  const open = dispatches.filter((d) => d.status === "planned" || d.status === "loading").sort((a, b) => a.due_on.localeCompare(b.due_on));
  const next = open[0] ?? null;
  const counts = next ? dispatchCounts(next.lines, next.cartons) : null;
  const waiting = produce.filter((p) => p.status === "open").length + plans.filter((p) => p.status === "open").length;

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title={owner ? "Today" : "Dispatches"} sub={owner ? (waiting ? `${waiting} ${waiting === 1 ? "thing needs" : "things need"} your answer` : "Nothing is waiting for an answer") : "Scan every carton as it is loaded"} />

      <Card className="g-pad">
        <SectionHead title="What VRPRIME wants next" sub={owner ? "Make these, tell VRPRIME how far you are, and make the dispatch when ready." : "What VRPRIME has asked for next."} />
        {plans.length ? <PlanList plans={plans} who={owner ? "owner" : "scanner"} dispatchBase="/supplier/dispatches" /> : <p className="t-caption">No send plan from VRPRIME right now. You are told here, and by a notification, as soon as there is one.</p>}
      </Card>

      {owner ? (
        <Card className="g-pad">
          <SectionHead title="Produce now" sub="Products under their minimum at VRPRIME, counting what is already on the way." />
          {produce.length ? <ProduceList rows={produce} canAnswer /> : <p className="t-caption">Nothing is below its minimum. You are told here, and by a notification, as soon as something is.</p>}
        </Card>
      ) : null}

      <Card className="g-pad">
        <SectionHead
          title="Next dispatch"
          action={
            owner ? (
              <Link href="/supplier/dispatches/new" className={buttonClass("outline")}>
                New dispatch
              </Link>
            ) : undefined
          }
        />
        {next && counts ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[15px] font-semibold">Dispatch {next.number}</p>
              <DispatchStatusChip status={next.status} />
              <p className={`text-[13px] ${next.due_on < today ? "font-semibold text-bad" : "text-muted"}`}>
                {next.due_on < today ? "Overdue: was due " : next.due_on === today ? "Due today, " : "Due "}
                {formatDate(next.due_on)}
              </p>
            </div>
            <p className="text-[13px]">
              <span className="font-semibold tabular-nums">{formatNumber(counts.loaded)}</span> of {formatNumber(counts.planned)} cartons scanned · {CARTON_TYPE_LABEL.H} {formatNumber(counts.byType.H.loaded)}/{formatNumber(counts.byType.H.planned)} · {CARTON_TYPE_LABEL.T}{" "}
              {formatNumber(counts.byType.T.loaded)}/{formatNumber(counts.byType.T.planned)}
            </p>
            <div className="flex flex-wrap gap-2">
              <Link href={`/supplier/dispatches/${next.id}/scan`} className={buttonClass("primary")}>
                Scan cartons
              </Link>
              <Link href={`/supplier/dispatches/${next.id}`} className={buttonClass("outline")}>
                Open dispatch
              </Link>
            </div>
            {open.length > 1 ? (
              <p className="t-caption">
                {open.length - 1} more planned.{" "}
                <Link href="/supplier/dispatches" className="underline underline-offset-4">
                  See all dispatches
                </Link>
              </p>
            ) : null}
          </div>
        ) : (
          <p className="t-caption">No dispatch is planned.</p>
        )}
      </Card>

      <MonthCartons dispatches={dispatches} />
      {owner ? <StockTable rows={stock} canSetMin={false} /> : null}
    </div>
  );
}
