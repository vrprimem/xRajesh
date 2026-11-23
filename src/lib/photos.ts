// Product photos: one per VRPRIME master SKU (supabase/migrations/20261123113000_product_photos.sql). VRPRIME uploads
// them; the portal serves each at /photos/<file id> to whoever may see it, and shows it next to the product wherever
// the supplier's team reads what to make or send.

/** A photo file in the bucket: a new uuid for every upload, so an address never changes what it shows. */
export const PHOTO_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;
export const PHOTO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Where the portal serves a photo file. */
export const photoSrc = (path: string) => `/photos/${path.replace(/\.jpg$/, "")}`;

/** A master SKU a photo can be for, with the names of the products linked to it. */
export type PhotoTarget = { code: string; names: string[] };
export type PhotoMatch = { file: string; code: string | null; why: "code" | "name" | "none" | "twice" };

/** A file or product name as compared: no extension, any case, underscores as spaces, spaces squeezed. */
export const plainName = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/\.(jpe?g|png|webp|gif|heic|bmp)$/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Matches photo files to master SKUs by the file's name: the master SKU's code ("150-KITCHEN.jpg") or the name of a
 * product linked to it ("Kitchen Cleaner Spray 500ml.png"). A second file for the same master SKU is left out.
 */
export function matchPhotoFiles(files: string[], targets: PhotoTarget[]): PhotoMatch[] {
  const byCode = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const t of targets) {
    byCode.set(plainName(t.code), t.code);
    for (const n of t.names) if (!byName.has(plainName(n))) byName.set(plainName(n), t.code);
  }
  const taken = new Set<string>();
  return files.map((file) => {
    const key = plainName(file);
    const code = byCode.get(key) ?? byName.get(key) ?? null;
    if (!code) return { file, code: null, why: "none" };
    if (taken.has(code)) return { file, code, why: "twice" };
    taken.add(code);
    return { file, code, why: byCode.has(key) ? "code" : "name" };
  });
}
