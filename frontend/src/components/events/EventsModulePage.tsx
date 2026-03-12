"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, List, RefreshCw } from "lucide-react";

import { AppShell, type AppNavItem } from "@/components/layout/AppShell";
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
import { normalizeEvents, type TenantEvent } from "@/lib/events";
import { normalizeClassOptions, type TenantClassOption } from "@/lib/hr";
import { normalizeTerms, type TenantTerm } from "@/lib/school-setup/terms";
import {
  admissionNumber,
  normalizeEnrollmentRows,
  studentClass,
  studentName,
  type EnrollmentRow,
} from "@/lib/students";

type EventsModulePageProps = {
  appTitle: string;
  nav: AppNavItem[];
  activeHref?: string;
};

type EventForm = {
  name: string;
  term_id: string;
  academic_year: string;
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  location: string;
  description: string;
  target_scope: "ALL" | "CLASS" | "STUDENT" | "MIXED";
  class_codes: string[];
  student_enrollment_ids: string[];
};

type StudentOption = {
  id: string;
  student_name: string;
  admission_number: string;
  class_code: string;
};

type CalendarCell = {
  iso: string;
  date: Date;
  inMonth: boolean;
};

const defaultForm: EventForm = {
  name: "",
  term_id: "",
  academic_year: String(new Date().getFullYear()),
  start_date: "",
  end_date: "",
  start_time: "",
  end_time: "",
  location: "",
  description: "",
  target_scope: "ALL",
  class_codes: [],
  student_enrollment_ids: [],
};

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function scopeLabel(value: TenantEvent["target_scope"]): string {
  if (value === "CLASS") return "Classes";
  if (value === "STUDENT") return "Students";
  if (value === "MIXED") return "Mixed";
  return "Whole School";
}

function formatDateRange(startDate: string, endDate: string): string {
  if (!startDate && !endDate) return "-";
  if (!endDate || startDate === endDate) return startDate || endDate;
  return `${startDate} to ${endDate}`;
}

