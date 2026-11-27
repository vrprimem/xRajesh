import "server-only";
import { EMPTY_BOOK, parseBook, type BookItem, type DayBook } from "@/lib/day-book";
import { notInstalled, signedPhotos, soft, supplierDb } from "@/server/supplier-data";
import { loadItemStock } from "@/server/supplies-data";

// What the day book reads, as the signed-in person: the database answers the supplier's owner and VRPRIME only.

export type DayBookData = {
  /** False before the day book's migration is applied. */
  installed: boolean;
  book: DayBook;
  /** The supplies by id, with their names and unit. */
  items: Record<string, BookItem>;
  /** The products' names by id. */
  products: Record<string, string>;
  /** The goods-in bills' photos by path, as links good for an hour. */
  bills: Record<string, string>;
};

/** Goods in, loading and dispatches sent between two days in India (YYYY-MM-DD, both included). */
export async function loadDayBook(supplierId: string, from: string, to: string): Promise<DayBookData> {
  const db = await supplierDb();
  const [answer, stock, products] = await Promise.all([
    db.rpc("supplier_day_book", { p_supplier: supplierId, p_from: from, p_to: to }),
    loadItemStock(supplierId),
    db.from("supplier_products").select("id, name").eq("supplier_id", supplierId).limit(5000),
  ]);
  if (notInstalled(answer.error)) return { installed: false, book: EMPTY_BOOK, items: {}, products: {}, bills: {} };
  const book = parseBook(soft("day book", answer.error, answer.data as unknown, null));
  const signed = await signedPhotos(book.in.map((e) => e.photo_path));
  return {
    installed: true,
    book,
    items: Object.fromEntries(stock.items.map((i) => [i.id, { name: i.name, simple: i.simple_name ?? null, unit: i.unit, perBox: i.box_qty ?? null }])),
    products: Object.fromEntries(soft("products", products.error, products.data as { id: string; name: string }[] | null, []).map((p) => [p.id, p.name])),
    bills: Object.fromEntries(signed),
  };
}
