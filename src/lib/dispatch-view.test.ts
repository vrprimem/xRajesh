import assert from "node:assert/strict";
import { test } from "node:test";
import { arrivalOf, labelGroups, nextStep, productCartons, stageOf, type ListCarton, type ListDispatch } from "./dispatch-view.ts";

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

test("a dispatch's products: a product on two lines counted once, most cartons first", () => {
  assert.deepEqual(
    productCartons([
      { product_id: "rr", product: "Rat Repellent", carton_type: "T", cartons: 5 },
      { product_id: "kc", product: "Kitchen Cleaner", carton_type: "H", cartons: 4 },
      { product_id: "kc", product: "Kitchen Cleaner", carton_type: "T", cartons: 2 },
    ]),
    [
      { product_id: "kc", product: "Kitchen Cleaner", cartons: 6 },
      { product_id: "rr", product: "Rat Repellent", cartons: 5 },
    ],
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