function formatTimeRange(startTime: string | null, endTime: string | null): string {
  const start = (startTime || "").trim();
  const end = (endTime || "").trim();
  if (!start && !end) return "-";
  if (start && !end) return start;
  if (!start && end) return end;
  return `${start} - ${end}`;
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

function eventChipLabel(row: TenantEvent): string {
  const time = formatTimeRange(row.start_time, row.end_time);
  if (time === "-") return row.name;
  return `${time} ${row.name}`;
}

function eventSort(a: TenantEvent, b: TenantEvent): number {
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

function toEventForm(row: TenantEvent): EventForm {
  const normalizedScope: EventForm["target_scope"] =
    row.target_scope === "CLASS" ||
    row.target_scope === "STUDENT" ||
    row.target_scope === "MIXED"
      ? row.target_scope
      : "ALL";
  return {
    name: row.name,
    term_id: row.term_id || "",
    academic_year: String(row.academic_year),
    start_date: row.start_date,
    end_date: row.end_date,
    start_time: row.start_time || "",
    end_time: row.end_time || "",
    location: row.location || "",
    description: row.description || "",
    target_scope: normalizedScope,
    class_codes: [...row.class_codes],
    student_enrollment_ids: [...row.student_enrollment_ids],
  };
}

export function EventsModulePage({ appTitle, nav, activeHref }: EventsModulePageProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actioningEventId, setActioningEventId] = useState<string | null>(null);
  const [editingEvent, setEditingEvent] = useState<TenantEvent | null>(null);

  const [events, setEvents] = useState<TenantEvent[]>([]);
  const [terms, setTerms] = useState<TenantTerm[]>([]);
  const [classes, setClasses] = useState<TenantClassOption[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);

  const [form, setForm] = useState<EventForm>(defaultForm);

  const [search, setSearch] = useState("");
  const [termFilter, setTermFilter] = useState<string>("__all__");
  const [yearFilter, setYearFilter] = useState<string>("__all__");
  const [scopeFilter, setScopeFilter] = useState<string>("__all__");
  const [studentSearch, setStudentSearch] = useState("");
  const [viewMode, setViewMode] = useState<"table" | "calendar">("table");
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => startOfMonthLocal(new Date()));
  const [calendarDialogOpen, setCalendarDialogOpen] = useState(false);
  const [calendarDialogMode, setCalendarDialogMode] = useState<"entry" | "empty">("empty");
  const [calendarDialogDateIso, setCalendarDialogDateIso] = useState<string>("");
  const [calendarDialogEntry, setCalendarDialogEntry] = useState<TenantEvent | null>(null);

  const load = useCallback(async () => {
    setLoading(true);

    const requests: Array<Promise<unknown>> = [
      api.get("/tenants/events?limit=500&offset=0&include_inactive=true", {
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
      api.get("/enrollments/", {
        tenantRequired: true,
        noRedirect: true,
      }),
    ];

    const [eventsRes, termsRes, classesRes, enrollmentsRes] = await Promise.allSettled(requests);

    const errors: string[] = [];

    if (eventsRes.status === "fulfilled") {
      setEvents(normalizeEvents(eventsRes.value));
    } else {
      setEvents([]);
      errors.push("Failed to load events.");
    }

    if (termsRes.status === "fulfilled") {
      setTerms(normalizeTerms(termsRes.value));
    } else {
      setTerms([]);
      errors.push("Failed to load terms.");
    }

    if (classesRes.status === "fulfilled") {
      setClasses(normalizeClassOptions(classesRes.value));
    } else {
      setClasses([]);
      errors.push("Failed to load classes.");
    }

    if (enrollmentsRes.status === "fulfilled") {
      setEnrollments(normalizeEnrollmentRows(enrollmentsRes.value));
    } else {
      setEnrollments([]);
      errors.push("Failed to load students.");
    }

    if (errors.length > 0) {
      toast.error(errors[0]);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (terms.length === 0) return;
    setForm((prev) => {
      if (prev.term_id) return prev;
      return { ...prev, term_id: terms[0].id };
    });
  }, [terms]);

  const studentOptions = useMemo<StudentOption[]>(() => {
    return enrollments
      .map((row) => {
        const payload = row.payload || {};
        return {
          id: row.id,
          student_name: studentName(payload),
          admission_number: admissionNumber(row),
          class_code: studentClass(payload).trim().toUpperCase(),
        };
      })
      .sort((a, b) => {
        const classCmp = a.class_code.localeCompare(b.class_code);
        if (classCmp !== 0) return classCmp;
        return a.student_name.localeCompare(b.student_name);
      });
  }, [enrollments]);

  const studentOptionsFiltered = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return studentOptions;
    return studentOptions.filter((row) => {
      return (
        row.student_name.toLowerCase().includes(q) ||
        row.admission_number.toLowerCase().includes(q) ||
        row.class_code.toLowerCase().includes(q)
      );
    });
  }, [studentOptions, studentSearch]);

  const yearOptions = useMemo(() => {
    return Array.from(new Set(events.map((row) => String(row.academic_year)))).sort();
  }, [events]);

  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase();

    return events.filter((row) => {
      if (termFilter !== "__all__" && row.term_id !== termFilter) return false;
      if (yearFilter !== "__all__" && String(row.academic_year) !== yearFilter) return false;
      if (scopeFilter !== "__all__" && row.target_scope !== scopeFilter) return false;

      if (!q) return true;
      return (
        row.name.toLowerCase().includes(q) ||
        (row.term_code || "").toLowerCase().includes(q) ||
        (row.term_name || "").toLowerCase().includes(q) ||
        (row.location || "").toLowerCase().includes(q) ||
        row.class_codes.some((value) => value.toLowerCase().includes(q)) ||
        row.student_names.some((value) => value.toLowerCase().includes(q))
      );
    });
  }, [events, scopeFilter, search, termFilter, yearFilter]);

  const calendarCells = useMemo<CalendarCell[]>(() => {
    const monthStart = startOfMonthLocal(calendarMonth);
    const monthEnd = endOfMonthLocal(calendarMonth);
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
  }, [calendarMonth]);

  const calendarEventsByDay = useMemo(() => {
    if (calendarCells.length === 0) return {} as Record<string, TenantEvent[]>;

    const gridStart = calendarCells[0].date;
    const gridEnd = calendarCells[calendarCells.length - 1].date;
    const map: Record<string, TenantEvent[]> = {};

    for (const row of filteredEvents) {
      const eventStart = parseIsoDate(row.start_date);
      const eventEnd = parseIsoDate(row.end_date) || eventStart;
      if (!eventStart || !eventEnd) continue;

      const rangeStart = maxDate(eventStart, gridStart);
      const rangeEnd = minDate(eventEnd, gridEnd);
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
      map[key].sort(eventSort);
    }

    return map;
  }, [calendarCells, filteredEvents]);

  const calendarMonthLabel = useMemo(() => {
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      year: "numeric",
    }).format(calendarMonth);
  }, [calendarMonth]);
  const calendarDialogDayLabel = useMemo(
    () => formatCalendarDayLabel(calendarDialogDateIso),
    [calendarDialogDateIso]
  );

  function openEntryDialog(isoDate: string, row: TenantEvent) {
    setCalendarDialogDateIso(isoDate);
    setCalendarDialogEntry(row);
    setCalendarDialogMode("entry");
    setCalendarDialogOpen(true);
  }

  function openEmptyDayDialog(isoDate: string) {
    setCalendarDialogDateIso(isoDate);
    setCalendarDialogEntry(null);
    setCalendarDialogMode("empty");
    setCalendarDialogOpen(true);
  }

  function toggleClassCode(classCode: string) {
    setForm((prev) => {
      const exists = prev.class_codes.includes(classCode);
      return {
        ...prev,
        class_codes: exists
          ? prev.class_codes.filter((code) => code !== classCode)
          : [...prev.class_codes, classCode],
      };
    });
  }

  function toggleStudent(studentId: string) {
    setForm((prev) => {
      const exists = prev.student_enrollment_ids.includes(studentId);
      return {
        ...prev,
        student_enrollment_ids: exists
          ? prev.student_enrollment_ids.filter((id) => id !== studentId)
          : [...prev.student_enrollment_ids, studentId],
      };
    });
  }

  async function createEvent() {
    const editingEventId = editingEvent?.id || null;
    const name = form.name.trim();
    const termId = form.term_id.trim();
    const year = Number(form.academic_year);
    const startDate = form.start_date.trim();
    const endDate = form.end_date.trim() || startDate;
    const startTime = form.start_time.trim();
    const endTime = form.end_time.trim();

    if (!name || !termId || !startDate) {
      toast.error("Event name, term, and start date are required.");
      return;
    }
    if (!Number.isFinite(year) || year < 2000 || year > 2200) {
      toast.error("Academic year must be a valid year.");
      return;
    }
    if (endTime && startTime && endTime < startTime && startDate === endDate) {
      toast.error("End time cannot be earlier than start time.");
      return;
    }

    const classCodes =
      form.target_scope === "CLASS" || form.target_scope === "MIXED" ? form.class_codes : [];
    const studentIds =
      form.target_scope === "STUDENT" || form.target_scope === "MIXED"
        ? form.student_enrollment_ids
        : [];

    if (form.target_scope === "CLASS" && classCodes.length === 0) {
      toast.error("Select at least one class for class-targeted events.");
      return;
    }
    if (form.target_scope === "STUDENT" && studentIds.length === 0) {
      toast.error("Select at least one student for student-targeted events.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name,
        term_id: termId,
        academic_year: year,
        start_date: startDate,
        end_date: endDate,
        start_time: startTime || null,
        end_time: endTime || null,
        location: form.location.trim() || null,
        description: form.description.trim() || null,
        class_codes: classCodes,
        student_enrollment_ids: studentIds,
        is_active: editingEvent ? editingEvent.is_active : true,
      };

      if (editingEventId) {
        await api.put(`/tenants/events/${editingEventId}`, payload, { tenantRequired: true });
      } else {
        await api.post("/tenants/events", payload, { tenantRequired: true });
      }

      toast.success(editingEventId ? "Event updated." : "Event created.");
      setEditingEvent(null);
      setForm((prev) => ({
        ...defaultForm,
        term_id: prev.term_id,
        academic_year: prev.academic_year,
        target_scope: prev.target_scope,
      }));
      setStudentSearch("");
      await load();
    } catch (err: any) {
      toast.error(
        typeof err?.message === "string"
          ? err.message
          : editingEventId
            ? "Failed to update event"
            : "Failed to create event"
      );
    } finally {
      setSaving(false);
    }
  }

  function startEditingEvent(row: TenantEvent) {
    setEditingEvent(row);
    setForm(toEventForm(row));
    setStudentSearch("");
    const start = parseIsoDate(row.start_date);
    if (start) {
      setCalendarMonth(startOfMonthLocal(start));
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEditingEvent() {
    setEditingEvent(null);
    setForm((prev) => ({
      ...defaultForm,
      term_id: prev.term_id || terms[0]?.id || "",
      academic_year: String(new Date().getFullYear()),
      target_scope: "ALL",
    }));
    setStudentSearch("");
  }

  async function setEventActive(row: TenantEvent, isActive: boolean) {
    setActioningEventId(row.id);
    try {
      await api.put(
        `/tenants/events/${row.id}`,
        { is_active: isActive },
        { tenantRequired: true }
      );
      toast.success(isActive ? "Event activated." : "Event deactivated.");
      await load();
    } catch (err: any) {
      toast.error(typeof err?.message === "string" ? err.message : "Failed to update event status");
    } finally {
      setActioningEventId(null);
    }
  }

  async function deleteEvent(row: TenantEvent) {
    const confirmed = window.confirm(
      `Delete event \"${row.name}\" permanently? This cannot be undone.`
    );
    if (!confirmed) return;

    setActioningEventId(row.id);
    try {
      await api.delete(`/tenants/events/${row.id}`, undefined, { tenantRequired: true });
      toast.success("Event deleted.");
      await load();
    } catch (err: any) {
      toast.error(typeof err?.message === "string" ? err.message : "Failed to delete event");
    } finally {
      setActioningEventId(null);
    }
  }

  return (
    <AppShell title={appTitle} nav={nav} activeHref={activeHref}>
      <div className="space-y-5">
        <div className="dashboard-hero rounded-[2rem] p-4 text-white shadow-sm sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-bold">Events Module</h1>
              <p className="mt-0.5 text-sm text-blue-100">
                Term-scoped school events mapped to classes or students across the academic year.
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

        <div className="dashboard-surface rounded-[1.6rem]">
          <div className="border-b border-slate-100 px-4 py-4 sm:px-6">
            <h2 className="text-sm font-semibold text-slate-900">
              {editingEvent ? "Update Event" : "Create Event"}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {editingEvent
                ? "Update all event details, then save to publish changes in timetable views."
                : "Map each event to one term, then target the whole school, selected classes, selected students, or both."}
            </p>
          </div>
          <div className="p-4 sm:p-6">
            {editingEvent && (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Editing <span className="font-semibold">{editingEvent.name}</span>. Save to apply
                changes or cancel to keep the current record.
              </div>
            )}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Event Name</Label>
                <Input
                  placeholder="Academic Day"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Term</Label>
                <Select
                  value={form.term_id || "__none__"}
                  onValueChange={(value) =>
                    setForm((prev) => ({ ...prev, term_id: value === "__none__" ? "" : value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select term" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Select term...</SelectItem>
                    {terms.map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.code} - {row.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Academic Year</Label>
                <Input
                  type="number"
                  min={2000}
                  max={2200}
                  value={form.academic_year}
                  onChange={(e) => setForm((prev) => ({ ...prev, academic_year: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Start Date</Label>
                <Input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm((prev) => ({ ...prev, start_date: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">End Date</Label>
                <Input
                  type="date"
                  value={form.end_date}
                  onChange={(e) => setForm((prev) => ({ ...prev, end_date: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Target Scope</Label>
                <Select
                  value={form.target_scope}
                  onValueChange={(value) =>
                    setForm((prev) => ({
                      ...prev,
                      target_scope: value as EventForm["target_scope"],
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Whole School</SelectItem>
                    <SelectItem value="CLASS">Classes</SelectItem>
                    <SelectItem value="STUDENT">Students</SelectItem>
                    <SelectItem value="MIXED">Classes + Students</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Start Time</Label>
                <Input
                  type="time"
                  value={form.start_time}
                  onChange={(e) => setForm((prev) => ({ ...prev, start_time: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">End Time</Label>
                <Input
                  type="time"
                  value={form.end_time}
                  onChange={(e) => setForm((prev) => ({ ...prev, end_time: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5 md:col-span-2 xl:col-span-1">
                <Label className="text-xs">Location</Label>
                <Input
                  placeholder="Main hall"
                  value={form.location}
                  onChange={(e) => setForm((prev) => ({ ...prev, location: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5 md:col-span-2 xl:col-span-3">
                <Label className="text-xs">Description</Label>
                <Textarea
                  rows={3}
                  placeholder="Agenda, logistics, and event notes"
                  value={form.description}
                  onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                />
              </div>
            </div>

            {(form.target_scope === "CLASS" || form.target_scope === "MIXED") && (
              <div className="mt-4 rounded-xl border border-slate-200 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">Target Classes</h3>
                  <span className="text-xs text-slate-500">{form.class_codes.length} selected</span>
                </div>
                <div className="grid max-h-44 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
                  {classes.map((row) => {
                    const checked = form.class_codes.includes(row.code);
                    return (
                      <label
                        key={row.id}
                        className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleClassCode(row.code)}
                        />
                        <span className="font-mono">{row.code}</span>
                        <span className="text-slate-500">{row.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {(form.target_scope === "STUDENT" || form.target_scope === "MIXED") && (
              <div className="mt-4 rounded-xl border border-slate-200 p-3">
                <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">Target Students</h3>
                  <div className="flex items-center gap-2">
                    <Input
                      className="h-8 w-full text-xs sm:w-64"
                      placeholder="Search student, class, ADM"
                      value={studentSearch}
                      onChange={(e) => setStudentSearch(e.target.value)}
                    />
                    <span className="whitespace-nowrap text-xs text-slate-500">
                      {form.student_enrollment_ids.length} selected
                    </span>
                  </div>
                </div>
                <div className="grid max-h-56 gap-2 overflow-y-auto pr-1 lg:grid-cols-2">
                  {studentOptionsFiltered.map((row) => {
                    const checked = form.student_enrollment_ids.includes(row.id);
                    return (
                      <label
                        key={row.id}
                        className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleStudent(row.id)}
                        />
                        <span className="truncate font-medium text-slate-800">{row.student_name}</span>
                        <span className="font-mono text-slate-500">{row.class_code || "N/A"}</span>
                        <span className="font-mono text-slate-500">{row.admission_number || "-"}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button onClick={() => void createEvent()} disabled={saving}>
                {saving ? (editingEvent ? "Updating..." : "Saving...") : editingEvent ? "Update Event" : "Create Event"}
              </Button>
              {editingEvent && (
                <Button variant="outline" onClick={cancelEditingEvent} disabled={saving}>
                  Cancel Edit
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="dashboard-surface rounded-[1.6rem]">
          <div className="border-b border-slate-100 px-4 py-4 sm:px-6">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-blue-600" />
              <h2 className="text-sm font-semibold text-slate-900">Academic Year Events</h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Filter by term, year, and scope. Switch between table and calendar timetable views.
            </p>
          </div>

          <div className="p-4 sm:p-6">
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <Input
                placeholder="Search by name, term, location..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />

              <Select value={termFilter} onValueChange={setTermFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All terms" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All terms</SelectItem>
                  {terms.map((row) => (
                    <SelectItem key={row.id} value={row.id}>
                      {row.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={yearFilter} onValueChange={setYearFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All years" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All years</SelectItem>
                  {yearOptions.map((year) => (
                    <SelectItem key={year} value={year}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={scopeFilter} onValueChange={setScopeFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All scopes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All scopes</SelectItem>
                  <SelectItem value="ALL">Whole School</SelectItem>
                  <SelectItem value="CLASS">Classes</SelectItem>
                  <SelectItem value="STUDENT">Students</SelectItem>
                  <SelectItem value="MIXED">Mixed</SelectItem>
                </SelectContent>
              </Select>

              <div className="flex items-center gap-2">
                <Button
                  variant={viewMode === "table" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setViewMode("table")}
                >
                  <List className="h-3.5 w-3.5" />
                  Table
                </Button>
                <Button
                  variant={viewMode === "calendar" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setViewMode("calendar")}
                >
                  <CalendarDays className="h-3.5 w-3.5" />
                  Calendar
                </Button>
              </div>

              <Button
                variant="outline"
                onClick={() => {
                  setSearch("");
                  setTermFilter("__all__");
                  setYearFilter("__all__");
                  setScopeFilter("__all__");
                }}
              >
                Reset Filters
              </Button>
            </div>

            {viewMode === "table" && (
              <div className="overflow-x-auto rounded-xl border border-slate-100 [&_table]:min-w-[1120px]">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs">Event</TableHead>
                      <TableHead className="text-xs">Term</TableHead>
                      <TableHead className="text-xs">Year</TableHead>
                      <TableHead className="text-xs">Date</TableHead>
                      <TableHead className="text-xs">Time</TableHead>
                      <TableHead className="text-xs">Scope</TableHead>
                      <TableHead className="text-xs">Targets</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs">Location</TableHead>
                      <TableHead className="text-xs text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!loading &&
                      filteredEvents.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="text-sm font-medium text-slate-900">{row.name}</TableCell>
                          <TableCell className="text-xs text-slate-600">
                            {row.term_code || row.term_name || "-"}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-slate-600">
                            {row.academic_year}
                          </TableCell>
                          <TableCell className="text-xs text-slate-600">
                            {formatDateRange(row.start_date, row.end_date)}
                          </TableCell>
                          <TableCell className="text-xs text-slate-600">
                            {formatTimeRange(row.start_time, row.end_time)}
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-blue-200">
                              {scopeLabel(row.target_scope)}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs text-slate-700">
                            <div>
                              Classes: {row.class_codes.length} | Students: {row.student_enrollment_ids.length}
                            </div>
                            {row.class_codes.length > 0 && (
                              <div className="mt-0.5 truncate text-[11px] text-slate-500">
                                {row.class_codes.join(", ")}
                              </div>
                            )}
                            {row.student_names.length > 0 && (
                              <div className="mt-0.5 truncate text-[11px] text-slate-500">
                                {row.student_names.join(", ")}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                                row.is_active
                                  ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                                  : "bg-slate-100 text-slate-600 ring-slate-200"
                              }`}
                            >
                              {row.is_active ? "Active" : "Inactive"}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs text-slate-600">{row.location || "-"}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                size="xs"
                                variant="outline"
                                disabled={actioningEventId === row.id || saving}
                                onClick={() => startEditingEvent(row)}
                              >
                                Edit
                              </Button>
                              <Button
                                size="xs"
                                variant="outline"
                                disabled={actioningEventId === row.id}
                                onClick={() => void setEventActive(row, !row.is_active)}
                              >
                                {row.is_active ? "Deactivate" : "Activate"}
                              </Button>
                              <Button
                                size="xs"
                                variant="destructive"
                                disabled={actioningEventId === row.id}
                                onClick={() => void deleteEvent(row)}
                              >
                                Delete
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}

                    {!loading && filteredEvents.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={10} className="py-8 text-center text-sm text-slate-500">
                          No events match the current filters.
                        </TableCell>
                      </TableRow>
                    )}

                    {loading && (
                      <TableRow>
                        <TableCell colSpan={10} className="py-8 text-center text-sm text-slate-500">
                          Loading events...
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}

            {viewMode === "calendar" && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Button
                      size="icon-sm"
                      variant="outline"
                      onClick={() => setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="outline"
                      onClick={() => setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setCalendarMonth(startOfMonthLocal(new Date()))}
                    >
                      Today
                    </Button>
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900">{calendarMonthLabel}</h3>
                  <div className="text-xs text-slate-500">{filteredEvents.length} filtered events</div>
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

                  {calendarCells.map((cell) => {
                    const dayEvents = calendarEventsByDay[cell.iso] || [];
                    const visible = dayEvents.slice(0, 3);
                    const extra = Math.max(0, dayEvents.length - visible.length);

                    return (
                      <div
                        key={cell.iso}
                        role={dayEvents.length === 0 ? "button" : undefined}
                        tabIndex={dayEvents.length === 0 ? 0 : -1}
                        onClick={() => {
                          if (dayEvents.length === 0) {
                            openEmptyDayDialog(cell.iso);
                          }
                        }}
                        onKeyDown={(event) => {
                          if ((event.key === "Enter" || event.key === " ") && dayEvents.length === 0) {
                            event.preventDefault();
                            openEmptyDayDialog(cell.iso);
                          }
                        }}
                        className={`min-h-28 rounded-lg border p-2 ${
                          cell.inMonth ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50"
                        } ${
                          dayEvents.length === 0 ? "cursor-pointer hover:ring-1 hover:ring-blue-200" : ""
                        }`}
                      >
                        <div className="mb-1 flex items-center justify-between">
                          <span className={`text-xs font-semibold ${cell.inMonth ? "text-slate-800" : "text-slate-400"}`}>
                            {cell.date.getDate()}
                          </span>
                          {dayEvents.length > 0 && (
                            <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                              {dayEvents.length}
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
                                row.is_active
                                  ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                                  : "bg-slate-100 text-slate-500 ring-1 ring-slate-200"
                              } hover:brightness-95`}
                              title={`${row.name} (${formatDateRange(row.start_date, row.end_date)})`}
                            >
                              {eventChipLabel(row)}
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
                    Timetable entry for {calendarDialogDayLabel}. Review the full event schedule details below.
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
                    <div className="text-xs text-slate-500">Scope</div>
                    <div className="font-medium text-slate-800">{scopeLabel(calendarDialogEntry.target_scope)}</div>
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
                    <div className="text-xs text-slate-500">Targets</div>
                    <div className="font-medium text-slate-800">
                      Classes: {calendarDialogEntry.class_codes.length} | Students:{" "}
                      {calendarDialogEntry.student_enrollment_ids.length}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-xs text-slate-500">Status</div>
                    <div>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          calendarDialogEntry.is_active
                            ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                            : "bg-slate-100 text-slate-600 ring-1 ring-slate-200"
                        }`}
                      >
                        {calendarDialogEntry.is_active ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 sm:col-span-2">
                    <div className="text-xs text-slate-500">Location</div>
                    <div className="font-medium text-slate-800">{calendarDialogEntry.location || "—"}</div>
                  </div>
                </div>

                {calendarDialogEntry.description && (
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <div className="text-xs text-slate-500">Description</div>
                    <div className="mt-1 text-sm text-slate-700">{calendarDialogEntry.description}</div>
                  </div>
                )}

                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      startEditingEvent(calendarDialogEntry);
                      setCalendarDialogOpen(false);
                    }}
                  >
                    Edit Event
                  </Button>
                  <Button
                    disabled={actioningEventId === calendarDialogEntry.id}
                    onClick={() =>
                      void setEventActive(calendarDialogEntry, !calendarDialogEntry.is_active)
                    }
                  >
                    {calendarDialogEntry.is_active ? "Deactivate" : "Activate"}
                  </Button>
                  <Button variant="outline" onClick={() => setCalendarDialogOpen(false)}>
                    Close
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle className="text-slate-900">No Event For This Day</DialogTitle>
                  <DialogDescription>{calendarDialogDayLabel}</DialogDescription>
                </DialogHeader>
                <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                  No event timetable entry is scheduled for this day.
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
      </div>
    </AppShell>
  );
}
