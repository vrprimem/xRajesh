import type { SupplierRole } from "./types.ts";

// The supplier's links. On phones the bottom bar holds the first four and "More" (/supplier/more lists the rest); wide
// screens show them all. Money is the supplier's owner's alone.

export type NavLink = { href: string; label: string; badge?: number };

export const SUPPLIER_MORE = "/supplier/more";

export function supplierLinks(role: SupplierRole, unread: number): NavLink[] {
  const owner = role === "supplier_owner";
  return [
    { href: "/supplier", label: "Home" },
    { href: "/supplier/production", label: "Production" },
    { href: "/supplier/dispatches", label: "Dispatches" },
    ...(owner ? [{ href: "/supplier/money", label: "Money" }] : []),
    { href: "/supplier/supplies", label: "Supplies" },
    { href: "/supplier/products", label: "Products" },
    { href: "/supplier/reports", label: "Reports" },
    { href: "/supplier/alerts", label: "Alerts", badge: unread },
  ];
}

/** How many links the phone bar shows before "More". */
export const PHONE_LINKS = 4;
