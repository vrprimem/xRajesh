import type { SupplierRole } from "./types.ts";

// The supplier's links. On phones the bottom bar holds the first four and "More" (/supplier/more lists the rest); wide
// screens show them all. Money is the supplier's owner's alone. The warehouse person gets three links and nothing else:
// his supplies (the godown), dispatches, and scanning the next dispatch.

/** A link; `pattern` (a regular expression on the path) says when it is the current page, else the path starts it. */
export type NavLink = { href: string; label: string; badge?: number; pattern?: string };

export const SUPPLIER_MORE = "/supplier/more";

/** Where the warehouse person lands, and goes back to from any page that is not his. */
export const STAFF_HOME = "/supplier/godown";

export function supplierLinks(role: SupplierRole, unread: number): NavLink[] {
  if (role !== "supplier_owner") {
    return [
      { href: STAFF_HOME, label: "Supplies" },
      // A dispatch's scanning screen belongs to Scan, not to Dispatch.
      { href: "/supplier/dispatches", label: "Dispatch", pattern: "^/supplier/dispatches(?!/[^/]+/scan)" },
      { href: "/supplier/scan", label: "Scan", pattern: "^/supplier/(scan|dispatches/[^/]+/scan)" },
    ];
  }
  return [
    { href: "/supplier", label: "Home" },
    { href: "/supplier/godown", label: "Godown" },
    { href: "/supplier/dispatches", label: "Dispatches" },
    { href: "/supplier/supplies", label: "Supplies" },
    { href: "/supplier/daybook", label: "Day book" },
    { href: "/supplier/products", label: "Products" },
    { href: "/supplier/reports", label: "Reports" },
    { href: "/supplier/alerts", label: "Alerts", badge: unread },
  ];
}

/** How many links the phone bar shows before "More". */
export const PHONE_LINKS = 4;
