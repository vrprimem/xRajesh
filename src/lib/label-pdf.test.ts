import assert from "node:assert/strict";
import { test } from "node:test";
import { PDFDocument } from "pdf-lib";
import { A4_H, A4_W, barRuns, labelsPdf, PAGE_H, PAGE_W, pdfText, PER_SHEET, SHEET, sheetSlot } from "./label-pdf.ts";
import { code128Widths } from "./supplier.ts";

const label = (n: number, type: "H" | "T" = "H") => ({
  carton_type: type,
  product: "Scratch 150ml",
  units: 110,
  carton_no: n,
  barcode: `101000107110${String(5860 + n).padStart(4, "0")}`,
  weight_per_carton: type === "H" ? 8.5 : null,
});

test("one 100 x 75 mm page per label", async () => {
  const bytes = await labelsPdf([label(1), label(2, "T"), label(3)], { dispatchNo: 1, due: "24 Nov", title: "Rajesh dispatch 1 labels" });
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 3);
  const { width, height } = doc.getPage(0).getSize();
  assert.ok(Math.abs(width - PAGE_W) < 0.01 && Math.abs(width - 283.46) < 0.01, `width ${width}`);
  assert.ok(Math.abs(height - PAGE_H) < 0.01 && Math.abs(height - 212.6) < 0.01, `height ${height}`);
  assert.equal(doc.getTitle(), "Rajesh dispatch 1 labels");
});

test("a long name, odd characters and 300 labels still make a PDF", async () => {
  const long = { ...label(1), product: "Very Long Product Name For A Kitchen Cleaner Spray With Lemon And Extra Strength 500ml Pack Of Two" };
  const odd = { ...label(2), product: "Cleaner – राजेश 500ml" };
  const many = Array.from({ length: 300 }, (_, i) => label(i + 1));
  const bytes = await labelsPdf([long, odd, ...many], { dispatchNo: 7, due: "1 Dec", title: "t" });
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 302);
  assert.ok(bytes.length < 3_000_000, `size ${bytes.length}`);
});

test("A4: 16 labels per page, 2 across and 8 down, all inside the sheet", async () => {
  assert.equal(PER_SHEET, 16);
  const bytes = await labelsPdf(Array.from({ length: 33 }, (_, i) => label(i + 1)), { dispatchNo: 1, due: "24 Nov", title: "t" }, "a4");
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 3, "33 labels fill 2 sheets and start a third");
  const { width, height } = doc.getPage(0).getSize();
  assert.ok(Math.abs(width - 595.28) < 0.05 && Math.abs(height - 841.89) < 0.05, `A4 is ${width} x ${height}`);
  const mm = 72 / 25.4;
  const first = sheetSlot(0);
  const second = sheetSlot(1);
  const last = sheetSlot(15);
  assert.ok(Math.abs(A4_H - (first.y + SHEET.h) - 12.9 * mm) < 0.01, "12.9 mm from the top");
  assert.ok(Math.abs(first.x - 4.65 * mm) < 0.01, "4.65 mm from the left");
  assert.ok(Math.abs(second.x - first.x - 101.6 * mm) < 0.01, "the second column is 101.6 mm across");
  assert.ok(Math.abs(first.y - sheetSlot(2).y - 33.9 * mm) < 0.01, "rows are 33.9 mm apart");
  assert.ok(last.x + SHEET.w <= A4_W && last.y >= 0, "the last label is on the sheet");
  assert.ok(Math.abs(last.y - 12.9 * mm) < 0.01, "and leaves the same 12.9 mm at the bottom");
});

test("the bars are exactly the Code 128 pattern, after a quiet zone", () => {
  const { bars, modules } = barRuns("1010001071105863");
  const widths = code128Widths("1010001071105863");
  assert.equal(bars.length, Math.ceil(widths.length / 2));
  assert.equal(bars[0][0], 10, "a 10-module quiet zone first");
  assert.equal(modules, widths.reduce((a, b) => a + b, 0) + 20, "and 10 after");
  let x = 10;
  widths.forEach((w, i) => {
    if (i % 2 === 0) assert.deepEqual(bars[i / 2], [x, w]);
    x += w;
  });
});

test("text the PDF fonts cannot draw is replaced, not dropped", () => {
  assert.equal(pdfText("Scratch 150ml"), "Scratch 150ml");
  assert.equal(pdfText("A – B"), "A ? B");
  assert.equal(pdfText("café"), "café");
});
