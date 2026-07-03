"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePersistedState } from "@/lib/usePersistedState";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Eye,
  Link2,
  Printer,
  RefreshCw,
  Search,
  ShieldCheck,
  SplitSquareHorizontal,
  Wand2,
} from "lucide-react";

import { AppShell, type AppNavItem } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { api, apiFetchRaw } from "@/lib/api";
import {
  admissionNumber,
  normalizeEnrollmentRows,
  payloadBoolean,
  studentClass,
  studentName,
  type EnrollmentRow,
} from "@/lib/students";
import { termFromPayload } from "@/lib/school-setup/terms";

type AllStudentsPageProps = {
  appTitle: string;
  nav: AppNavItem[];
  activeHref: string;
  profileBasePath: string;
};

const PAGE_SIZE = 12;

// ── Phase T3 — Guardian data-quality checker ────────────────────────────────

type DataQualityIssueRow = {
  enrollment_id: string;
  enrollment_status: string;
  student_id: string | null;
  student_name: string;
  admission_number: string | null;
  class_code: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  issues: string[];
  suggested: {
    split_phones?: string[];
    normalized_phone?: string;
    matched_parent?: { parent_id: string; parent_name: string };
  } | null;
};

type DataQualityReport = {
  checked: number;
  flagged: number;
  issue_counts: Record<string, number>;
  students: DataQualityIssueRow[];
};

const ISSUE_LABELS: Record<string, { label: string; tone: string }> = {
  NAME_MISSING: { label: "Name missing", tone: "bg-red-50 text-red-700 ring-red-200" },
  NAME_IS_PHONE: { label: "Name is a phone no.", tone: "bg-red-50 text-red-700 ring-red-200" },
  PHONE_MULTI: { label: "Two phone numbers", tone: "bg-amber-50 text-amber-700 ring-amber-200" },
  PHONE_INVALID: { label: "Invalid phone", tone: "bg-amber-50 text-amber-700 ring-amber-200" },
  PARENT_UNLINKED: { label: "Parent not linked", tone: "bg-blue-50 text-blue-700 ring-blue-200" },
};

