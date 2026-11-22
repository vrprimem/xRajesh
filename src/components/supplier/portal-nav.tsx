"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type PortalLink = { href: string; label: string; badge?: number };

/** The links: a row under the header on wide screens, a glass bottom bar within thumb reach on phones. */
export function PortalNav({ links, home }: { links: PortalLink[]; home: string }) {
  const pathname = usePathname();
  // The home link is on for the home page and the pages under it that no other link claims.
  const others = links.filter((l) => l.href !== home).map((l) => l.href);
  const on = (href: string) => (href === home ? pathname === home || (pathname.startsWith(`${home}/`) && !others.some((o) => pathname.startsWith(o))) : pathname.startsWith(href));
  return (
    <nav aria-label="Main" className="vr-bottombar fixed inset-x-0 bottom-0 z-40 pb-[env(safe-area-inset-bottom)] min-[700px]:static min-[700px]:pb-0 print:hidden">
      <ul className="mx-auto flex max-w-[980px] min-[700px]:gap-1">
        {links.map((l) => (
          <li key={l.href} className="flex-1 min-[700px]:flex-none">
            <Link
              href={l.href}
              aria-current={on(l.href) ? "page" : undefined}
              className="vr-nav-link focus-ring relative flex h-14 items-center justify-center gap-1 px-1 min-[700px]:h-10 min-[700px]:gap-1.5 min-[700px]:rounded-[11px] min-[700px]:px-4"
            >
              {l.label}
              {l.badge ? (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-bad px-1 font-sans text-[12px] font-bold not-italic leading-none tabular-nums text-bad-ink">
                  {l.badge > 99 ? "99+" : l.badge}
                  <span className="sr-only"> unread</span>
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
