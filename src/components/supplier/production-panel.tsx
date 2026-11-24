"use client";

import { useMemo, useState, useTransition } from "react";
import { ConfirmButton, FormButtons } from "@/components/supplier/entry-kit";
import { useToast } from "@/components/toast";
import { Card, Chip, EmptyState, Field, SectionHead, buttonClass } from "@/components/ui";
import { addDays, formatDate, formatNumber } from "@/lib/format";
import { paceOf } from "@/lib/production";
import { boxesAndPieces, formatQty, perLitre, readNumber, UNIT_SHORT, type ItemStock, type ProductionEntry, type ReadyRow, type RecipeLine, type RecipePer } from "@/lib/supplies";
import { countReady, removeProduction, saveProduction, saveRecipe } from "@/server/actions/supplies";

type Product = Pick<ReadyRow, "product_id" | "name" | "units_per_carton" | "active">;

const whole = (text: string): number | null => {
  if (!text.trim()) return 0;
  const n = readNumber(text);
  return n !== null && Number.isInteger(n) ? n : null;
};

/** Enter what was made: the product, full boxes and loose pieces, and the day (today unless changed). */
export function ProductionForm({ products, today }: { products: Product[]; today: string }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const active = products.filter((p) => p.active);
  const [productId, setProductId] = useState(active[0]?.product_id ?? "");
  const [cartons, setCartons] = useState("");
  const [loose, setLoose] = useState("");
  const [day, setDay] = useState(today);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const product = active.find((p) => p.product_id === productId) ?? null;
  const c = whole(cartons);
  const l = whole(loose);
  const units = product && c !== null && l !== null ? c * product.units_per_carton + l : null;

  if (!active.length) return <EmptyState title="No products yet" body="Add your products first: production is entered for each product." />;

  const submit = () => {
    const e: Record<string, string> = {};
    if (!product) e.product = "Choose the product";
    if (c === null) e.cartons = "Whole boxes only";
    if (l === null) e.loose = "Whole pieces only";
    if (c !== null && l !== null && !(units && units > 0)) e.cartons = "Enter the boxes, the loose pieces or both";
    if (!day || day > today) e.day = "Today or a day before";
    setErrors(e);
    if (Object.keys(e).length || !units) return;
    startTransition(async () => {
      // The full boxes are the cartons used; the loose pieces are not in one yet.
      const result = await saveProduction({ product_id: productId, made_on: day, units, cartons: c ?? 0, note });
      if (toast.result(result)) {
        setCartons("");
        setLoose("");
        setNote("");
      } else if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
    });
  };

  return (
    <Card className="g-pad">
      <SectionHead title="Enter production" sub="What was made and packed. The supplies it used come off their stock by the product's recipe." />
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="grid gap-4 min-[700px]:grid-cols-2">
          <Field label="Product" htmlFor="pr-product" required error={errors.product}>
            <select id="pr-product" className="input" value={productId} onChange={(e) => setProductId(e.target.value)}>
              {active.map((p) => (
                <option key={p.product_id} value={p.product_id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Day made" htmlFor="pr-day" required error={errors.day}>
            <input id="pr-day" className="input" type="date" max={today} min={addDays(today, -60)} value={day} onChange={(e) => setDay(e.target.value)} />
          </Field>
          <Field label="Boxes" htmlFor="pr-cartons" error={errors.cartons} hint={product ? `1 box = ${formatNumber(product.units_per_carton)} pcs` : undefined}>
            <input id="pr-cartons" className="input" inputMode="numeric" placeholder="0" value={cartons} onChange={(e) => setCartons(e.target.value)} />
          </Field>
          <Field label="Loose pieces" htmlFor="pr-loose" error={errors.loose} hint="Made but not in a full box yet.">
            <input id="pr-loose" className="input" inputMode="numeric" placeholder="0" value={loose} onChange={(e) => setLoose(e.target.value)} />
          </Field>
        </div>
        <Field label="Note" htmlFor="pr-note">
          <input id="pr-note" className="input" maxLength={300} placeholder="e.g. night shift" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <p className="text-[17px]">
          Total: <b className="tabular-nums">{units ? formatNumber(units) : 0}</b> pcs{product && units ? ` (${boxesAndPieces(units, product.units_per_carton)})` : ""}
        </p>
        <FormButtons pending={pending} save="Save production" />
      </form>
    </Card>
  );
}

/** The last days' entries, newest day first, each day with its total; an entry made by mistake can be removed. */
export function ProductionLog({ entries, products, today, days = 14, canRemove }: { entries: ProductionEntry[]; products: Product[]; today: string; days?: number; canRemove: boolean }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const names = useMemo(() => new Map(products.map((p) => [p.product_id, p])), [products]);
  const from = addDays(today, -days + 1);
  const byDay = new Map<string, ProductionEntry[]>();
  for (const e of entries) if (e.made_on >= from) byDay.set(e.made_on, [...(byDay.get(e.made_on) ?? []), e]);
  const list = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  return (
    <Card className="g-pad">
      <SectionHead title="Entries" sub={`The last ${days} days.`} />
      {list.length === 0 ? (
        <p className="t-caption">Nothing entered in the last {days} days.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {list.map(([day, rows]) => (
            <section key={day}>
              <h3 className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-frame pb-1.5 text-[17px] font-bold">
                <span>{day === today ? "Today" : formatDate(day)}</span>
                <span className="tabular-nums">{formatNumber(rows.reduce((s, r) => s + r.units, 0))} pcs</span>
              </h3>
              <ul className="divide-y divide-line-soft">
                {rows.map((r) => {
                  const p = names.get(r.product_id);
                  return (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5">
                      <div className="min-w-0">
                        <p className="font-semibold">{p?.name ?? "Unknown product"}</p>
                        <p className="t-caption">
                          {p ? boxesAndPieces(r.units, p.units_per_carton) : `${formatNumber(r.units)} pcs`}
                          {p && r.units >= p.units_per_carton ? ` · ${formatNumber(r.units)} pcs` : ""}
                          {r.note ? ` · ${r.note}` : ""}
                        </p>
                      </div>
                      {canRemove ? (
                        <ConfirmButton
                          question="Remove this entry?"
                          disabled={pending}
                          onConfirm={() => startTransition(async () => void toast.result(await removeProduction(r.id)))}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Finished goods at the supplier's, by product, with how fast each is made; a count corrects the figure. */
export function ReadyStockTable({ rows, canCount }: { rows: ReadyRow[]; canCount: boolean }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [counting, setCounting] = useState<string | null>(null);
  const [countedBoxes, setCountedBoxes] = useState("");
  const [counted, setCounted] = useState("");
  const [error, setError] = useState("");
  const shown = rows.filter((r) => r.active || r.ready !== 0 || r.made_30d > 0);

  /** A count in full boxes and loose pieces: the ready stock becomes what was counted. */
  const save = (row: ReadyRow) => {
    const boxes = whole(countedBoxes);
    const loose = whole(counted);
    if (boxes === null || loose === null || (!countedBoxes.trim() && !counted.trim())) return setError("Enter the full boxes and the loose pieces you counted");
    startTransition(async () => {
      const result = await countReady(row.product_id, boxes * row.units_per_carton + loose, "");
      if (toast.result(result)) {
        setCounting(null);
        setCountedBoxes("");
        setCounted("");
      }
    });
  };

  return (
    <Card className="g-pad">
      <SectionHead title="Ready stock" sub="Made, minus what was loaded onto a truck since production was first entered here. Count it now and then to keep it right." />
      {shown.length === 0 ? (
        <p className="t-caption">No products yet.</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {shown.map((r) => {
            const pace = paceOf(r);
            return (
              <li key={r.product_id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    {r.name}
                    {r.ready < 0 ? <Chip tone="warn">Count it</Chip> : null}
                  </p>
                  <p className="t-caption">
                    {formatNumber(r.made_7d)} made in 7 days
                    {pace ? ` · about ${formatNumber(Math.round(pace.perDay))} a day${pace.basis === "capacity" ? " (capacity set)" : ""}` : " · no pace yet"}
                    {r.last_made_on ? ` · last ${formatDate(r.last_made_on)}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[18px] font-bold tabular-nums">{r.ready > 0 ? boxesAndPieces(r.ready, r.units_per_carton) : `${formatNumber(r.ready)} pcs`} ready</p>
                  {r.ready >= r.units_per_carton && r.units_per_carton > 0 ? <p className="t-caption tabular-nums">{formatNumber(r.ready)} pcs in all</p> : null}
                </div>
                {canCount && counting !== r.product_id ? (
                  <div className="flex w-full justify-end min-[700px]:w-auto">
                    <button type="button" onClick={() => (setCounting(r.product_id), setCountedBoxes(""), setCounted(""), setError(""))} className={buttonClass("row")}>
                      Count
                    </button>
                  </div>
                ) : null}
                {counting === r.product_id ? (
                  <form
                    noValidate
                    className="flex w-full flex-wrap items-center justify-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      save(r);
                    }}
                  >
                    <span className="text-[15px] font-semibold">Counted</span>
                    <div className="relative">
                      <input id={`rcb-${r.product_id}`} aria-label="Full boxes" autoFocus className="input w-28 pr-14" inputMode="numeric" value={countedBoxes} onChange={(e) => (setCountedBoxes(e.target.value), setError(""))} />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[14px] text-muted">boxes</span>
                    </div>
                    <div className="relative">
                      <input id={`rc-${r.product_id}`} aria-label="Loose pieces" className="input w-28 pr-11" inputMode="numeric" placeholder="loose" value={counted} onChange={(e) => (setCounted(e.target.value), setError(""))} />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[14px] text-muted">pcs</span>
                    </div>
                    <button type="submit" disabled={pending} className={buttonClass("primary", "g-btn-row")}>
                      Save
                    </button>
                    <button type="button" onClick={() => setCounting(null)} className={buttonClass("row")}>
                      Cancel
                    </button>
                    {error ? <span className="w-full text-right text-[14px] font-semibold text-bad">{error}</span> : null}
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

type Line = { item_id: string; qty: string; per: RecipePer };

/** What each product uses, per piece or per box. Production takes these off the supplies' stock. */
export function RecipeEditor({ products, items, recipes, canEdit }: { products: Product[]; items: ItemStock[]; recipes: RecipeLine[]; canEdit: boolean }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState("");
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const shown = products.filter((p) => p.active || recipes.some((r) => r.product_id === p.product_id));
  const choosable = items.filter((i) => i.active);

  const open = (productId: string) => {
    setEditing(productId);
    setError("");
    const current = recipes.filter((r) => r.product_id === productId).map((r) => ({ item_id: r.item_id, qty: String(r.qty), per: r.per }));
    setLines(current.length ? current : [{ item_id: choosable[0]?.id ?? "", qty: "1", per: "unit" }]);
  };
  const save = (productId: string) => {
    const parsed = lines.filter((l) => l.item_id).map((l) => ({ item_id: l.item_id, qty: readNumber(l.qty), per: l.per }));
    if (parsed.some((l) => l.qty === null || l.qty <= 0)) return setError("Each supply needs a quantity above 0.");
    if (new Set(parsed.map((l) => l.item_id)).size !== parsed.length) return setError("A supply is in the recipe twice.");
    startTransition(async () => {
      if (toast.result(await saveRecipe(productId, parsed))) setEditing(null);
    });
  };

  return (
    <Card className="g-pad">
      <SectionHead
        title="Recipes"
        sub="What one piece uses (a bottle, a trigger, a sticker; a chemical mixed with water as the litres of liquid it holds) and what one box uses (the carton, tape)."
      />
      {!items.length ? (
        <p className="t-caption">Add your supplies first (bottles, triggers, chemicals, cartons) on the Supplies page; then say here what each product uses.</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {shown.map((p) => {
            const recipe = recipes.filter((r) => r.product_id === p.product_id);
            return (
              <li key={p.product_id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{p.name}</p>
                    <p className="t-caption">
                      {recipe.length
                        ? recipe
                            .map((r) => {
                              const it = itemById.get(r.item_id);
                              // A chemical mixed with water: the litres of liquid ("0.25 L liquid of REPELLENT CHEMICAL").
                              const qty = it && perLitre(it) ? `${formatQty(r.qty, "litre")} liquid of` : it ? formatQty(r.qty, it.unit) : r.qty;
                              return `${qty} ${it?.name ?? "supply"}${r.per === "carton" ? " per box" : ""}`;
                            })
                            .join(" · ")
                        : "No recipe yet: production of it takes no supplies off stock."}
                    </p>
                  </div>
                  {canEdit && editing !== p.product_id ? (
                    <button type="button" onClick={() => open(p.product_id)} className={buttonClass("row")}>
                      {recipe.length ? "Edit" : "Add recipe"}
                    </button>
                  ) : null}
                </div>
                {editing === p.product_id ? (
                  <form
                    noValidate
                    className="mt-3 flex flex-col gap-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      save(p.product_id);
                    }}
                  >
                    {lines.map((l, i) => {
                      const it = itemById.get(l.item_id);
                      // A chemical mixed with water goes in as the litres of liquid; production takes the chemical off by what it makes.
                      const mixed = it && perLitre(it) ? it : null;
                      const unit = mixed ? "litre" : it?.unit;
                      return (
                        <div key={i} className="grid grid-cols-[1fr_auto] gap-2 min-[700px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]">
                          <select aria-label="Supply" className="input col-span-2 min-[700px]:col-span-1" value={l.item_id} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, item_id: e.target.value } : x)))}>
                            {choosable.map((it) => (
                              <option key={it.id} value={it.id}>
                                {it.name}
                              </option>
                            ))}
                          </select>
                          <div className="relative">
                            <input aria-label="Quantity" className="input pr-10" inputMode="decimal" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
                            {unit ? <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[14px] text-muted">{UNIT_SHORT[unit]}</span> : null}
                          </div>
                          <select aria-label="Per" className="input" value={l.per} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, per: e.target.value as RecipePer } : x)))}>
                            <option value="unit">per piece</option>
                            <option value="carton">per box of {p.units_per_carton}</option>
                          </select>
                          <button type="button" onClick={() => setLines(lines.filter((_, j) => j !== i))} className={buttonClass("row")} aria-label={`Take ${itemById.get(l.item_id)?.name ?? "this supply"} out`}>
                            Remove
                          </button>
                          {mixed?.mix_qty && mixed.mix_litres ? (
                            <p className="t-caption col-span-full -mt-1">
                              Litres of liquid. {formatQty(mixed.mix_qty, mixed.unit)} makes {formatQty(mixed.mix_litres, "litre")}, so what is made takes the chemical off by that.
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                    {lines.length < 30 ? (
                      <button
                        type="button"
                        onClick={() => setLines([...lines, { item_id: choosable.find((it) => !lines.some((x) => x.item_id === it.id))?.id ?? choosable[0]?.id ?? "", qty: "1", per: "unit" }])}
                        className={buttonClass("outline", "self-start")}
                      >
                        Add a supply
                      </button>
                    ) : null}
                    {error ? <p className="text-[15px] font-semibold text-bad">{error}</p> : null}
                    <FormButtons pending={pending} onCancel={() => setEditing(null)} save="Save recipe" />
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
