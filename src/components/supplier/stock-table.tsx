"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useToast } from "@/components/toast";
import { Card, Chip, buttonClass } from "@/components/ui";
import { formatDateTime, formatNumber } from "@/lib/format";
import { setThreshold } from "@/server/actions/supplier";
import type { StockRow } from "@/server/supplier-data";

function MinCell({ row }: { row: StockRow }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(row.min_units === null ? "" : String(row.min_units));
  const changed = value.trim() !== (row.min_units === null ? "" : String(row.min_units));
  const save = () =>
    startTransition(async () => {
      const text = value.trim();
      if (toast.result(await setThreshold(row.product_id, text === "" ? null : Number(text)))) router.refresh();
    });
  return (
    <form
      className="flex items-center justify-end gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <input className="input !min-h-9 w-24 !py-1 text-right tabular-nums" inputMode="numeric" aria-label={`Minimum stock for ${row.name}`} placeholder="none" value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))} />
      <button type="submit" disabled={pending || !changed} className={buttonClass("row")}>
        Save
      </button>
    </form>
  );
}

/**
 * Stock at VRPRIME's warehouse for each of the supplier's products: on hand (from the inventory software), on the way
 * (closed dispatches not yet received), and the minimum. VRPRIME owner and admin set the minimum (canSetMin).
 */
export function StockTable({ rows, warehouse = "", canSetMin }: { rows: StockRow[]; warehouse?: string; canSetMin: boolean }) {
  const shown = rows.filter((r) => r.active);
  const synced = rows.find((r) => r.synced_at)?.synced_at ?? null;
  return (
    <Card className="ledger-card">
      <div className="g-pad pb-2">
        <p className="t-card-title">Stock at VRPRIME {warehouse}</p>
        <p className="t-caption mt-0.5">
          {synced ? `Stock read from the inventory software ${formatDateTime(synced)}; it is read every 30 minutes.` : "Stock has not been read from the inventory software yet."} On the way = closed dispatches not yet received.
        </p>
      </div>
      <table className="ledger">
        <thead>
          <tr>
            <th scope="col" className="min-w-[170px]">Product</th>
            <th scope="col" className="num">In stock</th>
            <th scope="col" className="num">On the way</th>
            <th scope="col" className="num">Minimum</th>
            <th scope="col">Level</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const total = (r.stock_units ?? 0) + r.in_transit_units;
            const low = r.stock_units !== null && r.min_units !== null && total < r.min_units;
            return (
              <tr key={r.product_id}>
                <th scope="row" className="text-left font-semibold">
                  {r.name}
                  {r.master_code ? <span className="ml-2 font-normal text-muted">{r.master_code}</span> : null}
                </th>
                <td className="num tabular-nums">{r.stock_units === null ? "-" : formatNumber(r.stock_units)}</td>
                <td className="num tabular-nums">{formatNumber(r.in_transit_units)}</td>
                <td className="num tabular-nums">{canSetMin ? <MinCell row={r} /> : r.min_units === null ? "-" : formatNumber(r.min_units)}</td>
                <td>{r.stock_units === null ? <Chip tone="warn">Not linked to a master SKU</Chip> : r.min_units === null ? <Chip>No minimum set</Chip> : low ? <Chip tone="bad">Below minimum</Chip> : <Chip tone="ok">OK</Chip>}</td>
              </tr>
            );
          })}
          {shown.length === 0 ? (
            <tr>
              <td colSpan={5} className="text-muted">
                No active products yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </Card>
  );
}
