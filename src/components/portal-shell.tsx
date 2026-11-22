import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Logo } from "@/components/icons";
import { PortalNav, type PortalLink } from "@/components/supplier/portal-nav";
import { buttonClass } from "@/components/ui";

/**
 * The frame every signed-in page sits in: who you are, the links you may use (a row on wide screens, a bottom bar on
 * phones), and the page. The supplier's screens and VRPRIME's screens share it, each with its own links.
 */
export function PortalShell({ home, title, sub, links, children }: { home: string; title: string; sub: string; links: PortalLink[]; children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface2 print:hidden">
        <div className="mx-auto flex max-w-[980px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <Link href={home} className="focus-ring flex items-center gap-2.5 rounded-[11px]">
            <Logo size={28} />
            <span>
              <span className="block font-display text-[15px] font-bold leading-tight">{title}</span>
              <span className="t-caption block leading-tight">{sub}</span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Link prefetch={false} href="/change-password" className={buttonClass("row")}>
              Password
            </Link>
            <SignOutButton className={buttonClass("row")} />
          </div>
        </div>
        <div className="mx-auto max-w-[980px] px-4 min-[700px]:pb-2">
          <PortalNav links={links} home={home} />
        </div>
      </header>
      <main className="mx-auto max-w-[980px] px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-4 min-[700px]:pb-12 print:max-w-none print:p-0">{children}</main>
    </div>
  );
}
