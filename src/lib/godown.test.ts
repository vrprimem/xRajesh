import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LANGS,
  SHELF_WORD,
  WORDS,
  bottleSizes,
  bottlesFrom,
  boxWord,
  byShelf,
  canMake,
  fromBoxes,
  inBoxes,
  levelOf,
  mixLitres,
  say,
  shelfOf,
  sizeLabel,
  staffName,
  uses,
  usesPacked,
  type GodownItem,
  type GodownProduct,
} from "./godown.ts";
import { colourFor, familyColours, partWord, pictureFor, productWord, shortWord } from "./godown-pictures.ts";

const item = (id: string, onHand: number, over: Partial<GodownItem> = {}): GodownItem => ({ id, name: id, kind: "other", unit: "pcs", perBox: null, onHand, lowLevel: null, ...over });

// Old Rat: 80 bottles a carton; each bottle takes a bottle, a trigger, a sticker and 0.3 L of a chemical bought by the
// litre; each carton a box.
const OLD_RAT: GodownProduct = {
  id: "rat",
  name: "Old Rat",
  perCarton: 80,
  ready: 3600,
  recipe: [
    { itemId: "bottle", qty: 1, per: "unit" },
    { itemId: "trigger", qty: 1, per: "unit" },
    { itemId: "sticker", qty: 1, per: "unit" },
    { itemId: "chemical", qty: 0.3, per: "unit" },
    { itemId: "box", qty: 1, per: "carton" },
  ],
};

test("what cartons take: per bottle times the bottles in a carton, per carton once", () => {
  assert.deepEqual(uses(OLD_RAT, 12), [
    { itemId: "bottle", qty: 960 },
    { itemId: "trigger", qty: 960 },
    { itemId: "sticker", qty: 960 },
    { itemId: "chemical", qty: 288 },
    { itemId: "box", qty: 12 },
  ]);
});

test("boxes packed: per piece for the pieces, per box for the boxes, whatever each held", () => {
  assert.deepEqual(usesPacked(OLD_RAT, 1200, 30), [
    { itemId: "bottle", qty: 1200 },
    { itemId: "trigger", qty: 1200 },
    { itemId: "sticker", qty: 1200 },
    { itemId: "chemical", qty: 360 },
    { itemId: "box", qty: 30 },
  ], "30 boxes of 40: 30 cartons, not 1,200 over the 80 a carton");
  assert.deepEqual(usesPacked(OLD_RAT, 80, 1), uses(OLD_RAT, 1), "a usual box: the same as by the carton");
});

test("a chemical mixed with water comes off in kg by the litres the bottles hold, and says the litres", () => {
  // Repellent 250ml: 0.25 L of liquid a bottle; 1.5 kg makes 160 L, so a bottle takes 0.00234375 kg.
  const rep = { recipe: [{ itemId: "bottle", qty: 1, per: "unit" as const }, { itemId: "ch", qty: (0.25 * 1.5) / 160, per: "unit" as const, litres: 0.25 }] };
  assert.deepEqual(usesPacked(rep, 1200, 30), [
    { itemId: "bottle", qty: 1200 },
    { itemId: "ch", qty: 2.813, litres: 300 },
  ], "30 boxes of 40 bottles: 300 L of liquid, 2.8125 kg of chemical");
});

test("how many more cartons the materials allow, and what runs out first", () => {
  const stock = new Map([
    ["bottle", item("bottle", 7000)],
    ["trigger", item("trigger", 2400)],
    ["sticker", item("sticker", 5000)],
    ["chemical", item("chemical", 600)],
    ["box", item("box", 150)],
  ]);
  assert.deepEqual(canMake(OLD_RAT, stock), { cartons: 25, limit: "chemical" }, "600 L at 24 L a carton");
  stock.set("trigger", item("trigger", 1000));
  assert.deepEqual(canMake(OLD_RAT, stock), { cartons: 12, limit: "trigger" });
  stock.delete("box");
  assert.deepEqual(canMake(OLD_RAT, stock), { cartons: 0, limit: "box" }, "a material not in the godown at all");
  assert.deepEqual(canMake({ perCarton: 80, recipe: [] }, stock), { cartons: 0, limit: null }, "no recipe, nothing to say");
  assert.equal(canMake({ perCarton: 10, recipe: [{ itemId: "l", qty: 0.1, per: "unit" }] }, new Map([["l", item("l", 3)]])).cartons, 3, "no rounding trouble at 0.1 L");
});

