"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { LinesEditor, checkLines, freshLine, type Line, type OnDispatch } from "@/components/supplier/dispatch-form";
import { useToast } from "@/components/toast";
import { Card, SectionHead, buttonClass } from "@/components/ui";
import { addDispatchProducts } from "@/server/actions/supplier";
import type { LineRow, ProductRow } from "@/server/supplier-data";

/**
 * More products for a dispatch still being loaded: a product that was missed, or more cartons of one on it (those keep
 * its line's pieces and weight, as its labels show). Their labels are made by the inventory software as usual.
 */
export function AddProducts({ dispatchId, products, lines, photos }: { dispatchId: string; products: ProductRow[]; lines: LineRow[]; photos: Record<string, string> }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<Line[] | null>(null);
  const [problem, setProblem] = useState("");
  const active = products.filter((p) => p.active);
  const existing = new Map<string, OnDispatch>();
  for (const l of lines) {
    const on = existing.get(l.product_id);
    if (on) on.cartons += l.cartons;
    else existing.set(l.product_id, { cartons: l.cartons, units: l.units_per_carton, weight: l.weight_per_carton });
  }
  if (!active.length) return null;

  const start = () => {
    const p = active.find((a) => !existing.has(a.id)) ?? active[0];
    setProblem("");
    setRows([freshLine(p, 1, existing.get(p.id))]);
  };
  const submit = () => {
    if (!rows) return;
    const checked = checkLines(rows, existing);
    if ("problem" in checked) return setProblem(checked.problem);
    setProblem("");
    startTransition(async () => {
      const result = await addDispatchProducts(dispatchId, checked.clean);
      if (!toast.result(result)) {
        if (!result.ok) setProblem(result.message);
        return;
      }
      setRows(null);
      router.refresh();
      // The new labels arrive from the inventory software a few seconds later.
      window.setTimeout(() => router.refresh(), 6000);
    });
  };

  return (
    <Card className="g-pad">
      <SectionHead title="Add products" sub="Missed a product, or packed more cartons? Add them here. Their labels are made by the VRPRIME inventory software, as for the rest." />
      {rows ? (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <LinesEditor products={active} photos={photos} lines={rows} onChange={setRows} existing={existing} totalLabel="Adding" />
          {problem ? <p className="t-caption font-semibold text-bad">{problem}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={pending} className={buttonClass("primary")}>
              {pending ? "Adding..." : "Add and make labels"}
            </button>
            <button type="button" disabled={pending} onClick={() => (setRows(null), setProblem(""))} className={buttonClass("outline")}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={start} className={buttonClass("outline")}>
          Add products
        </button>
      )}
    </Card>
  );
}
