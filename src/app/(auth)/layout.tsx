import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { Backdrop } from "@/components/backdrop";
import { ThemeSwitch } from "@/components/theme-switch";
import { LiveLogo } from "@/components/ui";
import { readThemeMode, THEME_COOKIE } from "@/lib/theme-mode";

/** Sign-in and change-password: the big name over the sunset, and the form on a glass card. */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const theme = readThemeMode((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <div className="relative min-h-dvh">
      <Backdrop />
      <div className="absolute right-4 top-4">
        <ThemeSwitch initial={theme} />
      </div>
      <main className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col justify-center px-4 py-12">
        <div className="mb-7 flex flex-col items-center text-center">
          <span className="mb-5">
            <LiveLogo size={68} />
          </span>
          <p className="vr-wordmark vr-grad-text">VRPRIME</p>
          <p className="vr-kicker mt-2">Supplier portal</p>
          <p className="t-caption mt-2">Dispatches · labels · stock, all in one place</p>
        </div>
        <div className="sp-card g-pad w-full">{children}</div>
      </main>
    </div>
  );
}
