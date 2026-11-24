import { COST_KINDS, paise, type Cost, type CostKind, type Payment, type Purchase, type RecipeLine } from "./supplies.ts";

// The supplier's money for a month, and what one unit of each product costs to make. Only the supplier's owner sees
// these (the database refuses everyone else); this file only adds up what it is given.

export type MonthMoney = {
  /** Supplies bought this month (with GST), received or not. */
  bought: number;
  /** Paid to vendors this month. */
  paid: number;
  costs: Record<CostKind, number>;
  /** Labour, hamali and the other costs. */
  costsTotal: number;
  /** What the month cost: supplies bought plus the other costs. */
  spend: number;
};

export function monthMoney(purchases: Pick<Purchase, "amount">[], payments: Pick<Payment, "amount">[], costs: Pick<Cost, "kind" | "amount">[]): MonthMoney {
  const byKind = Object.fromEntries(COST_KINDS.map((k) => [k, 0])) as Record<CostKind, number>;
  for (const c of costs) byKind[c.kind] = paise(byKind[c.kind] + c.amount);
  const bought = paise(purchases.reduce((sum, p) => sum + p.amount, 0));
  const costsTotal = paise(COST_KINDS.reduce((sum, k) => sum + byKind[k], 0));
  return { bought, paid: paise(payments.reduce((sum, p) => sum + p.amount, 0)), costs: byKind, costsTotal, spend: paise(bought + costsTotal) };
}

/** The amount of a purchase as the database works it out: quantity x rate, plus GST, to the paisa. */
export function purchaseAmount(qty: number, rate: number, gstPct: number): number {
  return paise(qty * rate * (1 + gstPct / 100));
}

/** What one unit (piece, litre, kg) of each supply has cost on average: all that was paid for it, GST included, over all that was bought. */
export function averageRates(purchases: Pick<Purchase, "item_id" | "qty" | "amount">[]): Map<string, number> {
  const sums = new Map<string, { qty: number; amount: number }>();
  for (const p of purchases) {
    const s = sums.get(p.item_id) ?? { qty: 0, amount: 0 };
    s.qty += p.qty;
    s.amount += p.amount;
    sums.set(p.item_id, s);
  }
  const rates = new Map<string, number>();
  for (const [id, s] of sums) if (s.qty > 0) rates.set(id, s.amount / s.qty);
  return rates;
}

export type UnitCost = {
  product_id: string;
  name: string;
  units_per_carton: number;
  /** Units made in the period. */
  made: number;
  /** The recipe's supplies at their average price (those with a price); null without a recipe. */
  supplies: number | null;
  /** Every supply in the recipe has a price, so the figures are whole; else they are at least this much. */
  complete: boolean;
  /** Supplies plus this period's labour, hamali and other costs spread over every unit made. */
  total: number | null;
  perCarton: number | null;
  /** Supplies in the recipe that were never bought here, so have no price. */
  unpriced: string[];
  noRecipe: boolean;
};

export type CostSheet = {
  rows: UnitCost[];
  /** Units of all products made in the period. */
  unitsMade: number;
  /** Labour, hamali and the other costs of the period, per unit made; null when nothing was made. */
  overheadPerUnit: number | null;
};

/**
 * What a unit of each product costs to make. Supplies: the product's recipe (per unit, or per carton shared by the units
 * in it) at each supply's average price; a supply never bought here has no price yet, and the figure is then a
 * minimum (`complete` false). Labour, hamali and the other costs of the period: shared equally by every unit
 * made in it, of every product. Products are those given (the active ones) plus any made in the period.
 */
export function costSheet(
  products: { id: string; name: string; units_per_carton: number; active: boolean }[],
  recipes: RecipeLine[],
  rates: Map<string, number>,
  itemNames: Map<string, string>,
  made: Map<string, number>,
  overheads: number,
): CostSheet {
  const unitsMade = [...made.values()].reduce((a, b) => a + b, 0);
  const overheadPerUnit = unitsMade > 0 ? overheads / unitsMade : null;
  const rows = products
    .filter((p) => p.active || (made.get(p.id) ?? 0) > 0)
    .map((p): UnitCost => {
      const lines = recipes.filter((r) => r.product_id === p.id);
      const unpriced: string[] = [];
      let supplies = 0;
      for (const l of lines) {
        const rate = rates.get(l.item_id);
        if (rate === undefined) unpriced.push(itemNames.get(l.item_id) ?? "A supply");
        else supplies += (l.per === "carton" ? l.qty / p.units_per_carton : l.qty) * rate;
      }
      const has = lines.length > 0;
      const total = has ? supplies + (overheadPerUnit ?? 0) : null;
      return {
        product_id: p.id,
        name: p.name,
        units_per_carton: p.units_per_carton,
        made: made.get(p.id) ?? 0,
        supplies: has ? supplies : null,
        complete: has && unpriced.length === 0,
        total,
        perCarton: total === null ? null : total * p.units_per_carton,
        unpriced,
        noRecipe: lines.length === 0,
      };
    })
    .sort((a, b) => b.made - a.made || a.name.localeCompare(b.name));
  return { rows, unitsMade, overheadPerUnit };
}
