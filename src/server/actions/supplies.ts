"use server";

import { z } from "zod";
import { COST_KINDS, ITEM_KINDS, ITEM_UNITS, PAY_MODES } from "@/lib/supplies";
import type { ActionResult } from "@/lib/types";
import { NOT_SIGNED_IN, invalid } from "@/server/action-helpers";
import { NOT_ALLOWED, UUID, actor, failed, idOf, refresh, supplierFor, type Actor } from "@/server/supplier-actor";
import { supplierDb } from "@/server/supplier-data";

// The supplier's supplies, money and production. Who may do what (the database checks each again):
//   supplies: add and change - the supplier's owner or VRPRIME; count - the warehouse person too
//   vendors, purchases, payments, costs - the supplier's owner only (not the warehouse person, not VRPRIME)
//   recipes - the supplier's owner or VRPRIME; production and finished-goods counts - the warehouse person too

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
const text = (max: number) => z.string().trim().max(max).optional().default("");

type Who = "owner_or_vrprime" | "money" | "anyone";

/** Who is calling, if they may do this kind of thing; else the reason not. */
async function allowed(kind: Who): Promise<Actor | ActionResult<never>> {
  const who = await actor();
  if (!who) return NOT_SIGNED_IN;
  if (kind === "money" && !who.supplierOwner) return { ok: false, message: "Only the supplier's owner can see and change the money." };
  if (kind === "owner_or_vrprime" && who.scanner) return NOT_ALLOWED;
  return who;
}
const refused = (w: Actor | ActionResult<never>): w is ActionResult<never> => "ok" in w;

async function run<T = undefined>(fn: string, args: Record<string, unknown>, what: string, done: string): Promise<ActionResult<T>> {
  const db = await supplierDb();
  const { data, error } = await db.rpc(fn, args);
  if (error) return failed(error, what);
  refresh();
  return { ok: true, message: done, data: data as T };
}

// ---- Supplies ------------------------------------------------------------------------------------------------------------

const itemSchema = z.object({
  id: UUID.nullable().optional(),
  name: z.string().trim().min(1, "Enter a name").max(120, "At most 120 letters"),
  kind: z.enum(ITEM_KINDS),
  unit: z.enum(ITEM_UNITS),
  low_level: z.number().min(0).max(1e10).nullable(),
  active: z.boolean().optional().default(true),
});

export async function saveItem(supplierId: unknown, input: unknown): Promise<ActionResult<string>> {
  const who = await allowed("owner_or_vrprime");
  if (refused(who)) return who;
  const supplier = supplierFor(who, supplierId);
  if (!supplier) return NOT_ALLOWED;
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return run<string>("supplier_item_save", { p_supplier: supplier, p: parsed.data }, "save the supply", `${parsed.data.name} saved`);
}

/** A physical count of a supply: its stock becomes what was counted. */
export async function countItem(itemId: unknown, counted: unknown, note: unknown): Promise<ActionResult<number>> {
  const who = await allowed("anyone");
  if (refused(who)) return who;
  const item = idOf(itemId);
  const n = z.number().min(0).max(1e12).safeParse(counted);
  if (!item) return NOT_ALLOWED;
  if (!n.success) return { ok: false, message: "Enter what you counted: a number from 0." };
  return run<number>("supplier_item_count", { p_item: item, p_counted: n.data, p_note: typeof note === "string" ? note.slice(0, 200) : null }, "save the count", "Count saved");
}

// ---- Money: the supplier's owner only --------------------------------------------------------------------------------------

const vendorSchema = z.object({
  id: UUID.nullable().optional(),
  name: z.string().trim().min(1, "Enter a name").max(120, "At most 120 letters"),
  phone: text(30),
  note: text(300),
  active: z.boolean().optional().default(true),
});

export async function saveVendor(input: unknown): Promise<ActionResult<string>> {
  const who = await allowed("money");
  if (refused(who)) return who;
  const parsed = vendorSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return run<string>("supplier_vendor_save", { p_supplier: who.supplierOnly, p: parsed.data }, "save the vendor", `${parsed.data.name} saved`);
}

const purchaseSchema = z.object({
  id: UUID.nullable().optional(),
  vendor_id: UUID,
  item_id: UUID,
  bought_on: DAY,
  received_on: DAY.nullable(),
  qty: z.number().gt(0).max(1e10),
  rate: z.number().min(0).max(1e9),
  gst_pct: z.number().min(0).max(40),
  bill_no: text(60),
  note: text(300),
});

export async function savePurchase(input: unknown): Promise<ActionResult<string>> {
  const who = await allowed("money");
  if (refused(who)) return who;
  const parsed = purchaseSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const p = parsed.data;
  return run<string>("supplier_purchase_save", { p_supplier: who.supplierOnly, p }, "save the purchase", p.id ? "Purchase saved" : p.received_on ? "Purchase saved and added to stock" : "Purchase saved: add it to stock when it arrives");
}

