"use client";

import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, CalendarDays, ClipboardList, RefreshCw, Sparkles, Trash2 } from "lucide-react";

import type { AppNavItem } from "@/components/layout/AppShell";
import { AppShell } from "@/components/layout/AppShell";
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
import { TenantPageHeader, TenantSurface } from "@/components/tenant/page-chrome";
import { buildRecommendedCalendarSeed, normalizeSchoolCalendarEvents, type SchoolCalendarEventType, type TenantSchoolCalendarEvent } from "@/lib/school-setup/calendar";
import { normalizeTerms, type TenantTerm } from "@/lib/school-setup/terms";

type SchoolCalendarSetupPageProps = {
  appTitle: string;
  nav: AppNavItem[];
  activeHref: string;
};

type EventDraft = {
  title: string;
  term_code: string;
  start_date: string;
  end_date: string;
  notes: string;
  is_active: boolean;
};

const yearNow = new Date().getFullYear();

function emptyDraft(): EventDraft {
  return {
    title: "",
    term_code: "__none__",
    start_date: "",
    end_date: "",
    notes: "",
    is_active: true,
  };
}

function eventTypeLabel(eventType: SchoolCalendarEventType): string {
  return eventType === "HALF_TERM_BREAK" ? "Half-Term Break" : "Exam Window";
}

