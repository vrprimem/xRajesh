import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SUPPLIER_ROLES, type AnyUser, type PortalUser, type SessionUser, type SupplierRole } from "@/lib/types";

// Two kinds of people sign in: VRPRIME's own (owner, admin) and supplier logins (supplier_owner, supplier_scanner).
// requireUser / getActiveUser hand out VRPRIME's own people only, so nothing written for them can be reached with a
// supplier login; the supplier's screens use requirePortalUser / getPortalUser. The database enforces the same split
// (private.user_role() is NULL for a supplier login), so this is the convenience and that is the lock.

export function isSupplierLogin(user: Pick<AnyUser, "role">): user is Pick<AnyUser, "role"> & { role: SupplierRole } {
  return (SUPPLIER_ROLES as readonly string[]).includes(user.role);
}

/** The signed-in person with their profile, or null. Read once per request. */
export const getSessionUser = cache(async (): Promise<AnyUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return null;
  // The database lets everyone read their own profile row.
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (!profile) return null;
  const email = typeof data.claims.email === "string" ? data.claims.email : null;
  return { ...profile, supplier_id: profile.supplier_id ?? null, email } as AnyUser;
});

/** Where a signed-in person starts. */
export const homeFor = (user: Pick<AnyUser, "role">) => (isSupplierLogin(user) ? "/supplier" : "/suppliers");

/** For VRPRIME's pages: one of VRPRIME's own people, signed in, active, and past the first-login password change. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!user.active) redirect("/login?reason=inactive");
  if (user.must_change_password) redirect("/change-password");
  if (isSupplierLogin(user)) redirect("/supplier");
  return user as SessionUser;
}

/** For VRPRIME's server actions: one of VRPRIME's own people, or null (never a supplier login). */
export async function getActiveUser(): Promise<SessionUser | null> {
  const user = await getSessionUser();
  if (!user || !user.active || user.must_change_password || isSupplierLogin(user)) return null;
  return user as SessionUser;
}

/** Anyone signed in and active, a supplier login included. Only for what every person has: their own notifications. */
export async function getSignedInUser(): Promise<AnyUser | null> {
  const user = await getSessionUser();
  if (!user || !user.active) return null;
  return user;
}

/** The supplier a login belongs to: its own row is the only one the database lets it read. */
async function portalUser(user: AnyUser): Promise<PortalUser | null> {
  if (!isSupplierLogin(user) || !user.supplier_id) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("suppliers").select("id, name, active").eq("id", user.supplier_id).maybeSingle();
  if (!data || !data.active) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role, supplierId: data.id, supplierName: data.name };
}

/** For the supplier's pages. VRPRIME's own people are sent to their Suppliers page. */
export const requirePortalUser = cache(async (): Promise<PortalUser> => {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!user.active) redirect("/login?reason=inactive");
  if (user.must_change_password) redirect("/change-password");
  if (!isSupplierLogin(user)) redirect("/suppliers");
  const portal = await portalUser(user);
  if (!portal) redirect("/login?reason=inactive");
  return portal;
});

/** For the supplier's server actions: the supplier login, or null. */
export async function getPortalUser(): Promise<PortalUser | null> {
  const user = await getSessionUser();
  if (!user || !user.active || user.must_change_password) return null;
  return portalUser(user);
}

/** VRPRIME owner and admin: suppliers, minimums, dispatches. */
export function canManage(user: Pick<SessionUser, "role">): boolean {
  return user.role === "owner" || user.role === "admin";
}

/** Logins and adding suppliers. */
export function isOwner(user: Pick<SessionUser, "role">): boolean {
  return user.role === "owner";
}
