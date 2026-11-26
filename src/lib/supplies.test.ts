import assert from "node:assert/strict";
import { test } from "node:test";
import { recipeUses, removeSupplyText } from "./supplies.ts";

test("each supply lists the products whose recipes use it, A to Z; recipes of unknown products are left out", () => {
  const recipes = [
    { product_id: "p2", item_id: "bottle" },
    { product_id: "p1", item_id: "bottle" },
    { product_id: "p1", item_id: "carton" },
    { product_id: "gone", item_id: "tape" },
  ];
  const products = [
    { id: "p1", name: "Kitchen Cleaner Spray 500ml" },
    { id: "p2", name: "Glass Cleaner 500ml" },
  ];
  assert.deepEqual(recipeUses(recipes, products), { bottle: ["Glass Cleaner 500ml", "Kitchen Cleaner Spray 500ml"], carton: ["Kitchen Cleaner Spray 500ml"] });
  assert.deepEqual(recipeUses([], products), {});
});

test("removing a supply says what goes with it and which recipes it leaves", () => {
  const bottle = { name: "19MM 500ML BOTTLE", on_hand: 4200, unit: "pcs" as const, box_qty: 200, photo_path: "s/items/x.jpg" };
  assert.equal(
    removeSupplyText(bottle, ["Glass Cleaner 500ml", "Kitchen Cleaner Spray 500ml", "Tap Cleaner 500ml"]),
    [
      "Remove 19MM 500ML BOTTLE from your supplies for good? It cannot be brought back.",
      "",
      "Its stock (21 boxes), its stock changes and its photo go with it.",
      "It is taken out of the recipes of Glass Cleaner 500ml, Kitchen Cleaner Spray 500ml and Tap Cleaner 500ml.",
      "",
      'To keep it but hide it, use Edit and untick "In use" instead.',
    ].join("\n"),
  );
  const tape = removeSupplyText({ name: "Packing tape", on_hand: 0, unit: "metre", box_qty: null, photo_path: null }, []).split("\n");
  assert.equal(tape[2], "Its stock changes go with it.", "no stock, no photo: just its changes");
  assert.ok(!tape.some((l) => l.includes("recipe")), "in no recipe: nothing said about recipes");
  const chemical = removeSupplyText({ name: "Repellent chemical", on_hand: 4.5, unit: "kg", box_qty: 1.5, photo_path: null }, ["Rat Repellent Spray 300ml"]).split("\n");
  assert.equal(chemical[2], "Its stock (3 boxes) and its stock changes go with it.");
  assert.equal(chemical[3], "It is taken out of the recipe of Rat Repellent Spray 300ml.");
});
