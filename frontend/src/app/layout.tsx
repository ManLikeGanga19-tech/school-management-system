import type { Metadata, Viewport } from "next";
import { Source_Serif_4, Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

// Admin console ("Prestige Professional") fonts — self-hosted by next/font, so
// no external font host at runtime. Applied only within the .admin-theme scope.
const adminSerif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-admin-serif",
  display: "swap",
});
const adminSans = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-admin-sans",
  display: "swap",
});

// Brand identity — favicon/apple-icon are served by the app-router file
// conventions (src/app/icon.svg, favicon.ico, apple-icon.png). The PWA manifest
// is served host-aware by src/app/site.webmanifest/route.ts (the admin host gets
// a distinct installed-app icon); we link it here with a static path so pages
// stay statically/SSR-rendered rather than being forced dynamic.
export const metadata: Metadata = {
  title: {
    default: "ShuleHQ — School Management System",
    template: "%s · ShuleHQ",
  },
  description:
    "Enterprise school management for Kenyan schools — enrollment, finance, attendance, exams, and KEMIS-ready student records.",
  applicationName: "ShuleHQ",
  // Served from /api so the Cloudflare WAF (which excludes /api/*) never
  // challenges it — the browser fetches the manifest without credentials, so a
  // challenged path would 403. See src/app/api/manifest/route.ts.
  manifest: "/api/manifest",
  // iOS: open from the home screen as a standalone app (not a Safari shortcut).
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ShuleHQ",
  },
};

export const viewport: Viewport = {
  themeColor: "#173F49",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`antialiased ${adminSerif.variable} ${adminSans.variable}`}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
          <Toaster />
          <ServiceWorkerRegistrar />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
