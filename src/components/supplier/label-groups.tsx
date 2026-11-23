"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { WithPhoto } from "@/components/supplier/product-photo";
import { useToast } from "@/components/toast";
import { Card, Chip, SectionHead, buttonClass } from "@/components/ui";
import { labelGroups } from "@/lib/dispatch-view";
import { formatDateTime, formatNumber, noun } from "@/lib/format";
import { cartonWeightFor } from "@/lib/supplier";
import { repackCartons, reprintCarton, voidCarton } from "@/server/actions/supplier";
import type { CartonRow, LineRow } from "@/server/supplier-data";

const OPEN_UP_TO = 12;

const whole = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN);
const kg = (v: string) => {
  const t = v.trim().replace(",", ".");
  return /^\d+(\.\d{1,3})?$/.test(t) ? Number(t) : NaN;
};
const kgText = (w: number | null) => (w ? `${formatNumber(w)} kg` : "no weight");

function StatusChip({ c }: { c: CartonRow }) {
  if (c.inbound_status === "received") return <Chip tone="ok">Arrived at VRPRIME</Chip>;
  if (c.status === "loaded") return <Chip tone="info">Loaded{c.loaded_at ? ` ${formatDateTime(c.loaded_at)}` : ""}</Chip>;
  if (c.status === "void") return <Chip tone="bad">Void{c.void_reason ? `: ${c.void_reason}` : ""}</Chip>;
  return <Chip>To scan</Chip>;
}

/**
 * A dispatch's labels by product: loaded of planned, then each label (still to scan first) with its
 * pieces, weight and downloads. While loading, the supplier can reprint, void, or change the pieces or weight of a
 * carton: the label shows both (and the inventory software adds the pieces to stock at VRPRIME), so a change gets a new
 * label. The weight follows the pieces until one is typed in, because the cartons are weighed at dispatch.
 */
