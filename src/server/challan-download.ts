import "server-only";
import { challanPdf, challanRows } from "@/lib/challan-pdf";
import type { DispatchDetail, ProductRow } from "@/server/supplier-data";

const text = (body: string, status: number) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

/**
 * BIGICON's stock receipt challan for a dispatch that has left (closed or received): its loaded cartons by product, and
 * the day and time it was closed. `inline` opens it in the browser instead of downloading it.
 */
export async function challanDownload(detail: DispatchDetail, supplierName: string, products: Pick<ProductRow, "id" | "master_code">[], inline = false): Promise<Response> {
  const { dispatch, cartons } = detail;
  if ((dispatch.status !== "closed" && dispatch.status !== "received") || !dispatch.closed_at) {
    return text("The challan is ready once the dispatch is closed: it shows what was loaded and when it left.", 404);
  }
  const sent = cartons.filter((c) => c.status === "loaded").sort((a, b) => a.carton_no - b.carton_no);
  if (!sent.length) return text("Nothing was loaded on this dispatch.", 404);
  const skus = new Map(products.map((p) => [p.id, p.master_code]));
  const bytes = await challanPdf(challanRows(sent, skus), { sentAt: dispatch.closed_at, title: `${supplierName} dispatch ${dispatch.number} challan` });
  const safe = supplierName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "supplier";
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safe}-dispatch-${dispatch.number}-challan.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
