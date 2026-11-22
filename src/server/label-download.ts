import "server-only";
import { formatDate } from "@/lib/format";
import { labelsPdf, type LabelFormat } from "@/lib/label-pdf";
import type { DispatchDetail } from "@/server/supplier-data";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The labels of a dispatch as a PDF download. Which labels:
 *   ?carton=<id>  that one label (after a reprint)
 *   ?show=all     every label that is not void
 *   otherwise     the labels still to scan, or every label that is not void once the dispatch is closed
 * ?format=a4 gives A4 sheets of 16; otherwise one 100 x 75 mm label per page.
 */
export async function labelsDownload(detail: DispatchDetail, supplierName: string, search: URLSearchParams): Promise<Response> {
  const { dispatch, cartons } = detail;
  const open = dispatch.status === "planned" || dispatch.status === "loading";
  const one = search.get("carton");
  const all = search.get("show") === "all" || !open;
  const chosen = one && UUID.test(one)
    ? cartons.filter((c) => c.id === one && c.status !== "void")
    : cartons.filter((c) => (all ? c.status !== "void" : c.status === "issued"));
  if (!chosen.length) return new Response("There are no labels to download here.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });

  const format: LabelFormat = search.get("format") === "a4" ? "a4" : "single";
  const title = `${supplierName} dispatch ${dispatch.number} labels`;
  const bytes = await labelsPdf(
    chosen.map((c) => ({ carton_type: c.carton_type, product: c.product, units: c.units, carton_no: c.carton_no, barcode: c.barcode, weight_per_carton: c.weight_per_carton })),
    { dispatchNo: dispatch.number, due: formatDate(dispatch.due_on), title },
    format,
  );
  const safe = supplierName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "supplier";
  const name = `${safe}-dispatch-${dispatch.number}-labels${format === "a4" ? "-a4" : ""}${one ? "-reprint" : ""}.pdf`;
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
