"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useToast } from "@/components/toast";
import { Card, Chip, Field, buttonClass } from "@/components/ui";
import { SUPPLIER_ROLES, type SupplierRole } from "@/lib/types";
import { changeSupplierPassword, createStaffLogin, createSupplier, createSupplierLogin, removeSupplierLogin, setStaffLoginActive, setSupplierLoginActive, updateSupplier } from "@/server/actions/supplier";

export const SUPPLIER_ROLE_LABEL: Record<SupplierRole, string> = {
  supplier_owner: "Supplier owner / manager (everything in his portal)",
  supplier_scanner: "Warehouse person (labels and scanning only)",
};

/** Owner only: add a supplier and say which VRPRIME warehouse receives its goods. */
export function AddSupplier({ warehouses }: { warehouses: { id: string; name: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [warehouseId, setWarehouseId] = useState(warehouses.find((w) => /bhiwandi/i.test(w.name))?.id ?? warehouses[0]?.id ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("primary")}>
        Add supplier
      </button>
    );
  }
  return (
    <Card className="g-pad w-full">
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const result = await createSupplier({ name, warehouseId });
            setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
            if (toast.result(result)) {
              setOpen(false);
              setName("");
              router.refresh();
            }
          });
        }}
      >
        <p className="t-card-title">Add a supplier</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Supplier name" htmlFor="as-name" required error={errors.name}>
            <input id="as-name" className="input" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Sends goods to" htmlFor="as-wh" required hint="The supplier sees this warehouse's stock of its own products, and nothing else.">
            <select id="as-wh" className="input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="flex gap-2">
          <button type="submit" disabled={pending} className={buttonClass("primary")}>
            {pending ? "Saving..." : "Save"}
          </button>
          <button type="button" disabled={pending} onClick={() => setOpen(false)} className={buttonClass("outline")}>
            Cancel
          </button>
        </div>
      </form>
    </Card>
  );
}

export type SupplierLogin = { id: string; name: string; role: SupplierRole; active: boolean; email: string | null };

function tempPassword(): string {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => letters[b % letters.length]).join("");
}

/**
 * Owner only: the logins of one supplier. Each sees that supplier's portal and nothing else in the app. A login can get
 * a new password (kept as given, or one they replace at their next sign-in), be switched off for a while, or be removed.
 */
