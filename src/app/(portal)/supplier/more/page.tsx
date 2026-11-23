import type { Metadata } from "next";
import Link from "next/link";
import { PageTitle } from "@/components/ui";
import { requirePortalUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PHONE_LINKS, supplierLinks } from "@/lib/supplier-nav";

export const metadata: Metadata = { title: "More" };

/** On phones the bottom bar has room for four links: this page holds the rest, as big buttons. */
export default async function SupplierMorePage() {
  const user = await requirePortalUser();
  const supabase = await createClient();
  const { count } = await supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
  const rest = supplierLinks(user.role, count ?? 0).slice(PHONE_LINKS);
  return (
    <>
      <PageTitle title="More" />
      <ul className="grid gap-3 min-[520px]:grid-cols-2">
        {rest.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="sp-card focus-ring flex min-h-16 items-center justify-between gap-3 px-5 py-4 text-[20px] font-extrabold hover:bg-surface2">
              {l.label}
              {l.badge ? (
                <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-bad px-2 text-[14px] font-bold tabular-nums text-bad-ink">
                  {l.badge > 99 ? "99+" : l.badge}
                  <span className="sr-only"> unread</span>
                </span>
              ) : (
                <span aria-hidden>→</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
