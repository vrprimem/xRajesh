import { istDay } from "./report.ts";
import { dispatchCounts, labelsOwed, type CartonType, type DispatchStatus } from "./supplier.ts";

// How the dispatch screens sort and explain dispatches: by stage, with the next thing to do, how the cartons are
// arriving at VRPRIME, and a dispatch's labels by product. Plain functions, so they are tested on their own.

export type Stage = "to_load" | "on_the_way" | "arrived" | "cancelled";

export function stageOf(status: DispatchStatus): Stage {
  if (status === "planned" || status === "loading") return "to_load";
  if (status === "closed") return "on_the_way";
  if (status === "received") return "arrived";
  return "cancelled";
}

/** After this many days on the road with cartons not yet scanned in at VRPRIME, a dispatch is flagged. */
export const ARRIVAL_DAYS = 3;

export type ListCarton = {
  product_id: string;
  carton_type: CartonType;
  status: "issued" | "loaded" | "void";
  units: number;
  void_reason: string | null;
  inbound_status: "received" | "rejected" | null;
  inbound_at: string | null;
};
export type ListLine = { product_id: string; product: string; carton_type: CartonType; cartons: number };
export type ListDispatch = {
  status: DispatchStatus;
  closed_at: string | null;
  received_at: string | null;
  vehicle_photo_path: string | null;
  lines: ListLine[];
  cartons: ListCarton[];
};

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export type Arrival = {
  /** Cartons loaded onto the vehicle. */
  loaded: number;
  /** Of those, scanned in at VRPRIME's warehouse. */
  arrived: number;
  rejected: number;
  /** Days on the road: so far while on the way, or until it was received. */
  days: number;
  /** On the way longer than ARRIVAL_DAYS with cartons still to arrive. */
  late: boolean;
};

/** How a sent dispatch is arriving at VRPRIME. Null while it is still being loaded, or when it was cancelled. */
export function arrivalOf(d: ListDispatch, today: string): Arrival | null {
  if (d.status !== "closed" && d.status !== "received") return null;
  const loaded = d.cartons.filter((c) => c.status === "loaded");
  const arrived = loaded.filter((c) => c.inbound_status === "received").length;
  const rejected = loaded.filter((c) => c.inbound_status === "rejected").length;
  const lastIn = loaded.map((c) => c.inbound_at).filter((t): t is string => !!t).sort().at(-1) ?? null;
  const end = d.status === "received" ? istDay(d.received_at ?? lastIn ?? new Date().toISOString()) : today;
  const onRoad = d.closed_at ? Math.max(0, days(istDay(d.closed_at), end)) : 0;
  return { loaded: loaded.length, arrived, rejected, days: onRoad, late: d.status === "closed" && arrived + rejected < loaded.length && onRoad > ARRIVAL_DAYS };
}

export type Who = "owner" | "scanner" | "vrprime";
export type NextStep = { label: string; to: "scan" | "page" };

/**
 * The one thing to do next on a dispatch, for this person: scan while labels are left, then the vehicle photo, then
 * close; VRPRIME marks a dispatch received if its cartons will not be scanned in. Null when there is nothing to do.
 */
export function nextStep(d: ListDispatch, who: Who): NextStep | null {
  const stage = stageOf(d.status);
  if (stage === "on_the_way") return who === "vrprime" ? { label: "Mark received", to: "page" } : null;
  if (stage !== "to_load" || who === "vrprime") return null;
  const c = dispatchCounts(d.lines, d.cartons);
  if (c.left > 0) return { label: "Scan cartons", to: "scan" };
  if (labelsOwed(d.lines, d.cartons) > 0 || c.loaded === 0) return null;
  if (!d.vehicle_photo_path) return { label: "Add vehicle photo", to: "page" };
  return { label: "Close dispatch", to: "page" };
}

/** Kilograms: what the cartons with a known weight weigh in all, and how many cartons have no weight. */
export type Kg = { kg: number; unweighed: number };

const kgOf = (w: number | string | null | undefined): number => {
  const n = Number(w);
  return w !== null && w !== undefined && Number.isFinite(n) && n > 0 ? n : 0;
};
const tenth = (n: number) => Math.round(n * 10) / 10;

/** What a dispatch's planned cartons weigh, by each line's carton weight. */
export function plannedKg(lines: { cartons: number; weight_per_carton?: number | null }[]): Kg {
  let kg = 0;
  let unweighed = 0;
  for (const l of lines) {
    const w = kgOf(l.weight_per_carton);
    if (w) kg += l.cartons * w;
    else unweighed += l.cartons;
  }
  return { kg: tenth(kg), unweighed };
}

/** What the loaded cartons weigh, by the weight on each label. */
export function loadedKg(cartons: { status: "issued" | "loaded" | "void"; weight_per_carton?: number | null }[]): Kg {
  let kg = 0;
  let unweighed = 0;
  for (const c of cartons) {
    if (c.status !== "loaded") continue;
    const w = kgOf(c.weight_per_carton);
    if (w) kg += w;
    else unweighed += 1;
  }
  return { kg: tenth(kg), unweighed };
}

/** A dispatch's products, their cartons and weight (a product on two lines counted once), most cartons first. */
export function productCartons(lines: (ListLine & { weight_per_carton?: number | null })[]): ({ product_id: string; product: string; cartons: number } & Kg)[] {
  const by = new Map<string, { product_id: string; product: string; cartons: number } & Kg>();
  for (const l of lines) {
    const p = by.get(l.product_id) ?? { product_id: l.product_id, product: l.product, cartons: 0, kg: 0, unweighed: 0 };
    const w = plannedKg([l]);
    p.cartons += l.cartons;
    p.kg = tenth(p.kg + w.kg);
    p.unweighed += w.unweighed;
    by.set(l.product_id, p);
  }
  return [...by.values()].sort((a, b) => b.cartons - a.cartons || a.product.localeCompare(b.product));
}

