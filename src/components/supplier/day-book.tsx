import Link from "next/link";
import type { ReactNode } from "react";
import { BoxIcon, CameraIcon, TruckIcon } from "@/components/icons";
import { CsvButton } from "@/components/supplier/csv-button";
import { Card, EmptyState, PageTitle, SectionHead, buttonClass } from "@/components/ui";
import {
  BOOK_SHOWS,
  BOOK_SHOW_LABEL,
  bookCsv,
  bookDays,
  bookTime,
  bookTotals,
  dayHeading,
  quickRanges,
  rangeLabel,
  timeSpan,
  type BookDay,
  type BookEntry,
  type BookItem,
  type BookRange,
  type BookShow,
} from "@/lib/day-book";
import { formatNumber, noun } from "@/lib/format";
import { formatBoxes, formatQty } from "@/lib/supplies";
import type { DayBookData } from "@/server/day-book-data";

/** How much came in: "30 boxes · 1,200 pcs" when it comes in boxes, else "12.5 kg". */
function inQty(qty: number, item: BookItem | undefined): string {
  if (!item) return formatNumber(qty);
  const plain = formatQty(qty, item.unit);
  return item.perBox && qty >= item.perBox ? `${formatBoxes(qty, item.unit, item.perBox)} · ${plain}` : plain;
}

