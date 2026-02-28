"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarDays, CheckCircle2, ClipboardList, RefreshCw } from "lucide-react";

import { AppShell, type AppNavItem } from "@/components/layout/AppShell";
import type { ExamSection } from "@/components/layout/nav-config";
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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import {
  normalizeClassOptions,
  normalizeStaff,
  normalizeSubjects,
  type TenantClassOption,
  type TenantStaff,
  type TenantSubject,
} from "@/lib/hr";
import { normalizeEnrollmentRows, studentClass, studentName, type EnrollmentRow } from "@/lib/students";
import { normalizeTerms, type TenantTerm } from "@/lib/school-setup/terms";
import {
  normalizeExamMarks,
  normalizeExams,
  toNumber,
  type TenantExam,
  type TenantExamMark,
} from "@/lib/exams";

type ExamsModulePageProps = {
  appTitle: string;
  nav: AppNavItem[];
  activeHref?: string;
};

type ExamForm = {
  name: string;
  term_id: string;
  class_code: string;
  subject_id: string;
  invigilator_staff_id: string;
  start_date: string;
  start_time: string;
  end_time: string;
  status: string;
  location: string;
  notes: string;
  is_active: boolean;
};

type MarkForm = {
  exam_id: string;
  student_enrollment_id: string;
  subject_id: string;
  class_code: string;
  marks_obtained: string;
  max_marks: string;
  grade: string;
  remarks: string;
};

type TimetableFilters = {
  term_id: string;
  class_code: string;
  status: string;
  date_from: string;
  date_to: string;
};

type MarksFilters = {
  term_id: string;
  exam_id: string;
  class_code: string;
  subject_id: string;
};

const defaultExamForm: ExamForm = {
  name: "",
  term_id: "",
  class_code: "",
  subject_id: "",
  invigilator_staff_id: "",
  start_date: "",
  start_time: "",
  end_time: "",
  status: "SCHEDULED",
  location: "",
  notes: "",
  is_active: true,
};

const defaultMarkForm: MarkForm = {
  exam_id: "",
  student_enrollment_id: "",
  subject_id: "",
  class_code: "",
  marks_obtained: "",
  max_marks: "100",
  grade: "",
  remarks: "",
};

const defaultTimetableFilters: TimetableFilters = {
  term_id: "",
  class_code: "",
  status: "",
  date_from: "",
  date_to: "",
};

const defaultMarksFilters: MarksFilters = {
  term_id: "",
  exam_id: "",
  class_code: "",
  subject_id: "",
};

const EXAM_STATUS_OPTIONS = ["SCHEDULED", "ONGOING", "COMPLETED", "CANCELLED"] as const;
const EXAM_SECTIONS: ExamSection[] = ["setup", "timetable", "progress"];

function normalizeSection(raw: string | null): ExamSection {
  if (!raw) return "setup";
  const cleaned = raw.trim().toLowerCase();
  return EXAM_SECTIONS.includes(cleaned as ExamSection) ? (cleaned as ExamSection) : "setup";
}

function admissionNumber(row: EnrollmentRow): string {
  const payload = row.payload || {};
  const options = [payload.admission_number, payload.admissionNo, payload.admission_no];
  for (const value of options) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return row.admission_number || "";
}

function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  const trimmed = value.trim();
  if (!trimmed) return "—";
  if (/^\d{2}:\d{2}:\d{2}$/.test(trimmed)) return trimmed.slice(0, 5);
  return trimmed;
}

function formatDateRange(startDate: string, endDate: string): string {
  if (!startDate && !endDate) return "—";
  if (!endDate || startDate === endDate) return startDate || endDate;
  return `${startDate} to ${endDate}`;
}

function formatTimeRange(startTime: string | null | undefined, endTime: string | null | undefined): string {
  const start = formatTime(startTime);
  const end = formatTime(endTime);
  if (start === "—" && end === "—") return "—";
  if (start !== "—" && end === "—") return start;
  if (start === "—" && end !== "—") return end;
  return `${start} - ${end}`;
}

