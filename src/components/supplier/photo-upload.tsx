"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { ProductPhoto } from "@/components/supplier/product-photo";
import { useToast } from "@/components/toast";
import { Card, SectionHead, buttonClass } from "@/components/ui";
import { matchPhotoFiles, type PhotoTarget } from "@/lib/photos";
import { createClient } from "@/lib/supabase/client";
import type { ActionResult } from "@/lib/types";
import { removeMasterPhoto, setMasterPhoto } from "@/server/actions/supplier";

// VRPRIME's photo controls: one product at a time, or many at once matched by file name. Every picture is made a JPEG
// of at most 1200 px on a white background (a see-through PNG would otherwise turn black), uploaded as a new file, then
// put on the master SKU; the database checks the person is VRPRIME's owner or admin.

const MAX_SIDE = 1200;

async function toJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no picture"))), "image/jpeg", 0.85));
}

/** Uploads one picture and puts it on the master SKU. */
async function uploadPhoto(code: string, file: File): Promise<ActionResult> {
  let blob: Blob;
  try {
    blob = await toJpeg(file);
  } catch {
    return { ok: false, message: `${file.name} could not be read. Use a JPG, PNG or WebP picture.` };
  }
  const path = `${crypto.randomUUID()}.jpg`;
  const { error } = await createClient().storage.from("product-photos").upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) return { ok: false, message: `${file.name} did not upload. Check your connection and try again.` };
  return setMasterPhoto(code, path);
}

/** One product's photo with its buttons: add or change, and remove. Needs the product linked to a master SKU. */
export function PhotoButtons({ code, name, src }: { code: string | null; name: string; src?: string }) {
  const has = !!src;
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  if (!code) return <span className="t-caption">Link a master SKU first</span>;
  return (
    <span className="flex items-center gap-2">
      <ProductPhoto src={src} name={name} size={48} />
      <span className="flex flex-col items-start gap-1.5">
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-label={`Photo of ${name}`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) startTransition(async () => void toast.result(await uploadPhoto(code, file)));
        }}
      />
      <button type="button" disabled={pending} onClick={() => input.current?.click()} className={buttonClass("row")}>
        {pending ? "Uploading..." : has ? "Change" : "Add photo"}
      </button>
      {has ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (window.confirm(`Remove the photo of ${name}? The supplier will no longer see it.`)) startTransition(async () => void toast.result(await removeMasterPhoto(code)));
          }}
          className={buttonClass("row")}
        >
          Remove
        </button>
      ) : null}
      </span>
    </span>
  );
}

/**
 * Many photos at once: each file is put on the master SKU its name matches, by the code ("150-KITCHEN.jpg") or the
 * product's name ("Kitchen Cleaner Spray 500ml.png"). Shows what matched before uploading.
 */
export function BulkPhotoUpload({ targets, missing }: { targets: PhotoTarget[]; missing: number }) {
  const toast = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [done, setDone] = useState(0);
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => matchPhotoFiles(files.map((f) => f.name), targets), [files, targets]);
  const good = matches.map((m, i) => ({ ...m, file: files[i] })).filter((m) => m.code && m.why !== "twice");

  const upload = () =>
    startTransition(async () => {
      let saved = 0;
      const failed: string[] = [];
      for (const m of good) {
        const result = await uploadPhoto(m.code!, m.file);
        if (result.ok) saved++;
        else failed.push(m.file.name);
        setDone((d) => d + 1);
      }
      toast.show(failed.length ? `${saved} saved; not saved: ${failed.join(", ")}` : `${saved} ${saved === 1 ? "photo" : "photos"} saved`, failed.length ? "bad" : "ok");
      if (!failed.length) setFiles([]);
      setDone(0);
    });

  return (
    <Card className="g-pad">
      <SectionHead
        title="Product photos"
        sub={`So the supplier's team sees exactly which product you mean on every send plan and dispatch. ${missing ? `${missing} active ${missing === 1 ? "product has" : "products have"} no photo yet.` : "Every active product linked to a master SKU has a photo."}`}
        action={
          <button type="button" disabled={pending} onClick={() => input.current?.click()} className={buttonClass("outline")}>
            Upload many photos
          </button>
        }
      />
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-label="Photos to upload"
        onChange={(e) => {
          setFiles(Array.from(e.target.files ?? []).slice(0, 200));
          e.target.value = "";
        }}
      />
      <p className="t-caption">
        For many at once, name each file after the product&apos;s master SKU (150-KITCHEN.jpg) or the product&apos;s name (Kitchen Cleaner Spray 500ml.png). For one, use Add photo on the product below. A photo belongs to the master SKU, so every product linked to it shows it.
      </p>
      {files.length ? (
        <div className="mt-3 flex flex-col gap-3">
          <ul className="divide-y divide-line-soft text-[15px]">
            {matches.map((m, i) => (
              <li key={`${m.file}-${i}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
                <span className="min-w-0 break-all">{m.file}</span>
                <span className={m.code && m.why !== "twice" ? "font-semibold" : "text-bad"}>
                  {m.why === "none" ? "No product matches this name" : m.why === "twice" ? `A second photo for ${m.code}: left out` : `→ ${m.code}`}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={pending || !good.length} onClick={upload} className={buttonClass("primary")}>
              {pending ? `Uploading ${done + 1} of ${good.length}...` : `Upload ${good.length} ${good.length === 1 ? "photo" : "photos"}`}
            </button>
            <button type="button" disabled={pending} onClick={() => setFiles([])} className={buttonClass("outline")}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
