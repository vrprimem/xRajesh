import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReport, csvCell, istDay, monthBounds, shiftMonth, toCsv } from "./report.ts";

test("month bounds are India's month, in UTC", () => {
  assert.deepEqual(monthBounds("2026-11"), { from: "2026-10-31T18:30:00.000Z", to: "2026-11-30T18:30:00.000Z" });
  assert.deepEqual(monthBounds("2026-12"), { from: "2026-11-30T18:30:00.000Z", to: "2026-12-31T18:30:00.000Z" });
  assert.equal(monthBounds("2026-13"), null);
  assert.equal(monthBounds("nov"), null);
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(istDay("2026-11-22T20:00:00Z"), "2026-11-23", "after 6:30 pm UTC it is the next day in India");
});

test("the report counts loaded cartons by dispatch, product and day, and what arrived", () => {
  const dispatches = [
    { id: "d1", number: 1, status: "received", closed_at: "2026-11-05T06:00:00Z" },
    { id: "d2", number: 2, status: "closed", closed_at: "2026-11-05T09:00:00Z" },
    { id: "d3", number: 3, status: "closed", closed_at: "2026-11-20T06:00:00Z" },
  ];
  const c = (dispatch_id: string, product_id: string, units: number, arrived: boolean) => ({ dispatch_id, product_id, units, inbound_status: arrived ? "received" : null });
  const cartons = [c("d1", "a", 24, true), c("d1", "a", 24, true), c("d1", "b", 48, true), c("d2", "a", 24, false), c("d3", "b", 48, true), c("other", "a", 24, true)];
  const names: Record<string, string> = { a: "Kitchen Cleaner", b: "Rat Repellent" };
  const r = buildReport(dispatches, cartons, (id) => names[id]);
  assert.deepEqual(r.totals, { cartons: 5, units: 168, arrived: 4, dispatches: 3 }, "a carton of another dispatch is left out");
  assert.deepEqual(r.byDispatch.map((d) => [d.number, d.cartons, d.arrived, d.day]), [[1, 3, 3, "2026-11-05"], [2, 1, 0, "2026-11-05"], [3, 1, 1, "2026-11-20"]]);
  assert.deepEqual(r.byProduct.map((p) => [p.product, p.cartons, p.units]), [["Rat Repellent", 2, 96], ["Kitchen Cleaner", 3, 72]], "most units first");
  assert.deepEqual(r.byDay.map((d) => [d.day, d.cartons]), [["2026-11-05", 4], ["2026-11-20", 1]]);
});

test("CSV: quoted where needed, formulas neutralised", () => {
  assert.equal(csvCell('Cleaner, "lemon"'), '"Cleaner, ""lemon"""');
  assert.equal(csvCell("=1+2"), "'=1+2");
  assert.equal(csvCell(-5), "-5", "a negative number stays a number");
  assert.equal(csvCell(null), "");
  assert.equal(toCsv(["A", "B"], [[1, "x"]]), "A,B\r\n1,x\r\n");
});
