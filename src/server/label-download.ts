import "server-only";
import { labelParts, labelsToDownload } from "@/lib/dispatch-view";
import { formatDate } from "@/lib/format";
import { labelsPdf, type LabelFormat } from "@/lib/label-pdf";
import type { DispatchDetail } from "@/server/supplier-data";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (body: string, status: number) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

/**
 * The labels of a dispatch as a PDF download. Which labels:
 *   ?carton=<id>  that one label (after a reprint)
 *   ?show=all     every label that is not void
 *   otherwise     the labels still to scan, or every label that is not void once the dispatch is closed
 * ?part=N keeps part N of those, as the inventory software makes them: at most 50 of a product (see labelParts).
 * ?format=a4 gives A4 sheets of 16; otherwise one 100 x 75 mm label per page.
 */
export async function labelsDownload(detail: DispatchDetail, supplierName: string, search: URLSearchParams): Promise<Response> {
  const { dispatch, cartons } = detail;
  const open = dispatch.status === "planned" || dispatch.status === "loading";
  const one = search.get("carton");
  const all = search.get("show") === "all" || !open;
  let chosen = one && UUID.test(one) ? cartons.filter((c) => c.id === one && c.status !== "void") : labelsToDownload(cartons, !all);

  let part: { n: number; of: number } | null = null;
  const asked = search.get("part");
  if (asked !== null && !(one && UUID.test(one))) {
    const parts = labelParts(chosen);
    const hit = /^\d{1,4}$/.test(asked) ? parts.find((p) => p.part === Number(asked)) : undefined;
    // Cartons scanned since the page was opened move the parts: the page shows them again after a refresh.
    if (!hit) return text("This part has no labels any more. Go back and refresh the dispatch page.", 404);
    chosen = hit.labels;
    part = { n: hit.part, of: parts.length };
  }
  if (!chosen.length) return text("There are no labels to download here.", 404);

  const format: LabelFormat = search.get("format") === "a4" ? "a4" : "single";
  const title = `${supplierName} dispatch ${dispatch.number} labels${part ? `, part ${part.n} of ${part.of}` : ""}`;
  const bytes = await labelsPdf(
    chosen.map((c) => ({ product: c.product, units: c.units, carton_no: c.carton_no, barcode: c.barcode, weight_per_carton: c.weight_per_carton })),
    { dispatchNo: dispatch.number, due: formatDate(dispatch.due_on), title },
    format,
  );
  const safe = supplierName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "supplier";
  const name = `${safe}-dispatch-${dispatch.number}-labels${part ? `-part-${part.n}-of-${part.of}` : ""}${format === "a4" ? "-a4" : ""}${one ? "-reprint" : ""}.pdf`;
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
