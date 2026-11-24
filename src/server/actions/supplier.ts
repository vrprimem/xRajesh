"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canManage, getActiveUser, getPortalUser } from "@/lib/auth";
import { PHOTO_FILE } from "@/lib/photos";
import { logError, redactSecrets } from "@/lib/redact";
import { adminErrorMessage, getAdmin } from "@/lib/supabase/admin";
import { MAX_PRODUCT_ROWS, PRODUCT_CATEGORIES, isCartonBarcode, type ProductInput, type ScanAnswer } from "@/lib/supplier";
import { SUPPLIER_ROLES, type ActionResult } from "@/lib/types";
import { fieldErrors } from "@/lib/validation";
import { NOT_SIGNED_IN } from "@/server/action-helpers";
import { supplierDb } from "@/server/supplier-data";

// The supplier portal's actions. Two kinds of people call them: a supplier login (its own supplier only) and VRPRIME's
// owner and admin (any supplier). Each action works out who is calling here, and every database function checks again.

const UUID = z.uuid();

type Actor = { supplierOnly: string | null; isOwner: boolean; scanner: boolean };

/** Who is calling. `supplierOnly` is the one supplier a supplier login may touch; null for VRPRIME owner and admin. */
async function actor(): Promise<Actor | null> {
  const portal = await getPortalUser();
  if (portal) return { supplierOnly: portal.supplierId, isOwner: false, scanner: portal.role === "supplier_scanner" };
  const user = await getActiveUser();
  if (user && canManage(user)) return { supplierOnly: null, isOwner: user.role === "owner", scanner: false };
  return null;
}

/** The supplier an action is about: a supplier login always gets its own, whatever was sent. */
function supplierFor(who: Actor, sent: unknown): string | null {
  if (who.supplierOnly) return who.supplierOnly;
  return UUID.safeParse(sent).success ? (sent as string) : null;
}

const NOT_ALLOWED: ActionResult<never> = { ok: false, message: "You do not have access to do that." };

/** A database refusal as a message. The functions raise plain sentences (code 22023) that are safe to show. */
function failed(error: { message: string; code?: string }, what: string): ActionResult<never> {
  if (error.code === "PGRST202" || error.code === "42883") return { ok: false, message: "The database is not set up yet (see SETUP.md)." };
  if (error.code === "42501") return NOT_ALLOWED;
  if (error.code === "22023") {
    const text = redactSecrets(error.message);
    return { ok: false, message: text.charAt(0).toUpperCase() + text.slice(1) + (/[.!?]$/.test(text) ? "" : ".") };
  }
  logError(`supplier ${what}`, error);
  return { ok: false, message: `Could not ${what}. Check your connection and try again.` };
}

function refresh() {
  revalidatePath("/", "layout");
}

// ---- Products ------------------------------------------------------------------------------------------------------------

const productSchema = z.object({
  name: z.string().trim().min(1).max(200),
  master_code: z.string().trim().max(200).nullable(),
  category: z.enum(PRODUCT_CATEGORIES),
  units_per_carton: z.number().int().min(1).max(100000),
  daily_capacity: z.number().int().min(0).max(10000000).nullable(),
  active: z.boolean(),
  weight_per_carton: z.number().gt(0).max(1000).nullable(),
});

/** Adds or updates products by name: one from the form, or many from the sheet. Never removes any. */
export async function saveProducts(supplierId: unknown, rows: unknown): Promise<ActionResult> {
  const who = await actor();
  if (!who) return NOT_SIGNED_IN;
  if (who.scanner) return NOT_ALLOWED;
  const supplier = supplierFor(who, supplierId);
  if (!supplier) return NOT_ALLOWED;
  const parsed = z.array(productSchema).min(1).max(MAX_PRODUCT_ROWS).safeParse(rows);
  if (!parsed.success) return { ok: false, message: "Check the product: it needs a name, units per carton (a whole number from 1), and a carton weight above 0 kg if one is given." };
  const list: ProductInput[] = parsed.data;
  const db = await supplierDb();
  const { data, error } = await db.rpc("supplier_products_save", { p_supplier: supplier, p_rows: list });
  if (error) return failed(error, "save the products");
  refresh();
  const added = Number(data?.added ?? 0);
  const changed = Number(data?.changed ?? 0);
  return { ok: true, message: list.length === 1 ? (added ? `${list[0].name} added` : `${list[0].name} saved`) : `${added} added, ${changed} updated` };
}

