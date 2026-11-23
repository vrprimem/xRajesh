"use client";

import { useState, type ReactNode } from "react";
import { buttonClass } from "@/components/ui";

// Small pieces the supplies, production and money screens share.

/** A remove button that asks once more in place (no pop-up): "Remove" -> "Remove it? Yes / No". */
export function ConfirmButton({ label = "Remove", question, onConfirm, disabled }: { label?: string; question: string; onConfirm: () => void; disabled?: boolean }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" disabled={disabled} onClick={() => setAsking(true)} className={buttonClass("row")}>
        {label}
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      <span className="text-[14px] font-semibold">{question}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
        className={buttonClass("danger", "g-btn-row")}
      >
        Yes
      </button>
      <button type="button" onClick={() => setAsking(false)} className={buttonClass("row")}>
        No
      </button>
    </span>
  );
}

/** A headline figure: a label, the value, and a line under it. */
export function StatTile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "bad" | "ok" }) {
  return (
    <div className="min-w-0">
      <p className="t-caption">{label}</p>
      <p className={`t-score mt-1 break-words text-[26px] min-[700px]:text-[32px] ${tone === "bad" ? "text-bad" : tone === "ok" ? "text-ok" : ""}`}>{value}</p>
      {sub ? <p className="t-caption mt-0.5">{sub}</p> : null}
    </div>
  );
}

/** A form's buttons: save (with its busy text) and cancel. */
export function FormButtons({ pending, onCancel, save = "Save" }: { pending: boolean; onCancel?: () => void; save?: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <button type="submit" disabled={pending} className={buttonClass("primary")}>
        {pending ? "Saving..." : save}
      </button>
      {onCancel ? (
        <button type="button" disabled={pending} onClick={onCancel} className={buttonClass("outline")}>
          Cancel
        </button>
      ) : null}
    </div>
  );
}
