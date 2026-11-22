// The carton labels of a dispatch as one PDF: one label per page, 100 x 75 mm, ready for a label printer.
// Everything is drawn as vectors (no pictures), so it prints sharp at any size:
//   - a band showing the carton type: solid black for hard, a dashed frame for 2-ply
//   - product, pieces per carton, dispatch and carton number, carton weight, due date
//   - the VRPRIME inventory software's barcode number as Code 128 (what the warehouse scans) with the digits under it
//   - the same number as a QR code (what a phone camera reads while loading)
// Plain TypeScript with relative imports, so `node --test` can run it.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";
import { code128Widths, type CartonType } from "./supplier.ts";

export type PdfLabel = {
  carton_type: CartonType;
  product: string;
  units: number;
  carton_no: number;
  barcode: string;
  weight_per_carton: number | null;
};

const MM = 72 / 25.4;
export const PAGE_W = 100 * MM;
export const PAGE_H = 75 * MM;
const PAD = 3 * MM;
const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);

/** Text the built-in PDF fonts can draw: anything outside Latin-1 becomes "?". */
export function pdfText(text: string): string {
  return text.replace(/[^\x20-\x7e\xa0-\xff]/g, "?");
}

/** Bars of a Code 128 barcode as [x, width] in modules, after a 10-module quiet zone; and the total width in modules. */
export function barRuns(digits: string): { bars: [number, number][]; modules: number } {
  const widths = code128Widths(digits);
  const bars: [number, number][] = [];
  let x = 10;
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars.push([x, w]);
    x += w;
  });
  return { bars, modules: x + 10 };
}

/** Splits text into at most `max` lines that fit `width`; the last is cut with "..." if needed. */
function wrap(text: string, font: PDFFont, size: number, width: number, max: number): string[] {
  const words = pdfText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) line = next;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  let last = kept[max - 1];
  while (last && font.widthOfTextAtSize(`${last}...`, size) > width) last = last.slice(0, -1);
  kept[max - 1] = `${last}...`;
  return kept;
}

function drawLabel(page: PDFPage, l: PdfLabel, dispatchNo: number, due: string, regular: PDFFont, bold: PDFFont) {
  const inner = PAGE_W - 2 * PAD;
  let top = PAGE_H - PAD;

  // The carton-type band.
  const bandH = 13 * MM;
  const hard = l.carton_type === "H";
  if (hard) page.drawRectangle({ x: PAD, y: top - bandH, width: inner, height: bandH, color: BLACK });
  else page.drawRectangle({ x: PAD + 1.7, y: top - bandH + 1.7, width: inner - 3.4, height: bandH - 3.4, borderColor: BLACK, borderWidth: 3.4, borderDashArray: [6, 3.5] });
  const ink = hard ? WHITE : BLACK;
  page.drawText(hard ? "HARD CARTON" : "2-PLY CARTON", { x: PAD + 3 * MM, y: top - bandH / 2 - 5, size: 14, font: bold, color: ink });
  const letter = hard ? "H" : "T";
  const letterSize = 30;
  page.drawText(letter, { x: PAD + inner - 3 * MM - bold.widthOfTextAtSize(letter, letterSize), y: top - bandH / 2 - 10.5, size: letterSize, font: bold, color: ink });
  top -= bandH + 2 * MM;

  // Product name, up to two lines.
  const nameSize = 12.5;
  for (const line of wrap(l.product, bold, nameSize, inner, 2)) {
    top -= nameSize;
    page.drawText(line, { x: PAD, y: top, size: nameSize, font: bold, color: BLACK });
    top -= 1.5;
  }
  top -= 2.5 * MM;

  // Two lines of facts, left and right.
  const factSize = 9.5;
  const row = (left: string, right: string) => {
    top -= factSize;
    page.drawText(pdfText(left), { x: PAD, y: top, size: factSize, font: regular, color: BLACK });
    const r = pdfText(right);
    page.drawText(r, { x: PAD + inner - regular.widthOfTextAtSize(r, factSize), y: top, size: factSize, font: regular, color: BLACK });
    top -= 3;
  };
  row(`${l.units.toLocaleString("en-IN")} pcs/carton`, `Dispatch ${dispatchNo} - Carton ${l.carton_no}`);
  row(`To: VRPRIME${l.weight_per_carton ? ` - ${l.weight_per_carton} kg` : ""}`, due);

  // Barcode (left) and QR code (right) along the bottom.
  const qrSide = 21 * MM;
  const gap = 3 * MM;
  const digitsSize = 10;
  const barH = 17 * MM;
  const bottom = PAD;
  const barAreaW = inner - qrSide - gap;
  const { bars, modules } = barRuns(l.barcode);
  const unit = barAreaW / modules;
  const barY = bottom + digitsSize + 3;
  for (const [x, w] of bars) page.drawRectangle({ x: PAD + x * unit, y: barY, width: w * unit, height: barH, color: BLACK });
  const digitsW = regular.widthOfTextAtSize(l.barcode, digitsSize);
  page.drawText(l.barcode, { x: PAD + (barAreaW - digitsW) / 2, y: bottom, size: digitsSize, font: bold, color: BLACK });

  const qr = QRCode.create(l.barcode, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const cell = qrSide / (n + 2);
  const qx = PAD + inner - qrSide;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules.get(r, c)) page.drawRectangle({ x: qx + (c + 1) * cell, y: bottom + qrSide - (r + 2) * cell, width: cell, height: cell, color: BLACK });
    }
  }
}