// ---- Dispatches -----------------------------------------------------------------------------------------------------------

const dispatchSchema = z.object({
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  note: z.string().trim().max(500).optional().default(""),
  lines: z
    .array(z.object({ product_id: UUID, cartons: z.number().int().min(1, "At least 1 carton").max(5000), units_per_carton: z.number().int().min(1).max(100000).optional(), weight_per_carton: z.number().gt(0).max(1000).optional() }))
    .min(1, "Add at least one product")
    .max(200),
});

/** Creates a dispatch plan and issues one label per carton. Returns the new dispatch's id. */
export async function createDispatch(supplierId: unknown, input: unknown): Promise<ActionResult<string>> {
  const who = await actor();
  if (!who) return NOT_SIGNED_IN;
  if (who.scanner) return NOT_ALLOWED;
  const supplier = supplierFor(who, supplierId);
  if (!supplier) return NOT_ALLOWED;
  const parsed = dispatchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the plan: a date, and at least one product with cartons.", fieldErrors: fieldErrors(parsed.error) };
  const db = await supplierDb();
  const { data, error } = await db.rpc("supplier_dispatch_create", { p_supplier: supplier, p_due: parsed.data.due, p_note: parsed.data.note, p_lines: parsed.data.lines });
  if (error) return failed(error, "create the dispatch");
  refresh();
  return { ok: true, message: "Dispatch created. Its labels are being made by the inventory software.", data: data as string };
}

/**
 * Saves scans from the loading screen: [{ barcode, at }]. Safe to send again after a lost connection. Answers one
 * result per scan. Not revalidated: the loading screen keeps its own count while it scans.
 */
export async function scanCartons(dispatchId: unknown, scans: unknown): Promise<ActionResult<ScanAnswer[]>> {
  const who = await actor();
  if (!who) return NOT_SIGNED_IN;
  if (!UUID.safeParse(dispatchId).success) return NOT_ALLOWED;
  const parsed = z.array(z.object({ barcode: z.string().refine(isCartonBarcode), at: z.iso.datetime({ offset: true }) })).max(500).safeParse(scans);
  if (!parsed.success) return { ok: false, message: "Those scans were not understood." };
  if (!parsed.data.length) return { ok: true, message: "Nothing to save", data: [] };
  const db = await supplierDb();
  const { data, error } = await db.rpc("supplier_scan", { p_dispatch: dispatchId, p_scans: parsed.data });
  if (error) return failed(error, "save the scans");
  return { ok: true, message: "Saved", data: (data ?? []) as ScanAnswer[] };
}

/** One of the plain dispatch and label steps: each is a database function that takes the id and checks everything itself. */
async function step(fn: string, args: Record<string, unknown>, what: string, done: string, ownerOnly = false): Promise<ActionResult> {
  const who = await actor();
  if (!who) return NOT_SIGNED_IN;
  if (ownerOnly && who.scanner) return NOT_ALLOWED;
  if (Object.values(args).some((v) => typeof v === "string" && v.length > 400)) return NOT_ALLOWED;
  const db = await supplierDb();
  const { error } = await db.rpc(fn, args);
  if (error) return failed(error, what);
  refresh();
  return { ok: true, message: done };
}

const id = (v: unknown): string | null => (UUID.safeParse(v).success ? (v as string) : null);

export async function voidCarton(cartonId: unknown, reason: unknown): Promise<ActionResult> {
  const carton = id(cartonId);
  if (!carton) return NOT_ALLOWED;
  return step("supplier_carton_void", { p_carton: carton, p_reason: typeof reason === "string" ? reason.slice(0, 200) : "" }, "void the label", "Label voided");
}

/** Voids a damaged label and asks the inventory software for a new one for the same carton. */
export async function reprintCarton(cartonId: unknown): Promise<ActionResult> {
  const carton = id(cartonId);
  if (!carton) return NOT_ALLOWED;
  return step("supplier_carton_reprint", { p_carton: carton }, "reprint the label", "Old label voided. The new one is being made: refresh in a few seconds and download it with its PDF button.");
}

