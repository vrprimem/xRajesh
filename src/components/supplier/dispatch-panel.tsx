"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { AddProducts } from "@/components/supplier/dispatch-edit";
import { LabelGroups } from "@/components/supplier/label-groups";
import { WithPhoto } from "@/components/supplier/product-photo";
import { useToast } from "@/components/toast";
import { Card, Chip, SectionHead, buttonClass } from "@/components/ui";
import { cartonRanges, labelParts, labelsToDownload, loadedKg, partSummary, plannedKg } from "@/lib/dispatch-view";
import { formatDate, formatDateTime, formatNumber, noun } from "@/lib/format";
import { safeError } from "@/lib/redact";
import { createClient } from "@/lib/supabase/client";
import { DISPATCH_STATUS_LABEL, dispatchCounts, labelsOwed, pendingKey, readPending, type DispatchStatus } from "@/lib/supplier";
import { cancelDispatch, closeDispatch, deleteDispatch, receiveDispatch, requestLabels, setDispatchPhoto, voidUnusedLabels } from "@/server/actions/supplier";
import type { ActionResult } from "@/lib/types";
import type { DispatchDetail, ProductRow } from "@/server/supplier-data";

// The stage colours: amber while it is to load, blue on the way, green once arrived, grey when cancelled.
const STATUS_TONE: Record<DispatchStatus, "neutral" | "info" | "warn" | "ok" | "bad"> = { planned: "warn", loading: "warn", closed: "info", received: "ok", cancelled: "neutral" };
export const DispatchStatusChip = ({ status }: { status: DispatchStatus }) => <Chip tone={STATUS_TONE[status]}>{DISPATCH_STATUS_LABEL[status]}</Chip>;

