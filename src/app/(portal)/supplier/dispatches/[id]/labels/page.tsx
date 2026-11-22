import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Label, LABEL_CSS } from "@/components/supplier/label";
import { PrintButton } from "@/components/supplier/print-button";
import { PageTitle, buttonClass } from "@/components/ui";
import { requirePortalUser } from "@/lib/auth";
import { formatDate, formatNumber } from "@/lib/format";
import { loadDispatch } from "@/server/supplier-data";

export const metadata: Metadata = { title: "Labels" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Labels sent to the printer in one go. */
const BATCH = 250;

/**
 * The labels of a dispatch, one per carton, ready to print. Shows the labels still to scan (void and scanned ones are
 * left out, so a reprint or a second print run never duplicates a label already on a carton); "all" shows every label
 * that is not void.
 */
export default async function LabelsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePortalUser();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const detail = await loadDispatch(id);
  if (!detail || detail.dispatch.supplier_id !== user.supplierId) notFound();
  const { dispatch, cartons } = detail;

  const all = sp.show === "all";
  const one = typeof sp.carton === "string" && UUID.test(sp.carton) ? sp.carton : null;
  const pool = one ? cartons.filter((c) => c.id === one && c.status !== "void") : cartons.filter((c) => (all ? c.status !== "void" : c.status === "issued"));
  const pages = Math.max(1, Math.ceil(pool.length / BATCH));
  const page = Math.min(pages, Math.max(1, Number(typeof sp.batch === "string" ? sp.batch : "1") || 1));
  const shown = pool.slice((page - 1) * BATCH, page * BATCH);
  const base = `/supplier/dispatches/${id}`;
  const query = (batch: number) => `${base}/labels?${all ? "show=all&" : ""}batch=${batch}`;
  const open = dispatch.status === "planned" || dispatch.status === "loading";

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: LABEL_CSS }} />
      <div className="print:hidden">
        <PageTitle
          title={`Dispatch ${dispatch.number}: labels`}
          sub={`${formatNumber(pool.length)} ${all ? "labels (void ones left out)" : "labels still to scan"}${pages > 1 ? ` · batch ${page} of ${pages}: labels ${shown[0]?.carton_no} to ${shown[shown.length - 1]?.carton_no}` : ""}`}
          action={
            <>
              <Link href={base} className={buttonClass("row")}>
                Back to dispatch
              </Link>
              {shown.length ? <PrintButton label={`Print ${formatNumber(shown.length)} labels`} /> : null}
            </>
          }
        />
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Link href={`${base}/labels`} className={buttonClass(all || one ? "row" : "secondary")}>
            Still to scan
          </Link>
          <Link href={`${base}/labels?show=all`} className={buttonClass(all ? "secondary" : "row")}>
            All labels
          </Link>
          {pages > 1
            ? Array.from({ length: pages }, (_, i) => (
                <Link key={i} href={query(i + 1)} className={buttonClass(page === i + 1 ? "secondary" : "row")} aria-current={page === i + 1 ? "page" : undefined}>
                  Batch {i + 1}
                </Link>
              ))
            : null}
        </div>
        <p className="t-caption mb-3">
          Each label is one carton and can be scanned once. Label size 100 × 75 mm, one per page: in the print window choose that paper size and no margins. A solid black band is a hard carton; a dashed frame is a 2-ply carton.
          {open ? " A damaged label: use Reprint on the dispatch page, which voids the old number." : " This dispatch is closed: printing is for reference only."}
        </p>
      </div>
      {shown.length ? (
        <div className="vr-label-sheet">
          {shown.map((c) => (
            <Label key={c.id} carton={c} dispatchNo={dispatch.number} due={formatDate(dispatch.due_on)} />
          ))}
        </div>
      ) : (
        <p className="t-caption print:hidden">No labels to print here.</p>
      )}
    </>
  );
}
