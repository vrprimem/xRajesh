"use client";

import { useMemo, useState, useTransition } from "react";
import { FormButtons } from "@/components/supplier/entry-kit";
import { useToast } from "@/components/toast";
import { Card, Chip, EmptyState, Field, SectionHead, buttonClass } from "@/components/ui";
import { formatDate, formatNumber } from "@/lib/format";
import { formatQty, isLow, ITEM_KIND_LABEL, ITEM_KINDS, ITEM_UNITS, MOVE_REASON_LABEL, readNumber, UNIT_LABEL, UNIT_SHORT, type ItemKind, type ItemMove, type ItemStock, type ItemUnit } from "@/lib/supplies";
import { countItem, saveItem } from "@/server/actions/supplies";

type Form = { id: string | null; name: string; kind: ItemKind; unit: ItemUnit; low: string; active: boolean };
const NEW: Form = { id: null, name: "", kind: "bottle", unit: "pcs", low: "", active: true };

const lastsText = (days: number | null) => (days === null ? "not used lately" : days < 1 ? "lasts under a day" : `lasts ${formatNumber(Math.floor(days))} ${Math.floor(days) === 1 ? "day" : "days"}`);

/**
 * The supplier's supplies (bottles, triggers, caps, chemicals, labels, cartons, packing) and their stock: bought and
 * received adds, production takes by the recipes, a count sets it. No prices here: the warehouse person and VRPRIME see
 * this page too. `canEdit`: add and change supplies; `canCount`: count stock.
 */
