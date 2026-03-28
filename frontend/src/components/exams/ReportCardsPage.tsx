"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FileBarChart,
  RefreshCw,
  ArrowLeft,
  Download,
  Send,
  Trophy,
} from "lucide-react";

import { AppShell, type AppNavItem } from "@/components/layout/AppShell";
import { TenantPageHeader } from "@/components/tenant/page-chrome";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import { api, apiFetchRaw } from "@/lib/api";
import { normalizeClassOptions, type TenantClassOption } from "@/lib/hr";
import { normalizeTerms, type TenantTerm } from "@/lib/school-setup/terms";

type Props = {
  appTitle: string;
  nav: AppNavItem[];
  activeHref: string;
  role?: "director" | "secretary";
};

type ClassResultRow = {
  position: number;
  enrollment_id: string;
  student_name: string;
  admission_number: string | null;
  mean_score: number | null;
  mean_grade: string | null;
  total_subjects: number;
  subjects: SubjectMark[];
};

type SubjectMark = {
  subject_code: string;
  subject_name: string;
  marks_obtained: number;
  max_marks: number;
  grade: string | null;
};

type FullReportCard = {
  enrollment_id: string;
  student_name: string;
  admission_number: string | null;
  class_code: string;
  term_code: string;
  position: number | null;
  mean_score: number | null;
  mean_grade: string | null;
  subjects: SubjectMark[];
  remarks: {
    class_teacher_comment: string | null;
    principal_comment: string | null;
    conduct: string | null;
    next_term_begins: string | null;
    status: string;
  } | null;
  attendance_summary: {
    present: number;
    absent: number;
    late: number;
    total_sessions: number;
  } | null;
};

type RemarksForm = {
  class_teacher_comment: string;
  principal_comment: string;
  conduct: string;
  next_term_begins: string;
};

const CONDUCT_OPTIONS = ["EXCELLENT", "VERY GOOD", "GOOD", "SATISFACTORY", "UNSATISFACTORY"];

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function normalizeSubjectMark(raw: unknown): SubjectMark | null {
  const row = asObject(raw);
  if (!row) return null;
  return {
    subject_code: asString(row.subject_code) || "?",
    subject_name: asString(row.subject_name) || "",
    marks_obtained: asNumber(row.marks_obtained) ?? 0,
    max_marks: asNumber(row.max_marks) ?? 100,
    grade: asString(row.grade) || null,
  };
}

function normalizeClassResults(data: unknown): ClassResultRow[] {
  const arr = asArray<unknown>(data);
  return arr
    .map((raw): ClassResultRow | null => {
      const row = asObject(raw);
      if (!row) return null;
      return {
        position: (asNumber(row.position) ?? 0),
        enrollment_id: asString(row.enrollment_id),
        student_name: asString(row.student_name) || "Unknown",
        admission_number: asString(row.admission_number) || null,
        mean_score: asNumber(row.mean_score),
        mean_grade: asString(row.mean_grade) || null,
        total_subjects: asNumber(row.total_subjects) ?? 0,
        subjects: asArray<unknown>(row.subjects)
          .map(normalizeSubjectMark)
          .filter((s): s is SubjectMark => s !== null),
      };
    })
    .filter((r): r is ClassResultRow => r !== null)
    .sort((a, b) => a.position - b.position);
}