function isDateInRange(exam: TenantExam, fromDate: string, toDate: string): boolean {
  if (fromDate && exam.start_date < fromDate) return false;
  if (toDate && exam.end_date > toDate) return false;
  return true;
}

export function ExamsModulePage({ appTitle, nav, activeHref }: ExamsModulePageProps) {
  const searchParams = useSearchParams();
  const section = useMemo(
    () => normalizeSection(searchParams?.get("section") || null),
    [searchParams]
  );

  const [loading, setLoading] = useState(true);
  const [savingExam, setSavingExam] = useState(false);
  const [updatingExamId, setUpdatingExamId] = useState<string | null>(null);
  const [savingMark, setSavingMark] = useState(false);

  const [examRows, setExamRows] = useState<TenantExam[]>([]);
  const [markRows, setMarkRows] = useState<TenantExamMark[]>([]);
  const [termRows, setTermRows] = useState<TenantTerm[]>([]);
  const [classRows, setClassRows] = useState<TenantClassOption[]>([]);
  const [subjectRows, setSubjectRows] = useState<TenantSubject[]>([]);
  const [teacherRows, setTeacherRows] = useState<TenantStaff[]>([]);
  const [enrollmentRows, setEnrollmentRows] = useState<EnrollmentRow[]>([]);

  const [examForm, setExamForm] = useState<ExamForm>(defaultExamForm);
  const [markForm, setMarkForm] = useState<MarkForm>(defaultMarkForm);
  const [timetableFilters, setTimetableFilters] = useState<TimetableFilters>(defaultTimetableFilters);
  const [marksFilters, setMarksFilters] = useState<MarksFilters>(defaultMarksFilters);

  const load = useCallback(async () => {
    setLoading(true);

    const requests: Array<Promise<unknown>> = [
      api.get("/tenants/exams?limit=500&offset=0&include_inactive=true", {
        tenantRequired: true,
        noRedirect: true,
      }),
      api.get("/tenants/exams/marks?limit=500&offset=0", {
        tenantRequired: true,
        noRedirect: true,
      }),
      api.get("/tenants/terms?include_inactive=false", {
        tenantRequired: true,
        noRedirect: true,
      }),
      api.get("/tenants/classes?include_inactive=false", {
        tenantRequired: true,
        noRedirect: true,
      }),
      api.get("/tenants/subjects?include_inactive=false", {
        tenantRequired: true,
        noRedirect: true,
      }),
      api.get(
        "/tenants/hr/staff?staff_type=TEACHING&include_inactive=false&include_separated=false&limit=500",
        {
          tenantRequired: true,
          noRedirect: true,
        }
      ),
      api.get("/enrollments/", {
        tenantRequired: true,
        noRedirect: true,
      }),
    ];

    const [examsRes, marksRes, termsRes, classesRes, subjectsRes, teachersRes, enrollmentsRes] =
      await Promise.allSettled(requests);

    const errorMessages: string[] = [];

    if (examsRes.status === "fulfilled") {
      setExamRows(normalizeExams(examsRes.value));
    } else {
      setExamRows([]);
      errorMessages.push("Failed to load exams.");
    }

    if (marksRes.status === "fulfilled") {
      setMarkRows(normalizeExamMarks(marksRes.value));
    } else {
      setMarkRows([]);
      errorMessages.push("Failed to load exam marks.");
    }

    if (termsRes.status === "fulfilled") {
      setTermRows(normalizeTerms(termsRes.value));
    } else {
      setTermRows([]);
      errorMessages.push("Failed to load terms.");
    }

    if (classesRes.status === "fulfilled") {
      setClassRows(normalizeClassOptions(classesRes.value));
    } else {
      setClassRows([]);
      errorMessages.push("Failed to load classes.");
    }

    if (subjectsRes.status === "fulfilled") {
      setSubjectRows(normalizeSubjects(subjectsRes.value));
    } else {
      setSubjectRows([]);
      errorMessages.push("Failed to load subjects.");
    }

    if (teachersRes.status === "fulfilled") {
      setTeacherRows(normalizeStaff(teachersRes.value));
    } else {
      setTeacherRows([]);
      errorMessages.push("Failed to load invigilators.");
    }

    if (enrollmentsRes.status === "fulfilled") {
      setEnrollmentRows(normalizeEnrollmentRows(enrollmentsRes.value));
    } else {
      setEnrollmentRows([]);
      errorMessages.push("Failed to load students.");
    }

    if (errorMessages.length > 0) {
      toast.error(errorMessages[0]);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (termRows.length === 0) return;
    setExamForm((prev) => {
      if (prev.term_id) return prev;
      return { ...prev, term_id: termRows[0].id };
    });
    setTimetableFilters((prev) => {
      if (prev.term_id) return prev;
      return { ...prev, term_id: termRows[0].id };
    });
    setMarksFilters((prev) => {
      if (prev.term_id) return prev;
      return { ...prev, term_id: termRows[0].id };
    });
  }, [termRows]);

  const examsById = useMemo(() => {
    const map = new Map<string, TenantExam>();
    for (const row of examRows) map.set(row.id, row);
    return map;
  }, [examRows]);

  useEffect(() => {
    const selectedExam = examsById.get(markForm.exam_id);
    if (!selectedExam) return;
    setMarkForm((prev) => ({
      ...prev,
      class_code: prev.class_code || selectedExam.class_code,
      subject_id: prev.subject_id || selectedExam.subject_id || "",
    }));
  }, [examsById, markForm.exam_id]);

  const filteredTimetableRows = useMemo(() => {
    return examRows.filter((row) => {
      if (timetableFilters.term_id && row.term_id !== timetableFilters.term_id) return false;
      if (timetableFilters.class_code && row.class_code !== timetableFilters.class_code) return false;
      if (timetableFilters.status && row.status !== timetableFilters.status) return false;
      return isDateInRange(row, timetableFilters.date_from, timetableFilters.date_to);
    });
  }, [examRows, timetableFilters]);

  const filteredMarksRows = useMemo(() => {
    return markRows.filter((row) => {
      if (marksFilters.term_id && row.term_id !== marksFilters.term_id) return false;
      if (marksFilters.exam_id && row.exam_id !== marksFilters.exam_id) return false;
      if (marksFilters.class_code && row.class_code !== marksFilters.class_code) return false;
      if (marksFilters.subject_id && row.subject_id !== marksFilters.subject_id) return false;
      return true;
    });
  }, [markRows, marksFilters]);

  const examOptionsForProgress = useMemo(
    () =>
      examRows.filter((row) => !marksFilters.term_id || row.term_id === marksFilters.term_id),
    [examRows, marksFilters.term_id]
  );

  useEffect(() => {
    if (!marksFilters.exam_id) return;
    const selected = examRows.find((row) => row.id === marksFilters.exam_id);
    if (!selected) return;
    if (marksFilters.term_id && selected.term_id !== marksFilters.term_id) {
      setMarksFilters((prev) => ({ ...prev, exam_id: "" }));
    }
  }, [examRows, marksFilters.exam_id, marksFilters.term_id]);

  const sectionTitle = useMemo(() => {
    if (section === "timetable") return "Exam Timetable View";
    if (section === "progress") return "Student Progress Report";
    return "Exam Setup";
  }, [section]);

  const studentOptions = useMemo(() => {
    const classCode = markForm.class_code.trim().toUpperCase();
    return enrollmentRows
      .filter((row) => {
        if (!classCode) return true;
        const rowClass = studentClass(row.payload || {}).trim().toUpperCase();
        return rowClass === classCode;
      })
      .sort((a, b) => {
        const classCmp = studentClass(a.payload || {}).localeCompare(studentClass(b.payload || {}));
        if (classCmp !== 0) return classCmp;
        return studentName(a.payload || {}).localeCompare(studentName(b.payload || {}));
      });
  }, [enrollmentRows, markForm.class_code]);

  const marksSummary = useMemo(() => {
    const total = filteredMarksRows.length;
    const completedExams = new Set(filteredMarksRows.map((row) => row.exam_id)).size;
    const averagePercent =
      total === 0
        ? 0
        : Math.round(
            (filteredMarksRows.reduce((sum, row) => {
              const max = toNumber(row.max_marks);
              if (max <= 0) return sum;
              return sum + (toNumber(row.marks_obtained) / max) * 100;
            }, 0) /
              total) *
              100
          ) / 100;
    return { total, completedExams, averagePercent };
  }, [filteredMarksRows]);

  async function createExam(source?: Partial<ExamForm>) {
    const draft: ExamForm = { ...examForm, ...(source || {}) };
    const name = draft.name.trim();
    const termId = draft.term_id.trim() || termRows[0]?.id || "";
    const classCode = draft.class_code.trim().toUpperCase() || classRows[0]?.code || "";
    const startDate = draft.start_date.trim();
    const startTime = draft.start_time.trim();
    const endTime = draft.end_time.trim() || startTime;

    if (endTime < startTime) {
      toast.error("End time cannot be earlier than start time.");
      return;
    }

    setSavingExam(true);
    try {
      await api.post(
        "/tenants/exams",
        {
          name,
          term_id: termId,
          class_code: classCode,
          subject_id: draft.subject_id || null,
          invigilator_staff_id: draft.invigilator_staff_id || null,
          start_date: startDate,
          end_date: startDate,
          start_time: startTime || null,
          end_time: endTime || null,
          status: draft.status,
          location: draft.location.trim() || null,
          notes: draft.notes.trim() || null,
          is_active: draft.is_active,
        },
        { tenantRequired: true }
      );
      toast.success("Exam scheduled.");
      setExamForm((prev) => ({
        ...defaultExamForm,
        term_id: prev.term_id,
        class_code: prev.class_code,
        subject_id: prev.subject_id,
        invigilator_staff_id: prev.invigilator_staff_id,
      }));
      await load();
    } catch (err: any) {
      toast.error(typeof err?.message === "string" ? err.message : "Failed to schedule exam");
    } finally {
      setSavingExam(false);
    }
  }

  async function updateExamStatus(examId: string, nextStatus: string) {
    setUpdatingExamId(examId);
    try {
      await api.put(
        `/tenants/exams/${examId}`,
        { status: nextStatus },
        { tenantRequired: true }
      );
      toast.success(`Exam updated to ${nextStatus}.`);
      await load();
    } catch (err: any) {
      toast.error(typeof err?.message === "string" ? err.message : "Failed to update exam status");
    } finally {
      setUpdatingExamId(null);
    }
  }

  async function saveMark() {
    if (!markForm.exam_id || !markForm.student_enrollment_id || !markForm.subject_id) {
      toast.error("Exam, student, and subject are required.");
      return;
    }
    const marks = toNumber(markForm.marks_obtained);
    const maxMarks = toNumber(markForm.max_marks);
    if (maxMarks <= 0) {
      toast.error("Max marks must be greater than zero.");
      return;
    }
    if (marks < 0 || marks > maxMarks) {
      toast.error("Marks obtained must be between 0 and max marks.");
      return;
    }
    const classCode = markForm.class_code.trim().toUpperCase();
    if (!classCode) {
      toast.error("Class code is required for marks recording.");
      return;
    }

    setSavingMark(true);
    try {
      await api.post(
        "/tenants/exams/marks",
        {
          exam_id: markForm.exam_id,
          student_enrollment_id: markForm.student_enrollment_id,
          subject_id: markForm.subject_id,
          class_code: classCode,
          marks_obtained: String(marks),
          max_marks: String(maxMarks),
          grade: markForm.grade.trim() || null,
          remarks: markForm.remarks.trim() || null,
        },
        { tenantRequired: true }
      );
      toast.success("Student mark recorded.");
      setMarkForm((prev) => ({
        ...defaultMarkForm,
        exam_id: prev.exam_id,
        class_code: prev.class_code,
        subject_id: prev.subject_id,
      }));
      await load();
    } catch (err: any) {
      toast.error(typeof err?.message === "string" ? err.message : "Failed to record mark");
    } finally {
      setSavingMark(false);
    }
  }

  return (
    <AppShell title={appTitle} nav={nav} activeHref={activeHref}>
      <div className="space-y-5">
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-600 to-blue-500 p-4 text-white shadow-sm sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-bold">Exams Module</h1>
              <p className="mt-0.5 text-sm text-blue-100">
                {sectionTitle}: term-scoped setup, timetable operations, and student progress records.
              </p>
            </div>
            <Button
              variant="outline"
              className="w-full border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white sm:w-auto"
              onClick={() => void load()}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        {section === "setup" && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-4 sm:px-6">
            <h2 className="text-sm font-semibold text-slate-900">Exam Setup</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Define term-scoped exam windows by class, subject, and invigilator.
            </p>
          </div>
          <form
            className="p-4 sm:p-6"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const source: Partial<ExamForm> = {
                name: String(form.get("exam_name") || ""),
                start_date: String(form.get("start_date") || ""),
                start_time: String(form.get("start_time") || ""),
                end_time: String(form.get("end_time") || ""),
                location: String(form.get("location") || ""),
                notes: String(form.get("notes") || ""),
              };
              setExamForm((prev) => ({
                ...prev,
                ...source,
              }));
              void createExam(source);
            }}
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Exam Name</Label>
                <Input
                  name="exam_name"
                  placeholder="Midterm Mathematics"
                  value={examForm.name}
                  onChange={(e) => setExamForm((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Term</Label>
                <Select
                  value={examForm.term_id || "__none__"}
                  onValueChange={(value) =>
                    setExamForm((prev) => ({
                      ...prev,
                      term_id: value === "__none__" ? "" : value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select term" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Select term...</SelectItem>
                    {termRows.map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.code} - {row.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Class</Label>
                <Select
                  value={examForm.class_code || "__none__"}
                  onValueChange={(value) =>
                    setExamForm((prev) => ({
                      ...prev,
                      class_code: value === "__none__" ? "" : value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select class" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Select class...</SelectItem>
                    {classRows.map((row) => (
                      <SelectItem key={row.id} value={row.code}>
                        {row.name} ({row.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Or type class code (e.g. GRADE_7)"
                  value={examForm.class_code}
                  onChange={(e) =>
                    setExamForm((prev) => ({
                      ...prev,
                      class_code: e.target.value.toUpperCase(),
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Subject</Label>
                <Select
                  value={examForm.subject_id || "__none__"}
                  onValueChange={(value) =>
                    setExamForm((prev) => ({
                      ...prev,
                      subject_id: value === "__none__" ? "" : value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Optional subject" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">General / whole class</SelectItem>
                    {subjectRows.map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.code} - {row.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Invigilator (Teacher)</Label>
                <Select
                  value={examForm.invigilator_staff_id || "__none__"}
                  onValueChange={(value) =>
                    setExamForm((prev) => ({
                      ...prev,
                      invigilator_staff_id: value === "__none__" ? "" : value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Optional invigilator" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No invigilator set</SelectItem>
                    {teacherRows.map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.full_name} ({row.staff_no})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Start Date</Label>
                <Input
                  name="start_date"
                  type="date"
                  value={examForm.start_date}
                  onChange={(e) => setExamForm((prev) => ({ ...prev, start_date: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Start Time</Label>
                <Input
                  name="start_time"
                  type="time"
                  value={examForm.start_time}
                  onChange={(e) => setExamForm((prev) => ({ ...prev, start_time: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">End Time</Label>
                <Input
                  name="end_time"
                  type="time"
                  value={examForm.end_time}
                  onChange={(e) => setExamForm((prev) => ({ ...prev, end_time: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Status</Label>
                <Select
                  value={examForm.status}
                  onValueChange={(value) => setExamForm((prev) => ({ ...prev, status: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXAM_STATUS_OPTIONS.map((row) => (
                      <SelectItem key={row} value={row}>
                        {row}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 md:col-span-2 xl:col-span-3">
                <Label className="text-xs">Location</Label>
                <Input
                  name="location"
                  placeholder="Hall A / Classroom block"
                  value={examForm.location}
                  onChange={(e) => setExamForm((prev) => ({ ...prev, location: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5 md:col-span-2 xl:col-span-3">
                <Label className="text-xs">Notes</Label>
                <Textarea
                  name="notes"
                  rows={3}
                  placeholder="Optional instructions for invigilation or exam logistics."
                  value={examForm.notes}
                  onChange={(e) => setExamForm((prev) => ({ ...prev, notes: e.target.value }))}
                />
              </div>
            </div>
            <div className="mt-4">
              <Button type="submit" disabled={savingExam}>
                {savingExam ? "Scheduling..." : "Schedule Exam"}
              </Button>
            </div>
          </form>
        </div>
        )}

        {section === "timetable" && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-4 sm:px-6">
            <h2 className="text-sm font-semibold text-slate-900">Timetable View</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Deterministic schedule ordered by date, time, class, and exam name.
            </p>
          </div>
          <div className="p-4 sm:p-6">
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div className="space-y-1.5">
                <Label className="text-xs">Term</Label>
                <Select
                  value={timetableFilters.term_id || "__all__"}
                  onValueChange={(value) =>
                    setTimetableFilters((prev) => ({
                      ...prev,
                      term_id: value === "__all__" ? "" : value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All terms" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All terms</SelectItem>
                    {termRows.map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Class</Label>
                <Select
                  value={timetableFilters.class_code || "__all__"}
                  onValueChange={(value) =>
                    setTimetableFilters((prev) => ({
                      ...prev,
                      class_code: value === "__all__" ? "" : value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All classes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All classes</SelectItem>
                    {classRows.map((row) => (
                      <SelectItem key={row.id} value={row.code}>
                        {row.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Status</Label>
                <Select
                  value={timetableFilters.status || "__all__"}
                  onValueChange={(value) =>
                    setTimetableFilters((prev) => ({
                      ...prev,
                      status: value === "__all__" ? "" : value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All statuses</SelectItem>
                    {EXAM_STATUS_OPTIONS.map((row) => (
                      <SelectItem key={row} value={row}>
                        {row}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">From Date</Label>
                <Input
                  type="date"
                  value={timetableFilters.date_from}
                  onChange={(e) =>
                    setTimetableFilters((prev) => ({ ...prev, date_from: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">To Date</Label>
                <Input
                  type="date"
                  value={timetableFilters.date_to}
                  onChange={(e) =>
                    setTimetableFilters((prev) => ({ ...prev, date_to: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-100 [&_table]:min-w-[900px]">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="text-xs">Exam</TableHead>
                    <TableHead className="text-xs">Term</TableHead>
                    <TableHead className="text-xs">Class</TableHead>
                    <TableHead className="text-xs">Subject</TableHead>
                    <TableHead className="text-xs">Invigilator</TableHead>
                    <TableHead className="text-xs">Date Window</TableHead>
                    <TableHead className="text-xs">Time Window</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!loading &&
                    filteredTimetableRows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="text-sm font-medium text-slate-900">{row.name}</TableCell>
                        <TableCell className="text-xs text-slate-600">
                          {row.term_code || row.term_name || "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-slate-600">{row.class_code}</TableCell>
                        <TableCell className="text-sm text-slate-700">
                          {row.subject_code ? `${row.subject_code} - ${row.subject_name || "Subject"}` : "General"}
                        </TableCell>
                        <TableCell className="text-sm text-slate-700">
                          {row.invigilator_name || "Not assigned"}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600">
                          {formatDateRange(row.start_date, row.end_date)}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600">
                          {formatTimeRange(row.start_time, row.end_time)}
                        </TableCell>
                        <TableCell>
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                              row.status === "COMPLETED"
                                ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                                : row.status === "ONGOING"
                                  ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200"
                                  : row.status === "CANCELLED"
                                    ? "bg-red-50 text-red-700 ring-1 ring-red-200"
                                    : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                            }`}
                          >
                            {row.status}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          {row.status !== "COMPLETED" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={updatingExamId === row.id}
                              onClick={() => void updateExamStatus(row.id, "COMPLETED")}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Mark Done
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  {!loading && filteredTimetableRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="py-10 text-center text-sm text-slate-400">
                        No exams match the current timetable filters.
                      </TableCell>
                    </TableRow>
                  )}
                  {loading && (
                    <TableRow>
                      <TableCell colSpan={9} className="py-10 text-center text-sm text-slate-400">
                        Loading timetable...
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
        )}

        {section === "progress" && (
        <div className="grid gap-5 xl:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-4 sm:px-6">
              <h2 className="text-sm font-semibold text-slate-900">Record Student Marks</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Capture marks per student per subject for each exam.
              </p>
            </div>
            <div className="space-y-3 p-4 sm:p-6">
              <div className="space-y-1.5">
                <Label className="text-xs">Exam</Label>
                <Select
                  value={markForm.exam_id || "__none__"}
                  onValueChange={(value) =>
                    setMarkForm((prev) => ({
                      ...prev,
                      exam_id: value === "__none__" ? "" : value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select exam" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Select exam...</SelectItem>
                    {examOptionsForProgress.map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {(row.term_code || "TERM")} - {row.name} - {row.class_code} - {row.start_date}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Class Code</Label>
                  <Input
                    placeholder="GRADE_7"
                    value={markForm.class_code}
                    onChange={(e) =>
                      setMarkForm((prev) => ({ ...prev, class_code: e.target.value.toUpperCase() }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Subject</Label>
                  <Select
                    value={markForm.subject_id || "__none__"}
                    onValueChange={(value) =>
                      setMarkForm((prev) => ({
                        ...prev,
                        subject_id: value === "__none__" ? "" : value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select subject" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Select subject...</SelectItem>
                      {subjectRows.map((row) => (
                        <SelectItem key={row.id} value={row.id}>
                          {row.code} - {row.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Student</Label>
                <Select
                  value={markForm.student_enrollment_id || "__none__"}
                  onValueChange={(value) =>
                    setMarkForm((prev) => ({
                      ...prev,
                      student_enrollment_id: value === "__none__" ? "" : value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select student" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Select student...</SelectItem>
                    {studentOptions.map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {studentName(row.payload || {})}
                        {admissionNumber(row) ? ` (${admissionNumber(row)})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Marks Obtained</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="e.g. 72"
                    value={markForm.marks_obtained}
                    onChange={(e) =>
                      setMarkForm((prev) => ({ ...prev, marks_obtained: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Max Marks</Label>
                  <Input
                    type="number"
                    min={1}
                    step="0.01"
                    value={markForm.max_marks}
                    onChange={(e) => setMarkForm((prev) => ({ ...prev, max_marks: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Grade</Label>
                  <Input
                    placeholder="A, B+, C..."
                    value={markForm.grade}
                    onChange={(e) => setMarkForm((prev) => ({ ...prev, grade: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Remarks</Label>
                  <Input
                    placeholder="Optional remark"
                    value={markForm.remarks}
                    onChange={(e) => setMarkForm((prev) => ({ ...prev, remarks: e.target.value }))}
                  />
                </div>
              </div>

              <Button onClick={() => void saveMark()} disabled={savingMark}>
                {savingMark ? "Saving..." : "Save Student Mark"}
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-4 sm:px-6">
              <div className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-slate-500" />
                <h2 className="text-sm font-semibold text-slate-900">Recorded Marks</h2>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                {marksSummary.total} rows · {marksSummary.completedExams} exams · average{" "}
                {marksSummary.averagePercent}%
              </p>
            </div>
            <div className="p-4 sm:p-6">
              <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Term</Label>
                  <Select
                    value={marksFilters.term_id || "__all__"}
                    onValueChange={(value) =>
                      setMarksFilters((prev) => ({
                        ...prev,
                        term_id: value === "__all__" ? "" : value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All terms" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All terms</SelectItem>
                      {termRows.map((row) => (
                        <SelectItem key={row.id} value={row.id}>
                          {row.code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Exam</Label>
                  <Select
                    value={marksFilters.exam_id || "__all__"}
                    onValueChange={(value) =>
                      setMarksFilters((prev) => ({
                        ...prev,
                        exam_id: value === "__all__" ? "" : value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All exams" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All exams</SelectItem>
                      {examOptionsForProgress.map((row) => (
                        <SelectItem key={row.id} value={row.id}>
                          {row.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Class</Label>
                  <Select
                    value={marksFilters.class_code || "__all__"}
                    onValueChange={(value) =>
                      setMarksFilters((prev) => ({
                        ...prev,
                        class_code: value === "__all__" ? "" : value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All classes" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All classes</SelectItem>
                      {classRows.map((row) => (
                        <SelectItem key={row.id} value={row.code}>
                          {row.code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Subject</Label>
                  <Select
                    value={marksFilters.subject_id || "__all__"}
                    onValueChange={(value) =>
                      setMarksFilters((prev) => ({
                        ...prev,
                        subject_id: value === "__all__" ? "" : value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All subjects" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All subjects</SelectItem>
                      {subjectRows.map((row) => (
                        <SelectItem key={row.id} value={row.id}>
                          {row.code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-100 [&_table]:min-w-[900px]">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs">Student</TableHead>
                      <TableHead className="text-xs">Term</TableHead>
                      <TableHead className="text-xs">Exam</TableHead>
                      <TableHead className="text-xs">Class</TableHead>
                      <TableHead className="text-xs">Subject</TableHead>
                      <TableHead className="text-xs text-right">Score</TableHead>
                      <TableHead className="text-xs">Grade</TableHead>
                      <TableHead className="text-xs">Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!loading &&
                      filteredMarksRows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="text-sm">
                            <div className="font-medium text-slate-900">{row.student_name}</div>
                            <div className="text-xs text-slate-500">{row.admission_number || "No admission no."}</div>
                          </TableCell>
                          <TableCell className="text-xs text-slate-500">
                            {row.term_code || row.term_name || "—"}
                          </TableCell>
                          <TableCell className="text-sm text-slate-700">{row.exam_name}</TableCell>
                          <TableCell className="font-mono text-xs text-slate-600">{row.class_code}</TableCell>
                          <TableCell className="text-sm text-slate-700">
                            {row.subject_code ? `${row.subject_code} - ${row.subject_name || "Subject"}` : "—"}
                          </TableCell>
                          <TableCell className="text-right text-sm font-semibold text-slate-900">
                            {toNumber(row.marks_obtained)} / {toNumber(row.max_marks)}
                          </TableCell>
                          <TableCell className="text-sm text-slate-700">{row.grade || "—"}</TableCell>
                          <TableCell className="text-xs text-slate-500">{row.updated_at || row.recorded_at || "—"}</TableCell>
                        </TableRow>
                      ))}
                    {!loading && filteredMarksRows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="py-10 text-center text-sm text-slate-400">
                          No marks recorded yet for the selected filters.
                        </TableCell>
                      </TableRow>
                    )}
                    {loading && (
                      <TableRow>
                        <TableCell colSpan={8} className="py-10 text-center text-sm text-slate-400">
                          Loading marks...
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        </div>
        )}

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 shadow-sm">
          <div className="flex items-start gap-2">
            <CalendarDays className="mt-0.5 h-4 w-4 text-slate-500" />
            <div>
              Timetable and marks are tenant-scoped and ordered for deterministic operations. Use the
              filters above to isolate a class, subject, or exam window before recording marks.
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
