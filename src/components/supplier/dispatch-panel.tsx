"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { WithPhoto } from "@/components/supplier/product-photo";
import { useToast } from "@/components/toast";
import { Card, Chip, SectionHead, buttonClass } from "@/components/ui";
import { formatDate, formatDateTime, formatNumber, noun } from "@/lib/format";
import { safeError } from "@/lib/redact";
import { createClient } from "@/lib/supabase/client";
import { CARTON_TYPE_LABEL, DISPATCH_STATUS_LABEL, dispatchCounts, labelsOwed, pendingKey, readPending, type CartonType, type DispatchStatus } from "@/lib/supplier";
import { cancelDispatch, closeDispatch, receiveDispatch, reprintCarton, requestLabels, setDispatchPhoto, voidCarton, voidUnusedLabels } from "@/server/actions/supplier";
import type { ActionResult } from "@/lib/types";
import type { DispatchDetail } from "@/server/supplier-data";

const STATUS_TONE: Record<DispatchStatus, "neutral" | "info" | "warn" | "ok" | "bad"> = { planned: "neutral", loading: "info", closed: "warn", received: "ok", cancelled: "bad" };
export const DispatchStatusChip = ({ status }: { status: DispatchStatus }) => <Chip tone={STATUS_TONE[status]}>{DISPATCH_STATUS_LABEL[status]}</Chip>;