test("counted in boxes: full boxes and loose pieces, and back", () => {
  assert.deepEqual(inBoxes(2400, 1000), { boxes: 2, loose: 400 });
  assert.deepEqual(inBoxes(600, 200), { boxes: 3, loose: 0 });
  assert.deepEqual(inBoxes(640, null), { boxes: 0, loose: 640 }, "not boxed: all loose");
  assert.deepEqual(inBoxes(-5, 100), { boxes: 0, loose: -5 });
  assert.deepEqual(inBoxes(4.5, 1.5), { boxes: 3, loose: 0 }, "3 boxes of 1.5 kg");
  assert.deepEqual(inBoxes(4570, 80), { boxes: 57, loose: 10 }, "a product: 57 boxes of 80 and 10 loose");
  assert.equal(fromBoxes(2, 400, 1000), 2400);
  assert.equal(fromBoxes(0, 37.5, null), 37.5);
  assert.equal(fromBoxes(3, 0.5, 1.5), 5, "3 boxes of 1.5 kg and half a kg loose");
  assert.equal(fromBoxes(4, 7, null), 7, "boxes of a thing not boxed count nothing");
});

test("finished, running low, enough", () => {
  assert.equal(levelOf({ onHand: 0, lowLevel: 100 }), "out");
  assert.equal(levelOf({ onHand: 100, lowLevel: 100 }), "low");
  assert.equal(levelOf({ onHand: 101, lowLevel: 100 }), "ok");
  assert.equal(levelOf({ onHand: 5, lowLevel: null }), "ok");
});

test("every word in every language, with its gaps", () => {
  for (const lang of LANGS) {
    assert.deepEqual(Object.keys(WORDS[lang]).sort(), Object.keys(WORDS.en).sort(), lang);
    for (const [key, text] of Object.entries(WORDS[lang])) {
      const gaps = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      assert.deepEqual(gaps(text), gaps(WORDS.en[key as keyof typeof WORDS.en]), `${lang}.${key}`);
    }
  }
  assert.equal(say("en", "andLoose", { unit: "pcs" }), "And loose pcs?");
  assert.equal(say("hi", "runsOutFirst", { item: "ट्रिगर" }), "पहले ट्रिगर खत्म होगा");
  assert.deepEqual([boxWord(1, "en"), boxWord(2, "en"), boxWord(2, "hi"), boxWord(1, "mr")], ["box", "boxes", "बॉक्स", "बॉक्स"]);
});

test("the staff's name for a material: in their language, else the English simple name, else the full name", () => {
  const bottle = item("b", 0, { name: "19MM 100ML BOSTON WHITE BOTTLE", simple: { en: "100ml Bottle", hi: "100ml बोतल" } });
  assert.equal(staffName(bottle, "hi"), "100ml बोतल");
  assert.equal(staffName(bottle, "mr"), "100ml Bottle", "no Marathi name yet: the English one");
  assert.equal(staffName(bottle, "en"), "100ml Bottle");
  assert.equal(staffName({ ...bottle, simple: undefined }, "hi"), "19MM 100ML BOSTON WHITE BOTTLE", "no simple names: the full name");
  assert.equal(staffName({ ...bottle, simple: { hi: "" } }, "hi"), "19MM 100ML BOSTON WHITE BOTTLE", "an empty name counts as none");
});

test("shelves: bottles, then triggers, caps, stickers, chemicals, cartons, packing and the rest, each in its order", () => {
  const list = [
    item("tape", 0, { kind: "packing" }),
    item("cap", 0, { kind: "cap" }),
    item("b1", 0, { kind: "bottle" }),
    item("box", 0, { kind: "carton_2ply" }),
    item("b2", 0, { kind: "bottle" }),
    item("odd", 0, { kind: "something new" }),
    item("pump", 0, { kind: "trigger" }),
  ];
  assert.deepEqual(
    byShelf(list).map((s) => [s.shelf, s.items.map((i) => i.id)]),
    [["bottle", ["b1", "b2"]], ["trigger", ["pump"]], ["cap", ["cap"]], ["carton", ["box"]], ["packing", ["tape"]], ["other", ["odd"]]],
  );
  assert.equal(shelfOf("carton_hard"), "carton");
  assert.equal(shelfOf("chemical"), "chemical");
  for (const words of Object.values(SHELF_WORD)) for (const lang of LANGS) assert.ok(words[lang].length > 0, lang);
});

