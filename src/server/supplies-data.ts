import "server-only";
import { addDays } from "@/lib/format";
import { shiftMonth } from "@/lib/report";
import type { Cost, ItemMove, ItemStock, Payment, ProductionEntry, Purchase, ReadyRow, RecipeLine, VendorBalance } from "@/lib/supplies";
import { notInstalled, soft, supplierDb } from "@/server/supplier-data";

// What the supplies, production and money screens read. Every query runs as the signed-in person, so the database
// decides what comes back: supplies and production for the supplier's logins and VRPRIME; the money for the supplier's
// owner alone (anyone else gets no rows, or a refusal from the function).

const n = (v: unknown) => Number(v ?? 0);
const nOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** The supplier's supplies and their stock. `installed` is false before the supplies migration is applied. */
export async function loadItemStock(supplierId: string): Promise<{ items: ItemStock[]; installed: boolean }> {
  const db = await supplierDb();
  const { data, error } = await db.rpc("supplier_item_stock", { p_supplier: supplierId });
  if (notInstalled(error)) return { items: [], installed: false };
  const rows = soft("supplies", error, data as ItemStock[] | null, []);
  return { items: rows.map((r) => ({ ...r, low_level: nOrNull(r.low_level), on_hand: n(r.on_hand) })), installed: true };
}