export function SupplierLogins({ supplierId, supplierName, logins }: { supplierId: string; supplierName: string; logins: SupplierLogin[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "supplier_owner" as SupplierRole, password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetPw, setResetPw] = useState("");
  const [mustChange, setMustChange] = useState(false);

  const openPassword = (l: SupplierLogin) => {
    setResetFor(resetFor === l.id ? null : l.id);
    setResetPw("");
    setMustChange(false);
  };
  const remove = (l: SupplierLogin) => {
    const lastOwner = l.role === "supplier_owner" && !logins.some((x) => x.id !== l.id && x.role === "supplier_owner");
    const text =
      `Remove ${l.name}'s login? They can no longer sign in, and the login is deleted for good. Dispatches and scans they made stay.` +
      (lastOwner ? ` ${supplierName} will have no owner login until you add one.` : "") +
      " To stop them only for a while, use Switch off instead.";
    if (!window.confirm(text)) return;
    startTransition(async () => {
      if (toast.result(await removeSupplierLogin(l.id))) {
        if (resetFor === l.id) setResetFor(null);
        router.refresh();
      }
    });
  };

  return (
    <Card className="g-pad">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="t-card-title">Logins</p>
          <p className="t-caption mt-0.5">
            People at {supplierName} who can sign in. They see this supplier&apos;s portal only. The owner / manager answers send plans and makes dispatches; a
            warehouse person prints labels and scans cartons.
          </p>
        </div>
        {open ? null : (
          <button type="button" onClick={() => setOpen(true)} className={buttonClass("outline")}>
            Add login
          </button>
        )}
      </div>

      {logins.length ? (
        <ul className="mt-3 flex flex-col divide-y divide-line-soft">
          {logins.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold">{l.name}</p>
                <p className="t-caption break-all">
                  {SUPPLIER_ROLE_LABEL[l.role]}
                  {l.email ? ` · ${l.email}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {l.active ? <Chip tone="ok">Active</Chip> : <Chip tone="bad">Switched off</Chip>}
                <button type="button" disabled={pending} aria-expanded={resetFor === l.id} onClick={() => openPassword(l)} className={buttonClass("row")}>
                  Change password
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      if (toast.result(await setSupplierLoginActive(l.id, !l.active))) router.refresh();
                    })
                  }
                  className={buttonClass("row")}
                >
                  {l.active ? "Switch off" : "Switch on"}
                </button>
                <button type="button" disabled={pending} onClick={() => remove(l)} className={buttonClass("danger", "g-btn-row")}>
                  Remove
                </button>
              </div>
              {resetFor === l.id ? (
                <form
                  className="flex w-full flex-col gap-3 rounded-[12px] border border-frame bg-surface2 p-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    startTransition(async () => {
                      if (toast.result(await changeSupplierPassword(l.id, resetPw, mustChange))) {
                        setResetFor(null);
                        setResetPw("");
                      }
                    });
                  }}
                >
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[14px] text-muted">
                      New password for {l.name}
                      <input className="input font-mono" autoComplete="off" value={resetPw} onChange={(e) => setResetPw(e.target.value)} />
                    </label>
                    <button type="button" onClick={() => setResetPw(tempPassword())} className={buttonClass("outline")}>
                      Generate
                    </button>
                  </div>
                  <label className="flex items-start gap-2 text-[15px]">
                    <input type="checkbox" className="mt-1" checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} />
                    Ask {l.name} to choose a new password at the next sign-in
                  </label>
                  <p className="t-caption">
                    At least 8 characters. Tell {l.name} the new password
                    {mustChange ? "; it works once, then they set their own." : ". It stays until they change it with the Password button."}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button type="submit" disabled={pending || resetPw.length < 8} className={buttonClass("primary")}>
                      {pending ? "Saving..." : "Save password"}
                    </button>
                    <button type="button" disabled={pending} onClick={() => setResetFor(null)} className={buttonClass("outline")}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="t-caption mt-3">No login yet.</p>
      )}

      {open ? (
        <form
          noValidate
          className="mt-4 flex flex-col gap-4 border-t border-line-soft pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const result = await createSupplierLogin({ supplierId, ...form });
              setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
              if (toast.result(result)) {
                setOpen(false);
                setForm({ name: "", email: "", role: "supplier_owner", password: "" });
                router.refresh();
              }
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="sl-name" required error={errors.name}>
              <input id="sl-name" className="input" maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Email" htmlFor="sl-email" required error={errors.email} hint="They sign in with this.">
              <input id="sl-email" className="input" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="What they can do" htmlFor="sl-role" required>
              <select id="sl-role" className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as SupplierRole })}>
                {SUPPLIER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {SUPPLIER_ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Temporary password" htmlFor="sl-pass" required error={errors.password} hint="Tell them this. They choose their own the first time they sign in.">
              <div className="flex gap-2">
                <input id="sl-pass" className="input font-mono" autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                <button type="button" onClick={() => setForm({ ...form, password: tempPassword() })} className={buttonClass("outline")}>
                  Generate
                </button>
              </div>
            </Field>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className={buttonClass("primary")}>
              {pending ? "Creating..." : "Create login"}
            </button>
            <button type="button" disabled={pending} onClick={() => setOpen(false)} className={buttonClass("outline")}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}

export type StaffLogin = { id: string; name: string; role: "owner" | "admin"; active: boolean };

/** Owner only: VRPRIME's own logins. An admin does everything except manage logins and add suppliers. */
export function StaffLogins({ logins, me }: { logins: StaffLogin[]; me: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "admin" as "owner" | "admin", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});

  return (
    <Card className="g-pad">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="t-card-title">VRPRIME logins</p>
          <p className="t-caption mt-0.5">
            VRPRIME&apos;s own people only: they see every supplier and all of VRPRIME&apos;s stock, and they never get a supplier&apos;s Accept buttons. A supplier&apos;s
            people (Rajesh and his staff) are added on that supplier&apos;s page: Suppliers, then the supplier, then Logins.
          </p>
        </div>
        {open ? null : (
          <button type="button" onClick={() => setOpen(true)} className={buttonClass("primary")}>
            Add login
          </button>
        )}
      </div>

      <ul className="mt-3 flex flex-col divide-y divide-line-soft">
        {logins.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <div className="min-w-0">
              <p className="text-[15px] font-semibold">
                {l.name}
                {l.id === me ? <span className="font-normal text-muted"> (you)</span> : null}
              </p>
              <p className="t-caption">{l.role === "owner" ? "Owner" : "Admin"}</p>
            </div>
            <div className="flex items-center gap-2">
              {l.active ? <Chip tone="ok">Active</Chip> : <Chip tone="bad">Switched off</Chip>}
              {l.id === me ? null : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      if (toast.result(await setStaffLoginActive(l.id, !l.active))) router.refresh();
                    })
                  }
                  className={buttonClass("row")}
                >
                  {l.active ? "Switch off" : "Switch on"}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {open ? (
        <form
          noValidate
          className="mt-4 flex flex-col gap-4 border-t border-line-soft pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const result = await createStaffLogin(form);
              setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
              if (toast.result(result)) {
                setOpen(false);
                setForm({ name: "", email: "", role: "admin", password: "" });
                router.refresh();
              }
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="st-name" required error={errors.name}>
              <input id="st-name" className="input" maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Email" htmlFor="st-email" required error={errors.email} hint="They sign in with this.">
              <input id="st-email" className="input" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Role" htmlFor="st-role" required hint="Both are VRPRIME roles. An owner can also manage logins and add suppliers. Never use these for a supplier's people.">
              <select id="st-role" className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as "owner" | "admin" })}>
                <option value="admin">Admin</option>
                <option value="owner">Owner</option>
              </select>
            </Field>
            <Field label="Temporary password" htmlFor="st-pass" required error={errors.password} hint="Tell them this. They choose their own the first time they sign in.">
              <div className="flex gap-2">
                <input id="st-pass" className="input font-mono" autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                <button type="button" onClick={() => setForm({ ...form, password: tempPassword() })} className={buttonClass("outline")}>
                  Generate
                </button>
              </div>
            </Field>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className={buttonClass("primary")}>
              {pending ? "Creating..." : "Create login"}
            </button>
            <button type="button" disabled={pending} onClick={() => setOpen(false)} className={buttonClass("outline")}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}

/** Owner only: rename the supplier, change where it sends goods, or switch it off (its logins then see nothing). */
export function EditSupplier({ supplier, warehouses }: { supplier: { id: string; name: string; warehouse_id: string; active: boolean }; warehouses: { id: string; name: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: supplier.name, warehouseId: supplier.warehouse_id, active: supplier.active });
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("row")}>
        Edit supplier
      </button>
    );
  }
  return (
    <Card className="g-pad w-full">
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.active && supplier.active && !window.confirm(`Switch ${supplier.name} off? Its logins will no longer see anything.`)) return;
          startTransition(async () => {
            const result = await updateSupplier({ supplierId: supplier.id, ...form });
            setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
            if (toast.result(result)) {
              setOpen(false);
              router.refresh();
            }
          });
        }}
      >
        <p className="t-card-title">Edit {supplier.name}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Supplier name" htmlFor="es-name" required error={errors.name}>
            <input id="es-name" className="input" maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Sends goods to" htmlFor="es-wh" required hint="The supplier sees this warehouse's stock of its own products. Labels are made for this warehouse.">
            <select id="es-wh" className="input" value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-[15px]">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
          Active (its logins can sign in and see the portal)
        </label>
        <div className="flex gap-2">
          <button type="submit" disabled={pending} className={buttonClass("primary")}>
            {pending ? "Saving..." : "Save"}
          </button>
          <button type="button" disabled={pending} onClick={() => setOpen(false)} className={buttonClass("outline")}>
            Cancel
          </button>
        </div>
      </form>
    </Card>
  );
}
