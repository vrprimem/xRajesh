// Draws the app icons from the mark in src/lib/logo.ts: the browser tab icon, the iPhone home-screen icon, the
// install icons the manifest lists and the small notification badge. Run it after changing the mark:
//   node scripts/make-icons.mjs
// (sharp comes with Next.js.)
import { mkdir } from "node:fs/promises";
import sharp from "sharp";
import { LOGO } from "../src/lib/logo.ts";

const v = (colour) => `<path d="${LOGO.v}" fill="none" stroke="${colour}" stroke-width="${LOGO.stroke}" stroke-linecap="square" stroke-linejoin="miter"/>`;

/**
 * "tile": the rounded yellow tile on a clear background, as on the pages.
 * "bleed": yellow to every edge, for icons the phone crops to its own shape; the V is shrunk to stay inside the middle
 * circle a phone never crops.
 * "badge": a plain white V on clear, for the small icon in the phone's status bar (Android uses only its shape).
 */
function logoSvg(variant, size) {
  const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">`;
  if (variant === "badge") return `${open}${v("#ffffff")}</svg>`;
  if (variant === "bleed") return `${open}<rect width="64" height="64" fill="${LOGO.tile}"/><g transform="translate(32 32) scale(0.78) translate(-32 -32)">${v(LOGO.ink)}</g></svg>`;
  return `${open}<rect width="64" height="64" rx="14" fill="${LOGO.tile}"/>${v(LOGO.ink)}</svg>`;
}

const ICONS = [
  ["src/app/icon.png", "tile", 64],
  ["src/app/apple-icon.png", "bleed", 180],
  ["public/icons/icon-192.png", "tile", 192],
  ["public/icons/icon-512.png", "tile", 512],
  ["public/icons/icon-maskable-512.png", "bleed", 512],
  ["public/icons/badge-96.png", "badge", 96],
];

await mkdir("public/icons", { recursive: true });
for (const [file, variant, size] of ICONS) {
  await sharp(Buffer.from(logoSvg(variant, size))).png({ compressionLevel: 9 }).toFile(file);
  console.log(`${file}  ${size}x${size}  ${variant}`);
}
