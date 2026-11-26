// The supplier's supplies, money and production: the names, units and row shapes the screens share. Mirrors
// supabase/migrations/20261123111000_supplier_supplies_money.sql and 20261123112000_supplier_production.sql; keep them
// in step.

export const ITEM_KINDS = ["bottle", "trigger", "cap", "chemical", "label", "carton_hard", "carton_2ply", "packing", "other"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export const ITEM_KIND_LABEL: Record<ItemKind, string> = {
  bottle: "Bottle",
  trigger: "Trigger",
  cap: "Cap",
  chemical: "Chemical",
  label: "Label",
  carton_hard: "Hard carton",
  carton_2ply: "2-ply carton",
  packing: "Packing",
  other: "Other",
};

export const ITEM_UNITS = ["pcs", "kg", "litre", "metre"] as const;
export type ItemUnit = (typeof ITEM_UNITS)[number];
/** Short, after a number: "1,000 pcs", "150 L". */
export const UNIT_SHORT: Record<ItemUnit, string> = { pcs: "pcs", kg: "kg", litre: "L", metre: "m" };
/** After "per": "rate per piece", "per litre". */
export const UNIT_ONE: Record<ItemUnit, string> = { pcs: "piece", kg: "kg", litre: "litre", metre: "metre" };
/** In a form's list. */
export const UNIT_LABEL: Record<ItemUnit, string> = { pcs: "Pieces", kg: "Kilograms", litre: "Litres", metre: "Metres" };

export const COST_KINDS = ["labour", "hamali", "transport", "electricity", "rent", "other"] as const;
export type CostKind = (typeof COST_KINDS)[number];
export const COST_KIND_LABEL: Record<CostKind, string> = {
  labour: "Labour",
  hamali: "Hamali",
  transport: "Transport",
  electricity: "Electricity",
  rent: "Rent",
  other: "Other",
};

export const PAY_MODES = ["cash", "upi", "bank", "cheque", "other"] as const;
export type PayMode = (typeof PAY_MODES)[number];
export const PAY_MODE_LABEL: Record<PayMode, string> = { cash: "Cash", upi: "UPI", bank: "Bank transfer", cheque: "Cheque", other: "Other" };

export const GST_RATES = [0, 5, 12, 18, 28] as const;

export type RecipePer = "unit" | "carton";
export type MoveReason = "purchase" | "production" | "count" | "received";
export const MOVE_REASON_LABEL: Record<MoveReason, string> = {
  purchase: "Received (purchase)",
  production: "Used in production",
  count: "Stock count",
  received: "Goods in",
};

export type ItemStock = {
  id: string;
  name: string;
  kind: ItemKind;
  unit: ItemUnit;
  low_level: number | null;
  active: boolean;
  on_hand: number;
  /** How much one box holds, in its unit (null: counted one by one); and its photo in the supplier's files. */
  box_qty?: number | null;
  photo_path?: string | null;
  /** A chemical mixed with water: `mix_qty` of it (in its unit) makes `mix_litres` litres of liquid ("1.5 kg makes 160 L"). */
  mix_qty?: number | null;
  mix_litres?: number | null;
  /** What the godown staff call it ("100ml Bottle"), in English, Hindi and Marathi; their screens show these. */
  simple_name?: string | null;
  simple_name_hi?: string | null;
  simple_name_mr?: string | null;
};

/** The name the godown staff know a supply by: its simple name, else its name. */
export const staffItemName = (item: Pick<ItemStock, "name" | "simple_name">) => item.simple_name || item.name;

/** How much of a chemical one litre of its liquid takes (1.5 kg makes 160 L: 0.009375 kg a litre); null if not mixed. */
export function perLitre(item: Pick<ItemStock, "mix_qty" | "mix_litres">): number | null {
  return item.mix_qty && item.mix_litres ? item.mix_qty / item.mix_litres : null;
}

/**
 * Recipes in the supplies' own units. A chemical mixed with water is in a recipe as the litres of liquid a piece takes
 * (0.25 L for a 250ml bottle), but its stock is in kg: such a line becomes kg by what the chemical makes (0.25 L of a
 * 1.5 kg to 160 L chemical is 0.00234 kg), as production in the database takes it off.
 */
export function inStockUnits<R extends Pick<RecipeLine, "item_id" | "qty">>(recipes: readonly R[], items: readonly Pick<ItemStock, "id" | "mix_qty" | "mix_litres">[]): R[] {
  const ratio = new Map(items.flatMap((i) => (perLitre(i) ? [[i.id, perLitre(i) as number] as const] : [])));
  return recipes.map((r) => (ratio.has(r.item_id) ? { ...r, qty: r.qty * (ratio.get(r.item_id) as number) } : r));
}
export type ItemMove = { id: number; item_id: string; qty: number; reason: MoveReason; note: string | null; moved_on: string };
export type VendorBalance = { id: string; name: string; phone: string | null; active: boolean; bought: number; paid: number; due: number };
export type Purchase = {
  id: string;
  vendor_id: string;
  item_id: string;
  bought_on: string;
  qty: number;
  rate: number;
  gst_pct: number;
  amount: number;
  bill_no: string | null;
  received_on: string | null;
  note: string | null;
};
export type Payment = { id: string; vendor_id: string; paid_on: string; amount: number; mode: PayMode; reference: string | null; note: string | null };
export type Cost = { id: string; spent_on: string; kind: CostKind; qty: number | null; rate: number | null; amount: number; note: string | null };
export type RecipeLine = { product_id: string; item_id: string; qty: number; per: RecipePer };
export type ProductionEntry = { id: string; product_id: string; made_on: string; units: number; note: string | null; created_at: string };
export type ReadyRow = {
  product_id: string;
  name: string;
  units_per_carton: number;
  daily_capacity: number | null;
  active: boolean;
  /** Finished goods at the supplier's. Below 0 when goods made before production was entered here were loaded. */
  ready: number;
  made_7d: number;
  made_30d: number;
  /** On how many of the last 30 days it was made. */
  days_30d: number;
  last_made_on: string | null;
};

const qtyFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });
const rupeeFormat = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A quantity of a supply: "1,000 pcs", "12.5 L". */
export function formatQty(n: number, unit: ItemUnit): string {
  return `${qtyFormat.format(n)} ${UNIT_SHORT[unit]}`;
}

