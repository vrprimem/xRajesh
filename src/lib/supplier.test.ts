import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addPending,
  cartonWeightFor,
  cartonsFor,
  cleanBarcode,
  code128Svg,
  code128Values,
  code128Widths,
  dispatchCounts,
  dropAnswered,
  isCartonBarcode,
  labelsOwed,
  parseProductsTable,
  parseWeight,
  plainSvg,
  readPending,
  suggestedUnits,
} from "./supplier.ts";

test("a carton barcode is the inventory software's: 16 digits starting with 1", () => {
  assert.equal(isCartonBarcode("1010001071105027"), true);
  assert.equal(isCartonBarcode("9000000000000010"), false, "a number the portal used to make up");
  assert.equal(isCartonBarcode("101000107110502"), false, "too short");
  assert.equal(isCartonBarcode("10100010711050270"), false, "too long");
  assert.equal(isCartonBarcode("C-1-2-3-4"), false);
  assert.equal(cleanBarcode(" 1010-0010 7110 5027\n"), "1010001071105027");
});

test("the label's barcode picture is used only if it is a plain picture", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 5"><rect width="2" height="5"/></svg>';
  assert.equal(plainSvg(svg), svg);
  assert.equal(plainSvg(null), null);
  assert.equal(plainSvg('<svg onload="x()"></svg>'), null);
  assert.equal(plainSvg("<svg><script>1</script></svg>"), null);
  assert.equal(plainSvg("<p>no</p>"), null);
});

test("Code 128: every pattern is 11 modules, the values and checksum are right", () => {
  // Start C (105), pairs 90 00 00 00 00 00 00 10, checksum = (105 + 90*1 + 0 + ... + 10*8) mod 103.
  const values = code128Values("9000000000000010");
  assert.deepEqual(values.slice(0, 9), [105, 90, 0, 0, 0, 0, 0, 0, 10]);
  assert.equal(values[9], (105 + 90 + 80) % 103);
  const widths = code128Widths("9000000000000010");
  // 10 values of 6 widths, and the stop of 7.
  assert.equal(widths.length, 10 * 6 + 7);
  for (let v = 0; v < 10; v++) assert.equal(widths.slice(v * 6, v * 6 + 6).reduce((a, b) => a + b, 0), 11, `value ${v} is 11 modules`);
  assert.equal(widths.slice(60).reduce((a, b) => a + b, 0), 13, "the stop is 13 modules");
  // Start C is 2 1 1 2 3 2.
  assert.deepEqual(widths.slice(0, 6), [2, 1, 1, 2, 3, 2]);
  assert.throws(() => code128Values("123"), /even/);
  assert.throws(() => code128Values("12a4"), /even/);
});

test("Code 128: the patterns of values 0 to 99 are all different and 11 modules wide", () => {
  const seen = new Set<string>();
  for (let v = 0; v < 100; v++) {
    const w = code128Widths(String(v).padStart(2, "0")).slice(6, 12);
    assert.equal(w.reduce((a, b) => a + b, 0), 11, `value ${v}`);
    assert.equal(w.length, 6);
    seen.add(w.join(""));
  }
  assert.equal(seen.size, 100);
});

test("the barcode picture has a quiet zone and one bar per odd width", () => {
  const svg = code128Svg("9000000000000010", 50);
  // 10 values x 11 + stop 13 + 2 x 10 quiet = 143 modules.
  assert.match(svg, /viewBox="0 0 143 50"/);
  assert.equal((svg.match(/<rect x=/g) ?? []).length, 10 * 3 + 4);
  assert.match(svg, /<rect x="10" y="0" width="2"/, "the first bar starts after the quiet zone");
});

