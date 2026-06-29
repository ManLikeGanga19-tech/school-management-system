"use client";

/**
 * BulkGenerateInvoicesCard
 *
 * Term-start workhorse for the secretary. One panel:
 *   Pick term + year (auto-filled from current term) + class (or all classes)
 *   → Preview (dry-run) → Generate Drafts → review per-row outcomes → Publish
 *   all generated drafts at once.
 *
 * Each created invoice lands as DRAFT (per Phase C lifecycle) so the
 * secretary reviews + publishes deliberately. The bulk-publish step fires
 * parent SMS on the published ones; nothing else moves.
 */

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Eye,
  Loader2,
  PlayCircle,
  Send,
  Sparkles,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { currentTermIdentity, normalizeTerms } from "@/lib/school-setup/terms";
import { CollapsibleActionCard } from "@/components/finance/CollapsibleActionCard";

// ── Types ────────────────────────────────────────────────────────────────────

type CreatedRow = {
  enrollment_id: string;
  student_id: string | null;
  student_name: string;
  class_code: string | null;
  invoice_id: string;
  invoice_no: string | null;
  total_amount: string;
  student_type: string | null;
  student_type_resolved_by: string | null;
};

type SkippedRow = {
  enrollment_id: string;
  student_name: string;
  class_code: string | null;
  reason: string;
  detail: string;
  existing_invoice_id: string | null;
};

type FailedRow = {
  enrollment_id: string;
  student_name: string;
  class_code: string | null;
  reason: string;
  detail: string;
};

type BulkSummary = {
  total: number;
  created: number;
  skipped: number;
  failed: number;
  term_number: number;
  academic_year: number;
  class_code: string | null;
  dry_run: boolean;
};

type BulkResult = {
  summary: BulkSummary;
  created: CreatedRow[];
  skipped: SkippedRow[];
  failed: FailedRow[];
};

type PublishedRow = {
  invoice_id: string;
  invoice_no: string | null;
  after_status: string;
};

type PublishSkippedRow = {
  invoice_id: string;
  invoice_no?: string | null;
  reason: string;
  current_status: string | null;
};

type PublishFailedRow = {
  invoice_id: string;
  reason: string;
  detail: string;
};

type BulkPublishResult = {
  summary: { total: number; published: number; skipped: number; failed: number };
  published: PublishedRow[];
  skipped: PublishSkippedRow[];
  failed: PublishFailedRow[];
};

type ClassOption = { code: string; name: string };

