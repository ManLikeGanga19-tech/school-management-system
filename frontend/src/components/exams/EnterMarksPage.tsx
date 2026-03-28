"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PenLine, RefreshCw, ClipboardList } from "lucide-react";

import { AppShell, type AppNavItem } from "@/components/layout/AppShell";
import { TenantPageHeader } from "@/components/tenant/page-chrome";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import {
  normalizeClassOptions,
  normalizeSubjects,
  type TenantClassOption,
  type TenantSubject,
} from "@/lib/hr";
import {
  normalizeEnrollmentRows,
  studentClass,
  studentName,
  type EnrollmentRow,
} from "@/lib/students";
import { normalizeTerms, type TenantTerm } from "@/lib/school-setup/terms";
import {
  normalizeExams,
  normalizeExamMarks,
  toNumber,
  type TenantExam,
  type TenantExamMark,
} from "@/lib/exams";

type Props = {
  appTitle: string;
  nav: AppNavItem[];
  activeHref: string;
};

type MarkForm = {
  term_id: string;
  exam_id: string;
  class_code: string;
  subject_id: string;
  student_enrollment_id: string;
  marks_obtained: string;
  max_marks: string;
  grade: string;
  remarks: string;
};

const defaultMarkForm: MarkForm = {
  term_id: "",
  exam_id: "",
  class_code: "",
  subject_id: "",
  student_enrollment_id: "",
  marks_obtained: "",
  max_marks: "100",
  grade: "",
  remarks: "",
};

function admissionNumber(row: EnrollmentRow): string {
  const payload = row.payload || {};
  const options = [payload.admission_number, payload.admissionNo, payload.admission_no];
  for (const value of options) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return row.admission_number || "";
}