const paymentSchema = z.object({
  id: UUID.nullable().optional(),
  vendor_id: UUID,
  paid_on: DAY,
  amount: z.number().gt(0).max(1e11),
  mode: z.enum(PAY_MODES),
  reference: text(60),
  note: text(300),
});

export async function savePayment(input: unknown): Promise<ActionResult<string>> {
  const who = await allowed("money");
  if (refused(who)) return who;
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return run<string>("supplier_payment_save", { p_supplier: who.supplierOnly, p: parsed.data }, "save the payment", "Payment saved");
}

const costSchema = z.object({
  id: UUID.nullable().optional(),
  spent_on: DAY,
  kind: z.enum(COST_KINDS),
  qty: z.number().gt(0).max(1e9).nullable(),
  rate: z.number().min(0).max(1e9).nullable(),
  amount: z.number().gt(0).max(1e11).nullable(),
  note: text(300),
});

export async function saveCost(input: unknown): Promise<ActionResult<string>> {
  const who = await allowed("money");
  if (refused(who)) return who;
  const parsed = costSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return run<string>("supplier_cost_save", { p_supplier: who.supplierOnly, p: parsed.data }, "save the cost", "Cost saved");
}

const MONEY_DELETE = {
  purchase: ["supplier_purchase_delete", "p_purchase", "Purchase removed"],
  payment: ["supplier_payment_delete", "p_payment", "Payment removed"],
  cost: ["supplier_cost_delete", "p_cost", "Cost removed"],
} as const;

/** Removes a purchase (and the stock it added), a payment or a cost entered by mistake. */
export async function removeMoneyEntry(kind: unknown, entryId: unknown): Promise<ActionResult> {
  const who = await allowed("money");
  if (refused(who)) return who;
  const id = idOf(entryId);
  if (!id || (kind !== "purchase" && kind !== "payment" && kind !== "cost")) return NOT_ALLOWED;
  const [fn, arg, done] = MONEY_DELETE[kind];
  return run(fn, { [arg]: id }, `remove the ${kind}`, done);
}

// ---- Recipes and production --------------------------------------------------------------------------------------------

const recipeSchema = z
  .array(z.object({ item_id: UUID, qty: z.number().gt(0).max(100000), per: z.enum(["unit", "carton"]) }))
  .max(30)
  .refine((lines) => new Set(lines.map((l) => l.item_id)).size === lines.length, "A supply is in the recipe twice");

export async function saveRecipe(productId: unknown, lines: unknown): Promise<ActionResult> {
  const who = await allowed("owner_or_vrprime");
  if (refused(who)) return who;
  const product = idOf(productId);
  if (!product) return NOT_ALLOWED;
  const parsed = recipeSchema.safeParse(lines);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message.startsWith("A supply") ? "A supply is in the recipe twice." : "Each supply needs a quantity above 0." };
  return run("supplier_recipe_save", { p_product: product, p_lines: parsed.data }, "save the recipe", parsed.data.length ? "Recipe saved" : "Recipe cleared");
}

const productionSchema = z.object({
  id: UUID.nullable().optional(),
  product_id: UUID,
  made_on: DAY,
  units: z.number().int("Whole units only").min(1, "At least 1").max(10000000),
  note: text(300),
});

export async function saveProduction(input: unknown): Promise<ActionResult<string>> {
  const who = await allowed("anyone");
  if (refused(who)) return who;
  const parsed = productionSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return run<string>("supplier_production_save", { p: parsed.data }, "save the production", "Production saved");
}

export async function removeProduction(entryId: unknown): Promise<ActionResult> {
  const who = await allowed("anyone");
  if (refused(who)) return who;
  const id = idOf(entryId);
  if (!id) return NOT_ALLOWED;
  return run("supplier_production_delete", { p_id: id }, "remove the entry", "Entry removed; its supplies are back in stock");
}

/** A count of a product's finished goods: the ready stock becomes what was counted. */
export async function countReady(productId: unknown, counted: unknown, note: unknown): Promise<ActionResult<number>> {
  const who = await allowed("anyone");
  if (refused(who)) return who;
  const product = idOf(productId);
  const n = z.number().int().min(0).max(100000000).safeParse(counted);
  if (!product) return NOT_ALLOWED;
  if (!n.success) return { ok: false, message: "Enter what you counted: whole units from 0." };
  return run<number>("supplier_stock_count", { p_product: product, p_counted: n.data, p_note: typeof note === "string" ? note.slice(0, 200) : null }, "save the count", "Count saved");
}