export function LabelGroups({ dispatchId, base, lines, cartons, canChange, photos }: { dispatchId: string; base: string; lines: LineRow[]; cartons: CartonRow[]; canChange: boolean; photos: Record<string, string> }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [showVoid, setShowVoid] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [pieces, setPieces] = useState("");
  const [weight, setWeight] = useState("");
  const [weightSet, setWeightSet] = useState(false);
  // The carton the form started from: its weight for its pieces is what a new count is worked out from.
  const [start, setStart] = useState<{ units: number; weight: number | null }>({ units: 0, weight: null });
  const groups = labelGroups(lines, cartons);
  const voided = cartons.filter((c) => c.status === "void").length;

  const done = (ok: boolean, later = false) => {
    if (!ok) return;
    setEditing(null);
    router.refresh();
    // New labels arrive from the inventory software a few seconds later.
    if (later) window.setTimeout(() => router.refresh(), 6000);
  };
  const repack = (ids: string[]) => {
    const n = whole(pieces);
    const w = weight.trim() ? kg(weight) : null;
    if (!(n >= 1 && n <= 100000)) return toast.show("Enter the pieces in the carton: a whole number from 1.", "bad");
    if (w !== null && !(w > 0 && w <= 1000)) return toast.show("Enter the carton weight in kg, for example 8.5, or leave it empty.", "bad");
    startTransition(async () => done(toast.result(await repackCartons(ids, n, w)), true));
  };
  const reprint = (c: CartonRow) => {
    if (!window.confirm(`Reprint label ${c.carton_no}? The old label becomes void and the inventory software makes a new one.`)) return;
    startTransition(async () => done(toast.result(await reprintCarton(c.id)), true));
  };
  const voidIt = (c: CartonRow) => {
    if (!window.confirm(`Void label ${c.carton_no}? It can no longer be scanned.`)) return;
    startTransition(async () => done(toast.result(await voidCarton(c.id, "not used"))));
  };
  const edit = (key: string, c: CartonRow) => {
    setEditing(key);
    setPieces(String(c.units));
    setWeight(c.weight_per_carton ? String(c.weight_per_carton) : "");
    setWeightSet(false);
    setStart({ units: c.units, weight: c.weight_per_carton });
  };
  const changePieces = (v: string) => {
    setPieces(v);
    if (weightSet) return;
    const w = cartonWeightFor(start.weight, start.units, whole(v));
    setWeight(w === null ? "" : String(w));
  };

  const form = (ids: string[], many: boolean) => (
    <form
      noValidate
      className="flex w-full flex-col gap-3 rounded-[12px] border border-frame bg-surface2 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        repack(ids);
      }}
    >
      <p className="text-[15px] font-semibold">{many ? `Each of these ${ids.length} cartons` : "This carton"}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[14px] text-muted">
          Pieces
          <input autoFocus className="input w-28" inputMode="numeric" value={pieces} onChange={(e) => changePieces(e.target.value.replace(/\D/g, ""))} />
        </label>
        <label className="flex flex-col gap-1 text-[14px] text-muted">
          Weight (kg)
          <input className="input w-32" inputMode="decimal" placeholder="e.g. 8.5" value={weight} onChange={(e) => (setWeight(e.target.value.replace(/[^\d.,]/g, "")), setWeightSet(true))} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={pending} className={buttonClass("primary")}>
            {pending ? "Saving..." : many ? "Make new labels" : "Make a new label"}
          </button>
          <button type="button" disabled={pending} onClick={() => setEditing(null)} className={buttonClass("outline")}>
            Cancel
          </button>
        </div>
      </div>
      <p className="t-caption">
        {!weightSet && whole(pieces) !== start.units && weight ? "The weight is worked out from the pieces: weigh the carton and correct it if it differs. " : "Weigh the carton and enter what the scale shows. "}
        The label shows the pieces and weight, and VRPRIME&apos;s stock goes up by the pieces when the carton is scanned in, so {many ? "each carton gets a new label" : "the carton gets a new label"}. Stick it on in place of the old one, which becomes void.
      </p>
    </form>
  );

  return (
    <Card className="g-pad">
      <SectionHead
        title="Labels"
        sub={`${formatNumber(cartons.length)} made by the VRPRIME inventory software, by product: each is loaded, void, or still to scan.`}
        action={
          voided ? (
            <button type="button" onClick={() => setShowVoid((v) => !v)} className={buttonClass("row")}>
              {showVoid ? "Hide void labels" : `Show ${formatNumber(voided)} void`}
            </button>
          ) : undefined
        }
      />
      {groups.length === 0 ? (
        <p className="t-caption">No labels yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {groups.map((g) => {
            const key = g.product_id;
            const lineUnits = lines.find((l) => l.product_id === g.product_id)?.units_per_carton ?? null;
            const live = g.labels.filter((c) => c.status !== "void");
            const counts = [...new Set(live.map((c) => c.units))].sort((a, b) => b - a);
            const weights = [...new Set(live.map((c) => c.weight_per_carton))].sort((a, b) => (b ?? 0) - (a ?? 0));
            const shown = showVoid ? g.labels : live;
            const isOpen = open[key] ?? shown.length <= OPEN_UP_TO;
            const toScan = g.labels.filter((c) => c.status === "issued");
            const pct = g.planned ? Math.min(100, Math.round((g.loaded / g.planned) * 100)) : 0;
            return (
              <li key={key} className="rounded-[14px] border border-frame">
                <div className="flex flex-col gap-2 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <WithPhoto src={photos[g.product_id]} name={g.product} size={48}>
                      <span className="block font-semibold">{g.product}</span>
                      <span className="block text-[14px] text-muted">
                        {counts.length > 1 ? `${counts.join(" / ")} pieces` : `${counts[0] ?? lineUnits ?? "-"} pieces`} ·{" "}
                        {weights.length > 1 ? weights.map((w) => kgText(w)).join(" / ") : kgText(weights[0] ?? null)}
                        {counts.length <= 1 && weights.length <= 1 ? " each" : ""}
                      </span>
                    </WithPhoto>
                    <p className="text-[17px]">
                      <b className="tabular-nums">{formatNumber(g.loaded)}</b> of {formatNumber(g.planned)} loaded
                    </p>
                  </div>
                  <div className="h-3 overflow-hidden rounded-[3px] bg-panel2" role="progressbar" aria-valuemin={0} aria-valuemax={g.planned} aria-valuenow={g.loaded} aria-label={`${g.product} cartons loaded`}>
                    <div className={`h-full ${g.planned > 0 && g.loaded >= g.planned ? "bg-ok" : "vr-bar"}`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="t-caption">
                    {g.toScan ? `${formatNumber(g.toScan)} still to scan` : "Nothing left to scan"}
                    {g.arrived ? ` · ${formatNumber(g.arrived)} arrived at VRPRIME` : ""}
                    {g.voided ? ` · ${formatNumber(g.voided)} void` : ""}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {shown.length ? (
                      <button type="button" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [key]: !isOpen }))} className={buttonClass("row")}>
                        {isOpen ? "Hide labels" : `Show ${formatNumber(shown.length)} ${noun(shown.length, "label")}`}
                      </button>
                    ) : null}
                    {canChange && toScan.length > 1 && editing !== `all:${key}` ? (
                      <button type="button" disabled={pending} onClick={() => edit(`all:${key}`, toScan[0])} className={buttonClass("row")}>
                        Change pieces or weight of the {formatNumber(toScan.length)} to scan
                      </button>
                    ) : null}
                  </div>
                  {editing === `all:${key}` ? form(toScan.map((c) => c.id), true) : null}
                </div>
                {isOpen && shown.length ? (
                  <ul className="divide-y divide-line-soft border-t border-frame px-3">
                    {shown.map((c) => (
                      <li key={c.id} className={`flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 ${c.status === "void" ? "opacity-60" : ""}`}>
                        <span className="w-12 shrink-0 text-[17px] font-bold tabular-nums">#{c.carton_no}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-mono text-[14px]">{c.barcode}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-2">
                            <span className="t-caption">
                              {formatNumber(c.units)} pieces · {kgText(c.weight_per_carton)}
                            </span>
                            <StatusChip c={c} />
                          </span>
                        </span>
                        <span className="flex w-full flex-wrap gap-2 min-[700px]:w-auto">
                          {c.status !== "void" ? (
                            <>
                              <a href={`${base}/${dispatchId}/labels?carton=${c.id}`} download className={buttonClass("row")} aria-label={`Download label ${c.carton_no}, 100 by 75 millimetres`}>
                                Download
                              </a>
                              <a href={`${base}/${dispatchId}/labels?carton=${c.id}&format=a4`} download className={buttonClass("row")} aria-label={`Download label ${c.carton_no} on an A4 sheet`}>
                                A4
                              </a>
                            </>
                          ) : null}
                          {canChange && c.status === "issued" ? (
                            <>
                              <button type="button" disabled={pending} onClick={() => edit(c.id, c)} className={buttonClass("row")}>
                                Change pieces or weight
                              </button>
                              <button type="button" disabled={pending} onClick={() => reprint(c)} className={buttonClass("row")}>
                                Reprint
                              </button>
                              <button type="button" disabled={pending} onClick={() => voidIt(c)} className={buttonClass("row")}>
                                Void
                              </button>
                            </>
                          ) : null}
                        </span>
                        {editing === c.id ? form([c.id], false) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