/** "Try again": asks the inventory software for the labels a dispatch is still missing. */
export async function requestLabels(dispatchId: unknown): Promise<ActionResult> {
  const dispatch = id(dispatchId);
  if (!dispatch) return NOT_ALLOWED;
  return step("supplier_labels_request", { p_dispatch: dispatch }, "ask for the labels", "Asking the inventory software for the labels. This takes a few seconds.");
}

export async function voidUnusedLabels(dispatchId: unknown): Promise<ActionResult> {
  const dispatch = id(dispatchId);
  if (!dispatch) return NOT_ALLOWED;
  return step("supplier_dispatch_void_unused", { p_dispatch: dispatch }, "void the unused labels", "Unused labels voided");
}

/** Attaches the vehicle photo already uploaded to "<supplier>/<dispatch>/<uuid>.jpg". The database checks the path. */
export async function setDispatchPhoto(dispatchId: unknown, path: unknown): Promise<ActionResult> {
  const dispatch = id(dispatchId);
  if (!dispatch || typeof path !== "string") return NOT_ALLOWED;
  return step("supplier_dispatch_set_photo", { p_dispatch: dispatch, p_path: path }, "attach the photo", "Photo attached");
}

export async function closeDispatch(dispatchId: unknown): Promise<ActionResult> {
  const dispatch = id(dispatchId);
  if (!dispatch) return NOT_ALLOWED;
  return step("supplier_dispatch_close", { p_dispatch: dispatch }, "close the dispatch", "Dispatch closed and locked");
}

export async function cancelDispatch(dispatchId: unknown): Promise<ActionResult> {
  const dispatch = id(dispatchId);
  if (!dispatch) return NOT_ALLOWED;
  return step("supplier_dispatch_cancel", { p_dispatch: dispatch }, "cancel the dispatch", "Dispatch cancelled", true);
}

const addLinesSchema = dispatchSchema.shape.lines;

/**
 * More products, or more cartons of a product already on it, for a dispatch still being loaded. Their labels are made
 * by the inventory software as for a new dispatch. Returns how many cartons were added.
 */
export async function addDispatchProducts(dispatchId: unknown, lines: unknown): Promise<ActionResult<number>> {
  const who = await actor();
  if (!who) return NOT_SIGNED_IN;
  if (who.scanner) return NOT_ALLOWED;
  const dispatch = id(dispatchId);
  if (!dispatch) return NOT_ALLOWED;
  const parsed = addLinesSchema.safeParse(lines);
  if (!parsed.success) return { ok: false, message: "Check the products: each needs a number of cartons from 1." };
  const db = await supplierDb();
  const { data, error } = await db.rpc("supplier_dispatch_add_lines", { p_dispatch: dispatch, p_lines: parsed.data });
  if (error) return failed(error, "add the products");
  refresh();
  const n = Number(data ?? 0);
  return { ok: true, message: `${n} ${n === 1 ? "carton" : "cartons"} added. Their labels are being made by the inventory software.`, data: n };
}

/** The supplier's answer to a "Produce now" request. */
export async function respondProduce(requestId: unknown, status: unknown): Promise<ActionResult> {
  const request = id(requestId);
  if (!request || (status !== "accepted" && status !== "in_production" && status !== "dispatched")) return NOT_ALLOWED;
  return step("supplier_produce_respond", { p_request: request, p_status: status }, "save your answer", "Answer saved", true);
}

// ---- VRPRIME's side (owner and admin; the database refuses a supplier login) -----------------------------------------------

async function staff(ownerOnly = false): Promise<ActionResult<never> | null> {
  const user = await getActiveUser();
  if (!user) return NOT_SIGNED_IN;
  if (!canManage(user) || (ownerOnly && user.role !== "owner")) return { ok: false, message: ownerOnly ? "Only the owner can do that." : "Only the owner or an admin can do that." };
  return null;
}

/** Sets a product's minimum stock at VRPRIME, or removes it (an empty value). */
export async function setThreshold(productId: unknown, min: unknown): Promise<ActionResult> {
  const denied = await staff();
  if (denied) return denied;
  const product = id(productId);
  if (!product) return NOT_ALLOWED;
  if (min !== null && !(typeof min === "number" && Number.isInteger(min) && min >= 1 && min <= 100000000)) return { ok: false, message: "The minimum must be a whole number from 1, or empty for none." };
  const db = await supplierDb();
  const { error } = await db.rpc("supplier_threshold_set", { p_product: product, p_min: min });
  if (error) return failed(error, "save the minimum");
  refresh();
  return { ok: true, message: min === null ? "Minimum removed" : "Minimum saved" };
}

