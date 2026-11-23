// The supplier portal's plain logic: labels and barcodes, the products sheet, the scan list kept on the phone, and the
// counts of a dispatch. No React, no database: `node --test` runs it.

/**
 * The database still keeps a carton type (H or T) on products, plan lines and labels, and matches a dispatch's labels
 * to its lines by it. The portal no longer shows or asks for it: a line takes its product's, and a label its line's.
 */
export type CartonType = "H" | "T";

export const PRODUCT_CATEGORIES = ["kitchen_cleaner", "repellent", "other_cleaning", "other"] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
export const CATEGORY_LABEL: Record<ProductCategory, string> = {
  kitchen_cleaner: "Kitchen cleaner",
  repellent: "Repellent",
  other_cleaning: "Other cleaning",
  other: "Other",
};

export type DispatchStatus = "planned" | "loading" | "closed" | "received" | "cancelled";
export const DISPATCH_STATUS_LABEL: Record<DispatchStatus, string> = {
  planned: "Planned",
  loading: "Loading",
  closed: "Closed, on its way",
  received: "Received",
  cancelled: "Cancelled",
};

export type ProduceStatus = "open" | "accepted" | "in_production" | "dispatched" | "cleared";
export const PRODUCE_STATUS_LABEL: Record<ProduceStatus, string> = {
  open: "No answer yet",
  accepted: "Accepted",
  in_production: "In production",
  dispatched: "Dispatched",
  cleared: "Stock is back",
};

// ---- Barcodes ----------------------------------------------------------------------------------------------------------

/**
 * A carton barcode is the VRPRIME inventory software's own: 16 digits starting with 1 (the next two are the warehouse).
 * The portal never makes one up; it only prints the labels the inventory software issued.
 */
export function isCartonBarcode(code: string): boolean {
  return /^1\d{15}$/.test(code);
}

/** What a scanner or a typing hand gave us, down to its digits. */
export function cleanBarcode(raw: string): string {
  return raw.replace(/\D/g, "");
}

// Code 128: the bar and space widths of each value (bar, space, bar, space, bar, space), 0 to 105. Each is 11 modules.
const CODE128 =
  "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232".split(
    " ",
  );
const CODE128_STOP = "2331112";
const START_C = 105;

/** The Code 128 values of an even run of digits, in set C (two digits per value): start, pairs, checksum. */
export function code128Values(digits: string): number[] {
  if (!/^\d+$/.test(digits) || digits.length % 2 !== 0) throw new Error("Code 128 set C needs an even number of digits");
  const values = [START_C];
  for (let i = 0; i < digits.length; i += 2) values.push(Number(digits.slice(i, i + 2)));
  const sum = values.reduce((n, v, i) => n + v * (i === 0 ? 1 : i), 0);
  values.push(sum % 103);
  return values;
}

/** The bars of a Code 128 barcode as widths in modules, starting with a bar: bar, space, bar, space ... */
export function code128Widths(digits: string): number[] {
  const pattern = code128Values(digits).map((v) => CODE128[v]).join("") + CODE128_STOP;
  return [...pattern].map(Number);
}

/**
 * A barcode as an SVG picture, Code 128. Only a stand-in: a label normally carries the picture the inventory software
 * sent with it. Bars only (no numbers); a quiet zone of 10 modules is left on each side, as scanners need.
 */
export function code128Svg(digits: string, height = 60): string {
  const widths = code128Widths(digits);
  const quiet = 10;
  let x = quiet;
  let bars = "";
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${w}" height="${height}"/>`;
    x += w;
  });
  const total = x + quiet;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height}" preserveAspectRatio="none" shape-rendering="crispEdges" role="img" aria-label="Barcode ${digits}"><rect width="${total}" height="${height}" fill="#fff"/><g fill="#000">${bars}</g></svg>`;
}

