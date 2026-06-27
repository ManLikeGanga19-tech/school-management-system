"use client";

/**
 * RecordPaymentByStudent
 *
 * The secretary's daily payment-recording workflow. One panel:
 *   pick a student → see their breakdown (pending balance adjustment,
 *   current term, prior arrears, per-invoice list) → type amount + provider
 *   → one click records. Allocation is automatic FIFO on the backend; surplus
 *   becomes a credit on the student's next invoice.
 *
 * Used by both the secretary and director finance pages under the
 * "Record Payment" section.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  HandCoins,
  Printer,
  ReceiptText,
  RefreshCw,
  Wallet,
} from "lucide-react";

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
import { toast } from "@/components/ui/sonner";
import {
  EnrollmentCombobox,
  type EnrollmentOption,
} from "@/components/ui/enrollment-combobox";
import { api, apiFetchRaw } from "@/lib/api";

// ── Types ────────────────────────────────────────────────────────────────────

type SummaryInvoice = {
  invoice_id: string;
  invoice_no: string | null;
  invoice_type: string;
  status: string;
  term_number: number | null;
  academic_year: number | null;
  total_amount: string;
  paid_amount: string;
  balance_amount: string;
};

type PaymentSummary = {
  student_id: string;
  student_name: string;
  admission_no: string | null;
  class_code: string | null;
  pending_balance_net: string;
  pending_balance_debit: string;
  pending_balance_credit: string;
  current_term_total: string;
  current_term_paid: string;
  current_term_balance: string;
  prior_terms_balance: string;
  total_outstanding: string;
  invoices: SummaryInvoice[];
};

type RecordResult = {
  payment_id: string;
  receipt_no: string | null;
  amount: string;
  allocated_total: string;
  surplus_credit: string;
  credit_balance_id: string | null;
  allocations: {
    invoice_id: string;
    invoice_no: string | null;
    term_number: number | null;
    academic_year: number | null;
    amount: string;
  }[];
};

type EnrollmentLite = {
  id: string;
  student_id: string | null;
  payload?: Record<string, unknown>;
  admission_number?: string | null;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtKes(value: string | number): string {
  const n = parseFloat(String(value));
  if (Number.isNaN(n)) return "KES 0.00";
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  return `${sign}KES ${abs.toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function studentNameFromPayload(p: Record<string, unknown> | undefined): string {
  if (!p) return "Student";
  const candidates = [
    p.student_name,
    p.studentName,
    p.full_name,
    p.fullName,
    p.name,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "Student";
}

const PROVIDERS = [
  { code: "MPESA", label: "M-PESA" },
  { code: "CASH", label: "Cash" },
  { code: "BANK", label: "Bank transfer" },
  { code: "CHEQUE", label: "Cheque" },
];

// ── Component ────────────────────────────────────────────────────────────────

export function RecordPaymentByStudent() {
  const searchParams = useSearchParams();
  const initialStudentId = searchParams?.get("student_id") || "";

  // Student picker options come from /enrollments/. We surface one row per
  // *student_id* (a student may have multiple enrollments — we use the
  // most-recent payload for display).
  const [enrollmentsLoading, setEnrollmentsLoading] = useState(true);
  const [options, setOptions] = useState<EnrollmentOption[]>([]);
  const [studentLookup, setStudentLookup] = useState<Record<string, string>>({});
  const [selectedStudentId, setSelectedStudentId] = useState(initialStudentId);

  // Summary load
  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // Form
  const [amount, setAmount] = useState("");
  const [provider, setProvider] = useState("MPESA");
  const [reference, setReference] = useState("");
  const [recording, setRecording] = useState(false);
  const [lastResult, setLastResult] = useState<RecordResult | null>(null);

  const loadOptions = useCallback(async () => {
    setEnrollmentsLoading(true);
    try {
      const raw = await api.get<unknown>("/enrollments/", {
        tenantRequired: true,
        noRedirect: true,
      });
      const rows = Array.isArray(raw) ? (raw as EnrollmentLite[]) : [];
      const bySid = new Map<string, EnrollmentLite>();
      for (const row of rows) {
        const sid = row.student_id;
        if (!sid) continue; // Need a SIS student_id to record by student.
        // Keep the latest enrollment for display (the API returns newest first).
        if (!bySid.has(sid)) bySid.set(sid, row);
      }
      const opts: EnrollmentOption[] = [];
      const lookup: Record<string, string> = {};
      for (const [sid, row] of bySid) {
        const name = studentNameFromPayload(row.payload);
        const adm =
          row.admission_number ||
          (row.payload?.["admission_number"] as string | undefined) ||
          "";
        const classCode =
          (row.payload?.["class_code"] as string | undefined) ||
          (row.payload?.["admission_class"] as string | undefined) ||
          "";
        opts.push({
          id: sid,
          label: name,
          sublabel: [adm, classCode].filter(Boolean).join(" · ") || undefined,
        });
        lookup[sid] = name;
      }
      opts.sort((a, b) => a.label.localeCompare(b.label));
      setOptions(opts);
      setStudentLookup(lookup);
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message;
      toast.error(msg || "Failed to load students.");
    } finally {
      setEnrollmentsLoading(false);
    }
  }, []);

  const loadSummary = useCallback(async (sid: string) => {
    if (!sid) {
      setSummary(null);
      return;
    }
    setSummaryLoading(true);
    try {
      const data = await api.get<PaymentSummary>(
        `/finance/students/${encodeURIComponent(sid)}/payment-summary`,
        { tenantRequired: true }
      );
      setSummary(data);
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (err as { message?: string })?.message;
      toast.error(detail || "Failed to load student summary.");
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    if (selectedStudentId) {
      void loadSummary(selectedStudentId);
      // Reset form on student change.
      setAmount("");
      setReference("");
      setLastResult(null);
    } else {
      setSummary(null);
    }
  }, [selectedStudentId, loadSummary]);

  async function handleRecord() {
    if (!selectedStudentId) {
      toast.error("Pick a student first.");
      return;
    }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      toast.error("Enter an amount greater than zero.");
      return;
    }
    setRecording(true);
    try {
      const result = await api.post<RecordResult>(
        `/finance/students/${encodeURIComponent(selectedStudentId)}/payments`,
        {
          amount: amt,
          provider,
          reference: reference.trim() || null,
        },
        { tenantRequired: true }
      );
      setLastResult(result);
      const surplus = parseFloat(result.surplus_credit || "0");
      if (surplus > 0) {
        toast.success(
          `Recorded ${fmtKes(result.amount)}. ${fmtKes(
            result.allocated_total
          )} allocated, ${fmtKes(surplus)} credited forward.`
        );
      } else {
        toast.success(`Recorded ${fmtKes(result.amount)}.`);
      }
      setAmount("");
      setReference("");
      await loadSummary(selectedStudentId);
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail || (err as { message?: string })?.message;
      toast.error(detail || "Failed to record payment.");
    } finally {
      setRecording(false);
    }
  }

  async function openReceiptPdf(paymentId: string) {
    try {
      const res = await apiFetchRaw(
        `/finance/documents/payments/${encodeURIComponent(paymentId)}/pdf`,
        { method: "GET", tenantRequired: true }
      );
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const tab = window.open(url, "_blank");
      if (!tab) toast.error("Pop-up blocked — allow pop-ups to print.");
    } catch {
      toast.error("Failed to open receipt PDF.");
    }
  }

  const pendingNet = useMemo(
    () => parseFloat(summary?.pending_balance_net || "0"),
    [summary]
  );

  return (
    <div className="space-y-4">
      {/* ── Student picker ────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Record a payment
            </h3>
            <p className="text-xs text-slate-500">
              Pick a student to see what they owe right now, then enter the
              amount they paid. Allocation across invoices is automatic
              (oldest term first), any surplus becomes a credit on the next
              invoice.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => void loadOptions()}
            disabled={enrollmentsLoading}
          >
            <RefreshCw className="h-3 w-3" />
            Reload students
          </Button>
        </div>
        <div className="max-w-xl">
          <Label className="text-xs">Student</Label>
          <EnrollmentCombobox
            options={options}
            value={selectedStudentId}
            onChange={setSelectedStudentId}
            placeholder={
              enrollmentsLoading ? "Loading students…" : "Search by name or admission no…"
            }
            disabled={enrollmentsLoading}
          />
        </div>
      </div>

      {/* ── Summary + record form ─────────────────────────────────────── */}
      {selectedStudentId && (
        <div className="grid gap-4 lg:grid-cols-5">
          {/* Left: breakdown + invoice list */}
          <div className="space-y-4 lg:col-span-3">
            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              {summaryLoading || !summary ? (
                <p className="py-6 text-center text-sm text-slate-400">
                  Loading balance summary…
                </p>
              ) : (
                <>
                  <div className="mb-3 flex items-baseline justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">
                        {summary.student_name}
                      </h3>
                      <p className="text-xs text-slate-500">
                        {[
                          summary.admission_no,
                          summary.class_code,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase tracking-wide text-slate-400">
                        Total owed now
                      </p>
                      <p
                        className={`text-lg font-bold ${
                          parseFloat(summary.total_outstanding) > 0
                            ? "text-red-600"
                            : parseFloat(summary.total_outstanding) < 0
                              ? "text-emerald-700"
                              : "text-slate-700"
                        }`}
                      >
                        {fmtKes(summary.total_outstanding)}
                      </p>
                    </div>
                  </div>

                  {/* Breakdown chips */}
                  <div className="grid grid-cols-3 gap-2">
                    <div
                      className={`rounded-xl border px-3 py-2 text-xs ${
                        pendingNet > 0
                          ? "border-amber-200 bg-amber-50"
                          : pendingNet < 0
                            ? "border-emerald-200 bg-emerald-50"
                            : "border-slate-200 bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500">
                        {pendingNet < 0 ? (
                          <ArrowDownRight className="h-3 w-3" />
                        ) : (
                          <ArrowUpRight className="h-3 w-3" />
                        )}
                        Brought-forward balance
                      </div>
                      <p
                        className={`mt-0.5 text-sm font-semibold ${
                          pendingNet > 0
                            ? "text-amber-800"
                            : pendingNet < 0
                              ? "text-emerald-800"
                              : "text-slate-700"
                        }`}
                      >
                        {fmtKes(summary.pending_balance_net)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500">
                        <Wallet className="h-3 w-3" />
                        Current term
                      </div>
                      <p className="mt-0.5 text-sm font-semibold text-slate-800">
                        {fmtKes(summary.current_term_balance)}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        of {fmtKes(summary.current_term_total)} · paid{" "}
                        {fmtKes(summary.current_term_paid)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500">
                        <AlertTriangle className="h-3 w-3" />
                        Prior terms
                      </div>
                      <p className="mt-0.5 text-sm font-semibold text-slate-800">
                        {fmtKes(summary.prior_terms_balance)}
                      </p>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Outstanding invoices */}
            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <h3 className="mb-2 text-sm font-semibold text-slate-900">
                Outstanding invoices (oldest first)
              </h3>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs">Term</TableHead>
                      <TableHead className="text-xs">Invoice</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs text-right">Total</TableHead>
                      <TableHead className="text-xs text-right">Paid</TableHead>
                      <TableHead className="text-xs text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary?.invoices.length ? (
                      summary.invoices.map((inv) => (
                        <TableRow key={inv.invoice_id} className="hover:bg-slate-50">
                          <TableCell className="text-xs text-slate-700">
                            Term {inv.term_number ?? "—"}{" "}
                            {inv.academic_year ? inv.academic_year : ""}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-blue-700">
                            {inv.invoice_no || inv.invoice_id.slice(0, 8)}
                          </TableCell>
                          <TableCell>
                            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                              {inv.status}
                            </span>
                          </TableCell>
                          <TableCell className="text-right text-xs text-slate-700">
                            {fmtKes(inv.total_amount)}
                          </TableCell>
                          <TableCell className="text-right text-xs text-emerald-700">
                            {fmtKes(inv.paid_amount)}
                          </TableCell>
                          <TableCell className="text-right text-xs font-semibold text-red-600">
                            {fmtKes(inv.balance_amount)}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="py-6 text-center text-xs text-slate-400"
                        >
                          {summary
                            ? "No outstanding invoices. Generate this term's invoice first if needed."
                            : "—"}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>

          {/* Right: record form */}
          <div className="space-y-4 lg:col-span-2">
            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                <HandCoins className="h-4 w-4 text-emerald-600" />
                Record payment
              </h3>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Amount received (KES)</Label>
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <Label className="text-xs">Provider</Label>
                  <Select value={provider} onValueChange={setProvider}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROVIDERS.map((p) => (
                        <SelectItem key={p.code} value={p.code}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Reference (optional)</Label>
                  <Input
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="e.g. M-PESA transaction id"
                  />
                </div>
                <Button
                  onClick={() => void handleRecord()}
                  disabled={recording || !summary}
                  className="w-full"
                >
                  {recording ? "Recording…" : "Record Payment"}
                </Button>
                <p className="text-[11px] text-slate-400">
                  Allocation is automatic — oldest term first, any surplus
                  becomes a credit on this student's next invoice.
                </p>
              </div>
            </div>

            {/* Last receipt panel */}
            {lastResult && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-900">
                  <ReceiptText className="h-4 w-4" />
                  Receipt {lastResult.receipt_no || lastResult.payment_id.slice(0, 8)}
                </h3>
                <p className="text-xs text-emerald-800">
                  Recorded {fmtKes(lastResult.amount)} ·{" "}
                  {fmtKes(lastResult.allocated_total)} allocated
                  {parseFloat(lastResult.surplus_credit) > 0 && (
                    <>
                      , {fmtKes(lastResult.surplus_credit)} credited forward
                    </>
                  )}
                  .
                </p>
                <ul className="mt-2 space-y-0.5 text-[11px] text-emerald-900">
                  {lastResult.allocations.map((a) => (
                    <li key={a.invoice_id}>
                      • Term {a.term_number ?? "—"}{" "}
                      {a.academic_year ?? ""} ·{" "}
                      <span className="font-mono">
                        {a.invoice_no || a.invoice_id.slice(0, 8)}
                      </span>
                      : {fmtKes(a.amount)}
                    </li>
                  ))}
                </ul>
                <div className="mt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 text-xs"
                    onClick={() => void openReceiptPdf(lastResult.payment_id)}
                  >
                    <Printer className="h-3 w-3" />
                    Print receipt
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