function normalizeFullCard(data: unknown): FullReportCard | null {
  const row = asObject(data);
  if (!row) return null;
  const remarksRaw = asObject(row.remarks);
  const attendanceRaw = asObject(row.attendance_summary);
  return {
    enrollment_id: asString(row.enrollment_id),
    student_name: asString(row.student_name) || "Unknown",
    admission_number: asString(row.admission_number) || null,
    class_code: asString(row.class_code),
    term_code: asString(row.term_code),
    position: asNumber(row.position),
    mean_score: asNumber(row.mean_score),
    mean_grade: asString(row.mean_grade) || null,
    subjects: asArray<unknown>(row.subjects)
      .map(normalizeSubjectMark)
      .filter((s): s is SubjectMark => s !== null),
    remarks: remarksRaw
      ? {
          class_teacher_comment: asString(remarksRaw.class_teacher_comment) || null,
          principal_comment: asString(remarksRaw.principal_comment) || null,
          conduct: asString(remarksRaw.conduct) || null,
          next_term_begins: asString(remarksRaw.next_term_begins) || null,
          status: asString(remarksRaw.status) || "DRAFT",
        }
      : null,
    attendance_summary: attendanceRaw
      ? {
          present: asNumber(attendanceRaw.present) ?? 0,
          absent: asNumber(attendanceRaw.absent) ?? 0,
          late: asNumber(attendanceRaw.late) ?? 0,
          total_sessions: asNumber(attendanceRaw.total_sessions) ?? 0,
        }
      : null,
  };
}

