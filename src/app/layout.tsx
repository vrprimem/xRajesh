import type { Metadata, Viewport } from "next";
import { Archivo, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { ServiceWorker } from "@/components/service-worker";
import { ToastProvider } from "@/components/toast";
import { readThemeMode, THEME_COOKIE } from "@/lib/theme-mode";
import "./globals.css";

// Archivo for everything, as a variable font with its width axis, so tight spots (the phone tab bar) can use a
// narrower cut of the same face; Geist Mono only for barcodes and codes. globals.css maps these onto --font-sans,
// --font-display and --font-mono.
const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"], axes: ["wdth"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], weight: ["400", "500"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "VRPRIME Supplier Portal", template: "%s · VRPRIME Supplier Portal" },
  description: "Dispatches, labels and stock for VRPRIME suppliers.",
  applicationName: "VRPRIME Supplier Portal",
  appleWebApp: { capable: true, title: "VR Supplier", statusBarStyle: "black" },
  robots: { index: false, follow: false },
};

// The browser bar matches the black header band in every mode.
const BAND = "#0a0a0a";

/** Form controls follow the chosen mode; Auto follows the phone or computer. */
export async function generateViewport(): Promise<Viewport> {
  const mode = readThemeMode((await cookies()).get(THEME_COOKIE)?.value);
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: BAND,
    colorScheme: mode === "auto" ? "light dark" : mode,
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const mode = readThemeMode((await cookies()).get(THEME_COOKIE)?.value);
  return (
    // data-theme is left off for Auto, so the CSS follows the device; the switch in the header sets it.
    <html lang="en-IN" data-theme={mode === "auto" ? undefined : mode} className={`${archivo.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <ToastProvider>{children}</ToastProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
