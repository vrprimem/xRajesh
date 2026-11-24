// Drawn pictures for materials that have no photo yet: a bottle, a trigger, a cap or an inner with its size on it
// ("100ML"), a sticker or a can with a short word from the material's name, a carton box. The staff find things by
// picture, so stickers and chemicals of different products get their own colour and word, and parts of different
// sizes show their size. Plain TypeScript (data: URLs), so `node --test` can run it.

const svg = (body: string, bg: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="16" fill="${bg}"/>${body}</svg>`)}`;

/** A dark tag along the bottom of a picture with a short word on it ("100ML", "SHOE"); nothing for no word. */
function tag(word: string): string {
  if (!word) return "";
  const width = Math.min(92, Math.max(44, word.length * 11 + 16));
  return `<rect x="${50 - width / 2}" y="74" width="${width}" height="21" rx="7" fill="#1e293b"/><text x="50" y="89.5" font-size="${word.length > 6 ? 12 : 15}" font-family="Arial" font-weight="700" text-anchor="middle" fill="#fff">${escape(word)}</text>`;
}

const COLOURS = ["#16a34a", "#dc2626", "#2563eb", "#9333ea", "#ea580c", "#0891b2", "#be185d", "#4d7c0f", "#b45309", "#475569"];

const hash = (name: string) => {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
};

/** A colour that stays the same for the same name. */
export function colourFor(name: string): string {
  return COLOURS[hash(name) % COLOURS.length];
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** The word a picture shows: the name without words like "sticker" or "chemical", short and in capitals. */
export function shortWord(name: string, drop: RegExp): string {
  const words = name.replace(drop, " ").replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  const word = (words.join(" ") || name).toUpperCase();
  return word.length > 8 ? word.slice(0, 8).trim() : word;
}

const PART_WORDS = /\b(bottles?|caps?|inners?|triggers?|pumps?|mist|spray|white|for|of|the|and)\b/gi;
const STICKER_WORDS = /\b(stickers?|labels?|front|back)\b/gi;
const CHEMICAL_WORDS = /\b(liquids?|chemicals?|drums?|concentrates?|mixed|ready)\b/gi;
const SIZES = /\d+(?:\.\d+)?\s*(?:ml|ltr|litres?|liters?|l|kg|gm?)\b/gi;

/** The size in a name, as a picture shows it: "100ml Cap" is "100ML", "1 litre bottle" is "1L"; empty for none. */
export function sizeWord(name: string): string {
  const size = name.match(/(\d+(?:\.\d+)?)\s*(ml|ltr|litres?|liters?|l)\b/i);
  return size ? `${size[1]}${size[2].toLowerCase() === "ml" ? "ML" : "L"}` : "";
}

/**
 * The word a bottle's, trigger's or cap's picture shows: its size when the name has one ("100ml Cap": "100ML",
 * "1 litre bottle": "1L"), else the name without words like "bottle" or "pump" ("Shoe Trigger": "SHOE"); empty when
 * nothing is left ("Trigger white").
 */
export function partWord(name: string): string {
  const size = sizeWord(name);
  if (size) return size;
  const words = name.replace(PART_WORDS, " ").replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  const word = words.join(" ").toUpperCase();
  return word.length > 8 ? (words[0] ?? "").toUpperCase().slice(0, 8) : word;
}

/**
 * The product a sticker or chemical is for, from its name without its size and words like "sticker":
 * "Repellent Sticker 250ml" and "Repellent Chemical" are both "REPELLENT", so they get the same colour.
 */
export function productWord(name: string, drop: RegExp): string {
  const words = name.replace(SIZES, " ").replace(drop, " ").replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  const all = (words.join(" ") || name).toUpperCase();
  return all.length <= 10 ? all : (words[0] ?? all).toUpperCase().slice(0, 10);
}

/** A text size that fits a word in a box about 55 wide. */
const fit = (word: string) => (word.length <= 5 ? 15 : word.length <= 7 ? 11 : 9);

/** The product a sticker or chemical is for ("REPELLENT"); null for other kinds. */
function familyWord(kind: string, name: string): string | null {
  if (kind === "label") return productWord(name, STICKER_WORDS);
  if (kind === "chemical") return productWord(name, CHEMICAL_WORDS);
  return null;
}

/**
 * A colour for each product the stickers and chemicals are for, no two alike (up to ten products), so that
 * all of one product's things share a colour: words in alphabetical order, each takes the colour its word gives, or
 * the next one free. A new product changes no other's colour unless it takes its place.
 */
export function familyColours(items: readonly { kind: string; name: string }[]): Map<string, string> {
  const words = [...new Set(items.map((i) => familyWord(i.kind, i.name)).filter((w): w is string => Boolean(w)))].sort();
  const taken = new Set<number>();
  const colours = new Map<string, string>();
  for (const word of words) {
    let slot = hash(word) % COLOURS.length;
    for (let tries = 0; taken.has(slot) && tries < COLOURS.length; tries++) slot = (slot + 1) % COLOURS.length;
    taken.add(slot);
    colours.set(word, COLOURS[slot]);
  }
  return colours;
}

export const PICTURE = {
  bottle: (word = "") =>
    svg(
      `<rect x="43" y="6" width="14" height="12" rx="2" fill="#cbd5e1" stroke="#64748b" stroke-width="2"/><path d="M38 18h24v9l7 9v44a6 6 0 0 1-6 6H37a6 6 0 0 1-6-6V36l7-9z" fill="#fff" stroke="#64748b" stroke-width="2.5" stroke-linejoin="round"/><path d="M38 46h24" stroke="#cbd5e1" stroke-width="3"/>${tag(word)}`,
      "#e0e7ff",
    ),
  trigger: (word = "") =>
    svg(
      `<path d="M20 22h46a12 12 0 0 1 12 12v2a8 8 0 0 1-8 8H58v14H38V44h-8l-10-8z" fill="#fff" stroke="#475569" stroke-width="2.5" stroke-linejoin="round"/><rect x="10" y="25" width="12" height="9" rx="2" fill="#94a3b8"/><path d="M33 44q-8 14 3 24" fill="none" stroke="#475569" stroke-width="6" stroke-linecap="round"/><rect x="37" y="58" width="22" height="14" rx="3" fill="#e2e8f0" stroke="#475569" stroke-width="2.5"/>${tag(word)}`,
      "#f1f5f9",
    ),
  cap: (word = "") =>
    svg(`<rect x="26" y="24" width="48" height="34" rx="6" fill="#fff" stroke="#475569" stroke-width="2.5"/><path d="M32 30v22M40 30v22M48 30v22M56 30v22M64 30v22" stroke="#cbd5e1" stroke-width="2"/>${tag(word)}`, "#f1f5f9"),
  /** The small plug that goes inside a cap: a disc with a short stem. */
  inner: (word = "") =>
    svg(
      `<ellipse cx="50" cy="30" rx="26" ry="8" fill="#fff" stroke="#475569" stroke-width="2.5"/><path d="M36 33v18a14 5 0 0 0 28 0V33" fill="#f8fafc" stroke="#475569" stroke-width="2.5"/><ellipse cx="50" cy="30" rx="12" ry="3.5" fill="#e2e8f0"/>${tag(word)}`,
      "#ecfdf5",
    ),
  /** A sticker in its product's colour and word, with its size along the bottom when it has one. */
  sticker: (color: string, text: string, size = "") =>
    svg(
      `<rect x="14" y="12" width="72" height="56" rx="6" fill="#fff" stroke="#64748b" stroke-width="2.5"/><rect x="21" y="20" width="58" height="40" rx="4" fill="${color}"/><text x="50" y="${44 + (fit(text) - 11) / 3}" font-size="${fit(text)}" font-family="Arial" font-weight="700" text-anchor="middle" fill="#fff">${escape(text)}</text>${tag(size)}`,
      "#fefce8",
    ),
  /** A can of chemical (bought by the kg, mixed with water): its product's colour, a white label with the word. */
  can: (color: string, text: string) =>
    svg(
      `<rect x="34" y="10" width="32" height="10" rx="3" fill="#475569"/><rect x="20" y="18" width="60" height="70" rx="10" fill="${color}"/><rect x="24" y="40" width="52" height="24" rx="4" fill="#fff"/><text x="50" y="${55 + (fit(text) - 11) / 3}" font-size="${Math.min(fit(text), 13) - (text.length > 7 ? 1 : 0)}" font-family="Arial" font-weight="700" text-anchor="middle" fill="#111">${escape(text)}</text>`,
      "#f5f3ff",
    ),
  carton: () =>
    svg(
      `<path d="M16 38L50 24l34 14-34 14z" fill="#e0b179"/><path d="M16 38v34l34 14V52z" fill="#b8844a"/><path d="M84 38v34L50 86V52z" fill="#c9955a"/><path d="M33 31l34 14" stroke="#f8e7c6" stroke-width="6"/>`,
      "#fef3c7",
    ),
  tape: () => svg(`<circle cx="50" cy="52" r="30" fill="#d6a46a"/><circle cx="50" cy="52" r="13" fill="#fef3c7"/><path d="M50 22h34v12H50z" fill="#e8c08e"/>`, "#fef3c7"),
  other: (text: string) =>
    svg(`<rect x="22" y="22" width="56" height="56" rx="10" fill="#e2e8f0" stroke="#64748b" stroke-width="2.5"/><text x="50" y="60" font-size="26" font-family="Arial" font-weight="700" text-anchor="middle" fill="#334155">${escape(text.slice(0, 2).toUpperCase())}</text>`, "#f8fafc"),
};

/**
 * The picture of a material of this kind (as Phase 2 names kinds) and name (its simple name, when it has one).
 * `colours`: each product's colour, from `familyColours` over all the supplier's materials.
 */
export function pictureFor(kind: string, name: string, colours?: ReadonlyMap<string, string>): string {
  const colourOf = (word: string) => colours?.get(word) ?? colourFor(word);
  switch (kind) {
    case "bottle":
      return PICTURE.bottle(partWord(name));
    case "trigger":
      return PICTURE.trigger(partWord(name));
    case "cap":
      return /\binners?\b/i.test(name) ? PICTURE.inner(partWord(name)) : PICTURE.cap(partWord(name));
    // A product's sticker and chemical share the word, so they share the colour: "Repellent Sticker 250ml" and
    // "Repellent Chemical".
    case "label": {
      const word = productWord(name, STICKER_WORDS);
      return PICTURE.sticker(colourOf(word), word, sizeWord(name));
    }
    case "chemical": {
      const word = productWord(name, CHEMICAL_WORDS);
      return PICTURE.can(colourOf(word), word);
    }
    case "carton_hard":
    case "carton_2ply":
      return PICTURE.carton();
    case "packing":
      return PICTURE.tape();
    default:
      return PICTURE.other(name);
  }
}