/** The "Sync now" button: reads the stock from the inventory software again. */
export async function requestStockSync(): Promise<ActionResult> {
  const denied = await staff();
  if (denied) return denied;
  const db = await supplierDb();
  const { error } = await db.rpc("request_inventory_sync");
  if (error) return failed(error, "start the sync");
  refresh();
  return { ok: true, message: "Reading the stock. This takes a few seconds." };
}

/** Marks a closed dispatch as received at VRPRIME, so its units stop counting as in transit. */
export async function receiveDispatch(dispatchId: unknown): Promise<ActionResult> {
  const denied = await staff();
  if (denied) return denied;
  const dispatch = id(dispatchId);
  if (!dispatch) return NOT_ALLOWED;
  const db = await supplierDb();
  const { error } = await db.rpc("supplier_dispatch_receive", { p_dispatch: dispatch });
  if (error) return failed(error, "mark it received");
  refresh();
  return { ok: true, message: "Marked as received" };
}

const supplierSchema = z.object({ name: z.string().trim().min(1, "Enter a name").max(120), warehouseId: UUID });

/** Adds a supplier. Owner only; saved with the service key, as Manage users does. */
export async function createSupplier(input: unknown): Promise<ActionResult> {
  const denied = await staff(true);
  if (denied) return denied;
  const parsed = supplierSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Enter a name and pick the warehouse that receives the goods.", fieldErrors: fieldErrors(parsed.error) };
  const { admin, problem } = getAdmin();
  if (problem !== null) return { ok: false, message: problem };
  const { error } = await admin.from("suppliers").insert({ name: parsed.data.name, warehouse_id: parsed.data.warehouseId });
  if (error) {
    if (error.code === "23505") return { ok: false, message: "A supplier with this name already exists.", fieldErrors: { name: "Already in use" } };
    return failed(error, "add the supplier");
  }
  refresh();
  return { ok: true, message: `${parsed.data.name} added` };
}

const updateSupplierSchema = z.object({ supplierId: UUID, name: z.string().trim().min(1, "Enter a name").max(120), warehouseId: UUID, active: z.boolean() });

/** Renames a supplier, changes where it sends goods, or switches it off (its logins then see nothing). Owner only. */
export async function updateSupplier(input: unknown): Promise<ActionResult> {
  const denied = await staff(true);
  if (denied) return denied;
  const parsed = updateSupplierSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Enter a name and pick the warehouse that receives the goods.", fieldErrors: fieldErrors(parsed.error) };
  const { admin, problem } = getAdmin();
  if (problem !== null) return { ok: false, message: problem };
  const v = parsed.data;
  const { error } = await admin.from("suppliers").update({ name: v.name, warehouse_id: v.warehouseId, active: v.active }).eq("id", v.supplierId);
  if (error) {
    if (error.code === "23505") return { ok: false, message: "A supplier with this name already exists.", fieldErrors: { name: "Already in use" } };
    return failed(error, "save the supplier");
  }
  refresh();
  return { ok: true, message: v.active ? `${v.name} saved` : `${v.name} switched off: its logins can no longer see anything` };
}

/**
 * Gives a supplier login a new password. With `mustChange` they choose their own at their next sign-in; without it the
 * password stays as given until they change it themselves. Owner only.
 */
export async function changeSupplierPassword(userId: unknown, password: unknown, mustChange: unknown): Promise<ActionResult> {
  const denied = await staff(true);
  if (denied) return denied;
  const user = id(userId);
  const pw = z.string().min(8, "Use at least 8 characters").max(72).safeParse(password);
  if (!user || typeof mustChange !== "boolean") return NOT_ALLOWED;
  if (!pw.success) return { ok: false, message: "The new password needs at least 8 characters." };
  const { admin, problem } = getAdmin();
  if (problem !== null) return { ok: false, message: problem };
  // Only ever a supplier login: this can never change one of VRPRIME's own people's password.
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user).maybeSingle();
  if (!profile || !(SUPPLIER_ROLES as readonly string[]).includes(profile.role as string)) return NOT_ALLOWED;
  const { error: authError } = await admin.auth.admin.updateUserById(user, { password: pw.data });
  if (authError) {
    logError("supplier password change", authError);
    return { ok: false, message: adminErrorMessage("change the password", authError) };
  }
  const { error } = await admin.from("profiles").update({ must_change_password: mustChange }).eq("id", user);
  if (error) return failed(error, "finish the password change");
  refresh();
  return {
    ok: true,
    message: mustChange ? "Password changed. Tell them the new password; they choose their own when they next sign in." : "Password changed. Tell them the new password.",
  };
}

