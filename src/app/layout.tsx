import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Geist_Mono, Inter } from "next/font/google";
import { cookies } from "next/headers";
import { ServiceWorker } from "@/components/service-worker";
import { ToastProvider } from "@/components/toast";
import { readThemeMode, THEME_COOKIE } from "@/lib/theme-mode";
import "./globals.css";

// Barlow Condensed (slanted capitals) for titles, buttons, chips and big numbers; Inter for all other text and table
// figures, so long lines stay easy to read; Geist Mono only for barcodes and codes. globals.css maps these onto
// --font-display, --font-sans and --font-mono.
const barlow = Barlow_Condensed({ variable: "--font-barlow", subsets: ["latin"], weight: ["600", "700", "800"], style: ["normal", "italic"], display: "swap" });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], weight: ["400", "500"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "VRPRIME Supplier Portal", template: "%s · VRPRIME Supplier Portal" },
  description: "Dispatches, labels and stock for VRPRIME suppliers.",
  applicationName: "VRPRIME Supplier Portal",
  appleWebApp: { capable: true, title: "VR Supplier", statusBarStyle: "default" },
  robots: { index: false, follow: false },
};

// The page canvas in each mode, for the browser bar: beach-day sand and night-drive violet.
const PAPER = "#fff7f0";
const NIGHT = "#0c0716";

/** The browser bar and form controls follow the chosen mode; Auto follows the phone or computer. */
export async function generateViewport(): Promise<Viewport> {
  const mode = readThemeMode((await cookies()).get(THEME_COOKIE)?.value);
  const base = { width: "device-width", initialScale: 1, viewportFit: "cover" } as const;
  if (mode === "light") return { ...base, themeColor: PAPER, colorScheme: "light" };
  if (mode === "dark") return { ...base, themeColor: NIGHT, colorScheme: "dark" };
  return {
    ...base,
    themeColor: [
      { media: "(prefers-color-scheme: light)", color: PAPER },
      { media: "(prefers-color-scheme: dark)", color: NIGHT },
    ],
    colorScheme: "light dark",
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const mode = readThemeMode((await cookies()).get(THEME_COOKIE)?.value);
  return (
    // data-theme is left off for Auto, so the CSS follows the device; the switch in the header sets it.
    <html lang="en-IN" data-theme={mode === "auto" ? undefined : mode} className={`${barlow.variable} ${inter.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <ToastProvider>{children}</ToastProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
