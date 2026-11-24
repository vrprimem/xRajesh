// The godown screen: everything the supplier has (materials and finished goods), counted in boxes and pieces the way the
// staff count it, and what can still be made from the materials. Words in English, Hindi and Marathi. The staff see
// each material by its simple name in their language ("100ml बोतल"); the owner sees the full name the supplier buys it
// by ("19MM 100ML BOSTON WHITE BOTTLE"). Products keep their names. Plain TypeScript, so `node --test` can run it.

export const LANGS = ["hi", "mr", "en"] as const;
export type Lang = (typeof LANGS)[number];
export const LANG_NAME: Record<Lang, string> = { hi: "हिंदी", mr: "मराठी", en: "English" };

export type GodownUnit = "pcs" | "litre" | "kg" | "metre";

/** A material: how it is counted (a box of 1,000 triggers), what is there, and when it is low. */
export type GodownItem = {
  id: string;
  /** The full name the supplier buys it by. */
  name: string;
  /** What the godown staff call it, by language; missing ones fall back to English, then to the name. */
  simple?: Partial<Record<Lang, string>>;
  /** As the supplies call it: bottle, trigger, label, chemical and so on. */
  kind: string;
  unit: GodownUnit;
  /** How much one box holds, in the unit. Null: counted one by one. */
  perBox: number | null;
  /** In the unit (pieces, litres, kg, metres). */
  onHand: number;
  /** At or below this, it is running low. */
  lowLevel: number | null;
  /** Its photo, or a drawn picture until one is added (`hasPhoto` false). */
  photo?: string;
  hasPhoto?: boolean;
  /** A chemical mixed with water as the bottles are filled: `qty` of it (in its unit) makes `litres` of liquid. "1.5 kg makes 160 L". */
  mix?: { qty: number; litres: number };
};

/** What the godown staff call a material in this language: its simple name, else the English one, else its name. */
export function staffName(item: Pick<GodownItem, "name" | "simple">, lang: Lang): string {
  return item.simple?.[lang] || item.simple?.en || item.name;
}

/** The godown's shelves, in the order the screen shows them; each material sits on the shelf of its kind. */
export const SHELVES = ["bottle", "trigger", "cap", "label", "chemical", "carton", "packing", "other"] as const;
export type Shelf = (typeof SHELVES)[number];
export const SHELF_WORD: Record<Shelf, Record<Lang, string>> = {
  bottle: { en: "Bottles", hi: "बोतल", mr: "बाटल्या" },
  trigger: { en: "Triggers and pumps", hi: "ट्रिगर और पंप", mr: "ट्रिगर आणि पंप" },
  cap: { en: "Caps and inners", hi: "ढक्कन और इनर", mr: "झाकणे आणि इनर" },
  label: { en: "Stickers", hi: "स्टिकर", mr: "स्टिकर" },
  chemical: { en: "Chemicals", hi: "केमिकल", mr: "केमिकल" },
  carton: { en: "Cartons", hi: "कार्टन", mr: "कार्टन" },
  packing: { en: "Packing", hi: "पैकिंग", mr: "पॅकिंग" },
  other: { en: "Other", hi: "बाकी सामान", mr: "इतर साहित्य" },
};

/** The shelf a material of this kind sits on. */
export function shelfOf(kind: string): Shelf {
  if (kind === "carton_hard" || kind === "carton_2ply") return "carton";
  return (SHELVES as readonly string[]).includes(kind) ? (kind as Shelf) : "other";
}

/** Materials shelf by shelf (bottles first), each shelf keeping the order given; empty shelves left out. */
export function byShelf<T extends Pick<GodownItem, "kind">>(items: readonly T[]): { shelf: Shelf; items: T[] }[] {
  return SHELVES.map((shelf) => ({ shelf, items: items.filter((i) => shelfOf(i.kind) === shelf) })).filter((s) => s.items.length > 0);
}

/**
 * What one piece (a bottle) or one full box of a product takes, in the material's unit. For a chemical mixed with
 * water, `litres` is the liquid it takes (0.25 for a 250ml bottle) and `qty` the chemical that liquid needs.
 */
