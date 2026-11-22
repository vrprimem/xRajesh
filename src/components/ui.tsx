import type { ReactNode } from "react";
import { InboxIcon } from "@/components/icons";

// The shared pieces every screen is made of. Every look lives in globals.css; these only pick classes.

export type Tone = "neutral" | "accent" | "info" | "ok" | "warn" | "bad";

/** A pill in a tone. */
export function Chip({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`g-chip ${tone === "neutral" ? "" : `tone-${tone}`}`}>{children}</span>;
}

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "row";
/**
 * Class names for buttons and button-like links: 44px tall, radius 12px, 13px 600. "row" is the row action button:
 * secondary, 40px tall, 12px text.
 */
export function buttonClass(variant: ButtonVariant = "secondary", extra = ""): string {
  if (variant === "row") return `g-btn g-btn-secondary g-btn-row focus-ring ${extra}`;
  return `g-btn g-btn-${variant} focus-ring ${extra}`;
}

export function Field({
  label,
  htmlFor,
  required,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[15px] font-semibold">
        {label}
        {required ? <span className="text-bad"> *</span> : <span className="font-normal text-muted"> (optional)</span>}
      </label>
      {children}
      {error ? <p className="t-caption font-semibold text-bad">{error}</p> : hint ? <p className="t-caption">{hint}</p> : null}
    </div>
  );
}

/** A Card: --surface, 1px --line, radius 18px, no shadow. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`sp-card ${className}`}>{children}</section>;
}

/** Centred in its card: a 32px icon, a title, a line of body, an action below. */
export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="sp-card g-pad flex flex-col items-center py-10 text-center">
      <InboxIcon className="h-8 w-8 text-faint" />
      <p className="t-card-title mt-3">{title}</p>
      <p className="t-caption mx-auto mt-1 max-w-sm">{body}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** The page header: title left with the subtitle under it; the main action (primary) and others on the right. */
export function PageTitle({ title, sub, action }: { title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="t-h1">{title}</h1>
        {sub ? <div className="t-headline mt-1">{sub}</div> : null}
      </div>
      {action ? <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

/** A card's header: title left, a caption under it, an action on the right; 14px above the content. */
export function SectionHead({ title, sub, action, id, className = "" }: { title: ReactNode; sub?: ReactNode; action?: ReactNode; id?: string; className?: string }) {
  return (
    <header className={`g-head flex flex-wrap items-start justify-between gap-x-4 gap-y-2 ${className}`}>
      <div className="min-w-0">
        <h2 id={id} className="t-card-title">
          {title}
        </h2>
        {sub ? <p className="t-caption mt-0.5">{sub}</p> : null}
      </div>
      {action ? <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{action}</div> : null}
    </header>
  );
}
