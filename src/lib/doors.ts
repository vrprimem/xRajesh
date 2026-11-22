// The two ways in. Suppliers (the supplier's owner and warehouse people) sign in at /login; VRPRIME's own people (owner
// and admin) sign in at /login/admin. Each page lets in only its own kind of account.
import { SUPPLIER_ROLES } from "./types.ts";

export type Door = "supplier" | "admin";

/** Where each door is. */
export const DOOR_PATH: Record<Door, string> = { supplier: "/login", admin: "/login/admin" };

/** The door an account belongs to, from its role. */
export function doorFor(role: string): Door {
  return (SUPPLIER_ROLES as readonly string[]).includes(role) ? "supplier" : "admin";
}

/** The door for a page someone signed out tried to open: VRPRIME's pages (/suppliers...) use the admin door. */
export function doorForPath(path: string): Door {
  return path === "/suppliers" || path.startsWith("/suppliers/") ? "admin" : "supplier";
}

/** What to say when the password was right but the account belongs to the other door. */
export function wrongDoorMessage(triedDoor: Door): string {
  return triedDoor === "supplier"
    ? "This is a VRPRIME admin account. Use Admin sign-in above."
    : "This is a supplier account. Use Supplier sign-in above.";
}
