"use client";

/**
 * PublishAllDraftsCard
 *
 * One-click action to publish every DRAFT invoice in the tenant. Pairs with
 * the Bulk Generate workflow: after generating DRAFTs for a whole class, the
 * secretary reviews them, then publishes them all in one go without having
 * to tick checkboxes.
 *
 * Two scopes:
 *   * Whole tenant      — every DRAFT, regardless of term.
 *   * Current term only — narrows by term_number + academic_year so a
 *     previously-uncommitted DRAFT from a prior term isn't accidentally
 *     issued.
 *
 * The DRAFT count comes from /finance/invoices/drafts/count so the confirm
 * dialog can show a real number before committing. Publish itself uses the
 * all_drafts mode of /finance/invoices/publish/bulk so the snapshot is
 * atomic on the server, not assembled from a client-side list.
 */

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Send,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { currentTermIdentity, normalizeTerms } from "@/lib/school-setup/terms";
import { CollapsibleActionCard } from "@/components/finance/CollapsibleActionCard";

type Scope = "all" | "current-term";

type DraftCount = { count: number };

type PublishedRow = { invoice_id: string; invoice_no: string | null; after_status: string };
type PublishSkippedRow = { invoice_id: string; reason: string; current_status: string | null };
type PublishFailedRow = { invoice_id: string; reason: string; detail: string };
type BulkPublishResult = {
  summary: { total: number; published: number; skipped: number; failed: number };
  published: PublishedRow[];
  skipped: PublishSkippedRow[];
  failed: PublishFailedRow[];
};

type Props = {
  /** Called after a successful publish so the parent invoices table refreshes. */
  onPublished?: () => void;
};

const REASON_LABEL: Record<string, string> = {
  not_found: "Not found",
  not_draft: "Already issued",
  empty_invoice: "Empty invoice (no lines)",
  error: "Error",
};

