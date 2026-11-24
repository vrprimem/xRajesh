"use client";

import { useRouter } from "next/navigation";
import { Godown } from "@/components/supplier/godown";
import { useToast } from "@/components/toast";
import type { GodownEvent, GodownItem, GodownProduct } from "@/lib/godown";
import { uploadSupplierPhoto } from "@/lib/supplier-photo-upload";
import type { ActionResult } from "@/lib/types";
import { countItem, goodsIn, madeToday, setItemPhoto, setProductPhoto } from "@/server/actions/supplies";

/**
 * The godown screen, saving for real: goods in (with the bill's photo when one was taken), made today and counts; and,
 * for the owner, each material's and product's photo, and links to add a new one. The screen shows its own big tick in
 * the chosen language, so only a refusal shows a message here.
 */
export function GodownLive({ supplierId, items, products, events, view }: { supplierId: string; items: GodownItem[]; products: GodownProduct[]; events: GodownEvent[]; view: "staff" | "owner" }) {
  const router = useRouter();
  const toast = useToast();
  const done = (result: ActionResult<unknown>) => {
    if (!result.ok) {
      toast.result(result);
      return false;
    }
    router.refresh();
    return true;
  };

  return (
    <Godown
      items={items}
      products={products}
      events={events}
      view={view}
      onGoodsIn={async (itemId, qty, photo, entry) => {
        const path = photo ? await uploadSupplierPhoto(supplierId, "goods-in", photo) : null;
        if (photo && !path) toast.show("The bill photo could not be uploaded. The goods are saved without it.", "bad");
        return done(await goodsIn(itemId, qty, path, entry));
      }}
      onMade={async (productId, units, boxes) => done(await madeToday(productId, units, boxes))}
      onCount={async (itemId, qty, entry) => done(await countItem(itemId, qty, "", entry))}
      onPhoto={
        view === "owner"
          ? async (itemId, file) => {
              const path = await uploadSupplierPhoto(supplierId, "items", file);
              if (!path) {
                toast.show("The photo could not be uploaded. Check your connection and try again.", "bad");
                return false;
              }
              return done(await setItemPhoto(itemId, path));
            }
          : undefined
      }
      onProductPhoto={
        view === "owner"
          ? async (productId, file) => {
              const path = await uploadSupplierPhoto(supplierId, "products", file);
              if (!path) {
                toast.show("The photo could not be uploaded. Check your connection and try again.", "bad");
                return false;
              }
              return done(await setProductPhoto(productId, path));
            }
          : undefined
      }
      addLinks={view === "owner" ? { material: "/supplier/supplies?add=1", product: "/supplier/products?add=1" } : undefined}
    />
  );
}
