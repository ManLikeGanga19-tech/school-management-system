"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis } from "recharts";

import { AppShell } from "@/components/layout/AppShell";
import { secretaryFinanceHref, secretaryNav, type FinanceSection } from "@/components/layout/nav-config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
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

// ─── Types ───────────────────────────────────────────────────────────────────

type FinancePolicy = {
  allow_partial_enrollment: boolean;
  min_percent_to_enroll: number | null;
  min_amount_to_enroll: string | null;
  require_interview_fee_before_submit: boolean;
};

type FeeCategory = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

type FeeItem = {
  id: string;
  category_id: string;
  code: string;
  name: string;
  is_active: boolean;
};

type FeeStructure = {
  id: string;
  class_code: string;
  name: string;
  is_active: boolean;
};

type FeeStructureItem = {
  fee_item_id: string;
  amount: string | number;
  fee_item_code: string;
  fee_item_name: string;
  category_id: string;
  category_code: string;
  category_name: string;
};

type Scholarship = {
  id: string;
  name: string;
  type: string;
  value: string | number;
  is_active: boolean;
};

type Invoice = {
  id: string;
  invoice_type: string;
  status: string;
  enrollment_id: string | null;
  currency: string;
  total_amount: string | number;
  paid_amount: string | number;
  balance_amount: string | number;
};

type Enrollment = {
  id: string;
  status: string;
  payload: Record<string, unknown>;
};

type Payment = {
  id: string;
  provider: string;
  reference: string | null;
  amount: string | number;
  allocations: { invoice_id: string; amount: string | number }[];
};

type FinanceResponse = {
  policy: FinancePolicy | null;
  invoices: Invoice[];
  fee_categories: FeeCategory[];
  fee_items: FeeItem[];
  fee_structures: FeeStructure[];
  fee_structure_items: Record<string, FeeStructureItem[]>;
  scholarships: Scholarship[];
  enrollments: Enrollment[];
  payments: Payment[];
  health: Record<string, boolean>;
};

type FinanceAction =
  | "create_invoice"
  | "generate_fees_invoice"
  | "record_payment"
  | "update_policy"
  | "create_fee_category"
  | "create_fee_item"
  | "create_fee_structure"
  | "update_fee_structure"
  | "delete_fee_structure"
  | "add_structure_item"
  | "remove_structure_item"
  | "upsert_structure_items"
  | "create_scholarship";

type StructureRowDraft = {
  fee_item_id: string;
  fee_item_code: string;
  fee_item_name: string;
  category_id: string;
  category_code: string;
  category_name: string;
  amount: string;
};

type PaymentAllocationDraft = {
  invoice_id: string;
  amount: string;
};

type KeyValueRecord = Record<string, unknown>;

