import { labelsDownload } from "@/server/label-download";
import { SAMPLE_DISPATCHES } from "../../sample";

const notFound = () => new Response("Not found", { status: 404 });

/** Development only: the label PDFs of the preview's sample dispatches, so downloads can be tried without a database. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV !== "development") return notFound();
  const { id } = await params;
  const detail = SAMPLE_DISPATCHES[id];
  if (!detail) return notFound();
  return labelsDownload(detail, "Rajesh Industries", new URL(request.url).searchParams);
}