export type RecipeUse = { itemId: string; qty: number; per: "unit" | "carton"; litres?: number };
/** A finished product: `ready` is the pieces at the supplier's, packed `perCarton` to a box; its photo, if any. */
export type GodownProduct = { id: string; name: string; perCarton: number; ready: number; recipe: RecipeUse[]; photo?: string; hasPhoto?: boolean };

/**
 * One thing entered at the godown: who did what, when. A count carries what it changed; `photo` is the bill's; `kg`
 * what goods in or a count weighed (stickers).
 */
export type GodownEvent = { id: string; at: string; who: string } & (
  | { kind: "in"; itemId: string; qty: number; photo?: string | null; kg?: number | null }
  | { kind: "made"; productId: string; units: number }
  | { kind: "count"; itemId: string; diff: number; kg?: number | null }
);

/**
 * What else goes with goods in or a count: how much one box holds, when the warehouse person says it (left out when
 * unchanged), and what it weighed (stickers).
 */
export type GodownEntry = { perBox?: number | null; kg?: number | null };

/** Stickers are typed in as their weight and their total pieces, not in boxes. */
export const isWeighed = (item: Pick<GodownItem, "kind">) => item.kind === "label";

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** A quantity as full boxes and the loose rest: 2,400 triggers in boxes of 1,000 is 2 boxes and 400 loose. */
export function inBoxes(qty: number, perBox: number | null | undefined): { boxes: number; loose: number } {
  if (!perBox || perBox <= 0) return { boxes: 0, loose: round3(qty) };
  const boxes = Math.max(0, Math.floor(qty / perBox + 1e-9));
  return { boxes, loose: round3(qty - boxes * perBox) };
}

/** Boxes and loose pieces back to the unit: 2 boxes and 400 loose, at 1,000 a box, is 2,400. */
export function fromBoxes(boxes: number, loose: number, perBox: number | null | undefined): number {
  return round3((perBox && perBox > 0 ? boxes * perBox : 0) + loose);
}

/** Litres of liquid some of a chemical makes with water: 4.5 kg, at 1.5 kg to 160 L, is 480 L. */
export function mixLitres(mix: NonNullable<GodownItem["mix"]>, qty: number): number {
  return mix.qty > 0 ? round3((qty * mix.litres) / mix.qty) : 0;
}

/** A bottle size in litres as its label says it: 0.25 is "250ml", 1.5 is "1.5L". */
export function sizeLabel(litres: number): string {
  return litres < 1 ? `${round3(litres * 1000)}ml` : `${round3(litres)}L`;
}

/** The bottle sizes a chemical's liquid fills (litres a bottle), from the products that take it by the bottle, in their order. */
export function bottleSizes(chemicalId: string, products: readonly Pick<GodownProduct, "recipe">[]): number[] {
  const sizes: number[] = [];
  for (const p of products) for (const r of p.recipe) if (r.itemId === chemicalId && r.per === "unit" && r.litres && r.litres > 0 && !sizes.includes(r.litres)) sizes.push(r.litres);
  return sizes;
}

/**
 * A chemical's formula: one packet (`mix.qty`, in its unit) makes `litres` of liquid, which fills so many bottles of each
 * size its products take; and how much chemical goes in one bottle, in its unit (Repellent: 1.5 kg makes 160 L, 640
 * of 250ml at 0.00234 kg each). Null for a material not mixed with water.
 */
export function formulaOf(item: Pick<GodownItem, "id" | "mix">, products: readonly Pick<GodownProduct, "recipe">[]): { qty: number; litres: number; sizes: { size: string; bottles: number; perBottle: number }[] } | null {
  if (!item.mix || !(item.mix.qty > 0) || !(item.mix.litres > 0)) return null;
  const { qty, litres } = item.mix;
  return {
    qty,
    litres,
    sizes: bottleSizes(item.id, products).map((s) => ({ size: sizeLabel(s), bottles: Math.floor(litres / s + 1e-9), perBottle: (qty * s) / litres })),
  };
}

