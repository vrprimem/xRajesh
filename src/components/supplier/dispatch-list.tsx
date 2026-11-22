import Link from "next/link";
import { DispatchStatusChip } from "@/components/supplier/dispatch-panel";
import { Card, EmptyState } from "@/components/ui";
import { formatDate, formatNumber, todayIST } from "@/lib/format";
import { CARTON_TYPE_LABEL, dispatchCounts } from "@/lib/supplier";
import type { DispatchSummary } from "@/server/supplier-data";

/** Cartons sent this month by carton type, and the units: closed and received dispatches only. */
export function MonthCartons({ dispatches }: { dispatches: DispatchSummary[] }) {
  const month = todayIST().slice(0, 7);
  const sent = dispatches.filter((d) => (d.status === "closed" || d.status === "received") && (d.closed_at ?? "").slice(0, 7) === month);
  const total = { H: 0, T: 0, units: 0 };
  for (const d of sent) {
    const c = dispatchCounts(d.lines, d.cartons);
    total.H += c.byType.H.loaded;
    total.T += c.byType.T.loaded;
    total.units += c.units;
  }
  return (
    <Card className="g-pad">
      <p className="t-card-title">Cartons sent this month</p>
      <p className="mt-2 text-[13px]">
        <span className="text-[22px] font-semibold tabular-nums">{formatNumber(total.H + total.T)}</span> cartons in {sent.length} {sent.length === 1 ? "dispatch" : "dispatches"}
      </p>
      <p className="t-caption mt-1">
        {CARTON_TYPE_LABEL.H} {formatNumber(total.H)} · {CARTON_TYPE_LABEL.T} {formatNumber(total.T)} · {formatNumber(total.units)} units
      </p>
    </Card>
  );
}

/** The dispatches, newest first, each with cartons scanned against planned by carton type. */
export function DispatchList({ dispatches, base, emptyBody }: { dispatches: DispatchSummary[]; base: string; emptyBody: string }) {
  if (!dispatches.length) return <EmptyState title="No dispatches yet" body={emptyBody} />;
  const today = todayIST();
  return (
    <Card className="ledger-card">
      <table className="ledger">
        <thead>
          <tr>
            <th scope="col">Dispatch</th>
            <th scope="col">Date</th>
            <th scope="col">Status</th>
            <th scope="col" className="num">{CARTON_TYPE_LABEL.H}</th>
            <th scope="col" className="num">{CARTON_TYPE_LABEL.T}</th>
            <th scope="col" className="num">Units loaded</th>
          </tr>
        </thead>
        <tbody>
          {dispatches.map((d) => {
            const c = dispatchCounts(d.lines, d.cartons);
            const late = (d.status === "planned" || d.status === "loading") && d.due_on < today;
            return (
              <tr key={d.id}>
                <th scope="row" className="text-left font-semibold">
                  <Link href={`${base}/${d.id}`} className="focus-ring underline decoration-line underline-offset-4">
                    Dispatch {d.number}
                  </Link>
                </th>
                <td className={late ? "font-semibold text-bad" : ""}>
                  {formatDate(d.due_on)}
                  {late ? " (overdue)" : ""}
                </td>
                <td>
                  <DispatchStatusChip status={d.status} />
                </td>
                <td className="num tabular-nums">
                  {formatNumber(c.byType.H.loaded)} / {formatNumber(c.byType.H.planned)}
                </td>
                <td className="num tabular-nums">
                  {formatNumber(c.byType.T.loaded)} / {formatNumber(c.byType.T.planned)}
                </td>
                <td className="num tabular-nums">{formatNumber(c.units)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