test("chemicals: what a packet makes with water, and the bottles it fills in each size", () => {
  const repellent = { qty: 1.5, litres: 160 };
  assert.equal(mixLitres(repellent, 1.5), 160);
  assert.equal(mixLitres(repellent, 4.5), 480);
  assert.equal(mixLitres({ qty: 1, litres: 12 }, 2.5), 30);
  assert.equal(mixLitres({ qty: 0, litres: 12 }, 3), 0, "no ratio, nothing");
  // A product takes its chemical by the litres of liquid a bottle holds (and the kg that is).
  const take = (chemical: string, litres: number) => ({ recipe: [{ itemId: "bottle", qty: 1, per: "unit" as const }, { itemId: chemical, qty: litres / 100, per: "unit" as const, litres }] });
  const products = [take("ch-rep", 0.25), take("ch-rep", 0.1), take("ch-kitchen", 0.4), take("ch-screen", 0.25), take("ch-screen", 0.5), take("ch-rep", 0.25)];
  assert.deepEqual(bottleSizes("ch-rep", products), [0.25, 0.1], "each size once, in the products' order");
  assert.deepEqual(bottlesFrom(160, bottleSizes("ch-rep", products)), [{ size: "250ml", bottles: 640 }, { size: "100ml", bottles: 1600 }], "Repellent: 1.5 kg makes 160 L");
  assert.deepEqual(bottlesFrom(12, bottleSizes("ch-kitchen", products)), [{ size: "400ml", bottles: 30 }], "Kitchen and Tap: 1 kg makes 12 L");
  assert.deepEqual(bottlesFrom(20, bottleSizes("ch-screen", products)), [{ size: "250ml", bottles: 80 }, { size: "500ml", bottles: 40 }], "Screen: 1 kg makes 20 L");
  assert.deepEqual(bottlesFrom(-3, [0.25]), [{ size: "250ml", bottles: 0 }]);
  assert.equal(sizeLabel(1), "1L");
  assert.equal(sizeLabel(1.5), "1.5L");
  assert.deepEqual(bottleSizes("ch-rep", [{ recipe: [{ itemId: "ch-rep", qty: 0.02, per: "carton", litres: 2 }] }]), [], "taken by the carton: no bottle size");
  assert.deepEqual(bottleSizes("ch-rep", [{ recipe: [{ itemId: "ch-rep", qty: 0.3, per: "unit" }] }]), [], "not mixed with water: no bottle size");
});

test("what can still be made takes a chemical by the litres of liquid the bottles hold", () => {
  const stock = new Map([
    ["ch", item("ch", 4.5, { unit: "kg", mix: { qty: 1.5, litres: 160 } })],
    ["bottle", item("bottle", 5000)],
  ]);
  const rep = { perCarton: 48, recipe: [{ itemId: "bottle", qty: 1, per: "unit" as const }, { itemId: "ch", qty: (0.25 * 1.5) / 160, per: "unit" as const, litres: 0.25 }] };
  assert.deepEqual(canMake(rep, stock), { cartons: 40, limit: "ch" }, "4.5 kg makes 480 L: 40 boxes of 48 bottles of 250ml");
});

test("a part's picture shows its size, or what is left of its name", () => {
  assert.equal(partWord("100ml Bottle"), "100ML");
  assert.equal(partWord("Trigger for 100ml Bottle"), "100ML");
  assert.equal(partWord("250 ml Inner Cap"), "250ML");
  assert.equal(partWord("1 Litre Bottle"), "1L");
  assert.equal(partWord("Shoe Trigger"), "SHOE");
  assert.equal(partWord("Screen Mist Pump"), "SCREEN");
  assert.equal(partWord("Trigger white"), "", "nothing left: no word");
  const svg = (s: string) => decodeURIComponent(s.replace(/^data:image\/svg\+xml;utf8,/, ""));
  assert.match(svg(pictureFor("bottle", "100ml Bottle")), />100ML</);
  assert.match(svg(pictureFor("cap", "100ml Inner")), /<ellipse/, "an inner is drawn as an inner");
  assert.doesNotMatch(svg(pictureFor("cap", "100ml Cap")), /<ellipse/, "a cap as a cap");
  assert.doesNotMatch(svg(pictureFor("trigger", "Trigger white")), /<text/, "no word, no tag");
});

