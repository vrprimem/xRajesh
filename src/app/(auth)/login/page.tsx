import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignInDoor } from "@/components/auth/sign-in-door";
import { getSessionUser, homeFor } from "@/lib/auth";

export const metadata: Metadata = { title: "Supplier sign in" };

/** The supplier's sign-in (the site's front door). VRPRIME's own people use /login/admin. */
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [user, sp] = await Promise.all([getSessionUser(), searchParams]);
  if (user?.active) redirect(homeFor(user));

  const inactive = sp.reason === "inactive" || (user !== null && !user.active);
  return <SignInDoor door="supplier" notice={inactive ? "This account is not active. Ask VRPRIME to switch it on." : undefined} />;
}