/** A day's line under its heading: "2 goods-in entries · 40 cartons loaded · 1 dispatch sent". */
function daySummary(d: BookDay): string {
  return [
    d.goodsIn ? `${formatNumber(d.goodsIn)} ${noun(d.goodsIn, "goods-in entry", "goods-in entries")}` : "",
    d.cartons ? `${formatNumber(d.cartons)} ${noun(d.cartons, "carton")} loaded` : "",
    d.sent ? `${formatNumber(d.sent)} ${noun(d.sent, "dispatch", "dispatches")} sent` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** What reached VRPRIME of a dispatch sent. */
function arrivedText(arrived: number, cartons: number): string {
  if (!cartons) return "No cartons on it";
  if (arrived >= cartons) return `All ${formatNumber(cartons)} reached VRPRIME`;
  if (!arrived) return "Not at VRPRIME yet";
  return `${formatNumber(arrived)} of ${formatNumber(cartons)} reached VRPRIME`;
}

/** The round mark at the start of an entry, in its stage's colour (as on the godown and the dispatches). */
function Mark({ stage, children }: { stage: string; children: ReactNode }) {
  return (
    <span className={`${stage} mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full`} style={{ background: "var(--stage-soft)", color: "var(--stage-text)" }} aria-hidden>
      {children}
    </span>
  );
}

/** An entry's first line: what it was, in its stage's colour, and when on the right (or under it, when narrow). */
function Head({ stage, time, children }: { stage: string; time: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
      <p className={`${stage} text-[13px] font-extrabold uppercase tracking-[0.04em]`} style={{ color: "var(--stage-text)" }}>
        {children}
      </p>
      <p className="whitespace-nowrap text-[14px] font-bold tabular-nums">{time}</p>
    </div>
  );
}

/** Who entered it, scanned it or closed it. */
function By({ who }: { who: string }) {
  return who ? <p className="text-[14px] font-semibold text-muted">By {who}</p> : null;
}

function Entry({ e, item, product, bill, dispatchHref }: { e: BookEntry; item: (id: string) => BookItem | undefined; product: (id: string) => string; bill: (path: string | null) => string | undefined; dispatchHref: (id: string) => string }) {
  const dispatchLink = (id: string, number: number) => (
    <Link href={dispatchHref(id)} className="focus-ring underline decoration-line underline-offset-4">
      Dispatch {number}
    </Link>
  );
  if (e.kind === "in") {
    const i = item(e.item_id);
    const photo = bill(e.photo_path);
    return (
      <li className="flex items-start gap-3 py-3">
        <Mark stage="stage-done">
          <TruckIcon className="h-5 w-5" />
        </Mark>
        <div className="min-w-0 flex-1">
          <Head stage="stage-done" time={bookTime(e.at)}>
            Goods in
          </Head>
          <p className="font-extrabold">{i?.name ?? "Removed supply"}</p>
          {i?.simple && i.simple !== i.name ? <p className="text-[14px] text-muted">{i.simple}</p> : null}
          <p className="mt-0.5 font-semibold tabular-nums">
            +{inQty(e.qty, i)}
            {e.kg !== null ? ` · ${formatNumber(e.kg)} kg` : ""}
          </p>
          {e.note ? <p className="text-[14px] text-muted">{e.note}</p> : null}
          <By who={e.who} />
          {photo ? (
            <a href={photo} target="_blank" rel="noreferrer" className="focus-ring mt-1 inline-flex min-h-8 items-center gap-1.5 text-[14px] font-bold underline underline-offset-2">
              <CameraIcon className="h-4 w-4" />
              Bill photo
            </a>
          ) : null}
        </div>
      </li>
    );
  }
  if (e.kind === "loaded") {
    return (
      <li className="flex items-start gap-3 py-3">
        <Mark stage="stage-load">
          <BoxIcon className="h-5 w-5" />
        </Mark>
        <div className="min-w-0 flex-1">
          <Head stage="stage-load" time={timeSpan(e.first_at, e.last_at)}>
            Loaded on {dispatchLink(e.dispatch_id, e.number)}
          </Head>
          <p className="font-extrabold">{product(e.product_id)}</p>
          <p className="mt-0.5 font-semibold tabular-nums">
            {formatNumber(e.cartons)} {noun(e.cartons, "carton")} · {formatNumber(e.units)} pcs
          </p>
          {e.status === "planned" || e.status === "loading" ? <p className="text-[14px] text-muted">The dispatch is still loading</p> : null}
          <By who={e.who} />
        </div>
      </li>
    );
  }
  const reached = e.cartons > 0 && e.arrived >= e.cartons;
  return (
    <li className="flex items-start gap-3 py-3">
      <Mark stage={reached ? "stage-done" : "stage-way"}>
        <TruckIcon className="h-5 w-5" />
      </Mark>
      <div className="min-w-0 flex-1">
        <Head stage="stage-way" time={bookTime(e.at)}>
          Sent to VRPRIME
        </Head>
        <p className="font-extrabold">{dispatchLink(e.dispatch_id, e.number)}</p>
        <p className="mt-0.5 font-semibold tabular-nums">
          {formatNumber(e.cartons)} {noun(e.cartons, "carton")} · {formatNumber(e.units)} pcs
        </p>
        <p className={`text-[14px] ${reached ? "font-semibold" : "text-muted"}`}>{arrivedText(e.arrived, e.cartons)}</p>
        <By who={e.who} />
      </div>
    </li>
  );
}

/**
 * The day book: between two dates, every goods in at the supplier's godown and every carton loaded and dispatch sent
 * to VRPRIME, day by day with the time and who did it, then the totals per supply and product. For the supplier's owner
 * and VRPRIME (the database refuses anyone else). The dates are a plain form, so it works without scripts; `base` is
 * this page and `keep` any other part of its address to keep (the preview's view).
 */
export function DayBookView({
  data,
  range,
  show,
  today,
  base,
  keep = {},
  dispatchHref,
  title,
}: {
  data: DayBookData;
  range: BookRange;
  show: BookShow;
  today: string;
  base: string;
  keep?: Record<string, string>;
  /** Where a dispatch named in it opens. */
  dispatchHref: (id: string) => string;
  title: string;
}) {
  const days = bookDays(data.book, show);
  const totals = bookTotals(days);
  const href = (r: BookRange, s: BookShow) => `${base}?${new URLSearchParams({ ...keep, from: r.from, to: r.to, ...(s === "all" ? {} : { show: s }) })}`;
  const item = (id: string) => data.items[id];
  const product = (id: string) => data.products[id] ?? "Removed product";
  const bill = (path: string | null) => (path ? data.bills[path] : undefined);
  const label = rangeLabel(range, today);
  const file = `day-book-${range.from}-to-${range.to}${show === "all" ? "" : show === "in" ? "-goods-in" : "-dispatch"}.csv`;
  const tiles: [string, number][] = [
    ...(show === "out" ? [] : ([["Goods-in entries", totals.goodsIn]] as [string, number][])),
    ...(show === "in" ? ([["Supplies", totals.supplies.length]] as [string, number][]) : []),
    ...(show === "in"
      ? []
      : ([
          ["Cartons loaded", totals.cartons],
          ["Pieces loaded", totals.units],
          ["Dispatches sent", totals.sent],
        ] as [string, number][])),
  ];
  const byName = (a: string, b: string) => a.localeCompare(b, "en-IN");

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title={title} sub={`${label} · ${show === "in" ? "goods in" : show === "out" ? "dispatch" : "goods in and dispatch"}, day by day`} action={data.installed && days.length ? <CsvButton file={file} csv={bookCsv(days, item, product)} /> : null} />

      <Card className="g-pad">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Quick dates">
          {quickRanges(today).map((q) => (
            <Link key={q.label} href={href(q, show)} aria-current={q.from === range.from && q.to === range.to ? "true" : undefined} className={buttonClass("row")}>
              {q.label}
            </Link>
          ))}
        </div>
        <form method="get" action={base} className="mt-4 flex flex-wrap items-end gap-3">
          {Object.entries(keep).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          {show === "all" ? null : <input type="hidden" name="show" value={show} />}
          <label className="flex min-w-[9.5rem] flex-1 flex-col gap-1.5 text-[15px] font-semibold min-[520px]:max-w-[13rem]">
            From
            <input type="date" name="from" defaultValue={range.from} max={today} required className="input" />
          </label>
          <label className="flex min-w-[9.5rem] flex-1 flex-col gap-1.5 text-[15px] font-semibold min-[520px]:max-w-[13rem]">
            To
            <input type="date" name="to" defaultValue={range.to} max={today} required className="input" />
          </label>
          <button type="submit" className={buttonClass("primary", "w-full min-[520px]:w-auto")}>
            Show these dates
          </button>
        </form>
        <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label="What to show">
          {BOOK_SHOWS.map((s) => (
            <Link key={s} href={href(range, s)} aria-current={s === show ? "true" : undefined} className={buttonClass("row")}>
              {BOOK_SHOW_LABEL[s]}
            </Link>
          ))}
        </div>
      </Card>

      {!data.installed ? (
        <EmptyState title="The day book is not ready yet" body="It needs a database update first. Ask VRPRIME." />
      ) : days.length === 0 ? (
        <EmptyState
          title="Nothing on these dates"
          body={`No ${show === "in" ? "goods in" : show === "out" ? "loading or dispatch sent" : "goods in, loading or dispatch sent"} on ${label}. Pick other dates above.`}
        />
      ) : (
        <>
          <Card className="g-pad">
            <div className={`grid grid-cols-2 gap-3 ${tiles.length > 2 ? "sm:grid-cols-4" : ""}`}>
              {tiles.map(([name, value]) => (
                <div key={name}>
                  <p className="t-caption">{name}</p>
                  <p className="t-score mt-1.5 text-[32px]">{formatNumber(value)}</p>
                </div>
              ))}
            </div>
          </Card>

          {days.map((d) => (
            <Card key={d.day} className="g-pad">
              <SectionHead title={dayHeading(d.day, today)} sub={daySummary(d)} />
              <ul className="flex flex-col divide-y divide-line-soft">
                {d.entries.map((e) => (
                  <Entry
                    key={e.kind === "in" ? `in-${e.id}` : e.kind === "loaded" ? `ld-${e.dispatch_id}-${e.product_id}-${e.who}-${e.first_at}` : `st-${e.dispatch_id}`}
                    e={e}
                    item={item}
                    product={product}
                    bill={bill}
                    dispatchHref={dispatchHref}
                  />
                ))}
              </ul>
            </Card>
          ))}

          {days.length > 1 && totals.supplies.length ? (
            <Card className="ledger-card">
              <div className="g-pad pb-0">
                <SectionHead title="Goods in, by supply" sub={`All of ${label}`} />
              </div>
              <table className="ledger">
                <thead>
                  <tr>
                    <th scope="col" className="min-w-[170px]">Supply</th>
                    <th scope="col" className="num">Times</th>
                    <th scope="col" className="num">In all</th>
                  </tr>
                </thead>
                <tbody>
                  {[...totals.supplies]
                    .sort((a, b) => byName(item(a.item_id)?.name ?? "", item(b.item_id)?.name ?? ""))
                    .map((s) => {
                      const i = item(s.item_id);
                      return (
                        <tr key={s.item_id}>
                          <th scope="row" className="text-left font-semibold">
                            {i?.name ?? "Removed supply"}
                            {i?.simple && i.simple !== i.name ? <span className="block text-[13px] font-normal text-muted">{i.simple}</span> : null}
                          </th>
                          <td className="num tabular-nums">{formatNumber(s.times)}</td>
                          <td className="num tabular-nums">
                            <span className="whitespace-nowrap">{i ? formatQty(s.qty, i.unit) : formatNumber(s.qty)}</span>
                            {i?.perBox && s.qty >= i.perBox ? <span className="block text-[13px] text-muted">{formatBoxes(s.qty, i.unit, i.perBox)}</span> : null}
                            {s.kg !== null ? <span className="block whitespace-nowrap text-[13px] text-muted">{formatNumber(s.kg)} kg</span> : null}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </Card>
          ) : null}

          {days.length > 1 && totals.products.length ? (
            <Card className="ledger-card">
              <div className="g-pad pb-0">
                <SectionHead title="Loaded, by product" sub={`All of ${label} · ${formatNumber(totals.sent)} ${noun(totals.sent, "dispatch", "dispatches")} sent`} />
              </div>
              <table className="ledger">
                <thead>
                  <tr>
                    <th scope="col" className="min-w-[170px]">Product</th>
                    <th scope="col" className="num">Cartons</th>
                    <th scope="col" className="num">Pieces</th>
                  </tr>
                </thead>
                <tbody>
                  {[...totals.products]
                    .sort((a, b) => byName(product(a.product_id), product(b.product_id)))
                    .map((p) => (
                      <tr key={p.product_id}>
                        <th scope="row" className="text-left font-semibold">{product(p.product_id)}</th>
                        <td className="num tabular-nums">{formatNumber(p.cartons)}</td>
                        <td className="num tabular-nums">{formatNumber(p.units)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
