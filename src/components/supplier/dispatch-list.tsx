import Link from "next/link";
import { DispatchStatusChip } from "@/components/supplier/dispatch-panel";
import { CheckIcon, CloseIcon, TruckIcon } from "@/components/icons";
import { WithPhoto } from "@/components/supplier/product-photo";
import { Card, EmptyState, buttonClass } from "@/components/ui";
import { arrivalOf, loadedKg, nextStep, plannedKg, productCartons, stageOf, type Who } from "@/lib/dispatch-view";
import { dueLabel, formatDate, formatNumber, noun, todayIST } from "@/lib/format";
import { istDay } from "@/lib/report";
import { dispatchCounts, labelsOwed } from "@/lib/supplier";
import type { DispatchSummary } from "@/server/supplier-data";

/** Cartons sent this month, and the units: closed and received dispatches only. */
export function MonthCartons({ dispatches }: { dispatches: DispatchSummary[] }) {
  const month = todayIST().slice(0, 7);
  const sent = dispatches.filter((d) => (d.status === "closed" || d.status === "received") && (d.closed_at ?? "").slice(0, 7) === month);
  const total = { cartons: 0, units: 0 };
  for (const d of sent) {
    const c = dispatchCounts(d.lines, d.cartons);
    total.cartons += c.loaded;
    total.units += c.units;
  }
  return (
    <Card className="g-pad">
      <p className="t-card-title">Cartons sent this month</p>
      <p className="mt-2 text-[15px]">
        <span className="t-score mr-0.5 text-[42px]">{formatNumber(total.cartons)}</span> {noun(total.cartons, "carton")} in {sent.length} {sent.length === 1 ? "dispatch" : "dispatches"}
      </p>
      <p className="t-caption mt-1">
        {formatNumber(total.units)} {noun(total.units, "unit")}
      </p>
    </Card>
  );
}

function Bar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-3 overflow-hidden rounded-[3px] bg-panel2" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <div className={`h-full ${max > 0 && value >= max ? "bg-ok" : "vr-bar"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

type CardProps = { d: DispatchSummary; base: string; who: Who; photos: Record<string, string>; warehouse: string; today: string };

/** Each stage's colour class and icon, used on its cards, pills and heading. */
const STAGE_LOOK = {
  to_load: { cls: "stage-load", Icon: TruckIcon },
  on_the_way: { cls: "stage-way", Icon: TruckIcon },
  arrived: { cls: "stage-done", Icon: CheckIcon },
  cancelled: { cls: "stage-off", Icon: CloseIcon },
} as const;

