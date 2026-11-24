"use client";

import { useState } from "react";
import { formatNumber } from "@/lib/format";

const longDay = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

/** The axis top: the next clean number at or above the highest day (1, 2, 2.5 or 5 times a power of ten). */
export function niceTop(max: number): number {
  if (!(max > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * p >= max) ?? 10;
  return step * p;
}

/**
 * Units made a day, one column a day, oldest on the left. Only the best day and today carry their figure; hover or
 * focus any column for its own, and every figure is in the table under the chart.
 */
export function OutputChart({ days, today, title }: { days: { day: string; units: number }[]; today: string; title: string }) {
  const [on, setOn] = useState<number | null>(null);
  const max = Math.max(0, ...days.map((d) => d.units));
  const top = niceTop(max);
  const best = max > 0 ? days.findIndex((d) => d.units === max) : -1;
  const shown = on === null ? null : days[on];

  return (
    <figure className="m-0">
      <div className="relative pt-7">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-7 border-t border-line-soft" />
        <p aria-hidden className="t-caption pointer-events-none absolute right-0 top-1 tabular-nums">
          {formatNumber(top)}
        </p>
        <ul aria-label={title} className="relative flex h-40 items-end gap-[2px] border-b border-line">
          {days.map((d, i) => {
            const label = `${longDay.format(asDate(d.day))}: ${formatNumber(d.units)} ${d.units === 1 ? "unit" : "units"}`;
            const capped = i === best || d.day === today;
            return (
              <li
                key={d.day}
                tabIndex={0}
                aria-label={label}
                onPointerEnter={() => setOn(i)}
                onPointerLeave={() => setOn((v) => (v === i ? null : v))}
                onFocus={() => setOn(i)}
                onBlur={() => setOn((v) => (v === i ? null : v))}
                className="focus-ring relative flex h-full min-w-0 flex-1 cursor-default flex-col items-center justify-end rounded-[4px]"
              >
                {capped && d.units > 0 ? (
                  <span aria-hidden className="mb-1 whitespace-nowrap text-[12px] font-bold leading-none tabular-nums text-ink">
                    {formatNumber(d.units)}
                  </span>
                ) : null}
                <span
                  aria-hidden
                  className="block w-full max-w-6 rounded-t-[4px] transition-opacity"
                  style={{ height: `${(d.units / top) * 100}%`, background: "var(--bar)", opacity: on === i ? 0.7 : 1 }}
                />
              </li>
            );
          })}
        </ul>
        {shown ? (
          <div
            role="status"
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-[8px] border-2 border-frame bg-surface px-2.5 py-1.5 text-[14px] shadow-sm"
            style={{ left: `clamp(70px, ${((on! + 0.5) / days.length) * 100}%, calc(100% - 70px))` }}
          >
            <b className="tabular-nums">{formatNumber(shown.units)}</b> <span className="text-muted">{longDay.format(asDate(shown.day))}</span>
          </div>
        ) : null}
      </div>
      <div aria-hidden className="mt-1 flex gap-[2px]">
        {days.map((d) => (
          <span key={d.day} className={`flex-1 text-center text-[12px] leading-tight tabular-nums ${d.day === today ? "font-bold text-ink" : "text-muted"}`}>
            {Number(d.day.slice(8))}
          </span>
        ))}
      </div>
      <details className="mt-3">
        <summary className="t-caption cursor-pointer underline underline-offset-4">Show as a table</summary>
        <table className="ledger mt-2">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col" className="num">
                Units made
              </th>
            </tr>
          </thead>
          <tbody>
            {[...days].reverse().map((d) => (
              <tr key={d.day}>
                <th scope="row" className="text-left font-normal">
                  {longDay.format(asDate(d.day))}
                </th>
                <td className="num tabular-nums">{formatNumber(d.units)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
