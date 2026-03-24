"use client";

/**
 * Reusable React Error Boundary for wrapping page sections.
 *
 * Usage — wrap any client component that might throw independently:
 *
 *   <ErrorBoundary>
 *     <FinanceTable />
 *   </ErrorBoundary>
 *
 * Custom fallback:
 *
 *   <ErrorBoundary fallback={<p>Could not load this section.</p>}>
 *     <HeavyChart />
 *   </ErrorBoundary>
 *
 * Next.js App Router already provides file-based error boundaries via
 * error.tsx. Use this class component when you need finer-grained
 * boundaries within a single page — e.g., a finance table that should
 * fail in isolation without crashing the whole page chrome.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  /** Custom fallback UI. If omitted, a default recovery card is shown. */
  fallback?: ReactNode;
  /** Called when an error is caught — use for error reporting (e.g. Sentry). */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/** Inline recovery fallback used when no custom fallback is provided. */
function DefaultSectionFallback({
  error,
  onReset,
}: {
  error: Error;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center">
      <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden />
      <div className="space-y-1">
        <p className="text-sm font-medium text-destructive">
          Something went wrong in this section
        </p>
        <p className="text-xs text-muted-foreground">
          {error.message || "An unexpected error occurred."}
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={onReset}>
        <RefreshCw className="mr-2 h-3 w-3" />
        Try again
      </Button>
    </div>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log to console in dev; swap this for your error reporting service
    // (Sentry, Datadog RUM, etc.) when you have one wired up.
    console.error("[ErrorBoundary] Uncaught error:", error, info.componentStack);
    this.props.onError?.(error, info);
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      if (this.props.fallback != null) {
        return this.props.fallback;
      }
      return (
        <DefaultSectionFallback error={this.state.error!} onReset={this.reset} />
      );
    }
    return this.props.children;
  }
}