/** How many bottles of each size some litres fill: 160 L fills 640 of 250ml, or 1,600 of 100ml. */
export function bottlesFrom(litres: number, sizes: readonly number[]): { size: string; bottles: number }[] {
  return sizes.map((s) => ({ size: sizeLabel(s), bottles: Math.max(0, Math.floor(litres / s + 1e-9)) }));
}

export type Level = "out" | "low" | "ok";

/** Finished, running low, or enough. */
export function levelOf(item: Pick<GodownItem, "onHand" | "lowLevel">): Level {
  if (item.onHand <= 0) return "out";
  if (item.lowLevel !== null && item.onHand <= item.lowLevel) return "low";
  return "ok";
}

/** What one full box of a product takes of a recipe line. */
export function perCartonOf(r: RecipeUse, perCarton: number): number {
  return r.per === "unit" ? r.qty * perCarton : r.qty;
}

/** What making some boxes of a product (a part box for loose pieces) takes from each material. */
export function uses(product: Pick<GodownProduct, "perCarton" | "recipe">, cartons: number): { itemId: string; qty: number }[] {
  return product.recipe.map((r) => ({ itemId: r.itemId, qty: round3(perCartonOf(r, product.perCarton) * cartons) }));
}

/**
 * What pieces packed in boxes take from each material: per piece for each piece, per box for each box packed (30
 * boxes of 40 take 30 cartons), as the database takes them. A chemical also says the litres of liquid that was.
 */
export function usesPacked(product: Pick<GodownProduct, "recipe">, pieces: number, boxes: number): { itemId: string; qty: number; litres?: number }[] {
  return product.recipe.map((r) => {
    const times = r.per === "unit" ? pieces : boxes;
    return { itemId: r.itemId, qty: round3(r.qty * times), ...(r.litres ? { litres: round3(r.litres * times) } : {}) };
  });
}

/** How many more full boxes the materials allow, and the material that runs out first (null with no recipe). */
export function canMake(product: Pick<GodownProduct, "perCarton" | "recipe">, items: ReadonlyMap<string, Pick<GodownItem, "onHand">>): { cartons: number; limit: string | null } {
  let cartons = Infinity;
  let limit: string | null = null;
  for (const r of product.recipe) {
    const need = perCartonOf(r, product.perCarton);
    if (!(need > 0)) continue;
    const n = Math.floor(Math.max(0, items.get(r.itemId)?.onHand ?? 0) / need + 1e-9);
    if (n < cartons) {
      cartons = n;
      limit = r.itemId;
    }
  }
  return cartons === Infinity ? { cartons: 0, limit: null } : { cartons, limit };
}

// ---- Words ---------------------------------------------------------------------------------------------------------------

const EN = {
  title: "Godown",
  goodsIn: "Goods in",
  goodsInHint: "Material that came",
  madeToday: "Made today",
  madeHint: "Boxes packed",
  count: "Count",
  countHint: "Check the shelf",
  materials: "Materials",
  ready: "Ready boxes",
  enough: "Enough",
  low: "Running low",
  out: "Finished",
  inAll: "in all",
  whatCame: "What came in?",
  howManyOf: "How many {unit}?",
  andLoose: "And loose {unit}?",
  whatMade: "What did you make?",
  thisUses: "This uses",
  notEnough: "Not enough in the godown",
  whatCount: "What are you counting?",
  countBoxes: "Count the boxes on the shelf",
  save: "Save",
  back: "Back",
  done: "OK",
  saved: "Saved",
  canMake: "Can still make",
  runsOutFirst: "{item} runs out first",
  box: "box",
  boxes: "boxes",
  photoBill: "Photo of the bill, if any",
  appHad: "The app had {n}",
  countedMore: "{n} more than the app had",
  countedLess: "{n} less than the app had",
  countedSame: "Same as the app had",
  today: "Today",
  nothing: "Nothing entered today yet.",
  readOnly: "What is in the supplier's godown right now. The staff update it from their phone.",
  materialsFor: "Materials for {n} more",
  noRecipe: "No recipe yet",
  shared: "Each product on its own: bottles and triggers are shared between products.",
  lowList: "Running low or finished",
  pcs: "pcs",
  litre: "L",
  kg: "kg",
  metre: "m",
  bill: "bill",
  addPhoto: "Add photo",
  changePhoto: "Change photo",
  photoTip: "Add a photo of each material and product: the staff find things by their photo.",
  addMaterial: "New material",
  addProduct: "New product",
  formula: "Chemical formula",
  formulaSub: "1 packet of chemical + water: the liquid it makes and the bottles it fills",
  packetMakes: "1 packet {qty} = {litres}",
  bottlesEach: "{bottles} bottles · {per} in each",
  makes: "= {litres} of liquid",
  ofLiquid: "{litres} of liquid",
  fills: "Bottles it fills",
  boxHolds: "How many {unit} in 1 box?",
  boxesCame: "How many boxes came?",
  boxesPacked: "How many boxes did you pack?",
  boxFirst: "Write how many are in 1 box first",
  stickerPrompt: "Write the kg and the total pieces",
  totalPieces: "Total pieces",
};
type Words = typeof EN;

