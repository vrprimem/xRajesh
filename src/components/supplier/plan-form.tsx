"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { WithPhoto } from "@/components/supplier/product-photo";
import { useToast } from "@/components/toast";
import { Card, Chip, Field, buttonClass } from "@/components/ui";
import { formatNumber, noun } from "@/lib/format";
import { cartonsFor, suggestedUnits } from "@/lib/supplier";
import { createPlan } from "@/server/actions/supplier";
import type { StockRow } from "@/server/supplier-data";

/** Cartons this product should get in a plan: what Produce now would suggest, in whole cartons; 0 when it is fine. */
function suggestedCartons(r: StockRow): number {
  if (r.stock_units === null || r.min_units === null) return 0;
  return cartonsFor(suggestedUnits(r.stock_units, r.in_transit_units, r.min_units, r.units_per_carton), r.units_per_carton);
}

/**
 * A send plan: for each of the supplier's products (those with a master SKU), what VRPRIME holds, what is on the way,
 * the minimum, and how many cartons to send. Pre-filled from what is running low. Units typed are rounded up to whole
 * cartons, so the plan is always in round cartons.
 */
export function PlanForm({ supplierId, supplierName, rows, defaultDue, back, photos = {} }: { supplierId: string; supplierName: string; rows: StockRow[]; defaultDue: string; back: string; photos?: Record<string, string> }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const products = useMemo(() => rows.filter((r) => r.active && r.master_code), [rows]);
  const [due, setDue] = useState(defaultDue);
  const [note, setNote] = useState("");
  const [cartons, setCartons] = useState<Record<string, string>>(() => Object.fromEntries(products.map((r) => [r.product_id, suggestedCartons(r) ? String(suggestedCartons(r)) : ""])));
  const [query, setQuery] = useState("");
  const [problem, setProblem] = useState("");

  const n = (id: string) => {
    const v = Number(cartons[id]);
    return Number.isInteger(v) && v > 0 ? v : 0;
  };
  const chosen = products.filter((r) => n(r.product_id) > 0);
  const total = chosen.reduce((s, r) => ({ cartons: s.cartons + n(r.product_id), units: s.units + n(r.product_id) * r.units_per_carton }), { cartons: 0, units: 0 });
  const shown = products.filter((r) => !query.trim() || r.name.toLowerCase().includes(query.trim().toLowerCase()) || (r.master_code ?? "").toLowerCase().includes(query.trim().toLowerCase()));
  const hidden = rows.filter((r) => r.active && !r.master_code).length;

  const submit = () => {
    if (!chosen.length) return setProblem("Enter cartons for at least one product.");
    setProblem("");
    startTransition(async () => {
      const result = await createPlan(supplierId, { due, note, lines: chosen.map((r) => ({ product_id: r.product_id, cartons: n(r.product_id) })) });
      if (toast.result(result)) router.push(back);
      else setProblem(result.message);
    });
  };

  if (!products.length) {
    return (
      <Card className="g-pad">
        <p className="t-card-title">No products ready for a plan</p>
        <p className="t-caption mt-1">A product needs its VRPRIME master SKU before it can be planned. Set them on {supplierName}&apos;s Products page.</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="g-pad">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Send by" htmlFor="pl-due" required hint={`The date ${supplierName} should send these to VRPRIME.`}>
            <input id="pl-due" type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label="Note" htmlFor="pl-note" hint="Anything Rajesh should know, for example a priority.">
            <input id="pl-note" className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card className="ledger-card">
        <div className="g-pad flex flex-wrap items-center justify-between gap-2 pb-2">
          <div>
            <p className="t-card-title">What to send</p>
            <p className="t-caption mt-0.5">Whole cartons only. Filled in from what is running low; change any number. Type units and they round up to full cartons.</p>
          </div>
          <input className="input max-w-[240px]" type="search" placeholder="Find a product" aria-label="Find a product" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <table className="ledger">
          <thead>
            <tr>
              <th scope="col" className="min-w-[170px]">Product</th>
              <th scope="col" className="num">At VRPRIME</th>
              <th scope="col" className="num">On the way</th>
              <th scope="col" className="num">Minimum</th>
              <th scope="col" className="num">Units</th>
              <th scope="col" className="num">Cartons</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const c = n(r.product_id);
              const low = r.min_units !== null && r.stock_units !== null && r.stock_units + r.in_transit_units < r.min_units;
              return (
                <tr key={r.product_id}>
                  <th scope="row" className="text-left font-semibold">
                    <WithPhoto src={photos[r.product_id]} name={r.name}>
                      {r.name}
                      <span className="ml-1 font-normal text-muted">{r.units_per_carton}/carton</span>
                      {low ? (
                        <span className="ml-2">
                          <Chip tone="bad">Low</Chip>
                        </span>
                      ) : null}
                    </WithPhoto>
                  </th>
                  <td className="num tabular-nums">{r.stock_units === null ? "-" : formatNumber(r.stock_units)}</td>
                  <td className="num tabular-nums">{formatNumber(r.in_transit_units)}</td>
                  <td className="num tabular-nums">{r.min_units === null ? "-" : formatNumber(r.min_units)}</td>
                  <td className="num">
                    <input
                      className="input !min-h-9 w-24 !py-1 text-right tabular-nums"
                      inputMode="numeric"
                      aria-label={`Units of ${r.name}, rounded up to cartons`}
                      placeholder="units"
                      key={`u-${r.product_id}-${c}`}
                      defaultValue={c ? String(c * r.units_per_carton) : ""}
                      onBlur={(e) => {
                        const units = Number(e.target.value.replace(/\D/g, ""));
                        setCartons((m) => ({ ...m, [r.product_id]: units > 0 ? String(cartonsFor(units, r.units_per_carton)) : "" }));
                      }}
                    />
                  </td>
                  <td className="num">
                    <input
                      className="input !min-h-9 w-20 !py-1 text-right font-semibold tabular-nums"
                      inputMode="numeric"
                      aria-label={`Cartons of ${r.name}`}
                      value={cartons[r.product_id] ?? ""}
                      onChange={(e) => setCartons((m) => ({ ...m, [r.product_id]: e.target.value.replace(/\D/g, "") }))}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {hidden ? <p className="t-caption g-pad pt-2">{hidden} active products are not listed: they have no VRPRIME master SKU yet.</p> : null}
      </Card>

      <Card className="g-pad">
        <p className="text-[15px]">
          <span className="font-semibold tabular-nums">{formatNumber(total.cartons)}</span> {noun(total.cartons, "carton")} of {chosen.length} {chosen.length === 1 ? "product" : "products"} ·{" "}
          <span className="tabular-nums">{formatNumber(total.units)}</span> {noun(total.units, "unit")}
        </p>
        {problem ? <p className="t-caption mt-1 font-semibold text-bad">{problem}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={pending} onClick={submit} className={buttonClass("primary")}>
            {pending ? "Sending..." : `Send the plan to ${supplierName}`}
          </button>
          <button type="button" disabled={pending} onClick={() => router.push(back)} className={buttonClass("outline")}>
            Cancel
          </button>
        </div>
      </Card>
    </div>
  );
}
