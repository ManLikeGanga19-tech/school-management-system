"use client";

/**
 * BulkApplyScholarshipCard — director-only action mounted on the
 * Scholarships page. Apply one scholarship to every student in a class
 * for a given term + year in one click.
 *
 * Two-step UX:
 *   1. Preview  → calls /scholarships/{id}/bulk-apply with dry_run=true
 *      and renders the per-row outcome (applied / skipped / failed) without
 *      persisting anything.
 *   2. Confirm  → re-fires the same call with dry_run=false. Atomic — per-row
 *      savepoints in the backend mean a single bad row never aborts the rest.
 *
 * Skip-on-conflict: students whose invoice already has an ACTIVE scholarship
 * surface as `already_has_scholarship` and are left untouched.
 */

import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  Loader2,
  Sparkles,
  XCircle,
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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { currentTermIdentity, normalizeTerms } from "@/lib/school-setup/terms";
import { CollapsibleActionCard } from "@/components/finance/CollapsibleActionCard";
import type { Scholarship } from "@/components/finance/finance-utils";

type AppliedRow = {
  invoice_id: string;
  invoice_no: string | null;
  student_name: string;
  amount: string;
};
type SkippedRow = {
  invoice_id: string;
  invoice_no: string | null;
  student_name: string;
  reason: string;
};
type FailedRow = SkippedRow & { detail: string };

type BulkApplyResult = {
  summary: {
    total: number;
    applied: number;
    skipped: number;
    failed: number;
    dry_run: boolean;
    class_code: string;
    term_number: number;
    academic_year: number;
  };
  applied: AppliedRow[];
  skipped: SkippedRow[];
  failed: FailedRow[];
};

type Props = {
  scholarships: Scholarship[];
  classOptions: { code: string; name: string }[];
  onApplied?: () => void;
};

const REASON_LABEL: Record<string, string> = {
  already_has_scholarship: "Already has scholarship",
  paid: "Already paid",
  cancelled: "Cancelled invoice",
  no_invoice: "No invoice for term",
  validation_error: "Validation failed",
  error: "Error",
};