export function EnterMarksPage({ appTitle, nav, activeHref }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [examRows, setExamRows] = useState<TenantExam[]>([]);
  const [markRows, setMarkRows] = useState<TenantExamMark[]>([]);
  const [termRows, setTermRows] = useState<TenantTerm[]>([]);
  const [classRows, setClassRows] = useState<TenantClassOption[]>([]);
  const [subjectRows, setSubjectRows] = useState<TenantSubject[]>([]);
  const [enrollmentRows, setEnrollmentRows] = useState<EnrollmentRow[]>([]);

  const [form, setForm] = useState<MarkForm>(defaultMarkForm);

  const load = useCallback(async () => {
    setLoading(true);
    const [examsRes, marksRes, termsRes, classesRes, subjectsRes, enrollmentsRes] =
      await Promise.allSettled([
        api.get("/tenants/exams?limit=500&offset=0&include_inactive=false", { tenantRequired: true, noRedirect: true }),
        api.get("/tenants/exams/marks?limit=500&offset=0", { tenantRequired: true, noRedirect: true }),
        api.get("/tenants/terms?include_inactive=false", { tenantRequired: true, noRedirect: true }),
        api.get("/tenants/classes?include_inactive=false", { tenantRequired: true, noRedirect: true }),
        api.get("/tenants/subjects?include_inactive=false", { tenantRequired: true, noRedirect: true }),
        api.get("/enrollments/", { tenantRequired: true, noRedirect: true }),
      ]);

    if (examsRes.status === "fulfilled") setExamRows(normalizeExams(examsRes.value));
    if (marksRes.status === "fulfilled") setMarkRows(normalizeExamMarks(marksRes.value));
    if (termsRes.status === "fulfilled") setTermRows(normalizeTerms(termsRes.value));
    if (classesRes.status === "fulfilled") setClassRows(normalizeClassOptions(classesRes.value));
    if (subjectsRes.status === "fulfilled") setSubjectRows(normalizeSubjects(subjectsRes.value));
    if (enrollmentsRes.status === "fulfilled") setEnrollmentRows(normalizeEnrollmentRows(enrollmentsRes.value));

    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Auto-select first term
  useEffect(() => {
    if (termRows.length === 0) return;
    setForm((prev) => prev.term_id ? prev : { ...prev, term_id: termRows[0].id });
  }, [termRows]);

  // Auto-populate class/subject from selected exam
  const examsById = useMemo(() => {
    const map = new Map<string, TenantExam>();
    for (const row of examRows) map.set(row.id, row);
    return map;
  }, [examRows]);

  useEffect(() => {
    const selected = examsById.get(form.exam_id);
    if (!selected) return;
    setForm((prev) => ({
      ...prev,
      class_code: prev.class_code || selected.class_code,
      subject_id: prev.subject_id || selected.subject_id || "",
    }));
  }, [examsById, form.exam_id]);

  const availableExams = useMemo(
    () => examRows.filter((row) => !form.term_id || row.term_id === form.term_id),
    [examRows, form.term_id]
  );

  const studentOptions = useMemo(() => {
    const classCode = form.class_code.trim().toUpperCase();
    return enrollmentRows
      .filter((row) => {
        if (!classCode) return true;
        return studentClass(row.payload || {}).trim().toUpperCase() === classCode;
      })
      .sort((a, b) => studentName(a.payload || {}).localeCompare(studentName(b.payload || {})));
  }, [enrollmentRows, form.class_code]);

  // Show marks recorded for the current exam
  const recentMarks = useMemo(() => {
    if (!form.exam_id) return [];
    return markRows.filter((row) => row.exam_id === form.exam_id);
  }, [markRows, form.exam_id]);

  async function save() {
    if (!form.exam_id || !form.student_enrollment_id || !form.subject_id) {
      toast.error("Exam, student, and subject are required.");
      return;
    }
    const marks = toNumber(form.marks_obtained);
    const maxMarks = toNumber(form.max_marks);
    if (maxMarks <= 0) {
      toast.error("Max marks must be greater than zero.");
      return;
    }
    if (marks < 0 || marks > maxMarks) {
      toast.error("Marks obtained must be between 0 and max marks.");
      return;
    }
    const classCode = form.class_code.trim().toUpperCase();
    if (!classCode) {
      toast.error("Class code is required.");
      return;
    }

    setSaving(true);
    try {
      await api.post(
        "/tenants/exams/marks",
        {
          exam_id: form.exam_id,
          student_enrollment_id: form.student_enrollment_id,
          subject_id: form.subject_id,
          class_code: classCode,
          marks_obtained: String(marks),
          max_marks: String(maxMarks),
          grade: form.grade.trim() || null,
          remarks: form.remarks.trim() || null,
        },
        { tenantRequired: true }
      );
      toast.success("Mark recorded.");
      setForm((prev) => ({
        ...defaultMarkForm,
        term_id: prev.term_id,
        exam_id: prev.exam_id,
        class_code: prev.class_code,
        subject_id: prev.subject_id,
        max_marks: prev.max_marks,
      }));
      await load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to record mark";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell title={appTitle} nav={nav} activeHref={activeHref}>
      <div className="space-y-6">
        <TenantPageHeader
          title="Enter Marks"
          description="Record student exam marks by selecting the exam, student, and subject."
          badges={[{ label: "Exams" }]}
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load()}
              className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            >
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          }
        />

        <div className="grid gap-6 xl:grid-cols-2">
          {/* Entry form */}
          <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 px-6 py-4">
              <PenLine className="h-4 w-4 text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-900">Record Student Mark</h2>
            </div>

            <div className="space-y-4 p-6">
              {/* Term */}
              <div className="space-y-1.5">
                <Label className="text-xs">Term</Label>
                <Select
                  value={form.term_id || "__none__"}
                  onValueChange={(v) =>
                    setForm((prev) => ({ ...prev, term_id: v === "__none__" ? "" : v, exam_id: "", class_code: "", subject_id: "" }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select term" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">All terms</SelectItem>
                    {termRows.map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.code} {row.name ? `— ${row.name}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Exam */}
              <div className="space-y-1.5">
                <Label className="text-xs">Exam <span className="text-red-500">*</span></Label>
                <Select
                  value={form.exam_id || "__none__"}
                  onValueChange={(v) =>
                    setForm((prev) => ({ ...prev, exam_id: v === "__none__" ? "" : v, class_code: "", subject_id: "" }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select exam" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Select exam...</SelectItem>
                    {availableExams.map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.name} — {row.class_code} — {row.start_date}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Class & Subject */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Class</Label>
                  <Select
                    value={form.class_code || "__none__"}
                    onValueChange={(v) =>
                      setForm((prev) => ({ ...prev, class_code: v === "__none__" ? "" : v, student_enrollment_id: "" }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select class" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">All classes</SelectItem>
                      {classRows.map((row) => (
                        <SelectItem key={row.id} value={row.code}>
                          {row.code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Subject <span className="text-red-500">*</span></Label>
                  <Select
                    value={form.subject_id || "__none__"}
                    onValueChange={(v) =>
                      setForm((prev) => ({ ...prev, subject_id: v === "__none__" ? "" : v }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select subject" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Select subject...</SelectItem>
                      {subjectRows.map((row) => (
                        <SelectItem key={row.id} value={row.id}>
                          {row.code} — {row.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Student */}
              <div className="space-y-1.5">
                <Label className="text-xs">Student <span className="text-red-500">*</span></Label>
                <Select
                  value={form.student_enrollment_id || "__none__"}
                  onValueChange={(v) =>
                    setForm((prev) => ({ ...prev, student_enrollment_id: v === "__none__" ? "" : v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select student" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Select student...</SelectItem>
                    {studentOptions.map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {studentName(row.payload || "")}
                        {admissionNumber(row) ? ` (${admissionNumber(row)})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Marks */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Marks Obtained <span className="text-red-500">*</span></Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="e.g. 72"
                    value={form.marks_obtained}
                    onChange={(e) => setForm((prev) => ({ ...prev, marks_obtained: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Max Marks</Label>
                  <Input
                    type="number"
                    min={1}
                    step="0.01"
                    value={form.max_marks}
                    onChange={(e) => setForm((prev) => ({ ...prev, max_marks: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Grade</Label>
                  <Input
                    placeholder="A, B+, C..."
                    value={form.grade}
                    onChange={(e) => setForm((prev) => ({ ...prev, grade: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Remarks</Label>
                  <Input
                    placeholder="Optional"
                    value={form.remarks}
                    onChange={(e) => setForm((prev) => ({ ...prev, remarks: e.target.value }))}
                  />
                </div>
              </div>

              <Button onClick={() => void save()} disabled={saving || loading} className="w-full sm:w-auto">
                <PenLine className="mr-1.5 h-3.5 w-3.5" />
                {saving ? "Saving..." : "Save Mark"}
              </Button>
            </div>
          </div>

          {/* Marks for selected exam */}
          <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 px-6 py-4">
              <ClipboardList className="h-4 w-4 text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-900">
                {form.exam_id ? `Marks for Selected Exam (${recentMarks.length})` : "Marks Preview"}
              </h2>
            </div>

            <div className="p-4">
              {!form.exam_id && (
                <p className="py-10 text-center text-sm text-slate-400">
                  Select an exam above to preview recorded marks.
                </p>
              )}
              {form.exam_id && recentMarks.length === 0 && !loading && (
                <p className="py-10 text-center text-sm text-slate-400">
                  No marks recorded yet for this exam.
                </p>
              )}
              {form.exam_id && recentMarks.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-slate-100">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50">
                        <TableHead className="text-xs">Student</TableHead>
                        <TableHead className="text-xs">Subject</TableHead>
                        <TableHead className="text-xs text-right">Score</TableHead>
                        <TableHead className="text-xs">Grade</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recentMarks.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="text-sm">
                            <div className="font-medium text-slate-900">{row.student_name}</div>
                            <div className="text-xs text-slate-500">{row.admission_number || ""}</div>
                          </TableCell>
                          <TableCell className="text-xs text-slate-600">
                            {row.subject_code || "—"}
                          </TableCell>
                          <TableCell className="text-right text-sm font-semibold text-slate-900">
                            {toNumber(row.marks_obtained)}/{toNumber(row.max_marks)}
                          </TableCell>
                          <TableCell className="text-sm text-slate-600">{row.grade || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
