/**
 * ShuleHQLogo — the single source of truth for ShuleHQ branding in the UI.
 *
 * Variants:
 *   <ShuleHQLogo />                    mark + wordmark (default)
 *   <ShuleHQLogo variant="mark" />     square mark only (nav chips, avatars)
 *   <ShuleHQLogo theme="dark" />       wordmark in white (on dark surfaces)
 *
 * The mark is inline SVG (no network fetch, crisp at any DPI). The same
 * geometry lives in /public/brand/shulehq-mark.svg for non-React surfaces
 * (emails, PDFs, external embeds) — keep the two in sync.
 */

type Props = {
  variant?: "full" | "mark";
  /** Wordmark color scheme: "light" (dark text, light backgrounds) or
   *  "dark" (white text, dark backgrounds). The mark itself never changes. */
  theme?: "light" | "dark";
  /** Height of the mark in pixels; the wordmark scales with it. */
  size?: number;
  className?: string;
};

export function ShuleHQMark({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="ShuleHQ"
      className={className}
    >
      <rect x="2" y="2" width="60" height="60" rx="14" fill="#173F49" />
      <path
        d="M13 38.5 C 20 33.5, 28.5 33.5, 32 38.5 L 32 52 C 28.5 47.5, 20 47.5, 13 51.5 Z"
        fill="#FFFFFF"
        opacity="0.96"
      />
      <path
        d="M51 38.5 C 44 33.5, 35.5 33.5, 32 38.5 L 32 52 C 35.5 47.5, 44 47.5, 51 51.5 Z"
        fill="#FFFFFF"
        opacity="0.82"
      />
      <path d="M32 11 L53 21 L32 31 L11 21 Z" fill="#F4B63F" />
      <path d="M50 22.5 L50 30" stroke="#F4B63F" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="50" cy="32.2" r="2.6" fill="#F4B63F" />
    </svg>
  );
}

export function ShuleHQLogo({
  variant = "full",
  theme = "light",
  size = 40,
  className,
}: Props) {
  if (variant === "mark") {
    return <ShuleHQMark size={size} className={className} />;
  }
  const textSize = Math.round(size * 0.55);
  return (
    <span
      className={`inline-flex items-center gap-2.5 ${className ?? ""}`}
      style={{ lineHeight: 1 }}
    >
      <ShuleHQMark size={size} />
      <span
        className="font-bold tracking-tight"
        style={{ fontSize: textSize }}
      >
        <span className={theme === "dark" ? "text-white" : "text-slate-900"}>
          Shule
        </span>
        <span className="text-[#F4B63F]">HQ</span>
      </span>
    </span>
  );
}
