"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { WithPhoto } from "@/components/supplier/product-photo";
import { BulkPhotoUpload, PhotoButtons } from "@/components/supplier/photo-upload";
import { useToast } from "@/components/toast";
import { Card, Chip, EmptyState, Field, buttonClass } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import type { MasterSku } from "@/lib/master-search";
import { CATEGORY_LABEL, PRODUCT_CATEGORIES, parseProductsTable, parseWeight, type ProductCategory, type ProductInput } from "@/lib/supplier";
import { uploadSupplierPhoto } from "@/lib/supplier-photo-upload";
import { saveProducts } from "@/server/actions/supplier";
import { setProductPhoto } from "@/server/actions/supplies";
import type { ProductRow } from "@/server/supplier-data";
import { MasterSkuPicker } from "./master-sku-picker";

type Form = { name: string; master: MasterSku | null; category: ProductCategory; units: string; capacity: string; weight: string; active: boolean; editing: boolean };
const EMPTY: Form = { name: "", master: null, category: "other", units: "", capacity: "", weight: "", active: true, editing: false };

/**
 * The supplier's products: search, filter by category, add or edit one, and import the whole sheet (.xlsx or .csv).
 * `canEdit` is the supplier owner and VRPRIME's owner and admin; the warehouse person only reads. The master SKU is
 * picked by searching its name (`demoMasters` is only for the dev preview, which has no database). `canPhoto`:
 * VRPRIME's photos of the master SKUs; `ownPhotos`: the supplier owner's own photo of each product, which shows in
 * place of VRPRIME's. `startAdding` opens the form for a new product.
 */