export function SchoolCalendarSetupPage({ appTitle, nav, activeHref }: SchoolCalendarSetupPageProps) {
  const [academicYear, setAcademicYear] = useState<number>(yearNow);
  const [terms, setTerms] = useState<TenantTerm[]>([]);
  const [events, setEvents] = useState<TenantSchoolCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDrafts, setEditDrafts] = useState<Record<string, EventDraft>>({});
  const [breakForm, setBreakForm] = useState<EventDraft>(emptyDraft());
  const [examForm, setExamForm] = useState<EventDraft>(emptyDraft());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [termsData, eventsData] = await Promise.all([
        api.get<unknown>("/tenants/terms?include_inactive=true", {
          tenantRequired: true,
          noRedirect: true,
        }),
        api.get<unknown>(
          `/tenants/school-calendar/events?academic_year=${academicYear}&include_inactive=true`,
          {
            tenantRequired: true,
            noRedirect: true,
          }
        ),
      ]);
      setTerms(normalizeTerms(termsData));
      setEvents(normalizeSchoolCalendarEvents(eventsData));
    } catch (error: any) {
      toast.error(error?.message ?? "Failed to load school calendar setup.");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [academicYear]);

  useEffect(() => {
    void load();
  }, [load]);

  const termOptions = useMemo(
    () => terms.filter((term) => term.is_active !== false),
    [terms]
  );

  const termLabelByCode = useMemo(
    () =>
      new Map(
        terms.map((term) => [
          term.code,
          term.name ? `${term.name} (${term.code})` : term.code,
        ])
      ),
    [terms]
  );

  const breakRows = useMemo(
    () => events.filter((row) => row.event_type === "HALF_TERM_BREAK"),
    [events]
  );
  const examRows = useMemo(
    () => events.filter((row) => row.event_type === "EXAM_WINDOW"),
    [events]
  );

  async function createEvent(eventType: SchoolCalendarEventType, draft: EventDraft) {
    const title = draft.title.trim();
    if (!title) return toast.error("Title is required.");
    if (!draft.start_date || !draft.end_date) return toast.error("Start and end dates are required.");

    setSaving(true);
    try {
      await api.post(
        "/tenants/school-calendar/events",
        {
          academic_year: academicYear,
          event_type: eventType,
          title,
          term_code: draft.term_code === "__none__" ? null : draft.term_code,
          start_date: draft.start_date,
          end_date: draft.end_date,
          notes: draft.notes.trim() || null,
          is_active: draft.is_active,
        },
        { tenantRequired: true }
      );
      toast.success(`${eventTypeLabel(eventType)} created.`);
      if (eventType === "HALF_TERM_BREAK") setBreakForm(emptyDraft());
      else setExamForm(emptyDraft());
      await load();
    } catch (error: any) {
      toast.error(error?.message ?? `Failed to create ${eventTypeLabel(eventType).toLowerCase()}.`);
    } finally {
      setSaving(false);
    }
  }

  function startEdit(row: TenantSchoolCalendarEvent) {
    setEditingId(row.id);
    setEditDrafts((prev) => ({
      ...prev,
      [row.id]: {
        title: row.title,
        term_code: row.term_code || "__none__",
        start_date: row.start_date,
        end_date: row.end_date,
        notes: row.notes || "",
        is_active: row.is_active !== false,
      },
    }));
  }

  async function saveEdit(row: TenantSchoolCalendarEvent) {
    const draft = editDrafts[row.id];
    if (!draft) return;
    if (!draft.title.trim()) return toast.error("Title is required.");
    if (!draft.start_date || !draft.end_date) return toast.error("Start and end dates are required.");

    setSaving(true);
    try {
      await api.put(
        `/tenants/school-calendar/events/${row.id}`,
        {
          academic_year: academicYear,
          title: draft.title.trim(),
          term_code: draft.term_code === "__none__" ? null : draft.term_code,
          start_date: draft.start_date,
          end_date: draft.end_date,
          notes: draft.notes.trim() || null,
          is_active: draft.is_active,
        },
        { tenantRequired: true }
      );
      toast.success(`${eventTypeLabel(row.event_type)} updated.`);
      setEditingId(null);
      await load();
    } catch (error: any) {
      toast.error(error?.message ?? `Failed to update ${eventTypeLabel(row.event_type).toLowerCase()}.`);
    } finally {
      setSaving(false);
    }
  }

  async function deleteEvent(row: TenantSchoolCalendarEvent) {
    setSaving(true);
    try {
      await api.delete(`/tenants/school-calendar/events/${row.id}`, undefined, {
        tenantRequired: true,
      });
      toast.success(`${eventTypeLabel(row.event_type)} deleted.`);
      await load();
    } catch (error: any) {
      toast.error(error?.message ?? `Failed to delete ${eventTypeLabel(row.event_type).toLowerCase()}.`);
    } finally {
      setSaving(false);
    }
  }

  async function seedRecommendedEvents() {
    const recommended = buildRecommendedCalendarSeed(academicYear, termOptions).filter(
      (candidate) =>
        !events.some(
          (row) =>
            row.event_type === candidate.event_type &&
            row.title === candidate.title &&
            row.start_date === candidate.start_date
        )
    );
    if (recommended.length === 0) {
      toast.message("Recommended calendar events are already loaded for this year.");
      return;
    }

    setSaving(true);
    try {
      for (const row of recommended) {
        await api.post(
          "/tenants/school-calendar/events",
          {
            academic_year: row.academic_year,
            event_type: row.event_type,
            title: row.title,
            term_code: row.term_code,
            start_date: row.start_date,
            end_date: row.end_date,
            notes: row.notes,
            is_active: row.is_active,
          },
          { tenantRequired: true }
        );
      }
      toast.success("Recommended 2026 calendar events added.");
      await load();
    } catch (error: any) {
      toast.error(error?.message ?? "Failed to load the recommended calendar events.");
    } finally {
      setSaving(false);
    }
  }

  function renderEventSection(
    eventType: SchoolCalendarEventType,
    rows: TenantSchoolCalendarEvent[],
    form: EventDraft,
    setForm: Dispatch<SetStateAction<EventDraft>>
  ) {
    const isBreak = eventType === "HALF_TERM_BREAK";

    return (
      <TenantSurface className="p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">{eventTypeLabel(eventType)}</h2>
            <p className="mt-1 text-xs text-slate-500">
              {isBreak
                ? "Capture half-term pauses that affect attendance, finance reminders, and parent communication."
                : "Track national and school examination windows for planning and reporting."}
            </p>
          </div>
          <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            {rows.length} configured
          </div>
        </div>

        <div className="grid gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4 md:grid-cols-5">
          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs">Title</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              placeholder={isBreak ? "Term 1 Half-Term Break" : "KCSE Examination Period"}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Linked Term</Label>
            <Select
              value={form.term_code || "__none__"}
              onValueChange={(value) => setForm((prev) => ({ ...prev, term_code: value }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Optional" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Not linked</SelectItem>
                {termOptions.map((term) => (
                  <SelectItem key={term.id} value={term.code}>
                    {term.name} ({term.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          <div className="space-y-1.5 md:col-span-4">
            <Label className="text-xs">Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="Optional planning note for staff and operations."
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Status</Label>
            <Select
              value={form.is_active ? "active" : "inactive"}
              onValueChange={(value) => setForm((prev) => ({ ...prev, is_active: value === "active" }))}
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
          <div className="md:col-span-5">
            <Button onClick={() => void createEvent(eventType, form)} disabled={saving}>
              Add {eventTypeLabel(eventType)}
            </Button>
          </div>
        </div>

        <div className="mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Term</TableHead>
                <TableHead>Window</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-slate-500">
                    No {eventTypeLabel(eventType).toLowerCase()} configured for {academicYear}.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const draft = editDrafts[row.id];
                  const isEditing = editingId === row.id && draft;
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="align-top">
                        {isEditing ? (
                          <Input
                            value={draft.title}
                            onChange={(e) =>
                              setEditDrafts((prev) => ({
                                ...prev,
                                [row.id]: { ...draft, title: e.target.value },
                              }))
                            }
                          />
                        ) : (
                          <div className="font-medium text-slate-900">{row.title}</div>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        {isEditing ? (
                          <Select
                            value={draft.term_code || "__none__"}
                            onValueChange={(value) =>
                              setEditDrafts((prev) => ({
                                ...prev,
                                [row.id]: { ...draft, term_code: value },
                              }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">Not linked</SelectItem>
                              {termOptions.map((term) => (
                                <SelectItem key={term.id} value={term.code}>
                                  {term.name} ({term.code})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-sm text-slate-600">
                            {row.term_code ? termLabelByCode.get(row.term_code) || row.term_code : "Not linked"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        {isEditing ? (
                          <div className="grid gap-2 sm:grid-cols-2">
                            <Input
                              type="date"
                              value={draft.start_date}
                              onChange={(e) =>
                                setEditDrafts((prev) => ({
                                  ...prev,
                                  [row.id]: { ...draft, start_date: e.target.value },
                                }))
                              }
                            />
                            <Input
                              type="date"
                              value={draft.end_date}
                              onChange={(e) =>
                                setEditDrafts((prev) => ({
                                  ...prev,
                                  [row.id]: { ...draft, end_date: e.target.value },
                                }))
                              }
                            />
                          </div>
                        ) : (
                          <div className="text-sm text-slate-600">
                            {row.start_date} - {row.end_date}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        {isEditing ? (
                          <Select
                            value={draft.is_active ? "active" : "inactive"}
                            onValueChange={(value) =>
                              setEditDrafts((prev) => ({
                                ...prev,
                                [row.id]: { ...draft, is_active: value === "active" },
                              }))
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
                        ) : (
                          <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                            {row.is_active ? "Active" : "Inactive"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        {isEditing ? (
                          <Textarea
                            value={draft.notes}
                            rows={2}
                            onChange={(e) =>
                              setEditDrafts((prev) => ({
                                ...prev,
                                [row.id]: { ...draft, notes: e.target.value },
                              }))
                            }
                          />
                        ) : (
                          <span className="text-sm text-slate-500">{row.notes || "—"}</span>
                        )}
                      </TableCell>
                      <TableCell className="align-top text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          {isEditing ? (
                            <>
                              <Button variant="outline" onClick={() => setEditingId(null)} disabled={saving}>
                                Cancel
                              </Button>
                              <Button onClick={() => void saveEdit(row)} disabled={saving}>
                                Save
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button variant="outline" onClick={() => startEdit(row)} disabled={saving}>
                                Edit
                              </Button>
                              <Button
                                variant="outline"
                                className="text-rose-600 hover:text-rose-700"
                                onClick={() => void deleteEvent(row)}
                                disabled={saving}
                              >
                                <Trash2 className="mr-1 h-4 w-4" />
                                Delete
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </TenantSurface>
    );
  }

  return (
    <AppShell title={appTitle} nav={nav} activeHref={activeHref}>
      <div className="space-y-5">
        <TenantPageHeader
          title="School Setup · Calendar & Exams"
          description="Configure tenant-level half-term breaks and examination windows for school operations, communication, and finance planning."
          badges={[
            { label: `${academicYear} calendar`, icon: CalendarDays },
            { label: "Tenant-managed", icon: ClipboardList },
          ]}
          metrics={[
            { label: "Half-Term Breaks", value: breakRows.length },
            { label: "Exam Windows", value: examRows.length },
          ]}
          actions={
            <>
              <div className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-2 text-sm text-white/90">
                <Label htmlFor="calendar-year" className="text-white/80">
                  Year
                </Label>
                <Input
                  id="calendar-year"
                  type="number"
                  min={2000}
                  max={2100}
                  value={academicYear}
                  onChange={(e) => setAcademicYear(Number(e.target.value) || yearNow)}
                  className="h-9 w-24 border-white/20 bg-white/10 text-white"
                />
              </div>
              <Button
                variant="outline"
                className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                onClick={() => void load()}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
            </>
          }
        />

        <TenantSurface className="p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Recommended 2026 national schedule</h2>
              <p className="mt-1 text-xs text-slate-500">
                Load the shared Kenya 2026 half-term and exam windows as a tenant-specific starting point.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => void seedRecommendedEvents()}
              disabled={saving || academicYear !== 2026}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Load 2026 Recommended Dates
            </Button>
          </div>
          {academicYear !== 2026 ? (
            <p className="mt-3 text-xs text-amber-700">
              Recommended seed data is only available for academic year 2026.
            </p>
          ) : null}
        </TenantSurface>

        {renderEventSection("HALF_TERM_BREAK", breakRows, breakForm, setBreakForm)}
        {renderEventSection("EXAM_WINDOW", examRows, examForm, setExamForm)}

        {loading ? (
          <TenantSurface className="p-6 text-sm text-slate-500">
            Loading calendar configuration...
          </TenantSurface>
        ) : null}
      </div>
    </AppShell>
  );
}
