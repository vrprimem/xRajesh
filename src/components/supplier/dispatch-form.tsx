"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ProductPhoto } from "@/components/supplier/product-photo";
import { useToast } from "@/components/toast";
import { Card, Field, buttonClass } from "@/components/ui";
import { formatNumber, noun } from "@/lib/format";
import { cartonWeightFor } from "@/lib/supplier";
import { createDispatch } from "@/server/actions/supplier";
import type { ProductRow } from "@/server/supplier-data";

/** One line of the form. `weightSet`: the weight was typed in, so it no longer follows the pieces. */
type Line = { key: number; product_id: string; cartons: string; units: string; weight: string; weightSet: boolean };

const whole = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN);
const kg = (v: string) => {
  const t = v.trim().replace(",", ".");
  return /^\d+(\.\d{1,3})?$/.test(t) ? Number(t) : NaN;
};
const fresh = (p: ProductRow, key: number): Line => ({
  key,
  product_id: p.id,
  cartons: "",
  units: String(p.units_per_carton),
  weight: p.weight_per_carton ? String(p.weight_per_carton) : "",
  weightSet: false,
});

/**
 * A new dispatch plan: the date, and products with the number of cartons, pieces per carton and carton weight
 * (the product's, unless the boxes hold a different count or weigh differently this time: the weight follows the
 * pieces until one is typed in). Saving it issues exactly one label per carton, printed with its pieces and weight.
 * `base` is where dispatches live for this person (/supplier/dispatches, or VRPRIME's own page).
 */
