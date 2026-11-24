import "server-only";
import { PHOTO_FILE, photoSrc } from "@/lib/photos";
import { logError } from "@/lib/redact";
import { createClient } from "@/lib/supabase/server";
import type { CartonType, DispatchStatus, ProduceStatus, ProductCategory } from "@/lib/supplier";

// What the supplier portal reads. Every query runs as the signed-in person, so the database decides what comes back:
// a supplier login gets its own supplier's rows, VRPRIME owner and admin get any supplier's.

// The tables are newer than the generated types.
type Loose = { from: (table: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => any; storage: Awaited<ReturnType<typeof createClient>>["storage"] }; // eslint-disable-line @typescript-eslint/no-explicit-any
type DbErr = { code?: string; message?: string } | null;

export const supplierDb = async (): Promise<Loose> => (await createClient()) as unknown as Loose;

/** The portal's tables are not there yet: the migrations have not been applied to this database. */
export const notInstalled = (e: DbErr) => !!e && (e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST202" || /does not exist|schema cache/i.test(e.message ?? ""));

export type Supplier = { id: string; name: string; warehouse_id: string; active: boolean };
export type Warehouse = { id: string; name: string };
export type SyncState = { last_try_at: string | null; last_ok_at: string | null; last_error: string | null; last_products: number | null };
export type ProductRow = {
  id: string;
  name: string;
  master_id: string | null;
  master_code: string | null;
  category: ProductCategory;
  units_per_carton: number;
  daily_capacity: number | null;
  active: boolean;
  weight_per_carton: number | null;
};
export type StockRow = {
  product_id: string;
  name: string;
  master_code: string | null;
  units_per_carton: number;
  active: boolean;
  stock_units: number | null;
  in_transit_units: number;
  min_units: number | null;
  synced_at: string | null;
};
export type DispatchRow = {
  id: string;
  supplier_id: string;
  number: number;
  status: DispatchStatus;
  due_on: string;
  note: string | null;
  vehicle_photo_path: string | null;
  created_at: string;
  closed_at: string | null;
  received_at: string | null;
  /** Set while the labels are being asked for from the inventory software. */
  labels_run_at: string | null;
  /** Why the last try to get labels stopped, if it did. */
  labels_error: string | null;
};
export type LineRow = { product_id: string; product: string; carton_type: CartonType; units_per_carton: number; cartons: number; weight_per_carton: number | null };
export type CartonRow = {
  id: string;
  product_id: string;
  product: string;
  carton_type: CartonType;
  units: number;
  carton_no: number;
  barcode: string;
  status: "issued" | "loaded" | "void";
  loaded_at: string | null;
  void_reason: string | null;
  /** Carton weight in kg, as sent to the inventory software with the label. */
  weight_per_carton: number | null;
  /** Scanned in at VRPRIME's warehouse, as the inventory software shows it. */
  inbound_status: "received" | "rejected" | null;
};
export type ProduceRow = {
  id: string;
  product_id: string;
  product: string;
  status: ProduceStatus;
  stock_units: number;
  in_transit_units: number;
  min_units: number;
  suggested_units: number;
  raised_at: string;
  responded_at: string | null;
};

const soft = <T,>(what: string, error: DbErr, data: T | null, fallback: T): T => {
  if (error && !notInstalled(error)) logError(`supplier ${what}`, error);
  return data ?? fallback;
};

/** Every supplier the signed-in person may see (one, for a supplier login). `installed` is false before the migrations. */
export async function loadSuppliers(): Promise<{ suppliers: Supplier[]; installed: boolean }> {
  const db = await supplierDb();
  const { data, error } = await db.from("suppliers").select("id, name, warehouse_id, active").order("name");
  if (notInstalled(error)) return { suppliers: [], installed: false };
  return { suppliers: soft("suppliers", error, data as Supplier[] | null, []), installed: true };
}

/** VRPRIME’s warehouses, as the inventory software lists them (VRPRIME owner and admin only). */
export async function loadWarehouses(): Promise<Warehouse[]> {
  const db = await supplierDb();
  const { data, error } = await db.from("warehouses").select("id, name").order("name");
  return soft("warehouses", error, data as Warehouse[] | null, []);
}

/** When stock was last read from the inventory software, and whether the last try failed. */
export async function loadSyncState(): Promise<SyncState | null> {
  const db = await supplierDb();
  const { data } = await db.from("inventory_sync_state").select("last_try_at, last_ok_at, last_error, last_products").maybeSingle();
  return (data as SyncState | null) ?? null;
}

export type ReportData = { dispatches: { id: string; number: number; status: string; closed_at: string }[]; cartons: { dispatch_id: string; product_id: string; units: number; inbound_status: string | null }[]; names: Map<string, string> };

/** Dispatches closed in a month (India time) with their loaded cartons, for the carton report. */
export async function loadReport(supplierId: string, from: string, to: string): Promise<ReportData> {
  const db = await supplierDb();
  const { data, error } = await db
    .from("supplier_dispatches")
    .select("id, number, status, closed_at")
    .eq("supplier_id", supplierId)
    .in("status", ["closed", "received"])
    .gte("closed_at", from)
    .lt("closed_at", to)
    .order("closed_at")
    .limit(2000);
  const dispatches = soft("report dispatches", error, data as ReportData["dispatches"] | null, []);
  const [cartons, products] = await Promise.all([
    dispatches.length
      ? db.from("supplier_cartons").select("dispatch_id, product_id, units, inbound_status").in("dispatch_id", dispatches.map((d) => d.id)).eq("status", "loaded").limit(100000)
      : Promise.resolve({ data: [], error: null }),
    db.from("supplier_products").select("id, name").eq("supplier_id", supplierId).limit(5000),
  ]);
  return {
    dispatches,
    cartons: soft("report cartons", cartons.error, cartons.data as ReportData["cartons"] | null, []),
    names: new Map(((products.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name])),
  };
}

export type PlanLine = { product_id: string; product: string; carton_type: "H" | "T"; units_per_carton: number; cartons: number };
export type PlanRow = {
  id: string;
  number: number;
  due_on: string;
  note: string | null;
  status: import("@/lib/supplier").PlanStatus;
  dispatch_id: string | null;
  created_at: string;
  responded_at: string | null;
  lines: PlanLine[];
};

/** Send plans, newest first. `openOnly`: only those not yet made into a dispatch or cancelled. */
export async function loadPlans(supplierId: string, openOnly: boolean, limit = 30): Promise<PlanRow[]> {
  const db = await supplierDb();
  let q = db.from("supplier_send_plans").select("id, number, due_on, note, status, dispatch_id, created_at, responded_at").eq("supplier_id", supplierId);
  if (openOnly) q = q.in("status", ["open", "accepted", "in_production", "ready"]);
  const { data, error } = await q.order(openOnly ? "due_on" : "number", { ascending: openOnly }).limit(limit);
  const plans = soft("send plans", error, data as Omit<PlanRow, "lines">[] | null, []);
  if (!plans.length) return [];
  const [lines, products] = await Promise.all([
    db.from("supplier_send_plan_lines").select("plan_id, product_id, carton_type, units_per_carton, cartons").in("plan_id", plans.map((p) => p.id)).limit(10000),
    db.from("supplier_products").select("id, name").eq("supplier_id", supplierId).limit(5000),
  ]);
  const names = new Map<string, string>(((products.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  const rows = soft("send plan lines", lines.error, lines.data as (Omit<PlanLine, "product"> & { plan_id: string })[] | null, []);
  return plans.map((p) => ({
    ...p,
    lines: rows
      .filter((l) => l.plan_id === p.id)
      .map(({ plan_id: _plan, ...l }) => ({ ...l, product: names.get(l.product_id) ?? "Unknown product" })) // eslint-disable-line @typescript-eslint/no-unused-vars
      .sort((a, b) => a.product.localeCompare(b.product)),
  }));
}

export async function loadSupplier(id: string): Promise<Supplier | null> {
  const db = await supplierDb();
  const { data } = await db.from("suppliers").select("id, name, warehouse_id, active").eq("id", id).maybeSingle();
  return (data as Supplier | null) ?? null;
}

/** The supplier's products. The master SKU's code comes from the stock view: a supplier login cannot read master SKUs. */
export async function loadProducts(supplierId: string): Promise<ProductRow[]> {
  const db = await supplierDb();
  const [products, stock] = await Promise.all([
    db.from("supplier_products").select("id, name, master_id, category, units_per_carton, daily_capacity, active, weight_per_carton").eq("supplier_id", supplierId).order("name").limit(5000),
    db.rpc("supplier_stock", { p_supplier: supplierId }),
  ]);
  const codes = new Map<string, string | null>(((stock.data ?? []) as StockRow[]).map((s) => [s.product_id, s.master_code]));
  return soft("products", products.error, products.data as Omit<ProductRow, "master_code">[] | null, []).map((p) => ({ ...p, master_code: codes.get(p.id) ?? null }));
}

export async function loadStock(supplierId: string): Promise<StockRow[]> {
  const db = await supplierDb();
  const { data, error } = await db.rpc("supplier_stock", { p_supplier: supplierId });
  return soft("stock", error, data as StockRow[] | null, []);
}

export async function loadProduce(supplierId: string): Promise<ProduceRow[]> {
  const db = await supplierDb();
  const { data, error } = await db
    .from("supplier_produce_requests")
    .select("id, product_id, status, stock_units, in_transit_units, min_units, suggested_units, raised_at, responded_at, supplier_products(name)")
    .eq("supplier_id", supplierId)
    .neq("status", "cleared")
    .order("raised_at", { ascending: false })
    .limit(500);
  type Raw = Omit<ProduceRow, "product"> & { supplier_products: { name: string } | null };
  return soft("produce requests", error, data as Raw[] | null, []).map(({ supplier_products, ...r }) => ({ ...r, product: supplier_products?.name ?? "Unknown product" }));
}

export type CartonCount = {
  dispatch_id: string;
  product_id: string;
  carton_type: CartonType;
  status: CartonRow["status"];
  units: number;
  void_reason: string | null;
  inbound_status: "received" | "rejected" | null;
  inbound_at: string | null;
  weight_per_carton: number | null;
};
export type DispatchSummary = DispatchRow & { lines: { product_id: string; product: string; carton_type: CartonType; cartons: number; weight_per_carton: number | null }[]; cartons: CartonCount[] };

/** The newest dispatches with what is needed for their counts, their products, and how their cartons arrived. */
export async function loadDispatches(supplierId: string, limit = 40): Promise<DispatchSummary[]> {
  const db = await supplierDb();
  const { data, error } = await db
    .from("supplier_dispatches")
    .select("id, supplier_id, number, status, due_on, note, vehicle_photo_path, created_at, closed_at, received_at, labels_run_at, labels_error")
    .eq("supplier_id", supplierId)
    .order("number", { ascending: false })
    .limit(limit);
  const rows = soft("dispatches", error, data as DispatchRow[] | null, []);
  if (!rows.length) return [];
  const ids = rows.map((d) => d.id);
  const [lines, cartons, products] = await Promise.all([
    db.from("supplier_dispatch_lines").select("dispatch_id, product_id, carton_type, cartons, weight_per_carton").in("dispatch_id", ids).limit(10000),
    db.from("supplier_cartons").select("dispatch_id, product_id, carton_type, status, units, void_reason, inbound_status, inbound_at, weight_per_carton").in("dispatch_id", ids).limit(100000),
    db.from("supplier_products").select("id, name").eq("supplier_id", supplierId).limit(5000),
  ]);
  const names = new Map(((products.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  const lineRows = soft("dispatch lines", lines.error, lines.data as { dispatch_id: string; product_id: string; carton_type: CartonType; cartons: number; weight_per_carton: number | null }[] | null, []).map((l) => ({
    ...l,
    product: names.get(l.product_id) ?? "Unknown product",
  }));
  const cartonRows = soft("cartons", cartons.error, cartons.data as CartonCount[] | null, []);
  return rows.map((d) => ({ ...d, lines: lineRows.filter((l) => l.dispatch_id === d.id), cartons: cartonRows.filter((c) => c.dispatch_id === d.id) }));
}

/** The barcode pictures of these labels, as the inventory software sent them (only the labels page needs them). */
export async function loadLabelPictures(cartonIds: string[]): Promise<Map<string, string | null>> {
  if (!cartonIds.length) return new Map();
  const db = await supplierDb();
  const { data, error } = await db.from("supplier_cartons").select("id, label_svg").in("id", cartonIds).limit(1000);
  return new Map(soft("label pictures", error, data as { id: string; label_svg: string | null }[] | null, []).map((r) => [r.id, r.label_svg]));
}

export type DispatchDetail = { dispatch: DispatchRow; lines: LineRow[]; cartons: CartonRow[]; photoUrl: string | null };

/** One dispatch with its plan, every label and a link to the vehicle photo (good for an hour). Null if not visible. */
export async function loadDispatch(id: string): Promise<DispatchDetail | null> {
  const db = await supplierDb();
  const { data: dispatch } = await db
    .from("supplier_dispatches")
    .select("id, supplier_id, number, status, due_on, note, vehicle_photo_path, created_at, closed_at, received_at, labels_run_at, labels_error")
    .eq("id", id)
    .maybeSingle();
  if (!dispatch) return null;
  const d = dispatch as DispatchRow;
  const [lines, cartons, products] = await Promise.all([
    db.from("supplier_dispatch_lines").select("product_id, carton_type, units_per_carton, cartons, weight_per_carton").eq("dispatch_id", id).limit(1000),
    db.from("supplier_cartons").select("id, product_id, carton_type, units, carton_no, barcode, status, loaded_at, void_reason, inbound_status, weight_per_carton").eq("dispatch_id", id).order("carton_no").limit(20000),
    db.from("supplier_products").select("id, name").eq("supplier_id", d.supplier_id).limit(5000),
  ]);
  const names = new Map<string, string>(((products.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  const name = (pid: string) => names.get(pid) ?? "Unknown product";
  let photoUrl: string | null = null;
  if (d.vehicle_photo_path) {
    const signed = await db.storage.from("supplier-photos").createSignedUrl(d.vehicle_photo_path, 3600);
    photoUrl = signed.data?.signedUrl ?? null;
  }
  return {
    dispatch: d,
    lines: soft("dispatch lines", lines.error, lines.data as Omit<LineRow, "product">[] | null, []).map((l) => ({ ...l, product: name(l.product_id) })).sort((a, b) => a.product.localeCompare(b.product)),
    cartons: soft("cartons", cartons.error, cartons.data as Omit<CartonRow, "product">[] | null, []).map((c) => ({ ...c, product: name(c.product_id) })),
    photoUrl,
  };
}

/**
 * The photos of a supplier's products (each by its VRPRIME master SKU): product id -> the picture's address. Products
 * without a photo are left out. Empty before the photos migration is applied.
 */
export async function loadProductPhotos(supplierId: string): Promise<Record<string, string>> {
  const db = await supplierDb();
  const { data, error } = await db.rpc("supplier_product_photos", { p_supplier: supplierId });
  const rows = soft("product photos", error, data as { product_id: string; path: string }[] | null, []);
  return Object.fromEntries(rows.filter((r) => PHOTO_FILE.test(r.path)).map((r) => [r.product_id, photoSrc(r.path)]));
}