// ---- A4 sheets of 16 ---------------------------------------------------------------------------------------------------
// The common 16-up A4 sheet (Avery L7162 and its copies): 2 across x 8 down, each label 99.1 x 33.9 mm, 12.9 mm from the
// top, 4.65 mm from the side, 2.5 mm between the two columns, no gap between rows.

export const A4_W = 210 * MM;
export const A4_H = 297 * MM;
export const SHEET = { cols: 2, rows: 8, w: 99.1 * MM, h: 33.9 * MM, top: 12.9 * MM, left: 4.65 * MM, colGap: 2.5 * MM };
export const PER_SHEET = SHEET.cols * SHEET.rows;

/** Where label number i (0-based) of a sheet sits: its bottom-left corner. Filled left to right, top to bottom. */
export function sheetSlot(i: number): { x: number; y: number } {
  const col = i % SHEET.cols;
  const row = Math.floor(i / SHEET.cols);
  return { x: SHEET.left + col * (SHEET.w + SHEET.colGap), y: A4_H - SHEET.top - (row + 1) * SHEET.h };
}

/** The short label for a sheet: carton type on the left, then product, facts, barcode and QR code. */
function drawSmall(page: PDFPage, ox: number, oy: number, l: PdfLabel, dispatchNo: number, due: string, regular: PDFFont, bold: PDFFont) {
  const pad = 2 * MM;
  const w = SHEET.w;
  const h = SHEET.h;
  const hard = l.carton_type === "H";

  // Carton type: a solid black block with H, or a dashed frame with T, the full height on the left.
  const tagW = 11 * MM;
  const tagH = h - 2 * pad;
  if (hard) page.drawRectangle({ x: ox + pad, y: oy + pad, width: tagW, height: tagH, color: BLACK });
  else page.drawRectangle({ x: ox + pad + 1.2, y: oy + pad + 1.2, width: tagW - 2.4, height: tagH - 2.4, borderColor: BLACK, borderWidth: 2.4, borderDashArray: [4, 2.5] });
  const ink = hard ? WHITE : BLACK;
  const letter = hard ? "H" : "T";
  page.drawText(letter, { x: ox + pad + (tagW - bold.widthOfTextAtSize(letter, 24)) / 2, y: oy + pad + tagH / 2 - 2, size: 24, font: bold, color: ink });
  const word = hard ? "HARD" : "2-PLY";
  page.drawText(word, { x: ox + pad + (tagW - bold.widthOfTextAtSize(word, 6.5)) / 2, y: oy + pad + tagH / 2 - 11, size: 6.5, font: bold, color: ink });

  // The rest of the label, right of the tag.
  const x0 = ox + pad + tagW + 2 * MM;
  const right = ox + w - pad;
  const areaW = right - x0;
  let top = oy + h - pad;

  const nameSize = 9;
  top -= nameSize;
  page.drawText(wrap(l.product, bold, nameSize, areaW, 1)[0] ?? "", { x: x0, y: top, size: nameSize, font: bold, color: BLACK });
  top -= 2 + 6.5;
  const facts = pdfText(`${l.units.toLocaleString("en-IN")} pcs - Dispatch ${dispatchNo} - Carton ${l.carton_no}${l.weight_per_carton ? ` - ${l.weight_per_carton} kg` : ""} - ${due}`);
  page.drawText(wrap(facts, regular, 6.5, areaW, 1)[0] ?? "", { x: x0, y: top, size: 6.5, font: regular, color: BLACK });

  // Barcode with its digits, and the QR code at the right.
  const qrSide = Math.min(15 * MM, top - (oy + pad) - 1.5 * MM);
  const gap = 2 * MM;
  const barAreaW = areaW - qrSide - gap;
  const digitsSize = 7;
  const barY = oy + pad + digitsSize + 1.5;
  const barH = top - 1.5 * MM - barY;
  const { bars, modules } = barRuns(l.barcode);
  const unit = barAreaW / modules;
  for (const [x, bw] of bars) page.drawRectangle({ x: x0 + x * unit, y: barY, width: bw * unit, height: barH, color: BLACK });
  page.drawText(l.barcode, { x: x0 + (barAreaW - bold.widthOfTextAtSize(l.barcode, digitsSize)) / 2, y: oy + pad, size: digitsSize, font: bold, color: BLACK });

  const qr = QRCode.create(l.barcode, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const cell = qrSide / (n + 2);
  const qx = right - qrSide;
  const qy = oy + pad;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules.get(r, c)) page.drawRectangle({ x: qx + (c + 1) * cell, y: qy + qrSide - (r + 2) * cell, width: cell, height: cell, color: BLACK });
    }
  }
}

export type LabelFormat = "single" | "a4";

/**
 * All the labels in one PDF, in the order given.
 *   single  one label per page, 100 x 75 mm (a label printer)
 *   a4      16 per A4 page, 2 x 8, for 99.1 x 33.9 mm sheets (an office printer)
 */
export async function labelsPdf(labels: PdfLabel[], meta: { dispatchNo: number; due: string; title: string }, format: LabelFormat = "single"): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfText(meta.title));
  doc.setCreator("VRPRIME Supplier Portal");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  if (format === "a4") {
    let page: PDFPage | null = null;
    labels.forEach((l, i) => {
      if (i % PER_SHEET === 0) page = doc.addPage([A4_W, A4_H]);
      const { x, y } = sheetSlot(i % PER_SHEET);
      drawSmall(page as unknown as PDFPage, x, y, l, meta.dispatchNo, meta.due, regular, bold);
    });
  } else {
    for (const l of labels) {
      const page = doc.addPage([PAGE_W, PAGE_H]);
      drawLabel(page, l, meta.dispatchNo, meta.due, regular, bold);
    }
  }
  return doc.save();
}
