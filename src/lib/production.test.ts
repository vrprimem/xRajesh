import assert from "node:assert/strict";
import { test } from "node:test";
import { dailyOutput, paceOf, planTimeline, supplyDaysLeft, type PlanNeed } from "./production.ts";
import type { ItemStock, ReadyRow, RecipeLine } from "./supplies.ts";

const TODAY = "2026-11-23";

const row = (id: string, over: Partial<ReadyRow> = {}): ReadyRow => ({
  product_id: id,
  name: id,
  units_per_carton: 20,
  daily_capacity: null,
  active: true,
  ready: 0,
  made_7d: 0,
  made_30d: 0,
  days_30d: 0,
  last_made_on: null,
  ...over,
});

const plan = (number: number, due: string, lines: [string, number][]): PlanNeed => ({
  id: `p${number}`,
  number,
  due_on: due,
  lines: lines.map(([product_id, cartons]) => ({ product_id, product: product_id.toUpperCase(), units_per_carton: 20, cartons })),
});

test("daily output: every one of the last days, oldest first, batches of a day added up", () => {
  const out = dailyOutput(
    [
      { made_on: "2026-11-23", units: 100 },
      { made_on: "2026-11-23", units: 50 },
      { made_on: "2026-11-21", units: 300 },
      { made_on: "2026-11-01", units: 999 },
    ],
    TODAY,
    3,
  );
  assert.deepEqual(out, [
    { day: "2026-11-21", units: 300 },
    { day: "2026-11-22", units: 0 },
    { day: "2026-11-23", units: 150 },
  ]);
});

test("pace: what was made on the days it was made, else the daily capacity, else unknown", () => {
  assert.deepEqual(paceOf({ made_30d: 3000, days_30d: 4, daily_capacity: 5000 }), { perDay: 750, basis: "made" });
  assert.deepEqual(paceOf({ made_30d: 0, days_30d: 0, daily_capacity: 500 }), { perDay: 500, basis: "capacity" });
  assert.equal(paceOf({ made_30d: 0, days_30d: 0, daily_capacity: null }), null);
  assert.equal(paceOf({ made_30d: 0, days_30d: 0, daily_capacity: 0 }), null);
});

test("plans are made in due order: ready stock first, then production days, one after another", () => {
  const ready = [row("a", { ready: 100, made_30d: 2000, days_30d: 4 }), row("b", { daily_capacity: 200 })];
  const est = planTimeline(
    [
      plan(2, "2026-11-30", [["a", 40]]), // 800 units of a
      plan(1, "2026-11-25", [
        ["a", 10],
        ["b", 10],
      ]), // 200 of a (100 ready), 200 of b
    ],
    ready,
    [],
    [],
    TODAY,
  );
  assert.deepEqual(
    est.map((e) => e.number),
    [1, 2],
    "earliest due first",
  );
  const [p1, p2] = est;
  assert.deepEqual(
    p1.lines.map((l) => [l.fromStock, l.toMake]),
    [
      [100, 100],
      [0, 200],
    ],
  );
  // 100 of a at 500 a day = 0.2 days, 200 of b at 200 a day = 1 day: 1.2 days -> ready in 2 days.
  assert.equal(p1.days, 1.2);
  assert.equal(p1.readyBy, "2026-11-25");
  assert.equal(p1.late, false);
  // Then 800 of a at 500 a day = 1.6 days: 2.8 days from today -> 3 days.
  assert.equal(p2.lines[0].fromStock, 0, "the ready stock went to plan 1");
  assert.equal(p2.readyBy, "2026-11-26");
});

test("a plan the ready stock covers is ready today, whatever is queued before it", () => {
  const est = planTimeline([plan(1, "2026-11-24", [["b", 50]]), plan(2, "2026-11-25", [["a", 5]])], [row("a", { ready: 500 }), row("b", { daily_capacity: 100 })], [], [], TODAY);
  assert.equal(est[0].readyBy, "2026-12-03", "1,000 of b at 100 a day");
  assert.equal(est[0].late, true);
  assert.equal(est[1].readyBy, TODAY);
  assert.equal(est[1].toMake, 0);
});

test("with no pace the time is unknown, and later plans wait behind it", () => {
  const est = planTimeline([plan(1, "2026-11-24", [["x", 1]]), plan(2, "2026-11-26", [["b", 1]])], [row("x"), row("b", { daily_capacity: 100 })], [], [], TODAY);
  assert.equal(est[0].readyBy, null);
  assert.deepEqual(est[0].unknown, ["X"]);
  assert.equal(est[0].after, null);
  assert.equal(est[1].readyBy, null);
  assert.equal(est[1].after, 1);
});

test("negative ready stock counts as none", () => {
  const est = planTimeline([plan(1, "2026-11-30", [["a", 1]])], [row("a", { ready: -80, daily_capacity: 20 })], [], [], TODAY);
  assert.equal(est[0].lines[0].fromStock, 0);
  assert.equal(est[0].readyBy, "2026-11-24");
});

test("supplies: the recipes take them plan by plan, and what runs short is shown", () => {
  const recipes: RecipeLine[] = [
    { product_id: "a", item_id: "trig", qty: 1, per: "unit" },
    { product_id: "a", item_id: "box", qty: 1, per: "carton" },
  ];
  const supplies: ItemStock[] = [
    { id: "trig", name: "Trigger", kind: "trigger", unit: "pcs", low_level: null, active: true, on_hand: 500 },
    { id: "box", name: "Hard carton", kind: "carton_hard", unit: "pcs", low_level: null, active: true, on_hand: 100 },
  ];
  const est = planTimeline([plan(1, "2026-11-25", [["a", 20]]), plan(2, "2026-11-30", [["a", 20]])], [row("a", { daily_capacity: 1000 })], recipes, supplies, TODAY);
  assert.deepEqual(est[0].short, [], "400 triggers and 20 cartons are there");
  assert.deepEqual(
    est[1].short.map((s) => [s.name, s.need, s.have]),
    [["Trigger", 400, 100]],
    "plan 2 finds 100 triggers left",
  );
});

test("days of supplies left: stock over the average used a day by production", () => {
  const days = supplyDaysLeft(
    [
      { id: "b", on_hand: 900 },
      { id: "t", on_hand: 50 },
    ],
    [
      { item_id: "b", qty: -300, reason: "production", moved_on: "2026-11-20" },
      { item_id: "b", qty: 1000, reason: "purchase", moved_on: "2026-11-20" },
      { item_id: "b", qty: -999, reason: "production", moved_on: "2026-09-01" },
    ],
    TODAY,
    30,
  );
  assert.equal(days.get("b"), 90, "300 used in 30 days is 10 a day: 900 last 90 days");
  assert.equal(days.get("t"), null, "not used lately");
});