type GroupLabel = { product_id: string; product: string; status: "issued" | "loaded" | "void"; carton_no: number; inbound_status: "received" | "rejected" | null };

export type LabelGroup<C extends GroupLabel> = {
  product_id: string;
  product: string;
  planned: number;
  loaded: number;
  toScan: number;
  voided: number;
  arrived: number;
  /** Still to scan first, then loaded, then void; each by carton number. */
  labels: C[];
};

const ORDER = { issued: 0, loaded: 1, void: 2 } as const;

// ---- Label downloads in parts ------------------------------------------------------------------------------------------

/** The VRPRIME inventory software makes at most this many labels of a product at a time. */
export const LABELS_PER_PRINT = 50;

type PartLabel = { product_id: string; product: string; carton_no: number; status: "issued" | "loaded" | "void" };

/** The labels a download holds: while the dispatch is being loaded the ones still to scan, after that every label that is not void. */
export function labelsToDownload<C extends { status: "issued" | "loaded" | "void" }>(cartons: C[], open: boolean): C[] {
  return cartons.filter((c) => (open ? c.status === "issued" : c.status !== "void"));
}

export type PartProduct = { product_id: string; product: string; from: number; to: number; of: number };
export type LabelPart<C> = { part: number; labels: C[]; products: PartProduct[] };

/**
 * Labels to download in parts, the way the inventory software makes them: at most 50 of a product at a time. Part 1
 * holds the first 50 labels of every product, part 2 each product's 51st to 100th, and so on, each part in carton order.
 * With no product over 50 there is one part: every label.
 */
export function labelParts<C extends PartLabel>(labels: C[]): LabelPart<C>[] {
  const byProduct = new Map<string, C[]>();
  for (const l of [...labels].sort((a, b) => a.carton_no - b.carton_no)) {
    const list = byProduct.get(l.product_id);
    if (list) list.push(l);
    else byProduct.set(l.product_id, [l]);
  }
  const count = Math.max(0, ...[...byProduct.values()].map((list) => Math.ceil(list.length / LABELS_PER_PRINT)));
  const parts: LabelPart<C>[] = [];
  for (let k = 0; k < count; k++) {
    const part: LabelPart<C> = { part: k + 1, labels: [], products: [] };
    for (const [product_id, list] of byProduct) {
      const slice = list.slice(k * LABELS_PER_PRINT, (k + 1) * LABELS_PER_PRINT);
      if (!slice.length) continue;
      part.labels.push(...slice);
      part.products.push({ product_id, product: list[0].product, from: k * LABELS_PER_PRINT + 1, to: k * LABELS_PER_PRINT + slice.length, of: list.length });
    }
    part.labels.sort((a, b) => a.carton_no - b.carton_no);
    parts.push(part);
  }
  return parts;
}

/** What a part holds, in words: "Old Rat 1 to 50 of 60, and all labels of the other 8 products". */
export function partSummary(part: { products: PartProduct[] }): string {
  const split = part.products.filter((p) => p.of > LABELS_PER_PRINT);
  const whole = part.products.filter((p) => p.of <= LABELS_PER_PRINT);
  const pieces = split.map((p) => `${p.product} ${p.from} to ${p.to} of ${p.of}`);
  if (whole.length === 1) pieces.push(`${whole[0].of === 1 ? "the 1 label" : `all ${whole[0].of} labels`} of ${whole[0].product}`);
  else if (whole.length > 1) pieces.push(`all labels of ${split.length ? "the other " : ""}${whole.length} products`);
  if (pieces.length < 2) return pieces[0] ?? "";
  return `${pieces.slice(0, -1).join(", ")} and ${pieces.at(-1)}`;
}

/** Carton numbers as short runs: [1, 2, 3, 7, 9, 10] is "1–3, 7, 9–10". After `max` runs the rest is "…". */
export function cartonRanges(numbers: number[], max = 4): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    runs.push(i === j ? `${sorted[i]}` : `${sorted[i]}–${sorted[j]}`);
    i = j;
  }
  return runs.length > max ? `${runs.slice(0, max).join(", ")}, …` : runs.join(", ");
}

/** A dispatch's labels by product, with what is loaded of what was planned. */
export function labelGroups<C extends GroupLabel>(lines: { product_id: string; product: string; cartons: number }[], cartons: C[]): LabelGroup<C>[] {
  const groups = new Map<string, LabelGroup<C>>();
  const group = (p: string, product: string) => {
    let g = groups.get(p);
    if (!g) {
      g = { product_id: p, product, planned: 0, loaded: 0, toScan: 0, voided: 0, arrived: 0, labels: [] };
      groups.set(p, g);
    }
    return g;
  };
  for (const l of lines) group(l.product_id, l.product).planned += l.cartons;
  for (const c of cartons) {
    const g = group(c.product_id, c.product);
    g.labels.push(c);
    if (c.status === "loaded") g.loaded += 1;
    else if (c.status === "issued") g.toScan += 1;
    else g.voided += 1;
    if (c.inbound_status === "received") g.arrived += 1;
  }
  for (const g of groups.values()) g.labels.sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.carton_no - b.carton_no);
  return [...groups.values()];
}
