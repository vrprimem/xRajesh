import assert from "node:assert/strict";
import { test } from "node:test";
import { averageRates, costSheet, monthMoney, purchaseAmount } from "./money.ts";
import { boxesAndPieces, formatBoxes, formatQty, formatRupees, inStockUnits, isLow, perLitre, readNumber } from "./supplies.ts";

test("a purchase is quantity x rate plus GST, to the paisa, as the database works it out", () => {
  assert.equal(purchaseAmount(1000, 4.5, 18), 5310);
  assert.equal(purchaseAmount(3, 3.33, 5), 10.49);
  assert.equal(purchaseAmount(10, 2, 0), 20);
});

test("a month's money: bought, paid, each kind of cost, and the month's spend", () => {
  const m = monthMoney(
    [{ amount: 5310 }, { amount: 3000 }],
    [{ amount: 2000 }],
    [
      { kind: "labour", amount: 2000 },
      { kind: "hamali", amount: 350.5 },
      { kind: "hamali", amount: 0.1 },
      { kind: "hamali", amount: 0.2 },
    ],
  );
  assert.equal(m.bought, 8310);
  assert.equal(m.paid, 2000);
  assert.equal(m.costs.labour, 2000);
  assert.equal(m.costs.hamali, 350.8);
  assert.equal(m.costs.rent, 0);
  assert.equal(m.costsTotal, 2350.8);
  assert.equal(m.spend, 10660.8);
});

test("an empty month adds up to nothing", () => {
  const m = monthMoney([], [], []);
  assert.deepEqual([m.bought, m.paid, m.costsTotal, m.spend], [0, 0, 0, 0]);
});

test("a supply's average price is everything paid for it over everything bought", () => {
  const rates = averageRates([
    { item_id: "b", qty: 1000, amount: 5310 },
    { item_id: "b", qty: 1000, amount: 4690 },
    { item_id: "t", qty: 500, amount: 1500 },
  ]);
  assert.equal(rates.get("b"), 5);
  assert.equal(rates.get("t"), 3);
  assert.equal(rates.get("x"), undefined);
});

test("cost per unit: the recipe at average prices, plus the period's other costs over every unit made", () => {
  const products = [
    { id: "kc", name: "Kitchen cleaner", units_per_carton: 20, active: true },
    { id: "gc", name: "Glass cleaner", units_per_carton: 24, active: true },
    { id: "old", name: "Old product", units_per_carton: 10, active: false },
    { id: "gone", name: "Gone product", units_per_carton: 10, active: false },
  ];
  const recipes = [
    { product_id: "kc", item_id: "bottle", qty: 1, per: "unit" as const },
    { product_id: "kc", item_id: "chem", qty: 0.5, per: "unit" as const },
    { product_id: "kc", item_id: "box", qty: 1, per: "carton" as const },
    { product_id: "gc", item_id: "trigger", qty: 1, per: "unit" as const },
  ];
  const rates = new Map([
    ["bottle", 5],
    ["chem", 50],
    ["box", 20],
  ]);
  const names = new Map([["trigger", "Trigger"]]);
  const made = new Map([
    ["kc", 300],
    ["old", 100],
  ]);
  const sheet = costSheet(products, recipes, rates, names, made, 2000);
  assert.equal(sheet.unitsMade, 400);
  assert.equal(sheet.overheadPerUnit, 5);
  const kc = sheet.rows.find((r) => r.product_id === "kc")!;
  // 5 + 0.5 x 50 + 20 / 20 = 31 in supplies, + 5 of labour and the rest.
  assert.equal(kc.supplies, 31);
  assert.equal(kc.total, 36);
  assert.equal(kc.perCarton, 720);
  const gc = sheet.rows.find((r) => r.product_id === "gc")!;
  assert.equal(gc.complete, false, "a supply with no price makes the cost a minimum");
  assert.equal(gc.total, 5, "... here only the labour and the rest");
  assert.deepEqual(gc.unpriced, ["Trigger"]);
  assert.equal(kc.complete, true);
  const old = sheet.rows.find((r) => r.product_id === "old")!;
  assert.ok(old.noRecipe && old.total === null && !old.complete, "an inactive product made in the period is listed, with no recipe");
  assert.ok(!sheet.rows.some((r) => r.product_id === "gone"), "an inactive product not made is left out");
  assert.equal(sheet.rows[0].product_id, "kc", "most made first");
});

test("with nothing made, the other costs cannot be spread; supplies still are", () => {
  const sheet = costSheet([{ id: "kc", name: "K", units_per_carton: 10, active: true }], [{ product_id: "kc", item_id: "b", qty: 2, per: "unit" }], new Map([["b", 1.5]]), new Map(), new Map(), 900);
  assert.equal(sheet.overheadPerUnit, null);
  assert.equal(sheet.rows[0].supplies, 3);
  assert.equal(sheet.rows[0].total, 3);
});

test("supply quantities, rupees, low stock, cartons and typed numbers read as people write them", () => {
  assert.equal(formatQty(1000, "pcs"), "1,000 pcs");
  assert.equal(formatQty(12.5, "litre"), "12.5 L");
  assert.equal(formatRupees(5310), "₹5,310.00");
  assert.equal(formatRupees(4.5), "₹4.50");
  assert.ok(isLow({ low_level: 100, on_hand: 100 }));
  assert.ok(!isLow({ low_level: 100, on_hand: 101 }));
  assert.ok(!isLow({ low_level: null, on_hand: 0 }));
  assert.equal(boxesAndPieces(244, 20), "12 boxes + 4 pcs");
  assert.equal(boxesAndPieces(20, 20), "1 box");
  assert.equal(boxesAndPieces(18, 20), "18 pcs");
  assert.equal(formatBoxes(2400, "pcs", 1000), "2 boxes + 400 pcs");
  assert.equal(formatBoxes(3, "kg", 1.5), "2 boxes");
  assert.equal(formatBoxes(1.2, "kg", 1.5), "1.2 kg", "under one box: in its unit");
  assert.equal(formatBoxes(640, "pcs", null), "640 pcs");
  assert.equal(readNumber(" 1,200 "), 1200);
  assert.equal(readNumber("₹4.50"), 4.5);
  assert.equal(readNumber("-3"), null);
  assert.equal(readNumber("12abc"), null);
  assert.equal(readNumber(""), null);
});

test("a chemical in a recipe is litres of liquid; in stock, kg by what it makes", () => {
  const items = [
    { id: "rep", mix_qty: 1.5, mix_litres: 160 },
    { id: "bottle", mix_qty: null, mix_litres: null },
  ];
  const recipes = [
    { product_id: "p", item_id: "rep", qty: 0.25, per: "unit" as const },
    { product_id: "p", item_id: "bottle", qty: 1, per: "unit" as const },
  ];
  const kg = inStockUnits(recipes, items);
  assert.ok(Math.abs(kg[0].qty - 0.00234375) < 1e-12, "0.25 L of a 1.5 kg to 160 L chemical");
  assert.equal(kg[1].qty, 1, "other supplies as they are");
  assert.equal(recipes[0].qty, 0.25, "the recipe itself is not changed");
  assert.equal(perLitre({ mix_qty: 1, mix_litres: 12 }), 1 / 12);
  assert.equal(perLitre({ mix_qty: null, mix_litres: 12 }), null);
});
