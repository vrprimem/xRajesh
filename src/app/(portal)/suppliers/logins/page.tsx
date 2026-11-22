import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StaffLogins, type StaffLogin } from "@/components/supplier/supplier-admin";
import { PageTitle } from "@/components/ui";
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
    </>
  );
}
