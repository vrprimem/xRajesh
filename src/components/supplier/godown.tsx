"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { BackIcon, BoxIcon, CameraIcon, CheckIcon, ListIcon, TruckIcon } from "@/components/icons";
import { Chip } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import {
  LANGS,
  LANG_NAME,
  SHELF_WORD,
  WORDS,
  bottleSizes,
  bottlesFrom,
  boxWord,
  byShelf,
  canMake,
  formulaOf,
  fromBoxes,
  inBoxes,
  isWeighed,
  levelOf,
  mixLitres,
  say,
  staffName,
  usesPacked,
  type GodownEntry,
  type GodownEvent,
  type GodownItem,
  type GodownProduct,
  type GodownUnit,
  type Lang,
} from "@/lib/godown";

type FlowKind = "in" | "made" | "count";
/**
 * A flow on the full screen: what was picked, then what was typed: the boxes and the loose pieces (a sticker's total
 * pieces), how much one box holds (the warehouse person says), and a sticker's kg.
 */
type Flow = { kind: FlowKind; pick: string | null; boxes: string; loose: string; perBox: string; kg: string; photo: File | null; saved: null | { qty: number; diff?: number; kg?: number | null } };

/** A typed number above 0, else null. */
const positive = (s: string) => {
  const n = Number(s);
  return s.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
};
/** Digits and one point. */
const decimalOnly = (s: string) => s.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1").slice(0, 10);

const LEVEL_TONE = { ok: "ok", low: "warn", out: "bad" } as const;
const LEVEL_WORD = { ok: "enough", low: "low", out: "out" } as const;
const LEVEL_FRAME = { ok: "border-line-soft", low: "border-warn", out: "border-bad" } as const;

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** A quantity in boxes and pieces as the staff count it: "2 बॉक्स + 400 पीस", or "640 पीस" with no box or under one. */
function qtyText(qty: number, perBox: number | null, unit: GodownUnit, lang: Lang): string {
  const { boxes, loose } = inBoxes(qty, perBox);
  const rest = `${formatNumber(loose)} ${WORDS[lang][unit]}`;
  if (boxes === 0) return rest;
  const head = `${formatNumber(boxes)} ${boxWord(boxes, lang)}`;
  return loose ? `${head} + ${rest}` : head;
}
/** The chemical in one bottle: grams for a chemical in kg ("2.3 g"), else in its unit. */
function perBottleText(per: number, unit: GodownUnit, lang: Lang): string {
  if (unit === "kg") return `${formatNumber(Math.round(per * 10000) / 10)} g`;
  return `${formatNumber(Math.round(per * 1000) / 1000)} ${WORDS[lang][unit]}`;
}
const itemQty = (item: GodownItem, qty: number, lang: Lang) => qtyText(qty, item.perBox, item.unit, lang);
const productQty = (product: GodownProduct, pieces: number, lang: Lang) => qtyText(Math.max(0, Math.round(pieces)), product.perCarton, "pcs", lang);

/** What is on the shelf: a big number of boxes (or pieces, when not boxed or under one box), and the pieces in all. */
function Amount({ qty, perBox, unit, lang }: { qty: number; perBox: number | null; unit: GodownUnit; lang: Lang }) {
  const { boxes, loose } = inBoxes(qty, perBox);
  const word = WORDS[lang][unit];
  const inBox = Boolean(perBox) && boxes > 0;
  return (
    <>
      <span className="mt-1 block leading-none">
        <span className="t-score text-[34px] tabular-nums">{formatNumber(inBox ? boxes : qty)}</span> <span className="text-[17px] font-bold">{inBox ? boxWord(boxes, lang) : word}</span>
      </span>
      {perBox ? (
        <span className="mt-1 block text-[14px] text-muted">
          {inBox
            ? `${loose ? `+ ${formatNumber(loose)} ${word} · ` : ""}${formatNumber(qty)} ${word} ${say(lang, "inAll")}`
            : `1 ${boxWord(1, lang)} = ${formatNumber(perBox)} ${word}`}
        </span>
      ) : null}
    </>
  );
}

function Picture({ src, name, size = 56 }: { src?: string; name: string; size?: number }) {
  return src ? (
    // A photo or drawn picture of the material: the staff find things by it.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} className="shrink-0 rounded-[12px] bg-white object-cover" style={{ width: size, height: size }} />
  ) : (
    <span aria-hidden className="grid shrink-0 place-items-center rounded-[12px] bg-panel2 text-[22px] font-bold" style={{ width: size, height: size }}>
      {name.slice(0, 1)}
    </span>
  );
}

/** How many bottles of each size a chemical's liquid fills: "Bottles it fills: 250ml 640, 100ml 1,600", one size a row. */
function Fills({ rows, lang }: { rows: { size: string; bottles: number }[]; lang: Lang }) {
  return (
    <span className="mt-1.5 flex flex-col gap-0.5 rounded-[10px] bg-panel2 px-2.5 py-1.5 text-[14px]">
      <span className="text-[12px] font-semibold leading-tight text-muted">{say(lang, "fills")}</span>
      {rows.map((r) => (
        <span key={r.size} className="flex items-baseline justify-between gap-2">
          <span className="font-bold">{r.size}</span>
          <b className="text-[17px] tabular-nums">{formatNumber(r.bottles)}</b>
        </span>
      ))}
    </span>
  );
}