test("products sheet: headings found by name, defaults filled, an old carton type column left alone", () => {
  const { rows, errors } = parseProductsTable([
    ["Product Name", "VRPRIME Master SKU", "Category", "Pcs per carton", "Carton type", "Daily capacity", "Carton weight (kg)"],
    ["Kitchen Cleaner 500ml", "150-KC", "Kitchen cleaner", "24", "Hard", "1,200", "12.5"],
    ["Rat Repellent Spray", "", "repellent", "48", "2-ply", "", ""],
    ["", "", "", "", "", "", ""],
    ["Glass Cleaner", "151-GC", "", "12", "", "", "6 kg"],
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [
    { name: "Kitchen Cleaner 500ml", master_code: "150-KC", category: "kitchen_cleaner", units_per_carton: 24, daily_capacity: 1200, active: true, weight_per_carton: 12.5 },
    { name: "Rat Repellent Spray", master_code: null, category: "repellent", units_per_carton: 48, daily_capacity: null, active: true, weight_per_carton: null },
    { name: "Glass Cleaner", master_code: "151-GC", category: "other", units_per_carton: 12, daily_capacity: null, active: true, weight_per_carton: 6 },
  ]);
});

test("products sheet: a problem names its row and nothing is imported", () => {
  const bad = parseProductsTable([
    ["Name", "Units per carton", "Carton type"],
    ["A", "24", "Hard"],
    ["B", "two dozen", "Hard"],
    ["a", "12", "Hard"],
    ["C", "12", "Plastic"],
  ]);
  assert.equal(bad.rows.length, 0);
  assert.equal(bad.errors.length, 2, "the carton type column is not read, so Plastic is no problem");
  assert.match(bad.errors[0], /Row 3 \(B\)/);
  assert.match(bad.errors[1], /Row 4: "a" is in the sheet twice/);
  assert.match(parseProductsTable([["Item code", "Qty"]]).errors.join(" "), /No "Name" column/);
  assert.match(parseProductsTable([["Name", "Units per carton"]]).errors.join(" "), /no products/);
});

test("carton weight: kg above 0, to 2 places; empty is none", () => {
  assert.equal(parseWeight("8.456"), 8.46);
  assert.equal(parseWeight(" 12 kg "), 12);
  assert.equal(parseWeight(""), null);
  assert.equal(parseWeight("0"), "bad");
  assert.equal(parseWeight("-2"), "bad");
  assert.equal(parseWeight("heavy"), "bad");
  assert.equal(parseWeight("1001"), "bad");
});

test("dispatch counts: planned from the plan, the rest from the labels", () => {
  const counts = dispatchCounts(
    [{ cartons: 3 }, { cartons: 2 }],
    [
      { status: "loaded", units: 24 },
      { status: "void", units: 24 }, // damaged label
      { status: "loaded", units: 24 }, // its reprint
      { status: "issued", units: 24 },
      { status: "loaded", units: 48 },
      { status: "issued", units: 48 },
    ],
  );
  assert.equal(counts.planned, 5);
  assert.equal(counts.loaded, 3);
  assert.equal(counts.left, 2);
  assert.equal(counts.voided, 1);
  assert.equal(counts.units, 96);
});

test("labels owed: planned less made; a reprint is owed again, an unused void is not", () => {
  const lines = [
    { product_id: "a", carton_type: "H" as const, cartons: 3 },
    { product_id: "b", carton_type: "T" as const, cartons: 2 },
  ];
  const label = (product_id: string, carton_type: "H" | "T", status: "issued" | "loaded" | "void", void_reason: string | null = null) => ({ product_id, carton_type, status, void_reason });
  assert.equal(labelsOwed(lines, []), 5, "nothing made yet");
  assert.equal(labelsOwed(lines, [label("a", "H", "issued"), label("a", "H", "loaded")]), 3);
  assert.equal(labelsOwed(lines, [label("a", "H", "issued"), label("a", "H", "loaded"), label("a", "H", "void", "reprinted"), label("b", "T", "issued"), label("b", "T", "void", "not used")]), 1, "the reprint is still owed");
  assert.equal(labelsOwed(lines, [label("a", "H", "issued"), label("a", "H", "issued"), label("a", "H", "issued"), label("a", "H", "issued"), label("b", "T", "issued"), label("b", "T", "issued")]), 0, "never negative");
});

test("the waiting list: one entry per carton, answered scans leave, bad storage is an empty list", () => {
  let q = addPending([], "9000000000000010", "2026-11-23T10:00:00Z");
  q = addPending(q, "9000000000000010", "2026-11-23T10:00:05Z");
  q = addPending(q, "9000000000000027", "2026-11-23T10:00:09Z");
  assert.equal(q.length, 2);
  assert.equal(q[0].at, "2026-11-23T10:00:00Z", "the first time is kept");
  assert.deepEqual(dropAnswered(q, [{ barcode: "9000000000000010" }]), [{ barcode: "9000000000000027", at: "2026-11-23T10:00:09Z" }]);
  assert.deepEqual(readPending(JSON.stringify(q)), q);
  assert.deepEqual(readPending("not json"), []);
  assert.deepEqual(readPending('{"barcode":"x"}'), []);
  assert.deepEqual(readPending('[{"barcode":1},{"barcode":"9","at":"t"}]'), [{ barcode: "9", at: "t" }]);
  assert.deepEqual(readPending(null), []);
});

test("a send plan rounds units up to whole cartons", () => {
  assert.equal(cartonsFor(1000, 24), 42);
  assert.equal(cartonsFor(960, 24), 40);
  assert.equal(cartonsFor(1, 110), 1);
  assert.equal(cartonsFor(0, 24), 0);
  assert.equal(cartonsFor(-5, 24), 0);
  assert.equal(cartonsFor(100, 0), 0);
});

test("suggested quantity: up to twice the minimum, in full cartons", () => {
  assert.equal(suggestedUnits(40, 60, 150, 20), 200);
  assert.equal(suggestedUnits(0, 0, 100, 24), 216, "200 short is 9 cartons of 24");
  assert.equal(suggestedUnits(500, 0, 150, 20), 0);
});

test("a carton's weight follows its pieces, worked out from the full carton", () => {
  assert.equal(cartonWeightFor(8.5, 24, 12), 4.25);
  assert.equal(cartonWeightFor(8.46, 20, 20), 8.46);
  assert.equal(cartonWeightFor(8.5, 24, 7), 2.48);
  assert.equal(cartonWeightFor(null, 24, 12), null);
  assert.equal(cartonWeightFor(8.5, 24, 0), null);
});
