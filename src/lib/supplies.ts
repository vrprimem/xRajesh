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
export type MoveReason = "purchase" | "production" | "count";
export const MOVE_REASON_LABEL: Record<MoveReason, string> = { purchase: "Received", production: "Used in production", count: "Stock count" };

export type ItemStock = { id: string; name: string; kind: ItemKind; unit: ItemUnit; low_level: number | null; active: boolean; on_hand: number };
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

/** Full cartons and loose units: "12 cartons + 4", "1 carton", "18 units". */
export function cartonsAndUnits(units: number, unitsPerCarton: number): string {
  if (!(unitsPerCarton > 0) || units < unitsPerCarton) return `${qtyFormat.format(units)} ${units === 1 ? "unit" : "units"}`;
  const cartons = Math.floor(units / unitsPerCarton);
  const loose = units - cartons * unitsPerCarton;
  return `${qtyFormat.format(cartons)} ${cartons === 1 ? "carton" : "cartons"}${loose ? ` + ${qtyFormat.format(loose)}` : ""}`;
}

/** A number typed into a form ("1,200", " 4.5 "), or null when it is not one. */
export function readNumber(text: string): number | null {
  const t = text.replace(/[,\s₹]/g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