type PhotoButton = { label: string; disabled: boolean; onClick: () => void };

/** The owner's button under a tile: add or change its photo. */
function PhotoAction({ photo }: { photo: PhotoButton }) {
  return (
    <span className="mt-auto block pt-3">
      <button type="button" onClick={photo.onClick} disabled={photo.disabled} className="flex h-11 w-full items-center justify-center gap-1.5 rounded-[10px] border-2 border-frame bg-surface2 px-2 text-[14px] font-bold focus-ring disabled:opacity-50">
        <CameraIcon className="h-5 w-5 shrink-0" />
        {photo.label}
      </button>
    </span>
  );
}

/**
 * A material on the shelf: its picture and name, then a big number of boxes and the pieces in all. `sub`: the name the
 * others know it by. `extra`: what it makes (a chemical's litres of liquid and the bottles they fill). `photo`: a
 * button to add or change its photo (the owner).
 */
function ItemTile({ item, name, sub, lang, onClick, photo, extra }: { item: GodownItem; name: string; sub?: string | null; lang: Lang; onClick?: () => void; photo?: PhotoButton; extra?: ReactNode }) {
  const level = levelOf(item);
  const body = (
    <>
      <span className="flex flex-wrap items-start justify-between gap-2">
        <Picture src={item.photo} name={name} />
        <Chip tone={LEVEL_TONE[level]}>{say(lang, LEVEL_WORD[level])}</Chip>
      </span>
      <span className="mt-2 block text-[15px] font-semibold leading-snug">{name}</span>
      {sub ? <span className="mt-0.5 block text-[13px] leading-snug text-muted">{sub}</span> : null}
      <Amount qty={Math.max(0, item.onHand)} perBox={item.perBox} unit={item.unit} lang={lang} />
      {extra}
    </>
  );
  const cls = `flex w-full flex-col rounded-[14px] border-2 ${LEVEL_FRAME[level]} bg-surface p-3 text-left`;
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} focus-ring active:scale-[0.98]`}>
      {body}
    </button>
  ) : (
    <div className={cls}>
      {body}
      {photo ? <PhotoAction photo={photo} /> : null}
    </div>
  );
}

/** A finished product: its picture and the boxes and pieces ready to send. `photo`: add or change its photo (the owner). */
function ProductTile({ product, lang, onClick, photo }: { product: GodownProduct; lang: Lang; onClick?: () => void; photo?: PhotoButton }) {
  const body = (
    <>
      <Picture src={product.photo} name={product.name} />
      <span className="mt-2 block text-[15px] font-semibold leading-snug">{product.name}</span>
      <Amount qty={Math.max(0, Math.round(product.ready))} perBox={product.perCarton > 0 ? product.perCarton : null} unit="pcs" lang={lang} />
    </>
  );
  const cls = "flex w-full flex-col rounded-[14px] border-2 border-line-soft bg-surface p-3 text-left";
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} focus-ring active:scale-[0.98]`}>
      {body}
    </button>
  ) : (
    <div className={cls}>
      {body}
      {photo ? <PhotoAction photo={photo} /> : null}
    </div>
  );
}

/** A small link button beside a heading: "+ New material". */
function AddLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="flex h-10 items-center gap-1 rounded-[10px] border-2 border-frame bg-surface2 px-3 text-[15px] font-bold focus-ring">
      <span aria-hidden className="text-[20px] leading-none">
        +
      </span>
      {label}
    </Link>
  );
}

/**
 * A big number, with minus and plus buttons a thumb can hit; whole numbers, or with `decimal` a part too (1.5 kg).
 * `small` for the second one on a screen (the loose pieces under the boxes).
 */
