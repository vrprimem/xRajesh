import "server-only";
import { redirect } from "next/navigation";
import { STAFF_HOME } from "@/lib/supplier-nav";
import type { SupplierRole } from "@/lib/types";

/**
 * The warehouse person has his supplies (the godown), dispatches and scanning, and nothing else: on any other supplier
 * page, he is sent back to his supplies.
 */
export function ownerPage(user: { role: SupplierRole }): void {
  if (user.role !== "supplier_owner") redirect(STAFF_HOME);
}
