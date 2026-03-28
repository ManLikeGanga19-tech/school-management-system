"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
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
import { api } from "@/lib/api";
import { normalizeTerms, type TenantTerm } from "@/lib/school-setup/terms";

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
  type: string;
  value: string | number;
  allocated_amount?: string | number;
  remaining_amount?: string | number;
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
  fee_item_id?: string;
  tempId?: string;
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
    PAID: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    PARTIAL: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    UNPAID: "bg-red-50 text-red-700 ring-1 ring-red-200",
    PENDING: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
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
        <span>{type === "error" ? "⚠️" : "✅"}</span>
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
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-70">
        {label}
      </p>
      <p className="mt-1 text-xl font-bold">{value}</p>
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
      sectionParam === "receipts"
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
    type: "PERCENT",
    value: "",
    is_active: true,
  });
  const [feesInvoiceForm, setFeesInvoiceForm] = useState({
    enrollment_id: "",
    class_code: "",
    term_code: "",
    scholarship_id: "",
    scholarship_amount: "",
    scholarship_reason: "",
  });
  const [interviewInvoiceForm, setInterviewInvoiceForm] = useState({
    enrollment_id: "",
    description: "Interview fee",
    amount: "",
  });
  const [paymentForm, setPaymentForm] = useState({
    provider: "MPESA",
    reference: "",
    amount: "",
  });
  const [paymentEnrollmentId, setPaymentEnrollmentId] = useState("");
  const [paymentAllocations, setPaymentAllocations] = useState<
    PaymentAllocationDraft[]
  >([{ invoice_id: "", amount: "" }]);

  // Enterprise-level invoice filtering (UI-only, no business logic changes)
  const [invoiceFilters, setInvoiceFilters] = useState<InvoiceFilterState>({
    enrollment_id: "",
    purpose: "",
    type: "",
    status: "",
    q: "",
    outstanding_only: false,
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

    // Helpful autofill for operations (still UI-only)
    if (enrollment_id) {
      setInterviewInvoiceForm((p) => ({ ...p, enrollment_id }));
      setFeesInvoiceForm((p) => ({ ...p, enrollment_id }));
      setPaymentEnrollmentId(enrollment_id);
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
    const enrollment = data.enrollments.find(
      (row) => row.id === feesInvoiceForm.enrollment_id
    );
    if (!enrollment) return;

    const guessedClassCode = enrollmentClassCode(enrollment.payload || {});
    const guessedTermCode = enrollmentTermCode(enrollment.payload || {});
    setFeesInvoiceForm((prev) => {
      let changed = false;
      const next = { ...prev };

      if (!prev.class_code.trim() && guessedClassCode) {
        next.class_code = guessedClassCode;
        changed = true;
      }
      if (!prev.term_code.trim() && guessedTermCode) {
        next.term_code = normalizeCode(guessedTermCode);
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [feesInvoiceForm.enrollment_id, data.enrollments]);

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
      await api.post<any>("/tenants/secretary/finance", { action, payload }, { tenantRequired: true });
      if (onSuccess) onSuccess();
      setNotice(successMessage);
      await loadFinance(true);
    } catch (err: any) {
      setError(typeof err?.message === "string" ? err.message : "Unable to reach finance service. Please try again.");
    } finally {
      setPendingAction(null);
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

  const paymentCandidateInvoices = useMemo(
    () =>
      outstandingInvoices.filter((inv) =>
        paymentEnrollmentId ? inv.enrollment_id === paymentEnrollmentId : true
      ),
    [outstandingInvoices, paymentEnrollmentId]
  );

  const paymentAllocationTotal = useMemo(
    () =>
      round2(
        paymentAllocations.reduce((acc, row) => acc + toNumber(row.amount), 0)
      ),
    [paymentAllocations]
  );

  const activeFinanceHref = secretaryFinanceHref(section);
  const showInvoices = section === "invoices";
  const showPayments = section === "payments";
  const showReceipts = section === "receipts";
  const totalCollections = data.payments.reduce(
    (acc, payment) => acc + toNumber(payment.amount),
    0
  );

  const selectedStructure = data.fee_structures.find(
    (s) => s.id === selectedStructureId
  );
  const structureTotal = structureRows.reduce(
    (acc, row) => acc + toNumber(row.amount),
    0
  );

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

  const filteredInvoices = useMemo(() => {
    const q = invoiceFilters.q.trim().toLowerCase();
    const type = normalizeInvoiceType(invoiceFilters.type || "");
    const status = normalizeInvoiceStatus(invoiceFilters.status || "");
    const enrollment_id = (invoiceFilters.enrollment_id || "").trim();
    const outstandingOnly = invoiceFilters.outstanding_only;

    // Purpose can set reasonable defaults without forcing filters
    const purpose = (invoiceFilters.purpose || "").trim().toUpperCase();
    const purposeTypeHint =
      purpose === "INTERVIEW_FEE" ? "INTERVIEW" : "";

    return data.invoices
      .filter((inv) => {
        if (enrollment_id && String(inv.enrollment_id || "") !== enrollment_id)
          return false;

        if (outstandingOnly && toNumber(inv.balance_amount) <= 0) return false;

        const invType = normalizeInvoiceType(inv.invoice_type || "");
        const invStatus = normalizeInvoiceStatus(inv.status || "");

        // explicit type filter wins
        if (type && invType !== type) return false;
        // purpose hint (only if user didn't explicitly choose a type)
        if (!type && purposeTypeHint && invType !== purposeTypeHint) return false;

        if (status && invStatus !== status) return false;

        if (q) {
          const student = (enrollmentNameById.get(String(inv.enrollment_id || "")) || "").toLowerCase();
          const invId = String(inv.id || "").toLowerCase();
          const invType2 = invType.toLowerCase();
          const invStatus2 = invStatus.toLowerCase();

          return (
            student.includes(q) ||
            invId.includes(q) ||
            invType2.includes(q) ||
            invStatus2.includes(q)
          );
        }

        return true;
      })
      .sort((a, b) => {
        // Show outstanding first, then by type, then stable by id
        const ab = toNumber(a.balance_amount);
        const bb = toNumber(b.balance_amount);
        if (ab === 0 && bb > 0) return 1;
        if (ab > 0 && bb === 0) return -1;
        const at = normalizeInvoiceType(a.invoice_type || "");
        const bt = normalizeInvoiceType(b.invoice_type || "");
        if (at !== bt) return at.localeCompare(bt);
        return String(b.id).localeCompare(String(a.id));
      });
  }, [data.invoices, invoiceFilters, enrollmentNameById]);

  const filteredInvoiceTotals = useMemo(() => {
    return filteredInvoices.reduce(
      (acc, inv) => {
        acc.total += toNumber(inv.total_amount);
        acc.paid += toNumber(inv.paid_amount);
        acc.balance += toNumber(inv.balance_amount);
        return acc;
      },
      { total: 0, paid: 0, balance: 0 }
    );
  }, [filteredInvoices]);

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
          type: "PERCENT",
          value: "",
          is_active: true,
        })
    );
  }

  async function generateFeesInvoice() {
    if (!feesInvoiceForm.enrollment_id || !feesInvoiceForm.class_code.trim()) {
      setError("Enrollment and class code are required.");
      return;
    }

    const scholarshipSelected = Boolean(feesInvoiceForm.scholarship_id);
    if (scholarshipSelected) {
      if (!feesInvoiceForm.scholarship_amount.trim()) {
        setError("Scholarship amount is required when applying a scholarship.");
        return;
      }
      if (toNumber(feesInvoiceForm.scholarship_amount) <= 0) {
        setError("Scholarship amount must be greater than 0.");
        return;
      }
      if (!feesInvoiceForm.scholarship_reason.trim()) {
        setError("Scholarship reason is required.");
        return;
      }
    }

    await postAction(
      "generate_fees_invoice",
      {
        enrollment_id: feesInvoiceForm.enrollment_id,
        class_code: normalizeCode(feesInvoiceForm.class_code),
        term_code: feesInvoiceForm.term_code.trim()
          ? normalizeCode(feesInvoiceForm.term_code)
          : null,
        scholarship_id: feesInvoiceForm.scholarship_id || null,
        scholarship_amount: scholarshipSelected
          ? feesInvoiceForm.scholarship_amount.trim()
          : null,
        scholarship_reason: scholarshipSelected
          ? feesInvoiceForm.scholarship_reason.trim()
          : null,
      },
      "School fees invoice generated."
    );
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

  function autoDistributePayment() {
    const total = toNumber(paymentForm.amount);
    if (total <= 0) {
      setError("Enter payment amount first.");
      return;
    }
    if (paymentCandidateInvoices.length === 0) {
      setError("No outstanding invoices available.");
      return;
    }
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
    if (amount <= 0) {
      setError("Payment amount must be greater than 0.");
      return;
    }
    const allocations = paymentAllocations
      .map((row) => ({
        invoice_id: row.invoice_id.trim(),
        amount: row.amount.trim(),
      }))
      .filter((row) => row.invoice_id && row.amount);
    if (allocations.length === 0) {
      setError("Add at least one invoice allocation.");
      return;
    }
    const hasDuplicate = allocations.some(
      (row, idx) =>
        allocations.findIndex((x) => x.invoice_id === row.invoice_id) !== idx
    );
    if (hasDuplicate) {
      setError("Duplicate invoice allocations are not allowed.");
      return;
    }
    const allocationSum = round2(
      allocations.reduce((acc, row) => acc + toNumber(row.amount), 0)
    );
    if (allocationSum !== round2(amount)) {
      setError("Allocation total must equal payment amount.");
      return;
    }
    await postAction(
      "record_payment",
      {
        provider: paymentForm.provider,
        reference: paymentForm.reference.trim() || null,
        amount: paymentForm.amount.trim(),
        allocations,
      },
      "Payment recorded.",
      () => {
        setPaymentForm({ provider: "MPESA", reference: "", amount: "" });
        setPaymentAllocations([{ invoice_id: "", amount: "" }]);
      }
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
            { label: "Outstanding", value: formatKes(totals.balance) },
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

        {/* ── INVOICES SECTION ── */}
        {showInvoices && (
          <div className="space-y-5">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <SummaryCard
                label="Total Billed"
                value={formatKes(totals.total)}
                sub={`${data.invoices.length} invoices`}
                color="blue"
              />
              <SummaryCard
                label="Outstanding"
                value={formatKes(totals.balance)}
                sub={`${outstandingInvoices.length} unpaid`}
                color="amber"
              />
              <SummaryCard label="Enrollments" value={String(data.enrollments.length)} color="blue" />
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              {/* Fees Invoice */}
              <SectionCard
                title="Generate School Fees Invoice"
                description="Creates an invoice for a student based on their class fee structure."
              >
                <div className="space-y-3">
                  <FormField label="Student Enrollment" required>
                    <Select
                      value={feesInvoiceForm.enrollment_id || "__none__"}
                      onValueChange={(value) =>
                        setFeesInvoiceForm((p) => ({
                          ...p,
                          enrollment_id: value === "__none__" ? "" : value,
                        }))
                      }
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
                  <div className="grid gap-3 sm:grid-cols-3">
                    <FormField
                      label="Class Code"
                      hint="Auto-filled if available from enrollment"
                      required
                    >
                      <Input
                        placeholder="e.g. GRADE_7"
                        value={feesInvoiceForm.class_code}
                        onChange={(e) =>
                          setFeesInvoiceForm((p) => ({ ...p, class_code: e.target.value }))
                        }
                        />
                      </FormField>
                    <FormField
                      label="Term Code"
                      hint="Optional, but recommended for term-specific structures"
                    >
                      <Input
                        placeholder="e.g. TERM_1_2026"
                        value={feesInvoiceForm.term_code}
                        onChange={(e) =>
                          setFeesInvoiceForm((p) => ({ ...p, term_code: e.target.value }))
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
                  {feesInvoiceForm.scholarship_id && (
                    <div className="grid gap-3 sm:grid-cols-2">
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
                      <FormField
                        label="Scholarship Reason"
                        hint="Mandatory audit reason for this application"
                        required
                      >
                        <Textarea
                          rows={3}
                          placeholder="Reason for awarding this scholarship amount"
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
                  )}
                  {feesInvoiceForm.scholarship_id && (
                    <p className="text-xs text-slate-500">
                      Remaining scholarship balance:{" "}
                      {formatAmount(
                        data.scholarships.find(
                          (row) => row.id === feesInvoiceForm.scholarship_id
                        )?.remaining_amount
                      )}
                    </p>
                  )}
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
              <SectionCard
                title="Create Interview Invoice"
                description="One-off invoice for admission interview processing fee."
              >
                <div className="space-y-3">
                  <FormField label="Student Enrollment" required>
                    <Select
                      value={interviewInvoiceForm.enrollment_id || "__none__"}
                      onValueChange={(value) =>
                        setInterviewInvoiceForm((p) => ({
                          ...p,
                          enrollment_id: value === "__none__" ? "" : value,
                        }))
                      }
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
                    <FormField label="Search" hint="Student name, invoice id, type, status">
                      <Input
                        placeholder="e.g. Achieng, INTERVIEW, UNPAID…"
                        value={invoiceFilters.q}
                        onChange={(e) =>
                          setInvoiceFilters((p) => ({ ...p, q: e.target.value }))
                        }
                      />
                    </FormField>
                  </div>

                  <div className="lg:col-span-3">
                    <FormField label="Student (Enrollment)">
                      <Select
                        value={invoiceFilters.enrollment_id || "__all__"}
                        onValueChange={(v) =>
                          setInvoiceFilters((p) => ({
                            ...p,
                            enrollment_id: v === "__all__" ? "" : v,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="All students" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All students</SelectItem>
                          {data.enrollments.map((e) => (
                            <SelectItem key={e.id} value={e.id}>
                              {enrollmentName(e.payload || {})}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                  </div>

                  <div className="lg:col-span-2">
                    <FormField label="Type">
                      <Select
                        value={invoiceFilters.type || "__all__"}
                        onValueChange={(v) =>
                          setInvoiceFilters((p) => ({
                            ...p,
                            type: v === "__all__" ? "" : v,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="All types" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All types</SelectItem>
                          {availableInvoiceTypes.map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                  </div>

                  <div className="lg:col-span-2">
                    <FormField label="Status">
                      <Select
                        value={invoiceFilters.status || "__all__"}
                        onValueChange={(v) =>
                          setInvoiceFilters((p) => ({
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
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                  </div>

                  <div className="lg:col-span-1 flex items-end">
                    <button
                      onClick={() =>
                        setInvoiceFilters((p) => ({
                          ...p,
                          outstanding_only: !p.outstanding_only,
                        }))
                      }
                      className={`w-full rounded-lg px-3 py-2 text-xs font-semibold transition ${
                        invoiceFilters.outstanding_only
                          ? "bg-amber-600 text-white hover:bg-amber-700"
                          : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {invoiceFilters.outstanding_only ? "Outstanding" : "All"}
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200">
                      Results: <strong className="text-slate-800">{filteredInvoices.length}</strong>
                    </span>
                    <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200">
                      Total: <strong className="text-slate-800">{formatKes(filteredInvoiceTotals.total)}</strong>
                    </span>
                    <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200">
                      Paid: <strong className="text-emerald-700">{formatKes(filteredInvoiceTotals.paid)}</strong>
                    </span>
                    <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200">
                      Balance: <strong className="text-red-600">{formatKes(filteredInvoiceTotals.balance)}</strong>
                    </span>

                    {invoiceFilters.purpose && (
                      <span className="rounded-full bg-blue-50 px-3 py-1 font-semibold text-blue-700 ring-1 ring-blue-200">
                        Purpose: {invoiceFilters.purpose.toUpperCase()}
                      </span>
                    )}
                  </div>

                  <button
                    onClick={() =>
                      setInvoiceFilters({
                        enrollment_id: "",
                        purpose: "",
                        type: "",
                        status: "",
                        q: "",
                        outstanding_only: false,
                      })
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredInvoices.slice(0, 50).map((invoice) => {
                      const enrollment = data.enrollments.find(
                        (r) => r.id === invoice.enrollment_id
                      );
                      return (
                        <TableRow key={invoice.id} className="hover:bg-slate-50">
                          <TableCell className="text-sm font-medium">
                            {enrollment ? enrollmentName(enrollment.payload || {}) : "N/A"}
                            {invoice.enrollment_id &&
                              invoice.enrollment_id === invoiceFilters.enrollment_id && (
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
                        </TableRow>
                      );
                    })}

                    {filteredInvoices.length === 0 && (
                      <EmptyRow colSpan={6} message="No invoices match the current filters." />
                    )}
                  </TableBody>
                </Table>

                {filteredInvoices.length > 50 && (
                  <div className="border-t border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-500">
                    Showing first 50 results. Refine filters to narrow down the list.
                  </div>
                )}
              </div>
            </SectionCard>
          </div>
        )}

        {/* ── PAYMENTS SECTION ── */}
        {showPayments && (
          <div className="space-y-5">
            <SectionCard
              title="Record a Payment"
              description="Capture a payment and allocate it against outstanding invoices."
            >
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Payment details */}
                <div className="space-y-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Payment Details
                  </p>
                  <FormField label="Filter by Student (optional)">
                    <Select
                      value={paymentEnrollmentId || "__none__"}
                      onValueChange={(value) =>
                        setPaymentEnrollmentId(value === "__none__" ? "" : value)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="All students" />
                      </SelectTrigger>
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
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <FormField label="Payment Method" required>
                      <Select
                        value={paymentForm.provider}
                        onValueChange={(value) =>
                          setPaymentForm((p) => ({ ...p, provider: value }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
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
                        onChange={(e) =>
                          setPaymentForm((p) => ({
                            ...p,
                            reference: e.target.value,
                          }))
                        }
                      />
                    </FormField>
                    <FormField label="Total Amount (KES)" required>
                      <Input
                        type="number"
                        min={0}
                        placeholder="0.00"
                        value={paymentForm.amount}
                        onChange={(e) =>
                          setPaymentForm((p) => ({ ...p, amount: e.target.value }))
                        }
                      />
                    </FormField>
                  </div>
                </div>

                {/* Allocations */}
                <div className="space-y-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Allocate to Invoices
                    </p>
                    <button
                      onClick={autoDistributePayment}
                      className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 transition"
                    >
                      Auto Distribute
                    </button>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-slate-100 [&_table]:min-w-[640px]">
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
                                    prev.map((entry, idx) =>
                                      idx === index
                                        ? {
                                            ...entry,
                                            invoice_id: value === "__none__" ? "" : value,
                                          }
                                        : entry
                                    )
                                  )
                                }
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue placeholder="Select invoice" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">Select invoice…</SelectItem>
                                  {paymentCandidateInvoices.map((inv) => (
                                  <SelectItem key={inv.id} value={inv.id}>
                                      {(enrollmentNameById.get(String(inv.enrollment_id || "")) || "Unknown student")}
                                      {" · "}
                                      {normalizeInvoiceType(inv.invoice_type)}
                                      {" · balance "}
                                      {formatAmount(inv.balance_amount)}
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
                                    prev.map((entry, idx) =>
                                      idx === index ? { ...entry, amount: e.target.value } : entry
                                    )
                                  )
                                }
                                className="h-8 text-sm"
                              />
                            </TableCell>
                            <TableCell>
                              <button
                                onClick={() =>
                                  setPaymentAllocations((prev) =>
                                    prev.filter((_, idx) => idx !== index)
                                  )
                                }
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
                  <div className="flex flex-col gap-1 rounded-xl border px-4 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-slate-500">Allocation total</span>
                    <span
                      className={`font-semibold ${
                        paymentAllocationTotal === toNumber(paymentForm.amount) &&
                        toNumber(paymentForm.amount) > 0
                          ? "text-emerald-700"
                          : "text-red-600"
                      }`}
                    >
                      {formatKes(paymentAllocationTotal)}
                      {toNumber(paymentForm.amount) > 0 &&
                        paymentAllocationTotal !== toNumber(paymentForm.amount) && (
                          <span className="ml-2 text-xs font-normal text-red-500">
                            (must equal {formatKes(toNumber(paymentForm.amount))})
                          </span>
                        )}
                    </span>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      onClick={() =>
                        setPaymentAllocations((prev) => [
                          ...prev,
                          { invoice_id: "", amount: "" },
                        ])
                      }
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.payments.slice(0, 25).map((payment) => (
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
                          {Array.isArray(payment.allocations) ? payment.allocations.length : 0}{" "}
                          invoice{payment.allocations?.length !== 1 ? "s" : ""}
                        </TableCell>
                      </TableRow>
                    ))}
                    {data.payments.length === 0 && (
                      <EmptyRow colSpan={6} message="No payments recorded yet." />
                    )}
                  </TableBody>
                </Table>
              </div>
            </SectionCard>
          </div>
        )}

        {/* ── RECEIPTS SECTION ── */}
        {showReceipts && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard
                label="Paid Invoices"
                value={String(data.invoices.filter((i) => i.status.toUpperCase() === "PAID").length)}
                color="emerald"
              />
              <SummaryCard label="Total Collected" value={formatKes(totals.paid)} color="blue" />
              <SummaryCard label="Total Payments" value={String(data.payments.length)} color="blue" />
              <SummaryCard label="Outstanding" value={formatKes(totals.balance)} color="amber" />
            </div>

            <SectionCard title="Paid Invoices (Receipts)">
              <div className="overflow-x-auto rounded-xl border border-slate-100 [&_table]:min-w-[640px]">
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.payments.slice(0, 25).map((payment) => (
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
                          {Array.isArray(payment.allocations) ? payment.allocations.length : 0}{" "}
                          invoice{payment.allocations?.length !== 1 ? "s" : ""}
                        </TableCell>
                      </TableRow>
                    ))}
                    {data.payments.length === 0 && <EmptyRow colSpan={6} message="No payments yet." />}
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
