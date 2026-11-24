import { staffName, type GodownEvent, type GodownItem, type GodownProduct } from "@/lib/godown";
import { familyColours, pictureFor } from "@/lib/godown-pictures";
import { MATERIALS, type SampleMaterial } from "./materials-sample";

// The godown for the development preview: the supplier's own 15 materials (bottles, triggers and pumps, caps and
// inners); the four chemicals with what VRPRIME says each makes with water (Repellent 1.5 kg makes 160 L; Kitchen and
// Tap 1 kg make 12 L; Screen 1 kg makes 20 L); a sticker for each product and size; and the six products made from
// them. Which bottle and trigger each product takes, the boxes and every stock number are made up.

type Stock = { box: number; onHand: number; low: number };

// How much a box of each of the supplier's materials holds, what is there, and when it is low (all made up).
const STOCK: Record<string, Stock> = {
  b100: { box: 500, onHand: 6000, low: 2000 },
  t100: { box: 1000, onHand: 2400, low: 3000 },
  c100: { box: 2000, onHand: 8000, low: 2000 },
  i100: { box: 5000, onHand: 10000, low: 2000 },
  b250: { box: 300, onHand: 3000, low: 1000 },
  mist: { box: 1000, onHand: 1500, low: 1000 },
  t250: { box: 500, onHand: 1500, low: 500 },
  c250: { box: 2000, onHand: 4000, low: 1000 },
  i250: { box: 5000, onHand: 5000, low: 2000 },
  b500: { box: 200, onHand: 2400, low: 800 },
  c500: { box: 1000, onHand: 3000, low: 1000 },
  i500: { box: 5000, onHand: 2500, low: 1000 },
  t500: { box: 500, onHand: 1200, low: 1000 },
  bshoe: { box: 300, onHand: 900, low: 300 },
  tshoe: { box: 500, onHand: 400, low: 500 },
};

const own = (m: SampleMaterial): GodownItem => {
  const s = STOCK[m.key];
  return {
    id: m.key,
    name: m.name,
    simple: { en: m.en, hi: m.hi, mr: m.mr },
    kind: m.kind,
    unit: "pcs",
    perBox: s.box,
    onHand: s.onHand,
    lowLevel: s.low,
    hasPhoto: false,
  };
};

type Names = [en: string, hi: string, mr: string];

const other = (id: string, name: string, kind: string, unit: GodownItem["unit"], simple: Names, perBox: number | null, onHand: number, low: number | null, mix?: GodownItem["mix"]): GodownItem => ({
  id,
  name,
  simple: { en: simple[0], hi: simple[1], mr: simple[2] },
  kind,
  unit,
  perBox,
  onHand,
  lowLevel: low,
  hasPhoto: false,
  ...(mix ? { mix } : {}),
});

// Stickers are weighed and counted, not boxed: the godown types their kg and total pieces.
const sticker = (id: string, name: string, simple: Names, onHand: number) => other(id, name, "label", "pcs", simple, null, onHand, 1000);

const ITEMS: GodownItem[] = [
  ...MATERIALS.map(own),
  sticker("st-rep250", "STICKER REPELLENT 250ML", ["Repellent Sticker 250ml", "रिपेलेंट स्टिकर 250ml", "रिपेलेंट स्टिकर 250ml"], 3000),
  sticker("st-rep100", "STICKER REPELLENT 100ML", ["Repellent Sticker 100ml", "रिपेलेंट स्टिकर 100ml", "रिपेलेंट स्टिकर 100ml"], 5000),
  sticker("st-kitchen", "STICKER KITCHEN CLEANER 400ML", ["Kitchen Sticker", "किचन स्टिकर", "किचन स्टिकर"], 2000),
  sticker("st-tap", "STICKER TAP CLEANER 400ML", ["Tap Sticker", "टैप स्टिकर", "टॅप स्टिकर"], 800),
  sticker("st-screen250", "STICKER SCREEN CLEANER 250ML", ["Screen Sticker 250ml", "स्क्रीन स्टिकर 250ml", "स्क्रीन स्टिकर 250ml"], 2000),
  sticker("st-screen500", "STICKER SCREEN CLEANER 500ML", ["Screen Sticker 500ml", "स्क्रीन स्टिकर 500ml", "स्क्रीन स्टिकर 500ml"], 1000),
  // Chemicals, bought by the kg (a box of 1.5 kg, of 1 kg); each mixed with water as the bottles are filled.
  other("ch-rep", "REPELLENT CHEMICAL", "chemical", "kg", ["Repellent Chemical", "रिपेलेंट केमिकल", "रिपेलेंट केमिकल"], 1.5, 4.5, 1.5, { qty: 1.5, litres: 160 }),
  other("ch-kitchen", "KITCHEN CHEMICAL", "chemical", "kg", ["Kitchen Chemical", "किचन केमिकल", "किचन केमिकल"], 1, 5, 2, { qty: 1, litres: 12 }),
  other("ch-tap", "TAP CHEMICAL", "chemical", "kg", ["Tap Chemical", "टैप केमिकल", "टॅप केमिकल"], 1, 2, 2, { qty: 1, litres: 12 }),
  other("ch-screen", "SCREEN CHEMICAL", "chemical", "kg", ["Screen Chemical", "स्क्रीन केमिकल", "स्क्रीन केमिकल"], 1, 3, 1, { qty: 1, litres: 20 }),
  other("box", "HARD CARTON 5 PLY", "carton_hard", "pcs", ["Carton Box", "कार्टन बॉक्स", "कार्टन बॉक्स"], null, 150, 50),
];

