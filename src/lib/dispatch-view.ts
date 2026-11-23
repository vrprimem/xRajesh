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

/** A dispatch's products and their cartons (a product on two lines counted once), most cartons first. */
export function productCartons(lines: ListLine[]): { product_id: string; product: string; cartons: number }[] {
  const by = new Map<string, { product_id: string; product: string; cartons: number }>();
  for (const l of lines) {
    const p = by.get(l.product_id) ?? { product_id: l.product_id, product: l.product, cartons: 0 };
    p.cartons += l.cartons;
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
