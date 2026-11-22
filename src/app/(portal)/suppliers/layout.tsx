import type { ReactNode } from "react";
import { PortalShell } from "@/components/portal-shell";
import type { PortalLink } from "@/components/supplier/portal-nav";
import { isOwner, requireUser } from "@/lib/auth";

/** VRPRIME's screens: owner and admin. A supplier login is sent to its own screens. */
export default async function SuppliersLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const links: PortalLink[] = [{ href: "/suppliers", label: "Suppliers" }, ...(isOwner(user) ? [{ href: "/suppliers/logins", label: "VRPRIME logins" }] : [])];
  return (
    <PortalShell home="/suppliers" title="VRPRIME" sub={`Supplier portal · ${user.name} (${user.role})`} links={links}>
      {children}
    </PortalShell>
  );
}
