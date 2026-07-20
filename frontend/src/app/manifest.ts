import type { MetadataRoute } from "next";

/**
 * PWA manifest — served at /manifest.webmanifest by Next.js.
 * Icons: standard (any) + maskable variants so Android launchers can
 * clip to any shape without cutting the mark (80% safe zone).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
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
      {
        src: "/icons/maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
