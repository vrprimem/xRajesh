import { canManage, getActiveUser } from "@/lib/auth";
import { challanDownload } from "@/server/challan-download";
import { loadDispatch, loadProducts, loadSupplier } from "@/server/supplier-data";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => new Response("Not found", { status: 404 });

/** VRPRIME's copy of a supplier's challan (owner and admin), once the dispatch has left. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; dispatchId: string }> }) {
  const user = await getActiveUser();
  if (!user || !canManage(user)) return notFound();
  const { id, dispatchId } = await params;
  if (!UUID.test(id) || !UUID.test(dispatchId)) return notFound();
  const [supplier, detail, products] = await Promise.all([loadSupplier(id), loadDispatch(dispatchId), loadProducts(id)]);
  if (!supplier || !detail || detail.dispatch.supplier_id !== id) return notFound();
  return challanDownload(detail, supplier.name, products, new URL(request.url).searchParams.get("inline") === "1");
}
