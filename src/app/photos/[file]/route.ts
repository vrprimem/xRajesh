import { PHOTO_ID } from "@/lib/photos";
import { createClient } from "@/lib/supabase/server";

const notFound = () => new Response("Not found", { status: 404 });

/**
 * A product photo, for whoever may see it: the file is read as the signed-in person, so the storage rules decide
 * (VRPRIME's owner and admin, and a supplier with a product linked to that master SKU). Every upload is a new file, so
 * the browser may keep it for good.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!PHOTO_ID.test(file)) return notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("product-photos").download(`${file}.jpg`);
  if (error || !data) return notFound();
  return new Response(data, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