/** One dispatch: when it is due or how long it has been on the road, its progress, its products, and what to do next. */
function DispatchCard({ d, base, who, photos, warehouse, today }: CardProps) {
  const stage = stageOf(d.status);
  const c = dispatchCounts(d.lines, d.cartons);
  const owed = stage === "to_load" ? labelsOwed(d.lines, d.cartons) : 0;
  const arrival = arrivalOf(d, today);
  const step = nextStep(d, who);
  const href = `${base}/${d.id}`;
  const missing = arrival ? arrival.loaded - arrival.arrived - arrival.rejected : 0;
  // Once it has left, what its loaded cartons weigh (by their labels); before that, what the plan weighs.
  const sent = stage === "on_the_way" || stage === "arrived";
  const weight = sent ? loadedKg(d.cartons) : plannedKg(d.lines);

  const look = STAGE_LOOK[stage];
  const band =
    stage === "to_load"
      ? `To load · ${dueLabel(d.due_on, today)}`
      : stage === "on_the_way"
        ? `On the way · ${arrival?.days ?? 0} ${noun(arrival?.days ?? 0, "day")} on the road`
        : stage === "arrived"
          ? `Arrived · took ${arrival?.days ?? 0} ${noun(arrival?.days ?? 0, "day")}`
          : "Cancelled";

  return (
    <li className="sp-card flex min-w-0 flex-col overflow-hidden">
      <div className={`stage-band ${look.cls}`}>
        <look.Icon className="h-5 w-5 shrink-0" />
        <span className="min-w-0">{band}</span>
      </div>
      <div className="g-pad flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={href} className="focus-ring rounded-[6px] text-[20px] font-extrabold underline-offset-4 hover:underline">
          Dispatch {d.number}
        </Link>
        <DispatchStatusChip status={d.status} />
      </div>

      {stage === "to_load" ? (
        <div className="flex flex-col gap-1.5">
          <Bar value={c.loaded} max={c.planned} label={`Cartons scanned on dispatch ${d.number}`} />
          <p className="text-[15px]">
            <b className="tabular-nums">{formatNumber(c.loaded)}</b> of {formatNumber(c.planned)} {noun(c.planned, "carton")} scanned
          </p>
          {owed ? (
            <p className={d.labels_error ? "text-[15px] font-semibold text-bad" : "t-caption"}>
              {d.labels_error ? "Labels stopped: open the dispatch and press Try again." : `${formatNumber(owed)} ${owed === 1 ? "label is" : "labels are"} still being made by the inventory software.`}
            </p>
          ) : null}
        </div>
      ) : arrival ? (
        <div className="flex flex-col gap-1.5">
          <p className="t-caption">Sent {d.closed_at ? formatDate(istDay(d.closed_at), today) : "-"}</p>
          <Bar value={arrival.arrived} max={arrival.loaded} label={`Cartons of dispatch ${d.number} scanned in at ${warehouse}`} />
          <p className="text-[15px]">
            <b className="tabular-nums">{formatNumber(arrival.arrived)}</b> of {formatNumber(arrival.loaded)} {noun(arrival.loaded, "carton")} scanned in at {warehouse}
            {arrival.rejected ? <span className="font-semibold text-bad"> · {formatNumber(arrival.rejected)} rejected</span> : null}
          </p>
          {arrival.late ? (
            <p className="tone-row tone-bad text-[15px] font-semibold">
              On the road {arrival.days} days with {formatNumber(missing)} {noun(missing, "carton")} not scanned in yet. Check with the transporter.
            </p>
          ) : null}
        </div>
      ) : null}

      {d.lines.length ? (
        <ul className="flex flex-col gap-2 border-t border-line-soft pt-3">
          {productCartons(d.lines).map((p) => (
            <li key={p.product_id} className="flex items-center justify-between gap-3 text-[15px]">
              <WithPhoto src={photos[p.product_id]} name={p.product} size={36}>
                <span className="font-semibold">{p.product}</span>
              </WithPhoto>
              <span className="shrink-0 text-right tabular-nums">
                {formatNumber(p.cartons)} {noun(p.cartons, "carton")}
                {p.kg ? <span className="block text-[14px] text-muted">{formatNumber(p.kg)} kg</span> : null}
              </span>
            </li>
          ))}
          <li className="flex items-center justify-between gap-3 border-t border-line-soft pt-2 text-[15px]">
            <span className="font-semibold">{sent ? "Weight sent" : "Weight"}</span>
            <span className="shrink-0 text-right font-semibold tabular-nums">
              {weight.kg ? `${formatNumber(weight.kg)} kg` : "No carton weights"}
              {weight.kg && weight.unweighed ? (
                <span className="block text-[14px] font-normal text-muted">
                  and {formatNumber(weight.unweighed)} {noun(weight.unweighed, "carton")} with no weight
                </span>
              ) : null}
            </span>
          </li>
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {step ? (
          <Link href={step.to === "scan" ? `${href}/scan` : href} className={buttonClass("primary")}>
            {step.label}
          </Link>
        ) : null}
        <Link href={href} className={buttonClass("outline")}>
          Open dispatch
        </Link>
      </div>
      </div>
    </li>
  );
}

const SHOWN_ARRIVED = 6;

/**
 * The dispatches by stage: to load (soonest due first), on the way (longest on the road first), arrived (newest first,
 * older ones folded away) and cancelled (folded away). Each is a card with its next step. `who` decides that step;
 * `warehouse` is where the cartons are scanned in.
 */
export function DispatchList({
  dispatches,
  base,
  emptyBody,
  who,
  photos = {},
  warehouse = "VRPRIME",
}: {
  dispatches: DispatchSummary[];
  base: string;
  emptyBody: string;
  who: Who;
  photos?: Record<string, string>;
  warehouse?: string;
}) {
  if (!dispatches.length) return <EmptyState title="No dispatches yet" body={emptyBody} />;
  const today = todayIST();
  const of = (s: ReturnType<typeof stageOf>) => dispatches.filter((d) => stageOf(d.status) === s);
  const groups = [
    { id: "to-load", cls: "stage-load", title: "To load", empty: "Nothing to load right now.", list: of("to_load").sort((a, b) => a.due_on.localeCompare(b.due_on) || a.number - b.number) },
    { id: "on-the-way", cls: "stage-way", title: "On the way", empty: "Nothing is on the road.", list: of("on_the_way").sort((a, b) => (a.closed_at ?? "").localeCompare(b.closed_at ?? "")) },
    { id: "arrived", cls: "stage-done", title: "Arrived", empty: "Nothing has arrived yet.", list: of("arrived").sort((a, b) => (b.received_at ?? b.closed_at ?? "").localeCompare(a.received_at ?? a.closed_at ?? "")) },
  ];
  const cancelled = of("cancelled");
  const card = (d: DispatchSummary) => <DispatchCard key={d.id} d={d} base={base} who={who} photos={photos} warehouse={warehouse} today={today} />;
  const grid = "grid gap-3 min-[700px]:grid-cols-2";

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Dispatches by stage" className="flex flex-wrap gap-2">
        {groups.map((g) => (
          <a key={g.id} href={`#${g.id}`} className={`stage-pill focus-ring ${g.cls}`}>
            <span className="stage-dot" aria-hidden />
            {g.title}
            <span className="tabular-nums">{g.list.length}</span>
          </a>
        ))}
      </nav>
      {groups.map((g) => (
        <section key={g.id} id={g.id} aria-labelledby={`${g.id}-title`} className="scroll-mt-40">
          <h2 id={`${g.id}-title`} className={`t-card-title mb-3 flex items-center gap-2 ${g.cls}`}>
            <span className="stage-dot" aria-hidden />
            {g.title} <span className="font-normal text-muted tabular-nums">{g.list.length}</span>
          </h2>
          {g.list.length === 0 ? (
            <p className="t-caption">{g.empty}</p>
          ) : (
            <>
              <ul className={grid}>{(g.id === "arrived" ? g.list.slice(0, SHOWN_ARRIVED) : g.list).map(card)}</ul>
              {g.id === "arrived" && g.list.length > SHOWN_ARRIVED ? (
                <details className="mt-3">
                  <summary className="t-caption cursor-pointer underline underline-offset-4">Show {g.list.length - SHOWN_ARRIVED} older</summary>
                  <ul className={`${grid} mt-3`}>{g.list.slice(SHOWN_ARRIVED).map(card)}</ul>
                </details>
              ) : null}
            </>
          )}
        </section>
      ))}
      {cancelled.length ? (
        <details>
          <summary className="t-caption cursor-pointer underline underline-offset-4">Cancelled ({cancelled.length})</summary>
          <ul className={`${grid} mt-3`}>{cancelled.map(card)}</ul>
        </details>
      ) : null}
    </div>
  );
}
