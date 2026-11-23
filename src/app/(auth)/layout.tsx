import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { Logo } from "@/components/icons";
import { ThemeSwitch } from "@/components/theme-switch";
import { readThemeMode, THEME_COOKIE } from "@/lib/theme-mode";

/** Sign-in and change-password: the name on the indigo band, and the form on a card below it. */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const theme = readThemeMode((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <div className="min-h-dvh">
      <header className="vr-hero">
        <div className="relative mx-auto flex max-w-[440px] flex-col items-center px-4 pb-10 pt-16 text-center">
          <div className="absolute right-4 top-4">
            <ThemeSwitch initial={theme} />
          </div>
          <Logo size={64} onBrand />
          <p className="vr-wordmark mt-5">VRPRIME</p>
          <p className="vr-kicker mt-2">Supplier portal</p>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[440px] px-4 pb-12 pt-6">
        <div className="sp-card g-pad">{children}</div>
        <p className="t-caption mt-4 text-center">Dispatches, labels and stock in one place.</p>
      </main>
    </div>
  );
}
