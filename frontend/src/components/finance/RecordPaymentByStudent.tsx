"use client";

/**
 * RecordPaymentPanel (file kept as RecordPaymentByStudent for import stability)
 *
 * The secretary's payment-recording surface. One panel:
 *   pick a STUDENT or a PARENT → see the breakdown → type amount + provider
 *   → one click records.
 *
 * Single-student mode (today's flow):
 *   - calls /finance/students/{id}/payment-summary + /finance/students/{id}/payments
 *   - one Payment row, FIFO across THAT student's invoices.
 *
 * Family mode (when a parent is picked):
 *   - calls /finance/parents/{id}/payment-summary + /finance/parents/{id}/payments
 *   - one Payment row covering one or more linked children, allocations span
 *     siblings, FIFO across the WHOLE family (oldest term first across all
 *     children).
 *   - auto mode by default; an "Allocate per child manually" toggle reveals
 *     per-child amount inputs (manual mode).
 *   - "Credit forward to" dropdown appears the moment the typed amount
 *     exceeds the family total, AND the payment spans multiple children.
 *     Required to submit when shown.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  HandCoins,
  Printer,
  ReceiptText,
  RefreshCw,
  User,
  Users,
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
import { api, apiFetchRaw } from "@/lib/api";
import { currentTermIdentity, normalizeTerms } from "@/lib/school-setup/terms";
import {
  StudentOrParentCombobox,
  type PickedTarget,
  type StudentOrParentOption,
} from "@/components/finance/StudentOrParentCombobox";

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

type StudentSummary = {
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

type ParentSummary = {
  parent_id: string;
  parent_name: string;
  children: StudentSummary[];
  family_total_outstanding: string;
};

type FamilyStudentBreakdown = {
  student_id: string;
  student_name: string;
  admission_no: string | null;
  class_code: string | null;
  subtotal: string;
  allocations: {
    invoice_id: string;
    invoice_no: string | null;
    student_id: string;
    student_name: string;
    term_number: number | null;
    academic_year: number | null;
    amount: string;
  }[];
};

type StudentRecordResult = {
  payment_id: string;
  receipt_no: string | null;
  amount: string;
  allocated_total: string;
  surplus_credit: string;
  cf_debits_settled?: string | null;
  credit_consumed?: string | null;
  credit_balance_id: string | null;
  allocations: {
    invoice_id: string;
    invoice_no: string | null;
    term_number: number | null;
    academic_year: number | null;
    amount: string;
  }[];
  waterfall_steps?: WaterfallStep[] | null;
};

// Phase N — waterfall preview shape.
type WaterfallStep = {
  type: "credit_consumed" | "carry_forward_debit" | "invoice" | "overpayment_credit";
  amount: string;
  cf_id?: string | null;
  term_label?: string | null;
  category?: string | null;
  original_amount?: string | null;
  already_settled?: string | null;
  fully_settles?: boolean | null;
  invoice_id?: string | null;
  invoice_no?: string | null;
  invoice_type?: string | null;
  invoice_balance_before?: string | null;
  fully_pays?: boolean | null;
  academic_year?: number | null;
  term_number?: number | null;
  description?: string | null;
  note?: string | null;
};

type WaterfallPreview = {
  amount: string;
  steps: WaterfallStep[];
  summary: {
    cf_debits_settled: string;
    invoices_paid: string;
    surplus_credit: string;
    credit_consumed?: string | null;
  };
  cf_debits_remaining_after: string;
  invoices_remaining_after: string;
  credit_available: string;
};

type FamilyRecordResult = {
  payment_id: string;
  receipt_no: string | null;
  amount: string;
  allocated_total: string;
  surplus_credit: string;
  credit_balance_id: string | null;
  credit_to_student_id: string | null;
  credit_to_student_name: string | null;
  students: FamilyStudentBreakdown[];
};

type EnrollmentLite = {
  id: string;
  student_id: string | null;
  payload?: Record<string, unknown>;
  admission_number?: string | null;
};

type ParentLite = {
  id: string;
  name: string;
  phone: string;
  child_count: number;
  outstanding_total?: string | number;
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
  for (const key of ["student_name", "studentName", "full_name", "fullName", "name"]) {
    const v = p[key];
    if (typeof v === "string" && v.trim()) return v.trim();
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
  const initialParentId = searchParams?.get("parent_id") || "";
  const initialPicked: PickedTarget | null = initialParentId
    ? { kind: "parent", id: initialParentId }
    : initialStudentId
      ? { kind: "student", id: initialStudentId }
      : null;

  // Picker options come from /enrollments/ AND /parents/.
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [options, setOptions] = useState<StudentOrParentOption[]>([]);
  const [picked, setPicked] = useState<PickedTarget | null>(initialPicked);

  // Summary load
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [studentSummary, setStudentSummary] = useState<StudentSummary | null>(null);
  const [parentSummary, setParentSummary] = useState<ParentSummary | null>(null);

  // Form
  const [amount, setAmount] = useState("");
  const [provider, setProvider] = useState("MPESA");
  const [reference, setReference] = useState("");
  const [recording, setRecording] = useState(false);
  const [lastStudentResult, setLastStudentResult] = useState<StudentRecordResult | null>(null);
  const [lastFamilyResult, setLastFamilyResult] = useState<FamilyRecordResult | null>(null);

  // Family-mode extras
  const [familyMode, setFamilyMode] = useState<"auto" | "manual">("auto");
  const [perStudent, setPerStudent] = useState<Record<string, string>>({});

  // Phase N — waterfall preview (student mode only).
  const [preview, setPreview] = useState<WaterfallPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [applyAvailableCredit, setApplyAvailableCredit] = useState(false);

  // Tenant's current term identity (term_number + academic_year). Used to ask
  // the per-student payment summary endpoint for the right prior-vs-current
  // split. Loaded once; null when terms aren't configured / not tagged yet,
  // in which case the backend falls back to "newest invoice is current".
  const [currentTerm, setCurrentTerm] = useState<
    { term_number: number; academic_year: number } | null
  >(null);
  const [creditToStudentId, setCreditToStudentId] = useState<string>("");

  const loadOptions = useCallback(async () => {
    setOptionsLoading(true);
    try {
      const [enrollmentsRaw, parentsRaw] = await Promise.all([
        api.get<unknown>("/enrollments/", { tenantRequired: true, noRedirect: true }),
        api.get<unknown>("/parents", { tenantRequired: true, noRedirect: true })
          .catch(() => null),
      ]);

      const opts: StudentOrParentOption[] = [];

      const enrollmentRows = Array.isArray(enrollmentsRaw)
        ? (enrollmentsRaw as EnrollmentLite[])
        : [];
      const bySid = new Map<string, EnrollmentLite>();
      for (const row of enrollmentRows) {
        const sid = row.student_id;
        if (!sid) continue;
        if (!bySid.has(sid)) bySid.set(sid, row);
      }
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
          kind: "student",
          id: sid,
          label: name,
          sublabel: [adm, classCode].filter(Boolean).join(" · ") || undefined,
        });
      }

      // Parents: only those with linked children (child_count > 0) — a parent
      // with no children in this tenant can't have a payment recorded.
      const parentRows = Array.isArray(parentsRaw) ? (parentsRaw as ParentLite[]) : [];
      for (const p of parentRows) {
        if ((p.child_count ?? 0) <= 0) continue;
        opts.push({
          kind: "parent",
          id: p.id,
          label: p.name || "Guardian",
          sublabel: [
            `${p.child_count} ${p.child_count === 1 ? "child" : "children"}`,
            p.phone,
          ].filter(Boolean).join(" · ") || undefined,
        });
      }

      opts.sort((a, b) => a.label.localeCompare(b.label));
      setOptions(opts);
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message;
      toast.error(msg || "Failed to load students and parents.");
    } finally {
      setOptionsLoading(false);
    }
  }, []);

  const loadSummary = useCallback(async (target: PickedTarget) => {
    setSummaryLoading(true);
    try {
      if (target.kind === "student") {
        // Anchor the prior-vs-current split on the tenant's current term
        // when it's been tagged with the structured identity (Phase B).
        // Otherwise the backend picks 'newest invoice is current' on its own.
        const params = new URLSearchParams();
        if (currentTerm) {
          params.set("current_term_number", String(currentTerm.term_number));
          params.set("current_academic_year", String(currentTerm.academic_year));
        }
        const qs = params.toString() ? `?${params.toString()}` : "";
        const data = await api.get<StudentSummary>(
          `/finance/students/${encodeURIComponent(target.id)}/payment-summary${qs}`,
          { tenantRequired: true }
        );
        setStudentSummary(data);
        setParentSummary(null);
      } else {
        const data = await api.get<ParentSummary>(
          `/finance/parents/${encodeURIComponent(target.id)}/payment-summary`,
          { tenantRequired: true }
        );
        setParentSummary(data);
        setStudentSummary(null);
      }
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (err as { message?: string })?.message;
      toast.error(detail || "Failed to load summary.");
      setStudentSummary(null);
      setParentSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }, [currentTerm]);

  useEffect(() => {
    void loadOptions();
    // One-time fetch of tenant terms → resolve current-term identity so the
    // per-student summary call asks for the right split. Best-effort: if the
    // endpoint is unreachable or no current term is tagged, currentTerm stays
    // null and the backend default kicks in.
    (async () => {
      try {
        const raw = await api.get<unknown>("/tenants/terms", {
          tenantRequired: true,
          noRedirect: true,
        });
        setCurrentTerm(currentTermIdentity(normalizeTerms(raw)));
      } catch {
        // Silent fallback.
      }
    })();
  }, [loadOptions]);

  useEffect(() => {
    if (picked) {
      void loadSummary(picked);
      setAmount("");
      setReference("");
      setLastStudentResult(null);
      setLastFamilyResult(null);
      setPerStudent({});
      setCreditToStudentId("");
      setFamilyMode("auto");
    } else {
      setStudentSummary(null);
      setParentSummary(null);
    }
  }, [picked, loadSummary]);

  // ── Family helpers ────────────────────────────────────────────────────────
  const familyChildren = parentSummary?.children ?? [];
  const familyTotal = useMemo(
    () => parseFloat(parentSummary?.family_total_outstanding ?? "0"),
    [parentSummary]
  );
  const typedAmount = useMemo(() => {
    const n = parseFloat(amount);
    return Number.isNaN(n) ? 0 : n;
  }, [amount]);
  const manualSum = useMemo(() => {
    let total = 0;
    for (const v of Object.values(perStudent)) {
      const n = parseFloat(v);
      if (!Number.isNaN(n)) total += n;
    }
    return total;
  }, [perStudent]);

  // Surplus computation for the credit-target dropdown visibility.
  const wouldHaveSurplus = useMemo(() => {
    if (!picked) return false;
    if (picked.kind === "student") {
      const total = parseFloat(studentSummary?.total_outstanding ?? "0");
      return typedAmount > total && total > 0;
    }
    // Family.
    if (familyMode === "auto") {
      return typedAmount > familyTotal && familyTotal > 0;
    }
    return typedAmount > manualSum && manualSum > 0;
  }, [picked, studentSummary, familyMode, typedAmount, familyTotal, manualSum]);

  const requiresCreditTarget =
    picked?.kind === "parent" && wouldHaveSurplus && familyChildren.length > 1;

  // ── Waterfall preview (student mode only) ──────────────────────────────
  // Debounced fetch: whenever amount / apply_available_credit / picked
  // change, ask the server for the plan. Same engine as commit — WYSIWYG.
  useEffect(() => {
    if (!picked || picked.kind !== "student") {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    if (typedAmount <= 0) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    const t = window.setTimeout(async () => {
      try {
        const plan = await api.post<WaterfallPreview>(
          `/finance/students/${encodeURIComponent(picked.id)}/payments/preview`,
          { amount: typedAmount, apply_available_credit: applyAvailableCredit },
          { tenantRequired: true },
        );
        if (!cancelled) setPreview(plan);
      } catch (err) {
        if (!cancelled) {
          const detail =
            (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
            (err as { message?: string })?.message;
          setPreviewError(detail || "Could not compute the payment breakdown.");
          setPreview(null);
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [picked, typedAmount, applyAvailableCredit]);

  // ── Record ────────────────────────────────────────────────────────────────
  async function recordStudent() {
    if (!picked || picked.kind !== "student") return;
    if (typedAmount <= 0) {
      toast.error("Enter an amount greater than zero.");
      return;
    }
    setRecording(true);
    try {
      const result = await api.post<StudentRecordResult>(
        `/finance/students/${encodeURIComponent(picked.id)}/payments`,
        {
          amount: typedAmount,
          provider,
          reference: reference.trim() || null,
          apply_available_credit: applyAvailableCredit,
        },
        { tenantRequired: true }
      );
      setLastStudentResult(result);
      setLastFamilyResult(null);
      const surplus = parseFloat(result.surplus_credit || "0");
      const cfSettled = parseFloat(result.cf_debits_settled || "0");
      const parts: string[] = [];
      if (cfSettled > 0) parts.push(`${fmtKes(cfSettled)} cleared prior balance`);
      if (parseFloat(result.allocated_total) > 0)
        parts.push(`${fmtKes(result.allocated_total)} paid to invoices`);
      if (surplus > 0) parts.push(`${fmtKes(surplus)} credited forward`);
      toast.success(
        `Recorded ${fmtKes(result.amount)}. ` +
          (parts.length ? parts.join(" · ") : ""),
      );
      setAmount("");
      setReference("");
      setApplyAvailableCredit(false);
      setPreview(null);
      await loadSummary(picked);
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (err as { message?: string })?.message;
      toast.error(detail || "Failed to record payment.");
    } finally {
      setRecording(false);
    }
  }

  async function recordFamily() {
    if (!picked || picked.kind !== "parent") return;
    if (typedAmount <= 0) {
      toast.error("Enter an amount greater than zero.");
      return;
    }
    if (requiresCreditTarget && !creditToStudentId) {
      toast.error("Pick which child should keep the surplus credit.");
      return;
    }

    const body: Record<string, unknown> = {
      amount: typedAmount,
      provider,
      reference: reference.trim() || null,
      mode: familyMode,
    };
    if (familyMode === "manual") {
      const entries: { student_id: string; amount: number }[] = [];
      for (const child of familyChildren) {
        const v = perStudent[child.student_id];
        const n = v ? parseFloat(v) : 0;
        if (n > 0) entries.push({ student_id: child.student_id, amount: n });
      }
      if (entries.length === 0) {
        toast.error("Enter at least one per-child amount.");
        return;
      }
      body.per_student_allocations = entries;
    }
    if (wouldHaveSurplus && creditToStudentId) {
      body.credit_to_student_id = creditToStudentId;
    }

    setRecording(true);
    try {
      const result = await api.post<FamilyRecordResult>(
        `/finance/parents/${encodeURIComponent(picked.id)}/payments`,
        body,
        { tenantRequired: true }
      );
      setLastFamilyResult(result);
      setLastStudentResult(null);
      const surplus = parseFloat(result.surplus_credit || "0");
      toast.success(
        surplus > 0
          ? `Recorded ${fmtKes(result.amount)}. ${fmtKes(result.allocated_total)} allocated to ${result.students.length} ${result.students.length === 1 ? "child" : "children"}, ${fmtKes(surplus)} credited forward to ${result.credit_to_student_name || "next term"}.`
          : `Recorded ${fmtKes(result.amount)} across ${result.students.length} ${result.students.length === 1 ? "child" : "children"}.`
      );
      setAmount("");
      setReference("");
      setPerStudent({});
      setCreditToStudentId("");
      await loadSummary(picked);
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (err as { message?: string })?.message;
      toast.error(detail || "Failed to record family payment.");
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

  // ── Render bits ───────────────────────────────────────────────────────────
  function renderStudentBreakdown(s: StudentSummary, compact = false) {
    const pendingNet = parseFloat(s.pending_balance_net || "0");
    return (
      <div className={compact ? "rounded-xl border border-slate-100 bg-white p-4" : "rounded-2xl border border-slate-100 bg-white p-5 shadow-sm"}>
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <div>
            <h3 className={compact ? "text-sm font-semibold text-slate-900" : "text-sm font-semibold text-slate-900"}>
              {s.student_name}
            </h3>
            <p className="text-xs text-slate-500">
              {[s.admission_no, s.class_code].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">Total owed</p>
            <p
              className={`text-base font-bold ${
                parseFloat(s.total_outstanding) > 0
                  ? "text-red-600"
                  : parseFloat(s.total_outstanding) < 0
                    ? "text-emerald-700"
                    : "text-slate-700"
              }`}
            >
              {fmtKes(s.total_outstanding)}
            </p>
          </div>
        </div>
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
              {pendingNet < 0 ? <ArrowDownRight className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
              Brought-forward
            </div>
            <p className={`mt-0.5 text-sm font-semibold ${pendingNet > 0 ? "text-amber-800" : pendingNet < 0 ? "text-emerald-800" : "text-slate-700"}`}>
              {fmtKes(s.pending_balance_net)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500">
              <Wallet className="h-3 w-3" /> Current term
            </div>
            <p className="mt-0.5 text-sm font-semibold text-slate-800">{fmtKes(s.current_term_balance)}</p>
            <p className="text-[11px] text-slate-500">
              of {fmtKes(s.current_term_total)} · paid {fmtKes(s.current_term_paid)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500">
              <AlertTriangle className="h-3 w-3" /> Prior terms
            </div>
            <p className="mt-0.5 text-sm font-semibold text-slate-800">{fmtKes(s.prior_terms_balance)}</p>
          </div>
        </div>

        {s.invoices.length > 0 && (
          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-100">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="text-[11px]">Term</TableHead>
                  <TableHead className="text-[11px]">Invoice</TableHead>
                  <TableHead className="text-[11px]">Status</TableHead>
                  <TableHead className="text-[11px] text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.invoices.map((inv) => (
                  <TableRow key={inv.invoice_id}>
                    <TableCell className="text-xs text-slate-700">
                      Term {inv.term_number ?? "—"} {inv.academic_year ?? ""}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-blue-700">
                      {inv.invoice_no || inv.invoice_id.slice(0, 8)}
                    </TableCell>
                    <TableCell>
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                        {inv.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-xs font-semibold text-red-600">
                      {fmtKes(inv.balance_amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Picker ────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Record a payment</h3>
            <p className="text-xs text-slate-500">
              Pick a student to record a single-child payment, or a parent to
              record one payment that covers all their children at once.
              Allocation is automatic (oldest term first); surplus becomes a
              credit on the chosen student.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => void loadOptions()}
            disabled={optionsLoading}
          >
            <RefreshCw className="h-3 w-3" />
            Reload
          </Button>
        </div>
        <div className="max-w-xl">
          <Label className="text-xs">Student or Parent</Label>
          <StudentOrParentCombobox
            options={options}
            value={picked}
            onChange={setPicked}
            placeholder={optionsLoading ? "Loading…" : "Search by name, admission no, or phone…"}
            disabled={optionsLoading}
          />
        </div>
      </div>

      {/* ── Single-student panel ─────────────────────────────────────── */}
      {picked?.kind === "student" && (
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="space-y-4 lg:col-span-3">
            {summaryLoading || !studentSummary ? (
              <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                <p className="py-6 text-center text-sm text-slate-400">Loading…</p>
              </div>
            ) : (
              renderStudentBreakdown(studentSummary)
            )}
          </div>
          <div className="space-y-4 lg:col-span-2">
            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                <HandCoins className="h-4 w-4 text-emerald-600" /> Record payment
              </h3>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Amount received (KES)</Label>
                  <Input
                    type="number" min="0.01" step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                {/* Phase N2 — Apply-available-credit toggle. Visible whenever
                    the student has an OPEN credit balance the operator could
                    spend. Off by default: no surprise consumption. */}
                {preview && parseFloat(preview.credit_available) > 0 && (
                  <label className="flex items-start gap-2 rounded-md border border-emerald-100 bg-emerald-50/40 px-3 py-2 text-xs">
                    <input
                      type="checkbox"
                      checked={applyAvailableCredit}
                      onChange={(e) => setApplyAvailableCredit(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-emerald-300 text-emerald-600"
                    />
                    <span className="text-emerald-900">
                      Apply available credit of{" "}
                      <strong>{fmtKes(preview.credit_available)}</strong>
                      <span className="mt-0.5 block text-[11px] text-emerald-800/80">
                        Consumed first, then cash flows into the waterfall.
                      </span>
                    </span>
                  </label>
                )}
                <div>
                  <Label className="text-xs">Provider</Label>
                  <Select value={provider} onValueChange={setProvider}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PROVIDERS.map((p) => <SelectItem key={p.code} value={p.code}>{p.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Reference (optional)</Label>
                  <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. M-PESA id" />
                </div>
                {/* Phase N — Waterfall preview: live breakdown of what the
                    server WILL book if this payment is submitted. Preview and
                    commit share one engine on the backend so what the operator
                    sees here is exactly what happens. No silent surprises. */}
                {previewLoading && (
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                    Computing breakdown…
                  </div>
                )}
                {!previewLoading && previewError && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                    {previewError}
                  </div>
                )}
                {!previewLoading && preview && preview.steps.length > 0 && (
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs">
                    <div className="mb-1.5 flex items-baseline justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        Waterfall preview
                      </span>
                      <span className="font-mono text-[11px] text-slate-500">
                        {fmtKes(preview.amount)}
                      </span>
                    </div>
                    <ol className="space-y-1">
                      {preview.steps.map((s, i) => (
                        <li key={i} className="flex items-baseline justify-between gap-2">
                          <span className="text-slate-700">
                            {s.type === "credit_consumed" && (
                              <>
                                <span className="mr-1 rounded bg-emerald-100 px-1 py-0.5 text-[9px] font-semibold uppercase text-emerald-800">
                                  Credit
                                </span>
                                Available credit consumed
                              </>
                            )}
                            {s.type === "carry_forward_debit" && (
                              <>
                                <span className="mr-1 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold uppercase text-amber-800">
                                  Prior
                                </span>
                                {s.term_label || "Prior balance"}
                                {s.fully_settles === false && (
                                  <span className="ml-1 text-[10px] text-slate-400">
                                    (partial)
                                  </span>
                                )}
                              </>
                            )}
                            {s.type === "invoice" && (
                              <>
                                <span className="mr-1 rounded bg-slate-200 px-1 py-0.5 text-[9px] font-semibold uppercase text-slate-700">
                                  Invoice
                                </span>
                                Term {s.term_number ?? "—"}{" "}
                                {s.academic_year ? s.academic_year : ""}
                                {s.invoice_no && (
                                  <span className="ml-1 font-mono text-[10px] text-slate-400">
                                    {s.invoice_no}
                                  </span>
                                )}
                                {s.fully_pays === false && (
                                  <span className="ml-1 text-[10px] text-slate-400">
                                    (partial)
                                  </span>
                                )}
                              </>
                            )}
                            {s.type === "overpayment_credit" && (
                              <>
                                <span className="mr-1 rounded bg-blue-100 px-1 py-0.5 text-[9px] font-semibold uppercase text-blue-800">
                                  Credit fwd
                                </span>
                                Surplus → next invoice
                              </>
                            )}
                          </span>
                          <span className="font-mono text-slate-700 tabular-nums">
                            {fmtKes(s.amount)}
                          </span>
                        </li>
                      ))}
                    </ol>
                    <div className="mt-2 border-t border-slate-100 pt-1.5 text-[10px] text-slate-500">
                      Prior balance remaining after: {fmtKes(preview.cf_debits_remaining_after)}
                      {" · "}
                      Invoice balance remaining: {fmtKes(preview.invoices_remaining_after)}
                    </div>
                  </div>
                )}
                <Button onClick={() => void recordStudent()} disabled={recording || !studentSummary} className="w-full">
                  {recording ? "Recording…" : "Record Payment"}
                </Button>
                <p className="text-[11px] text-slate-400">
                  Prior balance first, then invoices oldest-first. Any surplus
                  is credited forward to the next invoice — never lost, never
                  fails.
                </p>
              </div>
            </div>
            {lastStudentResult && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-900">
                  <ReceiptText className="h-4 w-4" />
                  Receipt {lastStudentResult.receipt_no || lastStudentResult.payment_id.slice(0, 8)}
                </h3>
                <p className="text-xs text-emerald-800">
                  Recorded {fmtKes(lastStudentResult.amount)}
                  {parseFloat(lastStudentResult.credit_consumed || "0") > 0 && (
                    <> · {fmtKes(lastStudentResult.credit_consumed || "0")} available credit consumed</>
                  )}
                  {parseFloat(lastStudentResult.cf_debits_settled || "0") > 0 && (
                    <> · {fmtKes(lastStudentResult.cf_debits_settled || "0")} prior balance cleared</>
                  )}
                  {parseFloat(lastStudentResult.allocated_total) > 0 && (
                    <> · {fmtKes(lastStudentResult.allocated_total)} to invoices</>
                  )}
                  {parseFloat(lastStudentResult.surplus_credit) > 0 && (
                    <> · {fmtKes(lastStudentResult.surplus_credit)} credited forward</>
                  )}
                  .
                </p>
                <ul className="mt-2 space-y-0.5 text-[11px] text-emerald-900">
                  {lastStudentResult.allocations.map((a) => (
                    <li key={a.invoice_id}>
                      • Term {a.term_number ?? "—"} {a.academic_year ?? ""} ·{" "}
                      <span className="font-mono">{a.invoice_no || a.invoice_id.slice(0, 8)}</span>: {fmtKes(a.amount)}
                    </li>
                  ))}
                </ul>
                <div className="mt-3">
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs"
                    onClick={() => void openReceiptPdf(lastStudentResult.payment_id)}>
                    <Printer className="h-3 w-3" /> Print receipt
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Family panel ─────────────────────────────────────────────── */}
      {picked?.kind === "parent" && (
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="space-y-4 lg:col-span-3">
            {summaryLoading || !parentSummary ? (
              <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                <p className="py-6 text-center text-sm text-slate-400">Loading family summary…</p>
              </div>
            ) : (
              <>
                <div className="rounded-2xl border border-blue-100 bg-blue-50 p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-blue-600" />
                      <div>
                        <p className="text-sm font-semibold text-blue-900">{parentSummary.parent_name}</p>
                        <p className="text-xs text-blue-700">
                          {parentSummary.children.length} {parentSummary.children.length === 1 ? "child" : "children"} in this tenant
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase tracking-wide text-blue-700">Family total owed</p>
                      <p className="text-lg font-bold text-blue-900">{fmtKes(parentSummary.family_total_outstanding)}</p>
                    </div>
                  </div>
                </div>
                {parentSummary.children.length === 0 ? (
                  <div className="rounded-2xl border border-slate-100 bg-white p-5 text-center text-sm text-slate-400 shadow-sm">
                    No children with outstanding fees for this guardian.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {parentSummary.children.map((c) => (
                      <div key={c.student_id}>{renderStudentBreakdown(c, true)}</div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="space-y-4 lg:col-span-2">
            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                <HandCoins className="h-4 w-4 text-emerald-600" /> Record family payment
              </h3>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Amount received (KES)</Label>
                  <Input
                    type="number" min="0.01" step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <Label className="text-xs">Provider</Label>
                  <Select value={provider} onValueChange={setProvider}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PROVIDERS.map((p) => <SelectItem key={p.code} value={p.code}>{p.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Reference (optional)</Label>
                  <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. M-PESA id" />
                </div>

                {/* Allocation mode toggle */}
                {familyChildren.length > 1 && (
                  <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">
                        {familyMode === "auto" ? "Auto allocation" : "Manual per-child split"}
                      </Label>
                      <Button
                        size="sm" variant="ghost" className="h-7 text-xs"
                        onClick={() => setFamilyMode((m) => (m === "auto" ? "manual" : "auto"))}
                      >
                        {familyMode === "auto" ? "Allocate per child manually" : "Use auto allocation"}
                      </Button>
                    </div>
                    {familyMode === "auto" ? (
                      <p className="mt-1 text-[11px] text-slate-500">
                        Oldest term first, across all children.
                      </p>
                    ) : (
                      <div className="mt-2 space-y-2">
                        {familyChildren.map((c) => (
                          <div key={c.student_id} className="flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-medium text-slate-700">{c.student_name}</p>
                              <p className="text-[11px] text-slate-400">owes {fmtKes(c.total_outstanding)}</p>
                            </div>
                            <Input
                              type="number" min="0" step="0.01"
                              className="h-8 w-28 text-xs"
                              placeholder="0.00"
                              value={perStudent[c.student_id] ?? ""}
                              onChange={(e) =>
                                setPerStudent((m) => ({ ...m, [c.student_id]: e.target.value }))
                              }
                            />
                          </div>
                        ))}
                        <div className="flex justify-between text-[11px]">
                          <span className="text-slate-500">Per-child total</span>
                          <span
                            className={
                              manualSum > typedAmount && typedAmount > 0
                                ? "font-semibold text-red-600"
                                : "font-semibold text-slate-700"
                            }
                          >
                            {fmtKes(manualSum)} of {fmtKes(typedAmount)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Credit forward target */}
                {requiresCreditTarget && (
                  <div>
                    <Label className="text-xs">Credit forward to <span className="text-red-500">*</span></Label>
                    <Select value={creditToStudentId} onValueChange={setCreditToStudentId}>
                      <SelectTrigger><SelectValue placeholder="Pick which child keeps the surplus…" /></SelectTrigger>
                      <SelectContent>
                        {familyChildren.map((c) => (
                          <SelectItem key={c.student_id} value={c.student_id}>{c.student_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="mt-1 text-[11px] text-amber-700">
                      The payment exceeds the family's outstanding by {fmtKes(typedAmount - (familyMode === "manual" ? manualSum : familyTotal))}.
                      That surplus becomes a credit on the chosen child's next invoice.
                    </p>
                  </div>
                )}

                <Button onClick={() => void recordFamily()} disabled={recording || !parentSummary} className="w-full">
                  {recording ? "Recording…" : "Record Family Payment"}
                </Button>
                <p className="text-[11px] text-slate-400">
                  One payment row covers the whole family. The receipt shows
                  each child's name, class, and per-child subtotal.
                </p>
              </div>
            </div>

            {lastFamilyResult && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-900">
                  <ReceiptText className="h-4 w-4" />
                  Receipt {lastFamilyResult.receipt_no || lastFamilyResult.payment_id.slice(0, 8)}
                </h3>
                <p className="text-xs text-emerald-800">
                  Recorded {fmtKes(lastFamilyResult.amount)} across {lastFamilyResult.students.length}{" "}
                  {lastFamilyResult.students.length === 1 ? "child" : "children"} ·{" "}
                  {fmtKes(lastFamilyResult.allocated_total)} allocated
                  {parseFloat(lastFamilyResult.surplus_credit) > 0 && (
                    <>
                      , {fmtKes(lastFamilyResult.surplus_credit)} credited to{" "}
                      {lastFamilyResult.credit_to_student_name || "next term"}
                    </>
                  )}.
                </p>
                <div className="mt-2 space-y-2">
                  {lastFamilyResult.students.map((stu) => (
                    <div key={stu.student_id} className="rounded-lg border border-emerald-100 bg-white p-2 text-[11px]">
                      <p className="flex items-center gap-1.5 font-semibold text-emerald-900">
                        <User className="h-3 w-3" /> {stu.student_name}
                        <span className="text-emerald-700">·</span>
                        <span className="font-mono">{stu.admission_no || "—"}</span>
                        <span className="text-emerald-700">·</span>
                        <span>{stu.class_code || "—"}</span>
                        <span className="ml-auto font-bold">{fmtKes(stu.subtotal)}</span>
                      </p>
                      <ul className="mt-1 space-y-0.5 text-emerald-900">
                        {stu.allocations.map((a) => (
                          <li key={a.invoice_id}>
                            • Term {a.term_number ?? "—"} {a.academic_year ?? ""} ·{" "}
                            <span className="font-mono">{a.invoice_no || a.invoice_id.slice(0, 8)}</span>: {fmtKes(a.amount)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
                <div className="mt-3">
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs"
                    onClick={() => void openReceiptPdf(lastFamilyResult.payment_id)}>
                    <Printer className="h-3 w-3" /> Print receipt
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
