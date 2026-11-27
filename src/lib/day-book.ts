// The day book: what came into the supplier's godown (goods in) and what went out to VRPRIME (cartons loaded onto a
// dispatch, and dispatches sent), day by day between two dates. For the supplier's owner and VRPRIME only. Mirrors
// supabase/migrations/20261126120000_day_book.sql. Plain functions, so `node --test` can run them.

import { addDays, formatDate } from "./format.ts";
import { toCsv } from "./report.ts";
import { UNIT_SHORT, type ItemUnit } from "./supplies.ts";

export type BookIn = { id: number; day: string; at: string; who: string; item_id: string; qty: number; kg: number | null; photo_path: string | null; note: string | null };
export type BookLoad = { day: string; first_at: string; last_at: string; who: string; dispatch_id: string; number: number; status: string; product_id: string; cartons: number; units: number };
export type BookSent = { day: string; at: string; who: string; dispatch_id: string; number: number; status: string; cartons: number; units: number; arrived: number };
export type DayBook = { in: BookIn[]; loaded: BookLoad[]; sent: BookSent[] };

export const EMPTY_BOOK: DayBook = { in: [], loaded: [], sent: [] };

/** A supply as the day book names it. */
export type BookItem = { name: string; simple: string | null; unit: ItemUnit; perBox: number | null };

const num = (v: unknown) => Number(v ?? 0) || 0;
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown) => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown) => (typeof v === "string" && v ? v : null);
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);

/** The database's answer (one JSON value) as the day book's rows; anything missing reads as empty. */
export function parseBook(data: unknown): DayBook {
  const o = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  return {
    in: list(o.in).map((e) => ({ id: num(e.id), day: str(e.day), at: str(e.at), who: str(e.who), item_id: str(e.item_id), qty: num(e.qty), kg: numOrNull(e.kg), photo_path: strOrNull(e.photo_path), note: strOrNull(e.note) })),
    loaded: list(o.loaded).map((e) => ({ day: str(e.day), first_at: str(e.first_at), last_at: str(e.last_at), who: str(e.who), dispatch_id: str(e.dispatch_id), number: num(e.number), status: str(e.status), product_id: str(e.product_id), cartons: num(e.cartons), units: num(e.units) })),
    sent: list(o.sent).map((e) => ({ day: str(e.day), at: str(e.at), who: str(e.who), dispatch_id: str(e.dispatch_id), number: num(e.number), status: str(e.status), cartons: num(e.cartons), units: num(e.units), arrived: num(e.arrived) })),
  };
}

// ---- The dates ----

/** A real calendar day written YYYY-MM-DD. */
export function isDay(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** The longest stretch shown at once: a year (the database refuses more). */
export const MAX_SPAN = 366;

export type BookRange = { from: string; to: string };

/**
 * The days asked for in the address (?from=&to=, YYYY-MM-DD), made sensible: the last 7 days when neither is a day.
 * Only a first day runs to today, and only a last day is that one day. Back to front is turned round. Nothing after
 * today, and a year at most.
 */
export function bookRange(from: unknown, to: unknown, today: string): BookRange {
  if (!isDay(from) && !isDay(to)) return { from: addDays(today, -6), to: today };
  let a = isDay(from) ? from : (to as string);
  let b = isDay(to) ? to : today;
  if (a > b) [a, b] = [b, a];
  if (b > today) b = today;
  if (a > b) a = b;
  if (daysBetween(a, b) > MAX_SPAN) a = addDays(b, -MAX_SPAN);
  return { from: a, to: b };
}

/** The one-tap choices above the dates. */
export function quickRanges(today: string): (BookRange & { label: string })[] {
  const month = today.slice(0, 7);
  const lastMonthEnd = addDays(`${month}-01`, -1);
  return [
    { label: "Today", from: today, to: today },
    { label: "Yesterday", from: addDays(today, -1), to: addDays(today, -1) },
    { label: "Last 7 days", from: addDays(today, -6), to: today },
    { label: "This month", from: `${month}-01`, to: today },
    { label: "Last month", from: `${lastMonthEnd.slice(0, 7)}-01`, to: lastMonthEnd },
  ];
}

/** "26 Nov", or "19 Nov – 26 Nov". */
export function rangeLabel(r: BookRange, today: string): string {
  return r.from === r.to ? formatDate(r.from, today) : `${formatDate(r.from, today)} – ${formatDate(r.to, today)}`;
}

const weekday = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short" });

/** A day's heading: "Today · Thu, 26 Nov", "Yesterday · Wed, 25 Nov", "Mon, 23 Nov" (with the year when not this one). */
export function dayHeading(day: string, today: string): string {
  const name = `${weekday.format(new Date(`${day}T00:00:00Z`))}, ${formatDate(day, today)}`;
  if (day === today) return `Today · ${name}`;
  if (day === addDays(today, -1)) return `Yesterday · ${name}`;
  return name;
}

const clock = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });

/** The time in India: "10:42 am". */
export const bookTime = (iso: string) => (iso && !Number.isNaN(Date.parse(iso)) ? clock.format(new Date(iso)) : "");

/**
 * From the first scan to the last: "11:05 am – 12:20 pm", "12:30 – 12:50 pm" when both are am or both pm, or one time
 * when they were in the same minute.
 */
