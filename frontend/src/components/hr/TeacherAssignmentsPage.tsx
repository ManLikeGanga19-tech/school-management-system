"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";

import { AppShell, type AppNavItem } from "@/components/layout/AppShell";
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
  normalizeClassTeacherAssignments,
  normalizeClassOptions,
  normalizeStaff,
  normalizeSubjects,
  normalizeTeacherAssignments,
  type ClassTeacherAssignment,
  type TeacherAssignment,
  type TenantClassOption,
  type TenantStaff,
  type TenantSubject,
} from "@/lib/hr";

type TeacherAssignmentsPageProps = {
  appTitle: string;
  nav: AppNavItem[];
  activeHref: string;
};

type AssignmentForm = {
  staff_id: string;
  subject_id: string;
  class_code: string;
  notes: string;
  is_active: boolean;
};

const initialForm: AssignmentForm = {
  staff_id: "",
  subject_id: "",
  class_code: "",
  notes: "",
  is_active: true,
};

type ClassTeacherForm = {
  staff_id: string;
  class_code: string;
  notes: string;
  is_active: boolean;
};

const initialClassTeacherForm: ClassTeacherForm = {
  staff_id: "",
  class_code: "",
  notes: "",
  is_active: true,
};

type SuggestedTeacher = {
  teacher: TenantStaff;
  subjectLoad: number;
  primarySubjectMatch: boolean;
};

