"use client";

import { useMemo, useState, useTransition } from "react";
import { ConfirmButton, FormButtons, StatTile } from "@/components/supplier/entry-kit";
import { useToast } from "@/components/toast";
import { Card, EmptyState, Field, SectionHead, buttonClass } from "@/components/ui";
import { formatDate, formatINR, formatNumber } from "@/lib/format";
import { purchaseAmount, type CostSheet, type MonthMoney } from "@/lib/money";
import {
  COST_KIND_LABEL,
  COST_KINDS,
  formatQty,
  formatRupees,
  GST_RATES,
  PAY_MODE_LABEL,
  PAY_MODES,
  readNumber,
  UNIT_ONE,
  UNIT_SHORT,
  type CostKind,
  type ItemStock,
  type PayMode,
  type Purchase,
} from "@/lib/supplies";
import { removeMoneyEntry, saveCost, savePayment, savePurchase, saveVendor } from "@/server/actions/supplies";
import type { MoneyData } from "@/server/supplies-data";

type Open = { kind: "purchase" } | { kind: "payment"; vendor?: string } | { kind: "cost" } | { kind: "vendor" } | null;

/**
 * The supplier's money in one place, for its owner only: what the month cost (supplies bought, labour, hamali and the
 * rest), what one unit of each product costs to make, what is owed to each vendor, and every entry, each removable.
 */