/** Scanned against planned for one carton type, as a bar. */
function TypeCounter({ type, planned, loaded, left }: { type: CartonType; planned: number; loaded: number; left: number }) {
  const pct = planned ? Math.min(100, Math.round((loaded / planned) * 100)) : 0;
  return (
    <div className="rounded-[10px] border-2 border-frame p-3">
      <p className="text-[15px] font-semibold">{CARTON_TYPE_LABEL[type]} cartons</p>
      <p className="t-score mt-1.5 text-[42px]">
        {formatNumber(loaded)}
        <span className="text-[20px]"> / {formatNumber(planned)}</span>
      </p>
      <div className="mt-2.5 h-3 overflow-hidden rounded-[3px] bg-panel2" role="progressbar" aria-valuemin={0} aria-valuemax={planned} aria-valuenow={loaded} aria-label={`${CARTON_TYPE_LABEL[type]} cartons scanned`}>
        <div className={`h-full ${loaded >= planned && planned > 0 ? "bg-ok" : "vr-bar"}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="t-caption mt-1.5 font-semibold">{left ? `${formatNumber(left)} ${left === 1 ? "label" : "labels"} not scanned` : planned ? "No label left to scan" : "None planned"}</p>
    </div>
  );
}

/**
 * One dispatch: its counts, the steps to finish it, and every label.
 *   who = "owner"    the supplier owner: everything, including cancelling a plan
 *   who = "scanner"  the supplier's warehouse person: scan, labels, photo, close
 *   who = "vrprime"  VRPRIME owner and admin: read, and mark a closed dispatch received
 */
export function DispatchPanel({ detail, who, base, photos = {} }: { detail: DispatchDetail; who: "owner" | "scanner" | "vrprime"; base: string; photos?: Record<string, string> }) {
  const { dispatch: d, lines, cartons, photoUrl } = detail;
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [showVoid, setShowVoid] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

  const counts = dispatchCounts(lines, cartons);
  const open = d.status === "planned" || d.status === "loading";
  // Labels the inventory software has still to make (a new plan starts with none; a reprint owes one).
  const owed = open ? labelsOwed(lines, cartons) : 0;
  const made = counts.planned - owed;
  const arrived = cartons.filter((c) => c.inbound_status === "received").length;
  const supplierSide = who !== "vrprime";
  const run = (action: () => Promise<ActionResult>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    startTransition(async () => {
      if (toast.result(await action())) router.refresh();
    });
  };

  const reprint = (cartonId: string, no: number) => {
    if (!window.confirm(`Reprint label ${no}? The old label becomes void and the inventory software makes a new one.`)) return;
    startTransition(async () => {
      if (toast.result(await reprintCarton(cartonId))) window.setTimeout(() => router.refresh(), 5000);
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

  const shownCartons = showVoid ? cartons : cartons.filter((c) => c.status !== "void");
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
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <TypeCounter type="H" {...counts.byType.H} />
          <TypeCounter type="T" {...counts.byType.T} />
        </div>
        <p className="mt-3 text-[15px]">
          <span className="font-semibold tabular-nums">{formatNumber(counts.loaded)}</span> of {formatNumber(counts.planned)} {noun(counts.planned, "carton")} scanned · <span className="tabular-nums">{formatNumber(counts.units)}</span> {noun(counts.units, "unit")} loaded
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
              {supplierSide && (d.labels_error || !d.labels_run_at) ? (
                <button type="button" disabled={pending} onClick={() => run(() => requestLabels(d.id))} className={buttonClass("row")}>
                  Try again
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {(open && supplierSide) || (d.status !== "cancelled" && cartons.length > 0) ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {open && supplierSide ? (
              <Link href={`${base}/${d.id}/scan`} className={buttonClass("primary")}>
                Scan cartons
              </Link>
            ) : null}
            {cartons.length > 0 && d.status !== "cancelled" ? (
              <>
                {/* Plain links: the browser downloads the PDF (a Link would try to open it as a page). */}
                <a href={`${base}/${d.id}/labels`} download className={buttonClass(open && supplierSide ? "outline" : "primary")}>
                  Download labels (PDF)
                </a>
                <a href={`${base}/${d.id}/labels?format=a4`} download className={buttonClass("outline")}>
                  Download A4 sheet (16 per page)
                </a>
              </>
            ) : null}
          </div>
        ) : null}
        {cartons.length > 0 && d.status !== "cancelled" ? (
          <p className="t-caption mt-2">
            {open ? "Labels still to scan." : "Every label of the dispatch."} The first is one label per page, 100 × 75 mm, for a label printer. The A4 sheet fits
            2 × 8 labels of 99.1 × 33.9 mm: print at actual size (100%), not &quot;fit to page&quot;.
          </p>
        ) : null}
      </Card>

      {open && supplierSide ? (
        <Card className="g-pad">
          <SectionHead title="Close the dispatch" sub="All three are needed. Closing locks the record." />
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
            <input ref={photoRef} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Photo of the loaded vehicle" onChange={(e) => e.target.files?.[0] && void uploadPhoto(e.target.files[0])} />
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
            {who === "owner" && d.status === "planned" ? (
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
              <th scope="col" className="min-w-[170px]">Product</th>
              <th scope="col">Carton</th>
              <th scope="col" className="num">Units / carton</th>
              <th scope="col" className="num">Cartons</th>
              <th scope="col" className="num">Units</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={`${l.product_id}-${l.carton_type}`}>
                <th scope="row" className="text-left font-semibold">
                  <WithPhoto src={photos[l.product_id]} name={l.product} />
                </th>
                <td>{CARTON_TYPE_LABEL[l.carton_type]}</td>
                <td className="num tabular-nums">{formatNumber(l.units_per_carton)}</td>
                <td className="num tabular-nums">{formatNumber(l.cartons)}</td>
                <td className="num tabular-nums">{formatNumber(l.cartons * l.units_per_carton)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="ledger-card">
        <div className="g-pad pb-0">
          <SectionHead
            title="Labels"
            sub={`${formatNumber(cartons.length)} made by the VRPRIME inventory software: every one is loaded, void, or still to scan.`}
            action={
              counts.voided ? (
                <button type="button" onClick={() => setShowVoid((v) => !v)} className={buttonClass("row")}>
                  {showVoid ? "Hide void labels" : `Show ${formatNumber(counts.voided)} void`}
                </button>
              ) : undefined
            }
          />
        </div>
        <table className="ledger">
          <thead>
            <tr>
              <th scope="col" className="num">No.</th>
              <th scope="col" className="min-w-[170px]">Product</th>
              <th scope="col">Carton</th>
              <th scope="col">Barcode</th>
              <th scope="col">Status</th>
              <th scope="col">Label</th>
              {open && supplierSide ? (
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {shownCartons.slice(0, 600).map((c) => (
              <tr key={c.id} className={c.status === "void" ? "opacity-60" : ""}>
                <td className="num tabular-nums">{c.carton_no}</td>
                <th scope="row" className="text-left font-normal">{c.product}</th>
                <td>{CARTON_TYPE_LABEL[c.carton_type]}</td>
                <td className="font-mono text-[14px]">{c.barcode}</td>
                <td>
                  {c.inbound_status === "received" ? <Chip tone="ok">Arrived at VRPRIME</Chip> : c.status === "loaded" ? <Chip tone="info">Loaded{c.loaded_at ? ` ${formatDateTime(c.loaded_at)}` : ""}</Chip> : c.status === "void" ? <Chip tone="bad">Void{c.void_reason ? `: ${c.void_reason}` : ""}</Chip> : <Chip>To scan</Chip>}
                </td>
                <td className="whitespace-nowrap">
                  {c.status === "void" ? (
                    <span className="t-caption">-</span>
                  ) : (
                    <>
                      <a href={`${base}/${d.id}/labels?carton=${c.id}`} download className={buttonClass("row")} aria-label={`Download label ${c.carton_no}, 100 by 75 millimetres`}>
                        Download
                      </a>{" "}
                      <a href={`${base}/${d.id}/labels?carton=${c.id}&format=a4`} download className={buttonClass("row")} aria-label={`Download label ${c.carton_no} on an A4 sheet`}>
                        A4
                      </a>
                    </>
                  )}
                </td>
                {open && supplierSide ? (
                  <td className="whitespace-nowrap text-right">
                    {c.status === "issued" ? (
                      <>
                        <button type="button" disabled={pending} onClick={() => reprint(c.id, c.carton_no)} className={buttonClass("row")}>
                          Reprint
                        </button>{" "}
                        <button type="button" disabled={pending} onClick={() => run(() => voidCarton(c.id, "not used"), `Void label ${c.carton_no}? It can no longer be scanned.`)} className={buttonClass("row")}>
                          Void
                        </button>
                      </>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        {shownCartons.length > 600 ? <p className="t-caption g-pad">Showing the first 600 of {formatNumber(shownCartons.length)} labels.</p> : null}
      </Card>
    </div>
  );
}
