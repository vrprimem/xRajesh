import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter, Plus_Jakarta_Sans } from "next/font/google";
import { cookies } from "next/headers";
import { ServiceWorker } from "@/components/service-worker";
import { ToastProvider } from "@/components/toast";
import { readThemeMode, THEME_COOKIE } from "@/lib/theme-mode";
import "./globals.css";

// Plus Jakarta Sans for page titles, card titles and large numbers; Inter for all
// other text and table figures; Geist Mono only for barcodes and codes. globals.css maps
// these onto --font-display, --font-sans and --font-mono.
const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"], weight: ["600", "700"], display: "swap" });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], weight: ["400", "500"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "VRPRIME Supplier Portal", template: "%s · VRPRIME Supplier Portal" },
  description: "Dispatches, labels and stock for VRPRIME suppliers.",
  applicationName: "VRPRIME Supplier Portal",
  appleWebApp: { capable: true, title: "VR Supplier", statusBarStyle: "default" },
  robots: { index: false, follow: false },
};

// The page canvas in each mode (graphite-spec section 1), for the browser bar.
const PAPER = "#f4f5f9";
const NIGHT = "#0a0c12";

/** The browser bar and form controls follow the chosen mode. Auto is dark, like the page (glass-spec section 1). */
export async function generateViewport(): Promise<Viewport> {
  const mode = readThemeMode((await cookies()).get(THEME_COOKIE)?.value);
  const base = { width: "device-width", initialScale: 1, viewportFit: "cover" } as const;
  if (mode === "light") return { ...base, themeColor: PAPER, colorScheme: "light" };
  return { ...base, themeColor: NIGHT, colorScheme: "dark" };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const mode = readThemeMode((await cookies()).get(THEME_COOKIE)?.value);
  return (
    // data-theme is left off for Auto, which the CSS draws dark; the switch in the account menu sets it.
    <html lang="en-IN" data-theme={mode === "auto" ? undefined : mode} className={`${jakarta.variable} ${inter.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <ToastProvider>{children}</ToastProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
