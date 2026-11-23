import "server-only";
import { addDays, todayIST } from "@/lib/format";
import { dailyOutput, planTimeline, type PlanEstimate } from "@/lib/production";
import type { ItemStock, ProductionEntry, ReadyRow, RecipeLine } from "@/lib/supplies";
import { loadPlans } from "@/server/supplier-data";
import { loadItemStock, loadProduction, loadReadyStock, loadRecipes } from "@/server/supplies-data";

export type ProductionView = {
  installed: boolean;
  today: string;
  ready: ReadyRow[];
  /** The last 30 days' entries, newest first. */
  entries: ProductionEntry[];
  recipes: RecipeLine[];
  items: ItemStock[];
  /** Units made each of the last 14 days, oldest first. */
  days: { day: string; units: number }[];
  estimates: PlanEstimate[];
};

/** Everything the production screens show, for the supplier and for VRPRIME. No prices. */
export async function loadProductionView(supplierId: string): Promise<ProductionView> {
  const today = todayIST();
  const [ready, entries, recipes, stock, plans] = await Promise.all([
    loadReadyStock(supplierId),
    loadProduction(supplierId, addDays(today, -29)),
    loadRecipes(supplierId),
    loadItemStock(supplierId),
    loadPlans(supplierId, true, 50),
  ]);
  const needs = plans.map((p) => ({ id: p.id, number: p.number, due_on: p.due_on, lines: p.lines.map((l) => ({ product_id: l.product_id, product: l.product, units_per_carton: l.units_per_carton, cartons: l.cartons })) }));
  return {
    installed: ready.installed && stock.installed,
    today,
    ready: ready.rows,
    entries,
    recipes,
    items: stock.items,
    days: dailyOutput(entries, today, 14),
    estimates: planTimeline(needs, ready.rows, recipes, stock.items, today),
  };
}