/**
 * Removes a supplier login for good: it can no longer sign in, and its email can be used for a new login. What it did
 * stays (dispatches, scans, plans), only without the name of who did it. Owner only.
 */
export async function removeSupplierLogin(userId: unknown): Promise<ActionResult> {
  const denied = await staff(true);
  if (denied) return denied;
  const user = id(userId);
  if (!user) return NOT_ALLOWED;
  const { admin, problem } = getAdmin();
  if (problem !== null) return { ok: false, message: problem };
  // Only ever a supplier login: this can never remove one of VRPRIME's own people.
  const { data: profile } = await admin.from("profiles").select("role, name").eq("id", user).maybeSingle();
  if (!profile || !(SUPPLIER_ROLES as readonly string[]).includes(profile.role as string)) return NOT_ALLOWED;
  // Deleting the sign-in deletes its profile too (and its alerts); other records keep their rows with "by" left empty.
  const { error: authError } = await admin.auth.admin.deleteUser(user);
  if (authError) {
    logError("supplier login remove", authError);
    return { ok: false, message: adminErrorMessage("remove the login", authError) };
  }
  refresh();
  return { ok: true, message: `${profile.name as string}'s login is removed` };
}

const loginSchema = z.object({
  supplierId: UUID,
  name: z.string().trim().min(1, "Enter a name").max(80),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
  role: z.enum(SUPPLIER_ROLES),
  password: z.string().min(8, "Use at least 8 characters").max(72, "Use at most 72 characters"),
});

/** Creates a supplier login with a temporary password (they choose their own at first sign-in). Owner only. */
export async function createSupplierLogin(input: unknown): Promise<ActionResult> {
  const denied = await staff(true);
  if (denied) return denied;
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;
  const { admin, problem } = getAdmin();
  if (problem !== null) return { ok: false, message: problem };

  const { data: created, error: authError } = await admin.auth.admin.createUser({ email: v.email, password: v.password, email_confirm: true });
  if (authError || !created.user) {
    logError("supplier login create", authError);
    const exists = authError?.code === "email_exists";
    return { ok: false, message: exists ? "A user with this email already exists." : adminErrorMessage("create the login", authError ?? { message: "no details" }), fieldErrors: exists ? { email: "Already in use" } : undefined };
  }
  const { error } = await admin.from("profiles").upsert({ id: created.user.id, name: v.name, role: v.role, supplier_id: v.supplierId, active: true, must_change_password: true });
  if (error) {
    logError("supplier login profile", error);
    // Do not leave a login behind that has no profile.
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, message: "Could not create the login. Try again." };
  }
  refresh();
  return { ok: true, message: `${v.name} can now sign in with the temporary password` };
}

/** Switches a supplier login on or off. Owner only. */
export async function setSupplierLoginActive(userId: unknown, active: unknown): Promise<ActionResult> {
  const denied = await staff(true);
  if (denied) return denied;
  const user = id(userId);
  if (!user || typeof active !== "boolean") return NOT_ALLOWED;
  const { admin, problem } = getAdmin();
  if (problem !== null) return { ok: false, message: problem };
  // Only ever a supplier login: this can never switch one of VRPRIME's own people off.
  const { error } = await admin.from("profiles").update({ active }).eq("id", user).in("role", [...SUPPLIER_ROLES]);
  if (error) return failed(error, "save the login");
  refresh();
  return { ok: true, message: active ? "Login switched on" : "Login switched off" };
}

// ---- VRPRIME's own logins (owner only) -------------------------------------------------------------------------------------

const staffLoginSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(80),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
  role: z.enum(["owner", "admin"]),
  password: z.string().min(8, "Use at least 8 characters").max(72, "Use at most 72 characters"),
});

