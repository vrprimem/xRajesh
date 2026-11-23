import type { ReactNode } from "react";
import { PortalShell } from "@/components/portal-shell";
import type { PortalLink } from "@/components/supplier/portal-nav";
import { requirePortalUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** The supplier's screens: for supplier logins only. VRPRIME's own people are sent to their Suppliers page. */
export default async function SupplierLayout({ children }: { children: ReactNode }) {
  const user = await requirePortalUser();
  const supabase = await createClient();
  // The database limits this to the person's own notifications.
  const { count } = await supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
  const links: PortalLink[] = [
    { href: "/supplier", label: "Home" },
    { href: "/supplier/dispatches", label: "Dispatches" },
    { href: "/supplier/products", label: "Products" },
    { href: "/supplier/reports", label: "Reports" },
    { href: "/supplier/alerts", label: "Alerts", badge: count ?? 0 },
  ];
  return (
    <PortalShell home="/supplier" title={user.supplierName} sub={`VRPRIME supplier portal · ${user.name}${user.role === "supplier_owner" ? "" : " (warehouse)"}`} links={links}>
      {children}
    </PortalShell>
  );
}