export function ReportCardsPage({ appTitle, nav, activeHref, role = "secretary" }: Props) {
  const [refLoading, setRefLoading] = useState(true);
  const [termRows, setTermRows] = useState<TenantTerm[]>([]);
  const [classRows, setClassRows] = useState<TenantClassOption[]>([]);

  const [selectedTermId, setSelectedTermId] = useState("");
  const [selectedClassCode, setSelectedClassCode] = useState("");

  // Class results view
  const [classResults, setClassResults] = useState<ClassResultRow[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);

  // Individual report card view
  const [activeCard, setActiveCard] = useState<FullReportCard | null>(null);
  const [cardLoading, setCardLoading] = useState(false);

  // Remarks dialog
  const [remarksDialog, setRemarksDialog] = useState(false);
  const [remarksForm, setRemarksForm] = useState<RemarksForm>({
    class_teacher_comment: "",
    principal_comment: "",
    conduct: "",
    next_term_begins: "",
  });
  const [savingRemarks, setSavingRemarks] = useState(false);

  // Publish
  const [publishing, setPublishing] = useState(false);
  const [publishConfirm, setPublishConfirm] = useState(false);

  // PDF
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const loadRefData = useCallback(async () => {
    setRefLoading(true);
    const [termsRes, classesRes] = await Promise.allSettled([
      api.get("/tenants/terms?include_inactive=false", { tenantRequired: true, noRedirect: true }),
      api.get("/tenants/classes?include_inactive=false", { tenantRequired: true, noRedirect: true }),
    ]);
    if (termsRes.status === "fulfilled") setTermRows(normalizeTerms(termsRes.value));
    if (classesRes.status === "fulfilled") setClassRows(normalizeClassOptions(classesRes.value));
    setRefLoading(false);
  }, []);

  useEffect(() => { void loadRefData(); }, [loadRefData]);

  // Auto-select first term/class
  useEffect(() => {
    if (termRows.length > 0 && !selectedTermId) setSelectedTermId(termRows[0].id);
  }, [termRows, selectedTermId]);

  useEffect(() => {
    if (classRows.length > 0 && !selectedClassCode) setSelectedClassCode(classRows[0].code);
  }, [classRows, selectedClassCode]);

  async function loadClassResults() {
    if (!selectedTermId || !selectedClassCode) {
      toast.error("Select a term and class first.");
      return;
    }
    setResultsLoading(true);
    setActiveCard(null);
    try {
      const data = await api.get(
        `/reports/8-4-4/classes/${selectedClassCode}/term/${selectedTermId}`,
        { tenantRequired: true }
      );
      setClassResults(normalizeClassResults(data));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load class results.";
      toast.error(msg);
      setClassResults([]);
    } finally {
      setResultsLoading(false);
    }
  }

  async function openStudentCard(enrollmentId: string) {
    if (!selectedTermId) return;
    setCardLoading(true);
    try {
      const data = await api.get(
        `/reports/8-4-4/enrollments/${enrollmentId}/term/${selectedTermId}`,
        { tenantRequired: true }
      );
      const card = normalizeFullCard(data);
      setActiveCard(card);
      if (card?.remarks) {
        setRemarksForm({
          class_teacher_comment: card.remarks.class_teacher_comment || "",
          principal_comment: card.remarks.principal_comment || "",
          conduct: card.remarks.conduct || "",
          next_term_begins: card.remarks.next_term_begins || "",
        });
      } else {
        setRemarksForm({ class_teacher_comment: "", principal_comment: "", conduct: "", next_term_begins: "" });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load report card.";
      toast.error(msg);
    } finally {
      setCardLoading(false);
    }
  }

  async function saveRemarks() {
    if (!activeCard || !selectedTermId) return;
    setSavingRemarks(true);
    try {
      await api.put(
        `/reports/8-4-4/enrollments/${activeCard.enrollment_id}/term/${selectedTermId}/remarks`,
        {
          class_teacher_comment: remarksForm.class_teacher_comment.trim() || null,
          principal_comment: remarksForm.principal_comment.trim() || null,
          conduct: remarksForm.conduct.trim() || null,
          next_term_begins: remarksForm.next_term_begins.trim() || null,
        },
        { tenantRequired: true }
      );
      toast.success("Remarks saved.");
      setRemarksDialog(false);
      await openStudentCard(activeCard.enrollment_id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save remarks.";
      toast.error(msg);
    } finally {
      setSavingRemarks(false);
    }
  }

  async function publishClass() {
    if (!selectedTermId || !selectedClassCode) return;
    setPublishing(true);
    try {
      await api.post(
        `/reports/8-4-4/classes/${selectedClassCode}/term/${selectedTermId}/publish`,
        {},
        { tenantRequired: true }
      );
      toast.success("Report cards published.");
      setPublishConfirm(false);
      await loadClassResults();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to publish report cards.";
      toast.error(msg);
    } finally {
      setPublishing(false);
    }
  }

  async function downloadPdf(enrollmentId: string) {
    if (!selectedTermId) return;
    setDownloadingPdf(true);
    try {
      const resp = await apiFetchRaw(
        `/reports/8-4-4/enrollments/${enrollmentId}/term/${selectedTermId}/pdf`,
        { tenantRequired: true }
      );
      if (!resp.ok) throw new Error("PDF download failed.");
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `report-card-${enrollmentId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to download PDF.";
      toast.error(msg);
    } finally {
      setDownloadingPdf(false);
    }
  }

  const termLabel = termRows.find((t) => t.id === selectedTermId)?.code || "";

  return (
    <AppShell title={appTitle} nav={nav} activeHref={activeHref}>
      <div className="space-y-6">
        <TenantPageHeader
          title="Report Cards"
          description="View class rankings, individual student report cards, and manage remarks."
          badges={[{ label: "Exams" }]}
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadRefData()}
              className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            >
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          }
        />

        {/* Individual report card view */}
        {activeCard && (
          <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
            <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-4">
              <Button variant="ghost" size="sm" onClick={() => setActiveCard(null)} className="h-8 w-8 p-0">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <h2 className="text-sm font-semibold text-slate-900">{activeCard.student_name}</h2>
                <p className="text-xs text-slate-500">
                  {activeCard.class_code} · {activeCard.term_code}
                  {activeCard.position ? ` · Position ${activeCard.position}` : ""}
                </p>
              </div>
              <div className="ml-auto flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRemarksDialog(true)}
                >
                  Edit Remarks
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={downloadingPdf}
                  onClick={() => void downloadPdf(activeCard.enrollment_id)}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  {downloadingPdf ? "Downloading..." : "PDF"}
                </Button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Summary row */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[
                  { label: "Mean Score", value: activeCard.mean_score != null ? `${activeCard.mean_score}%` : "—" },
                  { label: "Mean Grade", value: activeCard.mean_grade || "—" },
                  { label: "Position", value: activeCard.position != null ? `#${activeCard.position}` : "—" },
                  { label: "Subjects", value: activeCard.subjects.length },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                    <p className="text-xs text-slate-500">{label}</p>
                    <p className="mt-0.5 text-lg font-bold text-slate-900">{value}</p>
                  </div>
                ))}
              </div>

              {/* Subject marks */}
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Subject Marks</h3>
                <div className="overflow-x-auto rounded-xl border border-slate-100">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50">
                        <TableHead className="text-xs">Subject</TableHead>
                        <TableHead className="text-xs text-right">Score</TableHead>
                        <TableHead className="text-xs text-right">%</TableHead>
                        <TableHead className="text-xs">Grade</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeCard.subjects.map((s) => (
                        <TableRow key={s.subject_code}>
                          <TableCell className="text-sm font-medium text-slate-800">
                            {s.subject_code} — {s.subject_name}
                          </TableCell>
                          <TableCell className="text-right text-sm text-slate-700">
                            {s.marks_obtained} / {s.max_marks}
                          </TableCell>
                          <TableCell className="text-right text-sm text-slate-600">
                            {s.max_marks > 0 ? Math.round((s.marks_obtained / s.max_marks) * 100) : "—"}%
                          </TableCell>
                          <TableCell className="text-sm font-semibold text-slate-900">{s.grade || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Remarks */}
              {activeCard.remarks && (
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Remarks</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-xs text-slate-500">Class Teacher Comment</p>
                      <p className="text-sm text-slate-800">{activeCard.remarks.class_teacher_comment || "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Principal Comment</p>
                      <p className="text-sm text-slate-800">{activeCard.remarks.principal_comment || "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Conduct</p>
                      <p className="text-sm text-slate-800">{activeCard.remarks.conduct || "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Next Term Begins</p>
                      <p className="text-sm text-slate-800">{activeCard.remarks.next_term_begins || "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Status</p>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        activeCard.remarks.status === "PUBLISHED"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-amber-100 text-amber-700"
                      }`}>
                        {activeCard.remarks.status}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Attendance */}
              {activeCard.attendance_summary && (
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Attendance Summary</h3>
                  <div className="flex gap-6 text-sm">
                    <span>Present: <strong>{activeCard.attendance_summary.present}</strong></span>
                    <span>Absent: <strong>{activeCard.attendance_summary.absent}</strong></span>
                    <span>Late: <strong>{activeCard.attendance_summary.late}</strong></span>
                    <span>Sessions: <strong>{activeCard.attendance_summary.total_sessions}</strong></span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Class results table */}
        {!activeCard && (
          <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-4 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2">
                <Trophy className="h-4 w-4 text-slate-400" />
                <h2 className="text-sm font-semibold text-slate-900">Class Rankings</h2>
              </div>
              <div className="flex flex-wrap gap-3 sm:ml-auto">
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-slate-500 whitespace-nowrap">Term</Label>
                  <Select
                    value={selectedTermId || "__none__"}
                    onValueChange={(v) => setSelectedTermId(v === "__none__" ? "" : v)}
                  >
                    <SelectTrigger className="h-8 w-36 text-xs">
                      <SelectValue placeholder="Select term" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Select term</SelectItem>
                      {termRows.map((row) => (
                        <SelectItem key={row.id} value={row.id}>{row.code}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-slate-500 whitespace-nowrap">Class</Label>
                  <Select
                    value={selectedClassCode || "__none__"}
                    onValueChange={(v) => setSelectedClassCode(v === "__none__" ? "" : v)}
                  >
                    <SelectTrigger className="h-8 w-36 text-xs">
                      <SelectValue placeholder="Select class" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Select class</SelectItem>
                      {classRows.map((row) => (
                        <SelectItem key={row.id} value={row.code}>{row.code}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  size="sm"
                  onClick={() => void loadClassResults()}
                  disabled={resultsLoading || !selectedTermId || !selectedClassCode}
                >
                  <FileBarChart className="mr-1.5 h-3.5 w-3.5" />
                  {resultsLoading ? "Loading..." : "Generate"}
                </Button>
                {role === "director" && classResults.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPublishConfirm(true)}
                  >
                    <Send className="mr-1.5 h-3.5 w-3.5" />
                    Publish All
                  </Button>
                )}
              </div>
            </div>

            {classResults.length === 0 && !resultsLoading && (
              <div className="py-16 text-center text-sm text-slate-400">
                Select a term and class, then click Generate to view rankings.
              </div>
            )}

            {resultsLoading && (
              <div className="py-16 text-center text-sm text-slate-400">Loading results...</div>
            )}

            {!resultsLoading && classResults.length > 0 && (
              <div className="overflow-x-auto [&_table]:min-w-[700px]">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs w-12">#</TableHead>
                      <TableHead className="text-xs">Student</TableHead>
                      <TableHead className="text-xs text-right">Mean Score</TableHead>
                      <TableHead className="text-xs">Mean Grade</TableHead>
                      <TableHead className="text-xs text-right">Subjects</TableHead>
                      <TableHead className="text-xs" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {classResults.map((row) => (
                      <TableRow key={row.enrollment_id} className="hover:bg-slate-50">
                        <TableCell className="text-sm font-bold text-slate-500">
                          {row.position}
                        </TableCell>
                        <TableCell className="text-sm">
                          <div className="font-medium text-slate-900">{row.student_name}</div>
                          {row.admission_number && (
                            <div className="text-xs text-slate-500">{row.admission_number}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm font-semibold text-slate-900">
                          {row.mean_score != null ? `${row.mean_score}%` : "—"}
                        </TableCell>
                        <TableCell className="text-sm font-semibold text-slate-700">
                          {row.mean_grade || "—"}
                        </TableCell>
                        <TableCell className="text-right text-sm text-slate-600">
                          {row.total_subjects}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={cardLoading}
                            onClick={() => void openStudentCard(row.enrollment_id)}
                          >
                            View Card
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Remarks dialog */}
      <Dialog open={remarksDialog} onOpenChange={setRemarksDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Remarks</DialogTitle>
            <DialogDescription>
              Add class teacher and principal comments for this student&apos;s report card.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Class Teacher Comment</Label>
              <Textarea
                rows={3}
                value={remarksForm.class_teacher_comment}
                onChange={(e) => setRemarksForm((prev) => ({ ...prev, class_teacher_comment: e.target.value }))}
                placeholder="Write class teacher comment..."
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Principal Comment</Label>
              <Textarea
                rows={3}
                value={remarksForm.principal_comment}
                onChange={(e) => setRemarksForm((prev) => ({ ...prev, principal_comment: e.target.value }))}
                placeholder="Write principal comment..."
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Conduct</Label>
                <Select
                  value={remarksForm.conduct || "__none__"}
                  onValueChange={(v) => setRemarksForm((prev) => ({ ...prev, conduct: v === "__none__" ? "" : v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select conduct" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Not set</SelectItem>
                    {CONDUCT_OPTIONS.map((opt) => (
                      <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Next Term Begins</Label>
                <input
                  type="date"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={remarksForm.next_term_begins}
                  onChange={(e) => setRemarksForm((prev) => ({ ...prev, next_term_begins: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRemarksDialog(false)}>Cancel</Button>
            <Button onClick={() => void saveRemarks()} disabled={savingRemarks}>
              {savingRemarks ? "Saving..." : "Save Remarks"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Publish confirmation */}
      <Dialog open={publishConfirm} onOpenChange={setPublishConfirm}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Publish Report Cards</DialogTitle>
            <DialogDescription>
              Publish all DRAFT report cards for {selectedClassCode} — {termLabel}? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishConfirm(false)}>Cancel</Button>
            <Button onClick={() => void publishClass()} disabled={publishing}>
              <Send className="mr-1.5 h-3.5 w-3.5" />
              {publishing ? "Publishing..." : "Publish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
