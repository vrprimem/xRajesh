// BIGICON's stock receipt challan for a dispatch: VRPRIME's own A4 form, with what the supplier sent filled in (each
// product with its cartons and pieces, and the day and time it was sent). Everything else on the form is left blank,
// to be written by hand. Drawn with the built-in PDF fonts, so it prints sharp. Plain TypeScript for `node --test`.
//
// The form was laid out on a 1141 x 1613 px page: positions below are in those pixels, from the top left.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { pdfText } from "./label-pdf.ts";

export type ChallanCarton = { product_id: string; product: string; units: number };
/** One line of the challan: a product, its carton size, full cartons, pieces in odd cartons, and pieces in all. */
export type ChallanRow = { product: string; sku: string | null; perPack: number; fullPacks: number; loose: number; total: number };

/**
 * The challan's lines from the cartons sent: one per product, in the order the cartons come. A product's pack is the
 * carton size most of its cartons have; cartons of any other size go in as loose pieces.
 */
export function challanRows(cartons: ChallanCarton[], skus: ReadonlyMap<string, string | null>): ChallanRow[] {
  const by = new Map<string, { product: string; sizes: Map<number, number> }>();
  for (const c of cartons) {
    const p = by.get(c.product_id) ?? { product: c.product, sizes: new Map<number, number>() };
    p.sizes.set(c.units, (p.sizes.get(c.units) ?? 0) + 1);
    by.set(c.product_id, p);
  }
  return [...by.entries()].map(([id, p]) => {
    const [perPack, fullPacks] = [...p.sizes.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    const total = [...p.sizes.entries()].reduce((n, [units, count]) => n + units * count, 0);
    return { product: p.product, sku: skus.get(id) ?? null, perPack, fullPacks, loose: total - perPack * fullPacks, total };
  });
}

/**
 * What a dispatch's challan covers, and when it says the goods were sent. Once it has left (closed or received): the
 * cartons loaded and the time it was closed. While it is still loading: the cartons scanned so far and the time the
 * last of them was scanned, so a dispatch that goes out short (30 of the 50 planned cartons) gets its challan without
 * being closed, and a second copy after more scans has them too. Null when there is nothing to put on one: a cancelled
 * dispatch, or no carton scanned. `now` stands in for a scan time that is missing.
 */
export function challanCut<C extends { status: string; carton_no: number; loaded_at: string | null }>(
  dispatch: { status: string; closed_at: string | null },
  cartons: readonly C[],
  now: string,
): { cartons: C[]; sentAt: string } | null {
  const left = dispatch.status === "closed" || dispatch.status === "received";
  if (!left && dispatch.status !== "planned" && dispatch.status !== "loading") return null;
  const sent = cartons.filter((c) => c.status === "loaded").sort((a, b) => a.carton_no - b.carton_no);
  if (!sent.length) return null;
  const times = sent.map((c) => (c.loaded_at ? Date.parse(c.loaded_at) : NaN)).filter((t) => Number.isFinite(t));
  const lastScan = times.length ? new Date(Math.max(...times)).toISOString() : now;
  return { cartons: sent, sentAt: left && dispatch.closed_at ? dispatch.closed_at : lastScan };
}

export const ROWS_PER_PAGE = 9;

const W = 595.28;
const H = 841.89;
const PX = W / 1141;
const X = (px: number) => px * PX;
const Y = (px: number) => H - px * PX;

const TEAL = rgb(0.05, 0.29, 0.31);
const INK = rgb(0.08, 0.13, 0.15);
const MUTED = rgb(0.36, 0.42, 0.45);
const GRID = rgb(0.47, 0.55, 0.58);
const FILL = rgb(0.867, 0.886, 0.902);

/** The table's column edges, left to right. */
const COLS = [45, 91, 378, 525, 601, 694, 806, 901, 1065];
const TABLE_TOP = 545;
const HEAD_BOTTOM = 607;
const ROW_H = 63;

type Fonts = { regular: PDFFont; bold: PDFFont };

function text(page: PDFPage, s: string, x: number, baseline: number, size: number, font: PDFFont, color = TEAL, align: "left" | "right" | "center" = "left") {
  const t = pdfText(s);
  const w = font.widthOfTextAtSize(t, size);
  const left = align === "left" ? X(x) : align === "right" ? X(x) - w : X(x) - w / 2;
  page.drawText(t, { x: left, y: Y(baseline), size, font, color });
}

function line(page: PDFPage, x1: number, y1: number, x2: number, y2: number, thickness: number, color = GRID) {
  page.drawLine({ start: { x: X(x1), y: Y(y1) }, end: { x: X(x2), y: Y(y2) }, thickness, color });
}

/** Text cut with "..." to fit a width (in px). */
function fit(s: string, font: PDFFont, size: number, widthPx: number): string {
  let t = pdfText(s);
  if (font.widthOfTextAtSize(t, size) <= X(widthPx)) return t;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > X(widthPx)) t = t.slice(0, -1);
  return `${t.trimEnd()}...`;
}

