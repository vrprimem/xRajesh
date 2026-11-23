import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FactoryReset } from "@/components/supplier/factory-reset";
import { buttonClass, PageTitle } from "@/components/ui";
import { isOwner, requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Factory reset" };

/** Owner only: wipe the portal's data, after a one-time code from email. */
export default async function FactoryResetPage() {
  const user = await requireUser();
  if (!isOwner(user)) notFound();
  return (
    <>
      <PageTitle
        title="Factory reset"
        sub="Wipes the portal's data. It cannot be undone, so it asks for a one-time code from your email first."
        action={
          <Link href="/suppliers/logins" className={buttonClass("row")}>
            Back
          </Link>
        }
      />
      {user.email ? <FactoryReset email={user.email} /> : <p className="t-body">Your login has no email address, so no code can be sent and the portal cannot be reset from here.</p>}
    </>
  );
}
