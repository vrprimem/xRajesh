import { Card, Chip, SectionHead } from "@/components/ui";
import { formatDate, formatNumber } from "@/lib/format";
import type { PlanEstimate } from "@/lib/production";
import { formatQty } from "@/lib/supplies";

const daysText = (d: number) => (d < 1 ? "under a day" : `about ${formatNumber(Math.ceil(d - 1e-9))} ${Math.ceil(d - 1e-9) === 1 ? "day" : "days"}`);

/** When each open send plan can be ready, and what has to be bought for it. Both sides see this; nothing has a price. */
export function DeliveryPlans({ estimates, today, empty }: { estimates: PlanEstimate[]; today: string; empty: string }) {
  return (
    <Card className="g-pad">
      <SectionHead
        title="When the send plans can be ready"
        sub="Made in due order, one product at a time, at the pace each was made over the last 30 days (or its daily capacity), using the ready stock first."
      />
      {estimates.length === 0 ? (
        <p className="t-caption">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {estimates.map((e) => (
            <li key={e.id} className="border-t-2 border-frame pt-3 first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[17px] font-bold">Send plan {e.number}</p>
                <span className="t-caption">due {formatDate(e.due_on)}</span>
                {e.readyBy === today ? (
                  <Chip tone="ok">Ready now</Chip>
                ) : e.readyBy ? (
                  <Chip tone={e.late ? "bad" : "ok"}>
                    {e.late ? "Late: ready by " : "Ready by "}
                    {formatDate(e.readyBy)}
                  </Chip>
                ) : (
                  <Chip tone="warn">Time not known</Chip>
                )}
              </div>
              <ul className="mt-2 flex flex-col gap-1 text-[15px]">
                {e.lines.map((l) => (
                  <li key={l.product_id}>
                    <b>{l.product}</b>: {formatNumber(l.units)} pcs
                    <span className="text-muted">
                      {l.fromStock ? ` · ${formatNumber(l.fromStock)} ready` : ""}
                      {l.toMake ? ` · ${formatNumber(l.toMake)} to make${l.days !== null ? `, ${daysText(l.days)}` : ""}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
              {e.unknown.length ? (
                <p className="t-caption mt-2">
                  No pace for {e.unknown.join(", ")}: enter its production, or set its daily capacity on the Products page.
                </p>
              ) : e.after ? (
                <p className="t-caption mt-2">Waits behind send plan {e.after}, whose time is not known.</p>
              ) : null}
              {e.short.length ? (
                <div className="tone-row tone-bad mt-2">
                  <p className="tone-row-title w-full">Supplies run short</p>
                  <ul className="w-full text-[15px]">
                    {e.short.map((s) => (
                      <li key={s.item_id}>
                        {s.name}: needs {formatQty(Math.ceil(s.need * 1000) / 1000, s.unit)}, {formatQty(Math.max(0, Math.floor(s.have * 1000) / 1000), s.unit)} left for it
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
