"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckIcon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { buttonClass, Card, Field, SectionHead } from "@/components/ui";
import { formatNumber, noun } from "@/lib/format";
import { confirmFactoryReset, finishAuthenticator, linkAuthenticator } from "@/server/actions/reset";

type Scope = "activity" | "everything";
export type AuthenticatorStatus = "none" | "pending" | "linked";

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
  const parts: [string, string, string?][] = [
    ["suppliers", "supplier"],
    ["supplier_logins", "supplier login"],
    ["products", "product"],
    ["dispatches", "dispatch", "dispatches"],
    ["cartons", "carton"],
    ["send_plans", "send plan"],
    ["alerts", "alert"],
    ["photos", "photo"],
  ];
  const said = parts.filter(([key]) => (counts[key] ?? 0) > 0).map(([key, one, many]) => `${formatNumber(counts[key])} ${noun(counts[key], one, many)}`);
  return said.length ? `Removed ${said.join(", ")}.` : "There was nothing to remove.";
}

const digits = (v: string) => v.replace(/\D/g, "").slice(0, 6);

/** Step 2 before an app is linked: password, QR code, first code. */
function LinkAuthenticator() {
  const router = useRouter();
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState<{ qr: string; key: string } | null>(null);
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  if (!shown) {
    return (
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const result = await linkAuthenticator({ password });
            setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
            if (!result.ok) return void toast.result(result);
            setPassword("");
            setShown(result.data ?? null);
          });
        }}
        className="flex flex-col gap-4"
      >
        <ol className="t-body flex list-decimal flex-col gap-1 pl-5">
          <li>Install Google Authenticator or Microsoft Authenticator on your phone.</li>
          <li>Enter your password here and press Show QR code.</li>
          <li>Scan the QR code with the app, then enter the 6-digit code it shows.</li>
        </ol>
        <Field label="Your password" htmlFor="link-password" required error={errors.password}>
          <input id="link-password" type="password" autoComplete="current-password" className="input max-w-[320px]" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={Boolean(errors.password)} />
        </Field>
        <div>
          <button type="submit" disabled={pending} className={buttonClass("secondary")}>
            {pending ? "Checking..." : "Show QR code"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await finishAuthenticator({ code });
          setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
          toast.result(result);
          if (result.ok) router.refresh();
        });
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-start gap-5">
        {/* eslint-disable-next-line @next/next/no-img-element -- a generated data: URL, shown once */}
        <img src={shown.qr} alt="QR code to scan with the authenticator app" width={220} height={220} className="rounded-[10px] border-2 border-frame bg-white p-1" />
        <div className="flex min-w-0 max-w-[360px] flex-col gap-2">
          <p className="t-body">Scan this with the app. It is shown only now; nobody else needs it.</p>
          <p className="t-caption">Cannot scan? In the app choose &quot;Enter a setup key&quot; and type:</p>
          <p className="break-all font-mono text-[17px] font-medium tracking-wide">{shown.key}</p>
        </div>
      </div>
      <Field label="Code the app shows" htmlFor="link-code" required error={errors.code}>
        <input id="link-code" inputMode="numeric" autoComplete="one-time-code" className="input max-w-[200px] font-mono text-[22px] tracking-[0.25em]" value={code} onChange={(e) => setCode(digits(e.target.value))} aria-invalid={Boolean(errors.code)} />
      </Field>
      <div>
        <button type="submit" disabled={pending} className={buttonClass("primary")}>
          {pending ? "Checking..." : "Link app"}
        </button>
      </div>
    </form>
  );
}

/**
 * The owner's factory reset: choose what to wipe, (once) link an authenticator app, then enter its current code and
 * type RESET. The database checks the code and refuses everything else, so this page only guides; it is not the lock.
 */
export function FactoryReset({ status }: { status: AuthenticatorStatus }) {
  const router = useRouter();
  const toast = useToast();
  const [scope, setScope] = useState<Scope | null>(null);
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [wiping, startWiping] = useTransition();
  const linked = status === "linked";

  const wipe = () => {
    if (!scope) return setErrors({ scope: "Choose what to wipe" });
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
        <div role="radiogroup" aria-label="What to wipe" className="grid gap-3 min-[700px]:grid-cols-2">
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
        <SectionHead
          title="2. Authenticator app"
          sub={linked ? "Linked. The app shows a new 6-digit code every 30 seconds under VRPRIME Supplier Portal." : "Link it once. After that every reset asks for the code it shows."}
        />
        {linked ? (
          <p className="t-body flex items-start gap-2">
            <CheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-ok" />
            <span>
              Ready. Lost that phone? The link can only be removed in Supabase, by whoever runs the portal (see SETUP.md), so nobody can swap in their own phone from here.
            </span>
          </p>
        ) : (
          <LinkAuthenticator />
        )}
      </Card>

      <Card className="g-pad">
        <SectionHead title="3. Confirm" sub={linked ? "This cannot be undone." : "Link your authenticator app first (step 2)."} />
        {linked ? (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              wipe();
            }}
            className="flex flex-col gap-4"
          >
            <Field label="Code from the app" htmlFor="reset-code" required error={errors.code}>
              <input
                id="reset-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                className="input max-w-[200px] font-mono text-[22px] tracking-[0.25em]"
                value={code}
                onChange={(e) => setCode(digits(e.target.value))}
                aria-invalid={Boolean(errors.code)}
              />
            </Field>
            <Field label="Type RESET" htmlFor="reset-confirm" required error={errors.confirm}>
              <input
                id="reset-confirm"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                className="input max-w-[200px]"
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
        ) : null}
      </Card>
    </div>
  );
}
