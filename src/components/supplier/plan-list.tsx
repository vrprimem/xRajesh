"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { WithPhoto } from "@/components/supplier/product-photo";
import { useToast } from "@/components/toast";
import { Chip, buttonClass } from "@/components/ui";
import { formatDate, formatNumber, noun, todayIST } from "@/lib/format";
import { CARTON_TYPE_LABEL, PLAN_STATUS_LABEL, type PlanStatus } from "@/lib/supplier";
import { cancelPlan, planToDispatch, respondPlan } from "@/server/actions/supplier";
import type { PlanRow } from "@/server/supplier-data";

const TONE: Record<PlanStatus, "neutral" | "info" | "warn" | "ok" | "bad"> = { open: "warn", accepted: "info", in_production: "info", ready: "ok", dispatched: "ok", cancelled: "bad" };
const ANSWERS: { status: "accepted" | "in_production" | "ready"; label: string }[] = [
  { status: "accepted", label: "Accept" },
  { status: "in_production", label: "In production" },
  { status: "ready", label: "Ready to send" },
];

/**
 * Send plans with their products and cartons.
 *   who = "owner"    the supplier's owner: answer, and make the dispatch when ready
 *   who = "scanner"  the supplier's warehouse person: read only
 *   who = "vrprime"  VRPRIME: read the answers, cancel
 * \`dispatchBase\` is where this person's dispatches live.
 */
export function PlanList({ plans, who, dispatchBase, photos = {} }: { plans: PlanRow[]; who: "owner" | "scanner" | "vrprime"; dispatchBase: string; photos?: Record<string, string> }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const today = todayIST();

  return (
    <ul className="flex flex-col gap-3">
      {plans.map((p) => {
        const live = p.status !== "dispatched" && p.status !== "cancelled";
        const cartons = p.lines.reduce((n, l) => n + l.cartons, 0);
        const units = p.lines.reduce((n, l) => n + l.cartons * l.units_per_carton, 0);
        const late = live && p.due_on < today;
        return (
          <li key={p.id} className="rounded-[12px] border border-line-soft p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[16px] font-semibold">
                Send plan {p.number}
                <span className={`ml-2 font-normal ${late ? "font-semibold text-bad" : "text-muted"}`}>
                  {late ? "overdue, was due " : "send by "}
                  {formatDate(p.due_on)}
                </span>
              </p>
              <Chip tone={TONE[p.status]}>{PLAN_STATUS_LABEL[p.status]}</Chip>
            </div>
            {p.note ? <p className="mt-1 text-[15px]">{p.note}</p> : null}
            <table className="mt-2 w-full text-[15px]">
              <tbody>
                {p.lines.map((l) => (
                  <tr key={`${l.product_id}-${l.carton_type}`} className="border-t border-line-soft">
                    <th scope="row" className="py-1.5 pr-2 text-left font-semibold">
                      <WithPhoto src={photos[l.product_id]} name={l.product}>
                        {l.product}
                        <span className="ml-1 font-normal text-muted">{CARTON_TYPE_LABEL[l.carton_type]}</span>
                      </WithPhoto>
                    </th>
                    <td className="py-1.5 text-right tabular-nums">
                      <b>{formatNumber(l.cartons)}</b> {noun(l.cartons, "carton")}
                    </td>
                    <td className="py-1.5 pl-3 text-right tabular-nums text-muted">{formatNumber(l.cartons * l.units_per_carton)} {noun(l.cartons * l.units_per_carton, "unit")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="t-caption mt-1">
              {formatNumber(cartons)} {noun(cartons, "carton")} · {formatNumber(units)} {noun(units, "unit")} in all
            </p>

            <div className="mt-2 flex flex-wrap gap-2">
              {p.status === "dispatched" && p.dispatch_id ? (
                <Link href={`${dispatchBase}/${p.dispatch_id}`} className={buttonClass("row")}>
                  Open the dispatch
                </Link>
              ) : null}
              {who === "owner" && live ? (
                <>
                  {ANSWERS.map((a) => (
                    <button
                      key={a.status}
                      type="button"
                      disabled={pending || p.status === a.status}
                      onClick={() =>
                        startTransition(async () => {
                          if (toast.result(await respondPlan(p.id, a.status))) router.refresh();
                        })
                      }
                      className={buttonClass(p.status === a.status ? "primary" : "row")}
                    >
                      {a.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (!window.confirm(`Make a dispatch from send plan ${p.number}? ${cartons === 1 ? "Its label is" : `Its ${cartons} labels are`} printed now, ready for loading.`)) return;
                      startTransition(async () => {
                        const result = await planToDispatch(p.id);
                        if (toast.result(result) && result.ok && result.data) router.push(`${dispatchBase}/${result.data}`);
                      });
                    }}
                    className={buttonClass(p.status === "ready" ? "primary" : "outline")}
                  >
                    Make the dispatch
                  </button>
                </>
              ) : null}
              {who === "vrprime" && live ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (!window.confirm(`Cancel send plan ${p.number}? Rajesh will be told not to make it.`)) return;
                    startTransition(async () => {
                      if (toast.result(await cancelPlan(p.id))) router.refresh();
                    });
                  }}
                  className={buttonClass("danger")}
                >
                  Cancel plan
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
