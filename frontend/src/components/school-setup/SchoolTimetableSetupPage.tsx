"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, FileDown, List, Printer, RefreshCw } from "lucide-react";

import { AppShell, type AppNavItem } from "@/components/layout/AppShell";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { api, apiFetchRaw } from "@/lib/api";
import {
  normalizeClassOptions,
  normalizeStaff,
  normalizeSubjects,
  type TenantClassOption,
  type TenantStaff,
  type TenantSubject,
} from "@/lib/hr";
import { normalizeTerms, type TenantTerm } from "@/lib/school-setup/terms";
import {
  normalizeSchoolTimetable,
  TIMETABLE_DAYS,
  TIMETABLE_SLOT_TYPES,
  type SchoolTimetableEntry,
  type TimetableDay,
  type TimetableSlotType,
} from "@/lib/school-setup/timetable";

type SchoolTimetableSetupPageProps = {
  appTitle: string;
  nav: AppNavItem[];
  activeHref: string;
  initialData?: SchoolTimetableSetupInitialData;
};

type SchoolTimetableSetupInitialData = {
  entries: SchoolTimetableEntry[];
  terms: TenantTerm[];
  classes: TenantClassOption[];
  subjects: TenantSubject[];
  teachers: TenantStaff[];
  fallbackUsed: boolean;
  initialError: string | null;
};

type TimetableForm = {
  term_id: string;
  class_code: string;
  day_of_week: TimetableDay;
  slot_type: TimetableSlotType;
  title: string;
  subject_id: string;
  staff_id: string;
  start_time: string;
  end_time: string;
  location: string;
  notes: string;
  is_active: boolean;
  apply_break_globally: boolean;
};

const defaultForm: TimetableForm = {
  term_id: "",
  class_code: "",
  day_of_week: "MONDAY",
  slot_type: "LESSON",
  title: "",
  subject_id: "",
  staff_id: "",
  start_time: "",
  end_time: "",
  location: "",
  notes: "",
  is_active: true,
  apply_break_globally: true,
};

const DAY_LABELS: Record<TimetableDay, string> = {
  MONDAY: "Monday",
  TUESDAY: "Tuesday",
  WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday",
  FRIDAY: "Friday",
  SATURDAY: "Saturday",
  SUNDAY: "Sunday",
};

const SLOT_LABELS: Record<TimetableSlotType, string> = {
  LESSON: "Lesson",
  SHORT_BREAK: "Short Break",
  LONG_BREAK: "Long Break",
  LUNCH_BREAK: "Lunch Break",
  GAME_TIME: "Game Time",
  OTHER: "Other Activity",
};

const TABLE_PAGE_SIZE_OPTIONS = [12, 20, 30, 40, 50] as const;

const BREAK_SLOT_TYPES = [
  "SHORT_BREAK",
  "LONG_BREAK",
  "LUNCH_BREAK",
  "GAME_TIME",
] as const;

type BreakSlotType = (typeof BREAK_SLOT_TYPES)[number];

type BreakPresetRow = {
  start_time: string;
  end_time: string;
  title: string;
  location: string;
  is_active: boolean;
};

type BreakPresetMap = Record<BreakSlotType, BreakPresetRow>;
type BulkSelectMode = "type" | "class" | "term";

const DEFAULT_BREAK_TITLES: Record<BreakSlotType, string> = {
  SHORT_BREAK: "Short Break",
  LONG_BREAK: "Long Break",
  LUNCH_BREAK: "Lunch Break",
  GAME_TIME: "Game Time",
};

function isLessonSlot(slotType: TimetableSlotType): boolean {
  return slotType === "LESSON";
}

function isBreakSlot(slotType: TimetableSlotType): slotType is BreakSlotType {
  return BREAK_SLOT_TYPES.includes(slotType as BreakSlotType);
}

function emptyBreakPreset(slotType: BreakSlotType): BreakPresetRow {
  return {
    start_time: "",
    end_time: "",
    title: DEFAULT_BREAK_TITLES[slotType],
    location: "",
    is_active: true,
  };
}

function buildBreakPresetMap(day: TimetableDay, rows: SchoolTimetableEntry[]): BreakPresetMap {
  const initial: BreakPresetMap = {
    SHORT_BREAK: emptyBreakPreset("SHORT_BREAK"),
    LONG_BREAK: emptyBreakPreset("LONG_BREAK"),
    LUNCH_BREAK: emptyBreakPreset("LUNCH_BREAK"),
    GAME_TIME: emptyBreakPreset("GAME_TIME"),
  };
  for (const slotType of BREAK_SLOT_TYPES) {
    const found = rows.find((row) => row.day_of_week === day && row.slot_type === slotType);
    if (!found) continue;
    initial[slotType] = {
      start_time: toTimeInput(found.start_time),
      end_time: toTimeInput(found.end_time),
      title: found.title || DEFAULT_BREAK_TITLES[slotType],
      location: found.location || "",
      is_active: found.is_active,
    };
  }
  return initial;
}

function toTimeInput(value: string | null | undefined): string {
  const token = String(value || "").trim();
  if (!token) return "";
  if (/^\d{2}:\d{2}:\d{2}$/.test(token)) return token.slice(0, 5);
  return token;
}

function formatTime(value: string): string {
  const token = String(value || "").trim();
  if (!token) return "—";
  if (/^\d{2}:\d{2}:\d{2}$/.test(token)) return token.slice(0, 5);
  return token;
}