export const WORDS: Record<Lang, Words> = {
  en: EN,
  hi: {
    title: "गोदाम",
    goodsIn: "माल आया",
    goodsInHint: "जो माल आया",
    madeToday: "आज बनाया",
    madeHint: "पैक हुए बॉक्स",
    count: "गिनती",
    countHint: "रखा माल गिनें",
    materials: "कच्चा माल",
    ready: "तैयार बॉक्स",
    enough: "काफी है",
    low: "कम है",
    out: "खत्म",
    inAll: "कुल",
    whatCame: "कौन सा माल आया?",
    howManyOf: "कितने {unit}?",
    andLoose: "और खुले {unit}?",
    whatMade: "क्या बनाया?",
    thisUses: "इसमें लगेगा",
    notEnough: "गोदाम में पूरा नहीं है",
    whatCount: "क्या गिन रहे हैं?",
    countBoxes: "रखे हुए बॉक्स गिनें",
    save: "सेव करें",
    back: "वापस",
    done: "ठीक है",
    saved: "सेव हो गया",
    canMake: "और बन सकते हैं",
    runsOutFirst: "पहले {item} खत्म होगा",
    box: "बॉक्स",
    boxes: "बॉक्स",
    photoBill: "बिल का फोटो (अगर हो)",
    appHad: "ऐप में {n} था",
    countedMore: "ऐप से {n} ज़्यादा",
    countedLess: "ऐप से {n} कम",
    countedSame: "ऐप जितना ही",
    today: "आज",
    nothing: "आज अभी कुछ नहीं डाला।",
    readOnly: "सप्लायर के गोदाम में अभी क्या है। स्टाफ इसे फोन से भरता है।",
    materialsFor: "{n} और का माल है",
    noRecipe: "रेसिपी नहीं डाली",
    shared: "हर प्रोडक्ट अलग से: बोतल और ट्रिगर सब प्रोडक्ट में लगते हैं।",
    lowList: "कम है या खत्म",
    pcs: "पीस",
    litre: "लीटर",
    kg: "किलो",
    metre: "मीटर",
    bill: "बिल",
    addPhoto: "फोटो डालें",
    changePhoto: "फोटो बदलें",
    photoTip: "हर माल और प्रोडक्ट का फोटो डालें: स्टाफ फोटो देखकर पहचानता है।",
    addMaterial: "नया माल",
    addProduct: "नया प्रोडक्ट",
    formula: "केमिकल फॉर्मूला",
    formulaSub: "1 पैकेट केमिकल + पानी: कितना लिक्विड बनेगा और कितनी बोतल भरेंगी",
    packetMakes: "1 पैकेट {qty} = {litres}",
    bottlesEach: "{bottles} बोतल · हर बोतल में {per}",
    makes: "= {litres} लिक्विड",
    ofLiquid: "{litres} लिक्विड",
    fills: "इतनी बोतल भरेंगी",
    boxHolds: "1 बॉक्स में कितने {unit}?",
    boxesCame: "कितने बॉक्स आए?",
    boxesPacked: "कितने बॉक्स पैक किए?",
    boxFirst: "पहले लिखें: 1 बॉक्स में कितने",
    stickerPrompt: "किलो और कुल पीस लिखें",
    totalPieces: "कुल पीस",
  },
  mr: {
    title: "गोदाम",
    goodsIn: "माल आला",
    goodsInHint: "आलेला माल",
    madeToday: "आज बनवले",
    madeHint: "पॅक झालेले बॉक्स",
    count: "मोजणी",
    countHint: "ठेवलेला माल मोजा",
    materials: "कच्चा माल",
    ready: "तयार बॉक्स",
    enough: "पुरेसे आहे",
    low: "कमी आहे",
    out: "संपले",
    inAll: "एकूण",
    whatCame: "कोणता माल आला?",
    howManyOf: "किती {unit}?",
    andLoose: "आणि सुटे {unit}?",
    whatMade: "काय बनवले?",
    thisUses: "यासाठी लागेल",
    notEnough: "गोदामात पुरेसे नाही",
    whatCount: "काय मोजत आहात?",
    countBoxes: "ठेवलेले बॉक्स मोजा",
    save: "सेव्ह करा",
    back: "मागे",
    done: "ठीक आहे",
    saved: "सेव्ह झाले",
    canMake: "अजून बनवता येईल",
    runsOutFirst: "आधी {item} संपेल",
    box: "बॉक्स",
    boxes: "बॉक्स",
    photoBill: "बिलाचा फोटो (असल्यास)",
    appHad: "ॲपमध्ये {n} होते",
    countedMore: "ॲपपेक्षा {n} जास्त",
    countedLess: "ॲपपेक्षा {n} कमी",
    countedSame: "ॲपइतकेच",
    today: "आज",
    nothing: "आज अजून काही भरले नाही.",
    readOnly: "सप्लायरच्या गोदामात आत्ता काय आहे. स्टाफ ते फोनवरून भरतो.",
    materialsFor: "अजून {n} साठी माल आहे",
    noRecipe: "रेसिपी भरलेली नाही",
    shared: "प्रत्येक प्रॉडक्ट वेगळा: बाटल्या आणि ट्रिगर सगळ्या प्रॉडक्टमध्ये लागतात.",
    lowList: "कमी आहे किंवा संपले",
    pcs: "नग",
    litre: "लिटर",
    kg: "किलो",
    metre: "मीटर",
    bill: "बिल",
    addPhoto: "फोटो टाका",
    changePhoto: "फोटो बदला",
    photoTip: "प्रत्येक माल आणि प्रॉडक्टचा फोटो टाका: स्टाफ फोटो पाहून ओळखतो.",
    addMaterial: "नवीन माल",
    addProduct: "नवीन प्रॉडक्ट",
    formula: "केमिकल फॉर्म्युला",
    formulaSub: "1 पॅकेट केमिकल + पाणी: किती लिक्विड बनेल आणि किती बाटल्या भरतील",
    packetMakes: "1 पॅकेट {qty} = {litres}",
    bottlesEach: "{bottles} बाटल्या · प्रत्येक बाटलीत {per}",
    makes: "= {litres} लिक्विड",
    ofLiquid: "{litres} लिक्विड",
    fills: "इतक्या बाटल्या भरतील",
    boxHolds: "1 बॉक्समध्ये किती {unit}?",
    boxesCame: "किती बॉक्स आले?",
    boxesPacked: "किती बॉक्स पॅक केले?",
    boxFirst: "आधी लिहा: 1 बॉक्समध्ये किती",
    stickerPrompt: "किलो आणि एकूण नग लिहा",
    totalPieces: "एकूण नग",
  },
};

/** A word with its {gaps} filled. */
export function say(lang: Lang, key: keyof Words, fill: Record<string, string | number> = {}): string {
  return WORDS[lang][key].replace(/\{(\w+)\}/g, (all, k: string) => (k in fill ? String(fill[k]) : all));
}

/** "box" or "boxes" for this many. */
export function boxWord(n: number, lang: Lang): string {
  return n === 1 ? WORDS[lang].box : WORDS[lang].boxes;
}
