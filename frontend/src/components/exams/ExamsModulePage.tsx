"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  List,
  RefreshCw,
} from "lucide-react";

import { AppShell, type AppNavItem } from "@/components/layout/AppShell";
import type { ExamSection } from "@/components/layout/nav-config";
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

type CalendarCell = {
  iso: string;
  date: Date;
  inMonth: boolean;
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
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

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

function startOfMonthLocal(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonthLocal(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function addDaysLocal(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function startOfWeekMonday(date: Date): Date {
  const day = (date.getDay() + 6) % 7;
  return addDaysLocal(date, -day);
}

function endOfWeekSunday(date: Date): Date {
  const day = (date.getDay() + 6) % 7;
  return addDaysLocal(date, 6 - day);
}

function toIsoDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const token = value.trim();
  if (!token) return null;
  const parsed = new Date(`${token}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function minDate(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

function maxDate(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

function examChipLabel(row: TenantExam): string {
  const time = formatTimeRange(row.start_time, row.end_time);
  const prefix = time === "—" ? "" : `${time} `;
  return `${prefix}${row.class_code} ${row.name}`.trim();
}

function examSortByTimeAndName(a: TenantExam, b: TenantExam): number {
  const byTime = (a.start_time || "").localeCompare(b.start_time || "");
  if (byTime !== 0) return byTime;
  return a.name.localeCompare(b.name);
}

function formatCalendarDayLabel(isoDate: string): string {
  const parsed = parseIsoDate(isoDate);
  if (!parsed) return isoDate;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(parsed);
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
  const [timetableViewMode, setTimetableViewMode] = useState<"table" | "calendar">("table");
  const [timetableCalendarMonth, setTimetableCalendarMonth] = useState<Date>(() =>
    startOfMonthLocal(new Date())
  );
  const [calendarDialogOpen, setCalendarDialogOpen] = useState(false);
  const [calendarDialogMode, setCalendarDialogMode] = useState<"entry" | "empty">("empty");
  const [calendarDialogDateIso, setCalendarDialogDateIso] = useState<string>("");
  const [calendarDialogEntry, setCalendarDialogEntry] = useState<TenantExam | null>(null);

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

  const timetableCalendarCells = useMemo<CalendarCell[]>(() => {
    const monthStart = startOfMonthLocal(timetableCalendarMonth);
    const monthEnd = endOfMonthLocal(timetableCalendarMonth);
    const gridStart = startOfWeekMonday(monthStart);
    const gridEnd = endOfWeekSunday(monthEnd);

    const cells: CalendarCell[] = [];
    for (let cursor = gridStart; cursor.getTime() <= gridEnd.getTime(); cursor = addDaysLocal(cursor, 1)) {
      cells.push({
        iso: toIsoDateKey(cursor),
        date: new Date(cursor.getTime()),
        inMonth: cursor.getMonth() === monthStart.getMonth(),
      });
    }
    return cells;
  }, [timetableCalendarMonth]);

  const timetableByDay = useMemo(() => {
    if (timetableCalendarCells.length === 0) return {} as Record<string, TenantExam[]>;

    const gridStart = timetableCalendarCells[0].date;
    const gridEnd = timetableCalendarCells[timetableCalendarCells.length - 1].date;
    const map: Record<string, TenantExam[]> = {};

    for (const row of filteredTimetableRows) {
      const examStart = parseIsoDate(row.start_date);
      const examEnd = parseIsoDate(row.end_date) || examStart;
      if (!examStart || !examEnd) continue;

      const rangeStart = maxDate(examStart, gridStart);
      const rangeEnd = minDate(examEnd, gridEnd);
      if (rangeStart.getTime() > rangeEnd.getTime()) continue;

      let cursor = rangeStart;
      let guard = 0;
      while (cursor.getTime() <= rangeEnd.getTime() && guard < 370) {
        const key = toIsoDateKey(cursor);
        if (!map[key]) map[key] = [];
        map[key].push(row);
        cursor = addDaysLocal(cursor, 1);
        guard += 1;
      }
    }

    for (const key of Object.keys(map)) {
      map[key].sort(examSortByTimeAndName);
    }

    return map;
  }, [filteredTimetableRows, timetableCalendarCells]);

  const timetableMonthLabel = useMemo(() => {
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      year: "numeric",
    }).format(timetableCalendarMonth);
  }, [timetableCalendarMonth]);

  const calendarDialogDayLabel = useMemo(
    () => formatCalendarDayLabel(calendarDialogDateIso),
    [calendarDialogDateIso]
  );

  function openEmptyDayDialog(isoDate: string) {
    setCalendarDialogMode("empty");
    setCalendarDialogDateIso(isoDate);
    setCalendarDialogEntry(null);
    setCalendarDialogOpen(true);
  }

  function openEntryDialog(isoDate: string, row: TenantExam) {
    setCalendarDialogMode("entry");
    setCalendarDialogDateIso(isoDate);
    setCalendarDialogEntry(row);
    setCalendarDialogOpen(true);
  }

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

  async function markDialogEntryDone() {
    if (!calendarDialogEntry || calendarDialogEntry.status === "COMPLETED") return;
    await updateExamStatus(calendarDialogEntry.id, "COMPLETED");
    setCalendarDialogOpen(false);
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
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
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
              <div className="flex items-end gap-2">
                <Button
                  variant={timetableViewMode === "table" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTimetableViewMode("table")}
                >
                  <List className="h-3.5 w-3.5" />
                  Table
                </Button>
                <Button
                  variant={timetableViewMode === "calendar" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTimetableViewMode("calendar")}
                >
                  <CalendarDays className="h-3.5 w-3.5" />
                  Calendar
                </Button>
              </div>
              <div className="flex items-end">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    setTimetableFilters({
                      term_id: "",
                      class_code: "",
                      status: "",
                      date_from: "",
                      date_to: "",
                    })
                  }
                >
                  Reset Filters
                </Button>
              </div>
            </div>

            {timetableViewMode === "table" && (
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
            )}

            {timetableViewMode === "calendar" && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Button
                      size="icon-sm"
                      variant="outline"
                      onClick={() =>
                        setTimetableCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
                      }
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="outline"
                      onClick={() =>
                        setTimetableCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
                      }
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setTimetableCalendarMonth(startOfMonthLocal(new Date()))}
                    >
                      Today
                    </Button>
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900">{timetableMonthLabel}</h3>
                  <div className="text-xs text-slate-500">{filteredTimetableRows.length} filtered exams</div>
                </div>

                <div className="grid grid-cols-7 gap-2">
                  {WEEKDAY_LABELS.map((label) => (
                    <div
                      key={label}
                      className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-center text-xs font-semibold text-slate-700"
                    >
                      {label}
                    </div>
                  ))}

                  {timetableCalendarCells.map((cell) => {
                    const dayExams = timetableByDay[cell.iso] || [];
                    const visible = dayExams.slice(0, 3);
                    const extra = Math.max(0, dayExams.length - visible.length);

                    return (
                      <div
                        key={cell.iso}
                        role={dayExams.length === 0 ? "button" : undefined}
                        tabIndex={dayExams.length === 0 ? 0 : -1}
                        onClick={() => {
                          if (dayExams.length === 0) {
                            openEmptyDayDialog(cell.iso);
                          }
                        }}
                        onKeyDown={(event) => {
                          if ((event.key === "Enter" || event.key === " ") && dayExams.length === 0) {
                            event.preventDefault();
                            openEmptyDayDialog(cell.iso);
                          }
                        }}
                        className={`min-h-28 rounded-lg border p-2 ${
                          cell.inMonth
                            ? "border-slate-200 bg-white"
                            : "border-slate-100 bg-slate-50"
                        } ${
                          dayExams.length === 0
                            ? "cursor-pointer hover:ring-1 hover:ring-blue-200"
                            : ""
                        }`}
                      >
                        <div className="mb-1 flex items-center justify-between">
                          <span className={`text-xs font-semibold ${cell.inMonth ? "text-slate-800" : "text-slate-400"}`}>
                            {cell.date.getDate()}
                          </span>
                          {dayExams.length > 0 && (
                            <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                              {dayExams.length}
                            </span>
                          )}
                        </div>

                        <div className="space-y-1">
                          {visible.map((row) => (
                            <button
                              type="button"
                              key={`${cell.iso}-${row.id}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                openEntryDialog(cell.iso, row);
                              }}
                              className={`truncate rounded px-1.5 py-1 text-[10px] font-medium ${
                                row.status === "COMPLETED"
                                  ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                                  : row.status === "ONGOING"
                                    ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200"
                                    : row.status === "CANCELLED"
                                      ? "bg-red-50 text-red-700 ring-1 ring-red-200"
                                      : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                              } hover:brightness-95`}
                              title={`${row.name} (${formatDateRange(row.start_date, row.end_date)})`}
                            >
                              {examChipLabel(row)}
                            </button>
                          ))}
                          {extra > 0 && (
                            <div className="text-[10px] font-medium text-slate-500">+{extra} more</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
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

        <Dialog open={calendarDialogOpen} onOpenChange={setCalendarDialogOpen}>
          <DialogContent className="sm:max-w-xl">
            {calendarDialogMode === "entry" && calendarDialogEntry ? (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-slate-900">
                    <CalendarDays className="h-4 w-4 text-blue-600" />
                    {calendarDialogEntry.name}
                  </DialogTitle>
                  <DialogDescription>
                    Timetable entry for {calendarDialogDayLabel}. Review the full exam schedule details below.
                  </DialogDescription>
                </DialogHeader>

                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-xs text-slate-500">Term</div>
                    <div className="font-medium text-slate-800">
                      {calendarDialogEntry.term_code || calendarDialogEntry.term_name || "—"}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-xs text-slate-500">Class</div>
                    <div className="font-mono font-medium text-slate-800">{calendarDialogEntry.class_code}</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-xs text-slate-500">Subject</div>
                    <div className="font-medium text-slate-800">
                      {calendarDialogEntry.subject_code
                        ? `${calendarDialogEntry.subject_code} - ${calendarDialogEntry.subject_name || "Subject"}`
                        : "General"}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-xs text-slate-500">Invigilator</div>
                    <div className="font-medium text-slate-800">{calendarDialogEntry.invigilator_name || "Not assigned"}</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-xs text-slate-500">Date Window</div>
                    <div className="font-medium text-slate-800">
                      {formatDateRange(calendarDialogEntry.start_date, calendarDialogEntry.end_date)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-xs text-slate-500">Time Window</div>
                    <div className="font-medium text-slate-800">
                      {formatTimeRange(calendarDialogEntry.start_time, calendarDialogEntry.end_time)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-xs text-slate-500">Status</div>
                    <div>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          calendarDialogEntry.status === "COMPLETED"
                            ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                            : calendarDialogEntry.status === "ONGOING"
                              ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200"
                              : calendarDialogEntry.status === "CANCELLED"
                                ? "bg-red-50 text-red-700 ring-1 ring-red-200"
                                : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                        }`}
                      >
                        {calendarDialogEntry.status}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-xs text-slate-500">Location</div>
                    <div className="font-medium text-slate-800">{calendarDialogEntry.location || "—"}</div>
                  </div>
                </div>

                {calendarDialogEntry.notes && (
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <div className="text-xs text-slate-500">Notes</div>
                    <div className="mt-1 text-sm text-slate-700">{calendarDialogEntry.notes}</div>
                  </div>
                )}

                <DialogFooter>
                  {calendarDialogEntry.status !== "COMPLETED" && (
                    <Button
                      disabled={updatingExamId === calendarDialogEntry.id}
                      onClick={() => void markDialogEntryDone()}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Mark Done
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => setCalendarDialogOpen(false)}>
                    Close
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle className="text-slate-900">No Event For This Day</DialogTitle>
                  <DialogDescription>
                    {calendarDialogDayLabel}
                  </DialogDescription>
                </DialogHeader>
                <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                  No exam timetable entry is scheduled for this day.
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCalendarDialogOpen(false)}>
                    Close
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>

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