type Props = {
  /** Pre-fetched class list so the picker doesn't re-fetch. */
  classOptions: ClassOption[];
  /** Called after a successful commit so the parent invoices table refreshes. */
  onChanged?: () => void;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtKes(value: string | number): string {
  const n = parseFloat(String(value));
  if (Number.isNaN(n)) return "KES 0.00";
  return `KES ${n.toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const REASON_LABEL: Record<string, string> = {
  already_invoiced: "Already invoiced",
  no_class: "No class on file",
  no_structure: "No fee structure",
  no_chargeable_items: "No chargeable items",
  error: "Generation error",
  not_found: "Not found (cross-tenant?)",
  not_draft: "Not a draft",
  empty_invoice: "Empty invoice",
};

function reasonLabel(reason: string): string {
  return REASON_LABEL[reason] ?? reason;
}

// ── Component ────────────────────────────────────────────────────────────────

export function BulkGenerateInvoicesCard({ classOptions, onChanged }: Props) {
  const [term, setTerm] = useState<string>("");
  const [year, setYear] = useState<string>("");
  const [classCode, setClassCode] = useState<string>("__all__");
  const [previewing, setPreviewing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [publishResult, setPublishResult] = useState<BulkPublishResult | null>(null);

  // Pre-fill term + year from the tenant's current term identity. Fires once.
  useEffect(() => {
    (async () => {
      try {
        const raw = await api.get<unknown>("/tenants/terms", {
          tenantRequired: true,
          noRedirect: true,
        });
        const identity = currentTermIdentity(normalizeTerms(raw));
        if (identity) {
          setTerm(String(identity.term_number));
          setYear(String(identity.academic_year));
        } else {
          // Sensible fallback when no current term is tagged: T1 of the
          // current calendar year. The secretary can override either field.
          setTerm("1");
          setYear(String(new Date().getFullYear()));
        }
      } catch {
        setTerm("1");
        setYear(String(new Date().getFullYear()));
      }
    })();
  }, []);

  const canRun = useMemo(() => {
    if (!term || !year) return false;
    const t = parseInt(term, 10);
    const y = parseInt(year, 10);
    return t >= 1 && t <= 3 && y >= 2000 && y <= 2199;
  }, [term, year]);

  async function runBulk(dryRun: boolean) {
    if (!canRun) {
      toast.error("Pick a valid term and academic year first.");
      return;
    }
    const setBusy = dryRun ? setPreviewing : setGenerating;
    setBusy(true);
    setPublishResult(null);
    try {
      const body: Record<string, unknown> = {
        term_number: parseInt(term, 10),
        academic_year: parseInt(year, 10),
        dry_run: dryRun,
      };
      if (classCode !== "__all__") body.class_code = classCode;
      const data = await api.post<BulkResult>(
        "/finance/invoices/generate/fees/bulk",
        body,
        { tenantRequired: true },
      );
      setResult(data);
      if (dryRun) {
        toast.success(
          `Preview ready: ${data.summary.created} to create, ${data.summary.skipped} skipped, ${data.summary.failed} failed.`,
        );
      } else {
        toast.success(
          `Bulk generated: ${data.summary.created} drafts created. Review and publish below.`,
        );
        onChanged?.();
      }
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (err as { message?: string })?.message;
      toast.error(detail || "Bulk generation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function publishAll() {
    if (!result || result.created.length === 0) return;
    const ids = result.created.map((r) => r.invoice_id);
    setPublishing(true);
    try {
      const data = await api.post<BulkPublishResult>(
        "/finance/invoices/publish/bulk",
        { invoice_ids: ids },
        { tenantRequired: true },
      );
      setPublishResult(data);
      const { published, skipped, failed } = data.summary;
      toast.success(
        `Published ${published} invoice${published === 1 ? "" : "s"}` +
          (skipped ? `, skipped ${skipped}` : "") +
          (failed ? `, failed ${failed}` : "") +
          ".",
      );
      onChanged?.();
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (err as { message?: string })?.message;
      toast.error(detail || "Bulk publish failed.");
    } finally {
      setPublishing(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const sum = result?.summary;

  return (
    <CollapsibleActionCard
      title="Bulk Generate Fees Invoices"
      subtitle="Generate DRAFT invoices for every eligible student in a class."
      icon={Sparkles}
    >
      <div className="space-y-4">
        {/* ── Form ──────────────────────────────────────────────────── */}
        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs">Term</Label>
            <Select value={term} onValueChange={setTerm}>
              <SelectTrigger>
                <SelectValue placeholder="Select term" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Term 1</SelectItem>
                <SelectItem value="2">Term 2</SelectItem>
                <SelectItem value="3">Term 3</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Academic Year</Label>
            <Input
              type="number"
              min={2000}
              max={2199}
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="e.g. 2026"
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label className="text-xs">Class</Label>
            <Select value={classCode} onValueChange={setClassCode}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All eligible classes</SelectItem>
                {classOptions.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.name} ({c.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => void runBulk(true)}
            disabled={!canRun || previewing || generating}
          >
            {previewing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
            {previewing ? "Previewing…" : "Preview (dry-run)"}
          </Button>
          <Button
            onClick={() => void runBulk(false)}
            disabled={!canRun || previewing || generating}
          >
            {generating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PlayCircle className="h-3.5 w-3.5" />
            )}
            {generating ? "Generating…" : "Generate Drafts"}
          </Button>
          <p className="ml-auto text-[11px] text-slate-400">
            Preview runs the same logic but persists nothing.
          </p>
        </div>

        {/* ── Summary ─────────────────────────────────────────────────── */}
        {sum && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <SummaryStat label="Eligible" value={sum.total} tone="neutral" />
            <SummaryStat label="Created" value={sum.created} tone="success" />
            <SummaryStat label="Skipped" value={sum.skipped} tone="warn" />
            <SummaryStat label="Failed" value={sum.failed} tone="danger" />
          </div>
        )}

        {sum?.dry_run && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-xs text-blue-800">
            This was a preview — nothing was persisted. Click <strong>Generate
            Drafts</strong> to commit the same result.
          </div>
        )}

        {result && result.created.length > 0 && (
          <OutcomeTable
            title={`Created (${result.created.length})`}
            tone="success"
            rows={result.created.map((r) => ({
              key: r.invoice_id,
              left: r.student_name,
              middle: r.class_code || "—",
              right: fmtKes(r.total_amount),
              meta: r.student_type
                ? `${r.student_type} · ${r.student_type_resolved_by ?? "—"}`
                : "",
              invoice: r.invoice_no,
            }))}
          />
        )}

        {result && result.skipped.length > 0 && (
          <OutcomeTable
            title={`Skipped (${result.skipped.length})`}
            tone="warn"
            rows={result.skipped.map((r) => ({
              key: r.enrollment_id,
              left: r.student_name,
              middle: r.class_code || "—",
              right: reasonLabel(r.reason),
              meta: r.detail,
              invoice: null,
            }))}
          />
        )}

        {result && result.failed.length > 0 && (
          <OutcomeTable
            title={`Failed (${result.failed.length})`}
            tone="danger"
            rows={result.failed.map((r) => ({
              key: r.enrollment_id,
              left: r.student_name,
              middle: r.class_code || "—",
              right: reasonLabel(r.reason),
              meta: r.detail,
              invoice: null,
            }))}
          />
        )}

        {/* ── Publish all drafts (only when we have committed creations) ── */}
        {result && !result.summary.dry_run && result.created.length > 0 && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-900">
                  <Users className="h-4 w-4" />
                  {result.created.length} draft{result.created.length === 1 ? "" : "s"} ready to publish
                </p>
                <p className="mt-0.5 text-xs text-emerald-800">
                  Publishing flips DRAFT → ISSUED, makes the invoices visible to
                  parents, and fires SMS notifications. Review the list above
                  first.
                </p>
              </div>
              <Button onClick={() => void publishAll()} disabled={publishing}>
                {publishing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                {publishing ? "Publishing…" : "Publish All Drafts"}
              </Button>
            </div>
          </div>
        )}

        {publishResult && (
          <div className="rounded-xl border border-slate-100 bg-slate-50/40 p-4 text-xs">
            <p className="font-semibold text-slate-800">
              Publish result:{" "}
              <span className="text-emerald-700">{publishResult.summary.published} published</span>
              {publishResult.summary.skipped > 0 && (
                <span className="text-amber-700">, {publishResult.summary.skipped} skipped</span>
              )}
              {publishResult.summary.failed > 0 && (
                <span className="text-red-700">, {publishResult.summary.failed} failed</span>
              )}
            </p>
            {(publishResult.skipped.length > 0 || publishResult.failed.length > 0) && (
              <ul className="mt-2 space-y-1">
                {publishResult.skipped.map((r) => (
                  <li key={r.invoice_id} className="text-amber-800">
                    • {r.invoice_no || r.invoice_id.slice(0, 8)} — {reasonLabel(r.reason)}
                    {r.current_status ? ` (currently ${r.current_status})` : ""}
                  </li>
                ))}
                {publishResult.failed.map((r) => (
                  <li key={r.invoice_id} className="text-red-800">
                    • {r.invoice_id.slice(0, 8)} — {reasonLabel(r.reason)}: {r.detail}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </CollapsibleActionCard>
  );
}

// ── Small subcomponents ─────────────────────────────────────────────────────

function SummaryStat({
  label, value, tone,
}: {
  label: string; value: number; tone: "neutral" | "success" | "warn" | "danger";
}) {
  const toneCls =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : tone === "danger"
          ? "border-red-200 bg-red-50 text-red-800"
          : "border-slate-200 bg-slate-50 text-slate-800";
  return (
    <div className={`rounded-xl border px-3 py-2 ${toneCls}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-bold">{value}</div>
    </div>
  );
}

