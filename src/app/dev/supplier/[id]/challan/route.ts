import { challanDownload } from "@/server/challan-download";
import { SAMPLE_DISPATCHES, SAMPLE_PRODUCTS } from "../../sample";

const notFound = () => new Response("Not found", { status: 404 });

/** Development only: the challan of a sample dispatch. `?inline=1` shows it in the browser. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV !== "development") return notFound();
  const { id } = await params;
  const detail = SAMPLE_DISPATCHES[id];
  if (!detail) return notFound();
  return challanDownload(detail, "Rajesh Industries", SAMPLE_PRODUCTS, new URL(request.url).searchParams.get("inline") === "1");
}
