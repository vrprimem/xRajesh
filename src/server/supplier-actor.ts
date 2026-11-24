import "server-only";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canManage, getActiveUser, getPortalUser } from "@/lib/auth";
import { logError, redactSecrets } from "@/lib/redact";
import type { ActionResult } from "@/lib/types";

// Shared by the supplier portal's server actions (not a "use server" file: plain helpers). Two kinds of people call
// them: a supplier login (its own supplier only) and VRPRIME's owner and admin (any supplier). Each action works out
// who is calling here, and every database function checks again.

export const UUID = z.uuid();

/** The value if it is a uuid, else null. */
export const idOf = (v: unknown): string | null => (UUID.safeParse(v).success ? (v as string) : null);

export type Actor = { supplierOnly: string | null; isOwner: boolean; scanner: boolean; supplierOwner: boolean };

/** Who is calling. `supplierOnly` is the one supplier a supplier login may touch; null for VRPRIME owner and admin. */
export async function actor(): Promise<Actor | null> {
  const portal = await getPortalUser();
  if (portal) return { supplierOnly: portal.supplierId, isOwner: false, scanner: portal.role === "supplier_scanner", supplierOwner: portal.role === "supplier_owner" };
  const user = await getActiveUser();
  if (user && canManage(user)) return { supplierOnly: null, isOwner: user.role === "owner", scanner: false, supplierOwner: false };
  return null;
}

/** The supplier an action is about: a supplier login always gets its own, whatever was sent. */
export function supplierFor(who: Actor, sent: unknown): string | null {
  if (who.supplierOnly) return who.supplierOnly;
  return idOf(sent);
}

export const NOT_ALLOWED: ActionResult<never> = { ok: false, message: "You do not have access to do that." };

/** A database refusal as a message. The functions raise plain sentences (code 22023) that are safe to show. */
export function failed(error: { message: string; code?: string }, what: string): ActionResult<never> {
  if (error.code === "PGRST202" || error.code === "42883") return { ok: false, message: "The database is not set up yet (see SETUP.md)." };
  if (error.code === "42501") return NOT_ALLOWED;
  if (error.code === "22023") {
    const text = redactSecrets(error.message);
    return { ok: false, message: text.charAt(0).toUpperCase() + text.slice(1) + (/[.!?]$/.test(text) ? "" : ".") };
  }
  logError(`supplier ${what}`, error);
  return { ok: false, message: `Could not ${what}. Check your connection and try again.` };
}

export function refresh() {
  revalidatePath("/", "layout");
}