/** Creates a login for one of VRPRIME's own people, with a temporary password. Owner only. */
export async function createStaffLogin(input: unknown): Promise<ActionResult> {
  const denied = await staff(true);
  if (denied) return denied;
  const parsed = staffLoginSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;
  const { admin, problem } = getAdmin();
  if (problem !== null) return { ok: false, message: problem };

  const { data: created, error: authError } = await admin.auth.admin.createUser({ email: v.email, password: v.password, email_confirm: true });
  if (authError || !created.user) {
    logError("staff login create", authError);
    const exists = authError?.code === "email_exists";
    return { ok: false, message: exists ? "A user with this email already exists." : adminErrorMessage("create the login", authError ?? { message: "no details" }), fieldErrors: exists ? { email: "Already in use" } : undefined };
  }
  const { error } = await admin.from("profiles").upsert({ id: created.user.id, name: v.name, role: v.role, active: true, must_change_password: true });
  if (error) {
    logError("staff login profile", error);
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, message: "Could not create the login. Try again." };
  }
  refresh();
  return { ok: true, message: `${v.name} can now sign in with the temporary password` };
}

/** Switches one of VRPRIME's own logins on or off. Owner only; the database refuses to switch off the last owner. */
export async function setStaffLoginActive(userId: unknown, active: unknown): Promise<ActionResult> {
  const denied = await staff(true);
  if (denied) return denied;
  const user = id(userId);
  if (!user || typeof active !== "boolean") return NOT_ALLOWED;
  const { admin, problem } = getAdmin();
  if (problem !== null) return { ok: false, message: problem };
  const { error } = await admin.from("profiles").update({ active }).eq("id", user).in("role", ["owner", "admin"]);
  if (error) {
    if (error.code === "23514") return { ok: false, message: "There must always be at least one active owner." };
    return failed(error, "save the login");
  }
  refresh();
  return { ok: true, message: active ? "Login switched on" : "Login switched off" };
}

// ---- Send plans: VRPRIME says what to send next ---------------------------------------------------------------------------

const planSchema = z.object({
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  note: z.string().trim().max(500).optional().default(""),
  lines: z.array(z.object({ product_id: UUID, cartons: z.number().int().min(1).max(5000) })).min(1, "Add cartons for at least one product").max(500),
});

/** A send plan for a supplier. VRPRIME owner and admin; the supplier's owners are told. */
export async function createPlan(supplierId: unknown, input: unknown): Promise<ActionResult<string>> {
  const denied = await staff();
  if (denied) return denied;
  const supplier = id(supplierId);
  if (!supplier) return NOT_ALLOWED;
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the plan: a date, and whole cartons for at least one product." };
  const db = await supplierDb();
  const { data, error } = await db.rpc("supplier_plan_create", { p_supplier: supplier, p_due: parsed.data.due, p_note: parsed.data.note, p_lines: parsed.data.lines });
  if (error) return failed(error, "send the plan");
  refresh();
  return { ok: true, message: "Send plan made. Rajesh has been told.", data: data as string };
}

/** The supplier's answer to a send plan. */
export async function respondPlan(planId: unknown, status: unknown): Promise<ActionResult> {
  const plan = id(planId);
  if (!plan || (status !== "accepted" && status !== "in_production" && status !== "ready")) return NOT_ALLOWED;
  return step("supplier_plan_respond", { p_plan: plan, p_status: status }, "save your answer", "Answer saved. VRPRIME has been told.", true);
}

/** VRPRIME cancels a plan that has not become a dispatch. */
export async function cancelPlan(planId: unknown): Promise<ActionResult> {
  const denied = await staff();
  if (denied) return denied;
  const plan = id(planId);
  if (!plan) return NOT_ALLOWED;
  const db = await supplierDb();
  const { error } = await db.rpc("supplier_plan_cancel", { p_plan: plan });
  if (error) return failed(error, "cancel the plan");
  refresh();
  return { ok: true, message: "Plan cancelled. Rajesh has been told." };
}

/**
 * Deletes a send plan for good, whatever its status (VRPRIME's owner and admin only). A dispatch made from it stays; if
 * it was still to be made, the supplier's owner is told to stop.
 */
export async function deletePlan(planId: unknown): Promise<ActionResult> {
  const denied = await staff();
  if (denied) return denied;
  const plan = id(planId);
  if (!plan) return NOT_ALLOWED;
  const db = await supplierDb();
  const { error } = await db.rpc("supplier_plan_delete", { p_plan: plan });
  if (error) return failed(error, "delete the plan");
  refresh();
  return { ok: true, message: "Send plan deleted for good" };
}

