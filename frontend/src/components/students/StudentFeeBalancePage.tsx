"use client";

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
  buildStudentFeeBalanceRows,
  normalizeEnrollmentRows,
  normalizeFinanceSnapshot,
  type EnrollmentRow,
  type StudentFeeBalanceRow,
} from "@/lib/students";
import {
  buildDefaultTerms,
  normalizeTerms,
  type TenantTerm,
} from "@/lib/school-setup/terms";
import { StudentDetailDialog } from "@/components/students/StudentDetailDialog";

type StudentFeeBalancePageProps = {
  appTitle: string;
  nav: AppNavItem[];
  activeHref: string;
  financePath: string;
};

const PAGE_SIZE = 12;

function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 2,
  }).format(value);
}

export function StudentFeeBalancePage({
  appTitle,
  nav,
  activeHref,
  financePath,
}: StudentFeeBalancePageProps) {
  const [rows, setRows] = useState<StudentFeeBalanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentTermCode, setCurrentTermCode] = useState("N/A");
  const [enrollmentById, setEnrollmentById] = useState<Record<string, EnrollmentRow>>(
    {}
  );

  const [query, setQuery] = useState("");
  const [classFilter, setClassFilter] = useState("__all__");
  const [statusFilter, setStatusFilter] = useState("__all__");
  const [balanceFilter, setBalanceFilter] = useState("__all__");
  const [page, setPage] = useState(1);

  const [viewRow, setViewRow] = useState<EnrollmentRow | null>(null);
  const [viewOpen, setViewOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [financeRaw, termsRaw] = await Promise.all([
        api.get<unknown>(financePath, { tenantRequired: true, noRedirect: true }),
        api.get<unknown>("/tenants/terms?include_inactive=true", {
          tenantRequired: true,
          noRedirect: true,
        }),
      ]);

      const normalizedTerms = normalizeTerms(termsRaw);
      const terms: TenantTerm[] =
        normalizedTerms.length > 0 ? normalizedTerms : buildDefaultTerms();

      const snapshot = normalizeFinanceSnapshot(financeRaw);
      if (snapshot.enrollments.length === 0) {
        try {
          const fallback = await api.get<unknown>("/enrollments/", {
            tenantRequired: true,
            noRedirect: true,
          });
          snapshot.enrollments = normalizeEnrollmentRows(fallback);
        } catch {
          // keep best effort
        }
      }

      const balanceData = buildStudentFeeBalanceRows(snapshot, terms);
      setRows(balanceData.rows);
      setCurrentTermCode(balanceData.currentTermCode || "N/A");

      const byId: Record<string, EnrollmentRow> = {};
      snapshot.enrollments.forEach((row) => {
        byId[row.id] = row;
      });
      setEnrollmentById(byId);
    } catch (err: any) {
      setRows([]);
      setEnrollmentById({});
      toast.error(
        typeof err?.message === "string"
          ? err.message
          : "Unable to load student fee balances"
      );
    } finally {
      setLoading(false);
    }
  }, [financePath]);

  useEffect(() => {
    void load();
  }, [load]);

  const classOptions = useMemo(() => {
    const options = new Set<string>();
    rows.forEach((row) => {
      if (row.class_code) options.add(row.class_code);
    });
    return Array.from(options).sort();
  }, [rows]);

  const statusOptions = useMemo(() => {
    const options = new Set<string>();
    rows.forEach((row) => {
      if (row.status) options.add(row.status.toUpperCase());
    });
    return Array.from(options).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      const searchMatch =
        !q ||
        row.student_name.toLowerCase().includes(q) ||
        row.class_code.toLowerCase().includes(q) ||
        row.status.toLowerCase().includes(q) ||
        row.admission_number.toLowerCase().includes(q) ||
        row.enrollment_id.toLowerCase().includes(q);

      const classMatch = classFilter === "__all__" || row.class_code === classFilter;
      const statusMatch = statusFilter === "__all__" || row.status === statusFilter;

      let balanceMatch = true;
      if (balanceFilter === "OUTSTANDING") {
        balanceMatch = row.full_balance > 0.009;
      } else if (balanceFilter === "CLEARED") {
        balanceMatch = row.full_balance <= 0.009;
      } else if (balanceFilter === "NO_STRUCTURE") {
        balanceMatch = !row.has_structure;
      }

      return searchMatch && classMatch && statusMatch && balanceMatch;
    });
  }, [rows, query, classFilter, statusFilter, balanceFilter]);

  useEffect(() => {
    setPage(1);
  }, [query, classFilter, statusFilter, balanceFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const outstandingCount = useMemo(
    () => rows.filter((row) => row.full_balance > 0.009).length,
    [rows]
  );
  const totalOutstanding = useMemo(
    () => rows.reduce((sum, row) => sum + row.full_balance, 0),
    [rows]
  );

  return (
    <AppShell title={appTitle} nav={nav} activeHref={activeHref}>
      <div className="space-y-5">
        <StudentDetailDialog
          row={viewRow}
          open={viewOpen}
          onClose={() => {
            setViewOpen(false);
            setViewRow(null);
          }}
        />

        <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-600 to-blue-500 p-5 text-white shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold">Students · Fee Balance</h1>
              <p className="mt-0.5 text-sm text-blue-100">
                Current term and full fee-structure balances across enrolled students.
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

        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Current Term</div>
            <div className="mt-1 text-lg font-bold text-blue-700">{currentTermCode}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Students</div>
            <div className="mt-1 text-lg font-bold text-slate-900">{rows.length}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Outstanding Accounts</div>
            <div className="mt-1 text-lg font-bold text-amber-700">{outstandingCount}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Total Outstanding</div>
            <div className="mt-1 text-lg font-bold text-red-700">
              {formatKes(totalOutstanding)}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-800">
          Current-term paid amount is presented against the term obligation for visibility,
          while full balance is based on tenant invoices when available.
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Student Fee Balance Table</h2>
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

              <Select value={balanceFilter} onValueChange={setBalanceFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All balances" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All balances</SelectItem>
                  <SelectItem value="OUTSTANDING">Outstanding only</SelectItem>
                  <SelectItem value="CLEARED">Cleared only</SelectItem>
                  <SelectItem value="NO_STRUCTURE">No fee structure link</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="text-xs">Student</TableHead>
                  <TableHead className="text-xs">Adm. No.</TableHead>
                  <TableHead className="text-xs">Class</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Current Term Fee</TableHead>
                  <TableHead className="text-xs">Current Term Paid</TableHead>
                  <TableHead className="text-xs">Current Term Balance</TableHead>
                  <TableHead className="text-xs">Full Structure Total</TableHead>
                  <TableHead className="text-xs">Total Paid</TableHead>
                  <TableHead className="text-xs">Full Balance</TableHead>
                  <TableHead className="text-xs">Invoices</TableHead>
                  <TableHead className="text-xs text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!loading &&
                  pageRows.map((row) => (
                    <TableRow key={row.enrollment_id} className="hover:bg-slate-50">
                      <TableCell className="text-sm font-medium">{row.student_name}</TableCell>
                      <TableCell className="font-mono text-xs text-emerald-700">
                        {row.admission_number || "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-slate-600">
                        {row.class_code || "—"}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 ring-1 ring-blue-200">
                          {row.status || "UNKNOWN"}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-slate-700">
                        {formatKes(row.current_term_fee)}
                      </TableCell>
                      <TableCell className="text-xs text-emerald-700">
                        {formatKes(row.current_term_paid)}
                      </TableCell>
                      <TableCell className="text-xs text-red-700">
                        {formatKes(row.current_term_balance)}
                      </TableCell>
                      <TableCell className="text-xs text-slate-700">
                        {row.has_structure ? formatKes(row.full_structure_total) : "Not linked"}
                      </TableCell>
                      <TableCell className="text-xs text-emerald-700">
                        {formatKes(row.total_paid)}
                      </TableCell>
                      <TableCell className="text-xs text-red-700">
                        {formatKes(row.full_balance)}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {row.invoice_count}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1 text-xs"
                          onClick={() => {
                            const enrollment = enrollmentById[row.enrollment_id];
                            if (!enrollment) {
                              toast.error("Student detail record not found.");
                              return;
                            }
                            setViewRow(enrollment);
                            setViewOpen(true);
                          }}
                        >
                          <Eye className="h-3.5 w-3.5" />
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}

                {!loading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={12} className="py-10 text-center text-sm text-slate-400">
                      No student balances found for current filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

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
