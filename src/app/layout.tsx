import type { Metadata, Viewport } from "next";
import { Geist_Mono, Poppins } from "next/font/google";
import { cookies } from "next/headers";
import { ServiceWorker } from "@/components/service-worker";
import { ToastProvider } from "@/components/toast";
import { readThemeMode, THEME_COOKIE } from "@/lib/theme-mode";
import "./globals.css";

// Poppins for everything (regular, medium and semibold); Geist Mono only for barcodes and codes. globals.css maps
// these onto --font-sans, --font-display and --font-mono.
const poppins = Poppins({ variable: "--font-poppins", subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], weight: ["400", "500"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "VRPRIME Supplier Portal", template: "%s · VRPRIME Supplier Portal" },
  description: "Dispatches, labels and stock for VRPRIME suppliers.",
  applicationName: "VRPRIME Supplier Portal",
  appleWebApp: { capable: true, title: "VR Supplier", statusBarStyle: "default" },
  robots: { index: false, follow: false },
};

// The browser bar matches the header: white in light, deep indigo in dark.
const LIGHT_BAR = "#ffffff";
const DARK_BAR = "#161834";

/** Form controls follow the chosen mode; Auto follows the phone or computer. */
export async function generateViewport(): Promise<Viewport> {
  const mode = readThemeMode((await cookies()).get(THEME_COOKIE)?.value);
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor:
      mode === "auto"
        ? [
            { media: "(prefers-color-scheme: light)", color: LIGHT_BAR },
            { media: "(prefers-color-scheme: dark)", color: DARK_BAR },
          ]
        : mode === "dark"
          ? DARK_BAR
          : LIGHT_BAR,
    colorScheme: mode === "auto" ? "light dark" : mode,
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const mode = readThemeMode((await cookies()).get(THEME_COOKIE)?.value);
  return (
    // data-theme is left off for Auto, so the CSS follows the device; the switch in the header sets it.
    <html lang="en-IN" data-theme={mode === "auto" ? undefined : mode} className={`${poppins.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <ToastProvider>{children}</ToastProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
