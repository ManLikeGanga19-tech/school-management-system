"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, RefreshCw, UserRound } from "lucide-react";

import { AppShell, type AppNavItem } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { asArray } from "@/lib/utils/asArray";

type StudentProfilePageProps = {
  appTitle: string;
  nav: AppNavItem[];
  activeHref: string;
  enrollmentId: string;
  backHref: string;
};

type StudentProfileResponse = {
  enrollment: {
    id: string;
    status: string;
    admission_number?: string | null;
    student_name: string;
    class_code: string;
    term_code: string;
    payload: Record<string, unknown>;
    created_at?: string | null;
    updated_at?: string | null;
  };
  finance: {
    totals: {
      total_invoiced: string;
      total_paid: string;
      total_balance: string;
      allocated_payments: string;
      invoice_count: number;
      payment_count: number;
    };
    term_summary: Array<{
      scope: string;
      invoice_count: number;
      payment_count: number;
      total_invoiced: string;
      total_paid: string;
      total_balance: string;
      allocated_payments: string;
    }>;
    year_summary: Array<{
      scope: string;
      invoice_count: number;
      payment_count: number;
      total_invoiced: string;
      total_paid: string;
      total_balance: string;
      allocated_payments: string;
    }>;
    invoices: Array<{
      id: string;
      invoice_no?: string | null;
      invoice_type: string;
      status: string;
      term_code: string;
      year: string;
      total_amount: string;
      paid_amount: string;
      balance_amount: string;
      created_at?: string | null;
    }>;
    payments: Array<{
      id: string;
      receipt_no?: string | null;
      provider: string;
      reference?: string | null;
      amount: string;
      allocated_amount: string;
      received_at?: string | null;
      allocations: Array<{
        invoice_id: string;
        amount: string;
        term_code: string;
        year: string;
      }>;
    }>;
  };
  exams: {
    totals: {
      record_count: number;
      subject_count: number;
      term_count: number;
    };
    subject_summary: Array<{
      subject_id?: string | null;
      subject_code?: string | null;
      subject_name?: string | null;
      exam_count: number;
      total_obtained: string;
      total_max: string;
      average_percentage?: string | null;
    }>;
    term_summary: Array<{
      term_code: string;
      term_name?: string | null;
      exam_count: number;
      total_obtained: string;
      total_max: string;
      average_percentage?: string | null;
    }>;
    records: Array<{
      id: string;
      exam_name: string;
      term_code?: string | null;
      subject_code?: string | null;
      subject_name?: string | null;
      class_code: string;
      marks_obtained: string;
      max_marks: string;
      percentage?: string | null;
      grade?: string | null;
      recorded_at?: string | null;
      remarks?: string | null;
    }>;
  };
};

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatKes(value: unknown): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 2,
  }).format(toNumber(value));
}

function formatDate(value?: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function payloadString(payload: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function payloadBoolean(payload: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "yes", "1", "y"].includes(normalized)) return true;
      if (["false", "no", "0", "n"].includes(normalized)) return false;
    }
  }
  return false;
}