const n = (v: number) => v.toLocaleString("en-IN");

/** One page of the form, with the day and time filled in, and these rows (numbered from `first`). */
function drawPage(page: PDFPage, f: Fonts, date: string, time: string, rows: ChallanRow[], first: number, pageNo: number, pages: number) {
  // Head.
  text(page, "BIGICON", 52, 74, 30, f.bold);
  text(page, "Stock Receipt Challan", 52, 152, 32.5, f.bold);
  text(page, "INTERNAL STOCK BOOK", 1087, 91, 11, f.bold, TEAL, "right");
  text(page, "Ulhasnagar unit", 1087, 120, 11.5, f.regular, TEAL, "right");
  line(page, 60, 189, 1080, 189, 1.6, TEAL);

  // Receipt challan no., with its box; the job work box.
  text(page, "Receipt challan no.", 50, 272, 11.5, f.bold);
  const bx = X(262);
  const by = Y(209);
  const bw = X(432) - X(262);
  const bh = X(292 - 209);
  const r = 6;
  page.drawSvgPath(`M ${r} 0 H ${bw - r} Q ${bw} 0 ${bw} ${r} V ${bh - r} Q ${bw} ${bh} ${bw - r} ${bh} H ${r} Q 0 ${bh} 0 ${bh - r} V ${r} Q 0 0 ${r} 0 Z`, {
    x: bx,
    y: by,
    borderColor: INK,
    borderWidth: 0.8,
  });
  page.drawRectangle({ x: X(750), y: Y(255), width: X(1081) - X(750), height: X(255 - 202), color: FILL });
  text(page, "job work", 785, 238, 12, f.bold);
  line(page, 898, 229, 934, 229, 1, TEAL);
  line(page, 926, 223, 934, 229, 1, TEAL);
  line(page, 926, 235, 934, 229, 1, TEAL);
  text(page, "BIGICON", 948, 238, 12, f.bold);

  // Related issue challans, date and time (the day and time it was sent).
  text(page, "Related issue challan no(s).", 50, 332, 11.5, f.bold);
  text(page, "Date", 462, 332, 11.5, f.bold);
  text(page, "Time", 800, 332, 11.5, f.bold);
  line(page, 125, 381, 420, 381, 0.8);
  line(page, 468, 381, 758, 381, 0.8);
  line(page, 805, 381, 1075, 381, 0.8);
  text(page, date, 476, 370, 13, f.bold, INK);
  text(page, time, 813, 370, 13, f.bold, INK);

  text(page, "Job / work order code", 50, 443, 11.5, f.bold);
  line(page, 318, 438, 790, 438, 0.8);
  text(page, "Finished goods accepted  handover tempo no", 40, 503, 15.5, f.bold);
  line(page, 755, 505, 1025, 505, 0.8);

  // The table: head, nine rows, grid.
  const bottom = HEAD_BOTTOM + ROW_H * ROWS_PER_PAGE;
  page.drawRectangle({ x: X(COLS[0]), y: Y(HEAD_BOTTOM), width: X(COLS[8]) - X(COLS[0]), height: X(HEAD_BOTTOM - TABLE_TOP), color: FILL });
  const heads: [string, string?][] = [["No."], ["Item / SKU", "and pack size"], ["Batch / lot"], ["Unit"], ["Full", "packs"], ["Qty per", "pack"], ["Loose", "qty"], ["Total", "issued"]];
  heads.forEach(([a, b], i) => {
    const mid = (COLS[i] + COLS[i + 1]) / 2;
    if (b) {
      text(page, a, mid, 571, 11, f.bold, TEAL, "center");
      text(page, b, mid, 593, 11, f.bold, TEAL, "center");
    } else text(page, a, mid, 582, 11, f.bold, TEAL, "center");
  });
  for (let i = 0; i < ROWS_PER_PAGE; i++) {
    const top = HEAD_BOTTOM + i * ROW_H;
    text(page, String(first + i), (COLS[0] + COLS[1]) / 2, top + 37, 11, f.regular, MUTED, "center");
    const row = rows[i];
    if (!row) continue;
    const itemW = COLS[2] - COLS[1] - 18;
    text(page, fit(row.product, f.bold, 11, itemW), COLS[1] + 9, top + 27, 11, f.bold, INK);
    text(page, fit(`${row.sku ? `${row.sku} · ` : ""}${n(row.perPack)} pcs / carton`, f.regular, 9, itemW), COLS[1] + 9, top + 47, 9, f.regular, MUTED);
    const mid = (c: number) => (COLS[c] + COLS[c + 1]) / 2;
    text(page, "Pcs", mid(3), top + 37, 11, f.regular, INK, "center");
    text(page, n(row.fullPacks), mid(4), top + 37, 12, f.bold, INK, "center");
    text(page, n(row.perPack), mid(5), top + 37, 12, f.regular, INK, "center");
    text(page, n(row.loose), mid(6), top + 37, 12, f.regular, INK, "center");
    text(page, n(row.total), mid(7), top + 37, 12, f.bold, INK, "center");
  }
  for (let i = 1; i <= ROWS_PER_PAGE; i++) line(page, COLS[0], HEAD_BOTTOM + i * ROW_H, COLS[8], HEAD_BOTTOM + i * ROW_H, 0.6);
  line(page, COLS[0], HEAD_BOTTOM, COLS[8], HEAD_BOTTOM, 0.9);
  COLS.forEach((c) => line(page, c, TABLE_TOP, c, bottom, 0.6));
  line(page, COLS[0], TABLE_TOP, COLS[8], TABLE_TOP, 1.4, TEAL);
  line(page, COLS[0], bottom, COLS[8], bottom, 1.4, TEAL);

  // Signature and foot.
  line(page, 727, 1480, 1141, 1480, 0.8, TEAL);
  text(page, "Handed back by  Signature", 718, 1513, 11.5, f.bold);
  line(page, 60, 1535, 1080, 1535, 0.6);
  text(page, "/ BIGICON", 1103, 1574, 10, f.regular, MUTED, "right");
  if (pages > 1) text(page, `Page ${pageNo} of ${pages}`, 60, 1574, 10, f.regular, MUTED);
}

/** The day and time something was sent, as the challan shows them: "24 Nov 2026" and "2:34 pm" (India time). */
export function sentOn(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(d);
  const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).format(d);
  return { date, time: time.replace(/\s?(AM|PM)$/i, (m) => ` ${m.trim().toLowerCase()}`) };
}

/** The filled-in challan: nine products a page, as many pages as needed. */
export async function challanPdf(rows: ChallanRow[], meta: { sentAt: string; title: string }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfText(meta.title));
  doc.setCreator("VRPRIME Supplier Portal");
  const fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
  const { date, time } = sentOn(meta.sentAt);
  const pages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([W, H]);
    drawPage(page, fonts, date, time, rows.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE), p * ROWS_PER_PAGE + 1, p + 1, pages);
  }
  return doc.save();
}
