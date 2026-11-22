import Link from "next/link";
import { CsvButton } from "@/components/supplier/csv-button";
import { Card, EmptyState, PageTitle, SectionHead, buttonClass } from "@/components/ui";
import { formatDate, formatNumber, noun, todayIST } from "@/lib/format";
import { buildReport, shiftMonth, toCsv } from "@/lib/report";
import type { ReportData } from "@/server/supplier-data";

const monthName = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

/**
 * The carton report for one month: cartons sent (closed dispatches) by type, how many have arrived at VRPRIME, and
 * the units, by dispatch, by product and by day; each table downloads as CSV. Used by both sides; `base` is this page.
 */
export function ReportView({ data, month, base, title, dispatchBase }: { data: ReportData; month: string; base: string; title: string; dispatchBase: string }) {
  const r = buildReport(data.dispatches, data.cartons, (id) => data.names.get(id) ?? "Unknown product");
  const thisMonth = todayIST().slice(0, 7);
  const next = shiftMonth(month, 1);
  const file = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${month}`;
  const t = r.totals;

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title={title}
        sub={`${monthName(month)} · dispatches closed this month`}
        action={
          <>
            <Link href={`${base}?month=${shiftMonth(month, -1)}`} className={buttonClass("row")}>
              Previous month
            </Link>
            {next <= thisMonth ? (
              <Link href={`${base}?month=${next}`} className={buttonClass("row")}>
                Next month
              </Link>
            ) : null}
          </>
        }
      />

      {r.byDispatch.length === 0 ? (
        <EmptyState title="Nothing sent this month" body="Only closed dispatches count: their loaded cartons were sent. Pick another month above." />
      ) : (
        <>
          <Card className="g-pad">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Dispatches", t.dispatches],
                ["Cartons sent", t.cartons],
                ["Hard / 2-ply", `${formatNumber(t.hard)} / ${formatNumber(t.twoPly)}`],
                ["Units sent", t.units],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <p className="t-caption">{label}</p>
                  <p className="t-score mt-1.5 text-[32px]">{typeof value === "number" ? formatNumber(value) : value}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[13px]">
              <span className="font-semibold tabular-nums">{formatNumber(t.arrived)}</span> of {formatNumber(t.cartons)} {noun(t.cartons, "carton")} scanned in at VRPRIME
              {t.cartons - t.arrived > 0 ? <span className="text-muted"> · {formatNumber(t.cartons - t.arrived)} not yet</span> : null}
            </p>
          </Card>

          <Card className="ledger-card">
            <div className="g-pad pb-0">
              <SectionHead
                title="By dispatch"
                action={
                  <CsvButton
                    file={`${file}-dispatches.csv`}
                    csv={toCsv(["Dispatch", "Closed on", "Status", "Hard cartons", "2-ply cartons", "Cartons", "Units", "Arrived at VRPRIME"], r.byDispatch.map((d) => [d.number, d.day, d.status, d.hard, d.twoPly, d.cartons, d.units, d.arrived]))}
                  />
                }
              />
            </div>
            <table className="ledger">
              <thead>
                <tr>
                  <th scope="col">Dispatch</th>
                  <th scope="col">Closed</th>
                  <th scope="col" className="num">Hard</th>
                  <th scope="col" className="num">2-ply</th>
                  <th scope="col" className="num">Units</th>
                  <th scope="col" className="num">Arrived</th>
                </tr>
              </thead>
              <tbody>
                {r.byDispatch.map((d) => {
                  const id = data.dispatches.find((x) => x.number === d.number)?.id;
                  return (
                    <tr key={d.number}>
                      <th scope="row" className="text-left font-semibold">
                        {id ? (
                          <Link href={`${dispatchBase}/${id}`} className="focus-ring underline decoration-line underline-offset-4">
                            Dispatch {d.number}
                          </Link>
                        ) : (
                          `Dispatch ${d.number}`
                        )}
                      </th>
                      <td>{formatDate(d.day)}</td>
                      <td className="num tabular-nums">{formatNumber(d.hard)}</td>
                      <td className="num tabular-nums">{formatNumber(d.twoPly)}</td>
                      <td className="num tabular-nums">{formatNumber(d.units)}</td>
                      <td className={`num tabular-nums ${d.arrived < d.cartons ? "text-warn" : ""}`}>
                        {formatNumber(d.arrived)} / {formatNumber(d.cartons)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          <Card className="ledger-card">
            <div className="g-pad pb-0">
              <SectionHead
                title="By product"
                action={
                  <CsvButton
                    file={`${file}-products.csv`}
                    csv={toCsv(["Product", "Hard cartons", "2-ply cartons", "Cartons", "Units", "Cartons arrived"], r.byProduct.map((p) => [p.product, p.hard, p.twoPly, p.cartons, p.units, p.arrived]))}
                  />
                }
              />
            </div>
            <table className="ledger">
              <thead>
                <tr>
                  <th scope="col" className="min-w-[170px]">Product</th>
                  <th scope="col" className="num">Hard</th>
                  <th scope="col" className="num">2-ply</th>
                  <th scope="col" className="num">Units</th>
                  <th scope="col" className="num">Arrived</th>
                </tr>
              </thead>
              <tbody>
                {r.byProduct.map((p) => (
                  <tr key={p.product}>
                    <th scope="row" className="text-left font-semibold">{p.product}</th>
                    <td className="num tabular-nums">{formatNumber(p.hard)}</td>
                    <td className="num tabular-nums">{formatNumber(p.twoPly)}</td>
                    <td className="num tabular-nums">{formatNumber(p.units)}</td>
                    <td className="num tabular-nums">
                      {formatNumber(p.arrived)} / {formatNumber(p.cartons)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card className="ledger-card">
            <div className="g-pad pb-0">
              <SectionHead
                title="By day"
                action={<CsvButton file={`${file}-days.csv`} csv={toCsv(["Day", "Hard cartons", "2-ply cartons", "Cartons", "Units", "Cartons arrived"], r.byDay.map((d) => [d.day, d.hard, d.twoPly, d.cartons, d.units, d.arrived]))} />}
              />
            </div>
            <table className="ledger">
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col" className="num">Hard</th>
                  <th scope="col" className="num">2-ply</th>
                  <th scope="col" className="num">Units</th>
                </tr>
              </thead>
              <tbody>
                {r.byDay.map((d) => (
                  <tr key={d.day}>
                    <th scope="row" className="text-left font-normal">{formatDate(d.day)}</th>
                    <td className="num tabular-nums">{formatNumber(d.hard)}</td>
                    <td className="num tabular-nums">{formatNumber(d.twoPly)}</td>
                    <td className="num tabular-nums">{formatNumber(d.units)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
