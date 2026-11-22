"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useToast } from "@/components/toast";
import { Chip, buttonClass } from "@/components/ui";
import { formatDateTime, formatNumber } from "@/lib/format";
import { PRODUCE_STATUS_LABEL, type ProduceStatus } from "@/lib/supplier";
import { respondProduce } from "@/server/actions/supplier";
import type { ProduceRow } from "@/server/supplier-data";

const ANSWERS: { status: Exclude<ProduceStatus, "open" | "cleared">; label: string }[] = [
  { status: "accepted", label: "Accept" },
  { status: "in_production", label: "In production" },
  { status: "dispatched", label: "Dispatched" },
];

/**
 * "Produce now": the products that are under their minimum at VRPRIME, with the quantity to make. The supplier owner
 * answers each one (canAnswer); VRPRIME and the warehouse person only read the answers.
 */
export function ProduceList({ rows, canAnswer }: { rows: ProduceRow[]; canAnswer: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const answer = (id: string, status: string) =>
    startTransition(async () => {
      if (toast.result(await respondProduce(id, status))) router.refresh();
    });

  return (
    <ul className="flex flex-col divide-y divide-line-soft">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
            <p className="min-w-0 text-[14px] font-semibold">{r.product}</p>
            <Chip tone={r.status === "open" ? "bad" : r.status === "dispatched" ? "ok" : "info"}>{PRODUCE_STATUS_LABEL[r.status]}</Chip>
          </div>
          <p className="text-[13px]">
            Make <span className="font-semibold tabular-nums">{formatNumber(r.suggested_units)}</span> units
            <span className="text-muted">
              {" "}
              · {formatNumber(r.stock_units)} in stock + {formatNumber(r.in_transit_units)} on the way, minimum {formatNumber(r.min_units)}
            </span>
          </p>
          <p className="t-caption">Raised {formatDateTime(r.raised_at)}</p>
          {canAnswer ? (
            <div className="flex flex-wrap gap-2">
              {ANSWERS.map((a) => (
                <button key={a.status} type="button" disabled={pending || r.status === a.status} onClick={() => answer(r.id, a.status)} className={buttonClass(r.status === a.status ? "primary" : "row")}>
                  {a.label}
                </button>
              ))}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