function OutcomeTable({
  title, tone, rows,
}: {
  title: string;
  tone: "success" | "warn" | "danger";
  rows: {
    key: string;
    left: string;
    middle: string;
    right: string;
    meta: string;
    invoice: string | null;
  }[];
}) {
  const headerCls =
    tone === "success"
      ? "bg-emerald-50 text-emerald-900"
      : tone === "warn"
        ? "bg-amber-50 text-amber-900"
        : "bg-red-50 text-red-900";
  const Icon =
    tone === "success" ? CheckCircle2 : tone === "warn" ? AlertTriangle : AlertCircle;
  return (
    <div className="rounded-xl border border-slate-100 overflow-hidden">
      <div className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold ${headerCls}`}>
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50">
            <TableHead className="text-xs">Student</TableHead>
            <TableHead className="text-xs">Class</TableHead>
            <TableHead className="text-xs">Result</TableHead>
            <TableHead className="text-xs">Invoice</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell className="text-sm font-medium text-slate-800">
                {r.left}
              </TableCell>
              <TableCell className="text-xs text-slate-600">{r.middle}</TableCell>
              <TableCell className="text-xs">
                <div className="font-semibold text-slate-800">{r.right}</div>
                {r.meta && <div className="text-[11px] text-slate-500">{r.meta}</div>}
              </TableCell>
              <TableCell className="font-mono text-xs text-blue-700">
                {r.invoice || "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
