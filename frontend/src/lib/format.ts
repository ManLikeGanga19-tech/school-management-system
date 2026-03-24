/**
 * Shared formatting utilities used across all dashboard pages.
 * Import from here instead of re-defining locally per-page.
 */

/** Safely coerce an unknown API value to a finite number (0 on failure). */
export function toNumber(value: string | number | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Format a number as Kenyan Shillings (KES).
 * Values ≥ 1,000,000 are compacted (e.g. KES 1.2M).
 */
export function formatKes(value: number, compact = false): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
    notation: compact || value >= 1_000_000 ? "compact" : "standard",
  }).format(value);
}

/** Human-readable relative time (e.g. "3m ago", "2h ago"). */
export function timeAgo(dateString?: string | null): string {
  if (!dateString) return "—";
  const diff = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3_600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3_600)}h ago`;
  return `${Math.floor(diff / 86_400)}d ago`;
}