function Stepper({ value, onChange, label, decimal = false, small = false }: { value: string; onChange: (v: string) => void; label: string; decimal?: boolean; small?: boolean }) {
  const n = Number(value) || 0;
  const round = `grid ${small ? "h-14 w-14 text-[30px]" : "h-16 w-16 text-[34px]"} shrink-0 place-items-center rounded-full border-2 border-frame bg-surface2 font-bold focus-ring active:scale-95`;
  const tidy = (s: string) => (decimal ? s.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1").slice(0, 9) : s.replace(/\D/g, "").slice(0, 6));
  return (
    <div className="flex items-center justify-center gap-3">
      <button type="button" aria-label={`${label} −1`} onClick={() => onChange(String(Math.max(0, Math.round((n - 1) * 1000) / 1000)))} className={round}>
        −
      </button>
      <label className="flex min-w-0 flex-col items-center">
        <input
          inputMode={decimal ? "decimal" : "numeric"}
          aria-label={label}
          value={value}
          placeholder="0"
          onFocus={(e) => e.target.select()}
          onChange={(e) => onChange(tidy(e.target.value))}
          className={`input ${small ? "h-16 w-32 text-[34px]" : "h-20 w-36 text-[44px]"} text-center font-extrabold tabular-nums`}
        />
        <span className="mt-1 text-[18px] font-bold">{label}</span>
      </label>
      <button type="button" aria-label={`${label} +1`} onClick={() => onChange(String(Math.round((n + 1) * 1000) / 1000))} className={round}>
        +
      </button>
    </div>
  );
}

/**
 * The supplier's godown on one screen: every material and finished product as a picture with a big number, in boxes
 * and pieces, shelf by shelf (bottles, triggers, caps...), in Hindi, Marathi or English. Everything is entered the same
 * way: how many boxes, and how many loose pieces (or kg, litres).
 *   view = "staff"    three big buttons: goods in, made today, count. Nothing else to learn. Materials go by their
 *                     simple names in the chosen language ("100ml बोतल").
 *   view = "owner"    the same, plus what can still be made and what runs out first. Materials go by their full names
 *                     with the staff's name under them. With `onPhoto` and `onProductPhoto` each material and product
 *                     gets a button to add its photo; `addLinks` puts "+ New material" and "+ New product" beside the
 *                     headings.
 *   view = "vrprime"  read only: what is there, what is low, and what can still be made.
 * A chemical shows the litres of liquid it makes with water and the bottles they fill; made today takes it off by
 * the litres the bottles hold.
 * The save callbacks answer true once saved; the screen then shows a big tick. Every amount goes over in pieces (or
 * kg, litres): the boxes entered times what a box holds, plus the loose ones. How much a box holds is the warehouse
 * person's to say: his goods in and count ask it, and hand it over (in `entry`) when he changed it; the owner sees
 * it. Stickers are typed as their kg and total pieces instead. Goods in hands over the bill's photo when one was
 * taken.
 */
export function Godown({
  items,
  products,
  events,
  view,
  onGoodsIn,
  onMade,
  onCount,
  onPhoto,
  onProductPhoto,
  addLinks,
  defaultLang,
}: {
  items: GodownItem[];
  products: GodownProduct[];
  events: GodownEvent[];
  view: "staff" | "owner" | "vrprime";
  onGoodsIn?: (itemId: string, qty: number, photo: File | null, entry: GodownEntry) => Promise<boolean>;
  onMade?: (productId: string, units: number, boxes: number) => Promise<boolean>;
  onCount?: (itemId: string, qty: number, entry: GodownEntry) => Promise<boolean>;
  onPhoto?: (itemId: string, photo: File) => Promise<boolean>;
  onProductPhoto?: (productId: string, photo: File) => Promise<boolean>;
  addLinks?: { material: string; product: string };
  defaultLang?: Lang;
}) {
  const [lang, setLang] = useState<Lang>(defaultLang ?? (view === "vrprime" ? "en" : "hi"));
  const [flow, setFlow] = useState<Flow | null>(null);
  const [busy, setBusy] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const photoFor = useRef<{ kind: "item" | "product"; id: string } | null>(null);
  const [photoBusy, setPhotoBusy] = useState<string | null>(null);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const shelves = useMemo(() => byShelf(items), [items]);
  const t = (key: keyof (typeof WORDS)["en"], fill?: Record<string, string | number>) => say(lang, key, fill);
  const low = items.filter((i) => levelOf(i) !== "ok");
  // The staff know a material by its simple name in their language; the owner and VRPRIME by its full name, with the
  // staff's name under it.
  const nameOf = (i: GodownItem) => (view === "staff" ? staffName(i, lang) : i.name);
  const subOf = (i: GodownItem) => (view === "staff" || staffName(i, lang) === i.name ? null : staffName(i, lang));

  const takePhoto = (kind: "item" | "product", id: string) => {
    photoFor.current = { kind, id };
    photoInput.current?.click();
  };
  const savePhoto = async (file: File) => {
    const target = photoFor.current;
    const save = target?.kind === "product" ? onProductPhoto : onPhoto;
    if (!target || !save) return;
    setPhotoBusy(target.id);
    try {
      await save(target.id, file);
    } finally {
      setPhotoBusy(null);
      photoFor.current = null;
      if (photoInput.current) photoInput.current.value = "";
    }
  };
  const photoButton = (i: GodownItem): PhotoButton | undefined =>
    onPhoto ? { label: photoBusy === i.id ? "..." : t(i.hasPhoto ? "changePhoto" : "addPhoto"), disabled: photoBusy !== null, onClick: () => takePhoto("item", i.id) } : undefined;
  const productPhotoButton = (p: GodownProduct): PhotoButton | undefined =>
    onProductPhoto ? { label: photoBusy === p.id ? "..." : t(p.hasPhoto ? "changePhoto" : "addPhoto"), disabled: photoBusy !== null, onClick: () => takePhoto("product", p.id) } : undefined;

  const litreWord = WORDS[lang].litre;
  // Each chemical mixed with water, with its formula.
  const formulas = items.flatMap((i) => {
    const f = formulaOf(i, products);
    return f ? [{ item: i, f }] : [];
  });
  /** Under a chemical mixed with water: the litres of liquid it makes and the bottles they fill. */
  const extraFor = (i: GodownItem): ReactNode => {
    if (!i.mix) return null;
    const litres = mixLitres(i.mix, Math.max(0, i.onHand));
    const sizes = bottleSizes(i.id, products);
    return (
      <>
        <span className="mt-1.5 block text-[15px] font-semibold">{t("makes", { litres: `${formatNumber(litres)} ${litreWord}` })}</span>
        {sizes.length ? <Fills rows={bottlesFrom(litres, sizes)} lang={lang} /> : null}
      </>
    );
  };

  const start = (kind: FlowKind) => setFlow({ kind, pick: null, boxes: "", loose: "", perBox: "", kg: "", photo: null, saved: null });
  /**
   * Picks a material or product. How much a box holds starts at the usual (what the warehouse person said last, or a
   * product's box); how many boxes starts empty, for him to say.
   */
  const pick = (id: string) => {
    if (!flow) return;
    const usual = flow.kind === "made" ? productById.get(id)?.perCarton : byId.get(id)?.perBox;
    setFlow({ ...flow, pick: id, boxes: "", perBox: usual && usual > 0 ? String(usual) : "" });
  };
  const pickedItem = flow && flow.kind !== "made" && flow.pick ? byId.get(flow.pick) : undefined;
  const pickedProduct = flow && flow.kind === "made" && flow.pick ? productById.get(flow.pick) : undefined;
  // A sticker is typed as kg and total pieces; a material in litres as litres; every other material and product in boxes.
  const weighed = Boolean(pickedItem && isWeighed(pickedItem));
  const boxed = Boolean((pickedItem && !weighed && pickedItem.unit !== "litre") || pickedProduct);
  // Goods in and made today: how many boxes, and how many in each ("30 boxes of 40" is 1,200 pieces, in 30 boxes). A
  // count: the boxes on the shelf, how much a box holds, and the loose ones.
  const boxEntry = boxed && flow?.kind !== "count";
  const typedBox = boxed ? positive(flow?.perBox ?? "") : null;
  // How much a box holds: the warehouse person says it; on a count the owner sees the one he said.
  const saysBox = boxed && Boolean(pickedItem) && view === "staff";
  const perBox = boxEntry ? typedBox : boxed ? (saysBox ? typedBox : (pickedItem?.perBox ?? null)) : null;
  const unit: GodownUnit = pickedProduct ? "pcs" : (pickedItem?.unit ?? "pcs");
  const loose = Number(flow?.loose) || 0;
  const boxCount = Number(flow?.boxes) || 0;
  const amount = !flow ? 0 : weighed ? loose : boxEntry ? Math.round(boxCount * (typedBox ?? 0) * 1000) / 1000 : fromBoxes(boxCount, loose, perBox);
  const kg = weighed && flow ? positive(flow.kg) : null;
  // Boxes counted for a thing whose box size nobody has said yet: they cannot be counted.
  const needsBox = Boolean(flow && !weighed && !boxEntry && boxCount > 0 && !perBox);
  // The boxes typed, in words: "30 बॉक्स × 40 पीस".
  const unitWord = WORDS[lang][unit];
  const typedText = `${formatNumber(boxCount)} ${boxWord(boxCount, lang)} × ${formatNumber(typedBox ?? 0)} ${unitWord}`;

  const save = async () => {
    if (!flow || !flow.pick || busy || needsBox) return;
    if (flow.kind !== "count" && amount <= 0) return;
    setBusy(true);
    try {
      const before = pickedItem?.onHand ?? 0;
      // What goes with it: what a box of the material holds, when the warehouse person said something new. A count
      // sets it (the boxes he counted on the shelf); boxes that came in set it only when none was said yet, so one
      // odd box of 30 does not turn the usual box of 300 into 30. And a sticker's weight.
      const newBox = saysBox && perBox !== null && perBox !== (pickedItem?.perBox ?? null) && (flow.kind === "count" || !pickedItem?.perBox);
      const entry: GodownEntry = {
        ...(newBox ? { perBox } : {}),
        ...(weighed ? { kg } : {}),
      };
      const ok =
        flow.kind === "in"
          ? await onGoodsIn?.(flow.pick, amount, flow.photo, entry)
          : flow.kind === "made"
            ? await onMade?.(flow.pick, Math.round(amount), boxCount)
            : await onCount?.(flow.pick, amount, entry);
      if (ok) setFlow({ ...flow, saved: { qty: amount, diff: flow.kind === "count" ? amount - before : undefined, kg } });
    } finally {
      setBusy(false);
    }
  };

  const BUTTONS: { kind: FlowKind; label: string; hint: string; icon: ReactNode; stage: string }[] = [
    { kind: "in", label: t("goodsIn"), hint: t("goodsInHint"), icon: <TruckIcon className="h-8 w-8" />, stage: "stage-done" },
    { kind: "made", label: t("madeToday"), hint: t("madeHint"), icon: <BoxIcon className="h-8 w-8" />, stage: "stage-way" },
    { kind: "count", label: t("count"), hint: t("countHint"), icon: <ListIcon className="h-8 w-8" />, stage: "stage-load" },
  ];
  const current = flow ? BUTTONS.find((b) => b.kind === flow.kind) : undefined;

  return (
    <div className="flex flex-col gap-5">
      {onPhoto || onProductPhoto ? (
        <input ref={photoInput} type="file" accept="image/*" tabIndex={-1} aria-hidden className="sr-only" onChange={(e) => e.target.files?.[0] && void savePhoto(e.target.files[0])} />
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] font-extrabold">{t("title")}</h1>
        <div role="group" aria-label="Language" className="flex gap-1 rounded-full border border-frame p-1">
          {LANGS.map((l) => (
            <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)} className={`rounded-full px-3 py-1.5 text-[15px] font-bold focus-ring ${lang === l ? "bg-accent text-accent-ink" : "text-muted"}`}>
              {LANG_NAME[l]}
            </button>
          ))}
        </div>
      </div>

      {view === "vrprime" ? (
        <p className="t-caption -mt-3">{t("readOnly")}</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {BUTTONS.map((b) => (
            <button
              key={b.kind}
              type="button"
              onClick={() => start(b.kind)}
              className={`${b.stage} flex min-h-[116px] flex-col items-center justify-center gap-1 rounded-[16px] px-1.5 py-3 text-center focus-ring active:scale-[0.97]`}
              style={{ background: "var(--stage-bg)", color: "var(--stage-ink)" }}
            >
              {b.icon}
              <span className="text-[18px] font-extrabold leading-tight">{b.label}</span>
              <span className="text-[13px] font-semibold leading-tight opacity-90">{b.hint}</span>
            </button>
          ))}
        </div>
      )}

      {view !== "staff" && products.length ? (
        <section className="sp-card g-pad flex flex-col gap-3">
          <h2 className="t-card-title">{t("canMake")}</h2>
          <ul className="flex flex-col divide-y divide-line-soft">
            {products.map((p) => {
              const c = canMake(p, byId);
              const limitItem = c.limit ? byId.get(c.limit) : undefined;
              const limit = limitItem ? nameOf(limitItem) : null;
              return (
                <li key={p.id} className="flex items-center gap-3 py-2.5">
                  <Picture src={p.photo} name={p.name} size={44} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{p.name}</span>
                    <span className={`block text-[14px] ${p.recipe.length && c.cartons === 0 ? "font-semibold text-bad" : "text-muted"}`}>{limit ? t("runsOutFirst", { item: limit }) : t("noRecipe")}</span>
                  </span>
                  {p.recipe.length ? (
                    <span className="shrink-0 text-right">
                      <span className={`t-score block text-[26px] tabular-nums ${c.cartons === 0 ? "text-bad" : ""}`}>{formatNumber(c.cartons)}</span>
                      <span className="block text-[13px] text-muted">{boxWord(c.cartons, lang)}</span>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <p className="t-caption">{t("shared")}</p>
          {low.length ? (
            <p className="text-[15px]">
              <b>{t("lowList")}:</b> {low.map((i) => `${nameOf(i)} (${itemQty(i, Math.max(0, i.onHand), lang)})`).join(", ")}
            </p>
          ) : null}
        </section>
      ) : null}

      {formulas.length ? (
        // What each chemical makes: one packet and water, the liquid, the bottles of each size, the chemical in each.
        <section aria-labelledby="gd-formula" className="sp-card g-pad flex flex-col gap-3">
          <div>
            <h2 id="gd-formula" className="t-card-title">
              {t("formula")}
            </h2>
            <p className="t-caption mt-0.5">{t("formulaSub")}</p>
          </div>
          <ul className="flex flex-col divide-y divide-line-soft">
            {formulas.map(({ item, f }) => (
              <li key={item.id} className="flex items-start gap-3 py-2.5">
                <Picture src={item.photo} name={nameOf(item)} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{nameOf(item)}</span>
                  <span className="block text-[17px] font-bold">
                    {t("packetMakes", { qty: `${formatNumber(f.qty)} ${WORDS[lang][item.unit]}`, litres: `${formatNumber(f.litres)} ${litreWord}` })}
                  </span>
                  {f.sizes.map((s) => (
                    <span key={s.size} className="mt-0.5 flex items-baseline justify-between gap-3 text-[15px]">
                      <b>{s.size}</b>
                      <span className="text-right tabular-nums">{t("bottlesEach", { bottles: formatNumber(s.bottles), per: perBottleText(s.perBottle, item.unit, lang) })}</span>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="gd-materials" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="gd-materials" className="t-card-title">
            {t("materials")}
          </h2>
          {addLinks ? <AddLink href={addLinks.material} label={t("addMaterial")} /> : null}
        </div>
        {(onPhoto && items.some((i) => !i.hasPhoto)) || (onProductPhoto && products.some((p) => !p.hasPhoto)) ? <p className="t-caption -mt-2">{t("photoTip")}</p> : null}
        {shelves.map((s) => (
          <div key={s.shelf} className="flex flex-col gap-2">
            <h3 className="text-[17px] font-bold">{SHELF_WORD[s.shelf][lang]}</h3>
            <div className="grid grid-cols-2 gap-2 min-[700px]:grid-cols-3 min-[1000px]:grid-cols-4">
              {s.items.map((i) => (
                <ItemTile key={i.id} item={i} name={nameOf(i)} sub={subOf(i)} lang={lang} photo={photoButton(i)} extra={extraFor(i)} />
              ))}
            </div>
          </div>
        ))}
      </section>

      <section aria-labelledby="gd-ready" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="gd-ready" className="t-card-title">
            {t("ready")}
          </h2>
          {addLinks ? <AddLink href={addLinks.product} label={t("addProduct")} /> : null}
        </div>
        <div className="grid grid-cols-2 gap-2 min-[700px]:grid-cols-3 min-[1000px]:grid-cols-4">
          {products.map((p) => (
            <ProductTile key={p.id} product={p} lang={lang} photo={productPhotoButton(p)} />
          ))}
        </div>
      </section>

      <section aria-labelledby="gd-today" className="sp-card g-pad">
        <h2 id="gd-today" className="t-card-title">
          {t("today")}
        </h2>
        {events.length ? (
          <ul className="mt-2 flex flex-col divide-y divide-line-soft">
            {events.map((e) => {
              const item = e.kind === "made" ? undefined : byId.get(e.itemId);
              const product = e.kind === "made" ? productById.get(e.productId) : undefined;
              const icon = e.kind === "in" ? <TruckIcon className="h-5 w-5" /> : e.kind === "made" ? <BoxIcon className="h-5 w-5" /> : <ListIcon className="h-5 w-5" />;
              const itemName = item ? nameOf(item) : "";
              const text =
                e.kind === "in"
                  ? `+${item ? itemQty(item, e.qty, lang) : formatNumber(e.qty)} · ${itemName}`
                  : e.kind === "made"
                    ? `${product ? productQty(product, e.units, lang) : formatNumber(e.units)} · ${product?.name ?? ""}`
                    : `${t("count")} · ${itemName}`;
              const diff =
                e.kind === "count" && item
                  ? e.diff === 0
                    ? t("countedSame")
                    : t(e.diff > 0 ? "countedMore" : "countedLess", { n: itemQty(item, Math.abs(e.diff), lang) })
                  : null;
              return (
                <li key={e.id} className="flex items-start gap-3 py-2.5">
                  <span className="mt-0.5 text-muted">{icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{text}</span>
                    {diff ? <span className={`block text-[14px] ${e.kind === "count" && e.diff < 0 ? "font-semibold text-bad" : "text-muted"}`}>{diff}</span> : null}
                    {(e.kind === "in" || e.kind === "count") && e.kg ? (
                      <span className="block text-[14px] text-muted">
                        {formatNumber(e.kg)} {WORDS[lang].kg}
                      </span>
                    ) : null}
                    {e.kind === "in" && e.photo ? (
                      <a href={e.photo} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-[14px] font-semibold underline underline-offset-2">
                        <CameraIcon className="h-4 w-4" />
                        {t("bill")}
                      </a>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-right text-[13px] text-muted">
                    {time(e.at)}
                    <span className="block">{e.who}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="t-caption mt-1">{t("nothing")}</p>
        )}
      </section>

      {flow && current ? (
        <div role="dialog" aria-modal="true" aria-label={current.label} className="fixed inset-0 z-50 flex flex-col bg-canvas">
          <header className="flex items-center gap-3 border-b border-line-soft px-4 py-3">
            <button
              type="button"
              onClick={() => (flow.saved || !flow.pick ? setFlow(null) : setFlow({ ...flow, pick: null, boxes: "", loose: "", photo: null }))}
              className="flex h-12 items-center gap-1.5 rounded-[12px] border-2 border-frame px-3 text-[16px] font-bold focus-ring"
            >
              <BackIcon className="h-5 w-5" />
              {t("back")}
            </button>
            <span className={`${current.stage} flex items-center gap-2 text-[20px] font-extrabold`} style={{ color: "var(--stage-text)" }}>
              {current.icon}
              {current.label}
            </span>
          </header>

          <div className="flex-1 overflow-auto px-4 py-5">
            {flow.saved ? (
              <div className="flex flex-col items-center gap-3 pt-6 text-center">
                <span className="grid h-24 w-24 place-items-center rounded-full bg-ok text-white">
                  <CheckIcon className="h-12 w-12" />
                </span>
                <p className="text-[26px] font-extrabold">{t("saved")}</p>
                <p className="text-[20px] font-semibold">
                  {flow.kind === "made" && pickedProduct
                    ? `${typedText} · ${pickedProduct.name}`
                    : `${flow.kind === "in" ? "+" : ""}${boxEntry ? typedText : pickedItem ? itemQty(pickedItem, flow.saved.qty, lang) : formatNumber(flow.saved.qty)} · ${pickedItem ? nameOf(pickedItem) : ""}`}
                </p>
                {boxEntry ? (
                  <p className="text-[18px] font-semibold text-muted">
                    = {formatNumber(flow.saved.qty)} {unitWord}
                  </p>
                ) : null}
                {flow.saved.kg ? (
                  <p className="text-[18px] font-semibold text-muted">
                    {formatNumber(flow.saved.kg)} {WORDS[lang].kg}
                  </p>
                ) : null}
                {flow.kind === "count" && pickedItem && flow.saved.diff !== undefined ? (
                  <p className={`text-[18px] font-semibold ${flow.saved.diff < 0 ? "text-bad" : "text-muted"}`}>
                    {flow.saved.diff === 0 ? t("countedSame") : t(flow.saved.diff > 0 ? "countedMore" : "countedLess", { n: itemQty(pickedItem, Math.abs(flow.saved.diff), lang) })}
                  </p>
                ) : null}
              </div>
            ) : !flow.pick ? (
              <>
                <p className="mb-4 text-[24px] font-extrabold">{flow.kind === "in" ? t("whatCame") : flow.kind === "made" ? t("whatMade") : t("whatCount")}</p>
                {flow.kind === "made" ? (
                  <div className="grid grid-cols-2 gap-2 min-[700px]:grid-cols-4">
                    {products.map((p) => (
                      <ProductTile key={p.id} product={p} lang={lang} onClick={() => pick(p.id)} />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    {shelves.map((s) => (
                      <div key={s.shelf} className="flex flex-col gap-2">
                        <h3 className="text-[18px] font-bold">{SHELF_WORD[s.shelf][lang]}</h3>
                        <div className="grid grid-cols-2 gap-2 min-[700px]:grid-cols-4">
                          {s.items.map((i) => (
                            <ItemTile key={i.id} item={i} name={nameOf(i)} sub={subOf(i)} lang={lang} onClick={() => pick(i.id)} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="mx-auto flex max-w-[520px] flex-col gap-5">
                <div className="flex items-center gap-3">
                  <Picture src={pickedItem?.photo ?? pickedProduct?.photo} name={pickedItem ? nameOf(pickedItem) : (pickedProduct?.name ?? "")} size={72} />
                  <span className="min-w-0">
                    <span className="block text-[22px] font-extrabold leading-tight">{pickedItem ? nameOf(pickedItem) : pickedProduct?.name}</span>
                    {pickedItem && subOf(pickedItem) ? <span className="mt-0.5 block text-[15px] text-muted">{subOf(pickedItem)}</span> : null}
                  </span>
                </div>
                {weighed ? (
                  // A sticker: two boxes to type in, its weight and its total pieces.
                  <>
                    <p className="text-center text-[24px] font-extrabold">{t("stickerPrompt")}</p>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="flex flex-col items-center gap-1.5 text-[18px] font-bold">
                        {WORDS[lang].kg}
                        <input
                          inputMode="decimal"
                          value={flow.kg}
                          placeholder="0"
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => setFlow({ ...flow, kg: decimalOnly(e.target.value) })}
                          className="input h-20 w-full text-center text-[36px] font-extrabold tabular-nums"
                        />
                      </label>
                      <label className="flex flex-col items-center gap-1.5 text-[18px] font-bold">
                        {t("totalPieces")}
                        <input
                          inputMode="numeric"
                          value={flow.loose}
                          placeholder="0"
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => setFlow({ ...flow, loose: e.target.value.replace(/\D/g, "").slice(0, 9) })}
                          className="input h-20 w-full text-center text-[36px] font-extrabold tabular-nums"
                        />
                      </label>
                    </div>
                  </>
                ) : boxEntry ? (
                  // Boxes: how many, and how many in each ("30 boxes, 40 in each"), with − and + as everywhere.
                  <>
                    <p className="text-center text-[24px] font-extrabold">{t(flow.kind === "in" ? "boxesCame" : "boxesPacked")}</p>
                    <Stepper value={flow.boxes} onChange={(v) => setFlow({ ...flow, boxes: v })} label={boxWord(boxCount, lang)} />
                    <p className="text-center text-[22px] font-extrabold">{t("boxHolds", { unit: WORDS[lang][unit] })}</p>
                    <Stepper value={flow.perBox} onChange={(v) => setFlow({ ...flow, perBox: v })} label={WORDS[lang][unit]} decimal={unit !== "pcs"} />
                  </>
                ) : (
                  <>
                    {/* A count: how much a box holds (the warehouse person says it; the owner sees it), boxes on the shelf, loose ones. */}
                    {saysBox ? (
                      <>
                        <p className="text-center text-[20px] font-bold">{t("boxHolds", { unit: WORDS[lang][unit] })}</p>
                        <Stepper value={flow.perBox} onChange={(v) => setFlow({ ...flow, perBox: v })} label={WORDS[lang][unit]} decimal={unit !== "pcs"} small />
                      </>
                    ) : null}
                    {perBox || saysBox ? (
                      <>
                        <p className="text-center text-[24px] font-extrabold">{t("countBoxes")}</p>
                        <Stepper value={flow.boxes} onChange={(v) => setFlow({ ...flow, boxes: v })} label={boxWord(Number(flow.boxes) || 0, lang)} />
                        <p className="text-center text-[20px] font-bold">{t("andLoose", { unit: WORDS[lang][unit] })}</p>
                        <Stepper value={flow.loose} onChange={(v) => setFlow({ ...flow, loose: v })} label={WORDS[lang][unit]} decimal={unit !== "pcs"} small />
                        {perBox && !saysBox ? (
                          <p className="-mt-2 text-center text-[15px] text-muted">
                            1 {boxWord(1, lang)} = {formatNumber(perBox)} {WORDS[lang][unit]}
                          </p>
                        ) : null}
                        {needsBox ? <p className="text-center text-[16px] font-semibold text-bad">{t("boxFirst")}</p> : null}
                      </>
                    ) : (
                      <>
                        <p className="text-center text-[24px] font-extrabold">{t("howManyOf", { unit: WORDS[lang][unit] })}</p>
                        <Stepper value={flow.loose} onChange={(v) => setFlow({ ...flow, loose: v })} label={WORDS[lang][unit]} decimal={unit !== "pcs"} />
                      </>
                    )}
                  </>
                )}
                {boxEntry && amount > 0 ? (
                  // Once both are said: what will be saved.
                  <p className="text-center text-[20px] font-bold">
                    = {typedText} = {formatNumber(amount)} {unitWord}
                  </p>
                ) : null}
                {!boxEntry && (pickedItem || pickedProduct) ? (
                  <p className="text-center text-[18px] font-semibold">
                    = {formatNumber(amount)} {WORDS[lang][unit]} {t("inAll")}
                    {flow.kind === "count" && pickedItem ? <span className="block text-[15px] font-normal text-muted">{t("appHad", { n: itemQty(pickedItem, Math.max(0, pickedItem.onHand), lang) })}</span> : null}
                  </p>
                ) : null}
                {flow.kind === "made" && pickedProduct && amount > 0 ? (
                  <div className="rounded-[14px] border border-line-soft p-3">
                    <p className="font-bold">{t("thisUses")}</p>
                    {pickedProduct.recipe.length ? (
                      <ul className="mt-2 flex flex-col gap-2">
                        {usesPacked(pickedProduct, amount, boxCount).map((u) => {
                          const it = byId.get(u.itemId);
                          const short = !it || it.onHand < u.qty;
                          return (
                            <li key={u.itemId} className="flex items-center gap-3">
                              <Picture src={it?.photo} name={it ? nameOf(it) : "?"} size={40} />
                              <span className="min-w-0 flex-1">
                                <span className="block font-semibold">{it ? nameOf(it) : u.itemId}</span>
                                {/* A chemical: the liquid that was, as he mixed it. */}
                                {u.litres ? <span className="block text-[14px] text-muted">{t("ofLiquid", { litres: `${formatNumber(u.litres)} ${litreWord}` })}</span> : null}
                                {short ? <span className="block text-[14px] font-semibold text-bad">{t("notEnough")}</span> : null}
                              </span>
                              <span className={`shrink-0 font-bold tabular-nums ${short ? "text-bad" : ""}`}>{it ? `${formatNumber(u.qty)} ${WORDS[lang][it.unit]}` : formatNumber(u.qty)}</span>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="mt-1 text-[15px] text-muted">{t("noRecipe")}</p>
                    )}
                  </div>
                ) : null}
                {flow.kind === "in" ? (
                  <label className="mx-auto flex cursor-pointer items-center gap-2 rounded-[12px] border-2 border-dashed border-frame px-4 py-3 text-[16px] font-semibold text-muted">
                    {flow.photo ? <CheckIcon className="h-6 w-6 text-ok" /> : <CameraIcon className="h-6 w-6" />}
                    {flow.photo ? `${t("bill")} ✓` : t("photoBill")}
                    <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => setFlow({ ...flow, photo: e.target.files?.[0] ?? null })} />
                  </label>
                ) : null}
              </div>
            )}
          </div>

          <footer className="border-t border-line-soft px-4 py-3">
            {flow.saved ? (
              <button type="button" onClick={() => setFlow(null)} className="h-16 w-full rounded-[14px] bg-ok text-[22px] font-extrabold text-white focus-ring">
                {t("done")}
              </button>
            ) : flow.pick ? (
              <button
                type="button"
                disabled={busy || needsBox || (flow.kind !== "count" && amount <= 0) || (flow.kind === "count" && flow.boxes === "" && flow.loose === "")}
                onClick={save}
                className="h-16 w-full rounded-[14px] bg-accent text-[22px] font-extrabold text-accent-ink focus-ring disabled:opacity-40"
              >
                {busy ? "..." : `${t("save")} ✓`}
              </button>
            ) : null}
          </footer>
        </div>
      ) : null}
    </div>
  );
}
