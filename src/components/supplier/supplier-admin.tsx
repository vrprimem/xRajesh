"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useToast } from "@/components/toast";
import { Card, Chip, Field, buttonClass } from "@/components/ui";
import { SUPPLIER_ROLES, type SupplierRole } from "@/lib/types";
import { createStaffLogin, createSupplier, createSupplierLogin, setStaffLoginActive, setSupplierLoginActive } from "@/server/actions/supplier";

export const SUPPLIER_ROLE_LABEL: Record<SupplierRole, string> = { supplier_owner: "Supplier owner", supplier_scanner: "Warehouse person (scan only)" };

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

/** Owner only: the logins of one supplier. Each sees that supplier's portal and nothing else in the app. */
export function SupplierLogins({ supplierId, supplierName, logins }: { supplierId: string; supplierName: string; logins: SupplierLogin[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "supplier_owner" as SupplierRole, password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});

  return (
    <Card className="g-pad">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="t-card-title">Logins</p>
          <p className="t-caption mt-0.5">People at {supplierName} who can sign in. They see this supplier&apos;s portal only.</p>
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
                <p className="text-[13px] font-semibold">{l.name}</p>
                <p className="t-caption break-all">
                  {SUPPLIER_ROLE_LABEL[l.role]}
                  {l.email ? ` · ${l.email}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {l.active ? <Chip tone="ok">Active</Chip> : <Chip tone="bad">Switched off</Chip>}
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
              </div>
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
          <p className="t-caption mt-0.5">Your own people. They see every supplier. Supplier logins are added on each supplier&apos;s page.</p>
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
              <p className="text-[13px] font-semibold">
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
            <Field label="Role" htmlFor="st-role" required hint="An owner can also manage logins and add suppliers.">
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
