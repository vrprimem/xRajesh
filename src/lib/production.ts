import { addDays } from "./format.ts";
import type { ItemMove, ItemStock, ItemUnit, ReadyRow, RecipeLine } from "./supplies.ts";

// How much the supplier makes, and so how soon goods can be ready. Both sides see this: the supplier, and VRPRIME
// planning what to ask for. Nothing here has a price.

/** Units made on each of the last `days` days, oldest first, today included; a day with nothing made is 0. */
export function dailyOutput(entries: { made_on: string; units: number }[], today: string, days: number): { day: string; units: number }[] {
  const byDay = new Map<string, number>();
  for (const e of entries) byDay.set(e.made_on, (byDay.get(e.made_on) ?? 0) + e.units);
  return Array.from({ length: days }, (_, i) => {
    const day = addDays(today, i - days + 1);
    return { day, units: byDay.get(day) ?? 0 };
  });
}

export type Pace = { perDay: number; basis: "made" | "capacity" };

/**
 * Units of a product made in a day: the average over the days it was made in the last 30 days; failing that, the daily
 * capacity set on the product; else unknown.
 */
export function paceOf(row: Pick<ReadyRow, "made_30d" | "days_30d" | "daily_capacity">): Pace | null {
  if (row.days_30d > 0 && row.made_30d > 0) return { perDay: row.made_30d / row.days_30d, basis: "made" };
  if (row.daily_capacity && row.daily_capacity > 0) return { perDay: row.daily_capacity, basis: "capacity" };
  return null;
}

export type PlanNeed = {
  id: string;
  number: number;
  due_on: string;
  lines: { product_id: string; product: string; units_per_carton: number; cartons: number }[];
};

export type LineEstimate = { product_id: string; product: string; units: number; fromStock: number; toMake: number; days: number | null };
export type SupplyShort = { item_id: string; name: string; unit: ItemUnit; need: number; have: number };

export type PlanEstimate = {
  id: string;
  number: number;
  due_on: string;
  lines: LineEstimate[];
  /** Units still to make for this plan. */
  toMake: number;
  /** Production days this plan needs; null when a product has no pace. */
  days: number | null;
  /** The day it should be ready, making the plans in due order from today; null when that cannot be known. */
  readyBy: string | null;
  late: boolean;
  /** Products whose pace is not known: never made in the last 30 days and no daily capacity set. */
  unknown: string[];
  /** The number of an earlier plan whose time is not known: this one waits behind it. */
  after: number | null;
  /** Supplies that run out for this plan, after the plans before it. */
  short: SupplyShort[];
};

/**
 * When each open send plan can be ready. Plans are made in due order, one product at a time, at each product's pace,
 * starting today. Goods already made (ready stock) go to the earliest plans first; a plan that needs nothing made is
 * ready today. Supplies are taken by the recipes in the same order, to show what has to be bought.
 */
export function planTimeline(plans: PlanNeed[], ready: ReadyRow[], recipes: RecipeLine[], supplies: ItemStock[], today: string): PlanEstimate[] {
  const rows = new Map(ready.map((r) => [r.product_id, r]));
  const stock = new Map(ready.map((r) => [r.product_id, Math.max(0, r.ready)]));
  const left = new Map(supplies.map((s) => [s.id, s.on_hand]));
  const items = new Map(supplies.map((s) => [s.id, s]));
  let booked = 0;
  let blockedBy: number | null = null;

  return [...plans]
    .sort((a, b) => a.due_on.localeCompare(b.due_on) || a.number - b.number)
    .map((plan): PlanEstimate => {
      const unknown: string[] = [];
      const need = new Map<string, number>();
      const lines = plan.lines.map((l): LineEstimate => {
        const units = l.cartons * l.units_per_carton;
        const fromStock = Math.min(stock.get(l.product_id) ?? 0, units);
        stock.set(l.product_id, (stock.get(l.product_id) ?? 0) - fromStock);
        const toMake = units - fromStock;
        const row = rows.get(l.product_id);
        const pace = row ? paceOf(row) : null;
        if (toMake > 0 && !pace) unknown.push(l.product);
        for (const r of recipes) {
          if (r.product_id !== l.product_id || toMake === 0) continue;
          const per = r.per === "carton" ? r.qty / (row?.units_per_carton ?? l.units_per_carton) : r.qty;
          need.set(r.item_id, (need.get(r.item_id) ?? 0) + toMake * per);
        }
        return { product_id: l.product_id, product: l.product, units, fromStock, toMake, days: toMake === 0 ? 0 : pace ? toMake / pace.perDay : null };
      });

      const short: SupplyShort[] = [];
      for (const [itemId, qty] of need) {
        const have = left.get(itemId) ?? 0;
        const item = items.get(itemId);
        if (item && qty > have + 1e-9) short.push({ item_id: itemId, name: item.name, unit: item.unit, need: qty, have: Math.max(0, have) });
        left.set(itemId, have - qty);
      }

      const toMake = lines.reduce((sum, l) => sum + l.toMake, 0);
      const days = unknown.length ? null : lines.reduce((sum, l) => sum + (l.days ?? 0), 0);
      let readyBy: string | null = null;
      let after: number | null = null;
      if (toMake === 0) readyBy = today;
      else if (days !== null && blockedBy === null) {
        booked += days;
        readyBy = addDays(today, Math.ceil(booked - 1e-9));
      } else if (days !== null) after = blockedBy;
      if (toMake > 0 && days === null && blockedBy === null) blockedBy = plan.number;

      return {
        id: plan.id,
        number: plan.number,
        due_on: plan.due_on,
        lines,
        toMake,
        days,
        readyBy,
        late: readyBy !== null && readyBy > plan.due_on,
        unknown,
        after,
        short: short.sort((a, b) => a.name.localeCompare(b.name)),
      };
    });
}

/**
 * How long each supply lasts at the rate production used it over the last `days` days: its stock over its average use
 * a day. Null when it was not used in that time.
 */
export function supplyDaysLeft(supplies: Pick<ItemStock, "id" | "on_hand">[], moves: Pick<ItemMove, "item_id" | "qty" | "reason" | "moved_on">[], today: string, days = 30): Map<string, number | null> {
  const from = addDays(today, -days + 1);
  const used = new Map<string, number>();
  for (const m of moves) {
    if (m.reason !== "production" || m.moved_on < from || m.moved_on > today) continue;
    used.set(m.item_id, (used.get(m.item_id) ?? 0) - m.qty);
  }
  return new Map(
    supplies.map((s) => {
      const perDay = (used.get(s.id) ?? 0) / days;
      return [s.id, perDay > 0 ? Math.max(0, s.on_hand) / perDay : null];
    }),
  );
}
