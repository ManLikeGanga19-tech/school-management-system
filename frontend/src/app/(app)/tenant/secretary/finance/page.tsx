"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { usePersistedState } from "@/lib/usePersistedState";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
} from "recharts";

import { AppShell } from "@/components/layout/AppShell";
import {
  secretaryFinanceHref,
  secretaryNav,
  type FinanceSection,
} from "@/components/layout/nav-config";
import { TenantPageHeader, TenantSurface } from "@/components/tenant/page-chrome";
import { Eye, FileDown, Printer, ClipboardList, AlertTriangle, CheckCircle2, X, RefreshCw, GraduationCap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { BulkGenerateInvoicesCard } from "@/components/finance/BulkGenerateInvoicesCard";
import { PublishAllDraftsCard } from "@/components/finance/PublishAllDraftsCard";
import { ApplyScholarshipDialog } from "@/components/finance/ApplyScholarshipDialog";
import type { Scholarship as ScholarshipType } from "@/components/finance/finance-utils";
import { usePaginatedTable } from "@/lib/usePaginatedTable";
import {
  TablePaginationFooter,
  TableRangeCaption,
} from "@/components/finance/TablePaginationFooter";
import { InvoicePreviewModal, type InvoicePreviewData } from "@/components/finance/InvoicePreviewModal";
import { RecordPaymentByStudent } from "@/components/finance/RecordPaymentByStudent";
import { RowActionsMenu } from "@/components/finance/RowActionsMenu";
import { EnrollmentCombobox, type EnrollmentOption } from "@/components/ui/enrollment-combobox";
import { api, apiFetchRaw } from "@/lib/api";
import { currentTermIdentity, normalizeTerms, type TenantTerm } from "@/lib/school-setup/terms";

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

type TenantClass = {
  id: string;
  code: string;
  name: string;
  is_active?: boolean;
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
  academic_year?: number | null;
  student_type?: string | null;
  /** @deprecated kept for display fallback only */
  term_code?: string;
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
  type: string; // PERCENTAGE | FIXED | FULL_WAIVER
  value: string | number;
  allocated_amount?: string | number;
  remaining_amount?: string | number;
  is_active: boolean;
  covers_carry_forward?: boolean;
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
  receipt_no?: string | null;
  provider: string;
  reference: string | null;
  amount: string | number;
  allocations: { invoice_id: string; amount: string | number }[];
  // Phase R — carry-forward touches (SETTLEMENT = prior balance paid down,
  // CREDIT_CONSUMED = available credit spent as funding).
  cf_allocations?: { amount: string; kind: string; term_label?: string | null }[];
};

// Phase R — allocation summary for the payments table: names CF
// settlements instead of showing "0 invoices" for prior-balance payments.
function paymentAllocationSummary(payment: Payment): string {
  const invCount = Array.isArray(payment.allocations) ? payment.allocations.length : 0;
  const cfSettled = (payment.cf_allocations || []).filter((c) => c.kind === "SETTLEMENT").length;
  const parts: string[] = [];
  if (invCount > 0) parts.push(`${invCount} invoice${invCount !== 1 ? "s" : ""}`);
  if (cfSettled > 0) parts.push("prior balance");
  if (parts.length === 0) return "credit forward";
  return parts.join(" + ");
}

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
  | "generate_fees_invoice_v2"
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
  fee_item_id?: string;
  tempId?: string;
  fee_item_code: string;
  fee_item_name: string;
  category_id: string;
  category_code: string;
  category_name: string;
  amount: string;
};

type KeyValueRecord = Record<string, unknown>;

type InvoiceFilterState = {
  enrollment_id: string; // "" means all
  purpose: string; // optional hint from other pages
  type: string; // "" means all
  status: string; // "" means all
  q: string; // search by student or invoice id
  outstanding_only: boolean;
};

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

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEnrollments(input: unknown): Enrollment[] {
  if (!Array.isArray(input)) return [];

  const seen = new Set<string>();
  const rows: Enrollment[] = [];

  for (const value of input) {
    const obj = asObject(value);
    if (!obj) continue;

    const id = asString(obj.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);

    rows.push({
      id,
      status: asString(obj.status),
      payload: asObject(obj.payload) || {},
    });
  }

  return rows;
}

function normalizeTenantClasses(input: unknown): TenantClass[] {
  if (!Array.isArray(input)) return [];

  const byCode = new Map<string, TenantClass>();
  for (const row of input) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const rawCode = asString(rec.code);
    if (!rawCode) continue;
    const code = rawCode.toUpperCase();

    if (!byCode.has(code)) {
      byCode.set(code, {
        id: asString(rec.id) || `class-${code.toLowerCase()}`,
        code,
        name: asString(rec.name) || code,
        is_active:
          typeof rec.is_active === "boolean" ? rec.is_active : true,
      });
    }
  }

  return Array.from(byCode.values()).sort((a, b) =>
    a.code.localeCompare(b.code)
  );
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
    payload.applicant_name,
    payload.learner_name,
    payload.student,
  ];
  for (const value of options) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>;
      const nestedName = [
        nested.name,
        nested.full_name,
        nested.student_name,
      ].find((entry) => typeof entry === "string" && entry.trim());
      if (typeof nestedName === "string") return nestedName;
    }
    if (typeof value === "string" && value.trim()) return value;
  }
  const first = typeof payload.first_name === "string" ? payload.first_name.trim() : "";
  const last = typeof payload.last_name === "string" ? payload.last_name.trim() : "";
  if (first || last) return `${first} ${last}`.trim();
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

function enrollmentTermCode(payload: Record<string, unknown>) {
  const options = [
    payload.admission_term,
    payload.term_code,
    payload.termCode,
    payload.term,
    payload.academic_term,
  ];
  for (const value of options) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizeCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "_");
}

function normalizeClassCode(value: string) {
  return value.trim().toUpperCase();
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizeInvoiceType(value: string) {
  return value.trim().toUpperCase();
}

function normalizeInvoiceStatus(value: string) {
  return value.trim().toUpperCase();
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
    <TenantSurface>
      <div className="border-b border-slate-100 px-4 py-4 sm:px-6">
        {step !== undefined && stepLabel && (
          <div className="mb-2">
            <StepBadge number={step} label={stepLabel} />
          </div>
        )}
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {description && (
          <p className="mt-0.5 text-sm text-slate-500">{description}</p>
        )}
      </div>
      <div className="p-4 sm:p-6">{children}</div>
    </TenantSurface>
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
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          active ? "bg-emerald-500" : "bg-slate-400"
        }`}
      />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function InvoiceStatusBadge({ status }: { status: string }) {
  const s = status.toUpperCase();
  const styles: Record<string, string> = {
    DRAFT: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    ISSUED: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
    PAID: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    PARTIAL: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    UNPAID: "bg-red-50 text-red-700 ring-1 ring-red-200",
    PENDING: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
    CANCELLED: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        styles[s] ?? "bg-slate-100 text-slate-600 ring-1 ring-slate-200"
      }`}
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
          <ClipboardList className="h-6 w-6 text-slate-300" />
          <span className="text-sm text-slate-400">{message}</span>
        </div>
      </TableCell>
    </TableRow>
  );
}

