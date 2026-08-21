import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

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
  manifest: "/site.webmanifest",
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
      <body className="antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