/** Changes to the supplies' stock from a day on, newest first. */
export async function loadItemMoves(supplierId: string, since: string, limit = 3000): Promise<ItemMove[]> {
  const db = await supplierDb();
  const { data, error } = await db
    .from("supplier_item_moves")
    .select("id, item_id, qty, reason, note, moved_on")
    .eq("supplier_id", supplierId)
    .gte("moved_on", since)
    .order("moved_on", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  return soft("supply moves", error, data as ItemMove[] | null, []).map((m) => ({ ...m, qty: n(m.qty) }));
}

/** Each product's ready stock and recent production. `installed` is false before the production migration. */
export async function loadReadyStock(supplierId: string): Promise<{ rows: ReadyRow[]; installed: boolean }> {
  const db = await supplierDb();
  const { data, error } = await db.rpc("supplier_ready_stock", { p_supplier: supplierId });
  if (notInstalled(error)) return { rows: [], installed: false };
  const rows = soft("ready stock", error, data as ReadyRow[] | null, []);
  return {
    rows: rows.map((r) => ({ ...r, daily_capacity: nOrNull(r.daily_capacity), ready: n(r.ready), made_7d: n(r.made_7d), made_30d: n(r.made_30d), days_30d: n(r.days_30d) })),
    installed: true,
  };
}

/** Production entries from a day on, newest first. */
export async function loadProduction(supplierId: string, since: string): Promise<ProductionEntry[]> {
  const db = await supplierDb();
  const { data, error } = await db
    .from("supplier_production")
    .select("id, product_id, made_on, units, note, created_at")
    .eq("supplier_id", supplierId)
    .gte("made_on", since)
    .order("made_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(5000);
  return soft("production", error, data as ProductionEntry[] | null, []).map((e) => ({ ...e, units: n(e.units) }));
}

export async function loadRecipes(supplierId: string): Promise<RecipeLine[]> {
  const db = await supplierDb();
  const { data, error } = await db.from("supplier_recipes").select("product_id, item_id, qty, per").eq("supplier_id", supplierId).limit(5000);
  return soft("recipes", error, data as RecipeLine[] | null, []).map((r) => ({ ...r, qty: n(r.qty) }));
}

export type MoneyData = {
  installed: boolean;
  vendors: VendorBalance[];
  purchases: Purchase[];
  payments: Payment[];
  costs: Cost[];
  /** Ordered and not received yet, from any month. */
  onOrder: Purchase[];
  /** Every purchase's supply, quantity and amount, for the average prices. */
  priced: Pick<Purchase, "item_id" | "qty" | "amount">[];
};

const PURCHASE_COLUMNS = "id, vendor_id, item_id, bought_on, qty, rate, gst_pct, amount, bill_no, received_on, note";
const purchaseRow = (p: Purchase): Purchase => ({ ...p, qty: n(p.qty), rate: n(p.rate), gst_pct: n(p.gst_pct), amount: n(p.amount) });

/** The supplier's money for a month (YYYY-MM), and what is owed. The supplier's owner only: anyone else reads nothing. */
export async function loadMoney(supplierId: string, month: string): Promise<MoneyData> {
  const db = await supplierDb();
  const from = `${month}-01`;
  const to = `${shiftMonth(month, 1)}-01`;
  const vendors = await db.rpc("supplier_vendor_balances", { p_supplier: supplierId });
  if (notInstalled(vendors.error)) return { installed: false, vendors: [], purchases: [], payments: [], costs: [], onOrder: [], priced: [] };
  const [purchases, payments, costs, onOrder, priced] = await Promise.all([
    db.from("supplier_purchases").select(PURCHASE_COLUMNS).eq("supplier_id", supplierId).gte("bought_on", from).lt("bought_on", to).order("bought_on", { ascending: false }).order("created_at", { ascending: false }).limit(3000),
    db.from("supplier_payments").select("id, vendor_id, paid_on, amount, mode, reference, note").eq("supplier_id", supplierId).gte("paid_on", from).lt("paid_on", to).order("paid_on", { ascending: false }).order("created_at", { ascending: false }).limit(3000),
    db.from("supplier_costs").select("id, spent_on, kind, qty, rate, amount, note").eq("supplier_id", supplierId).gte("spent_on", from).lt("spent_on", to).order("spent_on", { ascending: false }).order("created_at", { ascending: false }).limit(3000),
    db.from("supplier_purchases").select(PURCHASE_COLUMNS).eq("supplier_id", supplierId).is("received_on", null).order("bought_on").limit(500),
    db.from("supplier_purchases").select("item_id, qty, amount").eq("supplier_id", supplierId).limit(20000),
  ]);
  return {
    installed: true,
    vendors: soft("vendor balances", vendors.error, vendors.data as VendorBalance[] | null, []).map((v) => ({ ...v, bought: n(v.bought), paid: n(v.paid), due: n(v.due) })),
    purchases: soft("purchases", purchases.error, purchases.data as Purchase[] | null, []).map(purchaseRow),
    payments: soft("payments", payments.error, payments.data as Payment[] | null, []).map((p) => ({ ...p, amount: n(p.amount) })),
    costs: soft("costs", costs.error, costs.data as Cost[] | null, []).map((c) => ({ ...c, qty: nOrNull(c.qty), rate: nOrNull(c.rate), amount: n(c.amount) })),
    onOrder: soft("purchases on order", onOrder.error, onOrder.data as Purchase[] | null, []).map(purchaseRow),
    priced: soft("purchase prices", priced.error, priced.data as MoneyData["priced"] | null, []).map((p) => ({ item_id: p.item_id, qty: n(p.qty), amount: n(p.amount) })),
  };
}

/** Units made of each product between two days (inclusive), for the cost per unit. */
export function unitsMadeBetween(entries: ProductionEntry[], from: string, to: string): Map<string, number> {
  const made = new Map<string, number>();
  for (const e of entries) if (e.made_on >= from && e.made_on <= to) made.set(e.product_id, (made.get(e.product_id) ?? 0) + e.units);
  return made;
}

/** The last day of a month (YYYY-MM). */
export const monthEnd = (month: string) => addDays(`${shiftMonth(month, 1)}-01`, -1);

/** What the supplier owes its vendors, all months together. The supplier's owner only (0 for anyone else). */
export async function loadOwed(supplierId: string): Promise<number> {
  const db = await supplierDb();
  const { data, error } = await db.rpc("supplier_vendor_balances", { p_supplier: supplierId });
  if (error) return 0;
  return ((data ?? []) as VendorBalance[]).reduce((sum, v) => sum + Math.max(0, n(v.due)), 0);
}
