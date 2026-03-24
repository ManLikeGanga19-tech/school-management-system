"use client";

/**
 * Authenticated-app error boundary (Next.js App Router).
 *
 * Catches unhandled errors thrown in any route under (app)/ that are not
 * caught by a more specific error.tsx nested deeper in the tree.
 *
 * This file is automatically treated as a React Error Boundary by Next.js —
 * it receives `error` and `reset` as props, must be a Client Component, and
 * must NOT import Server Components.
 *
 * error.digest
 *   Next.js generates a short hash for server-side errors. Surface it to the
 *   user so they can quote it when contacting support, and so ops can search
 *   for it in structured logs.
 */

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to console in dev; replace with your error reporting service
    // (Sentry, Datadog RUM, etc.) before going to production.
    console.error("[AppError boundary]", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background p-6 text-center">
      {/* Icon */}
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden />
      </div>

      {/* Heading */}
      <div className="max-w-md space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Something went wrong
        </h1>
        <p className="text-sm text-muted-foreground">
          An unexpected error occurred. Your data is safe — this is a display
          error, not a data loss event. Try refreshing or navigate back to the
          dashboard.
        </p>
      </div>

      {/* Correlation ID — lets support match this to a backend log entry */}
      {error.digest && (
        <p className="rounded-md bg-muted px-3 py-1.5 font-mono text-xs text-muted-foreground">
          Reference: {error.digest}
        </p>
      )}

      {/* Recovery actions */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button onClick={reset} variant="default">
          <RefreshCw className="mr-2 h-4 w-4" />
          Try again
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard">
            <Home className="mr-2 h-4 w-4" />
            Back to dashboard
          </Link>
        </Button>
      </div>
    </div>
  );
}