function ErrorRow({
  colSpan,
  message,
  onRetry,
}: {
  colSpan: number;
  message: string;
  onRetry: () => void;
}) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-10 text-center">
        <div className="flex flex-col items-center gap-2">
          <AlertTriangle className="h-6 w-6 text-amber-400" />
          <span className="text-sm text-slate-600">{message}</span>
          <button
            type="button"
            onClick={onRetry}
            className="mt-1 inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function PaginationBar({
  meta,
  loading,
  onPrev,
  onNext,
}: {
  meta: { total: number; page: number; page_size: number; pages: number };
  loading: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (meta.total === 0 && !loading) return null;
  return (
    <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-500">
      <span>
        {loading ? "Loading…" : (
          <>
            Page <strong className="text-slate-700">{meta.page}</strong> of{" "}
            <strong className="text-slate-700">{meta.pages}</strong>
            <span className="ml-2 text-slate-400">({meta.total} total)</span>
          </>
        )}
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={onPrev}
          disabled={loading || meta.page <= 1}
          className="rounded border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 transition"
        >
          ← Prev
        </button>
        <button
          onClick={onNext}
          disabled={loading || meta.page >= meta.pages}
          className="rounded border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 transition"
        >
          Next →
        </button>
      </div>
    </div>
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
          <svg
            className="h-3.5 w-3.5 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
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
      className={`flex flex-col gap-2 rounded-xl px-4 py-3 text-sm sm:flex-row sm:items-start sm:justify-between ${
        type === "error"
          ? "border border-red-200 bg-red-50 text-red-800"
          : "border border-emerald-200 bg-emerald-50 text-emerald-800"
      }`}
    >
      <div className="flex items-start gap-2">
        {type === "error" ? <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> : <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />}
        <span>{message}</span>
      </div>
      <button onClick={onDismiss} className="self-end opacity-60 hover:opacity-100 sm:ml-4 sm:self-auto">
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
  // Auto-shrink long money strings (KES 1,234,567.00 overflows the card
  // at sm breakpoints). Long values drop one size + allow soft-wrap.
  const isLongMoney = value.length > 14;
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-70">
        {label}
      </p>
      <p
        className={`mt-1 font-bold tabular-nums break-words ${
          isLongMoney ? "text-base sm:text-lg" : "text-xl"
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs opacity-60">{sub}</p>}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function SecretaryFinancePageContent() {
  const searchParams = useSearchParams();

  // Deep-link support (enterprise style):
  // If another module sends purpose/enrollment_id but forgets section,
  // we automatically land on "invoices" so the user sees what they came for.
  const sectionParam = searchParams.get("section");
  const deepLinkPurpose = (searchParams.get("purpose") || "").trim();
  const deepLinkEnrollmentId = (searchParams.get("enrollment_id") || "").trim();

  const section: FinanceSection = useMemo(() => {
    const valid =
      sectionParam === "invoices" ||
      sectionParam === "payments" ||
      sectionParam === "receipts" ||
      sectionParam === "record-payment"
        ? (sectionParam as FinanceSection)
        : null;

    if (valid) return valid;

    return "invoices";
  }, [sectionParam, deepLinkPurpose, deepLinkEnrollmentId]);

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

  // Preview & Publish modal — opens whenever a v2 fees generation succeeds
  // (and from the invoices table when a DRAFT row is opened). Holds the
  // freshly-DRAFTed invoice + a display label for the modal header.
  const [previewInvoice, setPreviewInvoice] = useState<InvoicePreviewData | null>(null);
  const [previewLabel, setPreviewLabel] = useState<string | null>(null);
  // M1: after-the-fact scholarship apply — secretary now has this action
  // per Decision 1 (Option C). The dialog handles the overpayment credit
  // preview + submission.
  const [scholarshipInvoiceTarget, setScholarshipInvoiceTarget] =
    useState<Invoice | null>(null);
  const [pendingAction, setPendingAction] = useState<FinanceAction | null>(null);
  const [loadingStructureLookups, setLoadingStructureLookups] = useState(true);
  const [tenantClasses, setTenantClasses] = useState<TenantClass[]>([]);
  const [tenantTerms, setTenantTerms] = useState<TenantTerm[]>([]);

  const [policyForm, setPolicyForm] = useState<FinancePolicy>(DEFAULT_POLICY);
  const [policyDirty, setPolicyDirty] = useState(false);

  const [categoryForm, setCategoryForm] = useState({
    code: "",
    name: "",
    is_active: true,
  });
  const [itemForm, setItemForm] = useState({
    category_id: "",
    code: "",
    name: "",
    is_active: true,
  });
  const [structureForm, setStructureForm] = useState({
    class_code: "",
    term_code: "",
    name: "",
    is_active: true,
  });
  const [editingStructureId, setEditingStructureId] = useState("");
  const [selectedStructureId, setSelectedStructureId] = useState("");
  const [structureRows, setStructureRows] = useState<StructureRowDraft[]>([]);
  const [structureAddMode, setStructureAddMode] = useState<"existing" | "new">(
    "existing"
  );
  const [structureExistingItemForm, setStructureExistingItemForm] = useState({
    fee_item_id: "",
    amount: "",
  });
  const [structureInlineItemForm, setStructureInlineItemForm] = useState({
    category_id: "",
    code: "",
    name: "",
    amount: "",
    is_active: true,
  });
  const [categoryFilter, setCategoryFilter] = useState("");
  const [itemFilter, setItemFilter] = useState("");
  const [scholarshipForm, setScholarshipForm] = useState({
    name: "",
    type: "PERCENTAGE",
    value: "",
    is_active: true,
  });
  const [feesInvoiceForm, setFeesInvoiceForm] = useState({
    enrollment_id: "",
    term_number: "1",
    academic_year: String(new Date().getFullYear()),
    scholarship_id: "",
    scholarship_amount: "",
    scholarship_reason: "",
  });
  const [interviewInvoiceForm, setInterviewInvoiceForm] = useState({
    enrollment_id: "",
    description: "Interview fee",
    amount: "",
  });
  // Enterprise-level invoice filtering (UI-only, no business logic changes)
  const [invoiceFilters, setInvoiceFilters] = usePersistedState<InvoiceFilterState>(
    "sec.finance.invoiceFilters",
    {
      enrollment_id: "",
      purpose: "",
      type: "",
      status: "",
      q: "",
      outstanding_only: false,
    }
  );

  // ── Pagination state ────────────────────────────────────────────────────────
  type PageMeta = { total: number; page: number; page_size: number; pages: number };
  const defaultMeta: PageMeta = { total: 0, page: 1, page_size: 20, pages: 1 };

  const [invoicePage, setInvoicePage] = usePersistedState("sec.finance.invoicePage", 1);
  const [invoiceMeta, setInvoiceMeta] = useState<PageMeta>(defaultMeta);
  const [pagedInvoices, setPagedInvoices] = useState<Invoice[]>([]);
  const [invoicePageLoading, setInvoicePageLoading] = useState(false);
  const [invoicePageError, setInvoicePageError] = useState<string | null>(null);

  const [paymentPage, setPaymentPage] = usePersistedState("sec.finance.paymentPage", 1);
  const [paymentMeta, setPaymentMeta] = useState<PageMeta>(defaultMeta);
  const [pagedPayments, setPagedPayments] = useState<Payment[]>([]);
  const [paymentPageLoading, setPaymentPageLoading] = useState(false);
  const [paymentPageError, setPaymentPageError] = useState<string | null>(null);

  // Payments tab AND the "Payment Records" table on the Receipts tab
  // both read from this hook. Server-side filters + URL state (pay_*).
  type PaymentFilterState = { q: string; provider: string };
  const paymentsTable = usePaginatedTable<Payment, PaymentFilterState>({
    endpoint: "/finance/payments",
    keyPrefix: "pay",
    initialFilters: { q: "", provider: "" },
    enabled: section === "payments" || section === "receipts",
  });

  const [receiptPage, setReceiptPage] = usePersistedState("sec.finance.receiptPage", 1);
  const [receiptMeta, setReceiptMeta] = useState<PageMeta>(defaultMeta);
  const [pagedReceipts, setPagedReceipts] = useState<Invoice[]>([]);
  const [receiptPageLoading, setReceiptPageLoading] = useState(false);
  const [receiptPageError, setReceiptPageError] = useState<string | null>(null);

  // Secretary receipts tab — PAID invoices via the shared hook.
  type ReceiptTableFilters = { q: string; status: string };
  const receiptsTable = usePaginatedTable<Invoice, ReceiptTableFilters>({
    endpoint: "/finance/invoices",
    keyPrefix: "rcp",
    initialFilters: { q: "", status: "PAID" },
    enabled: section === "receipts",
  });

  // Secretary invoices tab — same shared hook. Closes the previous
  // 2000-cap silent truncation. Filters mirror the director's set.
  type InvoicesTableFilters = {
    q: string; enrollment_id: string; invoice_type: string;
    status: string; outstanding_only: boolean;
  };
  const invoicesTable = usePaginatedTable<Invoice, InvoicesTableFilters>({
    endpoint: "/finance/invoices",
    keyPrefix: "inv",
    initialFilters: {
      q: "", enrollment_id: "", invoice_type: "",
      status: "", outstanding_only: false,
    },
    enabled: section === "invoices",
  });

  async function loadFinance(silent = false) {
    if (!silent) setLoading(true);
    try {
      const body = await api.get<any>("/tenants/secretary/finance", { tenantRequired: true });
      const obj = asObject(body) || {};
      const incoming: FinanceResponse = {
        policy: (asObject(obj.policy) as FinancePolicy | null) || null,
        invoices: asArray<Invoice>(obj.invoices),
        fee_categories: asArray<FeeCategory>(obj.fee_categories),
        fee_items: asArray<FeeItem>(obj.fee_items),
        fee_structures: asArray<FeeStructure>(obj.fee_structures),
        fee_structure_items:
          (asObject(obj.fee_structure_items) as Record<
            string,
            FeeStructureItem[]
          >) || {},
        scholarships: asArray<Scholarship>(obj.scholarships),
        enrollments: normalizeEnrollments(
          obj.enrollments ??
            obj.student_enrollments ??
            obj.enrollment_rows
        ),
        payments: asArray<Payment>(obj.payments),
        health: (asObject(obj.health) as Record<string, boolean>) || {},
      };

      const hasEnrollmentRefs = incoming.invoices.some((row) => Boolean(row.enrollment_id));
      if (incoming.enrollments.length === 0 && hasEnrollmentRefs) {
        try {
          const fallback = await api.get<unknown>("/enrollments/", {
            tenantRequired: true,
            noRedirect: true,
          });
          const fallbackRows = normalizeEnrollments(fallback);
          if (fallbackRows.length > 0) {
            incoming.enrollments = fallbackRows;
          }
        } catch {
          try {
            const dashboard = await api.get<unknown>("/tenants/secretary/dashboard", {
              tenantRequired: true,
              noRedirect: true,
            });
            const dashboardObj = asObject(dashboard);
            const fallbackRows = normalizeEnrollments(dashboardObj?.enrollments);
            if (fallbackRows.length > 0) {
              incoming.enrollments = fallbackRows;
            }
          } catch {
            // best-effort fallback only
          }
        }
      }

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

  // ── Paginated loaders ───────────────────────────────────────────────────────
  const loadPagedInvoices = useCallback(async (page: number, filters: InvoiceFilterState) => {
    setInvoicePageLoading(true);
    setInvoicePageError(null);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: "20" });
      if (filters.enrollment_id) params.set("enrollment_id", filters.enrollment_id);
      if (filters.type) params.set("invoice_type", filters.type);
      if (filters.status) params.set("status", filters.status);
      if (filters.outstanding_only) params.set("outstanding_only", "true");
      const res = await api.get<any>(`/finance/invoices?${params}`, { tenantRequired: true });
      setPagedInvoices(Array.isArray(res?.items) ? res.items : []);
      setInvoiceMeta(res?.meta ?? defaultMeta);
    } catch (err) {
      setInvoicePageError(
        err instanceof Error ? err.message : "Could not load invoices. Please retry."
      );
    } finally { setInvoicePageLoading(false); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadPagedPayments = useCallback(async (page: number) => {
    setPaymentPageLoading(true);
    setPaymentPageError(null);
    try {
      const res = await api.get<any>(`/finance/payments?page=${page}&page_size=20`, { tenantRequired: true });
      setPagedPayments(Array.isArray(res?.items) ? res.items : []);
      setPaymentMeta(res?.meta ?? defaultMeta);
    } catch (err) {
      setPaymentPageError(
        err instanceof Error ? err.message : "Could not load payments. Please retry."
      );
    } finally { setPaymentPageLoading(false); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadPagedReceipts = useCallback(async (page: number) => {
    setReceiptPageLoading(true);
    setReceiptPageError(null);
    try {
      const res = await api.get<any>(`/finance/invoices?page=${page}&page_size=20&status=PAID`, { tenantRequired: true });
      setPagedReceipts(Array.isArray(res?.items) ? res.items : []);
      setReceiptMeta(res?.meta ?? defaultMeta);
    } catch (err) {
      setReceiptPageError(
        err instanceof Error ? err.message : "Could not load receipts. Please retry."
      );
    } finally { setReceiptPageLoading(false); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadStructureLookups = useCallback(async () => {
    setLoadingStructureLookups(true);
    try {
      const [classesRes, termsRes] = await Promise.allSettled([
        api.get<unknown>("/tenants/classes?include_inactive=true", {
          tenantRequired: true,
          noRedirect: true,
        }),
        api.get<unknown>("/tenants/terms?include_inactive=true", {
          tenantRequired: true,
          noRedirect: true,
        }),
      ]);

      if (classesRes.status === "fulfilled") {
        setTenantClasses(normalizeTenantClasses(classesRes.value));
      } else {
        setTenantClasses([]);
      }

      if (termsRes.status === "fulfilled") {
        setTenantTerms(normalizeTerms(termsRes.value));
      } else {
        setTenantTerms([]);
      }
    } finally {
      setLoadingStructureLookups(false);
    }
  }, []);

  // Pre-fill the fees-invoice form's term/year from the tenant's current term
  // (as configured under School Setup → Terms). Runs once when terms first
  // arrive; if the secretary has already touched the form (enrollment_id set
  // or year edited), we leave their values alone. Falls back gracefully when
  // the current term hasn't been tagged with the structured identity yet.
  const termsPrefilledRef = useRef(false);
  useEffect(() => {
    if (termsPrefilledRef.current) return;
    if (tenantTerms.length === 0) return;
    const identity = currentTermIdentity(tenantTerms);
    if (!identity) return;
    termsPrefilledRef.current = true;
    setFeesInvoiceForm((p) => ({
      ...p,
      term_number: String(identity.term_number),
      academic_year: String(identity.academic_year),
    }));
  }, [tenantTerms]);

  useEffect(() => {
    void loadFinance();
    void loadStructureLookups();
    const timer = setInterval(() => void loadFinance(true), 20000);
    return () => clearInterval(timer);
  }, [loadStructureLookups]);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  useEffect(() => {
    if (notice) toast.success(notice);
  }, [notice]);

  // Reset to page 1 when invoice filters change — but not when the saved
  // filters are restored on mount (which would clobber the saved page).
  const prevInvoiceFilters = useRef(invoiceFilters);
  const invoiceResetReady = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => { invoiceResetReady.current = true; }, 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (prevInvoiceFilters.current !== invoiceFilters) {
      prevInvoiceFilters.current = invoiceFilters;
      if (invoiceResetReady.current) setInvoicePage(1);
    }
  }, [invoiceFilters, setInvoicePage]);

  // (loadPagedInvoices output is no longer rendered — invoicesTable via
  // the shared hook drives the invoices tab now. Effect removed to avoid
  // duplicate /finance/invoices round-trips.)
  useEffect(() => { void loadPagedPayments(paymentPage); },
    [paymentPage, loadPagedPayments]);
  useEffect(() => { void loadPagedReceipts(receiptPage); },
    [receiptPage, loadPagedReceipts]);

  // Apply deep-link params into filters & forms (UI only)
  useEffect(() => {
    const purpose = (searchParams.get("purpose") || "").trim();
    const enrollment_id = (searchParams.get("enrollment_id") || "").trim();

    if (!purpose && !enrollment_id) return;

    setInvoiceFilters((prev) => ({
      ...prev,
      purpose: purpose || prev.purpose,
      enrollment_id: enrollment_id || prev.enrollment_id,
      // When user comes from intake, most likely they want to see what's unpaid.
      outstanding_only: purpose ? true : prev.outstanding_only,
    }));

    // Deep-link parity with the new server-paginated invoicesTable:
    // seed its filters too so the table narrows on landing.
    invoicesTable.setFilters((prev) => ({
      ...prev,
      enrollment_id: enrollment_id || prev.enrollment_id,
      invoice_type:
        purpose === "INTERVIEW_FEE" ? "INTERVIEW" : prev.invoice_type,
      outstanding_only: purpose ? true : prev.outstanding_only,
    }));

    // Helpful autofill for operations (still UI-only)
    if (enrollment_id) {
      setInterviewInvoiceForm((p) => ({ ...p, enrollment_id }));
      setFeesInvoiceForm((p) => ({ ...p, enrollment_id }));
    }

    // Nudge the user with a contextual notice
    if (purpose === "INTERVIEW_FEE" && enrollment_id) {
      setNotice(
        `Deep link: Interview fee workflow for enrollment ${enrollment_id}. Create/locate the interview invoice, then record payment.`
      );
    }
  }, [searchParams]);

  useEffect(() => {
    if (!selectedStructureId) {
      setStructureRows([]);
      return;
    }
    const source = data.fee_structure_items[selectedStructureId] || [];

    // If optimistic fee-assign feature enabled, merge server state with local drafts/pending rows.
    const OPTIMISTIC = process.env.NEXT_PUBLIC_FEATURE_FEE_ASSIGN_OPTIMISTIC === "true";
    const serverRows: StructureRowDraft[] = source.map((item) => ({
      fee_item_id: String(item.fee_item_id || ""),
      fee_item_code: String(item.fee_item_code || ""),
      fee_item_name: String(item.fee_item_name || ""),
      category_id: String(item.category_id || ""),
      category_code: String(item.category_code || ""),
      category_name: String(item.category_name || ""),
      amount: String(item.amount ?? ""),
    }));

    if (!OPTIMISTIC) {
      setStructureRows(serverRows);
      return;
    }

    setStructureRows((local) => {
      const serverById = new Map<string, StructureRowDraft>();
      for (const s of serverRows) {
        if (s.fee_item_id) serverById.set(String(s.fee_item_id), s);
      }

      const merged: StructureRowDraft[] = [];

      // Preserve local pending rows and local edits
      for (const l of local) {
        if (l.tempId) {
          merged.push(l);
        } else if (l.fee_item_id && (!serverById.has(l.fee_item_id) || l.amount !== serverById.get(l.fee_item_id)!.amount)) {
          merged.push(l);
        } else if (l.fee_item_id && serverById.has(l.fee_item_id)) {
          serverById.delete(l.fee_item_id);
        }
      }

      // Append remaining server items
      for (const s of serverRows) {
        if (!s.fee_item_id) continue;
        if (!merged.find((r) => r.fee_item_id === s.fee_item_id)) {
          merged.push(s);
        }
      }

      return merged;
    });
  }, [selectedStructureId, data.fee_structure_items]);

  useEffect(() => {
    // No auto-fill needed for v2 form (term_number + academic_year are manually selected)
  }, [feesInvoiceForm.enrollment_id, data.enrollments]);

  async function postAction(
    action: FinanceAction,
    payload: unknown,
    successMessage: string,
    onSuccess?: () => void
  ): Promise<{ data?: unknown } | null> {
    setPendingAction(action);
    setError(null);
    setNotice(null);
    try {
      // The tenant action dispatcher returns the action's primary entity in
      // `data`; returning it lets callers (e.g. fees-invoice generate)
      // capture the new DRAFT so they can open the Preview & Publish modal.
      const resp = await api.post<{ data?: unknown }>(
        "/tenants/secretary/finance",
        { action, payload },
        { tenantRequired: true },
      );
      if (onSuccess) onSuccess();
      setNotice(successMessage);
      await loadFinance(true);
      return resp ?? null;
    } catch (err: any) {
      setError(typeof err?.message === "string" ? err.message : "Unable to reach finance service. Please try again.");
      return null;
    } finally {
      setPendingAction(null);
    }
  }

  async function openDocInTab(path: string) {
    try {
      const res = await apiFetchRaw(path, { method: "GET", tenantRequired: true });
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const tab = window.open(url, "_blank");
      if (!tab) toast.error("Pop-up blocked — allow pop-ups to print.");
      setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
    } catch {
      toast.error("Failed to open print preview.");
    }
  }

  // Print the receipt and, as a second document, the related invoice(s) so the
  // parent leaves with both the receipt and the up-to-date fee statement.
  async function printReceiptWithInvoice(payment: Payment) {
    await openDocInTab(`/finance/documents/payments/${payment.id}/print`);
    const invoiceIds = Array.from(
      new Set(
        (payment.allocations || [])
          .map((a) => String(a.invoice_id || ""))
          .filter(Boolean)
      )
    );
    for (const id of invoiceIds) {
      await openDocInTab(`/finance/documents/invoices/${id}/pdf`);
    }
  }

  const totals = useMemo(
    () =>
      data.invoices.reduce(
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

  const activeFinanceHref = secretaryFinanceHref(section);
  const showInvoices = section === "invoices";
  const showPayments = section === "payments";
  const showReceipts = section === "receipts";
  const showRecordPayment = section === "record-payment";
  // Secretary RBAC: replace money aggregates with action-oriented counts.
  // DRAFTs are the secretary's workflow signal — they're the queue waiting
  // to be reviewed and published.
  const draftInvoiceCount = data.invoices.filter(
    (inv) => (inv.status || "").toUpperCase() === "DRAFT"
  ).length;

  const selectedStructure = data.fee_structures.find(
    (s) => s.id === selectedStructureId
  );
  const structureTotal = structureRows.reduce(
    (acc, row) => acc + toNumber(row.amount),
    0
  );

  const enrollmentOptions = useMemo<EnrollmentOption[]>(() => {
    return data.enrollments.map((e) => ({
      id: e.id,
      label: enrollmentName(e.payload || {}),
      sublabel: enrollmentClassCode(e.payload || {}) || undefined,
    }));
  }, [data.enrollments]);

  // Build a fast lookup for enrollment names to speed up filters
  const enrollmentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of data.enrollments) {
      map.set(e.id, enrollmentName(e.payload || {}));
    }
    return map;
  }, [data.enrollments]);

  const invoiceById = useMemo(() => {
    const map = new Map<string, Invoice>();
    for (const inv of data.invoices) {
      map.set(inv.id, inv);
    }
    return map;
  }, [data.invoices]);

  function paymentStudentLabel(payment: Payment): string {
    // Prefer the server-resolved label (populated by /finance/payments
    // via batch student-enrichment). Fall back to the client-side
    // enrollment map so bulk-loaded contexts still render names.
    const serverLabel = (payment as { student_label?: string | null }).student_label;
    if (serverLabel && serverLabel.trim()) return serverLabel;

    if (!Array.isArray(payment.allocations) || payment.allocations.length === 0) {
      return "N/A";
    }
    const names = new Set<string>();
    for (const alloc of payment.allocations) {
      const inv = invoiceById.get(String(alloc.invoice_id || ""));
      const enrollmentId = String(inv?.enrollment_id || "");
      const studentName = enrollmentNameById.get(enrollmentId);
      if (studentName) names.add(studentName);
    }
    if (names.size === 0) return "N/A";
    if (names.size === 1) return Array.from(names)[0];
    const [first] = Array.from(names);
    return `${first} +${names.size - 1}`;
  }

  const availableInvoiceTypes = useMemo(() => {
    const set = new Set<string>();
    for (const inv of data.invoices) {
      const t = normalizeInvoiceType(inv.invoice_type || "");
      if (t) set.add(t);
    }
    return Array.from(set).sort();
  }, [data.invoices]);

  const availableInvoiceStatuses = useMemo(() => {
    const set = new Set<string>();
    for (const inv of data.invoices) {
      const s = normalizeInvoiceStatus(inv.status || "");
      if (s) set.add(s);
    }
    return Array.from(set).sort();
  }, [data.invoices]);

  // (Client-side filteredInvoices + filteredInvoiceTotals were removed:
  // invoices tab now reads from invoicesTable — server-paginated
  // /finance/invoices via the shared hook — and per G2 the secretary
  // never surfaces money aggregates.)

  const configuredClassCodes = useMemo(
    () => new Set(tenantClasses.map((row) => normalizeClassCode(row.code))),
    [tenantClasses]
  );

  const configuredTermCodes = useMemo(
    () => new Set(tenantTerms.map((row) => normalizeCode(row.code))),
    [tenantTerms]
  );

  const selectedClassMissing = useMemo(() => {
    if (!structureForm.class_code) return false;
    return !configuredClassCodes.has(
      normalizeClassCode(structureForm.class_code)
    );
  }, [configuredClassCodes, structureForm.class_code]);

  const selectedTermMissing = useMemo(() => {
    if (!structureForm.term_code) return false;
    return !configuredTermCodes.has(normalizeCode(structureForm.term_code));
  }, [configuredTermCodes, structureForm.term_code]);

  async function savePolicy() {
    await postAction(
      "update_policy",
      {
        allow_partial_enrollment: policyForm.allow_partial_enrollment,
        min_percent_to_enroll: policyForm.min_percent_to_enroll,
        min_amount_to_enroll: policyForm.min_amount_to_enroll?.trim() || null,
        require_interview_fee_before_submit:
          policyForm.require_interview_fee_before_submit,
      },
      "Finance policy updated.",
      () => setPolicyDirty(false)
    );
  }

  async function createFeeCategory() {
    const code = categoryForm.code.trim();
    const name = categoryForm.name.trim();
    if (!code || !name) {
      setError("Fee category code and name are required.");
      return;
    }
    await postAction(
      "create_fee_category",
      { code: normalizeCode(code), name, is_active: categoryForm.is_active },
      "Fee category created.",
      () => setCategoryForm({ code: "", name: "", is_active: true })
    );
  }

  async function createFeeItem() {
    const code = itemForm.code.trim();
    const name = itemForm.name.trim();
    if (!itemForm.category_id || !code || !name) {
      setError("Category, item code and item name are required.");
      return;
    }
    await postAction(
      "create_fee_item",
      {
        category_id: itemForm.category_id,
        code: normalizeCode(code),
        name,
        is_active: itemForm.is_active,
      },
      "Fee item created.",
      () => setItemForm({ category_id: "", code: "", name: "", is_active: true })
    );
  }

  async function createFeeStructure() {
    const classCode = normalizeClassCode(structureForm.class_code);
    const termCode = normalizeCode(structureForm.term_code);
    const name = structureForm.name.trim();
    if (!classCode || !termCode || !name) {
      setError("Class code, term code and structure name are required.");
      return;
    }
    if (configuredClassCodes.size === 0 || configuredTermCodes.size === 0) {
      setError(
        "Configure tenant classes and tenant terms in School Setup before creating fee structures."
      );
      return;
    }

    const editingStructure = data.fee_structures.find(
      (row) => row.id === editingStructureId
    );
    const isLegacyEditingClass =
      Boolean(editingStructure) &&
      normalizeClassCode(editingStructure?.class_code || "") === classCode;
    const isLegacyEditingTerm =
      Boolean(editingStructure) &&
      normalizeCode(editingStructure?.term_code || "") === termCode;

    if (!configuredClassCodes.has(classCode) && !isLegacyEditingClass) {
      setError("Select a class from configured School Setup classes.");
      return;
    }
    if (!configuredTermCodes.has(termCode) && !isLegacyEditingTerm) {
      setError("Select a term from configured School Setup terms.");
      return;
    }

    if (editingStructureId) {
      await postAction(
        "update_fee_structure",
        {
          structure_id: editingStructureId,
          updates: {
            class_code: classCode,
            term_code: termCode,
            name,
            is_active: structureForm.is_active,
          },
        },
        "Fee structure updated.",
        () => {
          setEditingStructureId("");
          setStructureForm({
            class_code: "",
            term_code: "",
            name: "",
            is_active: true,
          });
        }
      );
      return;
    }
    await postAction(
      "create_fee_structure",
      {
        class_code: classCode,
        term_code: termCode,
        name,
        is_active: structureForm.is_active,
      },
      "Fee structure created.",
      () =>
        setStructureForm({
          class_code: "",
          term_code: "",
          name: "",
          is_active: true,
        })
    );
  }

  async function deleteFeeStructure(structureId: string) {
    await postAction(
      "delete_fee_structure",
      { structure_id: structureId },
      "Fee structure deleted.",
      () => {
        if (selectedStructureId === structureId) {
          setSelectedStructureId("");
          setStructureRows([]);
        }
      }
    );
  }

  async function addExistingItemToStructure() {
    if (!selectedStructureId) {
      setError("Select a fee structure first.");
      return;
    }
    if (
      !structureExistingItemForm.fee_item_id ||
      !structureExistingItemForm.amount.trim()
    ) {
      setError("Fee item and amount are required.");
      return;
    }
    if (toNumber(structureExistingItemForm.amount) <= 0) {
      setError("Amount must be greater than 0.");
      return;
    }
    // Optimistic append: add a temp row so UI doesn't lose focus or reorder unexpectedly.
    const itemId = structureExistingItemForm.fee_item_id;
    const amount = structureExistingItemForm.amount.trim();
    const feeItem = data.fee_items.find((it) => it.id === itemId);
    const tempId = `temp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const tempRow: StructureRowDraft = {
      tempId,
      fee_item_code: feeItem?.code || "",
      fee_item_name: feeItem?.name || "",
      category_id: feeItem?.category_id || "",
      category_code: data.fee_categories.find((c) => c.id === feeItem?.category_id)?.code || "",
      category_name: data.fee_categories.find((c) => c.id === feeItem?.category_id)?.name || "",
      amount,
    };
    setStructureRows((prev) => [...prev, tempRow]);

    await postAction(
      "add_structure_item",
      {
        structure_id: selectedStructureId,
        item: {
          fee_item_id: itemId,
          amount,
        },
      },
      "Structure item saved.",
      () => setStructureExistingItemForm({ fee_item_id: "", amount: "" })
    );
  }

  async function addInlineItemToStructure() {
    if (!selectedStructureId) {
      setError("Select a fee structure first.");
      return;
    }
    const code = structureInlineItemForm.code.trim();
    const name = structureInlineItemForm.name.trim();
    const amount = structureInlineItemForm.amount.trim();
    if (
      !structureInlineItemForm.category_id ||
      !code ||
      !name ||
      !amount
    ) {
      setError("Category, code, name and amount are required.");
      return;
    }
    if (toNumber(amount) <= 0) {
      setError("Amount must be greater than 0.");
      return;
    }
    // Optimistic append for newly created inline item
    const tempId = `temp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const tempRow: StructureRowDraft = {
      tempId,
      fee_item_code: normalizeCode(code),
      fee_item_name: name,
      category_id: structureInlineItemForm.category_id,
      category_code: data.fee_categories.find((c) => c.id === structureInlineItemForm.category_id)?.code || "",
      category_name: data.fee_categories.find((c) => c.id === structureInlineItemForm.category_id)?.name || "",
      amount,
    };
    setStructureRows((prev) => [...prev, tempRow]);

    await postAction(
      "add_structure_item",
      {
        structure_id: selectedStructureId,
        item: {
          amount,
          fee_item: {
            category_id: structureInlineItemForm.category_id,
            code: normalizeCode(code),
            name,
            is_active: structureInlineItemForm.is_active,
          },
        },
      },
      "New fee item created and attached to structure.",
      () =>
        setStructureInlineItemForm({
          category_id: "",
          code: "",
          name: "",
          amount: "",
          is_active: true,
        })
    );
  }

  async function saveStructureRowAmount(row: StructureRowDraft) {
    if (
      !selectedStructureId ||
      !row.fee_item_id ||
      !row.amount.trim() ||
      toNumber(row.amount) <= 0
    ) {
      setError("Valid fee item and amount required.");
      return;
    }
    await postAction(
      "add_structure_item",
      {
        structure_id: selectedStructureId,
        item: { fee_item_id: row.fee_item_id, amount: row.amount.trim() },
      },
      `Updated amount for ${row.fee_item_name || row.fee_item_code}.`
    );
  }

  async function removeStructureRow(row: StructureRowDraft) {
    if (!selectedStructureId || !row.fee_item_id) {
      setError("Invalid selection.");
      return;
    }
    await postAction(
      "remove_structure_item",
      {
        structure_id: selectedStructureId,
        fee_item_id: row.fee_item_id,
      },
      `Removed ${row.fee_item_name || row.fee_item_code} from structure.`
    );
  }

  async function createScholarship() {
    const name = scholarshipForm.name.trim();
    const value = scholarshipForm.value.trim();
    if (!name || !value || toNumber(value) <= 0) {
      setError("Scholarship name and a valid value are required.");
      return;
    }
    await postAction(
      "create_scholarship",
      {
        name,
        type: scholarshipForm.type,
        value,
        is_active: scholarshipForm.is_active,
      },
      "Scholarship created.",
      () =>
        setScholarshipForm({
          name: "",
          type: "PERCENTAGE",
          value: "",
          is_active: true,
        })
    );
  }

  async function generateFeesInvoice() {
    if (!feesInvoiceForm.enrollment_id) {
      setError("Student enrollment is required.");
      return;
    }
    const termNum = parseInt(feesInvoiceForm.term_number, 10);
    if (!termNum || termNum < 1 || termNum > 3) {
      setError("Term number must be 1, 2, or 3.");
      return;
    }
    const acadYear = parseInt(feesInvoiceForm.academic_year, 10);
    if (!acadYear || acadYear < 2000) {
      setError("A valid academic year is required.");
      return;
    }

    const scholarshipSelected = Boolean(feesInvoiceForm.scholarship_id);
    const pickedSch = data.scholarships.find(
      (row) => row.id === feesInvoiceForm.scholarship_id
    );
    const amountAutoComputed =
      pickedSch?.type === "FULL_WAIVER" || pickedSch?.type === "PERCENTAGE";
    if (scholarshipSelected) {
      if (!amountAutoComputed) {
        if (!feesInvoiceForm.scholarship_amount.trim()) {
          setError("Scholarship amount is required when applying a scholarship.");
          return;
        }
        if (toNumber(feesInvoiceForm.scholarship_amount) <= 0) {
          setError("Scholarship amount must be greater than 0.");
          return;
        }
      }
      if (!feesInvoiceForm.scholarship_reason.trim()) {
        setError("Scholarship reason is required.");
        return;
      }
    }

    const resp = await postAction(
      "generate_fees_invoice_v2",
      {
        enrollment_id: feesInvoiceForm.enrollment_id,
        term_number: termNum,
        academic_year: acadYear,
        scholarship_id: feesInvoiceForm.scholarship_id || null,
        scholarship_amount:
          scholarshipSelected && !amountAutoComputed
            ? feesInvoiceForm.scholarship_amount.trim()
            : null,
        scholarship_reason: scholarshipSelected
          ? feesInvoiceForm.scholarship_reason.trim()
          : null,
      },
      "Draft invoice generated — review and publish.",
    );

    // Open Preview & Publish for the freshly-DRAFTed invoice. The tenant
    // dispatcher returns the invoice as resp.data — see _serialize_invoice
    // in tenants/routes.py.
    const created = resp?.data as InvoicePreviewData | undefined;
    if (created?.id) {
      const enrollment = data.enrollments.find(
        (e) => e.id === created.enrollment_id,
      );
      const studentName = enrollment ? enrollmentName(enrollment.payload || {}) : "";
      setPreviewLabel(studentName || null);
      setPreviewInvoice(created);
    }
  }

  async function createInterviewInvoice() {
    if (!interviewInvoiceForm.enrollment_id || !interviewInvoiceForm.amount.trim()) {
      setError("Enrollment and amount are required.");
      return;
    }
    if (toNumber(interviewInvoiceForm.amount) <= 0) {
      setError("Amount must be greater than 0.");
      return;
    }
    await postAction(
      "create_invoice",
      {
        invoice_type: "INTERVIEW",
        enrollment_id: interviewInvoiceForm.enrollment_id,
        lines: [
          {
            description: interviewInvoiceForm.description.trim() || "Interview fee",
            amount: interviewInvoiceForm.amount.trim(),
          },
        ],
      },
      "Interview invoice created.",
      () =>
        setInterviewInvoiceForm({
          enrollment_id: "",
          description: "Interview fee",
          amount: "",
        })
    );
  }

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
        <TenantPageHeader
          title="Finance Operations"
          description={`Run ${section.replace("-", " ")} activities with the same operating standard as the rest of the tenant workspace: review balances, structures, invoices, receipts, and payment activity without switching themes.`}
          badges={[{ label: "Finance desk" }]}
          metrics={[
            { label: "Invoices", value: data.invoices.length },
            // Secretary doesn't see money aggregates — DRAFTs awaiting
            // publish is the workflow signal that matters here.
            { label: "Drafts", value: draftInvoiceCount },
            { label: "Structures", value: data.fee_structures.length },
          ]}
          actions={
            <Button
              onClick={() => void loadFinance()}
              variant="outline"
              className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            >
              Refresh
            </Button>
          }
        />

        {/* ── Alerts ── */}
        {error && (
          <AlertBanner type="error" message={error} onDismiss={() => setError(null)} />
        )}
        {notice && (
          <AlertBanner type="success" message={notice} onDismiss={() => setNotice(null)} />
        )}

        {/* ── RECORD PAYMENT (by student) ── */}
        {showRecordPayment && <RecordPaymentByStudent />}

        {/* ── INVOICES SECTION ── */}
        {showInvoices && (
          <div className="space-y-5">
            {/* Summary Cards — secretary RBAC: NO money aggregates here
                (no total billed, no outstanding). Director sees those on
                their own dashboard + export. Secretary sees workflow
                signals: drafts to publish + enrollments in scope. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <SummaryCard
                label="Drafts Awaiting Publish"
                value={String(draftInvoiceCount)}
                sub={
                  draftInvoiceCount > 0
                    ? "Review and publish to issue them"
                    : "Queue clear — all invoices live"
                }
                color={draftInvoiceCount > 0 ? "amber" : "emerald"}
              />
              <SummaryCard
                label="Enrollments"
                value={String(data.enrollments.length)}
                sub={`${data.invoices.length} invoices in scope`}
                color="blue"
              />
            </div>

            {/* Bulk Generate (term-start workhorse) — kept above the
                per-student forms because at the start of a term this is the
                primary action; per-student generation is for stragglers. */}
            <BulkGenerateInvoicesCard
              classOptions={tenantClasses.map((c) => ({ code: c.code, name: c.name }))}
              onChanged={() => void loadFinance(true)}
            />

            {/* Publish-all-drafts companion — for when the generator built
                drafts in an earlier session (or one-by-one), the secretary
                doesn't want to tick checkboxes. */}
            <PublishAllDraftsCard onPublished={() => void loadFinance(true)} />

            <div className="grid gap-5 xl:grid-cols-2">
              {/* Fees Invoice */}
              <SectionCard
                title="Generate School Fees Invoice"
                description="Creates a term invoice. Student type (New/Returning) is auto-detected from their admission year."
              >
                <div className="space-y-3">
                  <FormField label="Student Enrollment" required>
                    <EnrollmentCombobox
                      options={enrollmentOptions}
                      value={feesInvoiceForm.enrollment_id}
                      onChange={(id) => setFeesInvoiceForm((p) => ({ ...p, enrollment_id: id }))}
                      placeholder="Select student…"
                    />
                  </FormField>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <FormField label="Term" hint="Which term to invoice for" required>
                      <Select
                        value={feesInvoiceForm.term_number}
                        onValueChange={(value) =>
                          setFeesInvoiceForm((p) => ({ ...p, term_number: value }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select term" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">Term 1</SelectItem>
                          <SelectItem value="2">Term 2</SelectItem>
                          <SelectItem value="3">Term 3</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormField>
                    <FormField label="Academic Year" hint="e.g. 2026" required>
                      <Input
                        type="number"
                        min={2000}
                        max={2100}
                        placeholder="e.g. 2026"
                        value={feesInvoiceForm.academic_year}
                        onChange={(e) =>
                          setFeesInvoiceForm((p) => ({ ...p, academic_year: e.target.value }))
                        }
                      />
                    </FormField>
                    <FormField label="Scholarship" hint="Optional discount to apply">
                      <Select
                        value={feesInvoiceForm.scholarship_id || "__none__"}
                        onValueChange={(value) =>
                          setFeesInvoiceForm((p) => ({
                            ...p,
                            scholarship_id: value === "__none__" ? "" : value,
                            scholarship_amount:
                              value === "__none__" ? "" : p.scholarship_amount,
                            scholarship_reason:
                              value === "__none__" ? "" : p.scholarship_reason,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="None" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">No scholarship</SelectItem>
                          {data.scholarships.map((sch) => (
                            <SelectItem key={sch.id} value={sch.id}>
                              {sch.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                  </div>
                  {feesInvoiceForm.scholarship_id && (() => {
                    const picked = data.scholarships.find(
                      (row) => row.id === feesInvoiceForm.scholarship_id
                    );
                    const isFullWaiver = picked?.type === "FULL_WAIVER";
                    const isPercentage = picked?.type === "PERCENTAGE";
                    const amountAutoComputed = isFullWaiver || isPercentage;
                    return (
                      <>
                        <div className={`grid gap-3 ${amountAutoComputed ? "" : "sm:grid-cols-2"}`}>
                          {!amountAutoComputed && (
                            <FormField
                              label="Scholarship Amount (KES)"
                              hint="Amount to apply for this specific student"
                              required
                            >
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                placeholder="e.g. 3000"
                                value={feesInvoiceForm.scholarship_amount}
                                onChange={(e) =>
                                  setFeesInvoiceForm((p) => ({
                                    ...p,
                                    scholarship_amount: e.target.value,
                                  }))
                                }
                              />
                            </FormField>
                          )}
                          <FormField
                            label="Scholarship Reason"
                            hint="Mandatory audit reason for this application"
                            required
                          >
                            <Textarea
                              rows={3}
                              placeholder="Reason for awarding this scholarship"
                              value={feesInvoiceForm.scholarship_reason}
                              onChange={(e) =>
                                setFeesInvoiceForm((p) => ({
                                  ...p,
                                  scholarship_reason: e.target.value,
                                }))
                              }
                            />
                          </FormField>
                        </div>
                        {isFullWaiver && (
                          <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-800">
                            <strong>Full Waiver</strong> — invoice will be set to{" "}
                            <strong>KES 0</strong>
                            {picked?.covers_carry_forward
                              ? " including any carry-forward arrears."
                              : " for the current term (arrears, if any, remain billed)."}
                          </div>
                        )}
                        {isPercentage && (
                          <p className="text-xs text-slate-500">
                            Auto-computed as {toNumber(picked?.value ?? 0)}% of
                            the invoice total.
                          </p>
                        )}
                        {picked?.type === "FIXED" && (
                          <p className="text-xs text-slate-500">
                            Remaining scholarship balance:{" "}
                            {formatAmount(picked?.remaining_amount)}
                          </p>
                        )}
                      </>
                    );
                  })()}
                  <p className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                    Any open balance adjustments (arrears or credits) for this
                    student are automatically rolled into a single
                    &ldquo;Arrears (Brought Forward)&rdquo; line on the new
                    invoice. To skip that, clear the adjustments first under
                    the student&apos;s Adjust Balance.
                  </p>
                  <ActionButton
                    onClick={generateFeesInvoice}
                    loading={pendingAction === "generate_fees_invoice_v2"}
                    loadingText="Generating…"
                    className="w-full"
                  >
                    Generate School Fees Invoice
                  </ActionButton>
                </div>
              </SectionCard>

              {/* Interview Invoice */}
              <SectionCard
                title="Create Interview Invoice"
                description="One-off invoice for admission interview processing fee."
              >
                <div className="space-y-3">
                  <FormField label="Student Enrollment" required>
                    <EnrollmentCombobox
                      options={enrollmentOptions}
                      value={interviewInvoiceForm.enrollment_id}
                      onChange={(id) => setInterviewInvoiceForm((p) => ({ ...p, enrollment_id: id }))}
                      placeholder="Select student…"
                    />
                  </FormField>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <FormField label="Description">
                      <Input
                        placeholder="Interview fee"
                        value={interviewInvoiceForm.description}
                        onChange={(e) =>
                          setInterviewInvoiceForm((p) => ({
                            ...p,
                            description: e.target.value,
                          }))
                        }
                      />
                    </FormField>
                    <FormField label="Amount (KES)" required>
                      <Input
                        type="number"
                        min={0}
                        placeholder="e.g. 2000"
                        value={interviewInvoiceForm.amount}
                        onChange={(e) =>
                          setInterviewInvoiceForm((p) => ({ ...p, amount: e.target.value }))
                        }
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
            <SectionCard
              title="All Invoices"
              description="Use filters to quickly locate interview fees, unpaid balances, or a specific student."
            >
              {/* Enterprise Filter Bar */}
              <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="grid gap-3 lg:grid-cols-12">
                  <div className="lg:col-span-4">
                    <FormField label="Search" hint="Student name, admission no, invoice no…">
                      <Input
                        placeholder="e.g. Achieng, ADM-0123, INV-…"
                        value={invoicesTable.filters.q}
                        onChange={(e) =>
                          invoicesTable.setFilters((p) => ({ ...p, q: e.target.value }))
                        }
                      />
                    </FormField>
                  </div>

                  <div className="lg:col-span-3">
                    <FormField label="Student (Enrollment)">
                      <EnrollmentCombobox
                        options={enrollmentOptions}
                        value={invoicesTable.filters.enrollment_id}
                        onChange={(v) => invoicesTable.setFilters((p) => ({ ...p, enrollment_id: v }))}
                        placeholder="All students"
                        allLabel="All students"
                      />
                    </FormField>
                  </div>

                  <div className="lg:col-span-2">
                    <FormField label="Type">
                      <Select
                        value={invoicesTable.filters.invoice_type || "__all__"}
                        onValueChange={(v) =>
                          invoicesTable.setFilters((p) => ({
                            ...p,
                            invoice_type: v === "__all__" ? "" : v,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="All types" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All types</SelectItem>
                          {availableInvoiceTypes.map((t) => (
                            <SelectItem key={t} value={t}>{t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                  </div>

                  <div className="lg:col-span-2">
                    <FormField label="Status">
                      <Select
                        value={invoicesTable.filters.status || "__all__"}
                        onValueChange={(v) =>
                          invoicesTable.setFilters((p) => ({
                            ...p,
                            status: v === "__all__" ? "" : v,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="All statuses" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All statuses</SelectItem>
                          {availableInvoiceStatuses.map((s) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                  </div>

                  <div className="lg:col-span-1 flex items-end">
                    <button
                      onClick={() =>
                        invoicesTable.setFilters((p) => ({
                          ...p,
                          outstanding_only: !p.outstanding_only,
                        }))
                      }
                      className={`w-full rounded-lg px-3 py-2 text-xs font-semibold transition ${
                        invoicesTable.filters.outstanding_only
                          ? "bg-amber-600 text-white hover:bg-amber-700"
                          : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {invoicesTable.filters.outstanding_only ? "Outstanding" : "All"}
                    </button>
                  </div>
                </div>

                {/* Secretary RBAC (G2 policy): NO money aggregates surfaced
                    here. Just the count + a reset. Money totals were the
                    Outstanding/Paid/Balance pills that used to live here —
                    they now show only on the director's finance dashboard. */}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200">
                    <TableRangeCaption meta={invoicesTable.meta} />
                  </span>
                  <button
                    onClick={() =>
                      invoicesTable.setFilters(() => ({
                        q: "", enrollment_id: "", invoice_type: "",
                        status: "", outstanding_only: false,
                      }))
                    }
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 transition"
                  >
                    Reset Filters
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-100 [&_table]:min-w-[640px]">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs">Student</TableHead>
                      <TableHead className="text-xs">Type</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs text-right">Total</TableHead>
                      <TableHead className="text-xs text-right">Paid</TableHead>
                      <TableHead className="text-xs text-right">Balance</TableHead>
                      <TableHead className="text-xs text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoicesTable.items.map((invoice) => {
                      const invAny = invoice as Invoice & { student_name?: string | null };
                      const enrollment = data.enrollments.find(
                        (r) => r.id === invoice.enrollment_id
                      );
                      const studentName =
                        invAny.student_name && invAny.student_name.trim()
                          ? invAny.student_name
                          : enrollment
                          ? enrollmentName(enrollment.payload || {})
                          : "N/A";
                      return (
                        <TableRow key={invoice.id} className="hover:bg-slate-50">
                          <TableCell className="text-sm font-medium">
                            {studentName}
                            {invoice.enrollment_id &&
                              invoice.enrollment_id === invoicesTable.filters.enrollment_id && (
                                <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 ring-1 ring-blue-200">
                                  Focus
                                </span>
                              )}
                          </TableCell>
                          <TableCell>
                            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                              {normalizeInvoiceType(invoice.invoice_type)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <InvoiceStatusBadge status={invoice.status} />
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {formatAmount(invoice.total_amount)}
                          </TableCell>
                          <TableCell className="text-right text-sm text-emerald-700">
                            {formatAmount(invoice.paid_amount)}
                          </TableCell>
                          <TableCell className="text-right text-sm font-medium text-red-600">
                            {formatAmount(invoice.balance_amount)}
                          </TableCell>
                          <TableCell className="text-right">
                            <RowActionsMenu
                              ariaLabel="Invoice actions"
                              actions={
                                invoice.status === "DRAFT"
                                  ? [
                                      // DRAFT: re-open the Preview & Publish
                                      // modal so the secretary can review +
                                      // publish (or close to keep saving).
                                      {
                                        key: "preview",
                                        label: "Preview & Publish",
                                        icon: <Eye />,
                                        onSelect: () => {
                                          const studentName = enrollment
                                            ? enrollmentName(enrollment.payload || {})
                                            : "";
                                          setPreviewLabel(studentName || null);
                                          setPreviewInvoice(invoice as unknown as InvoicePreviewData);
                                        },
                                      },
                                      {
                                        key: "apply-scholarship",
                                        label: "Apply scholarship",
                                        icon: <GraduationCap />,
                                        onSelect: () =>
                                          setScholarshipInvoiceTarget(invoice),
                                      },
                                    ]
                                  : [
                                      {
                                        key: "print",
                                        label: "Open PDF in new tab",
                                        icon: <Printer />,
                                        onSelect: () => {
                                          void apiFetchRaw(`/finance/documents/invoices/${invoice.id}/pdf`, { method: "GET", tenantRequired: true })
                                            .then((res) => res.blob())
                                            .then((blob) => {
                                              const tab = window.open(URL.createObjectURL(blob), "_blank");
                                              if (!tab) toast.error("Pop-up blocked — allow pop-ups to print.");
                                            })
                                            .catch(() => toast.error("Failed to open invoice PDF."));
                                        },
                                      },
                                      {
                                        key: "pdf",
                                        label: "Download PDF",
                                        icon: <FileDown />,
                                        onSelect: () => {
                                          const name = enrollment
                                            ? enrollmentName(enrollment.payload || {})
                                            : "invoice";
                                          void api.downloadFile(
                                            `/finance/documents/invoices/${invoice.id}/pdf`,
                                            `${name.replace(/\s+/g, "_")}_invoice.pdf`,
                                            { tenantRequired: true }
                                          ).catch(() => toast.error("Failed to download invoice PDF."));
                                        },
                                      },
                                      {
                                        key: "apply-scholarship",
                                        label: "Apply scholarship",
                                        icon: <GraduationCap />,
                                        onSelect: () =>
                                          setScholarshipInvoiceTarget(invoice),
                                        // Only CANCELLED blocked — PAID
                                        // invoices route the surplus to an
                                        // overpayment credit (M1 Option B).
                                        disabled: invoice.status === "CANCELLED",
                                      },
                                    ]
                              }
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}

                    {invoicesTable.items.length === 0 && !invoicesTable.loading && (
                      invoicesTable.error ? (
                        <ErrorRow
                          colSpan={7}
                          message={invoicesTable.error}
                          onRetry={() => void invoicesTable.reload()}
                        />
                      ) : (
                        <EmptyRow colSpan={7} message="No invoices match the current filters." />
                      )
                    )}
                  </TableBody>
                </Table>

                <TablePaginationFooter
                  meta={invoicesTable.meta}
                  page={invoicesTable.page}
                  pageSize={invoicesTable.pageSize}
                  loading={invoicesTable.loading}
                  onPageChange={invoicesTable.setPage}
                  onPageSizeChange={invoicesTable.setPageSize}
                />
              </div>
            </SectionCard>
          </div>
        )}

        {/* ── PAYMENTS SECTION ── */}
        {showPayments && (
          <div className="space-y-5">
            {/* Payments Table */}
            <SectionCard title="Payment Records">
              {/* Filter row — server-side search + provider. */}
              <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className="lg:col-span-2">
                  <Input
                    placeholder="Search student, admission, receipt, reference…"
                    value={paymentsTable.filters.q}
                    onChange={(e) =>
                      paymentsTable.setFilters((p) => ({ ...p, q: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <Select
                    value={paymentsTable.filters.provider || "__all__"}
                    onValueChange={(v) =>
                      paymentsTable.setFilters((p) => ({
                        ...p, provider: v === "__all__" ? "" : v,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All providers" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All providers</SelectItem>
                      {["MPESA", "CASH", "BANK", "CHEQUE", "OTHER"].map((p) => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center px-1 text-xs text-slate-500">
                  <TableRangeCaption meta={paymentsTable.meta} />
                </div>
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-100 [&_table]:min-w-[640px]">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs">Receipt No.</TableHead>
                      <TableHead className="text-xs">Student</TableHead>
                      <TableHead className="text-xs">Method</TableHead>
                      <TableHead className="text-xs">Reference</TableHead>
                      <TableHead className="text-xs text-right">Amount</TableHead>
                      <TableHead className="text-xs">Invoices</TableHead>
                      <TableHead className="text-xs text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paymentsTable.items.map((payment) => (
                      <TableRow key={payment.id} className="hover:bg-slate-50">
                        <TableCell className="font-mono text-xs font-medium text-blue-700">
                          {String(payment.id).slice(0, 8).toUpperCase()}
                        </TableCell>
                        <TableCell className="text-sm">
                          {paymentStudentLabel(payment)}
                        </TableCell>
                        <TableCell>
                          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs">
                            {payment.provider}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-slate-500">
                          {payment.reference || "—"}
                        </TableCell>
                        <TableCell className="text-right text-sm font-semibold text-emerald-700">
                          {formatAmount(payment.amount)}
                        </TableCell>
                        <TableCell className="text-sm text-slate-500">
                          {paymentAllocationSummary(payment)}
                        </TableCell>
                        <TableCell className="text-right">
                          <RowActionsMenu
                            ariaLabel="Payment actions"
                            actions={[
                              {
                                key: "print-receipt",
                                label: "Print receipt",
                                icon: <Printer />,
                                onSelect: () => void openDocInTab(
                                  `/finance/documents/payments/${payment.id}/print`
                                ),
                              },
                              {
                                key: "print-receipt-invoice",
                                label: "Print receipt + invoice",
                                icon: <Printer />,
                                onSelect: () => void printReceiptWithInvoice(payment),
                              },
                              {
                                key: "download-pdf",
                                label: "Download receipt PDF",
                                icon: <FileDown />,
                                separatorBefore: true,
                                onSelect: () => {
                                  const name =
                                    payment.receipt_no ||
                                    String(payment.id).slice(0, 8).toUpperCase();
                                  void api.downloadFile(
                                    `/finance/documents/payments/${payment.id}/pdf`,
                                    `${name}.pdf`,
                                    { tenantRequired: true }
                                  ).catch(() =>
                                    toast.error("Failed to download receipt PDF.")
                                  );
                                },
                              },
                            ]}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                    {paymentsTable.items.length === 0 && !paymentsTable.loading && (
                      paymentsTable.error ? (
                        <ErrorRow
                          colSpan={7}
                          message={paymentsTable.error}
                          onRetry={() => void paymentsTable.reload()}
                        />
                      ) : (
                        <EmptyRow colSpan={7} message="No payments recorded yet." />
                      )
                    )}
                  </TableBody>
                </Table>
                <TablePaginationFooter
                  meta={paymentsTable.meta}
                  page={paymentsTable.page}
                  pageSize={paymentsTable.pageSize}
                  loading={paymentsTable.loading}
                  onPageChange={paymentsTable.setPage}
                  onPageSizeChange={paymentsTable.setPageSize}
                />
              </div>
            </SectionCard>
          </div>
        )}

        {/* ── RECEIPTS SECTION ── */}
        {showReceipts && (
          <div className="space-y-5">
            {/* Receipt-section KPIs — secretary RBAC: no money aggregates,
                only operational counts. The Outstanding KES tile lived here
                previously; it's now director-only on the director dashboard. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <SummaryCard
                label="Paid Invoices"
                value={String(receiptMeta.total || data.invoices.filter((i) => i.status.toUpperCase() === "PAID").length)}
                color="emerald"
              />
              <SummaryCard
                label="Total Payments"
                value={String(paymentMeta.total || data.payments.length)}
                color="blue"
              />
            </div>

            <SectionCard title="Paid Invoices (Receipts)">
              <div className="mb-3 grid gap-2 sm:grid-cols-2">
                <Input
                  placeholder="Search student, admission, invoice no…"
                  value={receiptsTable.filters.q}
                  onChange={(e) =>
                    receiptsTable.setFilters((p) => ({ ...p, q: e.target.value }))
                  }
                />
                <div className="flex items-center text-xs text-slate-500">
                  <TableRangeCaption meta={receiptsTable.meta} />
                </div>
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-100 [&_table]:min-w-[640px]">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs">Student</TableHead>
                      <TableHead className="text-xs">Type</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs text-right">Total</TableHead>
                      <TableHead className="text-xs text-right">Paid</TableHead>
                      <TableHead className="text-xs text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {receiptsTable.items.map((invoice) => {
                      const invAny = invoice as Invoice & { student_name?: string | null };
                      const enrollment = data.enrollments.find((r) => r.id === invoice.enrollment_id);
                      const studentName = invAny.student_name && invAny.student_name.trim()
                        ? invAny.student_name
                        : enrollment ? enrollmentName(enrollment.payload || {}) : "N/A";
                      return (
                        <TableRow key={invoice.id} className="hover:bg-slate-50">
                          <TableCell className="text-sm font-medium">
                            {studentName}
                          </TableCell>
                          <TableCell>
                            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs">
                              {normalizeInvoiceType(invoice.invoice_type)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <InvoiceStatusBadge status={invoice.status} />
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {formatAmount(invoice.total_amount)}
                          </TableCell>
                          <TableCell className="text-right text-sm font-medium text-emerald-700">
                            {formatAmount(invoice.paid_amount)}
                          </TableCell>
                          <TableCell className="text-right">
                            <RowActionsMenu
                              ariaLabel="Invoice actions"
                              actions={[
                                {
                                  key: "print",
                                  label: "Open PDF in new tab",
                                  icon: <Printer />,
                                  onSelect: () => {
                                    void apiFetchRaw(`/finance/documents/invoices/${invoice.id}/pdf`, { method: "GET", tenantRequired: true })
                                      .then((res) => res.blob())
                                      .then((blob) => {
                                        const tab = window.open(URL.createObjectURL(blob), "_blank");
                                        if (!tab) toast.error("Pop-up blocked — allow pop-ups to print.");
                                      })
                                      .catch(() => toast.error("Failed to open invoice PDF."));
                                  },
                                },
                                {
                                  key: "pdf",
                                  label: "Download PDF",
                                  icon: <FileDown />,
                                  onSelect: () => {
                                    const name = enrollment
                                      ? enrollmentName(enrollment.payload || {})
                                      : "invoice";
                                    void api.downloadFile(
                                      `/finance/documents/invoices/${invoice.id}/pdf`,
                                      `${name.replace(/\s+/g, "_")}_invoice.pdf`,
                                      { tenantRequired: true }
                                    ).catch(() => toast.error("Failed to download invoice PDF."));
                                  },
                                },
                              ]}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {receiptsTable.items.length === 0 && !receiptsTable.loading && (
                      receiptsTable.error ? (
                        <ErrorRow
                          colSpan={6}
                          message={receiptsTable.error}
                          onRetry={() => void receiptsTable.reload()}
                        />
                      ) : (
                        <EmptyRow colSpan={6} message="No paid receipts yet." />
                      )
                    )}
                  </TableBody>
                </Table>
                <TablePaginationFooter
                  meta={receiptsTable.meta}
                  page={receiptsTable.page}
                  pageSize={receiptsTable.pageSize}
                  loading={receiptsTable.loading}
                  onPageChange={receiptsTable.setPage}
                  onPageSizeChange={receiptsTable.setPageSize}
                />
              </div>
            </SectionCard>

            <SectionCard title="Payment Records">
              <div className="overflow-x-auto rounded-xl border border-slate-100 [&_table]:min-w-[640px]">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs">Receipt No.</TableHead>
                      <TableHead className="text-xs">Student</TableHead>
                      <TableHead className="text-xs">Method</TableHead>
                      <TableHead className="text-xs">Reference</TableHead>
                      <TableHead className="text-xs text-right">Amount</TableHead>
                      <TableHead className="text-xs">Invoices</TableHead>
                      <TableHead className="text-xs text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paymentsTable.items.map((payment) => (
                      <TableRow key={payment.id} className="hover:bg-slate-50">
                        <TableCell className="font-mono text-xs font-semibold text-blue-700">
                          {String(payment.id).slice(0, 8).toUpperCase()}
                        </TableCell>
                        <TableCell className="text-sm">
                          {paymentStudentLabel(payment)}
                        </TableCell>
                        <TableCell>
                          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs">
                            {payment.provider}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-slate-500">
                          {payment.reference || "—"}
                        </TableCell>
                        <TableCell className="text-right text-sm font-semibold text-emerald-700">
                          {formatAmount(payment.amount)}
                        </TableCell>
                        <TableCell className="text-sm text-slate-500">
                          {paymentAllocationSummary(payment)}
                        </TableCell>
                        <TableCell className="text-right">
                          <RowActionsMenu
                            ariaLabel="Receipt actions"
                            actions={[
                              {
                                key: "print",
                                label: "Print receipt + invoice",
                                icon: <Printer />,
                                onSelect: () => void printReceiptWithInvoice(payment),
                              },
                              {
                                key: "pdf",
                                label: "Download receipt PDF",
                                icon: <FileDown />,
                                onSelect: () => {
                                  void api.downloadFile(
                                    `/finance/documents/payments/${payment.id}/pdf`,
                                    `receipt_${String(payment.id).slice(0, 8).toUpperCase()}.pdf`,
                                    { tenantRequired: true }
                                  ).catch(() => toast.error("Failed to download receipt PDF."));
                                },
                              },
                            ]}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                    {paymentsTable.items.length === 0 && !paymentsTable.loading && (
                      paymentsTable.error ? (
                        <ErrorRow
                          colSpan={7}
                          message={paymentsTable.error}
                          onRetry={() => void paymentsTable.reload()}
                        />
                      ) : (
                        <EmptyRow colSpan={7} message="No payments yet." />
                      )
                    )}
                  </TableBody>
                </Table>
                <TablePaginationFooter
                  meta={paymentsTable.meta}
                  page={paymentsTable.page}
                  pageSize={paymentsTable.pageSize}
                  loading={paymentsTable.loading}
                  onPageChange={paymentsTable.setPage}
                  onPageSizeChange={paymentsTable.setPageSize}
                />
              </div>
            </SectionCard>
          </div>
        )}
      </div>

      <InvoicePreviewModal
        open={!!previewInvoice}
        onOpenChange={(o) => {
          if (!o) {
            setPreviewInvoice(null);
            setPreviewLabel(null);
          }
        }}
        invoice={previewInvoice}
        studentLabel={previewLabel}
        onSaved={() => void loadFinance(true)}
      />

      {/* M1: after-the-fact scholarship apply. Backend enforces the
          scholarship budget/recipient caps + emits audit + handles
          overpayment credits when total drops below paid_amount. */}
      <ApplyScholarshipDialog
        open={scholarshipInvoiceTarget !== null}
        invoice={scholarshipInvoiceTarget}
        scholarships={data.scholarships as unknown as ScholarshipType[]}
        onClose={() => setScholarshipInvoiceTarget(null)}
        onApplied={() => {
          void loadFinance(true);
          void invoicesTable.reload();
        }}
      />
    </AppShell>
  );
}

export default function SecretaryFinancePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            <p className="text-sm text-slate-500">Loading finance…</p>
          </div>
        </div>
      }
    >
      <SecretaryFinancePageContent />
    </Suspense>
  );
}
