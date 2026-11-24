import assert from "node:assert/strict";
import { test } from "node:test";
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream, type PDFPage } from "pdf-lib";
import { ROWS_PER_PAGE, challanPdf, challanRows, sentOn, type ChallanCarton } from "./challan-pdf.ts";

const cartons = (product_id: string, product: string, count: number, units: number): ChallanCarton[] => Array.from({ length: count }, () => ({ product_id, product, units }));

/** Every string drawn on a page, in order. */
function strings(doc: PDFDocument, page: PDFPage): string[] {
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
  let raw = "";
  for (const s of streams) raw += Buffer.from(s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : (s as unknown as { getContents(): Uint8Array }).getContents()).toString("latin1");
  return [...raw.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)].map((m) => Buffer.from(m[1], "hex").toString("latin1"));
}

test("one line per product: full cartons, pieces per carton, odd cartons as loose pieces, and the total", () => {
  const rows = challanRows(
    [...cartons("rat", "Old Rat", 59, 80), ...cartons("rat", "Old Rat", 1, 40), ...cartons("ant", "Ant Repellent", 13, 80), ...cartons("balls", "Rat Balls", 1, 500)],
    new Map([["rat", "RAT-OLDREPEL"], ["ant", "REPELLENT-ANT"]]),
  );
  assert.deepEqual(rows, [
    { product: "Old Rat", sku: "RAT-OLDREPEL", perPack: 80, fullPacks: 59, loose: 40, total: 4760 },
    { product: "Ant Repellent", sku: "REPELLENT-ANT", perPack: 80, fullPacks: 13, loose: 0, total: 1040 },
    { product: "Rat Balls", sku: null, perPack: 500, fullPacks: 1, loose: 0, total: 500 },
  ]);
  const tie = challanRows([...cartons("x", "X", 2, 12), ...cartons("x", "X", 2, 24)], new Map());
  assert.deepEqual([tie[0].perPack, tie[0].fullPacks, tie[0].loose, tie[0].total], [24, 2, 24, 72], "a tie takes the bigger carton");
  assert.deepEqual(challanRows([], new Map()), []);
});

test("the day and time it was sent, in India time", () => {
  assert.deepEqual(sentOn("2026-11-24T09:04:00Z"), { date: "24 Nov 2026", time: "2:34 pm" });
  assert.deepEqual(sentOn("2026-11-30T19:15:00Z"), { date: "01 Dec 2026", time: "12:45 am" }, "after midnight in India it is the next day");
});

test("an A4 challan with the day, time and every product's numbers on it; the rest left blank", async () => {
  const rows = challanRows([...cartons("rat", "Old Rat", 60, 80), ...cartons("ant", "Ant Repellent", 13, 80)], new Map([["rat", "RAT-OLDREPEL"]]));
  const doc = await PDFDocument.load(await challanPdf(rows, { sentAt: "2026-11-24T09:04:00Z", title: "Rajesh Shelke dispatch 1 challan" }));
  assert.equal(doc.getPageCount(), 1);
  const { width, height } = doc.getPage(0).getSize();
  assert.ok(Math.abs(width - 595.28) < 0.05 && Math.abs(height - 841.89) < 0.05, "A4");
  assert.equal(doc.getTitle(), "Rajesh Shelke dispatch 1 challan");
  const s = strings(doc, doc.getPage(0));
  for (const want of ["BIGICON", "Stock Receipt Challan", "Receipt challan no.", "24 Nov 2026", "2:34 pm", "Old Rat", "RAT-OLDREPEL · 80 pcs / carton", "Ant Repellent", "80 pcs / carton", "4,800", "1,040", "60", "13", "Handed back by  Signature"]) {
    assert.ok(s.includes(want), `missing "${want}" in ${JSON.stringify(s)}`);
  }
  assert.ok(!s.some((x) => /Page \d/.test(x)), "one page: no page numbers");
});

test("more than nine products continue on a second page, numbered on", async () => {
  const many = Array.from({ length: ROWS_PER_PAGE + 2 }, (_, i) => cartons(`p${i}`, `Product ${i + 1}`, 2, 10)).flat();
  const doc = await PDFDocument.load(await challanPdf(challanRows(many, new Map()), { sentAt: "2026-11-24T09:04:00Z", title: "t" }));
  assert.equal(doc.getPageCount(), 2);
  const second = strings(doc, doc.getPage(1));
  assert.ok(second.includes("Page 2 of 2") && second.includes("Product 10") && second.includes("Product 11") && second.includes("10") && second.includes("18"), JSON.stringify(second));
  assert.ok(second.includes("24 Nov 2026"), "the date on every page");
});
