import { getPortalUser } from "@/lib/auth";
import { challanDownload } from "@/server/challan-download";
import { loadDispatch, loadProducts } from "@/server/supplier-data";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => new Response("Not found", { status: 404 });

/** The supplier's challan for one of its own dispatches, once it has left. Printing is the owner's: not the warehouse person's. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getPortalUser();
  if (!user || user.role !== "supplier_owner") return notFound();
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  const [detail, products] = await Promise.all([loadDispatch(id), loadProducts(user.supplierId)]);
  // Another supplier's dispatch is not found: the database returns nothing for it.
  if (!detail || detail.dispatch.supplier_id !== user.supplierId) return notFound();
  return challanDownload(detail, user.supplierName, products, new URL(request.url).searchParams.get("inline") === "1");
}