export function PublishAllDraftsCard({ onPublished }: Props) {
  const [scope, setScope] = useState<Scope>("all");
  const [termNumber, setTermNumber] = useState<number | null>(null);
  const [academicYear, setAcademicYear] = useState<number | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<BulkPublishResult | null>(null);

  // Resolve current-term identity once.
  useEffect(() => {
    (async () => {
      try {
        const raw = await api.get<unknown>("/tenants/terms", {
          tenantRequired: true, noRedirect: true,
        });
        const ident = currentTermIdentity(normalizeTerms(raw));
        if (ident) {
          setTermNumber(ident.term_number);
          setAcademicYear(ident.academic_year);
        }
      } catch {
        /* current-term mode just won't be selectable until terms load */
      }
    })();
  }, []);

  async function refreshCount(nextScope: Scope = scope) {
    setCounting(true);
    try {
      const qs = new URLSearchParams();
      if (nextScope === "current-term" && termNumber != null && academicYear != null) {
        qs.set("term_number", String(termNumber));
        qs.set("academic_year", String(academicYear));
      }
      const url = `/finance/invoices/drafts/count${qs.toString() ? `?${qs}` : ""}`;
      const resp = await api.get<DraftCount>(url, { tenantRequired: true });
      setCount(resp?.count ?? 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load draft count");
      setCount(null);
    } finally {
      setCounting(false);
    }
  }

  // Refresh count when scope flips (or when term identity resolves).
  useEffect(() => {
    void refreshCount(scope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, termNumber, academicYear]);

  const currentTermReady =
    scope === "all" || (termNumber != null && academicYear != null);
  const nothingToPublish = count === 0;

  async function doPublish() {
    setPublishing(true);
    setResult(null);
    try {
      const body: Record<string, unknown> = { all_drafts: true };
      if (scope === "current-term" && termNumber != null && academicYear != null) {
        body.term_number = termNumber;
        body.academic_year = academicYear;
      }
      const resp = await api.post<BulkPublishResult>(
        "/finance/invoices/publish/bulk",
        body,
        { tenantRequired: true }
      );
      setResult(resp);
      setConfirming(false);
      const { published, skipped, failed } = resp.summary;
      if (published > 0) {
        toast.success(
          `Published ${published} invoice${published === 1 ? "" : "s"}` +
          (skipped > 0 || failed > 0 ? ` · ${skipped} skipped, ${failed} failed` : "")
        );
      } else if (failed > 0) {
        toast.error(`Failed to publish ${failed} invoice${failed === 1 ? "" : "s"}`);
      } else {
        toast.info("No drafts to publish");
      }
      onPublished?.();
      void refreshCount();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk publish failed");
    } finally {
      setPublishing(false);
    }
  }

  const headerBadge =
    count != null && count > 0 ? (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">
        {count} draft{count === 1 ? "" : "s"} ready
      </span>
    ) : count === 0 ? (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
        No drafts
      </span>
    ) : null;

  return (
    <CollapsibleActionCard
      title="Publish All Drafts"
      subtitle="Issue every DRAFT invoice in one action."
      icon={Send}
      badge={headerBadge}
    >
      <div className="mb-3 flex justify-end">
        <button
          onClick={() => void refreshCount()}
          disabled={counting}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-60"
        >
          {counting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Refresh
        </button>
      </div>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="publish-scope" className="text-xs uppercase tracking-wide text-slate-500">
              Scope
            </Label>
            <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
              <SelectTrigger id="publish-scope" className="w-full sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All drafts (every term)</SelectItem>
                <SelectItem
                  value="current-term"
                  disabled={termNumber == null || academicYear == null}
                >
                  Current term only{" "}
                  {termNumber != null && academicYear != null
                    ? `(T${termNumber} · ${academicYear})`
                    : "(loading…)"}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-2">
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">
                Drafts ready
              </div>
              <div className="text-2xl font-bold tabular-nums text-slate-800">
                {counting ? "—" : count ?? "—"}
              </div>
            </div>
          </div>
        </div>

        {/* Action */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          {!confirming ? (
            <Button
              onClick={() => setConfirming(true)}
              disabled={!currentTermReady || nothingToPublish || count == null}
              className="bg-[#173f49] text-white hover:bg-[#0f2f37]"
            >
              <Send className="mr-2 h-4 w-4" />
              {nothingToPublish ? "No drafts to publish" : `Publish ${count} draft${count === 1 ? "" : "s"}`}
            </Button>
          ) : (
            <div className="flex w-full flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2 text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="font-medium">
                    Issue {count} invoice{count === 1 ? "" : "s"} now?
                  </div>
                  <div className="text-xs text-amber-700">
                    DRAFTs become ISSUED and parents receive SMS notifications.
                    Per-row failures are reported and won't roll back the rest.
                  </div>
                </div>
              </div>
              <div className="flex gap-2 sm:shrink-0">
                <Button
                  variant="ghost"
                  onClick={() => setConfirming(false)}
                  disabled={publishing}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => void doPublish()}
                  disabled={publishing}
                  className="bg-[#173f49] text-white hover:bg-[#0f2f37]"
                >
                  {publishing
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    : <Send className="mr-2 h-4 w-4" />}
                  Confirm publish
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Result summary */}
        {result && (
          <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-1.5 text-sm text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                <span className="font-semibold tabular-nums">{result.summary.published}</span>
                <span>published</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm text-amber-700">
                <AlertTriangle className="h-4 w-4" />
                <span className="font-semibold tabular-nums">{result.summary.skipped}</span>
                <span>skipped</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm text-red-700">
                <XCircle className="h-4 w-4" />
                <span className="font-semibold tabular-nums">{result.summary.failed}</span>
                <span>failed</span>
              </div>
              <div className="ml-auto text-xs text-slate-400">
                Total {result.summary.total}
              </div>
            </div>

            {(result.skipped.length > 0 || result.failed.length > 0) && (
              <details className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
                <summary className="cursor-pointer font-medium text-slate-600">
                  Per-row outcomes
                </summary>
                <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
                  {result.skipped.map((r) => (
                    <div key={r.invoice_id} className="flex items-center justify-between gap-3 rounded bg-amber-50 px-2 py-1 text-amber-900">
                      <span className="font-mono text-[10px]">{r.invoice_id.slice(0, 8)}</span>
                      <span>{REASON_LABEL[r.reason] ?? r.reason}</span>
                      <span className="text-amber-700">{r.current_status ?? "—"}</span>
                    </div>
                  ))}
                  {result.failed.map((r) => (
                    <div key={r.invoice_id} className="flex items-center justify-between gap-3 rounded bg-red-50 px-2 py-1 text-red-900">
                      <span className="font-mono text-[10px]">{r.invoice_id.slice(0, 8)}</span>
                      <span>{REASON_LABEL[r.reason] ?? r.reason}</span>
                      <span className="truncate text-red-700">{r.detail}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </CollapsibleActionCard>
  );
}
