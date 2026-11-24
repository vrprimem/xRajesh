"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { FormButtons } from "@/components/supplier/entry-kit";
import { useToast } from "@/components/toast";
import { Card, Chip, EmptyState, Field, SectionHead, buttonClass } from "@/components/ui";
import { formatDate, formatNumber } from "@/lib/format";
import { familyColours, pictureFor } from "@/lib/godown-pictures";
import { formatBoxes, formatQty, isLow, ITEM_KIND_LABEL, ITEM_KINDS, ITEM_UNITS, MOVE_REASON_LABEL, readNumber, staffItemName, UNIT_LABEL, UNIT_SHORT, type ItemKind, type ItemMove, type ItemStock, type ItemUnit } from "@/lib/supplies";
import { uploadSupplierPhoto } from "@/lib/supplier-photo-upload";
import { countItem, saveItem, setItemPhoto } from "@/server/actions/supplies";

type Form = {
  id: string | null;
  name: string;
  kind: ItemKind;
  unit: ItemUnit;
  low: string;
  active: boolean;
  simple: string;
  simpleHi: string;
  simpleMr: string;
  /** A chemical: this much of it makes these litres of liquid with water. */
  mixQty: string;
  mixLitres: string;
};
const NEW: Form = { id: null, name: "", kind: "bottle", unit: "pcs", low: "", active: true, simple: "", simpleHi: "", simpleMr: "", mixQty: "", mixLitres: "" };
const formOf = (i: ItemStock): Form => ({
  id: i.id,
  name: i.name,
  kind: i.kind,
  unit: i.unit,
  low: i.low_level === null ? "" : String(i.low_level),
  active: i.active,
  simple: i.simple_name ?? "",
  simpleHi: i.simple_name_hi ?? "",
  simpleMr: i.simple_name_mr ?? "",
  mixQty: i.mix_qty ? String(i.mix_qty) : "",
  mixLitres: i.mix_litres ? String(i.mix_litres) : "",
});

/** The simple names a supply has, English first: "100ml Bottle · 100ml बोतल · 100ml बाटली". */
const simpleNames = (i: ItemStock) => [i.simple_name, i.simple_name_hi, i.simple_name_mr].filter(Boolean).join(" · ");

const lastsText = (days: number | null) => (days === null ? "not used lately" : days < 1 ? "lasts under a day" : `lasts ${formatNumber(Math.floor(days))} ${Math.floor(days) === 1 ? "day" : "days"}`);

/**
 * The supplier's supplies (bottles, triggers, caps, chemicals, labels, cartons, packing) and their stock: goods in at
 * the godown adds, production takes by the recipes, a count sets it. No prices here: the warehouse person and VRPRIME
 * see this page too. Stock shows and is counted in boxes and pieces. `canEdit`: add and change supplies, how much a box
 * holds, the simple names the godown staff know them by, what a chemical makes when mixed, and their photos;
 * `canCount`: count stock. `photos`: links to the supplies' photos (the rest show a drawn picture). `staff`: the
 * reader is the warehouse person, who knows the supplies by their simple names. `startAdding` opens the form for a
 * new supply.
 */