export function AllStudentsPage({
  appTitle,
  nav,
  activeHref,
  profileBasePath,
}: AllStudentsPageProps) {
  const [rows, setRows] = useState<EnrollmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = usePersistedState("students.all.query", "");
  const [statusFilter, setStatusFilter] = usePersistedState("students.all.status", "__all__");
  const [classFilter, setClassFilter] = usePersistedState("students.all.class", "__all__");
  const [termFilter, setTermFilter] = usePersistedState("students.all.term", "__all__");
  const [medicalFilter, setMedicalFilter] = usePersistedState("students.all.medical", "__all__");
  const [page, setPage] = usePersistedState("students.all.page", 1);

  // Phase T3 — data-quality report state.
  const [dq, setDq] = useState<DataQualityReport | null>(null);
  const [dqLoading, setDqLoading] = useState(false);
  const [dqOpen, setDqOpen] = useState(false);
  const [dqFixing, setDqFixing] = useState<string | null>(null);

  const loadDq = useCallback(async () => {
    setDqLoading(true);
    try {
      const report = await api.get<DataQualityReport>(
        "/tenants/students/data-quality",
        { tenantRequired: true, noRedirect: true },
      );
      setDq(report);
    } catch {
      // Non-critical panel — stay silent, keep the page usable.
      setDq(null);
    } finally {
      setDqLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<unknown>("/enrollments/", {
        tenantRequired: true,
      });
      setRows(normalizeEnrollmentRows(data));
    } catch (err: any) {
      setRows([]);
      toast.error(
        typeof err?.message === "string"
          ? err.message
          : "Unable to load students"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadDq();
  }, [load, loadDq]);

  // Phase U — printable Guardian Information Update Forms. One branded A4
  // page per flagged student with wide handwriting fields; the school
  // prints the batch (or one student's form) and sends it home.
  const [dqPrinting, setDqPrinting] = useState(false);
  async function printDqForms(enrollmentId?: string) {
    setDqPrinting(true);
    try {
      const qs = enrollmentId
        ? `?enrollment_id=${encodeURIComponent(enrollmentId)}`
        : "";
      const res = await apiFetchRaw(
        `/tenants/students/data-quality/export.pdf${qs}`,
        { method: "GET", tenantRequired: true },
      );
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const tab = window.open(url, "_blank");
      if (!tab) toast.error("Pop-up blocked — allow pop-ups to print the forms.");
    } catch {
      toast.error("Failed to generate the correction forms PDF.");
    } finally {
      setDqPrinting(false);
    }
  }

  async function runDqFix(enrollmentId: string, action: string) {
    setDqFixing(`${enrollmentId}:${action}`);
    try {
      await api.post<unknown>(
        "/tenants/students/data-quality/fix",
        { enrollment_id: enrollmentId, action },
        { tenantRequired: true },
      );
      toast.success(
        action === "SPLIT_MULTI_PHONE"
          ? "Phone numbers split into primary + alternate."
          : action === "NORMALIZE_PHONE"
            ? "Phone number normalized."
            : "Parent linked to this student.",
      );
      await Promise.all([loadDq(), load()]);
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (err as { message?: string })?.message;
      toast.error(detail || "Fix failed.");
    } finally {
      setDqFixing(null);
    }
  }

  const statusOptions = useMemo(() => {
    const options = new Set<string>();
    rows.forEach((row) => {
      if (row.status) options.add(row.status.toUpperCase());
    });
    return Array.from(options).sort();
  }, [rows]);

  const classOptions = useMemo(() => {
    const options = new Set<string>();
    rows.forEach((row) => {
      const value = studentClass(row.payload || {});
      if (value) options.add(value);
    });
    return Array.from(options).sort();
  }, [rows]);

  const termOptions = useMemo(() => {
    const options = new Set<string>();
    rows.forEach((row) => {
      const value = termFromPayload(row.payload || {});
      if (value) options.add(value);
    });
    return Array.from(options).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      const payload = row.payload || {};
      const name = studentName(payload).toLowerCase();
      const classCode = studentClass(payload);
      const termCode = termFromPayload(payload);
      const status = (row.status || "").toUpperCase();
      const adm = admissionNumber(row).toLowerCase();
      const hasMedical = payloadBoolean(payload, [
        "has_medical_conditions",
        "has_underlying_medical_conditions",
      ]);

      const searchMatch =
        !q ||
        name.includes(q) ||
        classCode.toLowerCase().includes(q) ||
        termCode.toLowerCase().includes(q) ||
        status.toLowerCase().includes(q) ||
        adm.includes(q) ||
        row.id.toLowerCase().includes(q);

      const statusMatch = statusFilter === "__all__" || status === statusFilter;
      const classMatch = classFilter === "__all__" || classCode === classFilter;
      const termMatch = termFilter === "__all__" || termCode === termFilter;
      const medicalMatch =
        medicalFilter === "__all__" ||
        (medicalFilter === "YES" ? hasMedical : !hasMedical);

      return searchMatch && statusMatch && classMatch && termMatch && medicalMatch;
    });
  }, [rows, query, statusFilter, classFilter, termFilter, medicalFilter]);

  // Reset to page 1 only when the USER changes a filter — not when the saved
  // filters are restored from storage on mount (which would clobber the saved
  // page). The gate flips true after the initial restore settles.
  const pageResetReady = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => { pageResetReady.current = true; }, 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!pageResetReady.current) return;
    setPage(1);
  }, [query, statusFilter, classFilter, termFilter, medicalFilter, setPage]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const enrolledCount = useMemo(
    () =>
      rows.filter((row) =>
        ["ENROLLED", "ENROLLED_PARTIAL"].includes((row.status || "").toUpperCase())
      ).length,
    [rows]
  );

  return (
    <AppShell title={appTitle} nav={nav} activeHref={activeHref}>
      <div className="space-y-5">
        <div className="dashboard-hero rounded-[2rem] p-5 text-white shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold">Students · All Students</h1>
              <p className="mt-0.5 text-sm text-blue-100">
                Unified student register with operational filters and full-detail view.
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

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Total Records</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{rows.length}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Enrolled Students</div>
            <div className="mt-1 text-2xl font-bold text-emerald-700">{enrolledCount}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Filtered Results</div>
            <div className="mt-1 text-2xl font-bold text-blue-700">{filtered.length}</div>
          </div>
        </div>

        {/* ── Phase T3 — Guardian data-quality panel ── */}
        <div className="dashboard-surface rounded-[1.6rem]">
          <button
            className="flex w-full items-center justify-between px-6 py-4 text-left"
            onClick={() => setDqOpen((v) => !v)}
          >
            <div className="flex items-center gap-3">
              {dq && dq.flagged > 0 ? (
                <AlertTriangle className="h-4 w-4 text-amber-500" />
              ) : (
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
              )}
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Guardian Data Quality
                </h2>
                <p className="text-xs text-slate-500">
                  {dqLoading
                    ? "Checking guardian records…"
                    : dq
                      ? dq.flagged > 0
                        ? `${dq.flagged} of ${dq.checked} students have guardian data issues`
                        : `All ${dq.checked} students have clean guardian records`
                      : "Check unavailable"}
                </p>
              </div>
              {dq && dq.flagged > 0 && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800 ring-1 ring-amber-200">
                  {dq.flagged}
                </span>
              )}
            </div>
            {dqOpen ? (
              <ChevronUp className="h-4 w-4 text-slate-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-slate-400" />
            )}
          </button>
          {dqOpen && dq && dq.flagged > 0 && (
            <div className="border-t border-slate-100 px-6 py-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  {Object.entries(dq.issue_counts).map(([code, count]) => {
                    const meta = ISSUE_LABELS[code] ?? {
                      label: code, tone: "bg-slate-50 text-slate-600 ring-slate-200",
                    };
                    return (
                      <span
                        key={code}
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${meta.tone}`}
                      >
                        {meta.label}: {count}
                      </span>
                    );
                  })}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs"
                  disabled={dqPrinting}
                  title="Print one branded table — a row per flagged student, sorted by class, with wide blank columns to fill in by hand while walking the classes"
                  onClick={() => void printDqForms()}
                >
                  <Printer className="h-3.5 w-3.5" />
                  {dqPrinting ? "Generating…" : `Print Update Sheet (${dq.flagged})`}
                </Button>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs">Student</TableHead>
                      <TableHead className="text-xs">Guardian name</TableHead>
                      <TableHead className="text-xs">Guardian phone</TableHead>
                      <TableHead className="text-xs">Issues</TableHead>
                      <TableHead className="text-right text-xs">Fix</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dq.students.map((s) => (
                      <TableRow key={s.enrollment_id} className="hover:bg-slate-50">
                        <TableCell>
                          <Link
                            href={`${profileBasePath}/${encodeURIComponent(s.enrollment_id)}`}
                            className="text-sm font-medium text-blue-700 hover:underline"
                          >
                            {s.student_name}
                          </Link>
                          <div className="text-[11px] text-slate-400">
                            {[s.admission_number, s.class_code, s.enrollment_status.toLowerCase()]
                              .filter(Boolean).join(" · ")}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-slate-600">
                          {s.guardian_name || <span className="text-red-500">—</span>}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-slate-600">
                          {s.guardian_phone || <span className="text-red-500">—</span>}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {s.issues.map((code) => {
                              const meta = ISSUE_LABELS[code] ?? {
                                label: code, tone: "bg-slate-50 text-slate-600 ring-slate-200",
                              };
                              return (
                                <span
                                  key={code}
                                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${meta.tone}`}
                                >
                                  {meta.label}
                                </span>
                              );
                            })}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1.5">
                            <Button
                              size="sm" variant="outline" className="h-7 gap-1 text-[11px]"
                              disabled={dqPrinting}
                              title="Print a one-row update sheet for just this student"
                              onClick={() => void printDqForms(s.enrollment_id)}
                            >
                              <Printer className="h-3 w-3" />
                              Sheet
                            </Button>
                            {s.issues.includes("PHONE_MULTI") && (
                              <Button
                                size="sm" variant="outline" className="h-7 gap-1 text-[11px]"
                                disabled={dqFixing !== null}
                                title={s.suggested?.split_phones
                                  ? `Split into ${s.suggested.split_phones.join(" + ")}`
                                  : "Split the two numbers into primary + alternate"}
                                onClick={() => void runDqFix(s.enrollment_id, "SPLIT_MULTI_PHONE")}
                              >
                                <SplitSquareHorizontal className="h-3 w-3" />
                                {dqFixing === `${s.enrollment_id}:SPLIT_MULTI_PHONE` ? "…" : "Split"}
                              </Button>
                            )}
                            {s.issues.includes("PHONE_INVALID") && s.suggested?.normalized_phone && (
                              <Button
                                size="sm" variant="outline" className="h-7 gap-1 text-[11px]"
                                disabled={dqFixing !== null}
                                title={`Normalize to ${s.suggested.normalized_phone}`}
                                onClick={() => void runDqFix(s.enrollment_id, "NORMALIZE_PHONE")}
                              >
                                <Wand2 className="h-3 w-3" />
                                {dqFixing === `${s.enrollment_id}:NORMALIZE_PHONE` ? "…" : "Normalize"}
                              </Button>
                            )}
                            {s.issues.includes("PARENT_UNLINKED") && (
                              <Button
                                size="sm" variant="outline" className="h-7 gap-1 text-[11px]"
                                disabled={dqFixing !== null}
                                title={s.suggested?.matched_parent
                                  ? `Link to ${s.suggested.matched_parent.parent_name}`
                                  : "Link the matching parent record"}
                                onClick={() => void runDqFix(s.enrollment_id, "LINK_PARENT")}
                              >
                                <Link2 className="h-3 w-3" />
                                {dqFixing === `${s.enrollment_id}:LINK_PARENT` ? "…" : "Link parent"}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="mt-2 text-[11px] text-slate-400">
                Name issues (missing / phone-shaped) need a human — open the
                student's profile to correct them. Every fix is audited.
              </p>
            </div>
          )}
        </div>

        <div className="dashboard-surface rounded-[1.6rem]">
          <div className="border-b border-slate-100 px-6 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Student Table</h2>
              <span className="text-xs text-slate-500">
                Page {safePage} of {totalPages}
              </span>
            </div>

            <div className="grid gap-2 md:grid-cols-5">
              <div className="relative md:col-span-2">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="pl-8"
                  placeholder="Search student, ADM, class, status, record ID"
                />
              </div>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All statuses</SelectItem>
                  {statusOptions.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
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
                  {classOptions.map((classCode) => (
                    <SelectItem key={classCode} value={classCode}>
                      {classCode}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="grid grid-cols-2 gap-2">
                <Select value={termFilter} onValueChange={setTermFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All terms" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All terms</SelectItem>
                    {termOptions.map((term) => (
                      <SelectItem key={term} value={term}>
                        {term}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={medicalFilter} onValueChange={setMedicalFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Medical" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All medical</SelectItem>
                    <SelectItem value="YES">Medical: Yes</SelectItem>
                    <SelectItem value="NO">Medical: No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="text-xs">Student</TableHead>
                <TableHead className="text-xs">Adm. No.</TableHead>
                <TableHead className="text-xs">Class</TableHead>
                <TableHead className="text-xs">Term</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Medical</TableHead>
                <TableHead className="text-xs">Intake Date</TableHead>
                <TableHead className="text-xs text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!loading &&
                pageRows.map((row) => {
                  const payload = row.payload || {};
                  const hasMedical = payloadBoolean(payload, [
                    "has_medical_conditions",
                    "has_underlying_medical_conditions",
                  ]);

                  return (
                    <TableRow key={row.id} className="hover:bg-slate-50">
                      <TableCell className="text-sm font-medium">
                        {studentName(payload)}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-emerald-700">
                        {admissionNumber(row) || "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-slate-600">
                        {studentClass(payload) || "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-slate-600">
                        {termFromPayload(payload) || "—"}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 ring-1 ring-blue-200">
                          {row.status || "UNKNOWN"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${
                            hasMedical
                              ? "bg-amber-50 text-amber-700 ring-amber-200"
                              : "bg-emerald-50 text-emerald-700 ring-emerald-200"
                          }`}
                        >
                          {hasMedical ? "Yes" : "No"}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {String(payload.intake_date || "—")}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="outline" size="sm" className="h-8 gap-1 text-xs">
                          <Link href={`${profileBasePath}/${encodeURIComponent(row.id)}`}>
                            <Eye className="h-3.5 w-3.5" />
                            View Profile
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}

              {!loading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-sm text-slate-400">
                    No students found for current filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 px-6 py-3">
              <span className="text-xs text-slate-500">
                Showing {(safePage - 1) * PAGE_SIZE + 1}-
                {Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  disabled={safePage <= 1}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={safePage >= totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