export function MoneyPanel({ month, data, totals, sheet, items, today }: { month: string; data: Omit<MoneyData, "installed">; totals: MonthMoney; sheet: CostSheet; items: ItemStock[]; today: string }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState<Open>(null);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const vendorById = useMemo(() => new Map(data.vendors.map((v) => [v.id, v])), [data.vendors]);
  const owed = data.vendors.reduce((sum, v) => sum + Math.max(0, v.due), 0);
  const inMonth = (day: string) => day.slice(0, 7) === month;
  const defaultDay = inMonth(today) ? today : `${month}-01`;

  const remove = (kind: "purchase" | "payment" | "cost", id: string) => startTransition(async () => void toast.result(await removeMoneyEntry(kind, id)));
  const receive = (p: Purchase) =>
    startTransition(async () => {
      const { amount: _amount, ...rest } = p; // eslint-disable-line @typescript-eslint/no-unused-vars
      toast.result(await savePurchase({ ...rest, bill_no: p.bill_no ?? "", note: p.note ?? "", received_on: today < p.bought_on ? p.bought_on : today }));
    });

  const otherCosts = totals.costsTotal - totals.costs.labour - totals.costs.hamali;

  return (
    <div className="flex flex-col gap-4">
      <Card className="g-pad">
        <div className="grid grid-cols-2 gap-x-3 gap-y-4 min-[700px]:grid-cols-4">
          <StatTile label="Supplies bought" value={formatINR(totals.bought)} sub="with GST" />
          <StatTile label="Labour" value={formatINR(totals.costs.labour)} />
          <StatTile label="Hamali" value={formatINR(totals.costs.hamali)} />
          <StatTile label="Other costs" value={formatINR(otherCosts)} sub="transport, power, rent, other" />
          <StatTile label="Month's spend" value={formatINR(totals.spend)} sub="all of the above" />
          <StatTile label="Paid to vendors" value={formatINR(totals.paid)} sub="this month" />
          <StatTile label="Owed to vendors" value={formatINR(owed)} sub="all months" tone={owed > 0 ? "bad" : undefined} />
          <StatTile label="Units made" value={formatNumber(sheet.unitsMade)} sub="this month" />
        </div>
      </Card>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setOpen({ kind: "purchase" })} className={buttonClass(open?.kind === "purchase" ? "primary" : "outline")}>
          Add purchase
        </button>
        <button type="button" onClick={() => setOpen({ kind: "payment" })} className={buttonClass(open?.kind === "payment" ? "primary" : "outline")}>
          Add payment
        </button>
        <button type="button" onClick={() => setOpen({ kind: "cost" })} className={buttonClass(open?.kind === "cost" ? "primary" : "outline")}>
          Add labour, hamali or other cost
        </button>
        <button type="button" onClick={() => setOpen({ kind: "vendor" })} className={buttonClass(open?.kind === "vendor" ? "primary" : "outline")}>
          Add vendor
        </button>
      </div>

      {open?.kind === "purchase" ? <PurchaseForm key="purchase" data={data} items={items} today={today} defaultDay={defaultDay} onDone={() => setOpen(null)} onVendor={() => setOpen({ kind: "vendor" })} /> : null}
      {open?.kind === "payment" ? <PaymentForm key={`payment-${open.vendor ?? ""}`} data={data} vendor={open.vendor} today={today} defaultDay={defaultDay} onDone={() => setOpen(null)} onVendor={() => setOpen({ kind: "vendor" })} /> : null}
      {open?.kind === "cost" ? <CostForm key="cost" today={today} defaultDay={defaultDay} onDone={() => setOpen(null)} /> : null}
      {open?.kind === "vendor" ? <VendorForm key="vendor" onDone={() => setOpen(null)} /> : null}

      <Card className="ledger-card">
        <div className="g-pad pb-0">
          <SectionHead
            title="Cost to make one unit"
            sub={
              sheet.overheadPerUnit === null
                ? "Supplies by the recipe, at what you paid for them on average (with GST). Enter this month's production to spread labour, hamali and the other costs over the units made."
                : `Supplies by the recipe, at what you paid for them on average (with GST), plus this month's labour, hamali and other costs: ${formatRupees(sheet.overheadPerUnit)} for each of the ${formatNumber(sheet.unitsMade)} pieces made.`
            }
          />
        </div>
        {sheet.rows.length === 0 ? (
          <p className="t-caption g-pad pt-0">No products yet.</p>
        ) : (
          <table className="ledger">
            <thead>
              <tr>
                <th scope="col" className="min-w-[150px]">
                  Product
                </th>
                <th scope="col" className="num">
                  Per unit
                </th>
                <th scope="col" className="num">
                  Per carton
                </th>
                <th scope="col" className="num">
                  Supplies
                </th>
                <th scope="col" className="num">
                  Made
                </th>
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((r) => {
                const atLeast = r.total !== null && !r.complete ? <span className="block text-[13px] font-normal text-muted">at least</span> : null;
                return (
                  <tr key={r.product_id}>
                    <th scope="row" className="text-left font-semibold">
                      {r.name}
                      {r.noRecipe ? (
                        <span className="block text-[13px] font-normal text-muted">No recipe yet (Production page)</span>
                      ) : r.unpriced.length ? (
                        <span className="block text-[13px] font-normal text-muted">No price yet for {r.unpriced.join(", ")}, so not counted: enter a purchase of it</span>
                      ) : null}
                    </th>
                    <td className="num tabular-nums font-bold">
                      {atLeast}
                      {r.total === null ? "-" : formatRupees(r.total)}
                    </td>
                    <td className="num tabular-nums">
                      {atLeast}
                      {r.perCarton === null ? "-" : formatRupees(r.perCarton)}
                      <span className="block text-[13px] text-muted">of {formatNumber(r.units_per_carton)}</span>
                    </td>
                    <td className="num tabular-nums">
                      {atLeast}
                      {r.supplies === null ? "-" : formatRupees(r.supplies)}
                    </td>
                    <td className="num tabular-nums">{formatNumber(r.made)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="ledger-card">
        <div className="g-pad pb-0">
          <SectionHead title="Vendors" sub="What you bought from each, paid, and still owe, over all months." />
        </div>
        {data.vendors.length === 0 ? (
          <p className="t-caption g-pad pt-0">No vendors yet. Add the shops and companies you buy bottles, triggers, chemicals and cartons from.</p>
        ) : (
          <table className="ledger">
            <thead>
              <tr>
                <th scope="col" className="min-w-[140px]">
                  Vendor
                </th>
                <th scope="col" className="num">
                  Owed
                </th>
                <th scope="col" className="num">
                  Bought
                </th>
                <th scope="col" className="num">
                  Paid
                </th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.vendors.map((v) => (
                <tr key={v.id} className={v.active ? "" : "opacity-60"}>
                  <th scope="row" className="text-left font-semibold">
                    {v.name}
                    {v.phone ? <span className="block text-[13px] font-normal text-muted">{v.phone}</span> : null}
                  </th>
                  <td className={`num tabular-nums font-bold ${v.due > 0 ? "text-bad" : ""}`}>{v.due < 0 ? `${formatRupees(-v.due)} ahead` : formatRupees(v.due)}</td>
                  <td className="num tabular-nums">{formatRupees(v.bought)}</td>
                  <td className="num tabular-nums">{formatRupees(v.paid)}</td>
                  <td className="text-right">
                    <button type="button" onClick={() => setOpen({ kind: "payment", vendor: v.id })} className={buttonClass("row")}>
                      Pay
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {data.onOrder.length ? (
        <Card className="g-pad">
          <SectionHead title="Ordered, not received yet" sub="Not in stock until received. Mark each one when it arrives." />
          <ul className="divide-y divide-line-soft">
            {data.onOrder.map((p) => {
              const it = itemById.get(p.item_id);
              return (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {it ? formatQty(p.qty, it.unit) : formatNumber(p.qty)} {it?.name ?? "supply"}
                    </p>
                    <p className="t-caption">
                      {vendorById.get(p.vendor_id)?.name ?? "Vendor"} · bought {formatDate(p.bought_on)} · {formatRupees(p.amount)}
                    </p>
                  </div>
                  <button type="button" disabled={pending} onClick={() => receive(p)} className={buttonClass("row")}>
                    Received today
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <Card className="ledger-card">
        <div className="g-pad pb-0">
          <SectionHead title="Purchases" sub="Bought this month." />
        </div>
        {data.purchases.length === 0 ? (
          <p className="t-caption g-pad pt-0">No purchases this month.</p>
        ) : (
          <table className="ledger">
            <thead>
              <tr>
                <th scope="col" className="min-w-[150px]">
                  Supply
                </th>
                <th scope="col" className="num">
                  Amount
                </th>
                <th scope="col" className="num">
                  Quantity x rate
                </th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.purchases.map((p) => {
                const it = itemById.get(p.item_id);
                return (
                  <tr key={p.id}>
                    <th scope="row" className="text-left font-semibold">
                      {it?.name ?? "Supply"}
                      <span className="block text-[13px] font-normal text-muted">
                        {formatDate(p.bought_on)} · {vendorById.get(p.vendor_id)?.name ?? "Vendor"}
                        {p.bill_no ? ` · bill ${p.bill_no}` : ""}
                        {p.received_on ? "" : " · not received"}
                      </span>
                    </th>
                    <td className="num tabular-nums font-bold">{formatRupees(p.amount)}</td>
                    <td className="num tabular-nums">
                      {it ? formatQty(p.qty, it.unit) : formatNumber(p.qty)} x {formatRupees(p.rate)}
                      {p.gst_pct ? <span className="block text-[13px] text-muted">+ {p.gst_pct}% GST</span> : null}
                    </td>
                    <td className="text-right">
                      <ConfirmButton question={p.received_on ? "Remove it and its stock?" : "Remove it?"} disabled={pending} onConfirm={() => remove("purchase", p.id)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="ledger-card">
        <div className="g-pad pb-0">
          <SectionHead title="Payments" sub="Paid to vendors this month." />
        </div>
        {data.payments.length === 0 ? (
          <p className="t-caption g-pad pt-0">No payments this month.</p>
        ) : (
          <table className="ledger">
            <thead>
              <tr>
                <th scope="col" className="min-w-[140px]">
                  Vendor
                </th>
                <th scope="col" className="num">
                  Amount
                </th>
                <th scope="col">How</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p) => (
                <tr key={p.id}>
                  <th scope="row" className="text-left font-semibold">
                    {vendorById.get(p.vendor_id)?.name ?? "Vendor"}
                    <span className="block text-[13px] font-normal text-muted">
                      {formatDate(p.paid_on)}
                      {p.note ? ` · ${p.note}` : ""}
                    </span>
                  </th>
                  <td className="num tabular-nums font-bold">{formatRupees(p.amount)}</td>
                  <td>
                    {PAY_MODE_LABEL[p.mode]}
                    {p.reference ? <span className="block text-[13px] text-muted">{p.reference}</span> : null}
                  </td>
                  <td className="text-right">
                    <ConfirmButton question="Remove it?" disabled={pending} onConfirm={() => remove("payment", p.id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="ledger-card">
        <div className="g-pad pb-0">
          <SectionHead title="Labour, hamali and other costs" sub="This month." />
        </div>
        {data.costs.length === 0 ? (
          <p className="t-caption g-pad pt-0">No costs this month.</p>
        ) : (
          <table className="ledger">
            <thead>
              <tr>
                <th scope="col" className="min-w-[150px]">
                  For
                </th>
                <th scope="col" className="num">
                  Amount
                </th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.costs.map((c) => (
                <tr key={c.id}>
                  <th scope="row" className="text-left font-semibold">
                    {COST_KIND_LABEL[c.kind]}
                    <span className="block text-[13px] font-normal text-muted">
                      {formatDate(c.spent_on)}
                      {c.qty !== null && c.rate !== null ? ` · ${formatNumber(c.qty)} x ${formatRupees(c.rate)}` : ""}
                      {c.note ? ` · ${c.note}` : ""}
                    </span>
                  </th>
                  <td className="num tabular-nums font-bold">{formatRupees(c.amount)}</td>
                  <td className="text-right">
                    <ConfirmButton question="Remove it?" disabled={pending} onConfirm={() => remove("cost", c.id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

const money = (text: string) => (text.trim() ? readNumber(text) : null);

function PurchaseForm({ data, items, today, defaultDay, onDone, onVendor }: { data: Omit<MoneyData, "installed">; items: ItemStock[]; today: string; defaultDay: string; onDone: () => void; onVendor: () => void }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const vendors = data.vendors.filter((v) => v.active);
  const supplies = items.filter((i) => i.active);
  const [f, setF] = useState({ vendor_id: vendors[0]?.id ?? "", item_id: supplies[0]?.id ?? "", bought_on: defaultDay, qty: "", rate: "", gst: "18", bill_no: "", received: true, received_on: defaultDay, note: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const unit = supplies.find((i) => i.id === f.item_id)?.unit;
  const qty = money(f.qty);
  const rate = money(f.rate);
  const gst = Number(f.gst);
  const amount = qty !== null && rate !== null ? purchaseAmount(qty, rate, gst) : null;

  if (!vendors.length || !supplies.length) {
    return (
      <EmptyState
        title={!supplies.length ? "Add your supplies first" : "Add a vendor first"}
        body={!supplies.length ? "A purchase is of one of your supplies: add them on the Supplies page." : "A purchase is from a vendor: add the shop or company you buy from."}
        action={
          !supplies.length ? undefined : (
            <button type="button" onClick={onVendor} className={buttonClass("primary")}>
              Add vendor
            </button>
          )
        }
      />
    );
  }

  const submit = () => {
    const e: Record<string, string> = {};
    if (qty === null || qty <= 0) e.qty = "Enter the quantity";
    if (rate === null) e.rate = "Enter the rate (0 if free)";
    if (!f.bought_on || f.bought_on > today) e.bought_on = "Pick the day it was bought";
    if (f.received && (!f.received_on || f.received_on < f.bought_on)) e.received_on = "On or after the day it was bought";
    setErrors(e);
    if (Object.keys(e).length) return;
    startTransition(async () => {
      const result = await savePurchase({ vendor_id: f.vendor_id, item_id: f.item_id, bought_on: f.bought_on, received_on: f.received ? f.received_on : null, qty, rate, gst_pct: gst, bill_no: f.bill_no, note: f.note });
      if (toast.result(result)) onDone();
      else if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
    });
  };

  return (
    <Card className="g-pad">
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p className="t-card-title">Add a purchase</p>
        <div className="grid gap-4 min-[700px]:grid-cols-2">
          <Field label="Supply" htmlFor="pu-item" required>
            <select id="pu-item" className="input" value={f.item_id} onChange={(e) => setF({ ...f, item_id: e.target.value })}>
              {supplies.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Vendor" htmlFor="pu-vendor" required>
            <select id="pu-vendor" className="input" value={f.vendor_id} onChange={(e) => setF({ ...f, vendor_id: e.target.value })}>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Quantity${unit ? ` (${UNIT_SHORT[unit]})` : ""}`} htmlFor="pu-qty" required error={errors.qty}>
            <input id="pu-qty" className="input" inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
          </Field>
          <Field label={`Rate per ${unit ? UNIT_ONE[unit] : "unit"}, before GST`} htmlFor="pu-rate" required error={errors.rate}>
            <input id="pu-rate" className="input" inputMode="decimal" placeholder="₹" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />
          </Field>
          <Field label="GST" htmlFor="pu-gst" required>
            <select id="pu-gst" className="input" value={f.gst} onChange={(e) => setF({ ...f, gst: e.target.value })}>
              {GST_RATES.map((g) => (
                <option key={g} value={g}>
                  {g === 0 ? "No GST" : `${g}%`}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Day bought" htmlFor="pu-day" required error={errors.bought_on}>
            <input id="pu-day" className="input" type="date" max={today} value={f.bought_on} onChange={(e) => setF({ ...f, bought_on: e.target.value, received_on: f.received_on < e.target.value ? e.target.value : f.received_on })} />
          </Field>
          <Field label="Bill number" htmlFor="pu-bill">
            <input id="pu-bill" className="input" maxLength={60} value={f.bill_no} onChange={(e) => setF({ ...f, bill_no: e.target.value })} />
          </Field>
          <Field label="Note" htmlFor="pu-note">
            <input id="pu-note" className="input" maxLength={300} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-[15px]">
          <input type="checkbox" checked={f.received} onChange={(e) => setF({ ...f, received: e.target.checked })} />
          Received (adds it to stock)
        </label>
        {f.received ? (
          <Field label="Day received" htmlFor="pu-recv" required error={errors.received_on}>
            <input id="pu-recv" className="input max-w-xs" type="date" min={f.bought_on} max={today} value={f.received_on} onChange={(e) => setF({ ...f, received_on: e.target.value })} />
          </Field>
        ) : null}
        <p className="text-[17px]">
          Amount: <b className="tabular-nums">{amount === null ? "-" : formatRupees(amount)}</b>
          {amount !== null && gst ? <span className="t-caption"> (with {gst}% GST)</span> : null}
        </p>
        <FormButtons pending={pending} onCancel={onDone} save="Save purchase" />
      </form>
    </Card>
  );
}

function PaymentForm({ data, vendor, today, defaultDay, onDone, onVendor }: { data: Omit<MoneyData, "installed">; vendor?: string; today: string; defaultDay: string; onDone: () => void; onVendor: () => void }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const vendors = data.vendors.filter((v) => v.active || v.id === vendor);
  const [f, setF] = useState({ vendor_id: vendor ?? vendors[0]?.id ?? "", paid_on: defaultDay, amount: "", mode: "upi" as PayMode, reference: "", note: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const due = vendors.find((v) => v.id === f.vendor_id)?.due ?? 0;

  if (!vendors.length) {
    return (
      <EmptyState
        title="Add a vendor first"
        body="A payment is to a vendor: add the shop or company you pay."
        action={
          <button type="button" onClick={onVendor} className={buttonClass("primary")}>
            Add vendor
          </button>
        }
      />
    );
  }

  const submit = () => {
    const amount = money(f.amount);
    const e: Record<string, string> = {};
    if (amount === null || amount <= 0) e.amount = "Enter the amount paid";
    if (!f.paid_on || f.paid_on > today) e.paid_on = "Pick the day it was paid";
    setErrors(e);
    if (Object.keys(e).length) return;
    startTransition(async () => {
      const result = await savePayment({ vendor_id: f.vendor_id, paid_on: f.paid_on, amount, mode: f.mode, reference: f.reference, note: f.note });
      if (toast.result(result)) onDone();
      else if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
    });
  };

  return (
    <Card className="g-pad">
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p className="t-card-title">Add a payment</p>
        <div className="grid gap-4 min-[700px]:grid-cols-2">
          <Field label="Vendor" htmlFor="pa-vendor" required hint={due > 0 ? `Owed: ${formatRupees(due)}` : "Nothing owed"}>
            <select id="pa-vendor" className="input" value={f.vendor_id} onChange={(e) => setF({ ...f, vendor_id: e.target.value })}>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Amount paid" htmlFor="pa-amount" required error={errors.amount}>
            <div className="flex gap-2">
              <input id="pa-amount" className="input" inputMode="decimal" placeholder="₹" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
              {due > 0 ? (
                <button type="button" onClick={() => setF({ ...f, amount: String(due) })} className={buttonClass("row", "shrink-0")}>
                  All owed
                </button>
              ) : null}
            </div>
          </Field>
          <Field label="How" htmlFor="pa-mode" required>
            <select id="pa-mode" className="input" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as PayMode })}>
              {PAY_MODES.map((m) => (
                <option key={m} value={m}>
                  {PAY_MODE_LABEL[m]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Day paid" htmlFor="pa-day" required error={errors.paid_on}>
            <input id="pa-day" className="input" type="date" max={today} value={f.paid_on} onChange={(e) => setF({ ...f, paid_on: e.target.value })} />
          </Field>
          <Field label="Reference" htmlFor="pa-ref" hint="UPI or cheque number">
            <input id="pa-ref" className="input" maxLength={60} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
          </Field>
          <Field label="Note" htmlFor="pa-note">
            <input id="pa-note" className="input" maxLength={300} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </Field>
        </div>
        <FormButtons pending={pending} onCancel={onDone} save="Save payment" />
      </form>
    </Card>
  );
}

function CostForm({ today, defaultDay, onDone }: { today: string; defaultDay: string; onDone: () => void }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [f, setF] = useState({ kind: "labour" as CostKind, spent_on: defaultDay, count: "", rate: "", amount: "", note: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const count = money(f.count);
  const rate = money(f.rate);
  const byCount = !!f.count.trim() || !!f.rate.trim();
  const amount = byCount ? (count !== null && rate !== null ? Math.round(count * rate * 100) / 100 : null) : money(f.amount);
  const countWord = f.kind === "labour" ? "Workers" : f.kind === "hamali" ? "Cartons or bags" : f.kind === "transport" ? "Trips" : "Count";

  const submit = () => {
    const e: Record<string, string> = {};
    if (byCount && (count === null || count <= 0)) e.count = "Enter the count, or clear both";
    if (byCount && rate === null) e.rate = "Enter the rate, or clear both";
    if (!byCount && (amount === null || amount <= 0)) e.amount = "Enter the amount";
    if (!f.spent_on || f.spent_on > today) e.spent_on = "Pick the day";
    setErrors(e);
    if (Object.keys(e).length) return;
    if (!(amount && amount > 0)) return setErrors({ amount: "The amount must be above 0" });
    startTransition(async () => {
      const result = await saveCost({ kind: f.kind, spent_on: f.spent_on, qty: byCount ? count : null, rate: byCount ? rate : null, amount: byCount ? null : amount, note: f.note });
      if (toast.result(result)) onDone();
      else if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
    });
  };

  return (
    <Card className="g-pad">
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p className="t-card-title">Add labour, hamali or another cost</p>
        <div className="grid gap-4 min-[700px]:grid-cols-2">
          <Field label="For" htmlFor="co-kind" required>
            <select id="co-kind" className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as CostKind })}>
              {COST_KINDS.map((k) => (
                <option key={k} value={k}>
                  {COST_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Day" htmlFor="co-day" required error={errors.spent_on}>
            <input id="co-day" className="input" type="date" max={today} value={f.spent_on} onChange={(e) => setF({ ...f, spent_on: e.target.value })} />
          </Field>
          <Field label={countWord} htmlFor="co-count" error={errors.count} hint="With a rate, the amount is worked out.">
            <input id="co-count" className="input" inputMode="decimal" value={f.count} onChange={(e) => setF({ ...f, count: e.target.value })} />
          </Field>
          <Field label="Rate each" htmlFor="co-rate" error={errors.rate}>
            <input id="co-rate" className="input" inputMode="decimal" placeholder="₹" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />
          </Field>
          <Field label="Amount" htmlFor="co-amount" error={errors.amount} hint={byCount ? "From the count and rate." : "Or give a count and a rate instead."}>
            <input id="co-amount" className="input" inputMode="decimal" placeholder="₹" disabled={byCount} value={byCount ? (amount === null ? "" : String(amount)) : f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </Field>
          <Field label="Note" htmlFor="co-note">
            <input id="co-note" className="input" maxLength={300} placeholder="e.g. unloading chemical drums" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </Field>
        </div>
        <p className="text-[17px]">
          Amount: <b className="tabular-nums">{amount === null ? "-" : formatRupees(amount)}</b>
        </p>
        <FormButtons pending={pending} onCancel={onDone} save="Save cost" />
      </form>
    </Card>
  );
}

function VendorForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [f, setF] = useState({ name: "", phone: "", note: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = () => {
    if (!f.name.trim()) return setErrors({ name: "Enter a name" });
    setErrors({});
    startTransition(async () => {
      const result = await saveVendor(f);
      if (toast.result(result)) onDone();
      else if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
    });
  };

  return (
    <Card className="g-pad">
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p className="t-card-title">Add a vendor</p>
        <div className="grid gap-4 min-[700px]:grid-cols-2">
          <Field label="Name" htmlFor="ve-name" required error={errors.name}>
            <input id="ve-name" className="input" maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Phone" htmlFor="ve-phone">
            <input id="ve-phone" className="input" inputMode="tel" maxLength={30} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </Field>
        </div>
        <Field label="Note" htmlFor="ve-note" hint="What you buy from them, payment terms">
          <input id="ve-note" className="input" maxLength={300} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
        <FormButtons pending={pending} onCancel={onDone} save="Save vendor" />
      </form>
    </Card>
  );
}

