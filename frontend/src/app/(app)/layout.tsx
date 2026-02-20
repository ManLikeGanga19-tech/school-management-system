// src/app/(app)/layout.tsx
import type { ReactNode } from "react";

/**
 * Tenant App Layout (UI wrapper only)
 *
 * IMPORTANT:
 * - Do NOT do auth redirects here.
 * - Auth gating is handled by middleware.ts (route-aware: /saas vs tenant).
 *
 * Reason:
 * Layouts can unintentionally wrap other route groups and cause
 * cross-scope redirects (your current SaaS->tenant login bug).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}