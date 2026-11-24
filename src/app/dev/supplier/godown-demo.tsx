"use client";

import { useState } from "react";
import { Godown } from "@/components/supplier/godown";
import { usesPacked, type GodownEntry, type GodownEvent, type GodownItem } from "@/lib/godown";
import { GODOWN_EVENTS, GODOWN_ITEMS, GODOWN_PRODUCTS } from "./godown-sample";

const round3 = (n: number) => Math.round(n * 1000) / 1000;
/** A material with the box size the warehouse person said, when he said one. */
const withBox = (item: GodownItem, entry: GodownEntry): GodownItem => (entry.perBox === undefined ? item : { ...item, perBox: entry.perBox });
type Draft = GodownEvent extends infer E ? (E extends GodownEvent ? Omit<E, "id" | "at" | "who"> : never) : never;

/**
 * The godown screen on sample data that changes as you use it (kept in the page only; nothing is saved, and photos are
 * not uploaded: a material's new photo shows from the phone itself). Development preview only.
 */
export function GodownDemo({ view }: { view: "staff" | "owner" | "vrprime" }) {
  const [items, setItems] = useState(GODOWN_ITEMS);
  const [products, setProducts] = useState(GODOWN_PRODUCTS);
  const [events, setEvents] = useState<GodownEvent[]>(GODOWN_EVENTS);
  const who = view === "staff" ? "Mahesh" : "Rajesh";
  const log = (e: Draft) => setEvents((list) => [{ ...e, id: crypto.randomUUID(), at: new Date().toISOString(), who }, ...list]);

  return (
    <Godown
      items={items}
      products={products}
      events={events}
      view={view}
      onGoodsIn={async (itemId, qty, _photo, entry) => {
        setItems((list) => list.map((i) => (i.id === itemId ? { ...withBox(i, entry), onHand: round3(i.onHand + qty) } : i)));
        log({ kind: "in", itemId, qty, kg: entry.kg ?? null });
        return true;
      }}
      onMade={async (productId, units, boxes) => {
        const product = products.find((p) => p.id === productId);
        if (!product) return false;
        const used = new Map(usesPacked(product, units, boxes).map((u) => [u.itemId, u.qty]));
        setItems((list) => list.map((i) => (used.has(i.id) ? { ...i, onHand: Math.max(0, round3(i.onHand - (used.get(i.id) ?? 0))) } : i)));
        setProducts((list) => list.map((p) => (p.id === productId ? { ...p, ready: p.ready + units } : p)));
        log({ kind: "made", productId, units });
        return true;
      }}
      onCount={async (itemId, qty, entry) => {
        const before = items.find((i) => i.id === itemId)?.onHand ?? 0;
        setItems((list) => list.map((i) => (i.id === itemId ? { ...withBox(i, entry), onHand: qty } : i)));
        log({ kind: "count", itemId, diff: round3(qty - before), kg: entry.kg ?? null });
        return true;
      }}
      onPhoto={
        view === "owner"
          ? async (itemId, photo) => {
              const src = URL.createObjectURL(photo);
              setItems((list) => list.map((i) => (i.id === itemId ? { ...i, photo: src, hasPhoto: true } : i)));
              return true;
            }
          : undefined
      }
      onProductPhoto={
        view === "owner"
          ? async (productId, photo) => {
              const src = URL.createObjectURL(photo);
              setProducts((list) => list.map((p) => (p.id === productId ? { ...p, photo: src, hasPhoto: true } : p)));
              return true;
            }
          : undefined
      }
      addLinks={view === "owner" ? { material: "/dev/supplier?view=supplies&add=1", product: "/dev/supplier?view=products&add=1" } : undefined}
    />
  );
}
