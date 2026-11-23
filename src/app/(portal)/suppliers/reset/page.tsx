import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FactoryReset, type AuthenticatorStatus } from "@/components/supplier/factory-reset";
import { buttonClass, PageTitle } from "@/components/ui";
import { isOwner, requireUser } from "@/lib/auth";
import { logError } from "@/lib/redact";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Factory reset" };

/** Owner only: wipe the portal's data, confirmed with a code from an authenticator app. */
export default async function FactoryResetPage() {
  const user = await requireUser();
  if (!isOwner(user)) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reset_authenticator_status");
  if (error) logError("reset authenticator status", error);
  const status: AuthenticatorStatus = data === "linked" || data === "pending" ? data : "none";
  return (
    <>
      <PageTitle
        title="Factory reset"
        sub="Wipes the portal's data. It cannot be undone, so it asks for a code from an authenticator app on your phone."
        action={
          <Link href="/suppliers/logins" className={buttonClass("row")}>
            Back
          </Link>
        }
      />
      {error ? <p className="t-body mb-4 font-semibold text-bad">The reset is not set up in the database yet, so it cannot run.</p> : null}
      <FactoryReset status={status} />
    </>
  );
}