function normalizeProfileResponse(input: unknown): StudentProfileResponse | null {
  const obj = asObject(input);
  if (!obj) return null;

  const enrollmentObj = asObject(obj.enrollment);
  const financeObj = asObject(obj.finance);
  const examsObj = asObject(obj.exams);
  if (!enrollmentObj || !financeObj || !examsObj) return null;

  const enrollmentPayload = asObject(enrollmentObj.payload) || {};
  const totalsObj = asObject(financeObj.totals) || {};
  const examTotalsObj = asObject(examsObj.totals) || {};

  return {
    enrollment: {
      id: String(enrollmentObj.id || ""),
      status: String(enrollmentObj.status || ""),
      admission_number:
        enrollmentObj.admission_number === null
          ? null
          : String(enrollmentObj.admission_number || ""),
      student_name: String(enrollmentObj.student_name || "Unknown student"),
      class_code: String(enrollmentObj.class_code || ""),
      term_code: String(enrollmentObj.term_code || ""),
      payload: enrollmentPayload,
      created_at: enrollmentObj.created_at ? String(enrollmentObj.created_at) : null,
      updated_at: enrollmentObj.updated_at ? String(enrollmentObj.updated_at) : null,
    },
    finance: {
      totals: {
        total_invoiced: String(totalsObj.total_invoiced || "0"),
        total_paid: String(totalsObj.total_paid || "0"),
        total_balance: String(totalsObj.total_balance || "0"),
        allocated_payments: String(totalsObj.allocated_payments || "0"),
        invoice_count: toNumber(totalsObj.invoice_count),
        payment_count: toNumber(totalsObj.payment_count),
      },
      term_summary: asArray<unknown>(financeObj.term_summary)
        .map((row) => asObject(row))
        .filter((row): row is Record<string, unknown> => Boolean(row))
        .map((row) => ({
          scope: String(row.scope || "UNSCOPED"),
          invoice_count: toNumber(row.invoice_count),
          payment_count: toNumber(row.payment_count),
          total_invoiced: String(row.total_invoiced || "0"),
          total_paid: String(row.total_paid || "0"),
          total_balance: String(row.total_balance || "0"),
          allocated_payments: String(row.allocated_payments || "0"),
        })),
      year_summary: asArray<unknown>(financeObj.year_summary)
        .map((row) => asObject(row))
        .filter((row): row is Record<string, unknown> => Boolean(row))
        .map((row) => ({
          scope: String(row.scope || "UNKNOWN"),
          invoice_count: toNumber(row.invoice_count),
          payment_count: toNumber(row.payment_count),
          total_invoiced: String(row.total_invoiced || "0"),
          total_paid: String(row.total_paid || "0"),
          total_balance: String(row.total_balance || "0"),
          allocated_payments: String(row.allocated_payments || "0"),
        })),
      invoices: asArray<unknown>(financeObj.invoices)
        .map((row) => asObject(row))
        .filter((row): row is Record<string, unknown> => Boolean(row))
        .map((row) => ({
          id: String(row.id || ""),
          invoice_no: row.invoice_no === null ? null : String(row.invoice_no || ""),
          invoice_type: String(row.invoice_type || ""),
          status: String(row.status || ""),
          term_code: String(row.term_code || "UNSCOPED"),
          year: String(row.year || "UNKNOWN"),
          total_amount: String(row.total_amount || "0"),
          paid_amount: String(row.paid_amount || "0"),
          balance_amount: String(row.balance_amount || "0"),
          created_at: row.created_at ? String(row.created_at) : null,
        })),
      payments: asArray<unknown>(financeObj.payments)
        .map((row) => asObject(row))
        .filter((row): row is Record<string, unknown> => Boolean(row))
        .map((row) => ({
          id: String(row.id || ""),
          receipt_no: row.receipt_no === null ? null : String(row.receipt_no || ""),
          provider: String(row.provider || ""),
          reference: row.reference === null ? null : String(row.reference || ""),
          amount: String(row.amount || "0"),
          allocated_amount: String(row.allocated_amount || "0"),
          received_at: row.received_at ? String(row.received_at) : null,
          allocations: asArray<unknown>(row.allocations)
            .map((item) => asObject(item))
            .filter((item): item is Record<string, unknown> => Boolean(item))
            .map((item) => ({
              invoice_id: String(item.invoice_id || ""),
              amount: String(item.amount || "0"),
              term_code: String(item.term_code || "UNSCOPED"),
              year: String(item.year || "UNKNOWN"),
            })),
        })),
    },
    exams: {
      totals: {
        record_count: toNumber(examTotalsObj.record_count),
        subject_count: toNumber(examTotalsObj.subject_count),
        term_count: toNumber(examTotalsObj.term_count),
      },
      subject_summary: asArray<unknown>(examsObj.subject_summary)
        .map((row) => asObject(row))
        .filter((row): row is Record<string, unknown> => Boolean(row))
        .map((row) => ({
          subject_id: row.subject_id ? String(row.subject_id) : null,
          subject_code: row.subject_code ? String(row.subject_code) : null,
          subject_name: row.subject_name ? String(row.subject_name) : null,
          exam_count: toNumber(row.exam_count),
          total_obtained: String(row.total_obtained || "0"),
          total_max: String(row.total_max || "0"),
          average_percentage: row.average_percentage
            ? String(row.average_percentage)
            : null,
        })),
      term_summary: asArray<unknown>(examsObj.term_summary)
        .map((row) => asObject(row))
        .filter((row): row is Record<string, unknown> => Boolean(row))
        .map((row) => ({
          term_code: String(row.term_code || "UNSCOPED"),
          term_name: row.term_name ? String(row.term_name) : null,
          exam_count: toNumber(row.exam_count),
          total_obtained: String(row.total_obtained || "0"),
          total_max: String(row.total_max || "0"),
          average_percentage: row.average_percentage
            ? String(row.average_percentage)
            : null,
        })),
      records: asArray<unknown>(examsObj.records)
        .map((row) => asObject(row))
        .filter((row): row is Record<string, unknown> => Boolean(row))
        .map((row) => ({
          id: String(row.id || ""),
          exam_name: String(row.exam_name || "Exam"),
          term_code: row.term_code ? String(row.term_code) : null,
          subject_code: row.subject_code ? String(row.subject_code) : null,
          subject_name: row.subject_name ? String(row.subject_name) : null,
          class_code: String(row.class_code || ""),
          marks_obtained: String(row.marks_obtained || "0"),
          max_marks: String(row.max_marks || "0"),
          percentage: row.percentage ? String(row.percentage) : null,
          grade: row.grade ? String(row.grade) : null,
          recorded_at: row.recorded_at ? String(row.recorded_at) : null,
          remarks: row.remarks ? String(row.remarks) : null,
        })),
    },
  };
}

