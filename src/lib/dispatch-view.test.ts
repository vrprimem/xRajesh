import assert from "node:assert/strict";
import { test } from "node:test";
import { arrivalOf, cartonRanges, labelGroups, labelParts, labelsToDownload, loadedKg, nextStep, partSummary, plannedKg, productCartons, stageOf, type ListCarton, type ListDispatch } from "./dispatch-view.ts";

const carton = (over: Partial<ListCarton> = {}): ListCarton => ({ product_id: "kc", carton_type: "H", status: "issued", units: 24, void_reason: null, inbound_status: null, inbound_at: null, ...over });

const dispatch = (over: Partial<ListDispatch> = {}): ListDispatch => ({
  status: "loading",
  closed_at: null,
  received_at: null,
  vehicle_photo_path: null,
  lines: [{ product_id: "kc", product: "Kitchen Cleaner", carton_type: "H", cartons: 3 }],
  cartons: [carton({ status: "loaded" }), carton(), carton()],
  ...over,
});

test("stages: planned and loading to load, closed on the way, received arrived", () => {
  assert.deepEqual(
    (["planned", "loading", "closed", "received", "cancelled"] as const).map(stageOf),
    ["to_load", "to_load", "on_the_way", "arrived", "cancelled"],
  );
});

test("the next step: scan while labels are left, then the vehicle photo, then close", () => {
  assert.deepEqual(nextStep(dispatch(), "scanner"), { label: "Scan cartons", to: "scan" });
  const loaded = [carton({ status: "loaded" }), carton({ status: "loaded" }), carton({ status: "void" })];
  assert.deepEqual(nextStep(dispatch({ cartons: loaded }), "owner"), { label: "Add vehicle photo", to: "page" });
  assert.deepEqual(nextStep(dispatch({ cartons: loaded, vehicle_photo_path: "x.jpg" }), "owner"), { label: "Close dispatch", to: "page" });
  assert.equal(nextStep(dispatch({ cartons: [] }), "owner"), null, "no step while the labels are still being made");
  assert.equal(nextStep(dispatch(), "vrprime"), null, "VRPRIME does not scan");
  assert.deepEqual(nextStep(dispatch({ status: "closed" }), "vrprime"), { label: "Mark received", to: "page" });
  assert.equal(nextStep(dispatch({ status: "closed" }), "owner"), null);
  assert.equal(nextStep(dispatch({ status: "received" }), "vrprime"), null);
});

test("arrival: cartons scanned in of those loaded, days on the road, late after 3 days with cartons missing", () => {
  const sent = dispatch({
    status: "closed",
    closed_at: "2026-11-18T10:00:00Z",
    cartons: [
      carton({ status: "loaded", inbound_status: "received", inbound_at: "2026-11-19T06:00:00Z" }),
      carton({ status: "loaded", inbound_status: "rejected" }),
      carton({ status: "loaded" }),
      carton({ status: "void" }),
    ],
  });
  assert.deepEqual(arrivalOf(sent, "2026-11-20"), { loaded: 3, arrived: 1, rejected: 1, days: 2, late: false });
  assert.equal(arrivalOf(sent, "2026-11-22")!.late, true, "4 days on the road with a carton missing");
  assert.equal(arrivalOf({ ...sent, cartons: sent.cartons.slice(0, 2) }, "2026-11-30")!.late, false, "nothing missing is never late");
  const received = { ...sent, status: "received" as const, received_at: "2026-11-19T07:00:00Z" };
  assert.equal(arrivalOf(received, "2026-11-30")!.days, 1, "took a day");
  assert.equal(arrivalOf(dispatch(), "2026-11-20"), null, "not sent yet");
});

test("a dispatch's products: a product on two lines counted once, most cartons first, with their weight", () => {
  assert.deepEqual(
    productCartons([
      { product_id: "rr", product: "Rat Repellent", carton_type: "T", cartons: 5, weight_per_carton: null },
      { product_id: "kc", product: "Kitchen Cleaner", carton_type: "H", cartons: 4, weight_per_carton: 8.5 },
      { product_id: "kc", product: "Kitchen Cleaner", carton_type: "T", cartons: 2, weight_per_carton: 6.2 },
    ]),
    [
      { product_id: "kc", product: "Kitchen Cleaner", cartons: 6, kg: 46.4, unweighed: 0 },
      { product_id: "rr", product: "Rat Repellent", cartons: 5, kg: 0, unweighed: 5 },
    ],
  );
});

test("weight: planned from the lines, loaded from the labels of loaded cartons", () => {
  assert.deepEqual(plannedKg([{ cartons: 60, weight_per_carton: 20 }, { cartons: 3, weight_per_carton: 8.45 }, { cartons: 2, weight_per_carton: null }]), { kg: 1225.4, unweighed: 2 });
  assert.deepEqual(plannedKg([]), { kg: 0, unweighed: 0 });
  // Numbers from the database may arrive as text.
  assert.deepEqual(plannedKg([{ cartons: 2, weight_per_carton: "7.25" as unknown as number }]), { kg: 14.5, unweighed: 0 });
  assert.deepEqual(
    loadedKg([
      { status: "loaded", weight_per_carton: 20 },
      { status: "loaded", weight_per_carton: 19.5 },
      { status: "loaded", weight_per_carton: null },
      { status: "issued", weight_per_carton: 20 },
      { status: "void", weight_per_carton: 20 },
    ]),
    { kg: 39.5, unweighed: 1 },
  );
});

