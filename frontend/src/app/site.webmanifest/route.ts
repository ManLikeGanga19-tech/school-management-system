import { headers } from "next/headers";

/**
 * Host-aware PWA manifest, served at /site.webmanifest (linked from the root
 * layout). The super-admin / operator console lives on the admin host and gets
 * a visually distinct installed-app icon + name + theme, so the platform owner
 * can tell the admin PWA apart from any school's PWA at a glance on their home
 * screen. Every other host (tenant subdomains, marketing apex) gets the normal
 * ShuleHQ identity.
 */

const DEFAULT_MANIFEST = {
  name: "ShuleHQ — School Management System",
  short_name: "ShuleHQ",
  description:
    "Enterprise school management for Kenyan schools — enrollment, finance, attendance, exams, and KEMIS-ready student records.",
  start_url: "/",
  display: "standalone",
  background_color: "#F8FAFC",
  theme_color: "#173F49",
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
    { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

const ADMIN_MANIFEST = {
  name: "ShuleHQ Admin — Operator Console",
  short_name: "ShuleHQ Admin",
  description: "ShuleHQ platform operations — rollout, billing, RBAC and support for the platform owner.",
  start_url: "/saas/dashboard",
  scope: "/",
  display: "standalone",
  background_color: "#0f172a",
  theme_color: "#0f172a",
  icons: [
    { src: "/icons/admin-icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icons/admin-icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "/icons/admin-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
    { src: "/icons/admin-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

function isAdminHost(host: string): boolean {
  const h = host.toLowerCase().split(":")[0];
  const configured = (process.env.NEXT_PUBLIC_ADMIN_HOST || "").toLowerCase().trim();
  return (!!configured && h === configured) || h.startsWith("admin.");
}

export async function GET() {
  const host = (await headers()).get("host") || "";
  const body = isAdminHost(host) ? ADMIN_MANIFEST : DEFAULT_MANIFEST;
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/manifest+json",
      // Manifest rarely changes; let the edge/browser cache it briefly.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
