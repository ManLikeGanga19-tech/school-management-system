"use client";

/**
 * Global error boundary (Next.js App Router).
 *
 * This is the last line of defence — it catches errors thrown inside the root
 * layout itself (app/layout.tsx), which error.tsx cannot catch because it is
 * a sibling, not a parent.
 *
 * IMPORTANT: global-error.tsx replaces the root layout when active, so it
 * MUST render its own <html> and <body> tags.  Keep it minimal — no third-
 * party providers, no fonts, no complex imports.  If it throws, there is no
 * boundary left to catch it.
 */

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalError boundary]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1.5rem",
          padding: "1.5rem",
          textAlign: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#fff",
          color: "#111",
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#dc2626"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>

        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: "0 0 0.5rem" }}>
            Critical application error
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#666", margin: 0, maxWidth: "28rem" }}>
            A critical error occurred and the application could not recover.
            Please reload the page.
          </p>
        </div>

        {error.digest && (
          <code
            style={{
              fontSize: "0.75rem",
              background: "#f4f4f5",
              padding: "0.375rem 0.75rem",
              borderRadius: "0.375rem",
              color: "#666",
            }}
          >
            Reference: {error.digest}
          </code>
        )}

        <button
          onClick={reset}
          style={{
            padding: "0.5rem 1.25rem",
            background: "#111",
            color: "#fff",
            border: "none",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