/** Turns a send plan into a dispatch with exactly its lines; its labels are then printed. Returns the dispatch's id. */
export async function planToDispatch(planId: unknown): Promise<ActionResult<string>> {
  const who = await actor();
  if (!who) return NOT_SIGNED_IN;
  if (who.scanner) return NOT_ALLOWED;
  const plan = id(planId);
  if (!plan) return NOT_ALLOWED;
  const db = await supplierDb();
  const { data, error } = await db.rpc("supplier_plan_to_dispatch", { p_plan: plan });
  if (error) return failed(error, "make the dispatch");
  refresh();
  return { ok: true, message: "Dispatch made. Its labels are being printed.", data: data as string };
}

// ---- Product photos: VRPRIME owner and admin -----------------------------------------------------------------------------

/** Puts an uploaded photo file on a master SKU, replacing (and removing) the one before. */
export async function setMasterPhoto(code: unknown, path: unknown): Promise<ActionResult> {
  const denied = await staff();
  if (denied) return denied;
  if (typeof code !== "string" || !code.trim() || code.length > 200 || typeof path !== "string" || !PHOTO_FILE.test(path)) return NOT_ALLOWED;
  const db = await supplierDb();
  const { data, error } = await db.rpc("master_photo_set", { p_code: code, p_path: path });
  if (error) {
    await db.storage.from("product-photos").remove([path]);
    return failed(error, "save the photo");
  }
  if (typeof data === "string" && PHOTO_FILE.test(data)) {
    const { error: removeError } = await db.storage.from("product-photos").remove([data]);
    if (removeError) logError("old product photo", removeError);
  }
  refresh();
  return { ok: true, message: "Photo saved" };
}

/** Takes a master SKU's photo away (and its file). */
export async function removeMasterPhoto(code: unknown): Promise<ActionResult> {
  const denied = await staff();
  if (denied) return denied;
  if (typeof code !== "string" || !code.trim() || code.length > 200) return NOT_ALLOWED;
  const db = await supplierDb();
  const { data, error } = await db.rpc("master_photo_remove", { p_code: code });
  if (error) return failed(error, "remove the photo");
  if (typeof data === "string" && PHOTO_FILE.test(data)) {
    const { error: removeError } = await db.storage.from("product-photos").remove([data]);
    if (removeError) logError("removed product photo", removeError);
  }
  refresh();
  return { ok: true, message: "Photo removed" };
}

// ---- Pieces in a carton ----------------------------------------------------------------------------------------------------

/**
 * Gives labels not loaded yet a new pieces count and carton weight (kg; null for none given). The label shows both,
 * and the inventory software adds the pieces to stock when the carton is scanned in, so each carton changed gets a new
 * label and the old one becomes void.
 */
export async function repackCartons(cartonIds: unknown, units: unknown, weight: unknown = null): Promise<ActionResult> {
  const who = await actor();
  if (!who) return NOT_SIGNED_IN;
  const ids = z.array(UUID).min(1).max(500).safeParse(cartonIds);
  const n = z.number().int().min(1).max(100000).safeParse(units);
  const w = z.number().gt(0).max(1000).nullable().safeParse(weight);
  if (!ids.success) return NOT_ALLOWED;
  if (!n.success) return { ok: false, message: "Enter the pieces in the carton: a whole number from 1." };
  if (!w.success) return { ok: false, message: "Enter the carton weight in kg, above 0 (or leave it empty)." };
  const db = await supplierDb();
  const { data, error } = await db.rpc("supplier_cartons_repack", { p_cartons: ids.data, p_units: n.data, p_weight: w.data });
  if (error) return failed(error, "change the carton");
  refresh();
  const changed = Number(data ?? 0);
  const what = `${n.data} pieces${w.data ? ` and ${w.data} kg` : ""}`;
  return {
    ok: true,
    message: changed
      ? `${changed === 1 ? "A new label is" : `${changed} new labels are`} being made with ${what}. In a few seconds download ${changed === 1 ? "it" : "them"} and stick ${changed === 1 ? "it" : "them"} on the carton${changed === 1 ? "" : "s"} in place of the old one${changed === 1 ? "" : "s"}.`
      : `Already ${what}: nothing changed.`,
  };
}
