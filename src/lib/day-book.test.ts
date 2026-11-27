import assert from "node:assert/strict";
import { test } from "node:test";
import { bookCsv, bookDays, bookRange, bookShow, bookTime, bookTotals, dayHeading, isDay, parseBook, quickRanges, rangeLabel, timeSpan } from "./day-book.ts";

const TODAY = "2026-11-26";

test("the dates asked for are made sensible", () => {
  assert.deepEqual(bookRange(undefined, undefined, TODAY), { from: "2026-11-20", to: TODAY }, "the last 7 days when none are given");
  assert.deepEqual(bookRange("2026-11-01", "2026-11-15", TODAY), { from: "2026-11-01", to: "2026-11-15" });
  assert.deepEqual(bookRange("2026-11-15", "2026-11-01", TODAY), { from: "2026-11-01", to: "2026-11-15" }, "back to front is turned round");
  assert.deepEqual(bookRange("2026-11-10", undefined, TODAY), { from: "2026-11-10", to: TODAY }, "a first day alone runs to today");
  assert.deepEqual(bookRange(undefined, "2026-11-10", TODAY), { from: "2026-11-10", to: "2026-11-10" }, "a last day alone is that day");
  assert.deepEqual(bookRange("2026-11-20", "2026-12-31", TODAY), { from: "2026-11-20", to: TODAY }, "nothing after today");
  assert.deepEqual(bookRange("2027-01-05", undefined, TODAY), { from: TODAY, to: TODAY }, "a first day in the future is today");
  assert.deepEqual(bookRange("2024-01-01", TODAY, TODAY), { from: "2025-11-25", to: TODAY }, "a year at most");
  assert.deepEqual(bookRange("2026-02-30", "nonsense", TODAY), { from: "2026-11-20", to: TODAY }, "not days: the last 7 days");
  assert.ok(isDay("2024-02-29") && !isDay("2026-02-29") && !isDay("2026-13-01") && !isDay("26-11-2026") && !isDay(20261126));
});

test("the quick choices, the headings and the times", () => {
  assert.deepEqual(
    quickRanges(TODAY).map((q) => `${q.label}: ${q.from} ${q.to}`),
    ["Today: 2026-11-26 2026-11-26", "Yesterday: 2026-11-25 2026-11-25", "Last 7 days: 2026-11-20 2026-11-26", "This month: 2026-11-01 2026-11-26", "Last month: 2026-10-01 2026-10-31"],
  );
  assert.equal(quickRanges("2026-01-03").at(-1)?.from, "2025-12-01", "last month in January is December");
  assert.equal(dayHeading(TODAY, TODAY), "Today · Thu, 26 Nov");
  assert.equal(dayHeading("2026-11-25", TODAY), "Yesterday · Wed, 25 Nov");
  assert.equal(dayHeading("2026-11-23", TODAY), "Mon, 23 Nov");
  assert.equal(dayHeading("2025-12-31", TODAY), "Wed, 31 Dec 2025");
  assert.equal(rangeLabel({ from: TODAY, to: TODAY }, TODAY), "26 Nov");
  assert.equal(rangeLabel({ from: "2026-11-20", to: TODAY }, TODAY), "20 Nov – 26 Nov");
  assert.equal(bookTime("2026-11-26T05:12:00+00:00"), "10:42 am", "the time in India");
  assert.equal(bookTime(""), "");
  assert.equal(timeSpan("2026-11-26T05:35:00Z", "2026-11-26T06:50:30Z"), "11:05 am – 12:20 pm");
  assert.equal(timeSpan("2026-11-26T07:00:00Z", "2026-11-26T07:20:00Z"), "12:30 – 12:50 pm", "both pm: said once");
  assert.equal(timeSpan("2026-11-26T05:35:10Z", "2026-11-26T05:35:50Z"), "11:05 am", "one scan, one time");
  assert.equal(bookShow("in"), "in");
  assert.equal(bookShow("everything"), "all");
});

// What the database answers: newest first, as JSON (numbers may come as numbers or text).
const ANSWER = {
  in: [
    { id: 12, day: TODAY, at: "2026-11-26T05:12:00.123+00:00", who: "Mahesh", item_id: "trig", qty: 1200, kg: null, photo_path: "s/goods-in/b.jpg", note: null },
    { id: 9, day: "2026-11-24", at: "2026-11-24T04:00:00+00:00", who: "Mahesh", item_id: "stk", qty: "5000.0000", kg: "12.5", photo_path: null, note: "Shop bill 44" },
    { id: 8, day: "2026-11-24", at: "2026-11-24T03:00:00+00:00", who: "Rajesh", item_id: "trig", qty: 800, kg: null, photo_path: null, note: null },
  ],
  loaded: [
    { day: TODAY, first_at: "2026-11-26T05:35:00+00:00", last_at: "2026-11-26T06:50:00+00:00", who: "Mahesh", dispatch_id: "d7", number: 7, status: "closed", product_id: "kc", cartons: 25, units: 600 },
    { day: TODAY, first_at: "2026-11-26T06:00:00+00:00", last_at: "2026-11-26T06:40:00+00:00", who: "Mahesh", dispatch_id: "d7", number: 7, status: "closed", product_id: "rr", cartons: 15, units: "720" },
    { day: "2026-11-24", first_at: "2026-11-24T08:00:00+00:00", last_at: "2026-11-24T08:30:00+00:00", who: "Mahesh", dispatch_id: "d8", number: 8, status: "loading", product_id: "kc", cartons: 10, units: 240 },
  ],
  sent: [{ day: TODAY, at: "2026-11-26T07:00:00+00:00", who: "Rajesh", dispatch_id: "d7", number: 7, status: "closed", cartons: 40, units: 1320, arrived: 38 }],
};

