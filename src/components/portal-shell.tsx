import { cookies } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Logo } from "@/components/icons";
import { PortalNav, type PortalLink } from "@/components/supplier/portal-nav";
import { ThemeSwitch } from "@/components/theme-switch";
import { buttonClass } from "@/components/ui";
import { readThemeMode, THEME_COOKIE } from "@/lib/theme-mode";

/**
 * The frame every signed-in page sits in: a black header band with who you are, the colour-mode switch and the links
 * you may use (a row in the header on wide screens, a bar at the bottom on phones), and the page.
 */
export async function PortalShell({ home, title, sub, links, children }: { home: string; title: string; sub: string; links: PortalLink[]; children: ReactNode }) {
  const theme = readThemeMode((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <div className="min-h-dvh">
      <header className="vr-header print:hidden">
        <div className="mx-auto flex max-w-[980px] flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-3">
          <Link href={home} className="focus-ring flex min-w-0 items-center gap-3 rounded-[10px]">
            <Logo size={40} />
            <span className="min-w-0">
              <span className="vr-brand block truncate">{title}</span>
              <span className="t-caption block truncate">{sub}</span>
            </span>
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <ThemeSwitch initial={theme} />
            <Link prefetch={false} href="/change-password" className={buttonClass("row")}>
              Password
            </Link>
            <SignOutButton className={buttonClass("row")} />
          </div>
        </div>
        <div className="mx-auto max-w-[980px] px-4">
          <PortalNav links={links} home={home} />
        </div>
      </header>
      <main className="mx-auto max-w-[980px] px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6 min-[700px]:pb-14 print:max-w-none print:p-0">{children}</main>
    </div>
  );
}
