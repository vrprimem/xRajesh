import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignInDoor } from "@/components/auth/sign-in-door";
import { getSessionUser, homeFor } from "@/lib/auth";

export const metadata: Metadata = { title: "Admin sign in" };

/** VRPRIME's own people (owner and admin) sign in here. Supplier logins use /login. */
export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [user, sp] = await Promise.all([getSessionUser(), searchParams]);
  if (user?.active) redirect(homeFor(user));

  const inactive = sp.reason === "inactive" || (user !== null && !user.active);
  return <SignInDoor door="admin" notice={inactive ? "This account is not active. Ask the owner to switch it on." : undefined} />;
}
