"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  BookOpenCheck,
  BookOpenText,
  ClipboardList,
  Download,
  FileBarChart,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  X,
} from "lucide-react";

import { AppShell, type AppNavItem } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { api, apiFetch } from "@/lib/api";
import { normalizeTerms, type TenantTerm } from "@/lib/school-setup/terms";
import { normalizeClassOptions, type TenantClassOption } from "@/lib/hr";
import { normalizeEnrollmentRows, studentName, type EnrollmentRow } from "@/lib/students";

// ── Types ──────────────────────────────────────────────────────────────────────

type IgcseSubject = {
  id: string;
  name: string;
  code: string;
  display_order: number;
  is_active: boolean;
};

type ScoreRow = {
  subject_id: string;
  grade: string;
  percentage: string;
  effort: string;
  teacher_comment: string;
};

const VALID_GRADES = ["A*", "A", "B", "C", "D", "E", "F", "G", "U", ""];
const EFFORT_OPTIONS = ["", "5", "4", "3", "2", "1"];

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function asStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function asBool(v: unknown): boolean {
  return Boolean(v);
}

function normalizeSubjects(raw: unknown): IgcseSubject[] {
  return asArray(raw)
    .map((r) => {
      const o = asObject(r);
      if (!o) return null;
      return {
        id: asStr(o.id),
        name: asStr(o.name),
        code: asStr(o.code),
        display_order: Number(o.display_order ?? 0),
        is_active: asBool(o.is_active),
      };
    })
    .filter((s): s is IgcseSubject => Boolean(s?.id));
}

// ── Main Component ─────────────────────────────────────────────────────────────

type Props = {
  title: string;
  nav: AppNavItem[];
  canManageSubjects?: boolean;
};

