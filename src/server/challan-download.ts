import "server-only";
import { challanCut, challanPdf, challanRows } from "@/lib/challan-pdf";
import type { DispatchDetail, ProductRow } from "@/server/supplier-data";

const text = (body: string, status: number) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

/**
 * BIGICON's stock receipt challan for a dispatch: its cartons loaded by product, and when they were sent. Once it has
 * left, the time it was closed; while it is still loading, the cartons scanned so far and the time of the last scan
 * (`challanCut`), so a dispatch that goes out short is not held up by closing. `inline` opens it in the browser instead
 * of downloading it.
 */
export async function challanDownload(detail: DispatchDetail, supplierName: string, products: Pick<ProductRow, "id" | "master_code">[], inline = false): Promise<Response> {
  const { dispatch, cartons } = detail;
  if (dispatch.status === "cancelled") return text("A cancelled dispatch has no challan.", 404);
  const cut = challanCut(dispatch, cartons, new Date().toISOString());
  if (!cut) return text("Scan the cartons first: the challan has the cartons scanned.", 404);
  const skus = new Map(products.map((p) => [p.id, p.master_code]));
  const bytes = await challanPdf(challanRows(cut.cartons, skus), { sentAt: cut.sentAt, title: `${supplierName} dispatch ${dispatch.number} challan` });
  const safe = supplierName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "supplier";
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safe}-dispatch-${dispatch.number}-challan.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
