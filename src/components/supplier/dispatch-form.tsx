"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ProductPhoto } from "@/components/supplier/product-photo";
import { useToast } from "@/components/toast";
import { Card, Field, buttonClass } from "@/components/ui";
import { formatNumber, noun } from "@/lib/format";
import { CARTON_TYPE_LABEL, type CartonType } from "@/lib/supplier";
import { createDispatch } from "@/server/actions/supplier";
import type { ProductRow } from "@/server/supplier-data";

type Line = { key: number; product_id: string; carton_type: CartonType; cartons: string };

/**
 * A new dispatch plan: the date, and products with carton type and number of cartons. Saving it issues exactly one
 * label per carton. `base` is where dispatches live for this person (/supplier/dispatches, or VRPRIME's own page).
 */
export function DispatchForm({ supplierId, products, base, tomorrow, photos = {} }: { supplierId: string; products: ProductRow[]; base: string; tomorrow: string; photos?: Record<string, string> }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const active = products.filter((p) => p.active);
  const first = active[0];
  const [due, setDue] = useState(tomorrow);
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>(first ? [{ key: 1, product_id: first.id, carton_type: first.carton_type, cartons: "" }] : []);
  const [nextKey, setNextKey] = useState(2);
  const [problem, setProblem] = useState("");

  const byId = new Map(active.map((p) => [p.id, p]));
  const set = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const totals = lines.reduce(
    (t, l) => {
      const n = Number(l.cartons);
      if (Number.isInteger(n) && n > 0) {
        t[l.carton_type] += n;
        t.units += n * (byId.get(l.product_id)?.units_per_carton ?? 0);
      }
      return t;
    },
    { H: 0, T: 0, units: 0 },
  );

  const submit = () => {
    const clean = lines.map((l) => ({ product_id: l.product_id, carton_type: l.carton_type, cartons: Number(l.cartons) }));
    if (!clean.length) return setProblem("Add at least one product.");
    if (clean.some((l) => !Number.isInteger(l.cartons) || l.cartons < 1)) return setProblem("Every line needs a number of cartons, from 1.");
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
            return (
              <div key={l.key} className="grid grid-cols-[1fr_auto] items-end gap-2 rounded-[12px] border border-line-soft p-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
                <label className="col-span-2 flex flex-col gap-1 text-[14px] text-muted sm:col-span-1">
                  Product
                  <span className="flex items-center gap-2">
                  <ProductPhoto src={photos[l.product_id]} name={p?.name ?? "the product"} size={48} />
                  <select
                    className="input min-w-0 flex-1"
                    aria-label={`Product, line ${i + 1}`}
                    value={l.product_id}
                    onChange={(e) => set(l.key, { product_id: e.target.value, carton_type: byId.get(e.target.value)?.carton_type ?? l.carton_type })}
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
                  Carton type
                  <select className="input" aria-label={`Carton type, line ${i + 1}`} value={l.carton_type} onChange={(e) => set(l.key, { carton_type: e.target.value as CartonType })}>
                    <option value="H">Hard</option>
                    <option value="T">2-ply</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-[14px] text-muted">
                  Cartons
                  <input className="input" inputMode="numeric" aria-label={`Cartons, line ${i + 1}`} value={l.cartons} onChange={(e) => set(l.key, { cartons: e.target.value.replace(/\D/g, "") })} />
                </label>
                <button type="button" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className={buttonClass("ghost")}>
                  Remove
                </button>
                {p && Number.isInteger(n) && n > 0 ? (
                  <p className="t-caption col-span-full">
                    {formatNumber(n * p.units_per_carton)} {noun(n * p.units_per_carton, "unit")}
                    {p.weight_per_carton ? ` · ${formatNumber(Math.round(n * p.weight_per_carton))} kg` : " · no carton weight set"}
                  </p>
                ) : null}
              </div>
            );
          })}
          <div>
            <button
              type="button"
              onClick={() => {
                setLines((ls) => [...ls, { key: nextKey, product_id: first.id, carton_type: first.carton_type, cartons: "" }]);
                setNextKey((k) => k + 1);
              }}
              className={buttonClass("outline")}
            >
              Add another product
            </button>
          </div>
        </div>

        <p className="text-[15px]">
          Total: <span className="font-semibold tabular-nums">{formatNumber(totals.H + totals.T)}</span> {noun(totals.H + totals.T, "carton")} ({formatNumber(totals.H)} {CARTON_TYPE_LABEL.H}, {formatNumber(totals.T)} {CARTON_TYPE_LABEL.T}) ·{" "}
          <span className="tabular-nums">{formatNumber(totals.units)}</span> {noun(totals.units, "unit")}. One label is issued per carton.
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
