import { canManage, getActiveUser } from "@/lib/auth";
import { labelsDownload } from "@/server/label-download";
import { loadDispatch, loadSupplier } from "@/server/supplier-data";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => new Response("Not found", { status: 404 });

/** VRPRIME's label PDF for a supplier's dispatch (owner and admin). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; dispatchId: string }> }) {
  const user = await getActiveUser();
  if (!user || !canManage(user)) return notFound();
  const { id, dispatchId } = await params;
  if (!UUID.test(id) || !UUID.test(dispatchId)) return notFound();
  const [supplier, detail] = await Promise.all([loadSupplier(id), loadDispatch(dispatchId)]);
  if (!supplier || !detail || detail.dispatch.supplier_id !== id) return notFound();
  return labelsDownload(detail, supplier.name, new URL(request.url).searchParams);
}