export function TeacherAssignmentsPage({
  appTitle,
  nav,
  activeHref,
}: TeacherAssignmentsPageProps) {
  const [assignments, setAssignments] = useState<TeacherAssignment[]>([]);
  const [classTeacherAssignments, setClassTeacherAssignments] = useState<ClassTeacherAssignment[]>([]);
  const [teachers, setTeachers] = useState<TenantStaff[]>([]);
  const [subjects, setSubjects] = useState<TenantSubject[]>([]);
  const [classes, setClasses] = useState<TenantClassOption[]>([]);

  const [form, setForm] = useState<AssignmentForm>(initialForm);
  const [classTeacherForm, setClassTeacherForm] = useState<ClassTeacherForm>(initialClassTeacherForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [classTeacherSaving, setClassTeacherSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [classTeacherUpdatingId, setClassTeacherUpdatingId] = useState<string | null>(null);
  const [classTeacherDeletingId, setClassTeacherDeletingId] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [classFilter, setClassFilter] = useState("__all__");
  const [subjectFilter, setSubjectFilter] = useState("__all__");
  const [statusFilter, setStatusFilter] = useState("__all__");
  const [classTeacherQuery, setClassTeacherQuery] = useState("");
  const [classTeacherClassFilter, setClassTeacherClassFilter] = useState("__all__");
  const [classTeacherStatusFilter, setClassTeacherStatusFilter] = useState("__all__");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [assignmentsRaw, classTeacherAssignmentsRaw, teachersRaw, subjectsRaw, classesRaw] = await Promise.all([
        api.get<unknown>("/tenants/hr/teacher-assignments?include_inactive=true&limit=500", {
          tenantRequired: true,
          noRedirect: true,
        }),
        api.get<unknown>("/tenants/hr/class-teacher-assignments?include_inactive=true&limit=500", {
          tenantRequired: true,
          noRedirect: true,
        }),
        api.get<unknown>("/tenants/hr/staff?staff_type=TEACHING&include_inactive=false&limit=500", {
          tenantRequired: true,
          noRedirect: true,
        }),
        api.get<unknown>("/tenants/subjects?include_inactive=false", {
          tenantRequired: true,
          noRedirect: true,
        }),
        api.get<unknown>("/tenants/classes?include_inactive=false", {
          tenantRequired: true,
          noRedirect: true,
        }),
      ]);

      setAssignments(normalizeTeacherAssignments(assignmentsRaw));
      setClassTeacherAssignments(normalizeClassTeacherAssignments(classTeacherAssignmentsRaw));
      setTeachers(normalizeStaff(teachersRaw).filter((row) => row.staff_type === "TEACHING"));
      setSubjects(normalizeSubjects(subjectsRaw));
      setClasses(normalizeClassOptions(classesRaw));
    } catch (err: any) {
      setAssignments([]);
      setClassTeacherAssignments([]);
      setTeachers([]);
      setSubjects([]);
      setClasses([]);
      toast.error(
        typeof err?.message === "string"
          ? err.message
          : "Failed to load teacher assignment data"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assignments.filter((row) => {
      const searchMatch =
        !q ||
        row.staff_name.toLowerCase().includes(q) ||
        row.staff_no.toLowerCase().includes(q) ||
        row.subject_code.toLowerCase().includes(q) ||
        row.subject_name.toLowerCase().includes(q) ||
        row.class_code.toLowerCase().includes(q);

      const classMatch = classFilter === "__all__" || row.class_code === classFilter;
      const subjectMatch =
        subjectFilter === "__all__" || row.subject_id === subjectFilter;
      const statusMatch =
        statusFilter === "__all__" ||
        (statusFilter === "ACTIVE" ? row.is_active : !row.is_active);

      return searchMatch && classMatch && subjectMatch && statusMatch;
    });
  }, [assignments, classFilter, query, statusFilter, subjectFilter]);

  const filteredClassTeacherRows = useMemo(() => {
    const q = classTeacherQuery.trim().toLowerCase();
    return classTeacherAssignments.filter((row) => {
      const searchMatch =
        !q ||
        row.staff_name.toLowerCase().includes(q) ||
        row.staff_no.toLowerCase().includes(q) ||
        row.class_code.toLowerCase().includes(q);

      const classMatch =
        classTeacherClassFilter === "__all__" || row.class_code === classTeacherClassFilter;
      const statusMatch =
        classTeacherStatusFilter === "__all__" ||
        (classTeacherStatusFilter === "ACTIVE" ? row.is_active : !row.is_active);

      return searchMatch && classMatch && statusMatch;
    });
  }, [classTeacherAssignments, classTeacherClassFilter, classTeacherQuery, classTeacherStatusFilter]);

  const activeTeachersById = useMemo(
    () => new Map(teachers.map((teacher) => [teacher.id, teacher])),
    [teachers]
  );

  const subjectLoadByTeacher = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of assignments) {
      if (!row.is_active) continue;
      if (!activeTeachersById.has(row.staff_id)) continue;
      const key = `${row.subject_id}|${row.staff_id}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [activeTeachersById, assignments]);

  const suggestTeachers = useCallback(
    (subjectId: string, excludeStaffId?: string): SuggestedTeacher[] => {
      if (!subjectId) return [];
      const suggestions = teachers
        .filter((teacher) => teacher.id !== excludeStaffId)
        .map((teacher) => ({
          teacher,
          subjectLoad: subjectLoadByTeacher.get(`${subjectId}|${teacher.id}`) ?? 0,
          primarySubjectMatch: teacher.primary_subject_id === subjectId,
        }))
        .sort((a, b) => {
          if (a.subjectLoad !== b.subjectLoad) return b.subjectLoad - a.subjectLoad;
          if (a.primarySubjectMatch !== b.primarySubjectMatch) {
            return a.primarySubjectMatch ? -1 : 1;
          }
          return a.teacher.full_name.localeCompare(b.teacher.full_name);
        });
      return suggestions.slice(0, 5);
    },
    [subjectLoadByTeacher, teachers]
  );

  const formSuggestions = useMemo(
    () => suggestTeachers(form.subject_id, form.staff_id),
    [form.staff_id, form.subject_id, suggestTeachers]
  );

  async function createAssignment() {
    if (!form.staff_id || !form.subject_id || !form.class_code) {
      toast.error("Teacher, subject, and class are required.");
      return;
    }

    setSaving(true);
    try {
      await api.post(
        "/tenants/hr/teacher-assignments",
        {
          staff_id: form.staff_id,
          subject_id: form.subject_id,
          class_code: form.class_code.trim().toUpperCase(),
          notes: form.notes.trim() || null,
          is_active: form.is_active,
        },
        { tenantRequired: true }
      );
      toast.success("Teacher assignment saved.");
      setForm(initialForm);
      await load();
    } catch (err: any) {
      toast.error(
        typeof err?.message === "string"
          ? err.message
          : "Failed to create teacher assignment"
      );
    } finally {
      setSaving(false);
    }
  }

  async function createClassTeacherAssignment() {
    if (!classTeacherForm.staff_id || !classTeacherForm.class_code) {
      toast.error("Teacher and class are required.");
      return;
    }

    setClassTeacherSaving(true);
    try {
      await api.post(
        "/tenants/hr/class-teacher-assignments",
        {
          staff_id: classTeacherForm.staff_id,
          class_code: classTeacherForm.class_code.trim().toUpperCase(),
          notes: classTeacherForm.notes.trim() || null,
          is_active: classTeacherForm.is_active,
        },
        { tenantRequired: true }
      );
      toast.success("Class teacher assignment saved.");
      setClassTeacherForm(initialClassTeacherForm);
      await load();
    } catch (err: any) {
      toast.error(
        typeof err?.message === "string"
          ? err.message
          : "Failed to create class teacher assignment"
      );
    } finally {
      setClassTeacherSaving(false);
    }
  }

  async function toggleAssignmentStatus(row: TeacherAssignment) {
    setUpdatingId(row.id);
    try {
      await api.put(
        `/tenants/hr/teacher-assignments/${row.id}`,
        { is_active: !row.is_active },
        { tenantRequired: true }
      );
      toast.success(`Assignment ${row.is_active ? "deactivated" : "activated"}.`);
      await load();
    } catch (err: any) {
      toast.error(
        typeof err?.message === "string"
          ? err.message
          : "Failed to update assignment status"
      );
    } finally {
      setUpdatingId(null);
    }
  }

  async function toggleClassTeacherAssignmentStatus(row: ClassTeacherAssignment) {
    setClassTeacherUpdatingId(row.id);
    try {
      await api.put(
        `/tenants/hr/class-teacher-assignments/${row.id}`,
        { is_active: !row.is_active },
        { tenantRequired: true }
      );
      toast.success(`Class teacher assignment ${row.is_active ? "deactivated" : "activated"}.`);
      await load();
    } catch (err: any) {
      toast.error(
        typeof err?.message === "string"
          ? err.message
          : "Failed to update class teacher assignment status"
      );
    } finally {
      setClassTeacherUpdatingId(null);
    }
  }

  async function deleteAssignment(row: TeacherAssignment) {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Delete assignment for ${row.subject_code} in ${row.class_code} (${row.staff_name})?`
      );
      if (!confirmed) return;
    }

    setDeletingId(row.id);
    try {
      await api.delete(
        `/tenants/hr/teacher-assignments/${row.id}`,
        undefined,
        { tenantRequired: true }
      );
      toast.success("Assignment deleted.");
      await load();
    } catch (err: any) {
      toast.error(
        typeof err?.message === "string"
          ? err.message
          : "Failed to delete assignment"
      );
    } finally {
      setDeletingId(null);
    }
  }

  async function deleteClassTeacherAssignment(row: ClassTeacherAssignment) {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Delete class teacher assignment for ${row.class_code} (${row.staff_name})?`
      );
      if (!confirmed) return;
    }

    setClassTeacherDeletingId(row.id);
    try {
      await api.delete(
        `/tenants/hr/class-teacher-assignments/${row.id}`,
        undefined,
        { tenantRequired: true }
      );
      toast.success("Class teacher assignment deleted.");
      await load();
    } catch (err: any) {
      toast.error(
        typeof err?.message === "string"
          ? err.message
          : "Failed to delete class teacher assignment"
      );
    } finally {
      setClassTeacherDeletingId(null);
    }
  }

  function prefillReassignment(row: TeacherAssignment, nextTeacherId?: string) {
    setForm((prev) => ({
      ...prev,
      subject_id: row.subject_id,
      class_code: row.class_code,
      staff_id: nextTeacherId ?? prev.staff_id,
      is_active: true,
    }));
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  return (
    <AppShell title={appTitle} nav={nav} activeHref={activeHref}>
      <div className="space-y-5">
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-600 to-blue-500 p-5 text-white shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold">HR · Teacher Assignment</h1>
              <p className="mt-0.5 text-sm text-blue-100">
                Assign teaching staff to subject-class pairs with uniqueness control per class.
              </p>
            </div>
            <Button
              variant="outline"
              className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              onClick={() => void load()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-slate-900">Assign Teacher</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              One subject per class can only have one active teacher assignment at a time.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Teacher *</Label>
              <Select
                value={form.staff_id || "__none__"}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, staff_id: value === "__none__" ? "" : value }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select teacher" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select teacher</SelectItem>
                  {teachers.map((teacher) => (
                    <SelectItem key={teacher.id} value={teacher.id}>
                      {teacher.full_name} ({teacher.staff_no})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Subject *</Label>
              <Select
                value={form.subject_id || "__none__"}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, subject_id: value === "__none__" ? "" : value }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select subject" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select subject</SelectItem>
                  {subjects.map((subject) => (
                    <SelectItem key={subject.id} value={subject.id}>
                      {subject.code} · {subject.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Class *</Label>
              <Select
                value={form.class_code || "__none__"}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, class_code: value === "__none__" ? "" : value }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select class" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select class</SelectItem>
                  {classes.map((classRow) => (
                    <SelectItem key={classRow.id} value={classRow.code}>
                      {classRow.code} · {classRow.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select
                value={form.is_active ? "ACTIVE" : "INACTIVE"}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, is_active: value === "ACTIVE" }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="INACTIVE">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-3 space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="Assignment reason or timetable note"
            />
          </div>

          {form.subject_id && form.class_code && (
            <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3">
              <div className="text-xs font-semibold text-blue-900">Suggested Teachers</div>
              <div className="mt-1 text-[11px] text-blue-700">
                Suggestions are ranked by active subject load, then teacher primary-subject match.
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {formSuggestions.length === 0 && (
                  <span className="text-[11px] text-blue-700">
                    No active teacher suggestions available.
                  </span>
                )}
                {formSuggestions.map((item) => (
                  <Button
                    key={item.teacher.id}
                    size="sm"
                    variant="outline"
                    className="h-7 border-blue-200 bg-white text-[11px] text-blue-800 hover:bg-blue-100"
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        staff_id: item.teacher.id,
                        is_active: true,
                      }))
                    }
                  >
                    {item.teacher.full_name} ({item.teacher.staff_no}) · load:{item.subjectLoad}
                    {item.primarySubjectMatch ? " · subject match" : ""}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4">
            <Button onClick={() => void createAssignment()} disabled={saving}>
              {saving ? "Saving..." : "Save Assignment"}
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-slate-900">Assign Class Teacher</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              One class can only have one active class teacher assignment at a time.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Teacher *</Label>
              <Select
                value={classTeacherForm.staff_id || "__none__"}
                onValueChange={(value) =>
                  setClassTeacherForm((prev) => ({
                    ...prev,
                    staff_id: value === "__none__" ? "" : value,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select teacher" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select teacher</SelectItem>
                  {teachers.map((teacher) => (
                    <SelectItem key={teacher.id} value={teacher.id}>
                      {teacher.full_name} ({teacher.staff_no})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Class *</Label>
              <Select
                value={classTeacherForm.class_code || "__none__"}
                onValueChange={(value) =>
                  setClassTeacherForm((prev) => ({
                    ...prev,
                    class_code: value === "__none__" ? "" : value,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select class" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select class</SelectItem>
                  {classes.map((classRow) => (
                    <SelectItem key={classRow.id} value={classRow.code}>
                      {classRow.code} · {classRow.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select
                value={classTeacherForm.is_active ? "ACTIVE" : "INACTIVE"}
                onValueChange={(value) =>
                  setClassTeacherForm((prev) => ({
                    ...prev,
                    is_active: value === "ACTIVE",
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="INACTIVE">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-3 space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <Textarea
              value={classTeacherForm.notes}
              onChange={(e) =>
                setClassTeacherForm((prev) => ({ ...prev, notes: e.target.value }))
              }
              placeholder="Optional class teacher note"
            />
          </div>

          <div className="mt-4">
            <Button onClick={() => void createClassTeacherAssignment()} disabled={classTeacherSaving}>
              {classTeacherSaving ? "Saving..." : "Save Class Teacher Assignment"}
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Class Teacher Assignments</h2>
              <span className="text-xs text-slate-500">Total: {filteredClassTeacherRows.length}</span>
            </div>

            <div className="grid gap-2 md:grid-cols-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  value={classTeacherQuery}
                  onChange={(e) => setClassTeacherQuery(e.target.value)}
                  className="pl-8"
                  placeholder="Search teacher or class"
                />
              </div>

              <Select value={classTeacherClassFilter} onValueChange={setClassTeacherClassFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All classes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All classes</SelectItem>
                  {classes.map((classRow) => (
                    <SelectItem key={classRow.id} value={classRow.code}>
                      {classRow.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={classTeacherStatusFilter} onValueChange={setClassTeacherStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All statuses</SelectItem>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="INACTIVE">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="text-xs">Class</TableHead>
                <TableHead className="text-xs">Teacher</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Notes</TableHead>
                <TableHead className="text-xs text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!loading &&
                filteredClassTeacherRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs font-medium text-slate-900">{row.class_code}</TableCell>
                    <TableCell className="text-xs text-slate-700">
                      <div>{row.staff_name}</div>
                      <div className="font-mono text-[11px] text-slate-500">{row.staff_no}</div>
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const teacherOnStaff = activeTeachersById.has(row.staff_id);
                        const effectiveActive = row.is_active && teacherOnStaff;
                        return (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={
                                effectiveActive
                                  ? "inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700"
                                  : "inline-flex rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600"
                              }
                            >
                              {effectiveActive ? "Active" : "Inactive"}
                            </span>
                            {!teacherOnStaff && (
                              <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                                Teacher no longer on staff
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate text-xs text-slate-600">
                      {row.notes || "N/A"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void toggleClassTeacherAssignmentStatus(row)}
                          disabled={classTeacherUpdatingId === row.id || classTeacherDeletingId === row.id}
                        >
                          {classTeacherUpdatingId === row.id
                            ? "Saving..."
                            : row.is_active
                              ? "Deactivate"
                              : "Activate"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                          onClick={() => void deleteClassTeacherAssignment(row)}
                          disabled={classTeacherDeletingId === row.id || classTeacherUpdatingId === row.id}
                        >
                          {classTeacherDeletingId === row.id ? "Deleting..." : "Delete"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}

              {!loading && filteredClassTeacherRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-slate-500">
                    No class teacher assignments found.
                  </TableCell>
                </TableRow>
              )}

              {loading && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-slate-500">
                    Loading class teacher assignments...
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Teacher Assignments</h2>
              <span className="text-xs text-slate-500">Total: {filteredRows.length}</span>
            </div>

            <div className="grid gap-2 md:grid-cols-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-8"
                  placeholder="Search teacher, class, subject"
                />
              </div>

              <Select value={classFilter} onValueChange={setClassFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All classes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All classes</SelectItem>
                  {classes.map((classRow) => (
                    <SelectItem key={classRow.id} value={classRow.code}>
                      {classRow.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={subjectFilter} onValueChange={setSubjectFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All subjects" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All subjects</SelectItem>
                  {subjects.map((subject) => (
                    <SelectItem key={subject.id} value={subject.id}>
                      {subject.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All statuses</SelectItem>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="INACTIVE">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="text-xs">Class</TableHead>
                <TableHead className="text-xs">Subject</TableHead>
                <TableHead className="text-xs">Teacher</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Notes</TableHead>
                <TableHead className="text-xs text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!loading &&
                filteredRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs font-medium text-slate-900">
                      {row.class_code}
                    </TableCell>
                    <TableCell className="text-xs text-slate-700">
                      <div>{row.subject_name}</div>
                      <div className="font-mono text-[11px] text-slate-500">{row.subject_code}</div>
                    </TableCell>
                    <TableCell className="text-xs text-slate-700">
                      <div>{row.staff_name}</div>
                      <div className="font-mono text-[11px] text-slate-500">{row.staff_no}</div>
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const teacherOnStaff = activeTeachersById.has(row.staff_id);
                        const effectiveActive = row.is_active && teacherOnStaff;
                        return (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={
                                effectiveActive
                                  ? "inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700"
                                  : "inline-flex rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600"
                              }
                            >
                              {effectiveActive ? "Active" : "Inactive"}
                            </span>
                            {!teacherOnStaff && (
                              <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                                Teacher no longer on staff
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate text-xs text-slate-600">
                      {row.notes || "N/A"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end gap-2">
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void toggleAssignmentStatus(row)}
                            disabled={updatingId === row.id || deletingId === row.id}
                          >
                            {updatingId === row.id
                              ? "Saving..."
                              : row.is_active
                                ? "Deactivate"
                                : "Activate"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                            onClick={() => void deleteAssignment(row)}
                            disabled={deletingId === row.id || updatingId === row.id}
                          >
                            {deletingId === row.id ? "Deleting..." : "Delete"}
                          </Button>
                        </div>
                        {!activeTeachersById.has(row.staff_id) && (
                          <div className="flex flex-wrap justify-end gap-1">
                            {suggestTeachers(row.subject_id, row.staff_id)
                              .slice(0, 2)
                              .map((item) => (
                                <Button
                                  key={`${row.id}-${item.teacher.id}`}
                                  size="sm"
                                  variant="outline"
                                  className="h-6 border-blue-200 bg-blue-50 px-2 text-[11px] text-blue-800 hover:bg-blue-100"
                                  onClick={() => prefillReassignment(row, item.teacher.id)}
                                >
                                  Reassign: {item.teacher.staff_no}
                                </Button>
                              ))}
                            {suggestTeachers(row.subject_id, row.staff_id).length === 0 && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 border-blue-200 bg-blue-50 px-2 text-[11px] text-blue-800 hover:bg-blue-100"
                                onClick={() => prefillReassignment(row)}
                              >
                                Reassign
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}

              {!loading && filteredRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-slate-500">
                    No teacher assignments found.
                  </TableCell>
                </TableRow>
              )}

              {loading && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-slate-500">
                    Loading teacher assignments...
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </AppShell>
  );
}