function formatTimeRange(start: string, end: string): string {
  return `${formatTime(start)} - ${formatTime(end)}`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slotBadgeClass(row: SchoolTimetableEntry): string {
  if (!row.is_active) {
    return "bg-slate-100 text-slate-600 ring-slate-200";
  }
  if (row.slot_type === "SHORT_BREAK") return "bg-blue-50 text-blue-700 ring-blue-200";
  if (row.slot_type === "LONG_BREAK") return "bg-indigo-50 text-indigo-700 ring-indigo-200";
  if (row.slot_type === "LUNCH_BREAK") return "bg-amber-50 text-amber-700 ring-amber-200";
  if (row.slot_type === "GAME_TIME") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (row.slot_type === "OTHER") return "bg-violet-50 text-violet-700 ring-violet-200";
  return "bg-slate-50 text-slate-700 ring-slate-200";
}

export function SchoolTimetableSetupPage({
  appTitle,
  nav,
  activeHref,
  initialData,
}: SchoolTimetableSetupPageProps) {
  const [loading, setLoading] = useState(!initialData);
  const [saving, setSaving] = useState(false);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [printingGrid, setPrintingGrid] = useState(false);
  const [downloadingGridPdf, setDownloadingGridPdf] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SchoolTimetableEntry | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [fallbackUsed, setFallbackUsed] = useState(initialData?.fallbackUsed ?? false);

  const [entries, setEntries] = useState<SchoolTimetableEntry[]>(initialData?.entries ?? []);
  const [terms, setTerms] = useState<TenantTerm[]>(initialData?.terms ?? []);
  const [classes, setClasses] = useState<TenantClassOption[]>(initialData?.classes ?? []);
  const [subjects, setSubjects] = useState<TenantSubject[]>(initialData?.subjects ?? []);
  const [teachers, setTeachers] = useState<TenantStaff[]>(initialData?.teachers ?? []);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TimetableForm>(defaultForm);

  const [search, setSearch] = useState("");
  const [termFilter, setTermFilter] = useState<string>("__all__");
  const [classFilter, setClassFilter] = useState<string>("__all__");
  const [dayFilter, setDayFilter] = useState<string>("__all__");
  const [typeFilter, setTypeFilter] = useState<string>("__all__");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");
  const [tablePageSize, setTablePageSize] = useState<number>(20);
  const [tablePage, setTablePage] = useState<number>(1);
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([]);
  const [bulkSelectMode, setBulkSelectMode] = useState<BulkSelectMode>("type");
  const [bulkSelectValue, setBulkSelectValue] = useState<string>("__none__");
  const [presetDay, setPresetDay] = useState<TimetableDay>("MONDAY");
  const [breakPresets, setBreakPresets] = useState<BreakPresetMap>(() =>
    buildBreakPresetMap("MONDAY", [])
  );
  const [applyPresetsToAllDays, setApplyPresetsToAllDays] = useState(false);
  const [breakPresetSaving, setBreakPresetSaving] = useState<BreakSlotType | "ALL" | null>(null);
  const [initialErrorShown, setInitialErrorShown] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);

    const requests: Array<Promise<unknown>> = [
      api.get("/tenants/school-timetable?limit=1000&offset=0&include_inactive=true", {
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
    ];

    const [entriesRes, termsRes, classesRes, subjectsRes, teachersRes] = await Promise.allSettled(requests);
    const errors: string[] = [];

    if (entriesRes.status === "fulfilled") {
      setEntries(normalizeSchoolTimetable(entriesRes.value));
      setFallbackUsed(false);
    } else {
      setEntries([]);
      setFallbackUsed(true);
      errors.push("School timetable storage is unavailable.");
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

    if (subjectsRes.status === "fulfilled") {
      setSubjects(normalizeSubjects(subjectsRes.value));
    } else {
      setSubjects([]);
      errors.push("Failed to load subjects.");
    }

    if (teachersRes.status === "fulfilled") {
      setTeachers(normalizeStaff(teachersRes.value));
    } else {
      setTeachers([]);
      errors.push("Failed to load teaching staff.");
    }

    if (errors.length > 0) {
      toast.error(errors[0]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (initialData) return;
    void load();
  }, [load, initialData]);

  useEffect(() => {
    if (initialErrorShown) return;
    if (!initialData?.initialError) return;
    toast.error(initialData.initialError);
    setInitialErrorShown(true);
  }, [initialData, initialErrorShown]);

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      term_id: prev.term_id || terms[0]?.id || "",
      class_code: prev.class_code || classes[0]?.code || "",
    }));
  }, [terms, classes]);

  useEffect(() => {
    if (viewMode !== "grid") return;
    if (classFilter !== "__all__") return;
    if (classes.length === 0) return;
    setClassFilter(classes[0].code);
  }, [viewMode, classFilter, classes]);

  useEffect(() => {
    setTablePage(1);
  }, [search, termFilter, classFilter, dayFilter, typeFilter, statusFilter, tablePageSize]);

  useEffect(() => {
    setBreakPresets(buildBreakPresetMap(presetDay, entries));
  }, [presetDay, entries]);

  useEffect(() => {
    setBulkSelectValue("__none__");
  }, [bulkSelectMode]);

  useEffect(() => {
    const available = new Set(entries.map((row) => row.id));
    setSelectedEntryIds((prev) => prev.filter((id) => available.has(id)));
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((row) => {
      if (termFilter !== "__all__" && row.term_id !== termFilter) return false;
      if (classFilter !== "__all__" && row.class_code !== classFilter) return false;
      if (dayFilter !== "__all__" && row.day_of_week !== dayFilter) return false;
      if (typeFilter !== "__all__" && row.slot_type !== typeFilter) return false;
      if (statusFilter === "active" && !row.is_active) return false;
      if (statusFilter === "inactive" && row.is_active) return false;
      if (!q) return true;
      return (
        row.title.toLowerCase().includes(q) ||
        row.class_code.toLowerCase().includes(q) ||
        (row.term_code || "").toLowerCase().includes(q) ||
        (row.term_name || "").toLowerCase().includes(q) ||
        (row.subject_code || "").toLowerCase().includes(q) ||
        (row.subject_name || "").toLowerCase().includes(q) ||
        (row.staff_name || "").toLowerCase().includes(q) ||
        DAY_LABELS[row.day_of_week].toLowerCase().includes(q)
      );
    });
  }, [entries, search, termFilter, classFilter, dayFilter, typeFilter, statusFilter]);

  const tableTotalPages = useMemo(() => {
    const total = Math.ceil(filteredEntries.length / tablePageSize);
    return Math.max(1, total);
  }, [filteredEntries.length, tablePageSize]);

  useEffect(() => {
    if (tablePage > tableTotalPages) {
      setTablePage(tableTotalPages);
    }
  }, [tablePage, tableTotalPages]);

  const effectiveTablePage = Math.min(tablePage, tableTotalPages);

  const tablePageEntries = useMemo(() => {
    const start = (effectiveTablePage - 1) * tablePageSize;
    const end = start + tablePageSize;
    return filteredEntries.slice(start, end);
  }, [filteredEntries, effectiveTablePage, tablePageSize]);

  const tableResultStart = filteredEntries.length === 0 ? 0 : (effectiveTablePage - 1) * tablePageSize + 1;
  const tableResultEnd = filteredEntries.length === 0
    ? 0
    : Math.min(effectiveTablePage * tablePageSize, filteredEntries.length);

  const selectedEntrySet = useMemo(() => new Set(selectedEntryIds), [selectedEntryIds]);
  const selectedCount = selectedEntryIds.length;
  const allPageSelected = tablePageEntries.length > 0 && tablePageEntries.every((row) => selectedEntrySet.has(row.id));
  const somePageSelected = tablePageEntries.some((row) => selectedEntrySet.has(row.id));

  const bulkSelectOptions = useMemo(() => {
    if (bulkSelectMode === "type") {
      return TIMETABLE_SLOT_TYPES.map((slotType) => ({
        value: slotType,
        label: SLOT_LABELS[slotType],
      }));
    }
    if (bulkSelectMode === "class") {
      return classes.map((row) => ({
        value: row.code,
        label: `${row.code} - ${row.name}`,
      }));
    }
    return terms.map((row) => ({
      value: row.id,
      label: `${row.code} - ${row.name}`,
    }));
  }, [bulkSelectMode, classes, terms]);

  const gridRowKeys = useMemo(() => {
    const keys = Array.from(new Set(filteredEntries.map((row) => `${row.start_time}__${row.end_time}`)));
    return keys.sort((a, b) => {
      const [aStart, aEnd] = a.split("__");
      const [bStart, bEnd] = b.split("__");
      const startCmp = aStart.localeCompare(bStart);
      if (startCmp !== 0) return startCmp;
      return aEnd.localeCompare(bEnd);
    });
  }, [filteredEntries]);

  const gridMap = useMemo(() => {
    const map: Record<string, SchoolTimetableEntry[]> = {};
    for (const row of filteredEntries) {
      const rowKey = `${row.start_time}__${row.end_time}`;
      const key = `${rowKey}__${row.day_of_week}`;
      if (!map[key]) map[key] = [];
      map[key].push(row);
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => a.class_code.localeCompare(b.class_code) || a.title.localeCompare(b.title));
    }
    return map;
  }, [filteredEntries]);

  const gridDays = useMemo<TimetableDay[]>(() => {
    if (dayFilter === "__all__") return [...TIMETABLE_DAYS];
    return TIMETABLE_DAYS.filter((day) => day === dayFilter) as TimetableDay[];
  }, [dayFilter]);

  const gridTemplateColumns = useMemo(() => {
    const slotCount = Math.max(gridRowKeys.length, 1);
    return `160px repeat(${slotCount}, minmax(180px, 1fr))`;
  }, [gridRowKeys.length]);

  const gridMinWidth = useMemo(() => {
    const slotCount = Math.max(gridRowKeys.length, 1);
    return 160 + slotCount * 180;
  }, [gridRowKeys.length]);

  const visibleSubjects = useMemo(() => subjects.filter((row) => row.is_active !== false), [subjects]);
  const visibleTeachers = useMemo(() => teachers.filter((row) => row.is_active !== false), [teachers]);

  function updateBreakPreset(slotType: BreakSlotType, patch: Partial<BreakPresetRow>) {
    setBreakPresets((prev) => ({
      ...prev,
      [slotType]: {
        ...prev[slotType],
        ...patch,
      },
    }));
  }

  async function applyBreakPreset(slotType: BreakSlotType) {
    if (fallbackUsed) {
      toast.error("School timetable storage is unavailable. Run backend migrations and retry.");
      return;
    }

    const preset = breakPresets[slotType];
    const startTime = preset.start_time.trim();
    const endTime = preset.end_time.trim();
    if (!startTime || !endTime) {
      toast.error(`${SLOT_LABELS[slotType]} start and end time are required.`);
      return;
    }
    if (endTime <= startTime) {
      toast.error(`${SLOT_LABELS[slotType]} end time must be later than start time.`);
      return;
    }

    setBreakPresetSaving(slotType);
    try {
      const targetDays = applyPresetsToAllDays ? TIMETABLE_DAYS : [presetDay];
      for (const day of targetDays) {
        await api.post(
          "/tenants/school-timetable/break-slots/apply",
          {
            day_of_week: day,
            slot_type: slotType,
            start_time: startTime,
            end_time: endTime,
            title: preset.title.trim() || DEFAULT_BREAK_TITLES[slotType],
            location: preset.location.trim() || null,
            notes: null,
            is_active: preset.is_active,
          },
          { tenantRequired: true }
        );
      }
      toast.success(
        applyPresetsToAllDays
          ? `${SLOT_LABELS[slotType]} preset applied to all days across active terms and classes.`
          : `${SLOT_LABELS[slotType]} preset applied across active terms and classes.`
      );
      await load();
    } catch (err: any) {
      toast.error(
        typeof err?.message === "string"
          ? err.message
          : `Failed to apply ${SLOT_LABELS[slotType].toLowerCase()} preset`
      );
    } finally {
      setBreakPresetSaving(null);
    }
  }

  async function applyAllBreakPresets() {
    if (fallbackUsed) {
      toast.error("School timetable storage is unavailable. Run backend migrations and retry.");
      return;
    }

    for (const slotType of BREAK_SLOT_TYPES) {
      const preset = breakPresets[slotType];
      const startTime = preset.start_time.trim();
      const endTime = preset.end_time.trim();
      if (!startTime || !endTime) {
        toast.error(`Fill start and end times for ${SLOT_LABELS[slotType]} before applying all.`);
        return;
      }
      if (endTime <= startTime) {
        toast.error(`${SLOT_LABELS[slotType]} end time must be later than start time.`);
        return;
      }
    }

    setBreakPresetSaving("ALL");
    try {
      const targetDays = applyPresetsToAllDays ? TIMETABLE_DAYS : [presetDay];
      for (const day of targetDays) {
        for (const slotType of BREAK_SLOT_TYPES) {
          const preset = breakPresets[slotType];
          await api.post(
            "/tenants/school-timetable/break-slots/apply",
            {
              day_of_week: day,
              slot_type: slotType,
              start_time: preset.start_time.trim(),
              end_time: preset.end_time.trim(),
              title: preset.title.trim() || DEFAULT_BREAK_TITLES[slotType],
              location: preset.location.trim() || null,
              notes: null,
              is_active: preset.is_active,
            },
            { tenantRequired: true }
          );
        }
      }
      toast.success(
        applyPresetsToAllDays
          ? "Break presets applied to all days across active terms and classes."
          : `Break presets for ${DAY_LABELS[presetDay]} applied across active terms and classes.`
      );
      await load();
    } catch (err: any) {
      toast.error(typeof err?.message === "string" ? err.message : "Failed to apply break presets");
    } finally {
      setBreakPresetSaving(null);
    }
  }

  function toggleEntrySelection(entryId: string, checked: boolean) {
    setSelectedEntryIds((prev) => {
      if (checked) {
        if (prev.includes(entryId)) return prev;
        return [...prev, entryId];
      }
      return prev.filter((id) => id !== entryId);
    });
  }

  function togglePageSelection(checked: boolean) {
    const pageIds = tablePageEntries.map((row) => row.id);
    setSelectedEntryIds((prev) => {
      if (checked) {
        const merged = new Set([...prev, ...pageIds]);
        return Array.from(merged);
      }
      const remove = new Set(pageIds);
      return prev.filter((id) => !remove.has(id));
    });
  }

  function clearSelection() {
    setSelectedEntryIds([]);
  }

  function selectEntriesByCriteria() {
    if (bulkSelectValue === "__none__") {
      toast.error("Select a value for bulk selection.");
      return;
    }
    let matches: SchoolTimetableEntry[] = [];
    if (bulkSelectMode === "type") {
      matches = entries.filter((row) => row.slot_type === bulkSelectValue);
    } else if (bulkSelectMode === "class") {
      matches = entries.filter((row) => row.class_code === bulkSelectValue);
    } else {
      matches = entries.filter((row) => row.term_id === bulkSelectValue);
    }

    const ids = matches.map((row) => row.id);
    setSelectedEntryIds(ids);
    if (ids.length === 0) {
      toast.error("No timetable entries matched the selected criteria.");
    } else {
      toast.success(`Selected ${ids.length} timetable entr${ids.length === 1 ? "y" : "ies"}.`);
    }
  }

  async function deleteSelectedEntries() {
    if (selectedEntryIds.length === 0) return;

    setBulkDeleting(true);
    const targets = entries.filter((row) => selectedEntrySet.has(row.id));
    let deleted = 0;
    let failed = 0;

    for (const row of targets) {
      try {
        await api.delete(`/tenants/school-timetable/${row.id}`, undefined, { tenantRequired: true });
        deleted += 1;
      } catch {
        failed += 1;
      }
    }

    setBulkDeleting(false);
    setBulkDeleteOpen(false);
    setSelectedEntryIds([]);

    if (failed === 0) {
      toast.success(`Deleted ${deleted} timetable entr${deleted === 1 ? "y" : "ies"}.`);
    } else if (deleted > 0) {
      toast.error(`Deleted ${deleted} entries, but ${failed} failed. Please retry.`);
    } else {
      toast.error("Failed to delete selected timetable entries.");
    }

    await load();
  }

  function buildGridPrintHtml(): string {
    const generatedAt = new Date().toLocaleString();
    const effectiveDayCount = Math.max(gridDays.length, 1);
    const classLabel =
      classFilter !== "__all__"
        ? classFilter
        : filteredEntries.length > 0
          ? "All classes"
          : "N/A";

    const headerCells = gridRowKeys
      .map((rowKey) => {
        const [start, end] = rowKey.split("__");
        return `<th>${escapeHtml(formatTimeRange(start || "", end || ""))}</th>`;
      })
      .join("");

    const bodyRows = gridDays
      .map((day) => {
        const cells = gridRowKeys
          .map((rowKey) => {
            const key = `${rowKey}__${day}`;
            const rows = gridMap[key] || [];
            if (rows.length === 0) {
              return `<td><div class="empty">-</div></td>`;
            }
            const entryLine = rows
              .map((row) => {
                const tokens = [
                  row.title,
                  row.subject_code || row.subject_name || "",
                  row.staff_name || "",
                ]
                  .filter(Boolean)
                  .join(" · ");
                return tokens;
              })
              .join(" | ");
            return `<td><div class="entry-inline">${escapeHtml(entryLine)}</div></td>`;
          })
          .join("");
        return `<tr><th>${escapeHtml(DAY_LABELS[day])}</th>${cells}</tr>`;
      })
      .join("");

    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>School Timetable Grid</title>
    <style>
      @page { size: A4 landscape; margin: 6mm; }
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
      * { box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; color: #000; }
      .scale-200 {
        width: 50%;
        height: 50%;
        transform: scale(2);
        transform-origin: top left;
      }
      .sheet {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
      }
      .header { margin-bottom: 4px; display: flex; justify-content: space-between; align-items: flex-end; gap: 8px; }
      .title { font-size: 10px; font-weight: 700; line-height: 1.1; }
      .meta { font-size: 5.5px; color: #111; line-height: 1.2; }
      .meta + .meta { margin-top: 1px; }
      table { width: 100%; height: 100%; border-collapse: collapse; table-layout: fixed; }
      table, tr, th, td { break-inside: avoid; page-break-inside: avoid; }
      th, td { border: 1px solid #111; vertical-align: top; padding: 2px; overflow: hidden; }
      th { background: #fff; font-size: 6px; text-align: left; white-space: nowrap; }
      td { font-size: 6px; }
      tbody tr { height: calc((100% - 16px) / ${effectiveDayCount}); }
      .entry-inline { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.15; font-size: 6px; }
      .empty { color: #444; text-align: center; font-size: 6px; line-height: 1.15; }
    </style>
  </head>
  <body>
    <div class="scale-200">
      <div class="sheet">
        <div class="header">
          <div>
            <div class="title">School Timetable Grid</div>
            <div class="meta">School Timetable Grid</div>
            <div class="meta">Class: ${escapeHtml(classLabel)}</div>
          </div>
          <div class="meta">Generated: ${escapeHtml(generatedAt)}</div>
        </div>
        <table>
          <thead>
            <tr>
              <th style="width: 70px;">Day</th>
              ${headerCells}
            </tr>
          </thead>
          <tbody>
            ${bodyRows}
          </tbody>
        </table>
      </div>
    </div>
  </body>
</html>`;
  }

  function printGridView() {
    if (gridRowKeys.length === 0 || gridDays.length === 0) {
      toast.error("No timetable grid data to print.");
      return;
    }
    setPrintingGrid(true);
    const docHtml = buildGridPrintHtml();

    const frame = document.createElement("iframe");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    frame.setAttribute("aria-hidden", "true");
    document.body.appendChild(frame);

    const cleanup = () => {
      setTimeout(() => {
        if (document.body.contains(frame)) document.body.removeChild(frame);
        setPrintingGrid(false);
      }, 600);
    };

    const popupFallback = () => {
      const popup = window.open("", "_blank", "noopener,noreferrer,width=1800,height=1200");
      if (!popup) {
        toast.error("Unable to open print preview. Check browser permissions.");
        setPrintingGrid(false);
        return;
      }
      popup.document.write(docHtml);
      popup.document.close();
      popup.focus();
      popup.onload = () => {
        popup.print();
        setPrintingGrid(false);
      };
    };

    const iframeDoc = frame.contentDocument || frame.contentWindow?.document;
    if (!iframeDoc) {
      cleanup();
      popupFallback();
      return;
    }

    iframeDoc.open();
    iframeDoc.write(docHtml);
    iframeDoc.close();

    let printed = false;
    const triggerPrint = () => {
      if (printed) return;
      printed = true;
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch {
        popupFallback();
      } finally {
        cleanup();
      }
    };

    frame.onload = triggerPrint;
    triggerPrint();
    setTimeout(triggerPrint, 120);
  }

  async function downloadGridPdf() {
    if (gridRowKeys.length === 0 || gridDays.length === 0) {
      toast.error("No timetable grid data to export.");
      return;
    }

    const qs = new URLSearchParams();
    if (termFilter !== "__all__") qs.set("term_id", termFilter);
    if (classFilter !== "__all__") qs.set("class_code", classFilter);
    if (dayFilter !== "__all__") qs.set("day_of_week", dayFilter);
    if (typeFilter !== "__all__") qs.set("slot_type", typeFilter);
    qs.set("status", statusFilter === "all" ? "all" : statusFilter);
    if (search.trim()) qs.set("search", search.trim());
    qs.set("limit", "10000");

    setDownloadingGridPdf(true);
    try {
      const res = await apiFetchRaw(`/tenants/school-timetable/print/pdf?${qs.toString()}`, {
        method: "GET",
        tenantRequired: true,
      });
      const blob = await res.blob();
      const filename =
        res.headers.get("Content-Disposition")?.match(/filename="?([^"]+)"?/)?.[1] ||
        "school-timetable-grid.pdf";
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success("Timetable PDF download started.");
    } catch (err: any) {
      toast.error(typeof err?.message === "string" ? err.message : "Unable to download timetable PDF");
    } finally {
      setDownloadingGridPdf(false);
    }
  }

  async function saveTimetableEntry() {
    if (fallbackUsed) {
      toast.error("School timetable storage is unavailable. Run backend migrations and retry.");
      return;
    }

    const termId = form.term_id.trim();
    const classCode = form.class_code.trim().toUpperCase();
    const day = form.day_of_week;
    const slotType = form.slot_type;
    const startTime = form.start_time.trim();
    const endTime = form.end_time.trim();
    const subjectId = form.subject_id.trim();
    const staffId = form.staff_id.trim();
    const isGlobalBreakApply = isBreakSlot(slotType) && form.apply_break_globally;

    if (!day || !slotType || !startTime || !endTime) {
      toast.error("Day, slot type, start time and end time are required.");
      return;
    }
    if (!isGlobalBreakApply && (!termId || !classCode)) {
      toast.error("Term and class are required.");
      return;
    }
    if (endTime <= startTime) {
      toast.error("End time must be later than start time.");
      return;
    }
    if (isLessonSlot(slotType) && !subjectId) {
      toast.error("Subject is required for lesson slots.");
      return;
    }

    const payload = {
      term_id: termId,
      class_code: classCode,
      day_of_week: day,
      slot_type: slotType,
      title: form.title.trim() || null,
      subject_id: isLessonSlot(slotType) ? (subjectId || null) : null,
      staff_id: isLessonSlot(slotType) ? (staffId || null) : null,
      start_time: startTime,
      end_time: endTime,
      location: form.location.trim() || null,
      notes: form.notes.trim() || null,
      is_active: form.is_active,
    };

    setSaving(true);
    try {
      if (isGlobalBreakApply) {
        await api.post(
          "/tenants/school-timetable/break-slots/apply",
          {
            day_of_week: day,
            slot_type: slotType,
            start_time: startTime,
            end_time: endTime,
            title: form.title.trim() || null,
            location: form.location.trim() || null,
            notes: form.notes.trim() || null,
            is_active: form.is_active,
          },
          { tenantRequired: true }
        );
      } else if (editingId) {
        await api.put(`/tenants/school-timetable/${editingId}`, payload, { tenantRequired: true });
      } else {
        await api.post("/tenants/school-timetable", payload, { tenantRequired: true });
      }
      if (isGlobalBreakApply) {
        toast.success("Break slot applied across active terms and classes.");
      } else {
        toast.success(editingId ? "Timetable entry updated." : "Timetable entry created.");
      }
      setEditingId(null);
      setForm((prev) => ({
        ...defaultForm,
        term_id: prev.term_id,
        class_code: prev.class_code,
        day_of_week: prev.day_of_week,
      }));
      await load();
    } catch (err: any) {
      toast.error(
        typeof err?.message === "string"
          ? err.message
          : editingId
            ? "Failed to update timetable entry"
            : "Failed to create timetable entry"
      );
    } finally {
      setSaving(false);
    }
  }

  function startEdit(row: SchoolTimetableEntry) {
    setEditingId(row.id);
    setForm({
      term_id: row.term_id,
      class_code: row.class_code,
      day_of_week: row.day_of_week,
      slot_type: row.slot_type,
      title: row.title,
      subject_id: row.subject_id || "",
      staff_id: row.staff_id || "",
      start_time: toTimeInput(row.start_time),
      end_time: toTimeInput(row.end_time),
      location: row.location || "",
      notes: row.notes || "",
      is_active: row.is_active,
      apply_break_globally: isBreakSlot(row.slot_type),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm((prev) => ({
      ...defaultForm,
      term_id: prev.term_id || terms[0]?.id || "",
      class_code: prev.class_code || classes[0]?.code || "",
      day_of_week: prev.day_of_week || "MONDAY",
      apply_break_globally: prev.apply_break_globally,
    }));
  }

  async function deleteEntry(row: SchoolTimetableEntry) {
    setActioningId(row.id);
    try {
      await api.delete(`/tenants/school-timetable/${row.id}`, undefined, { tenantRequired: true });
      toast.success("Timetable entry deleted.");
      if (editingId === row.id) {
        cancelEdit();
      }
      setDeleteTarget(null);
      await load();
    } catch (err: any) {
      toast.error(typeof err?.message === "string" ? err.message : "Failed to delete timetable entry");
    } finally {
      setActioningId(null);
    }
  }

  return (
    <AppShell title={appTitle} nav={nav} activeHref={activeHref}>
      <div className="space-y-5">
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-600 to-blue-500 p-5 text-white shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-bold">School Setup · Timetable</h1>
              <p className="mt-0.5 text-sm text-blue-100">
                Configure class lessons and break activities (short break, long break, lunch break, and game time).
              </p>
            </div>
            <Button
              variant="outline"
              className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              onClick={() => void load()}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        {fallbackUsed && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            School timetable storage is unavailable. Run backend migrations to enable persistent setup.
          </div>
        )}

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Break Presets</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Set short break, long break, lunch break, and game time once per day, then apply globally across
                active terms and classes.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Select value={presetDay} onValueChange={(value) => setPresetDay(value as TimetableDay)}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMETABLE_DAYS.map((day) => (
                    <SelectItem key={day} value={day}>
                      {DAY_LABELS[day]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                onClick={() => void applyAllBreakPresets()}
                disabled={fallbackUsed || breakPresetSaving !== null}
              >
                {breakPresetSaving === "ALL" ? "Applying..." : "Apply All"}
              </Button>
            </div>
          </div>

          <label className="mb-4 flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={applyPresetsToAllDays}
              onChange={(e) => setApplyPresetsToAllDays(e.target.checked)}
              disabled={fallbackUsed || breakPresetSaving !== null}
            />
            Apply presets to all days of the week (Mon-Sun)
          </label>

          <div className="overflow-x-auto rounded-xl border border-slate-100 [&_table]:min-w-[860px]">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="text-xs">Break Type</TableHead>
                  <TableHead className="text-xs">Start Time</TableHead>
                  <TableHead className="text-xs">End Time</TableHead>
                  <TableHead className="text-xs">Title</TableHead>
                  <TableHead className="text-xs">Location</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {BREAK_SLOT_TYPES.map((slotType) => {
                  const row = breakPresets[slotType];
                  return (
                    <TableRow key={slotType}>
                      <TableCell className="text-xs font-semibold text-slate-800">{SLOT_LABELS[slotType]}</TableCell>
                      <TableCell>
                        <Input
                          type="time"
                          value={row.start_time}
                          onChange={(e) => updateBreakPreset(slotType, { start_time: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="time"
                          value={row.end_time}
                          onChange={(e) => updateBreakPreset(slotType, { end_time: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={row.title}
                          onChange={(e) => updateBreakPreset(slotType, { title: e.target.value })}
                          placeholder={DEFAULT_BREAK_TITLES[slotType]}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={row.location}
                          onChange={(e) => updateBreakPreset(slotType, { location: e.target.value })}
                          placeholder="Optional"
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={row.is_active ? "active" : "inactive"}
                          onValueChange={(value) =>
                            updateBreakPreset(slotType, { is_active: value === "active" })
                          }
                        >
                          <SelectTrigger className="w-28">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="inactive">Inactive</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => void applyBreakPreset(slotType)}
                          disabled={fallbackUsed || breakPresetSaving !== null}
                        >
                          {breakPresetSaving === slotType ? "Applying..." : "Apply"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-slate-900">
              {editingId ? "Update Timetable Entry" : "Create Timetable Entry"}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Add lessons and break slots in order. Lessons can be assigned to one teacher for multiple subjects or
              different teachers per subject.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Term</Label>
              <Select
                value={form.term_id || "__none__"}
                disabled={isBreakSlot(form.slot_type) && form.apply_break_globally}
                onValueChange={(value) => setForm((prev) => ({ ...prev, term_id: value === "__none__" ? "" : value }))}
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
              <Label className="text-xs">Class</Label>
              <Select
                value={form.class_code || "__none__"}
                disabled={isBreakSlot(form.slot_type) && form.apply_break_globally}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, class_code: value === "__none__" ? "" : value }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select class" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select class...</SelectItem>
                  {classes.map((row) => (
                    <SelectItem key={row.id} value={row.code}>
                      {row.code} - {row.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Day</Label>
              <Select
                value={form.day_of_week}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, day_of_week: value as TimetableDay }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMETABLE_DAYS.map((day) => (
                    <SelectItem key={day} value={day}>
                      {DAY_LABELS[day]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Slot Type</Label>
              <Select
                value={form.slot_type}
                onValueChange={(value) =>
                  setForm((prev) => {
                    const slotType = value as TimetableSlotType;
                    return {
                      ...prev,
                      slot_type: slotType,
                      apply_break_globally: isBreakSlot(slotType) ? true : prev.apply_break_globally,
                    };
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMETABLE_SLOT_TYPES.map((slotType) => (
                    <SelectItem key={slotType} value={slotType}>
                      {SLOT_LABELS[slotType]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isBreakSlot(form.slot_type) && (
              <div className="space-y-1.5">
                <Label className="text-xs">Break Scope</Label>
                <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.apply_break_globally}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, apply_break_globally: e.target.checked }))
                    }
                  />
                  Apply this break slot across all active terms and classes
                </label>
              </div>
            )}

            <div className="space-y-1.5 md:col-span-2 xl:col-span-2">
              <Label className="text-xs">Title</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                placeholder={isLessonSlot(form.slot_type) ? "e.g. Lesson 1" : "Optional custom title"}
              />
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

            <div className="space-y-1.5">
              <Label className="text-xs">Subject</Label>
              <Select
                value={form.subject_id || "__none__"}
                disabled={!isLessonSlot(form.slot_type)}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, subject_id: value === "__none__" ? "" : value }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder={isLessonSlot(form.slot_type) ? "Select subject" : "Not required"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No subject</SelectItem>
                  {visibleSubjects.map((row) => (
                    <SelectItem key={row.id} value={row.id}>
                      {row.code} - {row.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Teacher</Label>
              <Select
                value={form.staff_id || "__none__"}
                disabled={!isLessonSlot(form.slot_type)}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, staff_id: value === "__none__" ? "" : value }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Optional teacher" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No teacher</SelectItem>
                  {visibleTeachers.map((row) => (
                    <SelectItem key={row.id} value={row.id}>
                      {row.staff_no} - {row.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Location</Label>
              <Input
                value={form.location}
                onChange={(e) => setForm((prev) => ({ ...prev, location: e.target.value }))}
                placeholder="Optional"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select
                value={form.is_active ? "active" : "inactive"}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, is_active: value === "active" }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 md:col-span-2 xl:col-span-4">
              <Label className="text-xs">Notes</Label>
              <Textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder="Optional setup notes"
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button onClick={() => void saveTimetableEntry()} disabled={saving || fallbackUsed}>
              {saving ? (editingId ? "Updating..." : "Saving...") : editingId ? "Update Entry" : "Create Entry"}
            </Button>
            {editingId && (
              <Button variant="outline" onClick={cancelEdit} disabled={saving}>
                Cancel Edit
              </Button>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-4 sm:px-6">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-blue-600" />
              <h2 className="text-sm font-semibold text-slate-900">Timetable Directory</h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Manage lesson slots before short break, long break, lunch break and game time for each class.
            </p>
          </div>
          <div className="p-4 sm:p-6">
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
              <Input
                placeholder="Search title, class, subject, teacher..."
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

              <Select value={classFilter} onValueChange={setClassFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All classes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All classes</SelectItem>
                  {classes.map((row) => (
                    <SelectItem key={row.id} value={row.code}>
                      {row.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={dayFilter} onValueChange={setDayFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All days" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All days</SelectItem>
                  {TIMETABLE_DAYS.map((day) => (
                    <SelectItem key={day} value={day}>
                      {DAY_LABELS[day]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All types</SelectItem>
                  {TIMETABLE_SLOT_TYPES.map((slotType) => (
                    <SelectItem key={slotType} value={slotType}>
                      {SLOT_LABELS[slotType]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active only</SelectItem>
                  <SelectItem value="inactive">Inactive only</SelectItem>
                  <SelectItem value="all">All statuses</SelectItem>
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
                  variant={viewMode === "grid" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setViewMode("grid")}
                >
                  <CalendarDays className="h-3.5 w-3.5" />
                  Grid
                </Button>
              </div>
            </div>

            {viewMode === "table" && (
              <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-slate-600">Bulk select by</span>
                    <Select
                      value={bulkSelectMode}
                      onValueChange={(value) => setBulkSelectMode(value as BulkSelectMode)}
                    >
                      <SelectTrigger className="h-8 w-28 bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="type">Type</SelectItem>
                        <SelectItem value="class">Class</SelectItem>
                        <SelectItem value="term">Term</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={bulkSelectValue} onValueChange={setBulkSelectValue}>
                      <SelectTrigger className="h-8 min-w-44 bg-white">
                        <SelectValue placeholder="Select value" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Select value...</SelectItem>
                        {bulkSelectOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={selectEntriesByCriteria}
                      disabled={loading || bulkDeleting}
                    >
                      Select Matches
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={clearSelection}
                      disabled={loading || bulkDeleting || selectedCount === 0}
                    >
                      Clear Selection
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-600">
                      Selected: <span className="font-semibold text-slate-900">{selectedCount}</span>
                    </span>
                    <Button
                      size="xs"
                      variant="destructive"
                      disabled={loading || bulkDeleting || selectedCount === 0}
                      onClick={() => setBulkDeleteOpen(true)}
                    >
                      Delete Selected
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {viewMode === "table" && (
              <>
              <div className="overflow-x-auto rounded-xl border border-slate-100 [&_table]:min-w-[1260px]">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="w-10 text-xs">
                        <input
                          type="checkbox"
                          checked={allPageSelected}
                          ref={(el) => {
                            if (!el) return;
                            el.indeterminate = !allPageSelected && somePageSelected;
                          }}
                          onChange={(e) => togglePageSelection(e.target.checked)}
                          aria-label="Select all entries on current page"
                        />
                      </TableHead>
                      <TableHead className="text-xs">Day</TableHead>
                      <TableHead className="text-xs">Time</TableHead>
                      <TableHead className="text-xs">Class</TableHead>
                      <TableHead className="text-xs">Type</TableHead>
                      <TableHead className="text-xs">Title</TableHead>
                      <TableHead className="text-xs">Subject</TableHead>
                      <TableHead className="text-xs">Teacher</TableHead>
                      <TableHead className="text-xs">Term</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!loading &&
                      tablePageEntries.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="w-10">
                            <input
                              type="checkbox"
                              checked={selectedEntrySet.has(row.id)}
                              onChange={(e) => toggleEntrySelection(row.id, e.target.checked)}
                              aria-label={`Select timetable entry ${row.title}`}
                            />
                          </TableCell>
                          <TableCell className="text-xs text-slate-700">{DAY_LABELS[row.day_of_week]}</TableCell>
                          <TableCell className="font-mono text-xs text-slate-600">
                            {formatTimeRange(row.start_time, row.end_time)}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-slate-700">{row.class_code}</TableCell>
                          <TableCell>
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${slotBadgeClass(
                                row
                              )}`}
                            >
                              {SLOT_LABELS[row.slot_type]}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs font-medium text-slate-900">{row.title}</TableCell>
                          <TableCell className="text-xs text-slate-700">
                            {row.subject_code ? `${row.subject_code} - ${row.subject_name || ""}` : "—"}
                          </TableCell>
                          <TableCell className="text-xs text-slate-700">{row.staff_name || "—"}</TableCell>
                          <TableCell className="text-xs text-slate-600">
                            {row.term_code || row.term_name || "—"}
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
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                size="xs"
                                variant="outline"
                                disabled={actioningId === row.id || saving || bulkDeleting}
                                onClick={() => startEdit(row)}
                              >
                                Edit
                              </Button>
                              <Button
                                size="xs"
                                variant="destructive"
                                disabled={actioningId === row.id || saving || bulkDeleting}
                                onClick={() => setDeleteTarget(row)}
                              >
                                Delete
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    {!loading && filteredEntries.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={11} className="py-8 text-center text-sm text-slate-500">
                          No timetable entries match the current filters.
                        </TableCell>
                      </TableRow>
                    )}
                    {loading && (
                      <TableRow>
                        <TableCell colSpan={11} className="py-8 text-center text-sm text-slate-500">
                          Loading timetable entries...
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-slate-500">
                  {loading
                    ? "Loading..."
                    : `Showing ${tableResultStart}-${tableResultEnd} of ${filteredEntries.length} entries`}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-500">Rows per page</span>
                  <Select
                    value={String(tablePageSize)}
                    onValueChange={(value) => setTablePageSize(Number(value))}
                  >
                    <SelectTrigger className="h-8 w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TABLE_PAGE_SIZE_OPTIONS.map((size) => (
                        <SelectItem key={size} value={String(size)}>
                          {size}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => setTablePage((prev) => Math.max(1, prev - 1))}
                    disabled={loading || effectiveTablePage <= 1}
                  >
                    Prev
                  </Button>
                  <span className="text-xs text-slate-600">
                    Page {effectiveTablePage} of {tableTotalPages}
                  </span>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => setTablePage((prev) => Math.min(tableTotalPages, prev + 1))}
                    disabled={loading || effectiveTablePage >= tableTotalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
              </>
            )}

            {viewMode === "grid" && (
              <div className="space-y-3">
                <div className="flex flex-col gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-xs text-blue-700">
                    Grid layout: days are listed on the left, and time slots run from morning to evening across the top.
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="xs"
                      variant="outline"
                      className="bg-white"
                      onClick={printGridView}
                      disabled={
                        printingGrid ||
                        downloadingGridPdf ||
                        loading ||
                        gridRowKeys.length === 0 ||
                        gridDays.length === 0
                      }
                    >
                      <Printer className="h-3.5 w-3.5" />
                      {printingGrid ? "Preparing..." : "Print Grid"}
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      className="bg-white"
                      onClick={() => void downloadGridPdf()}
                      disabled={
                        printingGrid ||
                        downloadingGridPdf ||
                        loading ||
                        gridRowKeys.length === 0 ||
                        gridDays.length === 0
                      }
                    >
                      <FileDown className="h-3.5 w-3.5" />
                      {downloadingGridPdf ? "Downloading..." : "PDF"}
                    </Button>
                  </div>
                </div>
                <div className="overflow-x-auto rounded-xl border border-slate-100">
                  <div style={{ minWidth: `${gridMinWidth}px` }}>
                    <div className="grid border-b border-slate-100 bg-slate-50" style={{ gridTemplateColumns }}>
                      <div className="px-3 py-2 text-xs font-semibold text-slate-700">Day</div>
                      {gridRowKeys.map((rowKey) => {
                        const [start, end] = rowKey.split("__");
                        return (
                          <div
                            key={rowKey}
                            className="border-l border-slate-100 px-3 py-2 text-xs font-semibold text-slate-700"
                          >
                            {formatTimeRange(start || "", end || "")}
                          </div>
                        );
                      })}
                    </div>
                    {gridDays.map((day) => (
                      <div
                        key={day}
                        className="grid border-b border-slate-100 last:border-b-0"
                        style={{ gridTemplateColumns }}
                      >
                        <div className="px-3 py-3 text-xs font-semibold text-slate-700">{DAY_LABELS[day]}</div>
                        {gridRowKeys.map((rowKey) => {
                          const key = `${rowKey}__${day}`;
                          const cellRows = gridMap[key] || [];
                          return (
                            <div key={key} className="min-h-20 border-l border-slate-100 px-2 py-2">
                              {cellRows.length === 0 ? (
                                <div className="rounded-md border border-dashed border-slate-200 px-2 py-2 text-[11px] text-slate-400">
                                  —
                                </div>
                              ) : (
                                <div className="space-y-1">
                                  {cellRows.map((row) => (
                                    <button
                                      type="button"
                                      key={row.id}
                                      onClick={() => startEdit(row)}
                                      className={`w-full rounded-md px-2 py-1 text-left text-[11px] font-medium ring-1 ${slotBadgeClass(
                                        row
                                      )} hover:brightness-95`}
                                      title={`${DAY_LABELS[row.day_of_week]} ${formatTimeRange(
                                        row.start_time,
                                        row.end_time
                                      )} • ${row.title}`}
                                    >
                                      <div>{row.title}</div>
                                      <div className="text-[10px] opacity-80">
                                        {row.class_code}
                                        {row.subject_code ? ` · ${row.subject_code}` : ""}
                                        {row.staff_name ? ` · ${row.staff_name}` : ""}
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                    {!loading && gridRowKeys.length === 0 && (
                      <div className="px-4 py-8 text-center text-sm text-slate-500">
                        No timetable grid columns found for the current filters.
                      </div>
                    )}
                    {!loading && gridRowKeys.length > 0 && gridDays.length === 0 && (
                      <div className="px-4 py-8 text-center text-sm text-slate-500">
                        No timetable days match the selected day filter.
                      </div>
                    )}
                    {loading && (
                      <div className="px-4 py-8 text-center text-sm text-slate-500">
                        Loading timetable grid...
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <AlertDialog
        open={bulkDeleteOpen}
        onOpenChange={(open) => {
          if (!open && !bulkDeleting) setBulkDeleteOpen(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Selected Timetable Entries</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedCount > 0
                ? `Delete ${selectedCount} selected timetable entr${selectedCount === 1 ? "y" : "ies"}? This action cannot be undone.`
                : "No timetable entries selected."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={bulkDeleting || selectedCount === 0}
              onClick={(event) => {
                event.preventDefault();
                void deleteSelectedEntries();
              }}
            >
              {bulkDeleting ? "Deleting..." : "Delete Selected"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !actioningId && !bulkDeleting) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Timetable Entry</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `Delete "${deleteTarget.title}" (${DAY_LABELS[deleteTarget.day_of_week]} ${formatTimeRange(
                    deleteTarget.start_time,
                    deleteTarget.end_time
                  )})? This action cannot be undone.`
                : "Delete this timetable entry? This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(actioningId)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={Boolean(actioningId)}
              onClick={(event) => {
                event.preventDefault();
                if (!deleteTarget) return;
                void deleteEntry(deleteTarget);
              }}
            >
              {actioningId ? "Deleting..." : "Delete Entry"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
