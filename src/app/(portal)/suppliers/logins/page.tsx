import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StaffLogins, type StaffLogin } from "@/components/supplier/supplier-admin";
import Link from "next/link";
import { buttonClass, Card, PageTitle, SectionHead } from "@/components/ui";
import { isOwner, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "VRPRIME logins" };

/** Owner only: who at VRPRIME can sign in here. */
export default async function StaffLoginsPage() {
  const user = await requireUser();
  if (!isOwner(user)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, name, role, active").in("role", ["owner", "admin"]).order("name");
  return (
    <>
      <PageTitle title="VRPRIME logins" />
      <StaffLogins logins={(data ?? []) as StaffLogin[]} me={user.id} />
      <Card className="g-pad mt-6">
        <SectionHead
          className="mb-0"
          title="Factory reset"
          sub="Wipe a test run, or everything except VRPRIME's logins. Asks for a code from an authenticator app on your phone."
          action={
            <Link href="/suppliers/reset" className={buttonClass("danger")}>
              Factory reset
            </Link>
          }
        />
      </Card>
    </>
  );
}