export function StudentProfilePage({
  appTitle,
  nav,
  activeHref,
  enrollmentId,
  backHref,
}: StudentProfilePageProps) {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<StudentProfileResponse | null>(null);

  const load = useCallback(async () => {
    const safeEnrollmentId = String(enrollmentId || "").trim();
    if (
      !safeEnrollmentId ||
      safeEnrollmentId.toLowerCase() === "undefined" ||
      !UUID_PATTERN.test(safeEnrollmentId)
    ) {
      setProfile(null);
      setLoading(false);
      toast.error("Invalid student profile link. Please reopen from the student table.");
      return;
    }

    setLoading(true);
    try {
      const raw = await api.get<unknown>(
        `/tenants/students/${encodeURIComponent(safeEnrollmentId)}/profile`,
        { tenantRequired: true, noRedirect: true }
      );
      const normalized = normalizeProfileResponse(raw);
      if (!normalized) throw new Error("Invalid student profile response.");
      setProfile(normalized);
    } catch (err: any) {
      setProfile(null);
      toast.error(
        typeof err?.message === "string"
          ? err.message
          : "Unable to load student profile."
      );
    } finally {
      setLoading(false);
    }
  }, [enrollmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const payload = useMemo(
    () => profile?.enrollment.payload || {},
    [profile]
  );

  const admissionFields = useMemo(() => {
    if (!profile) return [];

    return [
      { label: "Full Name", value: profile.enrollment.student_name || "—" },
      {
        label: "Admission Number",
        value: profile.enrollment.admission_number || "—",
      },
      { label: "Class", value: profile.enrollment.class_code || "—" },
      { label: "Term", value: profile.enrollment.term_code || "—" },
      { label: "Status", value: profile.enrollment.status || "—" },
      {
        label: "Intake Date",
        value: payloadString(payload, ["intake_date"]) || "—",
      },
      {
        label: "Date of Birth",
        value: payloadString(payload, ["date_of_birth"]) || "—",
      },
      { label: "Gender", value: payloadString(payload, ["gender"]) || "—" },
      {
        label: "Guardian Name",
        value: payloadString(payload, ["guardian_name"]) || "—",
      },
      {
        label: "Guardian Phone",
        value: payloadString(payload, ["guardian_phone"]) || "—",
      },
      {
        label: "Guardian Email",
        value: payloadString(payload, ["guardian_email"]) || "—",
      },
      {
        label: "Medical Condition",
        value: payloadBoolean(payload, [
          "has_medical_conditions",
          "has_underlying_medical_conditions",
        ])
          ? "Yes"
          : "No",
      },
      {
        label: "Medical Details",
        value:
          payloadString(payload, [
            "medical_conditions_details",
            "underlying_medical_conditions",
            "medical_report",
          ]) || "—",
      },
      {
        label: "Medicine In School",
        value: payloadBoolean(payload, [
          "has_medication_in_school",
          "medication_left_in_school",
        ])
          ? "Yes"
          : "No",
      },
      {
        label: "Medication Details",
        value:
          payloadString(payload, [
            "medication_in_school_details",
            "medication_prescription_details",
          ]) || "—",
      },
    ];
  }, [payload, profile]);

  return (
    <AppShell title={appTitle} nav={nav} activeHref={activeHref}>
      <div className="space-y-5">
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-600 to-blue-500 p-5 text-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold">
                {loading ? "Student Profile" : profile?.enrollment.student_name || "Student Profile"}
              </h1>
              <p className="mt-0.5 text-sm text-blue-100">
                Admission details, fee position per term/year, and full exam subject report.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                asChild
                variant="outline"
                className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              >
                <Link href={backHref}>
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back
                </Link>
              </Button>
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
        </div>

        {!loading && !profile && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Student profile could not be loaded.
          </div>
        )}

        {profile && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">Admission No.</div>
                <div className="mt-1 font-mono text-sm font-semibold text-emerald-700">
                  {profile.enrollment.admission_number || "—"}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">Class</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {profile.enrollment.class_code || "—"}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">Status</div>
                <div className="mt-1">
                  <Badge variant="secondary" className="bg-blue-50 text-blue-700">
                    {profile.enrollment.status || "UNKNOWN"}
                  </Badge>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">Enrollment ID</div>
                <div className="mt-1 truncate font-mono text-xs text-slate-600">
                  {profile.enrollment.id}
                </div>
              </div>
            </div>

            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-6 py-4">
                <h2 className="text-sm font-semibold text-slate-900">Admission Details</h2>
              </div>
              <div className="grid gap-x-6 gap-y-4 px-6 py-4 sm:grid-cols-2 lg:grid-cols-3">
                {admissionFields.map((field) => (
                  <div key={field.label}>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      {field.label}
                    </div>
                    <div className="mt-1 break-words text-sm font-medium text-slate-900">
                      {field.value}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-slate-900">Finance Position</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Invoiced</div>
                  <div className="mt-1 text-lg font-bold text-slate-900">
                    {formatKes(profile.finance.totals.total_invoiced)}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Paid</div>
                  <div className="mt-1 text-lg font-bold text-emerald-700">
                    {formatKes(profile.finance.totals.total_paid)}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Balance</div>
                  <div className="mt-1 text-lg font-bold text-red-700">
                    {formatKes(profile.finance.totals.total_balance)}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Invoices / Payments</div>
                  <div className="mt-1 text-lg font-bold text-blue-700">
                    {profile.finance.totals.invoice_count} / {profile.finance.totals.payment_count}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-100 px-6 py-4">
                    <h3 className="text-sm font-semibold text-slate-900">Term Fee Summary</h3>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50">
                        <TableHead className="text-xs">Term</TableHead>
                        <TableHead className="text-xs">Invoiced</TableHead>
                        <TableHead className="text-xs">Paid</TableHead>
                        <TableHead className="text-xs">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {profile.finance.term_summary.map((row) => (
                        <TableRow key={row.scope}>
                          <TableCell className="font-mono text-xs text-slate-700">{row.scope}</TableCell>
                          <TableCell className="text-xs">{formatKes(row.total_invoiced)}</TableCell>
                          <TableCell className="text-xs text-emerald-700">{formatKes(row.total_paid)}</TableCell>
                          <TableCell className="text-xs text-red-700">{formatKes(row.total_balance)}</TableCell>
                        </TableRow>
                      ))}
                      {profile.finance.term_summary.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className="py-6 text-center text-xs text-slate-400">
                            No term-level finance records yet.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-100 px-6 py-4">
                    <h3 className="text-sm font-semibold text-slate-900">Year Fee Summary</h3>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50">
                        <TableHead className="text-xs">Year</TableHead>
                        <TableHead className="text-xs">Invoiced</TableHead>
                        <TableHead className="text-xs">Paid</TableHead>
                        <TableHead className="text-xs">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {profile.finance.year_summary.map((row) => (
                        <TableRow key={row.scope}>
                          <TableCell className="font-mono text-xs text-slate-700">{row.scope}</TableCell>
                          <TableCell className="text-xs">{formatKes(row.total_invoiced)}</TableCell>
                          <TableCell className="text-xs text-emerald-700">{formatKes(row.total_paid)}</TableCell>
                          <TableCell className="text-xs text-red-700">{formatKes(row.total_balance)}</TableCell>
                        </TableRow>
                      ))}
                      {profile.finance.year_summary.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className="py-6 text-center text-xs text-slate-400">
                            No year-level finance records yet.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-slate-900">Exam Performance</h2>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Exam Records</div>
                  <div className="mt-1 text-lg font-bold text-slate-900">
                    {profile.exams.totals.record_count}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Subjects</div>
                  <div className="mt-1 text-lg font-bold text-blue-700">
                    {profile.exams.totals.subject_count}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Terms</div>
                  <div className="mt-1 text-lg font-bold text-emerald-700">
                    {profile.exams.totals.term_count}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-6 py-4">
                  <h3 className="text-sm font-semibold text-slate-900">Subject Summary</h3>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs">Subject</TableHead>
                      <TableHead className="text-xs">Exams</TableHead>
                      <TableHead className="text-xs">Total</TableHead>
                      <TableHead className="text-xs">Average %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {profile.exams.subject_summary.map((row) => (
                      <TableRow key={`${row.subject_id || "subject"}-${row.subject_code || row.subject_name}`}>
                        <TableCell className="text-xs">
                          <div className="font-medium text-slate-900">
                            {row.subject_name || row.subject_code || "Unspecified Subject"}
                          </div>
                          {row.subject_code && (
                            <div className="font-mono text-[11px] text-slate-500">{row.subject_code}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{row.exam_count}</TableCell>
                        <TableCell className="text-xs">
                          {row.total_obtained} / {row.total_max}
                        </TableCell>
                        <TableCell className="text-xs font-semibold text-blue-700">
                          {row.average_percentage ? `${row.average_percentage}%` : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                    {profile.exams.subject_summary.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="py-6 text-center text-xs text-slate-400">
                          No subject marks recorded yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-6 py-4">
                  <h3 className="text-sm font-semibold text-slate-900">Exam Record Log</h3>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs">Exam</TableHead>
                      <TableHead className="text-xs">Term</TableHead>
                      <TableHead className="text-xs">Subject</TableHead>
                      <TableHead className="text-xs">Marks</TableHead>
                      <TableHead className="text-xs">Grade</TableHead>
                      <TableHead className="text-xs">Recorded</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {profile.exams.records.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="text-xs font-medium">{row.exam_name}</TableCell>
                        <TableCell className="font-mono text-xs">{row.term_code || "—"}</TableCell>
                        <TableCell className="text-xs">{row.subject_name || row.subject_code || "—"}</TableCell>
                        <TableCell className="text-xs">
                          {row.marks_obtained} / {row.max_marks}
                          {row.percentage && (
                            <span className="ml-1 text-blue-700">({row.percentage}%)</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{row.grade || "—"}</TableCell>
                        <TableCell className="text-xs text-slate-600">
                          {formatDate(row.recorded_at)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {profile.exams.records.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="py-6 text-center text-xs text-slate-400">
                          No exam records for this student yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </section>
          </>
        )}

        {loading && (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
            <UserRound className="mx-auto mb-2 h-5 w-5 text-slate-400" />
            Loading student profile...
          </div>
        )}
      </div>
    </AppShell>
  );
}
