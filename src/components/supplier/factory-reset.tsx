"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useToast } from "@/components/toast";
import { buttonClass, Card, Field, SectionHead } from "@/components/ui";
import { formatNumber, noun } from "@/lib/format";
import { confirmFactoryReset, sendResetCode } from "@/server/actions/reset";

type Scope = "activity" | "everything";

const LEVELS: { scope: Scope; title: string; deletes: string; keeps: string }[] = [
  {
    scope: "activity",
    title: "Clear test activity",
    deletes: "dispatches, carton labels and scans, send plans, produce requests, alerts and vehicle photos.",
    keeps: "suppliers, their logins, products, minimums and VRPRIME's stock.",
  },
  {
    scope: "everything",
    title: "Factory reset: everything",
    deletes: "all of the above, plus suppliers, their logins, products, minimums and the copy of VRPRIME's stock (read again from the inventory software straight away).",
    keeps: "your login and VRPRIME's admin logins.",
  },
];

/** What a finished reset removed, in a line. */
function summary(counts: Record<string, number>): string {
  const parts: [string, string][] = [
    ["suppliers", "supplier"],
    ["supplier_logins", "supplier login"],
    ["products", "product"],
    ["dispatches", "dispatch"],
    ["cartons", "carton"],
    ["send_plans", "send plan"],
    ["alerts", "alert"],
    ["photos", "photo"],
  ];
  const said = parts.filter(([key]) => (counts[key] ?? 0) > 0).map(([key, one]) => `${formatNumber(counts[key])} ${noun(counts[key], one, one === "dispatch" ? "dispatches" : undefined)}`);
  return said.length ? `Removed ${said.join(", ")}.` : "There was nothing to remove.";
}

/**
 * The owner's factory reset: choose what to wipe, get a one-time code by email, enter it and type RESET. The database
 * refuses unless the code was just entered, so this page only guides; it is not the lock.
 */
export function FactoryReset({ email }: { email: string }) {
  const router = useRouter();
  const toast = useToast();
  const [scope, setScope] = useState<Scope | null>(null);
  const [sentAt, setSentAt] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, startSending] = useTransition();
  const [wiping, startWiping] = useTransition();

  const send = () =>
    startSending(async () => {
      const result = await sendResetCode();
      toast.result(result);
      if (result.ok) {
        setSentAt(new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }));
        setCode("");
      }
    });

  const wipe = () => {
    if (!scope) return setErrors({ scope: "Choose what to wipe" });
    if (!sentAt) return setErrors({ code: "Email yourself a code first" });
    startWiping(async () => {
      const result = await confirmFactoryReset({ scope, code, confirm });
      setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
      if (!result.ok) return void toast.result(result);
      toast.show(`${result.message}. ${summary(result.data?.counts ?? {})}`, "ok");
      router.replace("/suppliers");
      router.refresh();
    });
  };

  const action = scope === "everything" ? "Wipe everything now" : scope === "activity" ? "Clear test activity now" : "Wipe now";

  return (
    <div className="flex flex-col gap-4">
      <Card className="g-pad">
        <SectionHead title="1. Choose what to wipe" sub="Nothing in the inventory software (inventory.vrprime.in) is changed: labels made there stay there." />
        <div role="radiogroup" aria-label="What to wipe" aria-invalid={Boolean(errors.scope)} className="grid gap-3 min-[700px]:grid-cols-2">
          {LEVELS.map((l) => (
            <label key={l.scope} className={`flex cursor-pointer gap-3 rounded-[10px] border-2 p-4 ${scope === l.scope ? "border-frame bg-accent-soft" : "border-line-soft bg-surface2"}`}>
              <input type="radio" name="reset-scope" value={l.scope} checked={scope === l.scope} onChange={() => (setScope(l.scope), setErrors({}))} className="mt-1 h-5 w-5 shrink-0 accent-(--frame)" />
              <span className="flex min-w-0 flex-col gap-1.5">
                <span className="t-card-title">{l.title}</span>
                <span className="text-[15px]">
                  <b>Deletes</b> {l.deletes}
                </span>
                <span className="t-caption">
                  <b>Keeps</b> {l.keeps}
                </span>
              </span>
            </label>
          ))}
        </div>
        {errors.scope ? <p className="t-caption mt-2 font-semibold text-bad">{errors.scope}</p> : null}
      </Card>

      <Card className="g-pad">
        <SectionHead title="2. Get a one-time code" sub={`It is emailed to ${email} and works for 15 minutes. Asking again sends a new one.`} />
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={send} disabled={sending} className={buttonClass("secondary")}>
            {sending ? "Sending..." : sentAt ? "Send a new code" : "Email me a code"}
          </button>
          {sentAt ? <p className="t-caption">Sent at {sentAt}. Check your inbox, and spam if it is not there.</p> : null}
        </div>
      </Card>

      <Card className="g-pad">
        <SectionHead title="3. Confirm" sub="This cannot be undone." />
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            wipe();
          }}
          className="flex flex-col gap-4"
        >
          <Field label="Code from the email" htmlFor="reset-code" required error={errors.code}>
            <input
              id="reset-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={10}
              className="input max-w-[240px] font-mono text-[22px] tracking-[0.25em]"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              aria-invalid={Boolean(errors.code)}
            />
          </Field>
          <Field label="Type RESET" htmlFor="reset-confirm" required error={errors.confirm}>
            <input
              id="reset-confirm"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="input max-w-[240px]"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={Boolean(errors.confirm)}
            />
          </Field>
          <div>
            <button type="submit" disabled={wiping} className={buttonClass("danger", "w-full min-[700px]:w-auto")}>
              {wiping ? "Wiping..." : action}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