export function ProductsPanel({
  supplierId,
  products,
  canEdit,
  demoMasters,
  photos = {},
  canPhoto = false,
  ownPhotos = false,
  startAdding = false,
}: {
  supplierId: string;
  products: ProductRow[];
  canEdit: boolean;
  demoMasters?: { code: string; name: string }[];
  photos?: Record<string, string>;
  canPhoto?: boolean;
  ownPhotos?: boolean;
  startAdding?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ProductCategory | "all">("all");
  const [form, setForm] = useState<Form | null>(canEdit && startAdding ? EMPTY : null);
  const [problems, setProblems] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const [photoFor, setPhotoFor] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  /** The owner's photo of a product: a small JPEG in the supplier's folder, then put on the product. */
  const uploadOwnPhoto = async (file: File) => {
    const product = photoFor;
    if (!product) return;
    setUploading(true);
    try {
      const path = await uploadSupplierPhoto(supplierId, "products", file);
      if (!path) toast.show("The photo could not be uploaded. Check your connection and try again.", "bad");
      else if (toast.result(await setProductPhoto(product, path))) router.refresh();
    } finally {
      setUploading(false);
      setPhotoFor(null);
      if (photoInput.current) photoInput.current.value = "";
    }
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => (category === "all" || p.category === category) && (!q || p.name.toLowerCase().includes(q) || (p.master_code ?? "").toLowerCase().includes(q)));
  }, [products, query, category]);

  const save = (rows: ProductInput[], after: () => void) =>
    startTransition(async () => {
      const result = await saveProducts(supplierId, rows);
      if (toast.result(result)) {
        after();
        router.refresh();
      } else setProblems([result.message]);
    });

  const submit = () => {
    if (!form) return;
    const units = Number(form.units);
    const capacity = form.capacity.trim() === "" ? null : Number(form.capacity);
    if (!form.name.trim()) return setProblems(["Enter the product name."]);
    if (!Number.isInteger(units) || units < 1) return setProblems(["Units per carton must be a whole number from 1."]);
    if (capacity !== null && (!Number.isInteger(capacity) || capacity < 0)) return setProblems(["Daily capacity must be a whole number."]);
    const weight = parseWeight(form.weight);
    if (weight === "bad") return setProblems(["Carton weight must be a number of kg above 0, for example 8.5."]);
    setProblems([]);
    save([{ name: form.name.trim(), master_code: form.master?.code ?? null, category: form.category, units_per_carton: units, daily_capacity: capacity, active: form.active, weight_per_carton: weight }], () => setForm(null));
  };

  const importFile = async (file: File) => {
    setProblems([]);
    try {
      const { readTable } = await import("@/lib/read-table");
      const { rows, errors } = parseProductsTable(await readTable(file));
      if (errors.length) return setProblems(errors.slice(0, 12).concat(errors.length > 12 ? [`... and ${errors.length - 12} more.`] : []));
      save(rows, () => undefined);
    } catch {
      setProblems(["That file could not be read. Use an .xlsx or .csv file."]);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const edit = (p: ProductRow) => {
    setProblems([]);
    setForm({ name: p.name, master: p.master_code ? { code: p.master_code, name: null } : null, category: p.category, units: String(p.units_per_carton), capacity: p.daily_capacity === null ? "" : String(p.daily_capacity), weight: p.weight_per_carton === null ? "" : String(p.weight_per_carton), active: p.active, editing: true });
  };

  return (
    <div className="flex flex-col gap-4">
      {ownPhotos ? <input ref={photoInput} type="file" accept="image/*" className="sr-only" aria-label="Photo of the product" onChange={(e) => e.target.files?.[0] && void uploadOwnPhoto(e.target.files[0])} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" type="search" placeholder="Search by name or master SKU" aria-label="Search products" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="input w-auto" aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value as ProductCategory | "all")}>
          <option value="all">All categories</option>
          {PRODUCT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        {canEdit ? (
          <div className="ml-auto flex flex-wrap gap-2">
            <input ref={fileRef} type="file" accept=".xlsx,.csv" className="sr-only" aria-label="Import products from a sheet" onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
            <button type="button" disabled={pending} onClick={() => fileRef.current?.click()} className={buttonClass("outline")}>
              Import sheet
            </button>
            <button type="button" disabled={pending} onClick={() => (setProblems([]), setForm(EMPTY))} className={buttonClass("primary")}>
              Add product
            </button>
          </div>
        ) : null}
      </div>

      {canEdit ? (
        <p className="t-caption">
          Import sheet: an .xlsx or .csv whose first row has the headings Name and Units per carton, and optionally Master SKU, Category, Carton weight (kg) and Daily capacity. Products are matched by name: new names are added, existing ones updated, nothing is removed.
        </p>
      ) : null}
      {ownPhotos ? <p className="t-caption -mt-2">Add a photo of each product: your team sees it wherever they read what to make or send.</p> : null}

      {problems.length ? (
        <Card className="g-pad">
          <p className="t-card-title text-bad">Not saved</p>
          <ul className="mt-2 list-disc pl-5 text-[15px]">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      {form ? (
        <Card className="g-pad">
          <form
            noValidate
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <p className="t-card-title">{form.editing ? `Edit ${form.name}` : "Add a product"}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Product name" htmlFor="sp-name" required hint={form.editing ? "The name identifies the product and cannot be changed here." : undefined}>
                <input id="sp-name" className="input" maxLength={200} value={form.name} disabled={form.editing} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field
                label="VRPRIME master SKU"
                htmlFor="sp-master"
                hint="Type part of the product's name, for example cleaner, and pick it. The list is VRPRIME's products in the inventory software; stock and labels both come from it."
              >
                <MasterSkuPicker
                  id="sp-master"
                  value={form.master}
                  demo={demoMasters}
                  onChange={(m) => setForm((f) => (f ? { ...f, master: m, name: !f.editing && !f.name.trim() && m?.name ? m.name : f.name } : f))}
                />
              </Field>
              <Field label="Category" htmlFor="sp-cat" required>
                <select id="sp-cat" className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ProductCategory })}>
                  {PRODUCT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Units per carton" htmlFor="sp-units" required>
                <input id="sp-units" className="input" inputMode="numeric" value={form.units} onChange={(e) => setForm({ ...form, units: e.target.value })} />
              </Field>
              <Field label="Carton weight (kg)" htmlFor="sp-weight" hint="A full carton, for example 8.5. Printed on the label and sent to the VRPRIME inventory software with it.">
                <input id="sp-weight" className="input" inputMode="decimal" placeholder="e.g. 8.5" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} />
              </Field>
              <Field label="Daily production capacity" htmlFor="sp-cap" hint="Units a day.">
                <input id="sp-cap" className="input" inputMode="numeric" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-[15px]">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Active (can be put on a dispatch plan)
            </label>
            <div className="flex gap-2">
              <button type="submit" disabled={pending} className={buttonClass("primary")}>
                {pending ? "Saving..." : "Save"}
              </button>
              <button type="button" disabled={pending} onClick={() => setForm(null)} className={buttonClass("outline")}>
                Cancel
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      {canPhoto && products.some((p) => p.master_code) ? (
        <BulkPhotoUpload
          targets={[...new Set(products.filter((p) => p.master_code).map((p) => p.master_code!))].map((code) => ({ code, names: products.filter((p) => p.master_code === code).map((p) => p.name) }))}
          missing={products.filter((p) => p.active && p.master_code && !photos[p.id]).length}
        />
      ) : null}

      {products.length === 0 ? (
        <EmptyState title="No products yet" body={canEdit ? "Add the first product, or import the whole sheet at once." : "The owner has not added any products yet."} />
      ) : (
        <Card className="ledger-card">
          <table className="ledger">
            <thead>
              <tr>
                <th scope="col" className="min-w-[170px]">Product</th>
                <th scope="col">Master SKU</th>
                <th scope="col">Category</th>
                <th scope="col" className="num">Units / carton</th>
                <th scope="col" className="num">Weight</th>
                <th scope="col" className="num">Capacity / day</th>
                {canPhoto ? <th scope="col">Photo</th> : null}
                {canEdit ? (
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} className={p.active ? "" : "opacity-60"}>
                  <th scope="row" className="text-left font-semibold">
                    <WithPhoto src={canPhoto ? null : photos[p.id]} name={p.name} size={48}>
                      {p.name}
                      {p.active ? null : <span className="ml-2 font-normal text-muted">inactive</span>}
                    </WithPhoto>
                  </th>
                  <td>{p.master_code ?? <Chip tone="warn">Not linked</Chip>}</td>
                  <td>{CATEGORY_LABEL[p.category]}</td>
                  <td className="num tabular-nums">{formatNumber(p.units_per_carton)}</td>
                  <td className="num tabular-nums">{p.weight_per_carton === null ? "-" : `${p.weight_per_carton} kg`}</td>
                  <td className="num tabular-nums">{p.daily_capacity === null ? "-" : formatNumber(p.daily_capacity)}</td>
                  {canPhoto ? (
                    <td>
                      <PhotoButtons code={p.master_code} name={p.name} src={photos[p.id]} />
                    </td>
                  ) : null}
                  {canEdit ? (
                    <td className="text-right">
                      <span className="flex justify-end gap-2">
                        {ownPhotos ? (
                          <button type="button" disabled={uploading} onClick={() => (setPhotoFor(p.id), photoInput.current?.click())} className={buttonClass("row")}>
                            {uploading && photoFor === p.id ? "Uploading..." : photos[p.id] ? "Change photo" : "Add photo"}
                          </button>
                        ) : null}
                        <button type="button" onClick={() => edit(p)} className={buttonClass("row")}>
                          Edit
                        </button>
                      </span>
                    </td>
                  ) : null}
                </tr>
              ))}
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={7 + (canEdit ? 1 : 0) + (canPhoto ? 1 : 0)} className="text-muted">
                    No product matches.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
