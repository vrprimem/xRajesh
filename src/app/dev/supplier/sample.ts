import type { CartonType } from "@/lib/supplier";
import type { CartonRow, DispatchDetail, ProductRow } from "@/server/supplier-data";

// Fake data for the development preview (/dev/supplier) and its label downloads. Nothing here is real.

export const SUPPLIER = "00000000-0000-4000-8000-000000000001";
export const DISPATCH = "00000000-0000-4000-8000-0000000000d1";
/** A dispatch with more than 50 labels of a product, so its labels download in parts. */
export const BIG_DISPATCH = "00000000-0000-4000-8000-0000000000d2";
export const pid = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
// Like the inventory software's numbers: 1, the warehouse (01), then a running number.
export const code = (n: number) => `101${String(n).padStart(13, "0")}`;

export const PRODUCTS: ProductRow[] = [
  { id: pid(1), name: "Kitchen Cleaner Spray 500ml", master_id: pid(51), master_code: "150-KITCHEN", category: "kitchen_cleaner", units_per_carton: 24, daily_capacity: 1200, active: true, weight_per_carton: 8.5 },
  { id: pid(2), name: "Rat Repellent Spray 300ml", master_id: pid(52), master_code: "160-RAT", category: "repellent", units_per_carton: 48, daily_capacity: 900, active: true, weight_per_carton: 8.5 },
  { id: pid(3), name: "Lizard Repellent Spray 250ml", master_id: null, master_code: null, category: "repellent", units_per_carton: 60, daily_capacity: null, active: true, weight_per_carton: 8.5 },
  { id: pid(4), name: "Scratch Remover Bottle 150ml", master_id: pid(54), master_code: "150-SCRATCH", category: "other_cleaning", units_per_carton: 110, daily_capacity: 2000, active: false, weight_per_carton: 8.5 },
];

function fakeCartons(): CartonRow[] {
  const out: CartonRow[] = [];
  const add = (product: ProductRow, type: CartonType, count: number, loaded: number) => {
    for (let i = 0; i < count; i++) {
      const no = out.length + 1;
      out.push({ id: `c${no}`, product_id: product.id, product: product.name, carton_type: type, units: product.units_per_carton, carton_no: no, barcode: code(4800 + no), status: i < loaded ? "loaded" : "issued", loaded_at: i < loaded ? "2026-11-23T05:40:00Z" : null, void_reason: null, inbound_status: null, weight_per_carton: type === "H" ? 8.5 : 6.2 });
    }
  };
  add(PRODUCTS[0], "H", 6, 4);
  add(PRODUCTS[1], "T", 5, 1);
  out[5] = { ...out[5], status: "void", void_reason: "reprinted" };
  out.push({ ...out[5], id: "c12", carton_no: 12, barcode: code(4812), status: "issued", void_reason: null });
  return out;
}

export const DETAIL: DispatchDetail = {
  dispatch: { id: DISPATCH, supplier_id: SUPPLIER, number: 7, status: "loading", due_on: "2026-11-24", note: "Tempo MH04 AB 1234, driver Suresh", vehicle_photo_path: null, created_at: "2026-11-22T10:00:00Z", closed_at: null, received_at: null, labels_run_at: null, labels_error: null },
  lines: [
    { product_id: pid(1), product: PRODUCTS[0].name, carton_type: "H", units_per_carton: 24, cartons: 6, weight_per_carton: 8.5 },
    { product_id: pid(2), product: PRODUCTS[1].name, carton_type: "T", units_per_carton: 48, cartons: 5, weight_per_carton: 6.2 },
  ],
  cartons: fakeCartons(),
  photoUrl: null,
};

// Shaped like a real first dispatch: 183 labels of 9 products, one of them (Old Rat) with 60.
const BIG_LINES: [string, number, number][] = [
  ["Ant Repellent", 13, 80],
  ["Cockroach Repellent", 6, 80],
  ["HouseFly Repellent", 40, 80],
  ["New Scratch 250ml", 12, 80],
  ["Old Bedbug", 36, 80],
  ["Old Lizard", 11, 80],
  ["Old Rat", 60, 80],
  ["Rat Balls", 1, 80],
  ["Scratch 150", 4, 80],
];

/** The products of the big sample dispatch (for adding more to it), and two more that are not on it yet. */
export const BIG_PRODUCTS: ProductRow[] = [
  ...BIG_LINES.map(([name, , units], i) => ({ id: pid(60 + i), name, master_id: pid(80 + i), master_code: `SAMPLE-${i + 1}`, category: "repellent" as const, units_per_carton: units, daily_capacity: null, active: true, weight_per_carton: 20 })),
  { id: pid(70), name: "Mosquito Repellent", master_id: pid(90), master_code: "SAMPLE-10", category: "repellent", units_per_carton: 60, daily_capacity: null, active: true, weight_per_carton: 15 },
  { id: pid(71), name: "Glass Cleaner 500ml", master_id: pid(91), master_code: "SAMPLE-11", category: "other_cleaning", units_per_carton: 24, daily_capacity: null, active: true, weight_per_carton: 12.5 },
];

function bigDetail(): DispatchDetail {
  const lines: DispatchDetail["lines"] = BIG_LINES.map(([product, cartons, units], i) => ({ product_id: pid(60 + i), product, carton_type: "H", units_per_carton: units, cartons, weight_per_carton: 20 }));
  const cartons: CartonRow[] = [];
  for (const l of lines) {
    for (let i = 0; i < l.cartons; i++) {
      const no = cartons.length + 1;
      cartons.push({ id: `00000000-0000-4000-8000-${String(no).padStart(12, "0")}`, product_id: l.product_id, product: l.product, carton_type: "H", units: l.units_per_carton, carton_no: no, barcode: code(9000 + no), status: "issued", loaded_at: null, void_reason: null, inbound_status: null, weight_per_carton: 20 });
    }
  }
  return {
    dispatch: { id: BIG_DISPATCH, supplier_id: SUPPLIER, number: 8, status: "planned", due_on: "2026-11-25", note: "Sample: 183 labels, Old Rat 60", vehicle_photo_path: null, created_at: "2026-11-24T09:04:00Z", closed_at: null, received_at: null, labels_run_at: null, labels_error: null },
    lines,
    cartons,
    photoUrl: null,
  };
}

export const BIG_DETAIL = bigDetail();

/** The same dispatch once loaded and sent at 2:34 pm: every carton loaded, one Old Rat carton packed with 40 pieces. */
export const SENT_DISPATCH = "00000000-0000-4000-8000-0000000000d3";
export const SENT_DETAIL: DispatchDetail = {
  ...BIG_DETAIL,
  dispatch: { ...BIG_DETAIL.dispatch, id: SENT_DISPATCH, number: 9, status: "closed", closed_at: "2026-11-24T09:04:00Z", note: "Sample: sent at 2:34 pm", vehicle_photo_path: "x.jpg" },
  cartons: BIG_DETAIL.cartons.map((c) => ({ ...c, status: "loaded" as const, loaded_at: "2026-11-24T08:50:00Z", units: c.carton_no === 178 ? 40 : c.units })),
};

/** Every sample product, with its master SKU (for the challan). */
export const SAMPLE_PRODUCTS: ProductRow[] = [...PRODUCTS, ...BIG_PRODUCTS];

/** The sample dispatches whose labels and challan the preview can download. */
export const SAMPLE_DISPATCHES: Record<string, DispatchDetail> = { [DISPATCH]: DETAIL, [BIG_DISPATCH]: BIG_DETAIL, [SENT_DISPATCH]: SENT_DETAIL };
