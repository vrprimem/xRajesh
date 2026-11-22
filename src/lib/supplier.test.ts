import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addPending,
  checkDigit,
  cleanBarcode,
  code128Svg,
  code128Values,
  code128Widths,
  dispatchCounts,
  dropAnswered,
  isCartonBarcode,
  parseProductsTable,
  readPending,
  suggestedUnits,
} from "./supplier.ts";

test("check digit: weights 3,1 from the right, as the database makes it", () => {
  // 9 followed by the sequence number 1, padded to 14 digits: the first barcode the database issues.
  assert.equal(checkDigit("900000000000001"), 0);
  assert.equal(checkDigit("900000000000002"), 7);
  // The retail example 400638133393 -> 1 (EAN-13 uses the same rule).
  assert.equal(checkDigit("400638133393"), 1);
});

test("a carton barcode is 16 digits, starts with 9, and its last digit checks", () => {
  assert.equal(isCartonBarcode("9000000000000010"), true);
  assert.equal(isCartonBarcode("9000000000000011"), false, "wrong check digit");
  assert.equal(isCartonBarcode("9000000000000100"), false, "two digits swapped");
  assert.equal(isCartonBarcode("1010001071105027"), false, "the inventory software's own number is not ours");
  assert.equal(isCartonBarcode("900000000000001"), false, "too short");
  assert.equal(cleanBarcode(" 9000-0000 0000 0010\n"), "9000000000000010");
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

test("products sheet: headings found by name, defaults filled", () => {
  const { rows, errors } = parseProductsTable([
    ["Product Name", "VRPRIME Master SKU", "Category", "Pcs per carton", "Carton type", "Daily capacity"],
    ["Kitchen Cleaner 500ml", "150-KC", "Kitchen cleaner", "24", "Hard", "1,200"],
    ["Rat Repellent Spray", "", "repellent", "48", "2-ply", ""],
    ["", "", "", "", "", ""],
    ["Glass Cleaner", "151-GC", "", "12", "", ""],
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [
    { name: "Kitchen Cleaner 500ml", master_code: "150-KC", category: "kitchen_cleaner", units_per_carton: 24, carton_type: "H", daily_capacity: 1200, active: true },
    { name: "Rat Repellent Spray", master_code: null, category: "repellent", units_per_carton: 48, carton_type: "T", daily_capacity: null, active: true },
    { name: "Glass Cleaner", master_code: "151-GC", category: "other", units_per_carton: 12, carton_type: "H", daily_capacity: null, active: true },
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
  assert.equal(bad.errors.length, 3);
  assert.match(bad.errors[0], /Row 3 \(B\)/);
  assert.match(bad.errors[1], /Row 4: "a" is in the sheet twice/);
  assert.match(bad.errors[2], /Row 5 \(C\).*Plastic/);
  assert.match(parseProductsTable([["Item code", "Qty"]]).errors.join(" "), /No "Name" column/);
  assert.match(parseProductsTable([["Name", "Units per carton"]]).errors.join(" "), /no products/);
});

test("dispatch counts: planned from the plan, the rest from the labels, split by carton type", () => {
  const counts = dispatchCounts(
    [
      { carton_type: "H", cartons: 3 },
      { carton_type: "T", cartons: 2 },
    ],
    [
      { carton_type: "H", status: "loaded", units: 24 },
      { carton_type: "H", status: "void", units: 24 }, // damaged label
      { carton_type: "H", status: "loaded", units: 24 }, // its reprint
      { carton_type: "H", status: "issued", units: 24 },
      { carton_type: "T", status: "loaded", units: 48 },
      { carton_type: "T", status: "issued", units: 48 },
    ],
  );
  assert.deepEqual(counts.byType, { H: { planned: 3, loaded: 2, left: 1 }, T: { planned: 2, loaded: 1, left: 1 } });
  assert.equal(counts.planned, 5);
  assert.equal(counts.loaded, 3);
  assert.equal(counts.left, 2);
  assert.equal(counts.voided, 1);
  assert.equal(counts.units, 96);
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

test("suggested quantity: up to twice the minimum, in full cartons", () => {
  assert.equal(suggestedUnits(40, 60, 150, 20), 200);
  assert.equal(suggestedUnits(0, 0, 100, 24), 216, "200 short is 9 cartons of 24");
  assert.equal(suggestedUnits(500, 0, 150, 20), 0);
});