/** The barcode picture the inventory software sent, if it is a plain picture; anything that could run code is refused. */
export function plainSvg(svg: string | null | undefined): string | null {
  if (!svg) return null;
  const s = svg.trim();
  if (s.length > 20000 || !/^<svg[\s>]/i.test(s) || !/<\/svg>$/i.test(s)) return null;
  if (/<script|<foreignObject|<iframe|<image|<use|\son\w+\s*=|javascript:|href\s*=|url\(/i.test(s)) return null;
  return s;
}

// ---- The products sheet --------------------------------------------------------------------------------------------------

export type ProductInput = {
  name: string;
  master_code: string | null;
  category: ProductCategory;
  units_per_carton: number;
  daily_capacity: number | null;
  active: boolean;
  /** Carton weight in kg, sent to the inventory software with every label. */
  weight_per_carton: number | null;
};

export const MAX_PRODUCT_ROWS = 2000;

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const COLUMNS: Record<keyof Omit<ProductInput, "active">, string[]> = {
  name: ["name", "product", "productname", "item", "itemname"],
  master_code: ["mastersku", "vrprimemastersku", "master", "mastercode", "sku", "vrprimesku", "code"],
  category: ["category", "type"],
  units_per_carton: ["unitspercarton", "pcspercarton", "piecespercarton", "pcscarton", "cartonqty", "unitscarton", "packsize", "pcs"],
  daily_capacity: ["dailycapacity", "capacity", "dailyproductioncapacity", "perday", "capacityperday"],
  weight_per_carton: ["cartonweight", "weightpercarton", "weight", "weightkg", "cartonweightkg", "weightpercartonkg", "kgpercarton"],
};

/** A weight in kg: a number above 0, at most 1000, to 2 places. Empty is no weight; anything else is a mistake. */
export function parseWeight(text: string): number | null | "bad" {
  const t = text.replace(/,/g, "").replace(/\s*kgs?\s*$/i, "").trim();
  if (t === "") return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return "bad";
  const n = Math.round(Number(t) * 100) / 100;
  return n > 0 && n <= 1000 ? n : "bad";
}

function categoryOf(text: string): ProductCategory | null {
  const k = key(text);
  if (!k) return "other";
  if (k.includes("kitchen")) return "kitchen_cleaner";
  if (k.includes("repel")) return "repellent";
  if (k.includes("clean")) return "other_cleaning";
  if (k === "other" || k === "others") return "other";
  return null;
}

const wholeNumber = (text: string): number | null => {
  const t = text.replace(/,/g, "").trim();
  return /^\d+$/.test(t) ? Number(t) : null;
};

/**
 * Reads the products sheet (the rows of a .csv or the first sheet of an .xlsx). The first row is the headings, found by
 * name in any order: a name and units per carton are needed; master SKU, category, daily capacity and carton weight are
 * optional, and any other column (an old "Carton type" one, say) is left alone. A row with a problem is reported with
 * its row number and nothing is imported until the sheet is clean.
 */
export function parseProductsTable(lines: string[][]): { rows: ProductInput[]; errors: string[] } {
  const errors: string[] = [];
  const header = (lines[0] ?? []).map((h) => key(String(h ?? "")));
  const col = (names: string[]) => header.findIndex((h) => names.includes(h));
  const at = {
    name: col(COLUMNS.name),
    master: col(COLUMNS.master_code),
    category: col(COLUMNS.category),
    units: col(COLUMNS.units_per_carton),
    capacity: col(COLUMNS.daily_capacity),
    weight: col(COLUMNS.weight_per_carton),
  };
  if (at.name < 0) errors.push('No "Name" column was found in the first row.');
  if (at.units < 0) errors.push('No "Units per carton" column was found in the first row.');
  if (errors.length) return { rows: [], errors };

  const rows: ProductInput[] = [];
  const seen = new Set<string>();
  const cell = (line: string[], i: number) => (i < 0 ? "" : String(line[i] ?? "").trim());
  lines.slice(1).forEach((line, index) => {
    const rowNo = index + 2;
    if (line.every((c) => String(c ?? "").trim() === "")) return;
    const name = cell(line, at.name);
    if (!name) return void errors.push(`Row ${rowNo}: the name is empty.`);
    if (name.length > 200) return void errors.push(`Row ${rowNo}: the name is longer than 200 characters.`);
    if (seen.has(name.toLowerCase())) return void errors.push(`Row ${rowNo}: "${name}" is in the sheet twice.`);
    seen.add(name.toLowerCase());
    const units = wholeNumber(cell(line, at.units));
    if (units === null || units < 1 || units > 100000) return void errors.push(`Row ${rowNo} (${name}): units per carton must be a whole number from 1.`);
    const category = categoryOf(cell(line, at.category));
    if (!category) return void errors.push(`Row ${rowNo} (${name}): category "${cell(line, at.category)}" is not kitchen cleaner, repellent, other cleaning or other.`);
    const capText = cell(line, at.capacity);
    const capacity = capText === "" ? null : wholeNumber(capText);
    if (capText !== "" && capacity === null) return void errors.push(`Row ${rowNo} (${name}): daily capacity must be a whole number.`);
    const weight = parseWeight(cell(line, at.weight));
    if (weight === "bad") return void errors.push(`Row ${rowNo} (${name}): carton weight "${cell(line, at.weight)}" must be a number of kg above 0.`);
    rows.push({ name, master_code: cell(line, at.master) || null, category, units_per_carton: units, daily_capacity: capacity, active: true, weight_per_carton: weight });
  });
  if (rows.length > MAX_PRODUCT_ROWS) errors.push(`The sheet has ${rows.length} products; ${MAX_PRODUCT_ROWS} at most in one go.`);
  if (!rows.length && !errors.length) errors.push("The sheet has no products under its headings.");
  return { rows: errors.length ? [] : rows, errors };
}

// ---- A dispatch's counts -------------------------------------------------------------------------------------------------

export type CartonLite = { status: "issued" | "loaded" | "void"; units: number; replaces?: string | null };
export type DispatchCounts = { planned: number; loaded: number; left: number; voided: number; units: number };

/**
 * Cartons scanned against planned. Planned comes from the plan's lines (a reprint or a void does not change the plan);
 * loaded, left (label not scanned and not void) and voided come from the labels.
 */
export function dispatchCounts(lines: { cartons: number }[], cartons: CartonLite[]): DispatchCounts {
  const counts: DispatchCounts = { planned: 0, loaded: 0, left: 0, voided: 0, units: 0 };
  for (const l of lines) counts.planned += l.cartons;
  for (const c of cartons) {
    if (c.status === "loaded") {
      counts.loaded += 1;
      counts.units += c.units;
    } else if (c.status === "issued") counts.left += 1;
    else counts.voided += 1;
  }
  return counts;
}

/** A label as far as "is one still owed" goes. */
export type LabelLite = { product_id: string; carton_type: CartonType; status: "issued" | "loaded" | "void"; void_reason: string | null };

/**
 * Labels the inventory software has still to make for a plan: each line's cartons, less the labels it has. A label
 * voided for a reprint or a change of pieces or weight does not count (its replacement is owed); one voided as unused does. The
 * database's rule (private.supplier_labels_needed).
 */
export function labelsOwed(lines: { product_id: string; carton_type: CartonType; cartons: number }[], labels: LabelLite[]): number {
  let owed = 0;
  for (const l of lines) {
    const have = labels.filter((c) => c.product_id === l.product_id && c.carton_type === l.carton_type && !(c.status === "void" && (c.void_reason === "reprinted" || c.void_reason === "pieces changed" || c.void_reason === "weight changed"))).length;
    owed += Math.max(0, l.cartons - have);
  }
  return owed;
}

// ---- The scan list kept on the phone ---------------------------------------------------------------------------------------

/** A scan waiting to be saved: made with no signal, or not yet answered. */
export type PendingScan = { barcode: string; at: string };
export type ScanResult = "loaded" | "already" | "void" | "other_dispatch" | "unknown" | "closed";
export type ScanAnswer = { barcode: string; result: ScanResult; carton_no: number | null };

export const SCAN_RESULT_TEXT: Record<ScanResult, string> = {
  loaded: "Loaded",
  already: "Already scanned",
  void: "This label is void. Do not load it.",
  other_dispatch: "This carton belongs to another dispatch",
  unknown: "This barcode is not one of your labels",
  closed: "This dispatch is closed",
};
export const scanIsGood = (r: ScanResult) => r === "loaded" || r === "already";

/** Where a dispatch's waiting list is kept in the phone's storage. */
export const pendingKey = (dispatchId: string) => `vr-supplier-scans:${dispatchId}`;

/** Adds a scan to the waiting list. The same carton read twice while waiting is kept once (its first time). */
export function addPending(queue: PendingScan[], barcode: string, at: string): PendingScan[] {
  return queue.some((s) => s.barcode === barcode) ? queue : [...queue, { barcode, at }];
}

/** The waiting list after the server answered for these barcodes: every answered scan leaves it, whatever the answer. */
export function dropAnswered(queue: PendingScan[], answers: Pick<ScanAnswer, "barcode">[]): PendingScan[] {
  const done = new Set(answers.map((a) => a.barcode));
  return queue.filter((s) => !done.has(s.barcode));
}

/** Reads the waiting list back from the phone's storage; anything that is not a list of scans is an empty list. */
export function readPending(stored: string | null): PendingScan[] {
  if (!stored) return [];
  try {
    const value: unknown = JSON.parse(stored);
    if (!Array.isArray(value)) return [];
    return value.filter((s): s is PendingScan => !!s && typeof s === "object" && typeof (s as PendingScan).barcode === "string" && typeof (s as PendingScan).at === "string").slice(0, 5000);
  } catch {
    return [];
  }
}

// ---- Produce now -----------------------------------------------------------------------------------------------------------

export type PlanStatus = "open" | "accepted" | "in_production" | "ready" | "dispatched" | "cancelled";
export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  open: "New: no answer yet",
  accepted: "Accepted",
  in_production: "In production",
  ready: "Ready to send",
  dispatched: "Dispatch made",
  cancelled: "Cancelled",
};

