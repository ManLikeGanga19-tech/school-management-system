"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, RefreshCw, Search } from "lucide-react";

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
import { api } from "@/lib/api";
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

export function AllStudentsPage({
  appTitle,
  nav,
  activeHref,
  profileBasePath,
}: AllStudentsPageProps) {
  const [rows, setRows] = useState<EnrollmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("__all__");
  const [classFilter, setClassFilter] = useState("__all__");
  const [termFilter, setTermFilter] = useState("__all__");
  const [medicalFilter, setMedicalFilter] = useState("__all__");
  const [page, setPage] = useState(1);

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
  }, [load]);

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

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter, classFilter, termFilter, medicalFilter]);

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
