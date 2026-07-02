"use client";

/**
 * GrantScholarshipDialog — pick a student, grant this scholarship to them.
 *
 * Phase M2 entry point on the ScholarshipsPage. Calls
 * POST /finance/students/{studentId}/scholarship-grants which
 *   - validates the scholarship + student + duplicate + max_recipients
 *   - optionally applies to open matching invoices immediately
 *     (apply_to_existing_open_invoices, default TRUE)
 *
 * Enterprise-grade guards implemented in the backend, this dialog just
 * surfaces them: error messages come back with 400s, we toast them
 * verbatim so the operator sees exactly what happened. No silent failures.
 */

import { useEffect, useMemo, useState } from "react";
import { Loader2, GraduationCap, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import type { Scholarship } from "@/components/finance/finance-utils";

type StudentOption = {
  student_id: string;
  admission_no: string;
  name: string;
};

type Props = {
  open: boolean;
  scholarship: Scholarship | null;
  onClose: () => void;
  onGranted?: () => void;
};

type ApplicationSummary = {
  total: number;
  applied: { invoice_id: string; invoice_no?: string | null }[];
  skipped: { invoice_id: string; reason: string }[];
  failed: { invoice_id: string; reason: string; detail: string }[];
} | null;

export function GrantScholarshipDialog({
  open,
  scholarship,
  onClose,
  onGranted,
}: Props) {
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentId, setStudentId] = useState<string>("");
  const [q, setQ] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [year, setYear] = useState<string>("");
  const [term, setTerm] = useState<string>("__all__");
  const [applyExisting, setApplyExisting] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState(false);
  const [lastSummary, setLastSummary] = useState<ApplicationSummary>(null);

  // Reset when dialog opens against a different scholarship.
  useEffect(() => {
    if (open) {
      setStudentId("");
      setQ("");
      setReason("");
      setYear("");
      setTerm("__all__");
      setApplyExisting(true);
      setLastSummary(null);
    }
  }, [open, scholarship?.id]);

  // Track whether enrollments exist but none are linked to SIS students —
  // gives us a clearer empty-state message than "no students match".
  const [unlinkedCount, setUnlinkedCount] = useState(0);

  // Lazily load enrollments the first time the dialog opens.
  useEffect(() => {
    if (!open || students.length > 0) return;
    let cancelled = false;
    (async () => {
      setStudentsLoading(true);
      try {
        // Reuse the enrollments listing that all finance pages already
        // populate — a single-payload fetch that we then filter locally.
        const raw = await api.get<unknown>(
          "/tenants/director/finance",
          { tenantRequired: true, noRedirect: true },
        );
        const obj = raw as { enrollments?: unknown[] } | null;
        const rawList = Array.isArray(obj?.enrollments) ? obj?.enrollments : [];
        const opts: StudentOption[] = [];
        let unlinked = 0;
        for (const row of rawList as Array<Record<string, unknown>>) {
          const sid = row.student_id != null ? String(row.student_id) : "";
          if (!sid) {
            unlinked += 1;
            continue;
          }
          const payload = (row.payload ?? {}) as Record<string, unknown>;
          const name =
            String(payload.student_name ?? payload.full_name ?? payload.name ?? "") ||
            "Unknown student";
          const adm = String(
            payload.admission_no ?? payload.admission_number ?? row.admission_number ?? "",
          );
          if (!opts.some((o) => o.student_id === sid)) {
            opts.push({ student_id: sid, admission_no: adm, name });
          }
        }
        opts.sort((a, b) => a.name.localeCompare(b.name));
        if (!cancelled) {
          setStudents(opts);
          setUnlinkedCount(unlinked);
        }
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Failed to load students");
      } finally {
        if (!cancelled) setStudentsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, students.length]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return students.slice(0, 100);
    return students
      .filter((s) =>
        `${s.name} ${s.admission_no}`.toLowerCase().includes(query),
      )
      .slice(0, 100);
  }, [students, q]);

  async function submit() {
    if (!scholarship) return;
    if (!studentId) {
      toast.error("Pick a student to grant to.");
      return;
    }
    if (!reason.trim()) {
      toast.error("A reason is required for audit.");
      return;
    }
    const body: Record<string, unknown> = {
      scholarship_id: scholarship.id,
      reason: reason.trim(),
      apply_to_existing_open_invoices: applyExisting,
    };
    if (year.trim()) {
      const y = Number(year);
      if (!Number.isFinite(y) || y < 2000 || y > 2999) {
        toast.error("Academic year is out of range.");
        return;
      }
      body.academic_year = y;
    }
    if (term !== "__all__") body.term_number = Number(term);

    setSubmitting(true);
    try {
      const resp = await api.post<{
        grant: unknown;
        application_summary: ApplicationSummary;
      }>(
        `/finance/students/${studentId}/scholarship-grants`,
        body,
        { tenantRequired: true },
      );
      const summary = resp?.application_summary ?? null;
      setLastSummary(summary);
      const applied = summary?.applied.length ?? 0;
      const skipped = summary?.skipped.length ?? 0;
      const failed = summary?.failed.length ?? 0;
      toast.success(
        applied || skipped || failed
          ? `Grant created · ${applied} applied, ${skipped} skipped, ${failed} failed`
          : "Grant created.",
      );
      onGranted?.();
      if (!(failed || skipped)) {
        // Clean close only when nothing needs the operator's attention.
        onClose();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to grant scholarship");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GraduationCap className="h-4 w-4 text-[#173f49]" />
            Grant to Student
          </DialogTitle>
          <DialogDescription>
            Attach{" "}
            <strong className="text-slate-800">{scholarship?.name ?? ""}</strong>{" "}
            to a student. Every subsequent invoice generated for them will
            inherit the discount. Optional scope narrows it to a specific
            term or year.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Student</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <Input
                placeholder="Search by name or admission no…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-7"
              />
            </div>
            <div className="max-h-40 overflow-y-auto rounded-md border border-slate-100">
              {studentsLoading ? (
                <div className="flex items-center justify-center gap-2 py-4 text-xs text-slate-400">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading students…
                </div>
              ) : filtered.length === 0 ? (
                <div className="py-4 text-center text-xs text-slate-400">
                  {students.length === 0 && unlinkedCount > 0 ? (
                    <>
                      {unlinkedCount} enrollment{unlinkedCount === 1 ? "" : "s"} found,
                      but none are linked to a SIS student yet. Link them
                      first to grant scholarships.
                    </>
                  ) : students.length === 0 ? (
                    <>No enrolled students yet.</>
                  ) : (
                    <>No students match this search.</>
                  )}
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {filtered.map((s) => (
                    <li key={s.student_id}>
                      <button
                        type="button"
                        onClick={() => setStudentId(s.student_id)}
                        className={
                          "flex w-full items-center justify-between px-3 py-2 text-left text-xs transition " +
                          (studentId === s.student_id
                            ? "bg-emerald-50 font-medium text-emerald-900"
                            : "hover:bg-slate-50 text-slate-700")
                        }
                      >
                        <span className="truncate">{s.name}</span>
                        <span className="ml-2 font-mono text-[10px] text-slate-400">
                          {s.admission_no || "—"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Academic year (optional)</Label>
              <Input
                type="number"
                placeholder="e.g. 2026"
                min={2000}
                max={2999}
                value={year}
                onChange={(e) => setYear(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Term (optional)</Label>
              <Select value={term} onValueChange={setTerm}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All terms</SelectItem>
                  <SelectItem value="1">Term 1</SelectItem>
                  <SelectItem value="2">Term 2</SelectItem>
                  <SelectItem value="3">Term 3</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Reason (audit)</Label>
            <Textarea
              rows={2}
              placeholder="Why is this scholarship being granted?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <label className="flex items-start gap-2 rounded-md border border-slate-100 bg-slate-50/50 px-3 py-2 text-xs">
            <input
              type="checkbox"
              checked={applyExisting}
              onChange={(e) => setApplyExisting(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600"
            />
            <span className="text-slate-700">
              Apply immediately to this student's open invoices matching the
              scope
              <span className="mt-0.5 block text-[11px] text-slate-500">
                Uses the overpayment-credit path if the parent already paid
                more than the new total (no negative balances).
              </span>
            </span>
          </label>

          {lastSummary && (lastSummary.skipped.length > 0 || lastSummary.failed.length > 0) && (
            <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <div className="font-semibold">Per-invoice outcome</div>
              {lastSummary.applied.length > 0 && (
                <div>{lastSummary.applied.length} applied</div>
              )}
              {lastSummary.skipped.length > 0 && (
                <div>
                  {lastSummary.skipped.length} skipped:{" "}
                  {lastSummary.skipped.map((r) => r.reason).join(", ")}
                </div>
              )}
              {lastSummary.failed.length > 0 && (
                <div className="text-red-700">
                  {lastSummary.failed.length} failed:{" "}
                  {lastSummary.failed.map((f) => f.detail).join("; ")}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Close
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={submitting || !studentId}
            className="bg-[#173f49] text-white hover:bg-[#0f2f37]"
          >
            {submitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <GraduationCap className="mr-2 h-4 w-4" />
            )}
            Grant
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
