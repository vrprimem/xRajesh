// Draws the app icons from the mark in src/lib/logo.ts: the browser tab icon, the iPhone home-screen icon and the
// install icons the manifest lists. Run it after changing the mark:  node scripts/make-icons.mjs
// (sharp comes with Next.js.)
import { mkdir } from "node:fs/promises";
import sharp from "sharp";
import { LOGO } from "../src/lib/logo.ts";

/**
 * "tile": the rounded tile with its sunset border on a clear background, as on the pages.
 * "bleed": the tile colour to every edge and no border, for icons the phone crops to its own shape. The V stays
 * inside the middle 80%, the part a phone never crops.
 * "badge": a plain white V on clear, for the small icon in the phone's status bar (Android uses only its shape).
 */
function logoSvg(variant, size) {
  if (variant === "badge") {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}"><path d="${LOGO.v}" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  const stops = LOGO.stops.map(([offset, colour]) => `<stop offset="${offset}" stop-color="${colour}"/>`).join("");
  const back =
    variant === "tile"
      ? `<rect x="1.5" y="1.5" width="61" height="61" rx="17" fill="${LOGO.tile}" stroke="url(#n)" stroke-width="3"/>`
      : `<rect width="64" height="64" fill="${LOGO.tile}"/>`;
  const v = (extra) => `<path d="${LOGO.v}" fill="none" stroke="url(#n)" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}"><defs><linearGradient id="n" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient><filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.5"/></filter></defs>${back}${v('stroke-width="8" filter="url(#g)" opacity=".9"')}${v('stroke-width="7"')}</svg>`;
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