export function IgcseModulePage({ title, nav, canManageSubjects = false }: Props) {
  const params = useSearchParams();
  const section = (params?.get("section") || "assessments") as "assessments" | "subjects" | "reports";

  const [subjects, setSubjects] = useState<IgcseSubject[]>([]);
  const [terms, setTerms] = useState<TenantTerm[]>([]);
  const [classes, setClasses] = useState<TenantClassOption[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingEnrollments, setLoadingEnrollments] = useState(false);

  // Assessment entry state
  const [selectedTermId, setSelectedTermId] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState("");
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  // Subject dialog state
  const [subjectDialog, setSubjectDialog] = useState<{ open: boolean; editing: IgcseSubject | null }>({
    open: false,
    editing: null,
  });
  const [subjectForm, setSubjectForm] = useState({ name: "", code: "", display_order: "0" });
  const [savingSubject, setSavingSubject] = useState(false);

  const loadBase = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [rawSubjects, rawTerms, rawClasses] = await Promise.all([
        api.get<unknown>("/igcse/subjects?active_only=false", { tenantRequired: true }),
        api.get<unknown>("/tenants/terms", { tenantRequired: true }),
        api.get<unknown>("/tenants/classes", { tenantRequired: true }),
      ]);
      setSubjects(normalizeSubjects(rawSubjects));
      setTerms(normalizeTerms(rawTerms));
      setClasses(normalizeClassOptions(rawClasses));
    } catch {
      toast.error("Failed to load IGCSE data.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { void loadBase(); }, [loadBase]);

  // Build score rows when subjects or enrollment changes
  useEffect(() => {
    if (!selectedEnrollmentId) {
      setScores(
        subjects
          .filter((s) => s.is_active)
          .map((s) => ({ subject_id: s.id, grade: "", percentage: "", effort: "", teacher_comment: "" }))
      );
      return;
    }
    // Load existing scores for this enrollment+term
    async function loadScores() {
      try {
        const raw = await api.get<unknown>(
          `/igcse/scores?enrollment_id=${selectedEnrollmentId}&term_id=${selectedTermId}`,
          { tenantRequired: true }
        );
        const existing = new Map<string, Record<string, unknown>>();
        for (const r of asArray(raw)) {
          const o = asObject(r);
          if (o) existing.set(asStr(o.subject_id), o);
        }
        setScores(
          subjects
            .filter((s) => s.is_active)
            .map((s) => {
              const ex = existing.get(s.id);
              return {
                subject_id: s.id,
                grade: ex ? asStr(ex.grade) : "",
                percentage: ex && ex.percentage != null ? String(ex.percentage) : "",
                effort: ex ? asStr(ex.effort) : "",
                teacher_comment: ex ? asStr(ex.teacher_comment) : "",
              };
            })
        );
      } catch {
        // Reset
        setScores(subjects.filter((s) => s.is_active).map((s) => ({ subject_id: s.id, grade: "", percentage: "", effort: "", teacher_comment: "" })));
      }
    }
    if (selectedTermId) void loadScores();
  }, [selectedEnrollmentId, selectedTermId, subjects]);

  // Load enrollments when class+term selected
  useEffect(() => {
    if (!selectedClassId || !selectedTermId) {
      setEnrollments([]);
      setSelectedEnrollmentId("");
      return;
    }
    setLoadingEnrollments(true);
    api
      .get<unknown>(`/students/enrollments?class_id=${selectedClassId}&term_id=${selectedTermId}`, {
        tenantRequired: true,
      })
      .then((raw) => setEnrollments(normalizeEnrollmentRows(raw)))
      .catch(() => setEnrollments([]))
      .finally(() => setLoadingEnrollments(false));
  }, [selectedClassId, selectedTermId]);

  async function saveScores() {
    if (!selectedEnrollmentId || !selectedTermId) {
      toast.error("Select a student and term first.");
      return;
    }
    setSaving(true);
    try {
      await apiFetch("/igcse/scores", {
        method: "PUT",
        tenantRequired: true,
        body: JSON.stringify({
          enrollment_id: selectedEnrollmentId,
          term_id: selectedTermId,
          scores: scores.map((s) => ({
            subject_id: s.subject_id,
            grade: s.grade || null,
            percentage: s.percentage ? parseFloat(s.percentage) : null,
            effort: s.effort || null,
            teacher_comment: s.teacher_comment || null,
          })),
        }),
      });
      toast.success("Scores saved.");
    } catch {
      toast.error("Failed to save scores.");
    } finally {
      setSaving(false);
    }
  }

  async function downloadPdf() {
    if (!selectedEnrollmentId || !selectedTermId) {
      toast.error("Select a student and term first.");
      return;
    }
    setDownloadingPdf(true);
    try {
      const { apiFetchRaw } = await import("@/lib/api");
      const res = await apiFetchRaw(
        `/igcse/enrollments/${selectedEnrollmentId}/term/${selectedTermId}/pdf`,
        { method: "GET", tenantRequired: true }
      );
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `igcse_report_${selectedEnrollmentId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Failed to download PDF.");
    } finally {
      setDownloadingPdf(false);
    }
  }

  function openCreateSubject() {
    setSubjectForm({ name: "", code: "", display_order: "0" });
    setSubjectDialog({ open: true, editing: null });
  }

  function openEditSubject(s: IgcseSubject) {
    setSubjectForm({ name: s.name, code: s.code, display_order: String(s.display_order) });
    setSubjectDialog({ open: true, editing: s });
  }

  async function saveSubject() {
    if (!subjectForm.name.trim() || !subjectForm.code.trim()) {
      toast.error("Name and code are required.");
      return;
    }
    setSavingSubject(true);
    try {
      const { editing } = subjectDialog;
      if (editing) {
        await apiFetch(`/igcse/subjects/${editing.id}`, {
          method: "PATCH",
          tenantRequired: true,
          body: JSON.stringify({
            name: subjectForm.name.trim(),
            code: subjectForm.code.trim().toUpperCase(),
            display_order: parseInt(subjectForm.display_order) || 0,
          }),
        });
      } else {
        await apiFetch("/igcse/subjects", {
          method: "POST",
          tenantRequired: true,
          body: JSON.stringify({
            name: subjectForm.name.trim(),
            code: subjectForm.code.trim().toUpperCase(),
            display_order: parseInt(subjectForm.display_order) || 0,
          }),
        });
      }
      toast.success(editing ? "Subject updated." : "Subject created.");
      setSubjectDialog({ open: false, editing: null });
      void loadBase(true);
    } catch {
      toast.error("Failed to save subject.");
    } finally {
      setSavingSubject(false);
    }
  }

  async function toggleSubjectActive(s: IgcseSubject) {
    try {
      await apiFetch(`/igcse/subjects/${s.id}`, {
        method: "PATCH",
        tenantRequired: true,
        body: JSON.stringify({ is_active: !s.is_active }),
      });
      void loadBase(true);
    } catch {
      toast.error("Failed to update subject.");
    }
  }

  function updateScore(idx: number, field: keyof ScoreRow, value: string) {
    setScores((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }

  const activeHref = `/tenant/${title.toLowerCase()}/igcse?section=${section}`;

  if (loading) {
    return (
      <AppShell title={title} nav={nav} activeHref={activeHref}>
        <div className="flex min-h-[380px] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title={title} nav={nav} activeHref={activeHref}>
      <div className="space-y-6">
        {/* Page header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpenCheck className="h-5 w-5 text-blue-600" />
            <h1 className="text-lg font-semibold text-slate-900">IGCSE Module</h1>
          </div>
          <Button variant="outline" size="sm" onClick={() => void loadBase()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>

        {/* Section tabs */}
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 w-fit">
          {(["assessments", "subjects", "reports"] as const).map((s) => (
            <a
              key={s}
              href={`?section=${s}`}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                section === s
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {s === "assessments" ? "Assessments" : s === "subjects" ? "Subjects" : "Reports"}
            </a>
          ))}
        </div>

        {/* ── Assessments section ──────────────────────────────────────────── */}
        {section === "assessments" && (
          <div className="space-y-4">
            {/* Selectors */}
            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold text-slate-700">Select Student</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <Label className="text-xs">Term</Label>
                  <select
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                    value={selectedTermId}
                    onChange={(e) => { setSelectedTermId(e.target.value); setSelectedEnrollmentId(""); }}
                  >
                    <option value="">— Select term —</option>
                    {terms.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Class</Label>
                  <select
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                    value={selectedClassId}
                    onChange={(e) => { setSelectedClassId(e.target.value); setSelectedEnrollmentId(""); }}
                  >
                    <option value="">— Select class —</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Student</Label>
                  <select
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                    value={selectedEnrollmentId}
                    onChange={(e) => setSelectedEnrollmentId(e.target.value)}
                    disabled={loadingEnrollments || !selectedClassId}
                  >
                    <option value="">— Select student —</option>
                    {enrollments.map((e) => (
                      <option key={e.id} value={e.id}>{studentName(e)}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Score grid */}
            {subjects.filter((s) => s.is_active).length > 0 && (
              <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                  <div className="flex items-center gap-2">
                    <ClipboardList className="h-4 w-4 text-slate-400" />
                    <h2 className="text-sm font-semibold text-slate-900">Grade Entry</h2>
                  </div>
                  <div className="flex gap-2">
                    {selectedEnrollmentId && (
                      <Button variant="outline" size="sm" onClick={() => void downloadPdf()} disabled={downloadingPdf}>
                        {downloadingPdf ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
                        PDF Report
                      </Button>
                    )}
                    <Button size="sm" onClick={() => void saveScores()} disabled={saving || !selectedEnrollmentId}>
                      {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                      Save
                    </Button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50 text-xs text-slate-500">
                        <th className="px-4 py-2 text-left font-medium">Subject</th>
                        <th className="px-4 py-2 text-left font-medium w-24">Grade</th>
                        <th className="px-4 py-2 text-left font-medium w-24">Score %</th>
                        <th className="px-4 py-2 text-left font-medium w-24">Effort</th>
                        <th className="px-4 py-2 text-left font-medium">Teacher Comment</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {scores.map((row, idx) => {
                        const subj = subjects.find((s) => s.id === row.subject_id);
                        if (!subj) return null;
                        return (
                          <tr key={row.subject_id} className="hover:bg-slate-50/50">
                            <td className="px-4 py-2 font-medium text-slate-800">
                              {subj.name}
                              <span className="ml-2 text-xs text-slate-400">{subj.code}</span>
                            </td>
                            <td className="px-4 py-2">
                              <select
                                className="w-full rounded border border-slate-200 px-2 py-1 text-sm"
                                value={row.grade}
                                onChange={(e) => updateScore(idx, "grade", e.target.value)}
                              >
                                {VALID_GRADES.map((g) => (
                                  <option key={g} value={g}>{g || "—"}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-4 py-2">
                              <Input
                                type="number"
                                min="0"
                                max="100"
                                step="0.1"
                                className="h-8 w-20 text-sm"
                                value={row.percentage}
                                onChange={(e) => updateScore(idx, "percentage", e.target.value)}
                              />
                            </td>
                            <td className="px-4 py-2">
                              <select
                                className="w-full rounded border border-slate-200 px-2 py-1 text-sm"
                                value={row.effort}
                                onChange={(e) => updateScore(idx, "effort", e.target.value)}
                              >
                                {EFFORT_OPTIONS.map((e) => (
                                  <option key={e} value={e}>{e ? `${e} star${e !== "1" ? "s" : ""}` : "—"}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-4 py-2">
                              <Input
                                className="h-8 text-sm"
                                value={row.teacher_comment}
                                placeholder="Optional comment…"
                                onChange={(e) => updateScore(idx, "teacher_comment", e.target.value)}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {subjects.filter((s) => s.is_active).length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-12 text-center">
                <BookOpenText className="mx-auto mb-3 h-8 w-8 text-slate-300" />
                <p className="text-sm text-slate-500">No active subjects configured.</p>
                <p className="mt-1 text-xs text-slate-400">Add subjects in the Subjects tab first.</p>
              </div>
            )}
          </div>
        )}

        {/* ── Subjects section ─────────────────────────────────────────────── */}
        {section === "subjects" && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                <div className="flex items-center gap-2">
                  <BookOpenText className="h-4 w-4 text-slate-400" />
                  <h2 className="text-sm font-semibold text-slate-900">IGCSE Subjects</h2>
                </div>
                {canManageSubjects && (
                  <Button size="sm" onClick={openCreateSubject}>
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Add Subject
                  </Button>
                )}
              </div>
              {subjects.length === 0 ? (
                <div className="p-12 text-center">
                  <BookOpenText className="mx-auto mb-3 h-8 w-8 text-slate-300" />
                  <p className="text-sm text-slate-500">No subjects yet.</p>
                  {canManageSubjects && (
                    <Button size="sm" className="mt-4" onClick={openCreateSubject}>
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      Add First Subject
                    </Button>
                  )}
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-xs text-slate-500">
                      <th className="px-4 py-2 text-left font-medium">Subject</th>
                      <th className="px-4 py-2 text-left font-medium">Code</th>
                      <th className="px-4 py-2 text-left font-medium">Order</th>
                      <th className="px-4 py-2 text-left font-medium">Status</th>
                      {canManageSubjects && <th className="px-4 py-2 text-right font-medium">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {subjects.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3 font-medium text-slate-800">{s.name}</td>
                        <td className="px-4 py-3 font-mono text-slate-600">{s.code}</td>
                        <td className="px-4 py-3 text-slate-500">{s.display_order}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                            {s.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        {canManageSubjects && (
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button variant="ghost" size="sm" onClick={() => openEditSubject(s)}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void toggleSubjectActive(s)}
                                className={s.is_active ? "text-amber-600 hover:text-amber-700" : "text-emerald-600 hover:text-emerald-700"}
                              >
                                {s.is_active ? "Deactivate" : "Activate"}
                              </Button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ── Reports section ──────────────────────────────────────────────── */}
        {section === "reports" && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <FileBarChart className="h-4 w-4 text-slate-400" />
                <h2 className="text-sm font-semibold text-slate-900">Download Progress Reports</h2>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-4">
                <div>
                  <Label className="text-xs">Term</Label>
                  <select
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                    value={selectedTermId}
                    onChange={(e) => { setSelectedTermId(e.target.value); setSelectedEnrollmentId(""); }}
                  >
                    <option value="">— Select term —</option>
                    {terms.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Class</Label>
                  <select
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                    value={selectedClassId}
                    onChange={(e) => { setSelectedClassId(e.target.value); setSelectedEnrollmentId(""); }}
                  >
                    <option value="">— Select class —</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Student (optional for individual)</Label>
                  <select
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                    value={selectedEnrollmentId}
                    onChange={(e) => setSelectedEnrollmentId(e.target.value)}
                    disabled={loadingEnrollments || !selectedClassId}
                  >
                    <option value="">— All students (bulk) —</option>
                    {enrollments.map((e) => (
                      <option key={e.id} value={e.id}>{studentName(e)}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                {selectedEnrollmentId ? (
                  <Button onClick={() => void downloadPdf()} disabled={downloadingPdf || !selectedTermId}>
                    {downloadingPdf ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
                    Individual PDF
                  </Button>
                ) : (
                  <Button
                    onClick={async () => {
                      if (!selectedClassId || !selectedTermId) { toast.error("Select a class and term."); return; }
                      setDownloadingPdf(true);
                      try {
                        const { apiFetchRaw } = await import("@/lib/api");
                        const res = await apiFetchRaw(
                          `/igcse/classes/${selectedClassId}/term/${selectedTermId}/bulk-pdf`,
                          { method: "GET", tenantRequired: true }
                        );
                        const blob = await res.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `igcse_class_reports_${selectedClassId.slice(0, 8)}.pdf`;
                        a.click();
                        URL.revokeObjectURL(url);
                      } catch { toast.error("Failed to download bulk PDF."); }
                      finally { setDownloadingPdf(false); }
                    }}
                    disabled={downloadingPdf || !selectedClassId || !selectedTermId}
                  >
                    {downloadingPdf ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
                    Bulk Class PDF
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Subject dialog */}
      <Dialog open={subjectDialog.open} onOpenChange={(o) => !o && setSubjectDialog({ open: false, editing: null })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{subjectDialog.editing ? "Edit Subject" : "Add Subject"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Subject Name</Label>
              <Input
                className="mt-1"
                value={subjectForm.name}
                onChange={(e) => setSubjectForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Mathematics"
              />
            </div>
            <div>
              <Label>Code</Label>
              <Input
                className="mt-1 uppercase"
                value={subjectForm.code}
                onChange={(e) => setSubjectForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                placeholder="e.g. MATH"
              />
            </div>
            <div>
              <Label>Display Order</Label>
              <Input
                className="mt-1"
                type="number"
                value={subjectForm.display_order}
                onChange={(e) => setSubjectForm((f) => ({ ...f, display_order: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubjectDialog({ open: false, editing: null })}>
              <X className="mr-1.5 h-3.5 w-3.5" />
              Cancel
            </Button>
            <Button onClick={() => void saveSubject()} disabled={savingSubject}>
              {savingSubject ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
