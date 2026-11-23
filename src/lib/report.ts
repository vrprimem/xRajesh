// The carton report: what was sent to VRPRIME in a month and what has arrived, by dispatch, by product and by day.
// Plain functions, so `node --test` can run them.

export type ReportDispatch = { id: string; number: number; status: string; closed_at: string };
export type ReportCarton = { dispatch_id: string; product_id: string; units: number; inbound_status: string | null };

type Tally = { cartons: number; units: number; arrived: number };
const empty = (): Tally => ({ cartons: 0, units: 0, arrived: 0 });
const add = (t: Tally, c: ReportCarton) => {
  t.cartons += 1;
  t.units += c.units;
  if (c.inbound_status === "received") t.arrived += 1;
};

export type DispatchLine = Tally & { number: number; day: string; status: string };
export type ProductLine = Tally & { product: string };
export type DayLine = Tally & { day: string };
export type Report = { totals: Tally & { dispatches: number }; byDispatch: DispatchLine[]; byProduct: ProductLine[]; byDay: DayLine[] };

/** The day in India (YYYY-MM-DD) of a moment. */
export function istDay(iso: string): string {
  return new Date(new Date(iso).getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

/** The first moment of a month in India, and of the month after, as ISO times; null for a month that is not YYYY-MM. */
export function monthBounds(month: string): { from: string; to: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12 || y < 2020 || y > 2100) return null;
  const start = Date.UTC(y, mo - 1, 1) - 5.5 * 3_600_000;
  const end = Date.UTC(y, mo, 1) - 5.5 * 3_600_000;
  return { from: new Date(start).toISOString(), to: new Date(end).toISOString() };
}

/** The month before or after YYYY-MM. */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

/** Only loaded cartons of the given dispatches count: a void label or one never loaded was never sent. */
export function buildReport(dispatches: ReportDispatch[], cartons: ReportCarton[], productName: (id: string) => string): Report {
  const byId = new Map(dispatches.map((d) => [d.id, d]));
  const perDispatch = new Map<string, Tally>();
  const perProduct = new Map<string, Tally>();
  const perDay = new Map<string, Tally>();
  const totals = empty();
  for (const c of cartons) {
    const d = byId.get(c.dispatch_id);
    if (!d) continue;
    const day = istDay(d.closed_at);
    for (const [map, key] of [[perDispatch, d.id], [perProduct, c.product_id], [perDay, day]] as const) {
      if (!map.has(key)) map.set(key, empty());
      add(map.get(key)!, c);
    }
    add(totals, c);
  }
  const byDispatch = dispatches
    .map((d) => ({ ...(perDispatch.get(d.id) ?? empty()), number: d.number, day: istDay(d.closed_at), status: d.status }))
    .sort((a, b) => a.day.localeCompare(b.day) || a.number - b.number);
  const byProduct = [...perProduct.entries()].map(([id, t]) => ({ ...t, product: productName(id) })).sort((a, b) => b.units - a.units || a.product.localeCompare(b.product));
  const byDay = [...perDay.entries()].map(([day, t]) => ({ ...t, day })).sort((a, b) => a.day.localeCompare(b.day));
  return { totals: { ...totals, dispatches: dispatches.length }, byDispatch, byProduct, byDay };
}

/** A spreadsheet cell: quoted when needed, and text that would look like a formula starts with an apostrophe. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