// The drawn pictures the real godown shows until photos are added: one colour per product, as the server gives them.
const colours = familyColours(ITEMS.map((i) => ({ kind: i.kind, name: staffName(i, "en") })));
export const GODOWN_ITEMS: GodownItem[] = ITEMS.map((i) => ({ ...i, photo: pictureFor(i.kind, staffName(i, "en"), colours) }));

// Each bottle: its bottle, its trigger or pump, its sticker, and its chemical by the litres of liquid it holds (with
// the kg of chemical that takes, as the server gives it); each carton: one box.
const chemical = (id: string, litres: number) => {
  const mix = ITEMS.find((i) => i.id === id)?.mix;
  return { itemId: id, qty: mix ? (litres * mix.qty) / mix.litres : litres, per: "unit" as const, litres };
};
const recipe = (bottle: string, pump: string, sticker: string, chemicalId: string, litres: number) => [
  { itemId: bottle, qty: 1, per: "unit" as const },
  { itemId: pump, qty: 1, per: "unit" as const },
  { itemId: sticker, qty: 1, per: "unit" as const },
  chemical(chemicalId, litres),
  { itemId: "box", qty: 1, per: "carton" as const },
];

const product = (fill: string, label: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="16" fill="#ffffff"/><rect x="41" y="6" width="18" height="14" rx="3" fill="#111"/><path d="M35 20h30v10l7 9v52a5 5 0 0 1-5 5H33a5 5 0 0 1-5-5V39l7-9z" fill="${fill}"/><rect x="31" y="52" width="38" height="22" rx="2" fill="#fff"/><text x="50" y="67" font-size="${label.length > 5 ? 7 : label.length > 4 ? 8 : 11}" font-family="Arial" font-weight="700" text-anchor="middle" fill="#111">${label}</text></svg>`)}`;

export const GODOWN_PRODUCTS: GodownProduct[] = [
  { id: "rep250", name: "Repellent 250ml", perCarton: 48, ready: 1440, recipe: recipe("b250", "t250", "st-rep250", "ch-rep", 0.25), photo: product("#16a34a", "250ml") },
  { id: "rep100", name: "Repellent 100ml", perCarton: 96, ready: 960, recipe: recipe("b100", "t100", "st-rep100", "ch-rep", 0.1), photo: product("#16a34a", "100ml") },
  { id: "kitchen", name: "Kitchen Cleaner 400ml", perCarton: 24, ready: 240, recipe: recipe("b500", "t500", "st-kitchen", "ch-kitchen", 0.4), photo: product("#dc2626", "KITCHEN") },
  { id: "tap", name: "Tap Cleaner 400ml", perCarton: 24, ready: 0, recipe: recipe("b500", "t500", "st-tap", "ch-tap", 0.4), photo: product("#2563eb", "TAP") },
  { id: "screen250", name: "Screen Cleaner 250ml", perCarton: 48, ready: 480, recipe: recipe("b250", "mist", "st-screen250", "ch-screen", 0.25), photo: product("#9333ea", "250ml") },
  { id: "screen500", name: "Screen Cleaner 500ml", perCarton: 24, ready: 120, recipe: recipe("b500", "t500", "st-screen500", "ch-screen", 0.5), photo: product("#9333ea", "500ml") },
];

export const GODOWN_EVENTS: GodownEvent[] = [
  { id: "e4", at: "2026-11-24T07:20:00Z", who: "Mahesh", kind: "made", productId: "rep250", units: 480 },
  { id: "e2", at: "2026-11-24T05:10:00Z", who: "Mahesh", kind: "count", itemId: "b100", diff: -500 },
  { id: "e1", at: "2026-11-24T04:35:00Z", who: "Mahesh", kind: "in", itemId: "ch-rep", qty: 3 },
  { id: "e0", at: "2026-11-24T04:20:00Z", who: "Mahesh", kind: "in", itemId: "st-rep250", qty: 3000, kg: 7.5 },
];
