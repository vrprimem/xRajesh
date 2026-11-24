import { addDays, todayIST } from "@/lib/format";
import { averageRates, costSheet, monthMoney } from "@/lib/money";
import { dailyOutput, planTimeline, supplyDaysLeft, type PlanNeed } from "@/lib/production";
import type { Cost, ItemMove, ItemStock, Payment, ProductionEntry, Purchase, ReadyRow, RecipeLine, VendorBalance } from "@/lib/supplies";

// Made-up supplies, production and money for the development preview (/dev/supplier). Nothing here is real.

const iid = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
const vid = (n: number) => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, "0")}`;
const pid = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

export function factorySample(plans: PlanNeed[]) {
  const today = todayIST();
  const month = today.slice(0, 7);
  const d = (n: number) => addDays(today, -n);

  const items: ItemStock[] = [
    { id: iid(1), name: "Bottle 500ml white", kind: "bottle", unit: "pcs", low_level: 1000, active: true, on_hand: 4200 },
    { id: iid(2), name: "Trigger 28mm white", kind: "trigger", unit: "pcs", low_level: 1000, active: true, on_hand: 640 },
    { id: iid(3), name: "Bottle 300ml", kind: "bottle", unit: "pcs", low_level: 500, active: true, on_hand: 2900 },
    { id: iid(4), name: "Kitchen cleaner chemical", kind: "chemical", unit: "litre", low_level: 200, active: true, on_hand: 1180.5 },
    { id: iid(5), name: "Repellent chemical", kind: "chemical", unit: "litre", low_level: 100, active: true, on_hand: 260 },
    { id: iid(6), name: "Front label kitchen", kind: "label", unit: "pcs", low_level: null, active: true, on_hand: 6000 },
    { id: iid(7), name: "Hard carton 24", kind: "carton_hard", unit: "pcs", low_level: 50, active: true, on_hand: 210 },
    { id: iid(8), name: "2-ply carton 48", kind: "carton_2ply", unit: "pcs", low_level: 50, active: true, on_hand: 35 },
    { id: iid(9), name: "Packing tape", kind: "packing", unit: "metre", low_level: null, active: true, on_hand: 1500 },
  ];

  const recipes: RecipeLine[] = [
    { product_id: pid(1), item_id: iid(1), qty: 1, per: "unit" },
    { product_id: pid(1), item_id: iid(2), qty: 1, per: "unit" },
    { product_id: pid(1), item_id: iid(4), qty: 0.5, per: "unit" },
    { product_id: pid(1), item_id: iid(6), qty: 1, per: "unit" },
    { product_id: pid(1), item_id: iid(7), qty: 1, per: "carton" },
    { product_id: pid(1), item_id: iid(9), qty: 2.5, per: "carton" },
    { product_id: pid(2), item_id: iid(3), qty: 1, per: "unit" },
    { product_id: pid(2), item_id: iid(5), qty: 0.3, per: "unit" },
    { product_id: pid(2), item_id: iid(8), qty: 1, per: "carton" },
  ];

  // Two weeks of production; nothing on the Sundays-ish gaps.
  const made: [number, number, number][] = [
    [0, 1, 480], [1, 1, 1200], [1, 2, 600], [2, 2, 900], [3, 1, 1150], [5, 1, 960], [5, 2, 480], [6, 1, 1200], [7, 2, 960],
    [8, 1, 1080], [9, 1, 720], [9, 2, 480], [10, 2, 864], [12, 1, 1200], [13, 2, 720],
  ];
  const entries: ProductionEntry[] = made.map(([ago, p, units], i) => ({ id: `e${i}`, product_id: pid(p), made_on: d(ago), units, note: i === 2 ? "night shift" : null, created_at: `${d(ago)}T12:00:00Z` }));

  const ready: ReadyRow[] = [
    { product_id: pid(1), name: "Kitchen Cleaner Spray 500ml", units_per_carton: 24, daily_capacity: 1200, active: true, ready: 1320, made_7d: 4990, made_30d: 7990, days_30d: 8, last_made_on: d(0) },
    { product_id: pid(2), name: "Rat Repellent Spray 300ml", units_per_carton: 48, daily_capacity: 900, active: true, ready: 288, made_7d: 1980, made_30d: 5004, days_30d: 7, last_made_on: d(1) },
    { product_id: pid(3), name: "Lizard Repellent Spray 250ml", units_per_carton: 60, daily_capacity: null, active: true, ready: -60, made_7d: 0, made_30d: 0, days_30d: 0, last_made_on: null },
    { product_id: pid(4), name: "Scratch Remover Bottle 150ml", units_per_carton: 110, daily_capacity: 2000, active: false, ready: 0, made_7d: 0, made_30d: 0, days_30d: 0, last_made_on: null },
  ];

  const moves: ItemMove[] = [
    ...entries.flatMap((e, i) =>
      recipes
        .filter((r) => r.product_id === e.product_id)
        .map((r, j) => ({ id: 1000 + i * 10 + j, item_id: r.item_id, qty: -(r.per === "carton" ? (r.qty * e.units) / (e.product_id === pid(1) ? 24 : 48) : r.qty * e.units), reason: "production" as const, note: null, moved_on: e.made_on })),
    ),
    { id: 1, item_id: iid(1), qty: 5000, reason: "purchase" as const, note: null, moved_on: d(4) },
    { id: 2, item_id: iid(4), qty: 1000, reason: "purchase" as const, note: null, moved_on: d(6) },
    { id: 3, item_id: iid(7), qty: -6, reason: "count" as const, note: "6 damaged" as string | null, moved_on: d(2) },
  ].sort((a, b) => b.moved_on.localeCompare(a.moved_on) || b.id - a.id);

  const vendors: VendorBalance[] = [
    { id: vid(1), name: "Shree Plastics", phone: "98200 12345", active: true, bought: 61360, paid: 40000, due: 21360 },
    { id: vid(2), name: "Bhiwandi Chemicals", phone: null, active: true, bought: 59000, paid: 59000, due: 0 },
    { id: vid(3), name: "Om Cartons", phone: "98190 55555", active: true, bought: 9440, paid: 10000, due: -560 },
  ];
  const purchases: Purchase[] = [
    { id: "pu1", vendor_id: vid(1), item_id: iid(1), bought_on: d(4), qty: 5000, rate: 4.2, gst_pct: 18, amount: 24780, bill_no: "SP-1182", received_on: d(4), note: null },
    { id: "pu2", vendor_id: vid(2), item_id: iid(4), bought_on: d(6), qty: 1000, rate: 50, gst_pct: 18, amount: 59000, bill_no: null, received_on: d(6), note: null },
    { id: "pu3", vendor_id: vid(1), item_id: iid(2), bought_on: d(1), qty: 10000, rate: 3.1, gst_pct: 18, amount: 36580, bill_no: "SP-1190", received_on: null, note: null },
    { id: "pu4", vendor_id: vid(3), item_id: iid(7), bought_on: d(9), qty: 400, rate: 20, gst_pct: 18, amount: 9440, bill_no: null, received_on: d(8), note: null },
  ];
  const payments: Payment[] = [
    { id: "pa1", vendor_id: vid(1), paid_on: d(3), amount: 40000, mode: "upi", reference: "UTR 4410", note: null },
    { id: "pa2", vendor_id: vid(2), paid_on: d(5), amount: 59000, mode: "bank", reference: null, note: "full bill" },
    { id: "pa3", vendor_id: vid(3), paid_on: d(8), amount: 10000, mode: "cash", reference: null, note: null },
  ];
  const costs: Cost[] = [
    { id: "co1", spent_on: d(0), kind: "labour", qty: 6, rate: 550, amount: 3300, note: null },
    { id: "co2", spent_on: d(1), kind: "labour", qty: 6, rate: 550, amount: 3300, note: null },
    { id: "co3", spent_on: d(1), kind: "hamali", qty: 120, rate: 4, amount: 480, note: "unloading bottles" },
    { id: "co4", spent_on: d(3), kind: "electricity", qty: null, rate: null, amount: 4200, note: null },
    { id: "co5", spent_on: d(6), kind: "transport", qty: 2, rate: 1500, amount: 3000, note: "tempo to Bhiwandi" },
  ];
  const inMonth = <T,>(rows: T[], day: (r: T) => string) => rows.filter((r) => day(r).slice(0, 7) === month);
  const money = {
    vendors,
    purchases: inMonth(purchases, (p) => p.bought_on),
    payments: inMonth(payments, (p) => p.paid_on),
    costs: inMonth(costs, (c) => c.spent_on),
    onOrder: purchases.filter((p) => !p.received_on),
    priced: purchases,
  };
  const totals = monthMoney(money.purchases, money.payments, money.costs);
  const madeInMonth = new Map<string, number>();
  for (const e of entries) if (e.made_on.slice(0, 7) === month) madeInMonth.set(e.product_id, (madeInMonth.get(e.product_id) ?? 0) + e.units);
  const sheet = costSheet(
    ready.map((r) => ({ id: r.product_id, name: r.name, units_per_carton: r.units_per_carton, active: r.active })),
    recipes,
    averageRates(purchases),
    new Map(items.map((i) => [i.id, i.name])),
    madeInMonth,
    totals.costsTotal,
  );

  return {
    today,
    month,
    items,
    moves,
    daysLeft: Object.fromEntries(supplyDaysLeft(items, moves, today, 30)),
    recipes,
    entries,
    ready,
    days: dailyOutput(entries, today, 14),
    estimates: planTimeline(plans, ready, recipes, items, today),
    money,
    totals,
    sheet,
  };
}
