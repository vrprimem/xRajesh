import { safeError } from "@/lib/redact";
import { createClient } from "@/lib/supabase/client";

// In the browser: a photo from the phone, made a small JPEG and put in the private supplier-photos bucket.

const SIZES = {
  // A material's or product's photo: a picture on a tile.
  items: { maxSizeMB: 0.3, maxWidthOrHeight: 800 },
  products: { maxSizeMB: 0.3, maxWidthOrHeight: 800 },
  // A bill's or challan's photo: readable when opened.
  "goods-in": { maxSizeMB: 0.4, maxWidthOrHeight: 1600 },
} as const;

/** Uploads to "<supplier>/<folder>/<new id>.jpg" and returns that path, or null when it could not be uploaded. */
export async function uploadSupplierPhoto(supplierId: string, folder: keyof typeof SIZES, file: File): Promise<string | null> {
  try {
    const { default: imageCompression } = await import("browser-image-compression");
    const small = await imageCompression(file, { ...SIZES[folder], fileType: "image/jpeg", useWebWorker: true });
    const path = `${supplierId}/${folder}/${crypto.randomUUID()}.jpg`;
    const { error } = await createClient().storage.from("supplier-photos").upload(path, small, { contentType: "image/jpeg", upsert: false });
    if (error) throw error;
    return path;
  } catch (error) {
    console.error(`Photo upload failed (${folder})`, safeError(error));
    return null;
  }
}
