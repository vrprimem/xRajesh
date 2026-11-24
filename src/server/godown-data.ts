import "server-only";
import type { GodownEvent, GodownItem, GodownProduct, RecipeUse } from "@/lib/godown";
import { familyColours, pictureFor } from "@/lib/godown-pictures";
import { perLitre, staffItemName } from "@/lib/supplies";
import { loadProductPhotos, signedPhotos, soft, supplierDb } from "@/server/supplier-data";
import { loadItemStock, loadReadyStock, loadRecipes } from "@/server/supplies-data";

// What the godown screen reads, as the signed-in person: the supplier's logins and VRPRIME see it (no money in it).

export type GodownData = { items: GodownItem[]; products: GodownProduct[]; events: GodownEvent[]; installed: boolean };

type EventRow = { at: string; who: string; kind: "in" | "count" | "made"; item_id: string | null; product_id: string | null; qty: number | string; photo_path: string | null; kg: number | string | null };

/**
 * The supplier's materials in use (with their simple names, and their photo or a drawn picture until one is added),
 * its products with their recipes and ready stock, and what was entered at the godown today. `installed` is false
 * before Phase 2's tables.
 */
export async function loadGodown(supplierId: string): Promise<GodownData> {
  const db = await supplierDb();
  const [stock, ready, recipes, productPhotos, events] = await Promise.all([
    loadItemStock(supplierId),
    loadReadyStock(supplierId),
    loadRecipes(supplierId),
    loadProductPhotos(supplierId),
    db.rpc("supplier_godown_events", { p_supplier: supplierId, p_days: 1 }),
  ]);
  if (!stock.installed || !ready.installed) return { items: [], products: [], events: [], installed: false };
  const rows = soft("godown events", events.error, events.data as EventRow[] | null, []);

  // Materials' photos and today's bill photos are private files: links good for an hour.
  const signed = await signedPhotos([...stock.items.map((i) => i.photo_path), ...rows.map((e) => e.photo_path)]);

  // One colour per product for the drawn stickers and chemicals, over every material (so as the Supplies page).
  const colours = familyColours(stock.items.map((i) => ({ kind: i.kind, name: staffItemName(i) })));
  const items: GodownItem[] = stock.items
    .filter((i) => i.active)
    .map((i) => {
      const photo = i.photo_path ? signed.get(i.photo_path) : undefined;
      return {
        id: i.id,
        name: i.name,
        simple: { en: i.simple_name ?? undefined, hi: i.simple_name_hi ?? undefined, mr: i.simple_name_mr ?? undefined },
        kind: i.kind,
        unit: i.unit,
        perBox: i.box_qty ? Number(i.box_qty) : null,
        onHand: i.on_hand,
        lowLevel: i.low_level,
        photo: photo ?? pictureFor(i.kind, staffItemName(i), colours),
        hasPhoto: Boolean(photo),
        ...(i.mix_qty && i.mix_litres ? { mix: { qty: Number(i.mix_qty), litres: Number(i.mix_litres) } } : {}),
      };
    });

  // A chemical mixed with water is in a recipe as the litres of liquid a piece takes; it comes off in its own unit
  // (kg) by what it makes, as the database takes it off.
  const ratio = new Map(stock.items.map((i) => [i.id, perLitre(i)]));
  const byProduct = new Map<string, RecipeUse[]>();
  for (const r of recipes) {
    const list = byProduct.get(r.product_id) ?? [];
    const per = ratio.get(r.item_id);
    const qty = Number(r.qty);
    list.push(per ? { itemId: r.item_id, qty: qty * per, per: r.per, litres: qty } : { itemId: r.item_id, qty, per: r.per });
    byProduct.set(r.product_id, list);
  }
  const products: GodownProduct[] = ready.rows
    .filter((r) => r.active)
    .map((r) => ({
      id: r.product_id,
      name: r.name,
      perCarton: r.units_per_carton,
      ready: r.ready,
      recipe: byProduct.get(r.product_id) ?? [],
      photo: productPhotos[r.product_id],
      hasPhoto: Boolean(productPhotos[r.product_id]),
    }));

  const list: GodownEvent[] = [];
  rows.forEach((e, i) => {
    const base = { id: `${e.at}-${i}`, at: e.at, who: e.who || "-" };
    if (e.kind === "made" && e.product_id) list.push({ ...base, kind: "made", productId: e.product_id, units: Number(e.qty) });
    else if (e.kind === "in" && e.item_id) list.push({ ...base, kind: "in", itemId: e.item_id, qty: Number(e.qty), photo: e.photo_path ? (signed.get(e.photo_path) ?? null) : null, kg: e.kg === null ? null : Number(e.kg) });
    else if (e.kind === "count" && e.item_id) list.push({ ...base, kind: "count", itemId: e.item_id, diff: Number(e.qty), kg: e.kg === null ? null : Number(e.kg) });
  });
  return { items, products, events: list, installed: true };
}
