"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PHONE_LINKS } from "@/lib/supplier-nav";

/** A link; `pattern` (a regular expression on the path) says when it is the current page, else the path starts it. */
export type PortalLink = { href: string; label: string; badge?: number; pattern?: string };

const LINK = "vr-nav-link focus-ring relative flex h-14 items-center justify-center gap-1 px-1 min-[700px]:h-10 min-[700px]:gap-1.5 min-[700px]:rounded-[11px] min-[700px]:px-3 min-[900px]:px-4";

function Badge({ n }: { n?: number }) {
  if (!n) return null;
  return (
    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-bad px-1 font-sans text-[12px] font-bold not-italic leading-none tabular-nums text-bad-ink">
      {n > 99 ? "99+" : n}
      <span className="sr-only"> unread</span>
    </span>
  );
}

/**
 * The links: a row under the header on wide screens, a bottom bar within thumb reach on phones. With `more` and more
 * links than fit a phone, the bar shows the first four and "More", a page listing the rest.
 */
export function PortalNav({ links, home, more }: { links: PortalLink[]; home: string; more?: string }) {
  const pathname = usePathname();
  // The home link is on for the home page and the pages under it that no other link claims.
  const others = links.filter((l) => l.href !== home).map((l) => l.href);
  const on = (l: PortalLink) =>
    l.pattern
      ? new RegExp(l.pattern).test(pathname)
      : l.href === home
        ? pathname === home || (pathname.startsWith(`${home}/`) && !others.some((o) => pathname.startsWith(o)) && pathname !== more)
        : pathname.startsWith(l.href);
  const cut = more && links.length > PHONE_LINKS + 1 ? PHONE_LINKS : links.length;
  const rest = links.slice(cut);
  const moreOn = !!more && (pathname === more || rest.some((l) => on(l)));
  return (
    <nav aria-label="Main" className="vr-bottombar fixed inset-x-0 bottom-0 z-40 pb-[env(safe-area-inset-bottom)] min-[700px]:static min-[700px]:pb-0 print:hidden">
      <ul className="mx-auto flex max-w-[980px] min-[700px]:flex-wrap min-[700px]:gap-1">
        {links.map((l, i) => (
          <li key={l.href} className={`flex-1 min-[700px]:flex-none ${i >= cut ? "max-[699px]:hidden" : ""}`}>
            <Link href={l.href} aria-current={on(l) ? "page" : undefined} className={LINK}>
              {l.label}
              <Badge n={l.badge} />
            </Link>
          </li>
        ))}
        {more && rest.length ? (
          <li className="flex-1 min-[700px]:hidden">
            <Link href={more} aria-current={moreOn ? "page" : undefined} className={LINK}>
              More
              <Badge n={rest.reduce((sum, l) => sum + (l.badge ?? 0), 0)} />
            </Link>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
