"use server";

import { z } from "zod";
import { todayIST } from "@/lib/format";
import { logError } from "@/lib/redact";
import { getAdmin } from "@/lib/supabase/admin";
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

const itemSchema = z
  .object({
    id: UUID.nullable().optional(),
    name: z.string().trim().min(1, "Enter a name").max(120, "At most 120 letters"),
    kind: z.enum(ITEM_KINDS),
    unit: z.enum(ITEM_UNITS),
    low_level: z.number().min(0).max(1e10).nullable(),
    active: z.boolean().optional().default(true),
    // How much one box holds is not here: the warehouse person says it at the godown (see `entryOf`).
    // What the godown staff call it, in English, Hindi and Marathi ("" clears one); left out, the supply keeps it.
    simple_name: z.string().trim().max(120, "At most 120 letters").optional(),
    simple_name_hi: z.string().trim().max(120, "At most 120 letters").optional(),
    simple_name_mr: z.string().trim().max(120, "At most 120 letters").optional(),
    // A chemical mixed with water: this much of it makes these litres of liquid (both, or both null). Its recipes then
    // say the litres of liquid a piece takes.
    mix_qty: z.number().gt(0, "Above 0").max(1e9).nullable().optional(),
    mix_litres: z.number().gt(0, "Above 0").max(1e9).nullable().optional(),
  })
  .refine((v) => (v.mix_qty == null) === (v.mix_litres == null), {
    message: "Say how much of it makes how many litres, or leave both empty",
    path: ["mix_litres"],
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

const GOODS_IN_PHOTO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/goods-in\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;
const ITEM_PHOTO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/items\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;
const PRODUCT_PHOTO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/products\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;

/** Removes files from the supplier-photos bucket (people cannot remove files there themselves). Best effort. */
async function removePhotos(paths: string[]) {
  if (!paths.length) return;
  const { admin, problem } = getAdmin();
  const removed = admin ? await admin.storage.from("supplier-photos").remove(paths) : null;
  if (!admin || removed?.error) logError("supplier photo remove", removed?.error ?? new Error(problem ?? "no admin client"));
}

// What goes with goods in or a count, from the godown: how much one box holds (the warehouse person says it; left out
// when he did not change it; null: not boxed) and what it weighed (stickers).
const entrySchema = z
  .object({
    perBox: z.number().gt(0).max(1e9).nullable().optional(),
    kg: z.number().gt(0).max(1e9).nullable().optional(),
  })
  .optional()
  .default({});

/** The entry, or a refusal; and, when a box size came with it, the box set first. */
async function entryOf(item: string, entry: unknown): Promise<{ kg: number | null } | ActionResult<never>> {
  const parsed = entrySchema.safeParse(entry ?? {});
  if (!parsed.success) return { ok: false, message: "How much a box holds and the weight are numbers above 0." };
  if (parsed.data.perBox !== undefined) {
    const db = await supplierDb();
    const { error } = await db.rpc("supplier_item_set_box", { p_item: item, p_box_qty: parsed.data.perBox });
    if (error) return failed(error, "save how much a box holds");
  }
  return { kg: parsed.data.kg ?? null };
}

/**
 * Goods in: what came into the godown, added to the material's stock today. `photo`: the bill, already uploaded;
 * `entry`: the box size the warehouse person said, and a sticker's weight.
 */
export async function goodsIn(itemId: unknown, qty: unknown, photo: unknown = null, entry: unknown = {}): Promise<ActionResult<number>> {
  const who = await allowed("anyone");
  if (refused(who)) return who;
  const item = idOf(itemId);
  const n = z.number().gt(0).max(1e10).safeParse(qty);
  if (!item) return NOT_ALLOWED;
  if (!n.success) return { ok: false, message: "Enter how much came in: a number above 0." };
  const path = typeof photo === "string" && GOODS_IN_PHOTO.test(photo) ? photo : null;
  const extra = await entryOf(item, entry);
  const result = "ok" in extra ? extra : await run<number>("supplier_item_receive", { p_item: item, p_qty: n.data, p_photo: path, p_kg: extra.kg }, "save the goods in", "Goods in saved");
  if (!result.ok && path) await removePhotos([path]);
  return result;
}

/**
 * Made today: pieces of a product finished today, packed in `boxes` boxes (the godown says how many boxes and how many
 * in each). Its recipe's materials are taken off: per piece, and per box packed; a chemical by the litres of liquid.
 */
export async function madeToday(productId: unknown, units: unknown, boxes: unknown = null): Promise<ActionResult<string>> {
  const who = await allowed("anyone");
  if (refused(who)) return who;
  const product = idOf(productId);
  const n = z.number().int().min(1).max(10000000).safeParse(units);
  const b = z.number().int().min(0).max(10000000).nullable().safeParse(boxes);
  if (!product) return NOT_ALLOWED;
  if (!n.success || !b.success || (b.data !== null && b.data > n.data)) return { ok: false, message: "Enter how many boxes and how many in each: at least 1 piece." };
  return run<string>("supplier_production_save", { p: { product_id: product, made_on: todayIST(), units: n.data, cartons: b.data } }, "save what was made", "Saved");
}

/** A material's photo (the owner or VRPRIME), already uploaded; null takes it off. The old file is removed. */
export async function setItemPhoto(itemId: unknown, path: unknown): Promise<ActionResult> {
  const who = await allowed("owner_or_vrprime");
  if (refused(who)) return who;
  const item = idOf(itemId);
  const photo = typeof path === "string" && ITEM_PHOTO.test(path) ? path : null;
  if (!item || (path !== null && !photo)) return NOT_ALLOWED;
  const db = await supplierDb();
  const { data, error } = await db.rpc("supplier_item_set_photo", { p_item: item, p_path: photo });
  if (error) {
    if (photo) await removePhotos([photo]);
    return failed(error, "save the photo");
  }
  if (typeof data === "string" && ITEM_PHOTO.test(data)) await removePhotos([data]);
  refresh();
  return { ok: true, message: photo ? "Photo saved" : "Photo removed" };
}

/**
 * A product's photo taken by the supplier (its owner, or VRPRIME), already uploaded; null takes it off. It shows in
 * place of VRPRIME's photo of the product's master SKU. The old file is removed.
 */
export async function setProductPhoto(productId: unknown, path: unknown): Promise<ActionResult> {
  const who = await allowed("owner_or_vrprime");
  if (refused(who)) return who;
  const product = idOf(productId);
  const photo = typeof path === "string" && PRODUCT_PHOTO.test(path) ? path : null;
  if (!product || (path !== null && !photo)) return NOT_ALLOWED;
  const db = await supplierDb();
  const { data, error } = await db.rpc("supplier_product_set_photo", { p_product: product, p_path: photo });
  if (error) {
    if (photo) await removePhotos([photo]);
    return failed(error, "save the photo");
  }
  if (typeof data === "string" && PRODUCT_PHOTO.test(data)) await removePhotos([data]);
  refresh();
  return { ok: true, message: photo ? "Photo saved" : "Photo removed" };
}

/** A physical count of a supply: its stock becomes what was counted. `entry`: the box size said, a sticker's weight. */
export async function countItem(itemId: unknown, counted: unknown, note: unknown, entry: unknown = {}): Promise<ActionResult<number>> {
  const who = await allowed("anyone");
  if (refused(who)) return who;
  const item = idOf(itemId);
  const n = z.number().min(0).max(1e12).safeParse(counted);
  if (!item) return NOT_ALLOWED;
  if (!n.success) return { ok: false, message: "Enter what you counted: a number from 0." };
  const extra = await entryOf(item, entry);
  if ("ok" in extra) return extra;
  return run<number>(
    "supplier_item_count",
    { p_item: item, p_counted: n.data, p_note: typeof note === "string" ? note.slice(0, 200) : null, p_kg: extra.kg },
    "save the count",
    "Count saved",
  );
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
  // The full boxes the units were packed in (the cartons used); left out, the units over the product's carton.
  cartons: z.number().int("Whole boxes only").min(0).max(10000000).optional(),
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