test("drawn pictures: each kind its own, stickers and chemicals with their product's word and colour", () => {
  const rat = `fill="${colourFor("RAT")}"`;
  assert.ok(decodeURIComponent(pictureFor("label", "Rat Sticker")).includes(rat) && decodeURIComponent(pictureFor("chemical", "Rat Chemical")).includes(rat), "a product's sticker and chemical share a colour");
  assert.equal(shortWord("Sticker Old Rat", /\b(stickers?|labels?|front|back)\b/gi), "OLD RAT");
  assert.equal(shortWord("Rat liquid", /\b(liquids?|chemicals?|drums?)\b/gi), "RAT");
  assert.equal(shortWord("Sticker", /\b(stickers?)\b/gi), "STICKER", "nothing left: the name itself");
  assert.equal(shortWord("Front label HouseFly Repellent", /\b(stickers?|labels?|front|back)\b/gi), "HOUSEFLY");
  assert.equal(colourFor("Sticker Old Rat"), colourFor("sticker old rat"), "the same name, the same colour");
  const svg = (s: string) => decodeURIComponent(s.replace(/^data:image\/svg\+xml;utf8,/, ""));
  assert.match(svg(pictureFor("label", "Sticker Old Rat")), /OLD RAT/);
  assert.match(svg(pictureFor("label", "Sticker <b>")), /&lt;B&gt;|>B</, "text is escaped");
  for (const kind of ["bottle", "trigger", "cap", "label", "chemical", "carton_hard", "carton_2ply", "packing", "other", "anything"]) {
    assert.match(pictureFor(kind, "Thing"), /^data:image\/svg\+xml;utf8,/, kind);
  }
  // A product's sticker and chemical share its word and colour; a sticker shows its size too.
  assert.equal(productWord("Repellent Sticker 250ml", /\b(stickers?)\b/gi), "REPELLENT");
  assert.equal(productWord("Repellent Chemical", /\b(chemicals?)\b/gi), "REPELLENT");
  assert.equal(productWord("Screen Cleaner Sticker 500ml", /\b(stickers?)\b/gi), "SCREEN", "too long: the first word");
  const repellent = `fill="${colourFor("REPELLENT")}"`;
  for (const [kind, name] of [["label", "Repellent Sticker 250ml"], ["chemical", "Repellent Chemical"]]) {
    assert.ok(svg(pictureFor(kind, name)).includes(repellent), `${kind} in the repellent colour`);
  }
  assert.match(svg(pictureFor("label", "Repellent Sticker 250ml")), />250ML</, "a sticker shows its size");
  // One colour per product, no two alike: Kitchen and Screen would share one by their words alone.
  assert.equal(colourFor("KITCHEN"), colourFor("SCREEN"));
  const things = [
    { kind: "label", name: "Kitchen Sticker" },
    { kind: "chemical", name: "Kitchen Chemical" },
    { kind: "chemical", name: "Screen Chemical" },
    { kind: "label", name: "Screen Sticker 250ml" },
    { kind: "chemical", name: "Repellent Chemical" },
    { kind: "label", name: "Tap Sticker" },
    { kind: "bottle", name: "100ml Bottle" },
  ];
  const colours = familyColours(things);
  assert.deepEqual([...colours.keys()], ["KITCHEN", "REPELLENT", "SCREEN", "TAP"], "the products, not the bottle");
  assert.equal(new Set(colours.values()).size, 4, "four products, four colours");
  assert.equal(colours.get("KITCHEN"), colourFor("KITCHEN"), "the first keeps its own colour");
  assert.ok(svg(pictureFor("label", "Screen Sticker 250ml", colours)).includes(`fill="${colours.get("SCREEN")}"`), "a picture takes its product's colour");
  assert.deepEqual(familyColours([...things].reverse()), colours, "the order things come in changes nothing");
});