export function BulkApplyScholarshipCard({
  scholarships,
  classOptions,
  onApplied,
}: Props) {
  const [scholarshipId, setScholarshipId] = useState<string>("");
  const [classCode, setClassCode] = useState<string>("");
  const [termNumber, setTermNumber] = useState<string>("");
  const [academicYear, setAcademicYear] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<BulkApplyResult | null>(null);

  // Pre-fill term + year from the current term identity.
  useEffect(() => {
    (async () => {
      try {
        const raw = await api.get<unknown>("/tenants/terms", {
          tenantRequired: true, noRedirect: true,
        });
        const ident = currentTermIdentity(normalizeTerms(raw));
        if (ident) {
          setTermNumber(String(ident.term_number));
          setAcademicYear(String(ident.academic_year));
        }
      } catch {
        /* manual entry still works */
      }
    })();
  }, []);

  const activeScholarships = scholarships.filter((s) => s.is_active);

  function readyToSubmit(): boolean {
    return Boolean(
      scholarshipId && classCode && termNumber && academicYear && reason.trim()
    );
  }

  async function call(dryRun: boolean): Promise<BulkApplyResult | null> {
    try {
      return await api.post<BulkApplyResult>(
        `/finance/scholarships/${scholarshipId}/bulk-apply`,
        {
          class_code: classCode,
          term_number: Number(termNumber),
          academic_year: Number(academicYear),
          reason: reason.trim(),
          dry_run: dryRun,
        },
        { tenantRequired: true },
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk apply failed");
      return null;
    }
  }

  async function doPreview() {
    if (!readyToSubmit()) {
      toast.error("Pick a scholarship, class, term, year, and reason first.");
      return;
    }
    setPreviewing(true);
    setResult(null);
    const res = await call(true);
    if (res) setResult(res);
    setPreviewing(false);
  }

  async function doApply() {
    if (!readyToSubmit()) return;
    setApplying(true);
    const res = await call(false);
    if (res) {
      setResult(res);
      const { applied, skipped, failed } = res.summary;
      if (applied > 0) {
        toast.success(
          `Applied to ${applied} student${applied === 1 ? "" : "s"}` +
          (skipped + failed > 0 ? ` · ${skipped} skipped, ${failed} failed` : "")
        );
      } else {
        toast.info("Nothing to apply — every eligible invoice was skipped.");
      }
      onApplied?.();
    }
    setApplying(false);
  }

  return (
    <CollapsibleActionCard
      title="Bulk Apply to a Class"
      subtitle="Director — apply this scholarship to every student in a class for the chosen term."
      icon={Sparkles}
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Scholarship</Label>
            <Select value={scholarshipId} onValueChange={setScholarshipId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a scholarship" />
              </SelectTrigger>
              <SelectContent>
                {activeScholarships.length === 0 && (
                  <div className="px-2 py-1 text-xs text-slate-400">
                    No active scholarships
                  </div>
                )}
                {activeScholarships.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} · {s.type.replace(/_/g, " ").toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Class</Label>
            <Select value={classCode} onValueChange={setClassCode}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a class" />
              </SelectTrigger>
              <SelectContent>
                {classOptions.length === 0 && (
                  <div className="px-2 py-1 text-xs text-slate-400">
                    No classes loaded
                  </div>
                )}
                {classOptions.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.name} ({c.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Term</Label>
            <Select value={termNumber} onValueChange={setTermNumber}>
              <SelectTrigger>
                <SelectValue placeholder="Term" />
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
              type="number" min={2000} max={2199}
              placeholder="e.g. 2026"
              value={academicYear}
              onChange={(e) => setAcademicYear(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Reason (audit)</Label>
          <Textarea
            rows={2}
            placeholder="Why is this scholarship being applied class-wide?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="outline"
            disabled={previewing || applying || !readyToSubmit()}
            onClick={() => void doPreview()}
          >
            {previewing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Eye className="mr-2 h-4 w-4" />
            )}
            Preview
          </Button>
          <Button
            disabled={applying || previewing || !readyToSubmit()}
            onClick={() => void doApply()}
            className="bg-[#173f49] text-white hover:bg-[#0f2f37]"
          >
            {applying ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            Apply
          </Button>
        </div>

        {result && (
          <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <div className="flex flex-wrap items-center gap-4 text-sm">
              {result.summary.dry_run && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                  Preview — nothing persisted
                </span>
              )}
              <div className="flex items-center gap-1.5 text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                <span className="font-semibold tabular-nums">{result.summary.applied}</span>
                <span>applied</span>
              </div>
              <div className="flex items-center gap-1.5 text-amber-700">
                <AlertCircle className="h-4 w-4" />
                <span className="font-semibold tabular-nums">{result.summary.skipped}</span>
                <span>skipped</span>
              </div>
              <div className="flex items-center gap-1.5 text-red-700">
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
                <div className="mt-2 max-h-72 space-y-1 overflow-y-auto">
                  {result.skipped.map((r) => (
                    <div key={r.invoice_id} className="flex items-center justify-between gap-3 rounded bg-amber-50 px-2 py-1 text-amber-900">
                      <span className="truncate font-medium">{r.student_name}</span>
                      <span>{REASON_LABEL[r.reason] ?? r.reason}</span>
                    </div>
                  ))}
                  {result.failed.map((r) => (
                    <div key={r.invoice_id} className="flex items-center justify-between gap-3 rounded bg-red-50 px-2 py-1 text-red-900">
                      <span className="truncate font-medium">{r.student_name}</span>
                      <span className="truncate" title={r.detail}>
                        {REASON_LABEL[r.reason] ?? r.reason}
                      </span>
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