export function DispatchForm({ supplierId, products, base, tomorrow, photos = {} }: { supplierId: string; products: ProductRow[]; base: string; tomorrow: string; photos?: Record<string, string> }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const active = products.filter((p) => p.active);
  const first = active[0];
  const [due, setDue] = useState(tomorrow);
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>(first ? [fresh(first, 1)] : []);
  const [nextKey, setNextKey] = useState(2);
  const [problem, setProblem] = useState("");

  const byId = new Map(active.map((p) => [p.id, p]));
  const set = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const setPieces = (l: Line, units: string) => {
    const p = byId.get(l.product_id);
    if (l.weightSet || !p) return set(l.key, { units });
    const w = cartonWeightFor(p.weight_per_carton, p.units_per_carton, whole(units));
    set(l.key, { units, weight: w === null ? "" : String(w) });
  };
  const totals = lines.reduce(
    (t, l) => {
      const n = Number(l.cartons);
      if (Number.isInteger(n) && n > 0) {
        t.cartons += n;
        t.units += n * (whole(l.units) || 0);
        const w = kg(l.weight);
        if (w > 0) t.kg += n * w;
        else t.unweighed += n;
      }
      return t;
    },
    { cartons: 0, units: 0, kg: 0, unweighed: 0 },
  );

  const submit = () => {
    const clean = lines.map((l) => ({
      product_id: l.product_id,
      cartons: Number(l.cartons),
      units_per_carton: whole(l.units),
      weight_per_carton: l.weight.trim() ? kg(l.weight) : undefined,
    }));
    if (!clean.length) return setProblem("Add at least one product.");
    if (clean.some((l) => !Number.isInteger(l.cartons) || l.cartons < 1)) return setProblem("Every line needs a number of cartons, from 1.");
    if (clean.some((l) => !(l.units_per_carton >= 1 && l.units_per_carton <= 100000))) return setProblem("Every line needs its pieces per carton, a whole number from 1.");
    if (clean.some((l) => l.weight_per_carton !== undefined && !(l.weight_per_carton > 0 && l.weight_per_carton <= 1000))) return setProblem("A carton weight is in kg, above 0, for example 8.5. Or leave it empty.");
    const seen = new Map<string, string>();
    for (const l of clean) {
      const what = `${l.units_per_carton}:${l.weight_per_carton ?? ""}`;
      if (seen.has(l.product_id) && seen.get(l.product_id) !== what) return setProblem("A product is on two lines with other pieces or weight. Keep one line; change single cartons on the dispatch page once the labels are made.");
      seen.set(l.product_id, what);
    }
    setProblem("");
    startTransition(async () => {
      const result = await createDispatch(supplierId, { due, note, lines: clean });
      if (toast.result(result) && result.ok && result.data) router.push(`${base}/${result.data}`);
      else if (!result.ok) setProblem(result.message);
    });
  };

  if (!first) {
    return (
      <Card className="g-pad">
        <p className="t-card-title">No active products</p>
        <p className="t-caption mt-1">Add products first; a dispatch plan is made from them.</p>
      </Card>
    );
  }

  return (
    <Card className="g-pad">
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Dispatch date" htmlFor="sd-due" required>
            <input id="sd-due" type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label="Note" htmlFor="sd-note" hint="Vehicle, driver or anything VRPRIME should know.">
            <input id="sd-note" className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-[15px] font-semibold">Products and cartons</p>
          {lines.map((l, i) => {
            const p = byId.get(l.product_id);
            const n = Number(l.cartons);
            const pieces = whole(l.units);
            const w = kg(l.weight);
            return (
              <div key={l.key} className="grid grid-cols-2 items-end gap-2 rounded-[12px] border border-line-soft p-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
                <label className="col-span-2 flex flex-col gap-1 text-[14px] text-muted sm:col-span-1">
                  Product
                  <span className="flex items-center gap-2">
                    <ProductPhoto src={photos[l.product_id]} name={p?.name ?? "the product"} size={48} />
                    <select
                      className="input min-w-0 flex-1"
                      aria-label={`Product, line ${i + 1}`}
                      value={l.product_id}
                      onChange={(e) => {
                        const next = byId.get(e.target.value);
                        if (next) set(l.key, { ...fresh(next, l.key), cartons: l.cartons });
                      }}
                    >
                      {active.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({a.units_per_carton}/carton)
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
                <label className="flex flex-col gap-1 text-[14px] text-muted">
                  Cartons
                  <input className="input" inputMode="numeric" aria-label={`Cartons, line ${i + 1}`} value={l.cartons} onChange={(e) => set(l.key, { cartons: e.target.value.replace(/\D/g, "") })} />
                </label>
                <label className="flex flex-col gap-1 text-[14px] text-muted">
                  Pieces per carton
                  <input className="input" inputMode="numeric" aria-label={`Pieces per carton, line ${i + 1}`} value={l.units} onChange={(e) => setPieces(l, e.target.value.replace(/\D/g, ""))} />
                </label>
                <label className="flex flex-col gap-1 text-[14px] text-muted">
                  Carton weight (kg)
                  <input
                    className="input"
                    inputMode="decimal"
                    placeholder="e.g. 8.5"
                    aria-label={`Carton weight in kg, line ${i + 1}`}
                    value={l.weight}
                    onChange={(e) => set(l.key, { weight: e.target.value.replace(/[^\d.,]/g, ""), weightSet: true })}
                  />
                </label>
                <button type="button" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className={buttonClass("ghost", "justify-self-end")}>
                  Remove
                </button>
                {p && Number.isInteger(n) && n > 0 && pieces > 0 ? (
                  <p className="t-caption col-span-full">
                    {formatNumber(n * pieces)} {noun(n * pieces, "unit")}
                    {w > 0 ? ` · ${formatNumber(Math.round(n * w * 10) / 10)} kg in all` : " · no carton weight"}
                    {pieces !== p.units_per_carton
                      ? ` · ${pieces} pieces a carton this time (usually ${p.units_per_carton})${!l.weightSet && w > 0 ? `: weight worked out from ${p.weight_per_carton} kg for ${p.units_per_carton}, check it on the scale` : ""}`
                      : ""}
                  </p>
                ) : null}
              </div>
            );
          })}
          <div>
            <button
              type="button"
              onClick={() => {
                setLines((ls) => [...ls, fresh(first, nextKey)]);
                setNextKey((k) => k + 1);
              }}
              className={buttonClass("outline")}
            >
              Add another product
            </button>
          </div>
        </div>

        <p className="text-[15px]">
          Total: <span className="font-semibold tabular-nums">{formatNumber(totals.cartons)}</span> {noun(totals.cartons, "carton")} ·{" "}
          <span className="tabular-nums">{formatNumber(totals.units)}</span> {noun(totals.units, "unit")}
          {totals.kg > 0 ? (
            <>
              {" "}
              · <span className="tabular-nums">{formatNumber(Math.round(totals.kg * 10) / 10)}</span> kg{totals.unweighed ? ` (and ${totals.unweighed} ${noun(totals.unweighed, "carton")} with no weight)` : ""}
            </>
          ) : null}
          . One label is issued per carton, printed with its pieces and weight.
        </p>
        {problem ? <p className="t-caption font-semibold text-bad">{problem}</p> : null}
        <div className="flex gap-2">
          <button type="submit" disabled={pending} className={buttonClass("primary")}>
            {pending ? "Creating..." : "Create dispatch and labels"}
          </button>
          <button type="button" disabled={pending} onClick={() => router.push(base)} className={buttonClass("outline")}>
            Cancel
          </button>
        </div>
      </form>
    </Card>
  );
}
