import type { Metadata } from "next";
import Link from "next/link";
import { DispatchStatusChip } from "@/components/supplier/dispatch-panel";
import { MonthCartons } from "@/components/supplier/dispatch-list";
import { PlanList } from "@/components/supplier/plan-list";
import { ProduceList } from "@/components/supplier/produce-list";
import { StockTable } from "@/components/supplier/stock-table";
import { StatTile } from "@/components/supplier/entry-kit";
import { Card, PageTitle, SectionHead, buttonClass } from "@/components/ui";
import { requirePortalUser } from "@/lib/auth";
import { addDays, formatDate, formatINR, formatNumber, noun, todayIST } from "@/lib/format";
import { dispatchCounts } from "@/lib/supplier";
import { isLow, staffItemName } from "@/lib/supplies";
import { loadDispatches, loadPlans, loadProduce, loadProductPhotos, loadStock } from "@/server/supplier-data";
import { loadItemStock, loadOwed, loadProduction } from "@/server/supplies-data";
import { ownerPage } from "@/server/staff-pages";

export const metadata: Metadata = { title: "Supplier portal" };

/**
 * The supplier's one screen, most urgent first: what VRPRIME needs made, the next dispatch and how far its loading is,
 * cartons sent this month, and stock at VRPRIME. The warehouse person sees the dispatch part only.
 */
export default async function SupplierHome() {
  const user = await requirePortalUser();
  ownerPage(user);
  const owner = user.role === "supplier_owner";
  const today = todayIST();
  const [plans, produce, dispatches, stock, photos, made, supplies, owed] = await Promise.all([
    loadPlans(user.supplierId, true),
    owner ? loadProduce(user.supplierId) : [],
    loadDispatches(user.supplierId),
    owner ? loadStock(user.supplierId) : [],
    loadProductPhotos(user.supplierId),
    loadProduction(user.supplierId, addDays(today, -6)),
    loadItemStock(user.supplierId),
    owner ? loadOwed(user.supplierId) : 0,
  ]);
  const madeToday = made.filter((e) => e.made_on === today).reduce((sum, e) => sum + e.units, 0);
  const madeWeek = made.reduce((sum, e) => sum + e.units, 0);
  const low = supplies.items.filter((i) => i.active && isLow(i));
  const open = dispatches.filter((d) => d.status === "planned" || d.status === "loading").sort((a, b) => a.due_on.localeCompare(b.due_on));
  const next = open[0] ?? null;
  const counts = next ? dispatchCounts(next.lines, next.cartons) : null;
  const waiting = produce.filter((p) => p.status === "open").length + plans.filter((p) => p.status === "open").length;

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title={owner ? "Today" : "Dispatches"} sub={owner ? (waiting ? `${waiting} ${waiting === 1 ? "thing needs" : "things need"} your answer` : "Nothing is waiting for an answer") : "Scan every carton as it is loaded"} />

      {supplies.installed ? (
        <Card className="g-pad">
          <SectionHead
            title="Your factory"
            action={
              <Link href="/supplier/production" className={buttonClass("primary")}>
                Enter production
              </Link>
            }
          />
          <div className="grid grid-cols-2 gap-x-3 gap-y-4 min-[700px]:grid-cols-4">
            <StatTile label="Made today" value={formatNumber(madeToday)} sub="pcs" />
            <StatTile label="Last 7 days" value={formatNumber(madeWeek)} sub="pcs" />
            <StatTile label="Supplies low" value={formatNumber(low.length)} sub={low.length ? low.slice(0, 2).map((i) => (owner ? i.name : staffItemName(i))).join(", ") + (low.length > 2 ? " ..." : "") : "none"} tone={low.length ? "bad" : undefined} />
            {owner ? <StatTile label="Owed to vendors" value={formatINR(owed)} sub={<Link href="/supplier/money" className="underline underline-offset-4">Money</Link>} tone={owed > 0 ? "bad" : undefined} /> : null}
          </div>
        </Card>
      ) : null}

      <Card className="g-pad">
        <SectionHead title="What VRPRIME wants next" sub={owner ? "Make these, tell VRPRIME how far you are, and make the dispatch when ready." : "What VRPRIME has asked for next."} />
        {plans.length ? <PlanList plans={plans} who={owner ? "owner" : "scanner"} dispatchBase="/supplier/dispatches" photos={photos} /> : <p className="t-caption">No send plan from VRPRIME right now. You are told here, and by a notification, as soon as there is one.</p>}
      </Card>

      {owner ? (
        <Card className="g-pad">
          <SectionHead title="Produce now" sub="Products under their minimum at VRPRIME, counting what is already on the way." />
          {produce.length ? <ProduceList rows={produce} canAnswer photos={photos} /> : <p className="t-caption">Nothing is below its minimum. You are told here, and by a notification, as soon as something is.</p>}
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
              <p className="text-[17px] font-semibold">Dispatch {next.number}</p>
              <DispatchStatusChip status={next.status} />
              <p className={`text-[15px] ${next.due_on < today ? "font-semibold text-bad" : "text-muted"}`}>
                {next.due_on < today ? "Overdue: was due " : next.due_on === today ? "Due today, " : "Due "}
                {formatDate(next.due_on)}
              </p>
            </div>
            <p className="text-[15px]">
              <span className="font-semibold tabular-nums">{formatNumber(counts.loaded)}</span> of {formatNumber(counts.planned)} {noun(counts.planned, "carton")} scanned
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