/** Units rounded up to full cartons: the send plan always asks for whole cartons. 0 or less is no cartons. */
export function cartonsFor(units: number, unitsPerCarton: number): number {
  if (!(units > 0) || !(unitsPerCarton > 0)) return 0;
  return Math.ceil(units / unitsPerCarton);
}

/** Units to make: enough to bring stock + in transit up to twice the minimum, in full cartons. The database's rule. */
export function suggestedUnits(stock: number, inTransit: number, minUnits: number, unitsPerCarton: number): number {
  const short = 2 * minUnits - stock - inTransit;
  if (short <= 0) return 0;
  return Math.ceil(short / unitsPerCarton) * unitsPerCarton;
}

/**
 * A carton's weight for another count of pieces, worked out from a full carton's weight (kg, to 10 g): a box of 12
 * from one of 24 at 8.5 kg is 4.25 kg. Null without a weight to start from. Only a starting point: the box itself
 * weighs something too, so the supplier checks it on the scale.
 */
export function cartonWeightFor(fullWeight: number | null | undefined, fullUnits: number, pieces: number): number | null {
  if (!fullWeight || !(fullWeight > 0) || !(fullUnits > 0) || !(pieces > 0)) return null;
  return Math.round(((fullWeight * pieces) / fullUnits) * 100) / 100;
}