/** Cartons scanned against planned, as a bar. */
function CartonCounter({ planned, loaded, left }: { planned: number; loaded: number; left: number }) {
  const pct = planned ? Math.min(100, Math.round((loaded / planned) * 100)) : 0;
  return (
    <div className="rounded-[10px] border-2 border-frame p-3">
      <p className="text-[15px] font-semibold">Cartons scanned</p>
      <p className="t-score mt-1.5 text-[42px]">
        {formatNumber(loaded)}
        <span className="text-[20px]"> / {formatNumber(planned)}</span>
      </p>
      <div className="mt-2.5 h-3 overflow-hidden rounded-[3px] bg-panel2" role="progressbar" aria-valuemin={0} aria-valuemax={planned} aria-valuenow={loaded} aria-label="Cartons scanned">
        <div className={`h-full ${loaded >= planned && planned > 0 ? "bg-ok" : "vr-bar"}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="t-caption mt-1.5 font-semibold">{left ? `${formatNumber(left)} ${left === 1 ? "label" : "labels"} not scanned` : planned ? "No label left to scan" : "None planned"}</p>
    </div>
  );
}

/**
 * One dispatch: its counts, the steps to finish it, and every label.
 *   who = "owner"    the supplier owner: everything, including printing labels, closing and cancelling a plan
 *   who = "scanner"  the supplier's warehouse person: scan the cartons and add the vehicle photo, nothing more (no
 *                    printing, voiding or closing: those are the owner's)
 *   who = "vrprime"  VRPRIME owner and admin: read, download labels, mark a closed dispatch received, and delete a
 *                    dispatch for good (then go to `deletedHref`)
 * `products`: the supplier's products, for adding more to a dispatch still being loaded (the owner only).
 */
export function DispatchPanel({
  detail,
  who,
  base,
  photos = {},
  products = [],
  deletedHref,
}: {
  detail: DispatchDetail;
  who: "owner" | "scanner" | "vrprime";
  base: string;
  photos?: Record<string, string>;
  products?: ProductRow[];
  deletedHref?: string;
}) {
  const { dispatch: d, lines, cartons, photoUrl } = detail;
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

  const counts = dispatchCounts(lines, cartons);
  const open = d.status === "planned" || d.status === "loading";
  // Labels the inventory software has still to make (a new plan starts with none; a reprint owes one).
  const owed = open ? labelsOwed(lines, cartons) : 0;
  const made = counts.planned - owed;
  const arrived = cartons.filter((c) => c.inbound_status === "received").length;
  const supplierSide = who !== "vrprime";
  const owner = who === "owner";
  // The labels to download, in parts when a product has more than 50 (one part otherwise). Printing is not the
  // warehouse person's.
  const parts = d.status === "cancelled" || who === "scanner" ? [] : labelParts(labelsToDownload(cartons, open));
  // What the loaded cartons weigh, by their labels; what the plan weighs, by its lines (cartons with no weight left out).
  const loaded = loadedKg(cartons);
  const planned = plannedKg(lines);
  // BIGICON's stock receipt challan, filled in from the cartons loaded: once it has left, every carton and when it was
  // closed; while loading, the cartons scanned so far, so a vehicle that leaves short of the plan still gets its
  // challan without closing. The warehouse person gets it too: he hands it over with the cartons.
  const sent = (d.status === "closed" || d.status === "received") && counts.loaded > 0;
  const shortChallan = open && counts.loaded > 0;
  const run = (action: () => Promise<ActionResult>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    startTransition(async () => {
      if (toast.result(await action())) router.refresh();
    });
  };

  const close = () => {
    let waiting = 0;
    try {
      waiting = readPending(window.localStorage.getItem(pendingKey(d.id))).length;
    } catch {
      // Storage is unavailable: nothing can be waiting in it.
    }
    if (waiting) return toast.show(`${waiting} scans on this phone are still waiting to be sent. Open Scan cartons with a connection first.`, "bad");
    run(() => closeDispatch(d.id), "Close this dispatch? It is locked after that: no more scans, labels or changes.");
  };

  // VRPRIME deletes it for good; the page is then gone, so it goes on to `deletedHref`.
  const remove = (to: string) => {
    const text = [
      `Delete dispatch ${d.number} for good? It cannot be brought back.`,
      "",
      "Its labels, scans, challan and vehicle photo go with it.",
      ...(open ? ["The supplier is told not to load it."] : []),
      ...(counts.loaded
        ? [`The ${formatNumber(counts.loaded)} scanned ${noun(counts.loaded, "carton")} (${formatNumber(counts.units)} ${noun(counts.units, "piece")}) count as ready stock at the supplier again.`]
        : []),
      "Labels already printed stay in the VRPRIME inventory software as they are.",
    ];
    if (!window.confirm(text.join("\n"))) return;
    startTransition(async () => {
      if (toast.result(await deleteDispatch(d.id))) router.replace(to);
    });
  };

  const uploadPhoto = async (file: File) => {
    setUploading(true);
    try {
      const { default: imageCompression } = await import("browser-image-compression");
      const compressed = await imageCompression(file, { maxSizeMB: 0.4, maxWidthOrHeight: 1600, fileType: "image/jpeg", useWebWorker: true });
      const path = `${d.supplier_id}/${d.id}/${crypto.randomUUID()}.jpg`;
      const { error } = await createClient().storage.from("supplier-photos").upload(path, compressed, { contentType: "image/jpeg", upsert: false });
      if (error) throw error;
      if (toast.result(await setDispatchPhoto(d.id, path))) router.refresh();
    } catch (error) {
      console.error("Vehicle photo upload failed", safeError(error));
      toast.show("The photo could not be uploaded. Check your connection and try again.", "bad");
    } finally {
      setUploading(false);
      if (photoRef.current) photoRef.current.value = "";
    }
  };

  const steps = [
    { done: counts.loaded > 0, text: "At least one carton is scanned" },
    ...(owed > 0 ? [{ done: false, text: `${formatNumber(owed)} ${owed === 1 ? "label has" : "labels have"} not been made yet` }] : []),
    { done: counts.left === 0, text: counts.left ? `${formatNumber(counts.left)} ${counts.left === 1 ? "label is" : "labels are"} not scanned: scan, or void if unused` : "Every label is scanned or void" },
    { done: Boolean(d.vehicle_photo_path), text: "Photo of the loaded vehicle is attached" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Card className="g-pad">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <DispatchStatusChip status={d.status} />
          <p className="t-caption">
            Due {formatDate(d.due_on)}
            {d.closed_at ? ` · closed ${formatDateTime(d.closed_at)}` : ""}
            {d.received_at ? ` · received ${formatDateTime(d.received_at)}` : ""}
          </p>
        </div>
        {d.note ? <p className="mt-2 text-[15px]">{d.note}</p> : null}
        <div className="mt-3">
          <CartonCounter planned={counts.planned} loaded={counts.loaded} left={counts.left} />
        </div>
        <p className="mt-3 text-[15px]">
          <span className="font-semibold tabular-nums">{formatNumber(counts.units)}</span> {noun(counts.units, "unit")} loaded
          {open && planned.kg ? ` · ${formatNumber(loaded.kg)} of ${formatNumber(planned.kg)} kg` : loaded.kg ? ` · ${formatNumber(loaded.kg)} kg` : ""}
          {counts.voided ? ` · ${formatNumber(counts.voided)} ${counts.voided === 1 ? "label" : "labels"} void` : ""}
          {!open && d.status !== "cancelled" && counts.loaded ? ` · ${formatNumber(arrived)} of ${formatNumber(counts.loaded)} scanned in at VRPRIME` : ""}
        </p>

        {owed > 0 ? (
          <div className="mt-3 rounded-[12px] border border-warn bg-warn-soft px-3 py-2.5" role="status">
            <p className="text-[15px] font-semibold">
              Labels: {formatNumber(made)} of {formatNumber(counts.planned)} made by the VRPRIME inventory software
            </p>
            <p className="mt-0.5 text-[15px]">
              {d.labels_error
                ? `It stopped: ${d.labels_error}`
                : d.labels_run_at
                  ? "They are being made now. This takes a few seconds for every 50 labels."
                  : "The rest have not been asked for yet."}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" disabled={pending} onClick={() => router.refresh()} className={buttonClass("row")}>
                Refresh
              </button>
              {owner && (d.labels_error || !d.labels_run_at) ? (
                <button type="button" disabled={pending} onClick={() => run(() => requestLabels(d.id))} className={buttonClass("row")}>
                  Try again
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {(open && supplierSide) || parts.length === 1 || sent ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {open && supplierSide ? (
              <Link href={`${base}/${d.id}/scan`} className={buttonClass("primary")}>
                Scan cartons
              </Link>
            ) : null}
            {/* Plain links: the browser downloads the PDF (a Link would try to open it as a page). */}
            {sent ? (
              <a href={`${base}/${d.id}/challan`} download className={buttonClass("primary")}>
                Download challan (PDF)
              </a>
            ) : null}
            {shortChallan && supplierSide ? (
              <a href={`${base}/${d.id}/challan`} download className={buttonClass("outline")}>
                Challan for the {formatNumber(counts.loaded)} scanned {counts.loaded === 1 ? "carton" : "cartons"} (PDF)
              </a>
            ) : null}
            {parts.length === 1 ? (
              <>
                <a href={`${base}/${d.id}/labels`} download className={buttonClass((open && supplierSide) || sent ? "outline" : "primary")}>
                  Download labels (PDF)
                </a>
                <a href={`${base}/${d.id}/labels?format=a4`} download className={buttonClass("outline")}>
                  Download A4 sheet (16 per page)
                </a>
              </>
            ) : null}
          </div>
        ) : null}
        {parts.length > 1 ? (
          <div className="mt-4">
            <p className="text-[15px] font-semibold">Download the labels in {parts.length} parts</p>
            <p className="t-caption mt-0.5">The VRPRIME inventory software makes at most 50 labels of a product at a time, so a product&apos;s labels after its 50th come in the next part.</p>
            <ul className="mt-2 divide-y divide-line-soft rounded-[12px] border border-frame">
              {parts.map((p) => {
                const what = partSummary(p);
                return (
                  <li key={p.part} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">
                        Part {p.part}: {formatNumber(p.labels.length)} {noun(p.labels.length, "label")}
                      </span>
                      <span className="block text-[14px] text-muted">
                        {what.charAt(0).toUpperCase() + what.slice(1)} · cartons{" "}
                        {cartonRanges(p.labels.map((c) => c.carton_no))
                          .split(", ")
                          .map((run, i) => (
                            <span key={run} className="whitespace-nowrap">
                              {i ? ", " : ""}
                              {run}
                            </span>
                          ))}
                      </span>
                    </span>
                    <span className="flex w-full flex-wrap gap-2 min-[700px]:w-auto">
                      <a href={`${base}/${d.id}/labels?part=${p.part}`} download className={buttonClass("row")} aria-label={`Download part ${p.part}, ${p.labels.length} labels, 100 by 75 millimetres`}>
                        Download (PDF)
                      </a>
                      <a href={`${base}/${d.id}/labels?part=${p.part}&format=a4`} download className={buttonClass("row")} aria-label={`Download part ${p.part} on A4 sheets`}>
                        A4 sheet
                      </a>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        {sent ? (
          <p className="t-caption mt-2">
            The challan is BIGICON&apos;s stock receipt challan with every product sent (full cartons, pieces a carton, loose pieces and the total) and the
            day and time the dispatch was closed. The challan numbers, job code, tempo number and signature are written by hand.
          </p>
        ) : null}
        {shortChallan && supplierSide ? (
          <p className="t-caption mt-2">
            The vehicle is leaving with fewer cartons than planned? The challan has the cartons scanned so far, with the day and time of the last scan; it
            does not close the dispatch. Scan more and get it again: it always has every carton scanned.
          </p>
        ) : null}
        {parts.length ? (
          <p className="t-caption mt-2">
            {open ? "Labels still to scan." : "Every label of the dispatch."} The PDF is one label per page, 100 × 75 mm, for a label printer. The A4 sheet fits
            2 × 8 labels of 99.1 × 33.9 mm: print at actual size (100%), not &quot;fit to page&quot;.
          </p>
        ) : null}
      </Card>

      {open && supplierSide ? (
        <input ref={photoRef} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Photo of the loaded vehicle" onChange={(e) => e.target.files?.[0] && void uploadPhoto(e.target.files[0])} />
      ) : null}

      {open && who === "scanner" ? (
        <Card className="g-pad">
          <SectionHead title="Photo of the loaded vehicle" sub="Take it when the truck is loaded. The owner closes the dispatch." />
          <button type="button" disabled={uploading || pending} onClick={() => photoRef.current?.click()} className={buttonClass(d.vehicle_photo_path ? "outline" : "primary")}>
            {uploading ? "Uploading..." : d.vehicle_photo_path ? "Replace vehicle photo" : "Add vehicle photo"}
          </button>
        </Card>
      ) : null}

      {open && owner ? (
        <Card className="g-pad">
          <SectionHead title="Close the dispatch" sub="All three are needed. Closing locks the record. Sent fewer cartons than planned? Void the unused labels, then close." />
          <ul className="flex flex-col gap-1.5 text-[15px]">
            {steps.map((s) => (
              <li key={s.text} className="flex items-start gap-2">
                <span aria-hidden className={s.done ? "text-ok" : "text-faint"}>
                  {s.done ? "✓" : "○"}
                </span>
                <span className={s.done ? "" : "text-muted"}>
                  <span className="sr-only">{s.done ? "Done: " : "Not done: "}</span>
                  {s.text}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={uploading || pending} onClick={() => photoRef.current?.click()} className={buttonClass("outline")}>
              {uploading ? "Uploading..." : d.vehicle_photo_path ? "Replace vehicle photo" : "Add vehicle photo"}
            </button>
            {counts.left > 0 && counts.loaded > 0 ? (
              <button type="button" disabled={pending} onClick={() => run(() => voidUnusedLabels(d.id), counts.left === 1 ? "Void the 1 label that was not scanned? That carton is not on this dispatch." : `Void the ${counts.left} labels that were not scanned? Those cartons are not on this dispatch.`)} className={buttonClass("outline")}>
                Void {formatNumber(counts.left)} unused {counts.left === 1 ? "label" : "labels"}
              </button>
            ) : null}
            <button type="button" disabled={pending || steps.some((s) => !s.done)} onClick={close} className={buttonClass("primary")}>
              Close dispatch
            </button>
            {d.status === "planned" ? (
              <button type="button" disabled={pending} onClick={() => run(() => cancelDispatch(d.id), "Cancel this plan? All its labels become void.")} className={buttonClass("danger")}>
                Cancel plan
              </button>
            ) : null}
          </div>
        </Card>
      ) : null}

      {d.status === "planned" && who === "vrprime" ? (
        <Card className="g-pad">
          <SectionHead title="Cancel this plan?" sub="Only while nothing is loaded. Its labels become void here; in the inventory software they stay printed and unused." />
          <button type="button" disabled={pending} onClick={() => run(() => cancelDispatch(d.id), "Cancel this plan? All its labels become void.")} className={buttonClass("danger")}>
            Cancel plan
          </button>
        </Card>
      ) : null}

      {d.status === "closed" && who === "vrprime" ? (
        <Card className="g-pad">
          <SectionHead title="Received at VRPRIME?" sub="Cartons are marked arrived by themselves when the warehouse scans them in with the inventory software (checked every 30 minutes). Use this only if a dispatch arrived and its cartons will not be scanned." />
          <button type="button" disabled={pending} onClick={() => run(() => receiveDispatch(d.id), "Mark this dispatch as received?")} className={buttonClass("primary")}>
            Mark as received
          </button>
        </Card>
      ) : null}

      {photoUrl ? (
        <Card className="g-pad">
          <SectionHead title="Loaded vehicle" />
          {/* A signed link to a private file: next/image cannot fetch it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoUrl} alt="The loaded vehicle" className="max-h-[420px] w-auto max-w-full rounded-[12px] border border-line-soft" />
        </Card>
      ) : null}

      <Card className="ledger-card">
        <div className="g-pad pb-0">
          <SectionHead title="The plan" />
        </div>
        <table className="ledger">
          <thead>
            <tr>
              <th scope="col" className="min-w-[130px]">Product</th>
              <th scope="col" className="num">Cartons</th>
              <th scope="col" className="num">Weight</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const kg = plannedKg([l]);
              return (
                <tr key={`${l.product_id}-${l.carton_type}`}>
                  <th scope="row" className="py-2 text-left font-semibold">
                    <WithPhoto src={photos[l.product_id]} name={l.product}>
                      <span className="block">{l.product}</span>
                      <span className="block text-[14px] font-normal text-muted">{formatNumber(l.units_per_carton)} pieces a carton</span>
                    </WithPhoto>
                  </th>
                  <td className="num py-2">
                    <span className="block">{formatNumber(l.cartons)}</span>
                    <span className="block text-[14px] font-normal text-muted">{formatNumber(l.cartons * l.units_per_carton)} units</span>
                  </td>
                  <td className="num py-2">
                    {kg.kg ? (
                      <>
                        <span className="block whitespace-nowrap">{formatNumber(kg.kg)} kg</span>
                        <span className="block text-[14px] font-normal text-muted">{formatNumber(Number(l.weight_per_carton))} kg each</span>
                      </>
                    ) : (
                      <span className="block text-[14px] font-normal text-muted">No weight</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {lines.length > 1 ? (
            <tfoot>
              <tr>
                <th scope="row" className="border-t border-frame px-3 py-2 text-left">
                  Total
                </th>
                <td className="num border-t border-frame px-3 py-2 font-bold">
                  <span className="block">{formatNumber(lines.reduce((n, l) => n + l.cartons, 0))}</span>
                  <span className="block text-[14px] font-normal text-muted">{formatNumber(lines.reduce((n, l) => n + l.cartons * l.units_per_carton, 0))} units</span>
                </td>
                <td className="num border-t border-frame px-3 py-2 font-bold whitespace-nowrap">{planned.kg ? `${formatNumber(planned.kg)} kg` : "-"}</td>
              </tr>
            </tfoot>
          ) : null}
        </table>
        {planned.kg && planned.unweighed ? (
          <p className="t-caption g-pad pt-2">
            {formatNumber(planned.unweighed)} {noun(planned.unweighed, "carton")} with no weight {planned.unweighed === 1 ? "is" : "are"} not in the total.
          </p>
        ) : null}
      </Card>

      {open && who === "owner" ? <AddProducts dispatchId={d.id} products={products} lines={lines} photos={photos} /> : null}

      <LabelGroups dispatchId={d.id} base={base} lines={lines} cartons={cartons} canChange={open && owner} canPrint={who !== "scanner"} photos={photos} />

      {who === "vrprime" && deletedHref ? (
        <Card className="g-pad">
          <SectionHead
            title="Delete this dispatch permanently"
            sub={`For a dispatch made by mistake. Its labels, scans, challan and vehicle photo are deleted with it and cannot be brought back. Labels already printed stay in the VRPRIME inventory software as they are, and the number ${d.number} is not used again.`}
          />
          <button type="button" disabled={pending} onClick={() => remove(deletedHref)} className={buttonClass("outline", "text-bad")}>
            Delete permanently
          </button>
        </Card>
      ) : null}
    </div>
  );
}