export function SuppliesPanel({ supplierId, items, moves, daysLeft, canEdit, canCount }: { supplierId: string; items: ItemStock[]; moves: ItemMove[]; daysLeft: Record<string, number | null>; canEdit: boolean; canCount: boolean }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [counting, setCounting] = useState<string | null>(null);
  const [counted, setCounted] = useState("");
  const [countError, setCountError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const low = items.filter((i) => i.active && isLow(i));
  const shown = items.filter((i) => showAll || i.active);

  const submit = () => {
    if (!form) return;
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Enter a name";
    const lowLevel = form.low.trim() ? readNumber(form.low) : null;
    if (form.low.trim() && lowLevel === null) e.low = "A number, or leave it empty";
    setErrors(e);
    if (Object.keys(e).length) return;
    startTransition(async () => {
      const result = await saveItem(supplierId, { id: form.id, name: form.name, kind: form.kind, unit: form.unit, low_level: lowLevel, active: form.active });
      if (toast.result(result)) setForm(null);
      else if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
    });
  };

  const saveCount = (item: ItemStock) => {
    const n = readNumber(counted);
    if (n === null) return setCountError(`Enter what you counted, in ${UNIT_LABEL[item.unit].toLowerCase()}`);
    startTransition(async () => {
      const result = await countItem(item.id, n, "");
      if (toast.result(result)) setCounting(null);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => (setForm({ ...NEW }), setErrors({}))} className={buttonClass("primary")}>
            Add a supply
          </button>
        </div>
      ) : null}

      {form ? (
        <Card className="g-pad">
          <form
            noValidate
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <p className="t-card-title">{form.id ? `Edit ${form.name}` : "Add a supply"}</p>
            <div className="grid gap-4 min-[700px]:grid-cols-2">
              <Field label="Name" htmlFor="si-name" required error={errors.name} hint="As you call it, e.g. Trigger 28mm white">
                <input id="si-name" className="input" maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="Kind" htmlFor="si-kind" required>
                <select id="si-kind" className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as ItemKind, unit: e.target.value === "chemical" && form.unit === "pcs" ? "litre" : form.unit })}>
                  {ITEM_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {ITEM_KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Counted in" htmlFor="si-unit" required>
                <select id="si-unit" className="input" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value as ItemUnit })}>
                  {ITEM_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {UNIT_LABEL[u]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Low at" htmlFor="si-low" error={errors.low} hint="Shown as low at or under this.">
                <input id="si-low" className="input" inputMode="decimal" placeholder="e.g. 500" value={form.low} onChange={(e) => setForm({ ...form, low: e.target.value })} />
              </Field>
            </div>
            {form.id ? (
              <label className="flex items-center gap-2 text-[15px]">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                In use (shown in the lists)
              </label>
            ) : null}
            <FormButtons pending={pending} onCancel={() => setForm(null)} />
          </form>
        </Card>
      ) : null}

      {low.length ? (
        <div className="tone-row tone-bad">
          <p className="tone-row-title w-full">Running low</p>
          <p className="w-full text-[15px]">{low.map((i) => `${i.name} (${formatQty(i.on_hand, i.unit)})`).join(", ")}</p>
        </div>
      ) : null}

      {items.length === 0 ? (
        <EmptyState title="No supplies yet" body={canEdit ? "Add what you buy to make your products: bottles, triggers, caps, chemicals, labels and cartons." : "The owner has not added any supplies yet."} />
      ) : (
        <Card className="g-pad">
          <SectionHead
            title="Stock"
            sub="Bought and received adds; production takes what its recipe uses; a count sets it. How long it lasts is at the rate production used it over the last 30 days."
            action={
              items.some((i) => !i.active) ? (
                <button type="button" onClick={() => setShowAll(!showAll)} className={buttonClass("row")}>
                  {showAll ? "Hide unused" : "Show unused"}
                </button>
              ) : undefined
            }
          />
          <ul className="divide-y divide-line-soft">
            {shown.map((i) => (
              <li key={i.id} className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 ${i.active ? "" : "opacity-60"}`}>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    {i.name}
                    {isLow(i) ? <Chip tone="bad">Low</Chip> : null}
                    {i.active ? null : <span className="font-normal text-muted">not in use</span>}
                  </p>
                  <p className="t-caption">
                    {ITEM_KIND_LABEL[i.kind]}
                    {i.low_level !== null ? ` · low at ${formatQty(i.low_level, i.unit)}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[18px] font-bold tabular-nums">{formatQty(i.on_hand, i.unit)}</p>
                  <p className="t-caption">{lastsText(daysLeft[i.id] ?? null)}</p>
                </div>
                {(canCount || canEdit) && counting !== i.id ? (
                  <div className="flex w-full justify-end gap-2 min-[700px]:w-auto">
                    {canCount ? (
                      <button type="button" onClick={() => (setCounting(i.id), setCounted(""), setCountError(""))} className={buttonClass("row")}>
                        Count
                      </button>
                    ) : null}
                    {canEdit ? (
                      <button type="button" onClick={() => (setForm({ id: i.id, name: i.name, kind: i.kind, unit: i.unit, low: i.low_level === null ? "" : String(i.low_level), active: i.active }), setErrors({}))} className={buttonClass("row")}>
                        Edit
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {counting === i.id ? (
                  <form
                    noValidate
                    className="flex w-full flex-wrap items-center justify-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      saveCount(i);
                    }}
                  >
                    <label className="text-[15px] font-semibold" htmlFor={`ic-${i.id}`}>
                      Counted
                    </label>
                    <div className="relative">
                      <input id={`ic-${i.id}`} autoFocus className="input w-36 pr-10" inputMode="decimal" value={counted} onChange={(e) => (setCounted(e.target.value), setCountError(""))} />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[14px] text-muted">{UNIT_SHORT[i.unit]}</span>
                    </div>
                    <button type="submit" disabled={pending} className={buttonClass("primary", "g-btn-row")}>
                      Save
                    </button>
                    <button type="button" onClick={() => setCounting(null)} className={buttonClass("row")}>
                      Cancel
                    </button>
                    {countError ? <span className="w-full text-right text-[14px] font-semibold text-bad">{countError}</span> : null}
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {moves.length ? (
        <Card className="g-pad">
          <SectionHead title="Stock changes" sub="The last 30 days, newest first." />
          <ul className="divide-y divide-line-soft">
            {moves.slice(0, 200).map((m) => {
              const it = byId.get(m.item_id);
              return (
                <li key={m.id} className="flex items-center justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <p className="font-semibold">{it?.name ?? "Supply"}</p>
                    <p className="t-caption">
                      {formatDate(m.moved_on)} · {MOVE_REASON_LABEL[m.reason]}
                      {m.note ? ` · ${m.note}` : ""}
                    </p>
                  </div>
                  <p className={`shrink-0 text-right font-bold tabular-nums ${m.qty < 0 ? "text-bad" : "text-ok"}`}>
                    {m.qty > 0 ? "+" : "−"}
                    {it ? formatQty(Math.abs(m.qty), it.unit) : formatNumber(Math.abs(m.qty))}
                  </p>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