test("the database's answer is read, and anything missing is empty", () => {
  const book = parseBook(ANSWER);
  assert.equal(book.in[1].qty, 5000);
  assert.equal(book.in[1].kg, 12.5);
  assert.equal(book.in[0].kg, null);
  assert.equal(book.loaded[1].units, 720);
  assert.equal(book.sent[0].arrived, 38);
  assert.deepEqual(parseBook(null), { in: [], loaded: [], sent: [] });
  assert.deepEqual(parseBook({ in: "x", loaded: [null, 3] }), { in: [], loaded: [], sent: [] });
});

test("day by day, newest first, and what to show", () => {
  const book = parseBook(ANSWER);
  const days = bookDays(book);
  assert.deepEqual(days.map((d) => d.day), [TODAY, "2026-11-24"]);
  assert.deepEqual(
    days[0].entries.map((e) => `${e.kind} ${e.kind === "in" ? e.item_id : e.kind === "loaded" ? e.product_id : e.number}`),
    ["sent 7", "loaded kc", "loaded rr", "in trig"],
    "the newest first: the dispatch sent, the loading by its last scan, then the goods in",
  );
  assert.deepEqual([days[0].goodsIn, days[0].cartons, days[0].units, days[0].sent], [1, 40, 1320, 1]);
  assert.deepEqual([days[1].goodsIn, days[1].cartons, days[1].sent], [2, 10, 0]);
  const goods = bookDays(book, "in");
  assert.ok(goods.every((d) => d.entries.every((e) => e.kind === "in")), "goods in only");
  const out = bookDays(book, "out");
  assert.ok(out.every((d) => d.entries.every((e) => e.kind !== "in")), "dispatch only");
  assert.deepEqual(bookDays(parseBook(null)), []);
});

test("the totals add up per supply and per product", () => {
  const t = bookTotals(bookDays(parseBook(ANSWER)));
  assert.equal(t.goodsIn, 3);
  assert.deepEqual(t.supplies, [
    { item_id: "trig", times: 2, qty: 2000, kg: null },
    { item_id: "stk", times: 1, qty: 5000, kg: 12.5 },
  ]);
  assert.deepEqual([t.cartons, t.units, t.sent], [50, 1560, 1]);
  assert.deepEqual(t.products, [
    { product_id: "kc", cartons: 35, units: 840 },
    { product_id: "rr", cartons: 15, units: 720 },
  ]);
});

test("the spreadsheet lists every entry shown, oldest first", () => {
  const items = { trig: { name: "24MM Trigger White", simple: "White trigger", unit: "pcs" as const, perBox: 40 }, stk: { name: "Kitchen sticker", simple: null, unit: "pcs" as const, perBox: null } };
  const csv = bookCsv(bookDays(parseBook(ANSWER)), (id) => items[id as keyof typeof items], (id) => ({ kc: "Kitchen Cleaner 500ml", rr: "Rat Repellent 300ml" })[id] ?? "?");
  const lines = csv.trim().split("\r\n");
  assert.equal(lines[0], "Date,Time,What,Supply or product,Quantity,Unit,Kg,Cartons,Dispatch,By,Note");
  assert.equal(lines.length, 1 + 7);
  assert.equal(lines[1], "2026-11-24,8:30 am,Goods in,24MM Trigger White,800,pcs,,,,Rajesh,");
  assert.equal(lines[2], "2026-11-24,9:30 am,Goods in,Kitchen sticker,5000,pcs,12.5,,,Mahesh,Shop bill 44");
  assert.equal(lines[3], "2026-11-24,1:30 – 2:00 pm,Loaded,Kitchen Cleaner 500ml,240,pcs,,10,8,Mahesh,");
  assert.equal(lines.at(-1), "2026-11-26,12:30 pm,Dispatch sent,,1320,pcs,,40,7,Rajesh,38 of 40 cartons reached VRPRIME");
  assert.ok(bookCsv([], () => undefined, () => "").startsWith("Date,"), "an empty range still has its headings");
});
