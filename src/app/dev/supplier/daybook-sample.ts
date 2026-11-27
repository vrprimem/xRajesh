// A made-up day book for the development preview: goods in, loading and dispatches sent over the last four weeks,
// dated from today so the quick choices all show something. Names come from the supplier's own materials list.

import { addDays } from "@/lib/format";
import type { BookItem, BookLoad, BookRange, BookSent, DayBook } from "@/lib/day-book";
import type { DayBookData } from "@/server/day-book-data";
import { MATERIALS } from "./materials-sample";
import { DISPATCH, PRODUCTS, SENT_DISPATCH } from "./sample";

const PER_BOX: Record<string, number> = { b100: 200, b250: 100, b500: 100, c250: 500, t250: 40, t500: 100, tshoe: 50 };

const ITEMS: Record<string, BookItem> = {
  ...Object.fromEntries(MATERIALS.map((m) => [m.key, { name: m.name, simple: m.en, unit: "pcs" as const, perBox: PER_BOX[m.key] ?? null }])),
  stk: { name: "KITCHEN CLEANER STICKER 500ML", simple: "Kitchen sticker", unit: "pcs", perBox: null },
  chem: { name: "REPELLENT CONCENTRATE", simple: "Repellent chemical", unit: "kg", perBox: null },
};

const [KC, RR, LZ] = PRODUCTS.map((p) => p.id);
// Dispatches 3 to 6 have no preview page of their own: they open the sent one's.
const D = { 7: DISPATCH, 6: SENT_DISPATCH, 5: "dbk-5", 4: "dbk-4", 3: "dbk-3" } as const;

/** A moment on a day before today, at a time in India ("10:42"). */
const at = (today: string, back: number, time: string) => `${addDays(today, -back)}T${time}:00+05:30`;

export function dayBookSample(today: string, range: BookRange): DayBookData {
  const goods = (back: number, time: string, item: string, qty: number, who: string, more: { kg?: number; bill?: boolean; note?: string } = {}) => ({
    id: back * 100 + Number(time.replace(":", "")),
    day: addDays(today, -back),
    at: at(today, back, time),
    who,
    item_id: item,
    qty,
    kg: more.kg ?? null,
    photo_path: more.bill ? `bill-${back}-${time}` : null,
    note: more.note ?? null,
  });
  const load = (back: number, from: string, to: string, number: keyof typeof D, product: string, cartons: number, perCarton: number, status = "closed"): BookLoad => ({
    day: addDays(today, -back),
    first_at: at(today, back, from),
    last_at: at(today, back, to),
    who: "Mahesh",
    dispatch_id: D[number],
    number,
    status,
    product_id: product,
    cartons,
    units: cartons * perCarton,
  });
  const sent = (back: number, time: string, number: keyof typeof D, cartons: number, units: number, arrived: number): BookSent => ({
    day: addDays(today, -back),
    at: at(today, back, time),
    who: "Rajesh",
    dispatch_id: D[number],
    number,
    status: arrived === cartons ? "received" : "closed",
    cartons,
    units,
    arrived,
  });
  const book: DayBook = {
    in: [
      goods(0, "10:42", "t250", 1200, "Mahesh", { bill: true }),
      goods(1, "15:00", "chem", 25, "Rajesh", { note: "One drum from the Bhiwandi dealer" }),
      goods(1, "09:40", "stk", 5000, "Mahesh", { kg: 12.5 }),
      goods(1, "09:15", "b500", 2000, "Mahesh", { bill: true }),
      goods(3, "14:00", "c250", 5000, "Mahesh"),
      goods(3, "11:00", "b250", 1500, "Mahesh", { bill: true }),
      goods(9, "10:20", "b100", 2000, "Mahesh"),
      goods(16, "12:05", "t500", 1200, "Mahesh", { bill: true }),
      goods(28, "11:30", "tshoe", 250, "Mahesh"),
    ],
    loaded: [
      load(0, "12:30", "12:50", 7, RR, 6, 48, "loading"),
      load(0, "11:05", "12:20", 7, KC, 25, 24, "loading"),
      load(1, "16:10", "17:05", 6, KC, 30, 24),
      load(5, "11:20", "12:10", 5, LZ, 10, 60),
      load(5, "10:30", "11:15", 5, RR, 20, 48),
      load(9, "15:00", "16:00", 4, KC, 40, 24),
      load(28, "15:30", "16:10", 3, KC, 20, 24),
    ],
    sent: [sent(1, "17:20", 6, 30, 720, 0), sent(5, "12:40", 5, 30, 1560, 30), sent(9, "16:30", 4, 40, 960, 38), sent(28, "16:40", 3, 20, 480, 20)],
  };
  const inRange = <T extends { day: string }>(rows: T[]) => rows.filter((r) => r.day >= range.from && r.day <= range.to);
  return {
    installed: true,
    book: { in: inRange(book.in), loaded: inRange(book.loaded), sent: inRange(book.sent) },
    items: ITEMS,
    products: Object.fromEntries(PRODUCTS.map((p) => [p.id, p.name])),
    // The preview has no bill photos: the app's icon stands in.
    bills: Object.fromEntries(book.in.filter((e) => e.photo_path).map((e) => [e.photo_path!, "/apple-icon.png"])),
  };
}

/** Where a sample dispatch opens in the preview. */
export const sampleDispatchHref = (id: string) => (id === DISPATCH ? "/dev/supplier?view=dispatch" : "/dev/supplier?view=sentdispatch");