const DEFAULT_POLICY: FinancePolicy = {
  allow_partial_enrollment: false,
  min_percent_to_enroll: null,
  min_amount_to_enroll: null,
  require_interview_fee_before_submit: true,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function asObject(value: unknown): KeyValueRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as KeyValueRecord)
    : null;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function toNumber(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function formatKes(value: number) {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatAmount(value: string | number | null | undefined) {
  return formatKes(toNumber(value));
}

function readError(value: unknown, fallback: string) {
  const obj = asObject(value);
  if (!obj) return fallback;
  const detail = obj.detail;
  const message = obj.message;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (typeof message === "string" && message.trim()) return message;
  return fallback;
}

function enrollmentName(payload: Record<string, unknown>) {
  const options = [
    payload.student_name,
    payload.studentName,
    payload.full_name,
    payload.fullName,
    payload.name,
  ];
  for (const value of options) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return "Unknown student";
}

function enrollmentClassCode(payload: Record<string, unknown>) {
  const options = [
    payload.admission_class,
    payload.class_code,
    payload.classCode,
    payload.class_name,
    payload.className,
    payload.grade,
  ];
  for (const value of options) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizeCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "_");
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepBadge({ number, label }: { number: number; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
        {number}
      </span>
      <span className="text-sm font-semibold text-blue-900">{label}</span>
    </div>
  );
}

function SectionCard({
  step,
  stepLabel,
  title,
  description,
  children,
}: {
  step?: number;
  stepLabel?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-6 py-4">
        {step !== undefined && stepLabel && (
          <div className="mb-2">
            <StepBadge number={step} label={stepLabel} />
          </div>
        )}
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function FormField({
  label,
  hint,
  children,
  required,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </Label>
      {children}
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        active
          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
          : "bg-slate-100 text-slate-500 ring-1 ring-slate-200"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-emerald-500" : "bg-slate-400"}`} />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function InvoiceStatusBadge({ status }: { status: string }) {
  const s = status.toUpperCase();
  const styles: Record<string, string> = {
    PAID: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    PARTIAL: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    UNPAID: "bg-red-50 text-red-700 ring-1 ring-red-200",
    PENDING: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[s] ?? "bg-slate-100 text-slate-600 ring-1 ring-slate-200"}`}
    >
      {s}
    </span>
  );
}

function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-10 text-center">
        <div className="flex flex-col items-center gap-1">
          <span className="text-2xl">📋</span>
          <span className="text-sm text-slate-400">{message}</span>
        </div>
      </TableCell>
    </TableRow>
  );
}

function ActionButton({
  onClick,
  loading,
  loadingText,
  children,
  variant = "default",
  disabled,
  className,
}: {
  onClick?: () => void;
  loading?: boolean;
  loadingText?: string;
  children: React.ReactNode;
  variant?: "default" | "outline" | "ghost" | "destructive";
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Button
      onClick={onClick}
      disabled={loading || disabled}
      variant={variant}
      className={className}
    >
      {loading ? (
        <span className="flex items-center gap-2">
          <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {loadingText ?? "Saving..."}
        </span>
      ) : (
        children
      )}
    </Button>
  );
}

function AlertBanner({
  type,
  message,
  onDismiss,
}: {
  type: "error" | "success";
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div
      className={`flex items-start justify-between rounded-xl px-4 py-3 text-sm ${
        type === "error"
          ? "border border-red-200 bg-red-50 text-red-800"
          : "border border-emerald-200 bg-emerald-50 text-emerald-800"
      }`}
    >
      <div className="flex items-center gap-2">
        <span>{type === "error" ? "⚠️" : "✅"}</span>
        <span>{message}</span>
      </div>
      <button onClick={onDismiss} className="ml-4 opacity-60 hover:opacity-100">
        ✕
      </button>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color: "blue" | "emerald" | "amber" | "red";
}) {
  const colors = {
    blue: "border-blue-100 bg-blue-50 text-blue-900",
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-900",
    amber: "border-amber-100 bg-amber-50 text-amber-900",
    red: "border-red-100 bg-red-50 text-red-900",
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
      {sub && <p className="mt-0.5 text-xs opacity-60">{sub}</p>}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function SecretaryFinancePageContent() {
  const searchParams = useSearchParams();
  const sectionParam = searchParams.get("section");
  const section: FinanceSection =
    sectionParam === "invoices" ||
    sectionParam === "payments" ||
    sectionParam === "receipts" ||
    sectionParam === "fee-structures"
      ? sectionParam
      : "fee-structures";

  const [data, setData] = useState<FinanceResponse>({
    policy: null,
    invoices: [],
    fee_categories: [],
    fee_items: [],
    fee_structures: [],
    fee_structure_items: {},
    scholarships: [],
    enrollments: [],
    payments: [],
    health: {},
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<FinanceAction | null>(null);

  const [policyForm, setPolicyForm] = useState<FinancePolicy>(DEFAULT_POLICY);
  const [policyDirty, setPolicyDirty] = useState(false);

  const [categoryForm, setCategoryForm] = useState({ code: "", name: "", is_active: true });
  const [itemForm, setItemForm] = useState({ category_id: "", code: "", name: "", is_active: true });
  const [structureForm, setStructureForm] = useState({ class_code: "", name: "", is_active: true });
  const [editingStructureId, setEditingStructureId] = useState("");
  const [selectedStructureId, setSelectedStructureId] = useState("");
  const [structureRows, setStructureRows] = useState<StructureRowDraft[]>([]);
  const [structureAddMode, setStructureAddMode] = useState<"existing" | "new">("existing");
  const [structureExistingItemForm, setStructureExistingItemForm] = useState({ fee_item_id: "", amount: "" });
  const [structureInlineItemForm, setStructureInlineItemForm] = useState({
    category_id: "", code: "", name: "", amount: "", is_active: true,
  });
  const [categoryFilter, setCategoryFilter] = useState("");
  const [itemFilter, setItemFilter] = useState("");
  const [scholarshipForm, setScholarshipForm] = useState({ name: "", type: "PERCENT", value: "", is_active: true });
  const [feesInvoiceForm, setFeesInvoiceForm] = useState({ enrollment_id: "", class_code: "", scholarship_id: "" });
  const [interviewInvoiceForm, setInterviewInvoiceForm] = useState({ enrollment_id: "", description: "Interview fee", amount: "" });
  const [paymentForm, setPaymentForm] = useState({ provider: "MPESA", reference: "", amount: "" });
  const [paymentEnrollmentId, setPaymentEnrollmentId] = useState("");
  const [paymentAllocations, setPaymentAllocations] = useState<PaymentAllocationDraft[]>([{ invoice_id: "", amount: "" }]);

  async function loadFinance(silent = false) {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/tenant/secretary/finance", { method: "GET" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(readError(body, "Failed to load finance data")); return; }
      const obj = asObject(body) || {};
      const incoming: FinanceResponse = {
        policy: (asObject(obj.policy) as FinancePolicy | null) || null,
        invoices: asArray<Invoice>(obj.invoices),
        fee_categories: asArray<FeeCategory>(obj.fee_categories),
        fee_items: asArray<FeeItem>(obj.fee_items),
        fee_structures: asArray<FeeStructure>(obj.fee_structures),
        fee_structure_items: (asObject(obj.fee_structure_items) as Record<string, FeeStructureItem[]>) || {},
        scholarships: asArray<Scholarship>(obj.scholarships),
        enrollments: asArray<Enrollment>(obj.enrollments),
        payments: asArray<Payment>(obj.payments),
        health: (asObject(obj.health) as Record<string, boolean>) || {},
      };
      setData(incoming);
      setError(null);
      if (!policyDirty) setPolicyForm(incoming.policy || DEFAULT_POLICY);
      if (!selectedStructureId && incoming.fee_structures.length > 0) {
        setSelectedStructureId(incoming.fee_structures[0].id);
      }
    } catch {
      setError("Finance service is currently unavailable.");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void loadFinance();
    const timer = setInterval(() => void loadFinance(true), 20000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedStructureId) { setStructureRows([]); return; }
    const source = data.fee_structure_items[selectedStructureId] || [];
    setStructureRows(source.map((item) => ({
      fee_item_id: String(item.fee_item_id || ""),
      fee_item_code: String(item.fee_item_code || ""),
      fee_item_name: String(item.fee_item_name || ""),
      category_id: String(item.category_id || ""),
      category_code: String(item.category_code || ""),
      category_name: String(item.category_name || ""),
      amount: String(item.amount ?? ""),
    })));
  }, [selectedStructureId, data.fee_structure_items]);

  useEffect(() => {
    const enrollment = data.enrollments.find((row) => row.id === feesInvoiceForm.enrollment_id);
    if (!enrollment || feesInvoiceForm.class_code.trim()) return;
    const guessed = enrollmentClassCode(enrollment.payload || {});
    if (guessed) setFeesInvoiceForm((prev) => ({ ...prev, class_code: guessed }));
  }, [feesInvoiceForm.enrollment_id, feesInvoiceForm.class_code, data.enrollments]);

  async function postAction(
    action: FinanceAction,
    payload: unknown,
    successMessage: string,
    onSuccess?: () => void
  ) {
    setPendingAction(action);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/tenant/secretary/finance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, payload }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(readError(body, "Action failed")); return; }
      if (onSuccess) onSuccess();
      setNotice(successMessage);
      await loadFinance(true);
    } catch {
      setError("Unable to reach finance service. Please try again.");
    } finally {
      setPendingAction(null);
    }
  }

  const totals = useMemo(
    () => data.invoices.reduce(
      (acc, inv) => {
        acc.total += toNumber(inv.total_amount);
        acc.paid += toNumber(inv.paid_amount);
        acc.balance += toNumber(inv.balance_amount);
        return acc;
      },
      { total: 0, paid: 0, balance: 0 }
    ),
    [data.invoices]
  );

  const outstandingInvoices = useMemo(
    () => data.invoices.filter((inv) => toNumber(inv.balance_amount) > 0),
    [data.invoices]
  );

  const paymentCandidateInvoices = useMemo(
    () => outstandingInvoices.filter((inv) =>
      paymentEnrollmentId ? inv.enrollment_id === paymentEnrollmentId : true
    ),
    [outstandingInvoices, paymentEnrollmentId]
  );

  const paymentAllocationTotal = useMemo(
    () => round2(paymentAllocations.reduce((acc, row) => acc + toNumber(row.amount), 0)),
    [paymentAllocations]
  );

  async function savePolicy() {
    await postAction("update_policy", {
      allow_partial_enrollment: policyForm.allow_partial_enrollment,
      min_percent_to_enroll: policyForm.min_percent_to_enroll,
      min_amount_to_enroll: policyForm.min_amount_to_enroll?.trim() || null,
      require_interview_fee_before_submit: policyForm.require_interview_fee_before_submit,
    }, "Finance policy updated.", () => setPolicyDirty(false));
  }

  async function createFeeCategory() {
    const code = categoryForm.code.trim();
    const name = categoryForm.name.trim();
    if (!code || !name) { setError("Fee category code and name are required."); return; }
    await postAction("create_fee_category", { code: normalizeCode(code), name, is_active: categoryForm.is_active },
      "Fee category created.", () => setCategoryForm({ code: "", name: "", is_active: true }));
  }

  async function createFeeItem() {
    const code = itemForm.code.trim();
    const name = itemForm.name.trim();
    if (!itemForm.category_id || !code || !name) { setError("Category, item code and item name are required."); return; }
    await postAction("create_fee_item", {
      category_id: itemForm.category_id,
      code: normalizeCode(code),
      name,
      is_active: itemForm.is_active,
    }, "Fee item created.", () => setItemForm({ category_id: "", code: "", name: "", is_active: true }));
  }

  async function createFeeStructure() {
    const classCode = structureForm.class_code.trim();
    const name = structureForm.name.trim();
    if (!classCode || !name) { setError("Class code and structure name are required."); return; }
    if (editingStructureId) {
      await postAction("update_fee_structure", {
        structure_id: editingStructureId,
        updates: { class_code: normalizeCode(classCode), name, is_active: structureForm.is_active },
      }, "Fee structure updated.", () => {
        setEditingStructureId("");
        setStructureForm({ class_code: "", name: "", is_active: true });
      });
      return;
    }
    await postAction("create_fee_structure", { class_code: normalizeCode(classCode), name, is_active: structureForm.is_active },
      "Fee structure created.", () => setStructureForm({ class_code: "", name: "", is_active: true }));
  }

  async function deleteFeeStructure(structureId: string) {
    await postAction("delete_fee_structure", { structure_id: structureId }, "Fee structure deleted.", () => {
      if (selectedStructureId === structureId) { setSelectedStructureId(""); setStructureRows([]); }
    });
  }

  async function addExistingItemToStructure() {
    if (!selectedStructureId) { setError("Select a fee structure first."); return; }
    if (!structureExistingItemForm.fee_item_id || !structureExistingItemForm.amount.trim()) { setError("Fee item and amount are required."); return; }
    if (toNumber(structureExistingItemForm.amount) <= 0) { setError("Amount must be greater than 0."); return; }
    await postAction("add_structure_item", {
      structure_id: selectedStructureId,
      item: { fee_item_id: structureExistingItemForm.fee_item_id, amount: structureExistingItemForm.amount.trim() },
    }, "Structure item saved.", () => setStructureExistingItemForm({ fee_item_id: "", amount: "" }));
  }

  async function addInlineItemToStructure() {
    if (!selectedStructureId) { setError("Select a fee structure first."); return; }
    const code = structureInlineItemForm.code.trim();
    const name = structureInlineItemForm.name.trim();
    const amount = structureInlineItemForm.amount.trim();
    if (!structureInlineItemForm.category_id || !code || !name || !amount) { setError("Category, code, name and amount are required."); return; }
    if (toNumber(amount) <= 0) { setError("Amount must be greater than 0."); return; }
    await postAction("add_structure_item", {
      structure_id: selectedStructureId,
      item: { amount, fee_item: { category_id: structureInlineItemForm.category_id, code: normalizeCode(code), name, is_active: structureInlineItemForm.is_active } },
    }, "New fee item created and attached to structure.", () =>
      setStructureInlineItemForm({ category_id: "", code: "", name: "", amount: "", is_active: true }));
  }

  async function saveStructureRowAmount(row: StructureRowDraft) {
    if (!selectedStructureId || !row.fee_item_id || !row.amount.trim() || toNumber(row.amount) <= 0) {
      setError("Valid fee item and amount required."); return;
    }
    await postAction("add_structure_item", {
      structure_id: selectedStructureId,
      item: { fee_item_id: row.fee_item_id, amount: row.amount.trim() },
    }, `Updated amount for ${row.fee_item_name || row.fee_item_code}.`);
  }

  async function removeStructureRow(row: StructureRowDraft) {
    if (!selectedStructureId || !row.fee_item_id) { setError("Invalid selection."); return; }
    await postAction("remove_structure_item", {
      structure_id: selectedStructureId,
      fee_item_id: row.fee_item_id,
    }, `Removed ${row.fee_item_name || row.fee_item_code} from structure.`);
  }

  async function createScholarship() {
    const name = scholarshipForm.name.trim();
    const value = scholarshipForm.value.trim();
    if (!name || !value || toNumber(value) <= 0) { setError("Scholarship name and a valid value are required."); return; }
    await postAction("create_scholarship", { name, type: scholarshipForm.type, value, is_active: scholarshipForm.is_active },
      "Scholarship created.", () => setScholarshipForm({ name: "", type: "PERCENT", value: "", is_active: true }));
  }

  async function generateFeesInvoice() {
    if (!feesInvoiceForm.enrollment_id || !feesInvoiceForm.class_code.trim()) {
      setError("Enrollment and class code are required."); return;
    }
    await postAction("generate_fees_invoice", {
      enrollment_id: feesInvoiceForm.enrollment_id,
      class_code: normalizeCode(feesInvoiceForm.class_code),
      scholarship_id: feesInvoiceForm.scholarship_id || null,
    }, "School fees invoice generated.");
  }

  async function createInterviewInvoice() {
    if (!interviewInvoiceForm.enrollment_id || !interviewInvoiceForm.amount.trim()) {
      setError("Enrollment and amount are required."); return;
    }
    if (toNumber(interviewInvoiceForm.amount) <= 0) { setError("Amount must be greater than 0."); return; }
    await postAction("create_invoice", {
      invoice_type: "INTERVIEW",
      enrollment_id: interviewInvoiceForm.enrollment_id,
      lines: [{ description: interviewInvoiceForm.description.trim() || "Interview fee", amount: interviewInvoiceForm.amount.trim() }],
    }, "Interview invoice created.", () => setInterviewInvoiceForm({ enrollment_id: "", description: "Interview fee", amount: "" }));
  }

  function autoDistributePayment() {
    const total = toNumber(paymentForm.amount);
    if (total <= 0) { setError("Enter payment amount first."); return; }
    if (paymentCandidateInvoices.length === 0) { setError("No outstanding invoices available."); return; }
    let remaining = total;
    const rows: PaymentAllocationDraft[] = [];
    for (const invoice of paymentCandidateInvoices) {
      if (remaining <= 0) break;
      const balance = toNumber(invoice.balance_amount);
      if (balance <= 0) continue;
      const alloc = Math.min(balance, remaining);
      rows.push({ invoice_id: invoice.id, amount: alloc.toFixed(2) });
      remaining = round2(remaining - alloc);
    }
    setPaymentAllocations(rows.length > 0 ? rows : [{ invoice_id: "", amount: "" }]);
  }

  async function recordPayment() {
    const amount = toNumber(paymentForm.amount);
    if (amount <= 0) { setError("Payment amount must be greater than 0."); return; }
    const allocations = paymentAllocations
      .map((row) => ({ invoice_id: row.invoice_id.trim(), amount: row.amount.trim() }))
      .filter((row) => row.invoice_id && row.amount);
    if (allocations.length === 0) { setError("Add at least one invoice allocation."); return; }
    const hasDuplicate = allocations.some((row, idx) => allocations.findIndex((x) => x.invoice_id === row.invoice_id) !== idx);
    if (hasDuplicate) { setError("Duplicate invoice allocations are not allowed."); return; }
    const allocationSum = round2(allocations.reduce((acc, row) => acc + toNumber(row.amount), 0));
    if (allocationSum !== round2(amount)) { setError("Allocation total must equal payment amount."); return; }
    await postAction("record_payment", {
      provider: paymentForm.provider,
      reference: paymentForm.reference.trim() || null,
      amount: paymentForm.amount.trim(),
      allocations,
    }, "Payment recorded.", () => {
      setPaymentForm({ provider: "MPESA", reference: "", amount: "" });
      setPaymentAllocations([{ invoice_id: "", amount: "" }]);
    });
  }

  const activeFinanceHref = secretaryFinanceHref(section);
  const showFeeStructures = section === "fee-structures";
  const showInvoices = section === "invoices";
  const showPayments = section === "payments";
  const showReceipts = section === "receipts";

  const selectedStructure = data.fee_structures.find((s) => s.id === selectedStructureId);
  const structureTotal = structureRows.reduce((acc, row) => acc + toNumber(row.amount), 0);

  if (loading) {
    return (
      <AppShell title="Secretary" nav={secretaryNav} activeHref={activeFinanceHref}>
        <div className="flex min-h-[400px] items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            <p className="text-sm text-slate-500">Loading finance data…</p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Secretary" nav={secretaryNav} activeHref={activeFinanceHref}>
      <div className="space-y-5">

        {/* ── Page Header ── */}
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-600 to-blue-500 p-5 text-white shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold">Finance Operations</h1>
              <p className="mt-0.5 text-sm text-blue-100 capitalize">
                {section.replace("-", " ")} — manage school fees, invoices &amp; payments
              </p>
            </div>
            <button
              onClick={() => void loadFinance()}
              className="flex items-center gap-1.5 rounded-lg bg-white/20 px-3 py-1.5 text-xs font-medium text-white backdrop-blur hover:bg-white/30 transition"
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* ── Alerts ── */}
        {error && <AlertBanner type="error" message={error} onDismiss={() => setError(null)} />}
        {notice && <AlertBanner type="success" message={notice} onDismiss={() => setNotice(null)} />}

        {/* ── FEE STRUCTURES SECTION ── */}
        {showFeeStructures && (
          <div className="space-y-5">

            {/* Step 1 — Fee Categories */}
            <SectionCard
              step={1}
              stepLabel="Create Fee Categories"
              title="Fee Categories"
              description="Categories group related fee items together (e.g. Tuition, Boarding, Activities)."
            >
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Create form */}
                <div className="space-y-4">
                  <div className="rounded-xl border border-blue-50 bg-slate-50 p-4">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">New Category</p>
                    <div className="space-y-3">
                      <FormField label="Category Code" hint="Will be auto-uppercased. E.g. TUITION" required>
                        <Input
                          placeholder="e.g. BOARDING"
                          value={categoryForm.code}
                          onChange={(e) => setCategoryForm((p) => ({ ...p, code: e.target.value }))}
                        />
                      </FormField>
                      <FormField label="Category Name" required>
                        <Input
                          placeholder="e.g. Boarding Fees"
                          value={categoryForm.name}
                          onChange={(e) => setCategoryForm((p) => ({ ...p, name: e.target.value }))}
                        />
                      </FormField>
                      <ActionButton
                        onClick={createFeeCategory}
                        loading={pendingAction === "create_fee_category"}
                        loadingText="Creating…"
                        className="w-full"
                      >
                        + Create Category
                      </ActionButton>
                    </div>
                  </div>
                </div>

                {/* Table */}
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Existing Categories ({data.fee_categories.length})
                  </p>
                  <div className="rounded-xl border border-slate-100 overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50">
                          <TableHead className="text-xs">Code</TableHead>
                          <TableHead className="text-xs">Name</TableHead>
                          <TableHead className="text-xs">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.fee_categories.map((cat) => (
                          <TableRow key={cat.id} className="hover:bg-slate-50">
                            <TableCell className="font-mono text-xs font-medium text-blue-700">{cat.code}</TableCell>
                            <TableCell className="text-sm">{cat.name}</TableCell>
                            <TableCell><StatusBadge active={cat.is_active} /></TableCell>
                          </TableRow>
                        ))}
                        {data.fee_categories.length === 0 && (
                          <EmptyRow colSpan={3} message="No categories yet. Create one above." />
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            </SectionCard>

            {/* Step 2 — Fee Items */}
            <SectionCard
              step={2}
              stepLabel="Create Fee Items"
              title="Fee Items"
              description="Fee items are the individual charges within a category (e.g. Term 1 Tuition, Lunch Fee)."
            >
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Create form */}
                <div className="space-y-4">
                  <div className="rounded-xl border border-blue-50 bg-slate-50 p-4">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">New Fee Item</p>
                    {data.fee_categories.length === 0 ? (
                      <div className="rounded-lg border border-amber-100 bg-amber-50 p-3 text-sm text-amber-700">
                        ⚠️ Create at least one fee category first (Step 1) before adding fee items.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <FormField label="Category" hint="Which category does this fee item belong to?" required>
                          <Select
                            value={itemForm.category_id || "__none__"}
                            onValueChange={(value) => setItemForm((p) => ({ ...p, category_id: value === "__none__" ? "" : value }))}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select a category" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">Select category…</SelectItem>
                              {data.fee_categories.map((cat) => (
                                <SelectItem key={cat.id} value={cat.id}>
                                  {cat.code} — {cat.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormField>
                        <div className="grid grid-cols-2 gap-2">
                          <FormField label="Item Code" required>
                            <Input
                              placeholder="e.g. LUNCH_FEE"
                              value={itemForm.code}
                              onChange={(e) => setItemForm((p) => ({ ...p, code: e.target.value }))}
                            />
                          </FormField>
                          <FormField label="Item Name" required>
                            <Input
                              placeholder="e.g. Lunch Fee"
                              value={itemForm.name}
                              onChange={(e) => setItemForm((p) => ({ ...p, name: e.target.value }))}
                            />
                          </FormField>
                        </div>
                        <ActionButton
                          onClick={createFeeItem}
                          loading={pendingAction === "create_fee_item"}
                          loadingText="Creating…"
                          className="w-full"
                        >
                          + Create Fee Item
                        </ActionButton>
                      </div>
                    )}
                  </div>
                </div>

                {/* Table */}
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Fee Items ({data.fee_items.length})
                  </p>
                  <div className="rounded-xl border border-slate-100 overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50">
                          <TableHead className="text-xs">Code</TableHead>
                          <TableHead className="text-xs">Name</TableHead>
                          <TableHead className="text-xs">Category</TableHead>
                          <TableHead className="text-xs">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.fee_items.map((item) => {
                          const cat = data.fee_categories.find((c) => c.id === item.category_id);
                          return (
                            <TableRow key={item.id} className="hover:bg-slate-50">
                              <TableCell className="font-mono text-xs font-medium text-blue-700">{item.code}</TableCell>
                              <TableCell className="text-sm">{item.name}</TableCell>
                              <TableCell>
                                <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                                  {cat?.code ?? "—"}
                                </span>
                              </TableCell>
                              <TableCell><StatusBadge active={item.is_active} /></TableCell>
                            </TableRow>
                          );
                        })}
                        {data.fee_items.length === 0 && (
                          <EmptyRow colSpan={4} message="No fee items yet. Create one above." />
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            </SectionCard>

            {/* Step 3 — Fee Structures */}
            <SectionCard
              step={3}
              stepLabel="Create Fee Structures"
              title="Fee Structures"
              description="A fee structure defines all the fees applicable to a specific class or grade."
            >
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Create/Edit form */}
                <div>
                  <div className="rounded-xl border border-blue-50 bg-slate-50 p-4">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {editingStructureId ? "Edit Structure" : "New Structure"}
                    </p>
                    <div className="space-y-3">
                      <FormField label="Class Code" hint="e.g. GRADE_7, FORM_1, PP2" required>
                        <Input
                          placeholder="e.g. GRADE_7"
                          value={structureForm.class_code}
                          onChange={(e) => setStructureForm((p) => ({ ...p, class_code: e.target.value }))}
                        />
                      </FormField>
                      <FormField label="Structure Name" required>
                        <Input
                          placeholder="e.g. Grade 7 - Day Scholar 2025"
                          value={structureForm.name}
                          onChange={(e) => setStructureForm((p) => ({ ...p, name: e.target.value }))}
                        />
                      </FormField>
                      <div className="flex gap-2">
                        <ActionButton
                          onClick={createFeeStructure}
                          loading={pendingAction === "create_fee_structure" || pendingAction === "update_fee_structure"}
                          className="flex-1"
                        >
                          {editingStructureId ? "Update Structure" : "+ Create Structure"}
                        </ActionButton>
                        {editingStructureId && (
                          <Button variant="outline" onClick={() => { setEditingStructureId(""); setStructureForm({ class_code: "", name: "", is_active: true }); }}>
                            Cancel
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Table */}
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Structures ({data.fee_structures.length})
                  </p>
                  <div className="rounded-xl border border-slate-100 overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50">
                          <TableHead className="text-xs">Class</TableHead>
                          <TableHead className="text-xs">Name</TableHead>
                          <TableHead className="text-xs">Status</TableHead>
                          <TableHead className="text-xs">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.fee_structures.map((structure) => (
                          <TableRow key={structure.id} className="hover:bg-slate-50">
                            <TableCell className="font-mono text-xs font-medium text-blue-700">{structure.class_code}</TableCell>
                            <TableCell className="text-sm">{structure.name}</TableCell>
                            <TableCell><StatusBadge active={structure.is_active} /></TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <button
                                  onClick={() => { setEditingStructureId(structure.id); setStructureForm({ class_code: structure.class_code, name: structure.name, is_active: structure.is_active }); }}
                                  className="rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 transition"
                                  disabled={pendingAction !== null}
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => setSelectedStructureId(structure.id)}
                                  className="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 transition"
                                  disabled={pendingAction !== null}
                                >
                                  Assign Items →
                                </button>
                                <button
                                  onClick={() => void deleteFeeStructure(structure.id)}
                                  className="rounded-md px-2 py-1 text-xs text-red-500 hover:bg-red-50 transition"
                                  disabled={pendingAction !== null}
                                >
                                  Delete
                                </button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                        {data.fee_structures.length === 0 && (
                          <EmptyRow colSpan={4} message="No structures yet. Create one above." />
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            </SectionCard>

            {/* Step 4 — Assign Fee Items to Structure */}
            <SectionCard
              step={4}
              stepLabel="Assign Fee Items to a Structure"
              title="Structure Fee Items"
              description="Select a structure, then attach fee items and their amounts."
            >
              {data.fee_structures.length === 0 ? (
                <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-700">
                  ⚠️ Create a fee structure first (Step 3) before assigning fee items.
                </div>
              ) : (
                <div className="space-y-5">
                  {/* Structure selector */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-600">Structure:</span>
                    <div className="flex flex-wrap gap-2">
                      {data.fee_structures.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => setSelectedStructureId(s.id)}
                          className={`rounded-full px-3 py-1 text-sm font-medium transition ${
                            selectedStructureId === s.id
                              ? "bg-blue-600 text-white shadow-sm"
                              : "border border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700"
                          }`}
                        >
                          {s.class_code}
                        </button>
                      ))}
                    </div>
                  </div>

                  {selectedStructure && (
                    <div className="rounded-xl border border-blue-100 bg-blue-50/40 px-4 py-2 text-sm text-blue-800">
                      <span className="font-semibold">{selectedStructure.name}</span>
                      {structureRows.length > 0 && (
                        <span className="ml-3 text-blue-600">
                          {structureRows.length} items · Total: <strong>{formatKes(structureTotal)}</strong>
                        </span>
                      )}
                    </div>
                  )}

                  <div className="grid gap-5 lg:grid-cols-2">
                    {/* Add item form */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="mb-3 flex gap-2">
                        <button
                          onClick={() => setStructureAddMode("existing")}
                          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                            structureAddMode === "existing"
                              ? "bg-blue-600 text-white"
                              : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                          }`}
                        >
                          Use Existing Item
                        </button>
                        <button
                          onClick={() => setStructureAddMode("new")}
                          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                            structureAddMode === "new"
                              ? "bg-blue-600 text-white"
                              : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                          }`}
                        >
                          Create &amp; Add New Item
                        </button>
                      </div>

                      {structureAddMode === "existing" && (
                        <div className="space-y-3">
                          <FormField label="Search & Select Fee Item" required>
                            <Input
                              placeholder="Search by name or code…"
                              value={itemFilter}
                              onChange={(e) => setItemFilter(e.target.value)}
                              className="mb-2"
                            />
                            <Select
                              value={structureExistingItemForm.fee_item_id || "__none__"}
                              onValueChange={(value) => setStructureExistingItemForm((p) => ({ ...p, fee_item_id: value === "__none__" ? "" : value }))}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Choose fee item…" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">Choose fee item…</SelectItem>
                                {data.fee_items
                                  .filter((it) => !itemFilter || it.code.toLowerCase().includes(itemFilter.toLowerCase()) || it.name.toLowerCase().includes(itemFilter.toLowerCase()))
                                  .map((item) => (
                                    <SelectItem key={item.id} value={item.id}>
                                      {item.code} — {item.name}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </FormField>
                          <FormField label="Amount (KES)" required>
                            <div className="flex gap-2">
                              <Input
                                type="number"
                                min={0}
                                placeholder="0.00"
                                value={structureExistingItemForm.amount}
                                onChange={(e) => setStructureExistingItemForm((p) => ({ ...p, amount: e.target.value }))}
                                className="flex-1"
                              />
                              <ActionButton
                                onClick={addExistingItemToStructure}
                                loading={pendingAction === "add_structure_item"}
                                disabled={!selectedStructureId}
                                loadingText="Adding…"
                              >
                                Add
                              </ActionButton>
                            </div>
                          </FormField>
                        </div>
                      )}

                      {structureAddMode === "new" && (
                        <div className="space-y-3">
                          {data.fee_categories.length === 0 ? (
                            <div className="rounded-lg border border-amber-100 bg-amber-50 p-3 text-xs text-amber-700">
                              ⚠️ Create fee categories first (Step 1).
                            </div>
                          ) : (
                            <>
                              <FormField label="Category" required>
                                <Input
                                  placeholder="Filter categories…"
                                  value={categoryFilter}
                                  onChange={(e) => setCategoryFilter(e.target.value)}
                                  className="mb-2"
                                />
                                <Select
                                  value={structureInlineItemForm.category_id || "__none__"}
                                  onValueChange={(value) => setStructureInlineItemForm((p) => ({ ...p, category_id: value === "__none__" ? "" : value }))}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select category…" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__none__">Select category…</SelectItem>
                                    {data.fee_categories
                                      .filter((c) => !categoryFilter || c.code.toLowerCase().includes(categoryFilter.toLowerCase()) || c.name.toLowerCase().includes(categoryFilter.toLowerCase()))
                                      .map((cat) => (
                                        <SelectItem key={cat.id} value={cat.id}>
                                          {cat.code} — {cat.name}
                                        </SelectItem>
                                      ))}
                                  </SelectContent>
                                </Select>
                              </FormField>
                              <div className="grid grid-cols-2 gap-2">
                                <FormField label="Item Code" required>
                                  <Input
                                    placeholder="e.g. LUNCH_FEE"
                                    value={structureInlineItemForm.code}
                                    onChange={(e) => setStructureInlineItemForm((p) => ({ ...p, code: e.target.value }))}
                                  />
                                </FormField>
                                <FormField label="Item Name" required>
                                  <Input
                                    placeholder="e.g. Lunch Fee"
                                    value={structureInlineItemForm.name}
                                    onChange={(e) => setStructureInlineItemForm((p) => ({ ...p, name: e.target.value }))}
                                  />
                                </FormField>
                              </div>
                              <FormField label="Amount (KES)" required>
                                <div className="flex gap-2">
                                  <Input
                                    type="number"
                                    min={0}
                                    placeholder="0.00"
                                    value={structureInlineItemForm.amount}
                                    onChange={(e) => setStructureInlineItemForm((p) => ({ ...p, amount: e.target.value }))}
                                    className="flex-1"
                                  />
                                  <ActionButton
                                    onClick={addInlineItemToStructure}
                                    loading={pendingAction === "add_structure_item"}
                                    disabled={!selectedStructureId}
                                    loadingText="Creating…"
                                  >
                                    Create + Add
                                  </ActionButton>
                                </div>
                              </FormField>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Items already in this structure */}
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Items in Structure
                        {selectedStructure ? ` (${selectedStructure.class_code})` : ""}
                      </p>
                      <div className="rounded-xl border border-slate-100 overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-slate-50">
                              <TableHead className="text-xs">Item</TableHead>
                              <TableHead className="text-xs">Category</TableHead>
                              <TableHead className="text-xs">Amount (KES)</TableHead>
                              <TableHead className="text-xs">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {structureRows.map((row, index) => (
                              <TableRow key={`${row.fee_item_id}-${index}`} className="hover:bg-slate-50">
                                <TableCell>
                                  <div>
                                    <p className="text-sm font-medium">{row.fee_item_name || "—"}</p>
                                    <p className="font-mono text-xs text-slate-400">{row.fee_item_code}</p>
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                                    {row.category_code || row.category_name || "—"}
                                  </span>
                                </TableCell>
                                <TableCell className="min-w-[130px]">
                                  <Input
                                    type="number"
                                    min={0}
                                    value={row.amount}
                                    onChange={(e) =>
                                      setStructureRows((prev) =>
                                        prev.map((entry, idx) =>
                                          idx === index ? { ...entry, amount: e.target.value } : entry
                                        )
                                      )
                                    }
                                    className="h-8 text-sm"
                                  />
                                </TableCell>
                                <TableCell>
                                  <div className="flex gap-1">
                                    <button
                                      onClick={() => void saveStructureRowAmount(row)}
                                      disabled={pendingAction !== null}
                                      className="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 transition disabled:opacity-50"
                                    >
                                      Save
                                    </button>
                                    <button
                                      onClick={() => void removeStructureRow(row)}
                                      disabled={pendingAction !== null}
                                      className="rounded-md px-2 py-1 text-xs text-red-500 hover:bg-red-50 transition disabled:opacity-50"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                            {structureRows.length === 0 && !selectedStructureId && (
                              <EmptyRow colSpan={4} message="Select a structure above to view its items." />
                            )}
                            {structureRows.length === 0 && selectedStructureId && (
                              <EmptyRow colSpan={4} message="No fee items yet. Add items using the form on the left." />
                            )}
                          </TableBody>
                        </Table>
                        {structureRows.length > 0 && (
                          <div className="border-t border-slate-100 bg-slate-50 px-4 py-2 text-right text-sm font-semibold text-slate-700">
                            Structure Total: {formatKes(structureTotal)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </SectionCard>

            {/* Step 5 — Scholarships */}
            <SectionCard
              step={5}
              stepLabel="Create Scholarships (Optional)"
              title="Scholarships & Discounts"
              description="Define scholarships or discounts that can be applied when generating student invoices."
            >
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">New Scholarship</p>
                  <div className="space-y-3">
                    <FormField label="Scholarship Name" required>
                      <Input
                        placeholder="e.g. Bursary Award, Staff Discount"
                        value={scholarshipForm.name}
                        onChange={(e) => setScholarshipForm((p) => ({ ...p, name: e.target.value }))}
                      />
                    </FormField>
                    <div className="grid grid-cols-2 gap-2">
                      <FormField label="Type">
                        <Select
                          value={scholarshipForm.type}
                          onValueChange={(value) => setScholarshipForm((p) => ({ ...p, type: value }))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="PERCENT">Percentage (%)</SelectItem>
                            <SelectItem value="FIXED">Fixed Amount (KES)</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormField>
                      <FormField label={scholarshipForm.type === "PERCENT" ? "Value (%)" : "Value (KES)"} required>
                        <Input
                          type="number"
                          min={0}
                          placeholder={scholarshipForm.type === "PERCENT" ? "e.g. 25" : "e.g. 5000"}
                          value={scholarshipForm.value}
                          onChange={(e) => setScholarshipForm((p) => ({ ...p, value: e.target.value }))}
                        />
                      </FormField>
                    </div>
                    <ActionButton
                      onClick={createScholarship}
                      loading={pendingAction === "create_scholarship"}
                      className="w-full"
                    >
                      + Create Scholarship
                    </ActionButton>
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Scholarships ({data.scholarships.length})
                  </p>
                  <div className="rounded-xl border border-slate-100 overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50">
                          <TableHead className="text-xs">Name</TableHead>
                          <TableHead className="text-xs">Type</TableHead>
                          <TableHead className="text-xs">Value</TableHead>
                          <TableHead className="text-xs">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.scholarships.map((sch) => (
                          <TableRow key={sch.id} className="hover:bg-slate-50">
                            <TableCell className="text-sm font-medium">{sch.name}</TableCell>
                            <TableCell>
                              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs">{sch.type}</span>
                            </TableCell>
                            <TableCell className="text-sm">
                              {sch.type === "PERCENT" ? `${sch.value}%` : formatAmount(sch.value)}
                            </TableCell>
                            <TableCell><StatusBadge active={sch.is_active} /></TableCell>
                          </TableRow>
                        ))}
                        {data.scholarships.length === 0 && (
                          <EmptyRow colSpan={4} message="No scholarships yet." />
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            </SectionCard>
          </div>
        )}

        {/* ── INVOICES SECTION ── */}
        {showInvoices && (
          <div className="space-y-5">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <SummaryCard label="Total Billed" value={formatKes(totals.total)} sub={`${data.invoices.length} invoices`} color="blue" />
              <SummaryCard label="Collected" value={formatKes(totals.paid)} color="emerald" />
              <SummaryCard label="Outstanding" value={formatKes(totals.balance)} sub={`${outstandingInvoices.length} unpaid`} color="amber" />
              <SummaryCard label="Enrollments" value={String(data.enrollments.length)} color="blue" />
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              {/* Fees Invoice */}
              <SectionCard title="Generate School Fees Invoice" description="Creates an invoice for a student based on their class fee structure.">
                <div className="space-y-3">
                  <FormField label="Student Enrollment" required>
                    <Select
                      value={feesInvoiceForm.enrollment_id || "__none__"}
                      onValueChange={(value) => setFeesInvoiceForm((p) => ({ ...p, enrollment_id: value === "__none__" ? "" : value }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select student enrollment" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Select student…</SelectItem>
                        {data.enrollments.map((enrollment) => (
                          <SelectItem key={enrollment.id} value={enrollment.id}>
                            {enrollmentName(enrollment.payload || {})}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="Class Code" hint="Auto-filled if available from enrollment" required>
                      <Input
                        placeholder="e.g. GRADE_7"
                        value={feesInvoiceForm.class_code}
                        onChange={(e) => setFeesInvoiceForm((p) => ({ ...p, class_code: e.target.value }))}
                      />
                    </FormField>
                    <FormField label="Scholarship" hint="Optional discount to apply">
                      <Select
                        value={feesInvoiceForm.scholarship_id || "__none__"}
                        onValueChange={(value) => setFeesInvoiceForm((p) => ({ ...p, scholarship_id: value === "__none__" ? "" : value }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="None" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">No scholarship</SelectItem>
                          {data.scholarships.map((sch) => (
                            <SelectItem key={sch.id} value={sch.id}>{sch.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                  </div>
                  <ActionButton
                    onClick={generateFeesInvoice}
                    loading={pendingAction === "generate_fees_invoice"}
                    loadingText="Generating…"
                    className="w-full"
                  >
                    Generate School Fees Invoice
                  </ActionButton>
                </div>
              </SectionCard>

              {/* Interview Invoice */}
              <SectionCard title="Create Interview Invoice" description="One-off invoice for admission interview processing fee.">
                <div className="space-y-3">
                  <FormField label="Student Enrollment" required>
                    <Select
                      value={interviewInvoiceForm.enrollment_id || "__none__"}
                      onValueChange={(value) => setInterviewInvoiceForm((p) => ({ ...p, enrollment_id: value === "__none__" ? "" : value }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select student enrollment" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Select student…</SelectItem>
                        {data.enrollments.map((enrollment) => (
                          <SelectItem key={enrollment.id} value={enrollment.id}>
                            {enrollmentName(enrollment.payload || {})}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="Description">
                      <Input
                        placeholder="Interview fee"
                        value={interviewInvoiceForm.description}
                        onChange={(e) => setInterviewInvoiceForm((p) => ({ ...p, description: e.target.value }))}
                      />
                    </FormField>
                    <FormField label="Amount (KES)" required>
                      <Input
                        type="number"
                        min={0}
                        placeholder="e.g. 2000"
                        value={interviewInvoiceForm.amount}
                        onChange={(e) => setInterviewInvoiceForm((p) => ({ ...p, amount: e.target.value }))}
                      />
                    </FormField>
                  </div>
                  <ActionButton
                    onClick={createInterviewInvoice}
                    loading={pendingAction === "create_invoice"}
                    loadingText="Creating…"
                    className="w-full"
                  >
                    Create Interview Invoice
                  </ActionButton>
                </div>
              </SectionCard>
            </div>

            {/* Invoice Table */}
            <SectionCard title="All Invoices">
              <div className="rounded-xl border border-slate-100 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs">Student</TableHead>
                      <TableHead className="text-xs">Type</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs text-right">Total</TableHead>
                      <TableHead className="text-xs text-right">Paid</TableHead>
                      <TableHead className="text-xs text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.invoices.slice(0, 25).map((invoice) => {
                      const enrollment = data.enrollments.find((r) => r.id === invoice.enrollment_id);
                      return (
                        <TableRow key={invoice.id} className="hover:bg-slate-50">
                          <TableCell className="text-sm font-medium">
                            {enrollment ? enrollmentName(enrollment.payload || {}) : "N/A"}
                          </TableCell>
                          <TableCell>
                            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                              {invoice.invoice_type}
                            </span>
                          </TableCell>
                          <TableCell><InvoiceStatusBadge status={invoice.status} /></TableCell>
                          <TableCell className="text-right text-sm">{formatAmount(invoice.total_amount)}</TableCell>
                          <TableCell className="text-right text-sm text-emerald-700">{formatAmount(invoice.paid_amount)}</TableCell>
                          <TableCell className="text-right text-sm font-medium text-red-600">{formatAmount(invoice.balance_amount)}</TableCell>
                        </TableRow>
                      );
                    })}
                    {data.invoices.length === 0 && <EmptyRow colSpan={6} message="No invoices yet." />}
                  </TableBody>
                </Table>
              </div>
            </SectionCard>
          </div>
        )}

        {/* ── PAYMENTS SECTION ── */}
        {showPayments && (
          <div className="space-y-5">
            <SectionCard title="Record a Payment" description="Capture a payment and allocate it against outstanding invoices.">
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Payment details */}
                <div className="space-y-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Payment Details</p>
                  <FormField label="Filter by Student (optional)">
                    <Select
                      value={paymentEnrollmentId || "__none__"}
                      onValueChange={(value) => setPaymentEnrollmentId(value === "__none__" ? "" : value)}
                    >
                      <SelectTrigger><SelectValue placeholder="All students" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">All students</SelectItem>
                        {data.enrollments.map((enrollment) => (
                          <SelectItem key={enrollment.id} value={enrollment.id}>
                            {enrollmentName(enrollment.payload || {})}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                  <div className="grid grid-cols-3 gap-3">
                    <FormField label="Payment Method" required>
                      <Select
                        value={paymentForm.provider}
                        onValueChange={(value) => setPaymentForm((p) => ({ ...p, provider: value }))}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="CASH">💵 Cash</SelectItem>
                          <SelectItem value="MPESA">📱 M-Pesa</SelectItem>
                          <SelectItem value="BANK">🏦 Bank</SelectItem>
                          <SelectItem value="CHEQUE">📝 Cheque</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormField>
                    <FormField label="Reference / Transaction ID">
                      <Input
                        placeholder="e.g. QJKL2X3"
                        value={paymentForm.reference}
                        onChange={(e) => setPaymentForm((p) => ({ ...p, reference: e.target.value }))}
                      />
                    </FormField>
                    <FormField label="Total Amount (KES)" required>
                      <Input
                        type="number"
                        min={0}
                        placeholder="0.00"
                        value={paymentForm.amount}
                        onChange={(e) => setPaymentForm((p) => ({ ...p, amount: e.target.value }))}
                      />
                    </FormField>
                  </div>
                </div>

                {/* Allocations */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Allocate to Invoices</p>
                    <button
                      onClick={autoDistributePayment}
                      className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 transition"
                    >
                      Auto Distribute
                    </button>
                  </div>

                  <div className="rounded-xl border border-slate-100 overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50">
                          <TableHead className="text-xs">Invoice</TableHead>
                          <TableHead className="text-xs">Allocate (KES)</TableHead>
                          <TableHead className="text-xs"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paymentAllocations.map((row, index) => (
                          <TableRow key={index}>
                            <TableCell>
                              <Select
                                value={row.invoice_id || "__none__"}
                                onValueChange={(value) =>
                                  setPaymentAllocations((prev) =>
                                    prev.map((entry, idx) => idx === index ? { ...entry, invoice_id: value === "__none__" ? "" : value } : entry)
                                  )
                                }
                              >
                                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select invoice" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">Select invoice…</SelectItem>
                                  {paymentCandidateInvoices.map((inv) => (
                                    <SelectItem key={inv.id} value={inv.id}>
                                      {inv.invoice_type} — balance {formatAmount(inv.balance_amount)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                min={0}
                                placeholder="0.00"
                                value={row.amount}
                                onChange={(e) =>
                                  setPaymentAllocations((prev) =>
                                    prev.map((entry, idx) => idx === index ? { ...entry, amount: e.target.value } : entry)
                                  )
                                }
                                className="h-8 text-sm"
                              />
                            </TableCell>
                            <TableCell>
                              <button
                                onClick={() => setPaymentAllocations((prev) => prev.filter((_, idx) => idx !== index))}
                                className="text-xs text-red-400 hover:text-red-600"
                              >
                                ✕
                              </button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Totals check */}
                  <div className="flex items-center justify-between rounded-xl border px-4 py-2 text-sm">
                    <span className="text-slate-500">Allocation total</span>
                    <span className={`font-semibold ${paymentAllocationTotal === toNumber(paymentForm.amount) && toNumber(paymentForm.amount) > 0 ? "text-emerald-700" : "text-red-600"}`}>
                      {formatKes(paymentAllocationTotal)}
                      {toNumber(paymentForm.amount) > 0 && paymentAllocationTotal !== toNumber(paymentForm.amount) && (
                        <span className="ml-2 text-xs font-normal text-red-500">
                          (must equal {formatKes(toNumber(paymentForm.amount))})
                        </span>
                      )}
                    </span>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => setPaymentAllocations((prev) => [...prev, { invoice_id: "", amount: "" }])}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 transition"
                    >
                      + Add Row
                    </button>
                    <ActionButton
                      onClick={recordPayment}
                      loading={pendingAction === "record_payment"}
                      loadingText="Recording…"
                      className="flex-1"
                    >
                      Record Payment
                    </ActionButton>
                  </div>
                </div>
              </div>
            </SectionCard>

            {/* Payments Table */}
            <SectionCard title="Payment Records">
              <div className="rounded-xl border border-slate-100 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs">Receipt No.</TableHead>
                      <TableHead className="text-xs">Method</TableHead>
                      <TableHead className="text-xs">Reference</TableHead>
                      <TableHead className="text-xs text-right">Amount</TableHead>
                      <TableHead className="text-xs">Invoices</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.payments.slice(0, 25).map((payment) => (
                      <TableRow key={payment.id} className="hover:bg-slate-50">
                        <TableCell className="font-mono text-xs font-medium text-blue-700">
                          {String(payment.id).slice(0, 8).toUpperCase()}
                        </TableCell>
                        <TableCell>
                          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs">{payment.provider}</span>
                        </TableCell>
                        <TableCell className="text-sm text-slate-500">{payment.reference || "—"}</TableCell>
                        <TableCell className="text-right text-sm font-semibold text-emerald-700">
                          {formatAmount(payment.amount)}
                        </TableCell>
                        <TableCell className="text-sm text-slate-500">
                          {Array.isArray(payment.allocations) ? payment.allocations.length : 0} invoice{payment.allocations?.length !== 1 ? "s" : ""}
                        </TableCell>
                      </TableRow>
                    ))}
                    {data.payments.length === 0 && <EmptyRow colSpan={5} message="No payments recorded yet." />}
                  </TableBody>
                </Table>
              </div>
            </SectionCard>
          </div>
        )}

        {/* ── RECEIPTS SECTION ── */}
        {showReceipts && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <SummaryCard label="Paid Invoices" value={String(data.invoices.filter((i) => i.status.toUpperCase() === "PAID").length)} color="emerald" />
              <SummaryCard label="Total Collected" value={formatKes(totals.paid)} color="blue" />
              <SummaryCard label="Total Payments" value={String(data.payments.length)} color="blue" />
              <SummaryCard label="Outstanding" value={formatKes(totals.balance)} color="amber" />
            </div>

            <SectionCard title="Paid Invoices (Receipts)">
              <div className="rounded-xl border border-slate-100 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs">Student</TableHead>
                      <TableHead className="text-xs">Type</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs text-right">Total</TableHead>
                      <TableHead className="text-xs text-right">Paid</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.invoices
                      .filter((inv) => inv.status.toUpperCase() === "PAID")
                      .slice(0, 25)
                      .map((invoice) => {
                        const enrollment = data.enrollments.find((r) => r.id === invoice.enrollment_id);
                        return (
                          <TableRow key={invoice.id} className="hover:bg-slate-50">
                            <TableCell className="text-sm font-medium">
                              {enrollment ? enrollmentName(enrollment.payload || {}) : "N/A"}
                            </TableCell>
                            <TableCell>
                              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs">{invoice.invoice_type}</span>
                            </TableCell>
                            <TableCell><InvoiceStatusBadge status={invoice.status} /></TableCell>
                            <TableCell className="text-right text-sm">{formatAmount(invoice.total_amount)}</TableCell>
                            <TableCell className="text-right text-sm font-medium text-emerald-700">{formatAmount(invoice.paid_amount)}</TableCell>
                          </TableRow>
                        );
                      })}
                    {data.invoices.filter((i) => i.status.toUpperCase() === "PAID").length === 0 && (
                      <EmptyRow colSpan={5} message="No paid receipts yet." />
                    )}
                  </TableBody>
                </Table>
              </div>
            </SectionCard>

            <SectionCard title="Payment Records">
              <div className="rounded-xl border border-slate-100 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs">Receipt No.</TableHead>
                      <TableHead className="text-xs">Method</TableHead>
                      <TableHead className="text-xs">Reference</TableHead>
                      <TableHead className="text-xs text-right">Amount</TableHead>
                      <TableHead className="text-xs">Invoices</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.payments.slice(0, 25).map((payment) => (
                      <TableRow key={payment.id} className="hover:bg-slate-50">
                        <TableCell className="font-mono text-xs font-semibold text-blue-700">
                          {String(payment.id).slice(0, 8).toUpperCase()}
                        </TableCell>
                        <TableCell>
                          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs">{payment.provider}</span>
                        </TableCell>
                        <TableCell className="text-sm text-slate-500">{payment.reference || "—"}</TableCell>
                        <TableCell className="text-right text-sm font-semibold text-emerald-700">{formatAmount(payment.amount)}</TableCell>
                        <TableCell className="text-sm text-slate-500">
                          {Array.isArray(payment.allocations) ? payment.allocations.length : 0} invoice{payment.allocations?.length !== 1 ? "s" : ""}
                        </TableCell>
                      </TableRow>
                    ))}
                    {data.payments.length === 0 && <EmptyRow colSpan={5} message="No payments yet." />}
                  </TableBody>
                </Table>
              </div>
            </SectionCard>
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default function SecretaryFinancePage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          <p className="text-sm text-slate-500">Loading finance…</p>
        </div>
      </div>
    }>
      <SecretaryFinancePageContent />
    </Suspense>
  );
}