export function timeSpan(first: string, last: string): string {
  const a = bookTime(first);
  const b = bookTime(last);
  if (a === b) return a;
  const [aTime, aHalf] = a.split(" ");
  return aHalf && b.endsWith(` ${aHalf}`) ? `${aTime} – ${b}` : `${a} – ${b}`;
}

// ---- What to show ----

export const BOOK_SHOWS = ["all", "in", "out"] as const;
export type BookShow = (typeof BOOK_SHOWS)[number];
export const BOOK_SHOW_LABEL: Record<BookShow, string> = { all: "Everything", in: "Goods in", out: "Dispatch" };
export const bookShow = (v: unknown): BookShow => ((BOOK_SHOWS as readonly unknown[]).includes(v) ? (v as BookShow) : "all");

export type BookEntry = ({ kind: "in" } & BookIn) | ({ kind: "loaded" } & BookLoad) | ({ kind: "sent" } & BookSent);
export type BookDay = { day: string; entries: BookEntry[]; goodsIn: number; cartons: number; units: number; sent: number };

const when = (e: BookEntry) => Date.parse(e.kind === "loaded" ? e.last_at : e.at) || 0;

/** The entries day by day: the newest day first, and the newest first within a day. `show` keeps goods in or dispatch only. */
export function bookDays(book: DayBook, show: BookShow = "all"): BookDay[] {
  const entries: BookEntry[] = [
    ...(show === "out" ? [] : book.in.map((e) => ({ ...e, kind: "in" as const }))),
    ...(show === "in" ? [] : book.loaded.map((e) => ({ ...e, kind: "loaded" as const }))),
    ...(show === "in" ? [] : book.sent.map((e) => ({ ...e, kind: "sent" as const }))),
  ];
  const days = new Map<string, BookDay>();
  for (const e of entries) {
    const d = days.get(e.day) ?? { day: e.day, entries: [], goodsIn: 0, cartons: 0, units: 0, sent: 0 };
    d.entries.push(e);
    if (e.kind === "in") d.goodsIn += 1;
    else if (e.kind === "loaded") {
      d.cartons += e.cartons;
      d.units += e.units;
    } else d.sent += 1;
    days.set(e.day, d);
  }
  return [...days.values()]
    .sort((a, b) => b.day.localeCompare(a.day))
    .map((d) => ({ ...d, entries: d.entries.sort((a, b) => when(b) - when(a)) }));
}

export type BookTotals = {
  goodsIn: number;
  /** Per supply: how many times it came in, and how much in all. */
  supplies: { item_id: string; times: number; qty: number; kg: number | null }[];
  cartons: number;
  units: number;
  /** Per product: the cartons loaded and their pieces. */
  products: { product_id: string; cartons: number; units: number }[];
  sent: number;
};

/** What the days add up to. */
export function bookTotals(days: readonly BookDay[]): BookTotals {
  const supplies = new Map<string, BookTotals["supplies"][number]>();
  const products = new Map<string, BookTotals["products"][number]>();
  const t: BookTotals = { goodsIn: 0, supplies: [], cartons: 0, units: 0, products: [], sent: 0 };
  for (const d of days) {
    for (const e of d.entries) {
      if (e.kind === "in") {
        t.goodsIn += 1;
        const s = supplies.get(e.item_id) ?? { item_id: e.item_id, times: 0, qty: 0, kg: null };
        s.times += 1;
        s.qty += e.qty;
        if (e.kg !== null) s.kg = (s.kg ?? 0) + e.kg;
        supplies.set(e.item_id, s);
      } else if (e.kind === "loaded") {
        t.cartons += e.cartons;
        t.units += e.units;
        const p = products.get(e.product_id) ?? { product_id: e.product_id, cartons: 0, units: 0 };
        p.cartons += e.cartons;
        p.units += e.units;
        products.set(e.product_id, p);
      } else t.sent += 1;
    }
  }
  t.supplies = [...supplies.values()].map((s) => ({ ...s, qty: Math.round(s.qty * 1000) / 1000, kg: s.kg === null ? null : Math.round(s.kg * 1000) / 1000 }));
  t.products = [...products.values()];
  return t;
}

/** Every entry shown, as a spreadsheet: one row each, oldest first. */
export function bookCsv(days: readonly BookDay[], item: (id: string) => BookItem | undefined, product: (id: string) => string): string {
  const rows: (string | number | null)[][] = [];
  for (const d of [...days].reverse()) {
    for (const e of [...d.entries].reverse()) {
      if (e.kind === "in") {
        const i = item(e.item_id);
        rows.push([e.day, bookTime(e.at), "Goods in", i?.name ?? "Removed supply", e.qty, i ? UNIT_SHORT[i.unit] : "", e.kg, null, null, e.who, e.note]);
      } else if (e.kind === "loaded") {
        rows.push([e.day, timeSpan(e.first_at, e.last_at), "Loaded", product(e.product_id), e.units, "pcs", null, e.cartons, e.number, e.who, null]);
      } else {
        rows.push([e.day, bookTime(e.at), "Dispatch sent", null, e.units, "pcs", null, e.cartons, e.number, e.who, `${e.arrived} of ${e.cartons} cartons reached VRPRIME`]);
      }
    }
  }
  return toCsv(["Date", "Time", "What", "Supply or product", "Quantity", "Unit", "Kg", "Cartons", "Dispatch", "By", "Note"], rows);
}
