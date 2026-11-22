import { getPortalUser } from "@/lib/auth";
import { labelsDownload } from "@/server/label-download";
import { loadDispatch } from "@/server/supplier-data";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => new Response("Not found", { status: 404 });

/** The supplier's label PDF for one of its own dispatches. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getPortalUser();
  if (!user) return notFound();
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  const detail = await loadDispatch(id);
  // Another supplier's dispatch is not found: the database returns nothing for it.
  if (!detail || detail.dispatch.supplier_id !== user.supplierId) return notFound();
  return labelsDownload(detail, user.supplierName, new URL(request.url).searchParams);
}