test("labels by product: counts, and still-to-scan first", () => {
  const label = (no: number, status: "issued" | "loaded" | "void", over = {}) => ({ product_id: "kc", product: "Kitchen Cleaner", status, carton_no: no, inbound_status: null, ...over });
  const groups = labelGroups(
    [
      { product_id: "kc", product: "Kitchen Cleaner", cartons: 2 },
      { product_id: "rr", product: "Rat Repellent", cartons: 2 },
      { product_id: "kc", product: "Kitchen Cleaner", cartons: 1 }, // an older dispatch: the same product on two lines
    ],
    [label(1, "loaded", { inbound_status: "received" }), label(2, "void"), label(3, "issued"), label(4, "loaded")],
  );
  assert.equal(groups.length, 2, "one group per product");
  const kc = groups[0];
  assert.deepEqual([kc.planned, kc.loaded, kc.toScan, kc.voided, kc.arrived], [3, 2, 1, 1, 1]);
  assert.deepEqual(
    kc.labels.map((l) => l.carton_no),
    [3, 1, 4, 2],
  );
  assert.deepEqual([groups[1].planned, groups[1].labels.length], [2, 0], "a line with no labels yet still shows");
});

// Dispatch 1 as it was made: 183 labels of 9 products, Old Rat the only one over 50.
const DISPATCH_1: [string, number][] = [["Ant Repellent", 13], ["Cockroach Repellent", 6], ["HouseFly Repellent", 40], ["New Scratch 250ml", 12], ["Old Bedbug", 36], ["Old Lizard", 11], ["Old Rat", 60], ["Rat Balls", 1], ["Scratch 150", 4]];
const madeLabels = (products: [string, number][]) => {
  const out: { product_id: string; product: string; carton_no: number; status: "issued" | "loaded" | "void" }[] = [];
  for (const [product, n] of products) for (let i = 0; i < n; i++) out.push({ product_id: product.toLowerCase().replace(/\W+/g, "-"), product, carton_no: out.length + 1, status: "issued" });
  return out;
};

test("label downloads: a product's labels after its 50th come in the next part, as the inventory software makes them", () => {
  const parts = labelParts(madeLabels(DISPATCH_1).reverse());
  assert.equal(parts.length, 2);
  assert.equal(parts[0].labels.length, 173, "the first 50 of every product");
  assert.equal(parts[1].labels.length, 10);
  assert.deepEqual(parts[1].labels.map((l) => l.carton_no), [169, 170, 171, 172, 173, 174, 175, 176, 177, 178], "Old Rat 51 to 60");
  const rat = parts[0].labels.filter((l) => l.product === "Old Rat").map((l) => l.carton_no);
  assert.deepEqual([rat.length, rat[0], rat.at(-1)], [50, 119, 168]);
  assert.ok(parts[0].labels.every((l, i, all) => i === 0 || all[i - 1].carton_no < l.carton_no), "each part in carton order");
  assert.equal(parts.reduce((n, p) => n + p.labels.length, 0), 183, "every label once");
  assert.equal(partSummary(parts[0]), "Old Rat 1 to 50 of 60 and all labels of the other 8 products");
  assert.equal(partSummary(parts[1]), "Old Rat 51 to 60 of 60");
});

test("label downloads: one part while no product is over 50; more parts past 100", () => {
  assert.equal(labelParts(madeLabels([["A", 50], ["B", 50]])).length, 1, "100 labels, but 50 of each");
  assert.deepEqual(labelParts([]), []);
  const parts = labelParts(madeLabels([["Old Rat", 120], ["HouseFly", 60], ["Rat Balls", 1]]));
  assert.deepEqual(parts.map((p) => p.labels.length), [101, 60, 20]);
  assert.equal(partSummary(parts[0]), "Old Rat 1 to 50 of 120, HouseFly 1 to 50 of 60 and the 1 label of Rat Balls");
  assert.equal(partSummary(parts[1]), "Old Rat 51 to 100 of 120 and HouseFly 51 to 60 of 60");
  assert.equal(partSummary(parts[2]), "Old Rat 101 to 120 of 120");
  assert.equal(partSummary(labelParts(madeLabels([["A", 3], ["B", 2]]))[0]), "all labels of 2 products");
});

test("carton numbers as short runs", () => {
  assert.equal(cartonRanges([3, 1, 2, 7, 9, 10]), "1–3, 7, 9–10");
  const parts = labelParts(madeLabels(DISPATCH_1));
  assert.equal(cartonRanges(parts[0].labels.map((l) => l.carton_no)), "1–168, 179–183");
  assert.equal(cartonRanges(parts[1].labels.map((l) => l.carton_no)), "169–178");
  assert.equal(cartonRanges([1, 3, 5, 7, 9, 11]), "1, 3, 5, 7, …");
  assert.equal(cartonRanges([]), "");
});

test("label downloads hold the labels still to scan while loading, then every label that is not void", () => {
  const labels = [{ status: "issued" as const }, { status: "loaded" as const }, { status: "void" as const }];
  assert.deepEqual(labelsToDownload(labels, true), [labels[0]]);
  assert.deepEqual(labelsToDownload(labels, false), [labels[0], labels[1]]);
});
