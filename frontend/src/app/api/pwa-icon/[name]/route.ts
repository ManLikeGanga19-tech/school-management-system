import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Serves PWA icons from under /api so they ride the Cloudflare WAF exclusion
 * (/api/* is never challenged). Icons referenced by the manifest must be
 * fetchable WITHOUT a cf_clearance cookie — otherwise the WAF 403s them and
 * the app installs with no icon. Allowlisted filenames only (no traversal).
 */
const ALLOWED = new Set([
  "icon-192.png",
  "icon-512.png",
  "maskable-192.png",
  "maskable-512.png",
  "admin-icon-192.png",
  "admin-icon-512.png",
  "admin-maskable-192.png",
  "admin-maskable-512.png",
  "admin-apple-180.png",
  "admin-favicon-32.png",
]);

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!ALLOWED.has(name)) return new Response("Not found", { status: 404 });
  try {
    const buf = await readFile(path.join(process.cwd(), "public", "icons", name));
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
