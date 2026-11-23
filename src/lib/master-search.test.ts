import assert from "node:assert/strict";
import { test } from "node:test";
import { canSearch, searchMasters, searchWords } from "./master-search.ts";

const LIST = [
  { code: "150-KITCHEN", name: "Kitchen Cleaner Spray 500ml" },
  { code: "150-GLASS", name: "Glass Cleaner 500ml" },
  { code: "160-RAT", name: "Rat Repellent Spray 300ml" },
  { code: "CLEAN-KIT", name: "Bathroom Cleaner" },
  { code: "170-100%", name: "Floor Shine 100% Pure" },
];

test("a search is split like the database does: lower case, at most 6 words of the first 60 characters", () => {
  assert.deepEqual(searchWords("  Kitchen   CLEANER "), ["kitchen", "cleaner"]);
  assert.deepEqual(searchWords("a b c d e f g h"), ["a", "b", "c", "d", "e", "f"]);
  assert.equal(searchWords("x".repeat(80))[0].length, 60);
  assert.equal(canSearch("c"), false);
  assert.equal(canSearch(" c "), false);
  assert.equal(canSearch("cl"), true);
  assert.equal(canSearch("a b"), true);
});

test("one word finds every master SKU that has it, in the name or the code", () => {
  assert.deepEqual(searchMasters(LIST, "cleaner").map((m) => m.code).sort(), ["150-GLASS", "150-KITCHEN", "CLEAN-KIT"]);
  assert.deepEqual(searchMasters(LIST, "rat").map((m) => m.code), ["160-RAT"]);
  assert.deepEqual(searchMasters(LIST, "160-").map((m) => m.code), ["160-RAT"]);
});

test("every word must appear, in any order; a % is plain text", () => {
  assert.deepEqual(searchMasters(LIST, "clean kitchen").map((m) => m.code), ["150-KITCHEN"]);
  assert.deepEqual(searchMasters(LIST, "clean kit").map((m) => m.code), ["CLEAN-KIT", "150-KITCHEN"]);
  assert.deepEqual(searchMasters(LIST, "spray kitchen").map((m) => m.code), ["150-KITCHEN"]);
  assert.deepEqual(searchMasters(LIST, "100%").map((m) => m.code), ["170-100%"]);
  assert.deepEqual(searchMasters(LIST, "%"), []);
  assert.deepEqual(searchMasters(LIST, "x"), []);
});

test("names starting with the first word come first, then codes, then shorter names; at most 25", () => {
  assert.deepEqual(searchMasters(LIST, "clean").map((m) => m.code), ["CLEAN-KIT", "150-GLASS", "150-KITCHEN"]);
  assert.deepEqual(searchMasters(LIST, "glass clean").map((m) => m.code), ["150-GLASS"]);
  const many = Array.from({ length: 40 }, (_, i) => ({ code: `C-${i}`, name: `Cleaner ${i}` }));
  assert.equal(searchMasters(many, "cleaner").length, 25);
});