export function SuppliesPanel({
  supplierId,
  items,
  moves,
  daysLeft,
  canEdit,
  canCount,
  photos = {},
  staff = false,
  startAdding = false,
}: {
  supplierId: string;
  items: ItemStock[];
  moves: ItemMove[];
  daysLeft: Record<string, number | null>;
  canEdit: boolean;
  canCount: boolean;
  photos?: Record<string, string>;
  staff?: boolean;
  startAdding?: boolean;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const photoInput = useRef<HTMLInputElement>(null);
  const [photoFor, setPhotoFor] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const nameOf = (i: ItemStock) => (staff ? staffItemName(i) : i.name);
  // One colour per product for the drawn stickers and chemicals, as on the godown screen.
  const colours = useMemo(() => familyColours(items.map((i) => ({ kind: i.kind, name: staffItemName(i) }))), [items]);

  /** A photo of a supply, as a small JPEG in the supplier's folder, then put on the supply. */
  const uploadPhoto = async (file: File) => {
    const item = photoFor;
    if (!item) return;
    setUploading(true);
    try {
      const path = await uploadSupplierPhoto(supplierId, "items", file);
      if (path) toast.result(await setItemPhoto(item, path));
      else toast.show("The photo could not be uploaded. Check your connection and try again.", "bad");
    } finally {
      setUploading(false);
      setPhotoFor(null);
      if (photoInput.current) photoInput.current.value = "";
    }
  };
  const [form, setForm] = useState<Form | null>(canEdit && startAdding ? { ...NEW } : null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [counting, setCounting] = useState<string | null>(null);
  const [countedBoxes, setCountedBoxes] = useState("");
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
    // What a chemical makes with water: both, or neither.
    const chemical = form.kind === "chemical";
    const mixQty = chemical && form.mixQty.trim() ? readNumber(form.mixQty) : null;
    const mixLitres = chemical && form.mixLitres.trim() ? readNumber(form.mixLitres) : null;
    const anyMix = Boolean(chemical && (form.mixQty.trim() || form.mixLitres.trim()));
    if (anyMix && !(mixQty && mixQty > 0)) e.mix_qty = "How much of it: a number above 0";
    if (anyMix && !(mixLitres && mixLitres > 0)) e.mix_litres = "How many litres it makes: a number above 0";
    setErrors(e);
    if (Object.keys(e).length) return;
    startTransition(async () => {
      const result = await saveItem(supplierId, {
        id: form.id,
        name: form.name,
        kind: form.kind,
        unit: form.unit,
        low_level: lowLevel,
        active: form.active,
        simple_name: form.simple,
        simple_name_hi: form.simpleHi,
        simple_name_mr: form.simpleMr,
        mix_qty: anyMix ? mixQty : null,
        mix_litres: anyMix ? mixLitres : null,
      });
      if (toast.result(result)) setForm(null);
      else if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
    });
  };

  /** A count in boxes and loose pieces (or kg, litres): the stock becomes what was counted. */
  const saveCount = (item: ItemStock) => {
    const boxes = countedBoxes.trim() ? readNumber(countedBoxes) : 0;
    const loose = counted.trim() ? readNumber(counted) : 0;
    if (boxes === null || loose === null || (!countedBoxes.trim() && !counted.trim()) || (boxes > 0 && !Number.isInteger(boxes))) {
      return setCountError(item.box_qty ? "Enter the full boxes and the loose ones you counted" : `Enter what you counted, in ${UNIT_LABEL[item.unit].toLowerCase()}`);
    }
    const total = Math.round(((item.box_qty ? boxes * item.box_qty : 0) + loose) * 1000) / 1000;
    startTransition(async () => {
      const result = await countItem(item.id, total, "");
      if (toast.result(result)) setCounting(null);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {canEdit ? <input ref={photoInput} type="file" accept="image/*" className="sr-only" aria-label="Photo of the supply" onChange={(e) => e.target.files?.[0] && void uploadPhoto(e.target.files[0])} /> : null}
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
              <Field label="Name" htmlFor="si-name" required error={errors.name} hint="As you buy it, e.g. 19MM 100ML BOSTON WHITE BOTTLE">
                <input id="si-name" className="input" maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="Kind" htmlFor="si-kind" required>
                <select
                  id="si-kind"
                  className="input"
                  value={form.kind}
                  // A chemical is bought by the kg.
                  onChange={(e) => setForm({ ...form, kind: e.target.value as ItemKind, unit: e.target.value === "chemical" && form.unit === "pcs" ? "kg" : form.unit })}
                >
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
              <p className="t-caption self-end">How many in one box: the warehouse person says it at the godown, when goods come in or at a count.</p>
            </div>
            {form.kind === "chemical" ? (
              <fieldset className="flex flex-col gap-3 rounded-[12px] border border-line-soft p-3">
                <legend className="px-1 text-[15px] font-bold">Mixed with water</legend>
                <p className="t-caption -mt-1">
                  What it makes with water, e.g. 1.5 kg makes 160 L. The godown then shows how many bottles it fills. In a product&rsquo;s recipe, this chemical is then the
                  litres of liquid one piece takes (0.25 for a 250ml bottle), and what is made takes the chemical off by that.
                </p>
                <div className="grid gap-4 min-[700px]:grid-cols-2">
                  <Field label="This much of it" htmlFor="si-mixqty" error={errors.mix_qty}>
                    <div className="relative">
                      <input id="si-mixqty" className="input pr-10" inputMode="decimal" placeholder="e.g. 1.5" value={form.mixQty} onChange={(e) => setForm({ ...form, mixQty: e.target.value })} />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[14px] text-muted">{UNIT_SHORT[form.unit]}</span>
                    </div>
                  </Field>
                  <Field label="Makes" htmlFor="si-mixlitres" error={errors.mix_litres}>
                    <div className="relative">
                      <input id="si-mixlitres" className="input pr-10" inputMode="decimal" placeholder="e.g. 160" value={form.mixLitres} onChange={(e) => setForm({ ...form, mixLitres: e.target.value })} />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[14px] text-muted">L</span>
                    </div>
                  </Field>
                </div>
              </fieldset>
            ) : null}
            <fieldset className="flex flex-col gap-3 rounded-[12px] border border-line-soft p-3">
              <legend className="px-1 text-[15px] font-bold">Name for the godown staff</legend>
              <p className="t-caption -mt-1">What the warehouse staff call it. Their godown screen shows this, in the language they pick; you see the name above.</p>
              <div className="grid gap-4 min-[700px]:grid-cols-3">
                <Field label="Simple name" htmlFor="si-simple" error={errors.simple_name} hint="e.g. 100ml Bottle">
                  <input id="si-simple" className="input" maxLength={120} value={form.simple} onChange={(e) => setForm({ ...form, simple: e.target.value })} />
                </Field>
                <Field label="In Hindi (हिंदी)" htmlFor="si-simple-hi" error={errors.simple_name_hi} hint="e.g. 100ml बोतल. Empty: the simple name.">
                  <input id="si-simple-hi" className="input" lang="hi" maxLength={120} value={form.simpleHi} onChange={(e) => setForm({ ...form, simpleHi: e.target.value })} />
                </Field>
                <Field label="In Marathi (मराठी)" htmlFor="si-simple-mr" error={errors.simple_name_mr} hint="e.g. 100ml बाटली. Empty: the simple name.">
                  <input id="si-simple-mr" className="input" lang="mr" maxLength={120} value={form.simpleMr} onChange={(e) => setForm({ ...form, simpleMr: e.target.value })} />
                </Field>
              </div>
            </fieldset>
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
          <p className="w-full text-[15px]">{low.map((i) => `${nameOf(i)} (${formatBoxes(i.on_hand, i.unit, i.box_qty)})`).join(", ")}</p>
        </div>
      ) : null}

      {items.length === 0 ? (
        <EmptyState title="No supplies yet" body={canEdit ? "Add what you buy to make your products: bottles, triggers, caps, chemicals, labels and cartons." : "The owner has not added any supplies yet."} />
      ) : (
        <Card className="g-pad">
          <SectionHead
            title="Stock"
            sub="Goods in at the godown adds; production takes what its recipe uses; a count sets it. How long it lasts is at the rate production used it over the last 30 days."
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
                {/* The supply's photo, or a drawn picture until one is added: what the godown staff see. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photos[i.id] ?? pictureFor(i.kind, staffItemName(i), colours)} alt="" width={44} height={44} className="h-11 w-11 shrink-0 rounded-[10px] bg-white object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    {nameOf(i)}
                    {isLow(i) ? <Chip tone="bad">Low</Chip> : null}
                    {i.active ? null : <span className="font-normal text-muted">not in use</span>}
                  </p>
                  {!staff && simpleNames(i) ? <p className="text-[14px]">Godown: {simpleNames(i)}</p> : null}
                  <p className="t-caption">
                    {ITEM_KIND_LABEL[i.kind]}
                    {i.box_qty ? ` · 1 box = ${formatQty(i.box_qty, i.unit)}` : ""}
                    {i.low_level !== null ? ` · low at ${formatQty(i.low_level, i.unit)}` : ""}
                  </p>
                  {i.mix_qty && i.mix_litres ? (
                    <p className="t-caption">
                      {formatQty(i.mix_qty, i.unit)} makes {formatQty(i.mix_litres, "litre")} of liquid with water
                    </p>
                  ) : null}
                </div>
                <div className="text-right">
                  <p className="text-[18px] font-bold tabular-nums">{formatBoxes(i.on_hand, i.unit, i.box_qty)}</p>
                  {i.box_qty && i.on_hand >= i.box_qty ? <p className="t-caption tabular-nums">{formatQty(i.on_hand, i.unit)} in all</p> : null}
                  <p className="t-caption">{lastsText(daysLeft[i.id] ?? null)}</p>
                </div>
                {(canCount || canEdit) && counting !== i.id ? (
                  <div className="flex w-full justify-end gap-2 min-[700px]:w-auto">
                    {canCount ? (
                      <button type="button" onClick={() => (setCounting(i.id), setCountedBoxes(""), setCounted(""), setCountError(""))} className={buttonClass("row")}>
                        Count
                      </button>
                    ) : null}
                    {canEdit ? (
                      <>
                        <button type="button" onClick={() => (setForm(formOf(i)), setErrors({}))} className={buttonClass("row")}>
                          Edit
                        </button>
                        <button type="button" disabled={uploading} onClick={() => (setPhotoFor(i.id), photoInput.current?.click())} className={buttonClass("row")}>
                          {uploading && photoFor === i.id ? "Uploading..." : i.photo_path ? "Change photo" : "Add photo"}
                        </button>
                      </>
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
                    <span className="text-[15px] font-semibold">Counted</span>
                    {i.box_qty ? (
                      <div className="relative">
                        <input id={`icb-${i.id}`} aria-label="Full boxes" autoFocus className="input w-28 pr-14" inputMode="numeric" value={countedBoxes} onChange={(e) => (setCountedBoxes(e.target.value), setCountError(""))} />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[14px] text-muted">boxes</span>
                      </div>
                    ) : null}
                    <div className="relative">
                      <input
                        id={`ic-${i.id}`}
                        aria-label={i.box_qty ? `Loose ${UNIT_LABEL[i.unit].toLowerCase()}` : `Counted, in ${UNIT_LABEL[i.unit].toLowerCase()}`}
                        autoFocus={!i.box_qty}
                        className="input w-32 pr-10"
                        inputMode="decimal"
                        placeholder={i.box_qty ? "loose" : undefined}
                        value={counted}
                        onChange={(e) => (setCounted(e.target.value), setCountError(""))}
                      />
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
                    <p className="font-semibold">{it ? nameOf(it) : "Supply"}</p>
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
