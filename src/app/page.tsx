import { redirect } from "next/navigation";
import { getSessionUser, homeFor } from "@/lib/auth";

/** The front door: everyone is sent to their own side. */
export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!user.active) redirect("/login?reason=inactive");
  if (user.must_change_password) redirect("/change-password");
  redirect(homeFor(user));
}
