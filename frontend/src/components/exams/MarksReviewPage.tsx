"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardList, RefreshCw } from "lucide-react";

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

type Filters = {
  term_id: string;
  exam_id: string;
  class_code: string;
  subject_id: string;
};

const defaultFilters: Filters = {
  term_id: "",
  exam_id: "",
  class_code: "",
  subject_id: "",
};

export function MarksReviewPage({ appTitle, nav, activeHref }: Props) {
  const [loading, setLoading] = useState(true);

  const [examRows, setExamRows] = useState<TenantExam[]>([]);
  const [markRows, setMarkRows] = useState<TenantExamMark[]>([]);
  const [termRows, setTermRows] = useState<TenantTerm[]>([]);
  const [classRows, setClassRows] = useState<TenantClassOption[]>([]);
  const [subjectRows, setSubjectRows] = useState<TenantSubject[]>([]);

  const [filters, setFilters] = useState<Filters>(defaultFilters);

  const load = useCallback(async () => {
    setLoading(true);
    const [examsRes, marksRes, termsRes, classesRes, subjectsRes] = await Promise.allSettled([
      api.get("/tenants/exams?limit=500&offset=0&include_inactive=true", { tenantRequired: true, noRedirect: true }),
      api.get("/tenants/exams/marks?limit=500&offset=0", { tenantRequired: true, noRedirect: true }),
      api.get("/tenants/terms?include_inactive=false", { tenantRequired: true, noRedirect: true }),
      api.get("/tenants/classes?include_inactive=false", { tenantRequired: true, noRedirect: true }),
      api.get("/tenants/subjects?include_inactive=false", { tenantRequired: true, noRedirect: true }),
    ]);

    if (examsRes.status === "fulfilled") setExamRows(normalizeExams(examsRes.value));
    if (marksRes.status === "fulfilled") setMarkRows(normalizeExamMarks(marksRes.value));
    if (termsRes.status === "fulfilled") setTermRows(normalizeTerms(termsRes.value));
    if (classesRes.status === "fulfilled") setClassRows(normalizeClassOptions(classesRes.value));
    if (subjectsRes.status === "fulfilled") setSubjectRows(normalizeSubjects(subjectsRes.value));

    if ([examsRes, marksRes, termsRes, classesRes, subjectsRes].some((r) => r.status === "rejected")) {
      toast.error("Some data failed to load.");
    }

    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Auto-select first term
  useEffect(() => {
    if (termRows.length === 0) return;
    setFilters((prev) => prev.term_id ? prev : { ...prev, term_id: termRows[0].id });
  }, [termRows]);

  const examOptions = useMemo(
    () => examRows.filter((row) => !filters.term_id || row.term_id === filters.term_id),
    [examRows, filters.term_id]
  );

  // Clear exam filter when term changes if exam no longer belongs to term
  useEffect(() => {
    if (!filters.exam_id) return;
    const found = examRows.find((r) => r.id === filters.exam_id);
    if (found && filters.term_id && found.term_id !== filters.term_id) {
      setFilters((prev) => ({ ...prev, exam_id: "" }));
    }
  }, [examRows, filters.exam_id, filters.term_id]);

  const filteredMarks = useMemo(() => {
    return markRows.filter((row) => {
      if (filters.term_id && row.term_id !== filters.term_id) return false;
      if (filters.exam_id && row.exam_id !== filters.exam_id) return false;
      if (filters.class_code && row.class_code !== filters.class_code) return false;
      if (filters.subject_id && row.subject_id !== filters.subject_id) return false;
      return true;
    });
  }, [markRows, filters]);

  const summary = useMemo(() => {
    const total = filteredMarks.length;
    const examCount = new Set(filteredMarks.map((r) => r.exam_id)).size;
    const avg =
      total === 0
        ? 0
        : Math.round(
            (filteredMarks.reduce((sum, row) => {
              const max = toNumber(row.max_marks);
              if (max <= 0) return sum;
              return sum + (toNumber(row.marks_obtained) / max) * 100;
            }, 0) /
              total) *
              100
          ) / 100;
    return { total, examCount, avg };
  }, [filteredMarks]);

  return (
    <AppShell title={appTitle} nav={nav} activeHref={activeHref}>
      <div className="space-y-6">
        <TenantPageHeader
          title="Marks Review"
          description="Filter and review all recorded exam marks across terms, classes, and subjects."
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

        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Total Records", value: summary.total },
            { label: "Exams Covered", value: summary.examCount },
            { label: "Average Score", value: `${summary.avg}%` },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-2xl border border-slate-100 bg-white px-6 py-4 shadow-sm">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 px-6 py-4">
            <ClipboardList className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-900">Recorded Marks</h2>
            <span className="ml-auto text-xs text-slate-400">{summary.total} rows</span>
          </div>

          {/* Filters */}
          <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Term</Label>
              <Select
                value={filters.term_id || "__all__"}
                onValueChange={(v) => setFilters((prev) => ({ ...prev, term_id: v === "__all__" ? "" : v, exam_id: "" }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All terms" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All terms</SelectItem>
                  {termRows.map((row) => (
                    <SelectItem key={row.id} value={row.id}>{row.code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Exam</Label>
              <Select
                value={filters.exam_id || "__all__"}
                onValueChange={(v) => setFilters((prev) => ({ ...prev, exam_id: v === "__all__" ? "" : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All exams" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All exams</SelectItem>
                  {examOptions.map((row) => (
                    <SelectItem key={row.id} value={row.id}>{row.name} — {row.class_code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Class</Label>
              <Select
                value={filters.class_code || "__all__"}
                onValueChange={(v) => setFilters((prev) => ({ ...prev, class_code: v === "__all__" ? "" : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All classes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All classes</SelectItem>
                  {classRows.map((row) => (
                    <SelectItem key={row.id} value={row.code}>{row.code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Subject</Label>
              <Select
                value={filters.subject_id || "__all__"}
                onValueChange={(v) => setFilters((prev) => ({ ...prev, subject_id: v === "__all__" ? "" : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All subjects" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All subjects</SelectItem>
                  {subjectRows.map((row) => (
                    <SelectItem key={row.id} value={row.id}>{row.code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="overflow-x-auto [&_table]:min-w-[900px]">
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
                {loading && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-12 text-center text-sm text-slate-400">
                      Loading marks...
                    </TableCell>
                  </TableRow>
                )}
                {!loading && filteredMarks.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-12 text-center text-sm text-slate-400">
                      No marks recorded for the selected filters.
                    </TableCell>
                  </TableRow>
                )}
                {!loading &&
                  filteredMarks.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-sm">
                        <div className="font-medium text-slate-900">{row.student_name}</div>
                        <div className="text-xs text-slate-500">{row.admission_number || ""}</div>
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {row.term_code || row.term_name || "—"}
                      </TableCell>
                      <TableCell className="text-sm text-slate-700">{row.exam_name}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-600">{row.class_code}</TableCell>
                      <TableCell className="text-sm text-slate-700">
                        {row.subject_code ? `${row.subject_code} — ${row.subject_name || ""}` : "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm font-semibold text-slate-900">
                        {toNumber(row.marks_obtained)} / {toNumber(row.max_marks)}
                      </TableCell>
                      <TableCell className="text-sm text-slate-700">{row.grade || "—"}</TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {row.updated_at || row.recorded_at || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