/** Rupees with paise: "₹5,310.00", "₹4.50". */
export function formatRupees(n: number): string {
  return rupeeFormat.format(n);
}

/** Rounded to paise, so that adding up many amounts gives the figure a person would write down. */
export const paise = (n: number) => Math.round(n * 100) / 100;

/** At or under its low-stock level. */
export function isLow(item: Pick<ItemStock, "low_level" | "on_hand">): boolean {
  return item.low_level !== null && item.on_hand <= item.low_level;
}

/** Full boxes and loose pieces: "12 boxes + 4 pcs", "1 box", "18 pcs". */
export function boxesAndPieces(pieces: number, perBox: number): string {
  if (!(perBox > 0) || pieces < perBox) return `${qtyFormat.format(pieces)} pcs`;
  const boxes = Math.floor(pieces / perBox);
  const loose = pieces - boxes * perBox;
  return `${qtyFormat.format(boxes)} ${boxes === 1 ? "box" : "boxes"}${loose ? ` + ${qtyFormat.format(loose)} pcs` : ""}`;
}

/** A quantity of a supply in its boxes, when it comes in them: "2 boxes + 400 pcs", "1.5 kg", "640 pcs". */
export function formatBoxes(qty: number, unit: ItemUnit, perBox: number | null | undefined): string {
  if (!perBox || perBox <= 0 || qty < perBox) return formatQty(qty, unit);
  const boxes = Math.floor(qty / perBox + 1e-9);
  const loose = Math.round((qty - boxes * perBox) * 1000) / 1000;
  return `${qtyFormat.format(boxes)} ${boxes === 1 ? "box" : "boxes"}${loose > 0 ? ` + ${formatQty(loose, unit)}` : ""}`;
}

/** A number typed into a form ("1,200", " 4.5 "), or null when it is not one. */
export function readNumber(text: string): number | null {
  const t = text.replace(/[,\s₹]/g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** For each supply, the names of the products whose recipes use it, A to Z. */
export function recipeUses(recipes: readonly Pick<RecipeLine, "product_id" | "item_id">[], products: readonly { id: string; name: string }[]): Record<string, string[]> {
  const names = new Map(products.map((p) => [p.id, p.name]));
  const uses: Record<string, string[]> = {};
  for (const r of recipes) {
    const name = names.get(r.product_id);
    if (name) (uses[r.item_id] ??= []).push(name);
  }
  for (const list of Object.values(uses)) list.sort((a, b) => a.localeCompare(b));
  return uses;
}

/** "A", "A and B", "A, B and C". */
const andList = (names: readonly string[]) => (names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/**
 * What the owner is asked before a supply is removed for good: what goes with it (its stock as the list shows it, its
 * stock changes, its photo), the recipes it comes out of, and the gentler way to keep it out of sight.
 */
export function removeSupplyText(item: Pick<ItemStock, "name" | "on_hand" | "unit" | "box_qty" | "photo_path">, usedIn: readonly string[]): string {
  const goes = andList([...(item.on_hand ? [`its stock (${formatBoxes(item.on_hand, item.unit, item.box_qty)})`] : []), "its stock changes", ...(item.photo_path ? ["its photo"] : [])]);
  return [
    `Remove ${item.name} from your supplies for good? It cannot be brought back.`,
    "",
    `${goes.charAt(0).toUpperCase()}${goes.slice(1)} go with it.`,
    ...(usedIn.length ? [`It is taken out of the ${usedIn.length === 1 ? "recipe" : "recipes"} of ${andList(usedIn)}.`] : []),
    "",
    'To keep it but hide it, use Edit and untick "In use" instead.',
  ].join("\n");
}
