"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Pie, PieChart, Cell } from "recharts";
import {
  Receipt,
  CheckCircle,
  CircleDollarSign,
  FileText,
  TrendingUp,
  ShieldAlert,
  Tag,
  ListChecks,
  GraduationCap,
  Save,
  ToggleLeft,
  ToggleRight,
  BadgePercent,
  Banknote,
  Printer,
  Eye,
  Download,
} from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import {
  directorFinanceHref,
  directorNav,
  type FinanceSection,
} from "@/components/layout/nav-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { toast } from "@/components/ui/sonner";
import { api, apiFetch, apiFetchRaw } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type Policy = {
  allow_partial_enrollment: boolean;
  min_percent_to_enroll: number | null;
  min_amount_to_enroll: string | null;
  require_interview_fee_before_submit: boolean;
};

type Invoice = {
  id: string;
  invoice_no?: string | null;
  invoice_type: string;
  status: string;
  enrollment_id: string | null;
  currency?: string;
  total_amount: string | number;
  paid_amount: string | number;
  balance_amount: string | number;
  created_at?: string | null;
};

type FeeStructure = {
  id: string;
  structure_no?: string | null;
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

type StructurePolicy = {
  id: string;
  fee_structure_id: string;
  fee_item_id?: string | null;
  allow_partial_enrollment: boolean;
  min_percent_to_enroll?: number | null;
  min_amount_to_enroll?: string | null;
};

type Enrollment = {
  id: string;
  status: string;
  payload: Record<string, unknown>;
};

type PaymentAllocation = {
  invoice_id: string;
  amount: string | number;
};

type Payment = {
  id: string;
  receipt_no?: string | null;
  provider: string;
  reference: string | null;
  amount: string | number;
  allocations: PaymentAllocation[];
};

type TenantInfo = {
  tenant_id: string;
  tenant_slug: string;
  tenant_name: string;
};

type PrintProfile = {
  logo_url: string | null;
  school_header: string;
  receipt_footer: string;
  paper_size: "A4" | "THERMAL_80MM";
  currency: string;
  thermal_width_mm: number;
  qr_enabled: boolean;
};

type InvoiceFilterState = {
  q: string;
  enrollment_id: string;
  type: string;
  status: string;
  outstanding_only: boolean;
  date_from: string;
  date_to: string;
};

type PaymentFilterState = {
  q: string;
  enrollment_id: string;
  provider: string;
};

type ReceiptFilterState = {
  q: string;
  enrollment_id: string;
};

type FinancePayload = {
  policy: Policy | null;
  invoices: Invoice[];
  fee_categories: unknown[];
  fee_items: unknown[];
  fee_structures: FeeStructure[];
  fee_structure_items: Record<string, FeeStructureItem[]>;
  structure_policies: StructurePolicy[];
  scholarships: unknown[];
  enrollments: Enrollment[];
  payments: Payment[];
};

type DecoratedPayment = Payment & {
  student_names: string[];
};

// ─── Chart config ─────────────────────────────────────────────────────────────

const chartConfig = {
  paid: { label: "Collected", color: "#10b981" },
  outstanding: { label: "Outstanding", color: "#f59e0b" },
};

const PIE_COLORS = ["#10b981", "#f59e0b"];

const SECTION_TITLES: Record<FinanceSection, string> = {
  overview: "Finance Control Overview",
  "fee-structures": "Fee Structures",
  invoices: "Invoices",
  payments: "Payments",
  receipts: "Receipts",
};

const DEFAULT_PRINT_PROFILE: PrintProfile = {
  logo_url: null,
  school_header: "School Management System",
  receipt_footer: "Thank you for partnering with us.",
  paper_size: "A4",
  currency: "KES",
  thermal_width_mm: 80,
  qr_enabled: true,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toNumber(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePrintProfile(value: unknown): PrintProfile {
  const obj = asObject(value);
  if (!obj) return DEFAULT_PRINT_PROFILE;

  const paper = asString(obj.paper_size).toUpperCase();
  const thermal = Number(obj.thermal_width_mm);
  const width = Number.isFinite(thermal) ? Math.max(58, Math.min(120, thermal)) : 80;
  const currency = asString(obj.currency).toUpperCase() || "KES";

  return {
    logo_url: asString(obj.logo_url) || null,
    school_header: asString(obj.school_header) || DEFAULT_PRINT_PROFILE.school_header,
    receipt_footer: asString(obj.receipt_footer) || DEFAULT_PRINT_PROFILE.receipt_footer,
    paper_size: paper === "THERMAL_80MM" ? "THERMAL_80MM" : "A4",
    currency,
    thermal_width_mm: width,
    qr_enabled: obj.qr_enabled === undefined ? true : Boolean(obj.qr_enabled),
  };
}

function formatKes(value: number) {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 2,
  }).format(value);
}

function enrollmentName(payload: Record<string, unknown>) {
  const options = [
    payload.student_name,
    payload.studentName,
    payload.full_name,
    payload.fullName,
    payload.name,
    payload.applicant_name,
  ];
  for (const value of options) {
    if (typeof value === "string" && value.trim()) return value;
  }
  const first =
    typeof payload.first_name === "string" ? payload.first_name.trim() : "";
  const last =
    typeof payload.last_name === "string" ? payload.last_name.trim() : "";
  if (first || last) return `${first} ${last}`.trim();
  return "Unknown student";
}

function normalizeSection(value: string | null): FinanceSection {
  if (
    value === "overview" ||
    value === "fee-structures" ||
    value === "invoices" ||
    value === "payments" ||
    value === "receipts"
  ) {
    return value;
  }
  return "overview";
}

function normalizeInvoiceType(value: string) {
  return value.trim().toUpperCase();
}

function exportInvoicesCsv(
  rows: Invoice[],
  nameById: Map<string, string>,
  dateFrom: string,
  dateTo: string
) {
  const periodLabel = dateFrom || dateTo
    ? `${dateFrom || "start"}_to_${dateTo || "end"}`
    : new Date().toISOString().slice(0, 10);
  const headers = [
    "Invoice No",
    "Student",
    "Type",
    "Status",
    "Total (KES)",
    "Paid (KES)",
    "Balance (KES)",
    "Date",
  ];
  const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const body = rows.map((inv) =>
    [
      inv.invoice_no || inv.id.slice(0, 8),
      nameById.get(String(inv.enrollment_id || "")) || "—",
      inv.invoice_type,
      inv.status,
      toNumber(inv.total_amount).toFixed(2),
      toNumber(inv.paid_amount).toFixed(2),
      toNumber(inv.balance_amount).toFixed(2),
      inv.created_at ? inv.created_at.slice(0, 10) : "—",
    ]
      .map((c) => csvCell(String(c)))
      .join(",")
  );
  const content = [headers.map(csvCell).join(","), ...body].join("\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `invoices-${periodLabel}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function normalizeInvoiceStatus(value: string) {
  return value.trim().toUpperCase();
}

function isInvoiceSettled(inv: Invoice): boolean {
  return (
    normalizeInvoiceStatus(inv.status) === "PAID" ||
    toNumber(inv.balance_amount) <= 0
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function printDocument(title: string, body: string, profile: PrintProfile) {
  if (typeof window === "undefined") return;
  const isThermal = profile.paper_size === "THERMAL_80MM";
  const pageRule = isThermal
    ? `@page { size: ${profile.thermal_width_mm}mm auto; margin: 4mm; }`
    : "@page { size: A4; margin: 14mm; }";
  const bodyRule = isThermal
    ? `body { font-family: Arial, sans-serif; color: #0f172a; margin: 0; width: ${profile.thermal_width_mm}mm; }`
    : "body { font-family: Arial, sans-serif; color: #0f172a; margin: 0; }";
  const thermalOverrides = isThermal
    ? `
      .title { font-size: 15px; }
      .muted { font-size: 10px; }
      .sheet { padding: 0; }
      .header { margin-bottom: 8px; padding-bottom: 6px; }
      .grid { grid-template-columns: 1fr; gap: 4px; }
      .card { padding: 6px; margin-bottom: 8px; border-width: 1px; }
      table { font-size: 10px; }
      th, td { padding: 4px; border-color: #e5e7eb; }
      th { background: #fff; }
      .footer { font-size: 9px; margin-top: 8px; }
    `
    : "";

  const docHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      ${pageRule}
      ${bodyRule}
      .sheet { padding: 8px 0; }
      .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #cbd5e1; padding-bottom: 10px; margin-bottom: 14px; }
      .title { font-size: 20px; font-weight: 700; }
      .muted { color: #475569; font-size: 12px; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; margin-bottom: 12px; }
      .card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; margin-bottom: 12px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th, td { border: 1px solid #e2e8f0; padding: 8px; text-align: left; }
      th { background: #f8fafc; }
      .right { text-align: right; }
      .footer { margin-top: 16px; color: #64748b; font-size: 11px; }
      ${thermalOverrides}
    </style>
  </head>
  <body>
    <div class="sheet">${body}</div>
  </body>
</html>`;

  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.setAttribute("aria-hidden", "true");
  document.body.appendChild(frame);

  const cleanupFrame = () => {
    setTimeout(() => {
      if (document.body.contains(frame)) document.body.removeChild(frame);
    }, 800);
  };

  const printWithPopupFallback = () => {
    const popup = window.open("", "_blank", "noopener,noreferrer,width=1100,height=800");
    if (!popup) {
      toast.error("Unable to open print preview. Please check browser print permissions.");
      return;
    }
    popup.document.write(docHtml);
    popup.document.close();
    popup.focus();
    popup.onload = () => popup.print();
  };

  const iframeDoc = frame.contentDocument || frame.contentWindow?.document;
  if (!iframeDoc) {
    cleanupFrame();
    printWithPopupFallback();
    return;
  }

  iframeDoc.open();
  iframeDoc.write(docHtml);
  iframeDoc.close();

  let printed = false;
  const printFromFrame = () => {
    if (printed) return;
    printed = true;
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      printWithPopupFallback();
    } finally {
      cleanupFrame();
    }
  };

  frame.onload = printFromFrame;
  // Attempt immediately to preserve user-gesture compatibility in strict browsers.
  printFromFrame();
  setTimeout(printFromFrame, 120);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  color: "blue" | "emerald" | "amber" | "slate";
}) {
  const palettes = {
    blue: {
      wrap: "border-blue-100 bg-blue-50",
      icon: "bg-blue-100 text-blue-600",
      val: "text-blue-900",
      sub: "text-blue-400",
    },
    emerald: {
      wrap: "border-emerald-100 bg-emerald-50",
      icon: "bg-emerald-100 text-emerald-600",
      val: "text-emerald-900",
      sub: "text-emerald-400",
    },
    amber: {
      wrap: "border-amber-100 bg-amber-50",
      icon: "bg-amber-100 text-amber-600",
      val: "text-amber-900",
      sub: "text-amber-400",
    },
    slate: {
      wrap: "border-slate-100 bg-slate-50",
      icon: "bg-slate-100 text-slate-500",
      val: "text-slate-900",
      sub: "text-slate-400",
    },
  };
  const p = palettes[color];
  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${p.wrap}`}>
      <div className={`inline-flex rounded-xl p-2.5 ${p.icon}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className={`mt-4 text-2xl font-bold tracking-tight ${p.val}`}>
        {value}
      </div>
      <div className="mt-0.5 text-sm font-medium text-slate-600">{label}</div>
      {sub && <div className={`mt-0.5 text-xs ${p.sub}`}>{sub}</div>}
    </div>
  );
}

function PolicyToggle({
  label,
  description,
  enabled,
  onToggle,
  icon: Icon,
}: {
  label: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition ${
        enabled
          ? "border-blue-200 bg-blue-50"
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      <div
        className={`mt-0.5 rounded-lg p-1.5 ${
          enabled ? "bg-blue-100 text-blue-600" : "bg-slate-100 text-slate-400"
        }`}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1">
        <div
          className={`text-sm font-semibold ${
            enabled ? "text-blue-900" : "text-slate-700"
          }`}
        >
          {label}
        </div>
        <div className="mt-0.5 text-xs text-slate-400">{description}</div>
      </div>
      <div className="mt-0.5 shrink-0">
        {enabled ? (
          <ToggleRight className="h-5 w-5 text-blue-600" />
        ) : (
          <ToggleLeft className="h-5 w-5 text-slate-300" />
        )}
      </div>
    </button>
  );
}

function SectionCard({
  title,
  subtitle,
  icon: Icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="dashboard-surface rounded-[1.6rem]">
      <div className="border-b border-slate-100 px-6 py-4">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-slate-400" />}
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        </div>
        {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function TenantFinancePageContent() {
  const searchParams = useSearchParams();
  const section = useMemo(
    () => normalizeSection(searchParams.get("section")),
    [searchParams]
  );
  const initialInvoiceQuery = useMemo(
    () => asString(searchParams.get("q")),
    [searchParams]
  );

  const [loading, setLoading] = useState(true);
  const [tenantInfo, setTenantInfo] = useState<TenantInfo | null>(null);
  const [printProfile, setPrintProfile] = useState<PrintProfile>(DEFAULT_PRINT_PROFILE);

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [feeCategories, setFeeCategories] = useState<unknown[]>([]);
  const [feeItems, setFeeItems] = useState<unknown[]>([]);
  const [feeStructures, setFeeStructures] = useState<FeeStructure[]>([]);
  const [feeStructureItems, setFeeStructureItems] = useState<
    Record<string, FeeStructureItem[]>
  >({});
  const [structurePolicies, setStructurePolicies] = useState<StructurePolicy[]>([]);
  const [scholarships, setScholarships] = useState<unknown[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);

  const [selectedStructureId, setSelectedStructureId] = useState("");
  const [selectedPolicyFeeItemId, setSelectedPolicyFeeItemId] =
    useState("__structure__");
  const [structurePolicyDraft, setStructurePolicyDraft] = useState({
    allow_partial_enrollment: false,
    min_percent_to_enroll: null as number | null,
    min_amount_to_enroll: null as string | null,
  });

  const [invoiceFilters, setInvoiceFilters] = useState<InvoiceFilterState>({
    q: initialInvoiceQuery,
    enrollment_id: "",
    date_from: "",
    date_to: "",
    type: "",
    status: "",
    outstanding_only: false,
  });

  const [paymentFilters, setPaymentFilters] = useState<PaymentFilterState>({
    q: "",
    enrollment_id: "",
    provider: "",
  });

  const [receiptFilters, setReceiptFilters] = useState<ReceiptFilterState>({
    q: "",
    enrollment_id: "",
  });
  const [viewStructureId, setViewStructureId] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [policyDirty, setPolicyDirty] = useState(false);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const [financeRes, whoamiRes, profileRes] = await Promise.allSettled([
        api.get<unknown>("/tenants/director/finance", { tenantRequired: true }),
        api.get<unknown>("/tenants/whoami", {
          tenantRequired: true,
          noRedirect: true,
        }),
        api.get<unknown>("/tenants/print-profile", {
          tenantRequired: true,
          noRedirect: true,
        }),
      ]);

      if (financeRes.status !== "fulfilled") {
        throw financeRes.reason;
      }

      const data = (asObject(financeRes.value) || {}) as Partial<FinancePayload>;
      setPolicy((asObject(data.policy) as Policy | null) || null);
      setInvoices(asArray<Invoice>(data.invoices));
      setFeeCategories(asArray<unknown>(data.fee_categories));
      setFeeItems(asArray<unknown>(data.fee_items));
      setFeeStructures(asArray<FeeStructure>(data.fee_structures));
      setFeeStructureItems(
        (asObject(data.fee_structure_items) as Record<string, FeeStructureItem[]>) ||
          {}
      );
      setStructurePolicies(asArray<StructurePolicy>(data.structure_policies));
      setScholarships(asArray<unknown>(data.scholarships));
      setEnrollments(asArray<Enrollment>(data.enrollments));
      setPayments(asArray<Payment>(data.payments));

      if (whoamiRes.status === "fulfilled") {
        const whoami = asObject(whoamiRes.value);
        if (whoami) {
          setTenantInfo({
            tenant_id: asString(whoami.tenant_id),
            tenant_slug: asString(whoami.tenant_slug),
            tenant_name: asString(whoami.tenant_name),
          });
        }
      }

      if (profileRes.status === "fulfilled") {
        setPrintProfile(normalizePrintProfile(profileRes.value));
      } else {
        setPrintProfile(DEFAULT_PRINT_PROFILE);
      }

      setError(null);
    } catch (err: any) {
      setError(
        typeof err?.message === "string"
          ? err.message
          : "Failed to load finance data"
      );
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(true), 20000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  useEffect(() => {
    if (notice) toast.success(notice);
  }, [notice]);

  useEffect(() => {
    if (!selectedStructureId && feeStructures.length > 0) {
      setSelectedStructureId(feeStructures[0].id);
    }
    if (feeStructures.length === 0) {
      setSelectedStructureId("");
      setSelectedPolicyFeeItemId("__structure__");
    }
  }, [feeStructures, selectedStructureId]);

  useEffect(() => {
    const feeItemId =
      selectedPolicyFeeItemId === "__structure__" ? null : selectedPolicyFeeItemId;
    const current = structurePolicies.find(
      (p) =>
        p.fee_structure_id === selectedStructureId &&
        (p.fee_item_id || null) === feeItemId
    );

    setStructurePolicyDraft({
      allow_partial_enrollment: current?.allow_partial_enrollment ?? false,
      min_percent_to_enroll: current?.min_percent_to_enroll ?? null,
      min_amount_to_enroll: current?.min_amount_to_enroll ?? null,
    });
  }, [selectedStructureId, selectedPolicyFeeItemId, structurePolicies]);

  useEffect(() => {
    if (section !== "invoices") return;
    if (!initialInvoiceQuery) return;
    setInvoiceFilters((prev) =>
      prev.q === initialInvoiceQuery ? prev : { ...prev, q: initialInvoiceQuery }
    );
  }, [section, initialInvoiceQuery]);

  async function savePolicy() {
    if (!policy) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await apiFetch<Policy>("/tenants/director/finance/policy", {
        method: "PUT",
        tenantRequired: true,
        body: JSON.stringify(policy),
        headers: { "Content-Type": "application/json" },
      });
      setPolicy(updated);
      setPolicyDirty(false);
      setNotice("Finance policy saved successfully.");
    } catch (err: any) {
      setError(
        typeof err?.message === "string"
          ? err.message
          : "Failed to update policy"
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveStructurePolicy() {
    if (!selectedStructureId) {
      setError("Select a fee structure before saving policy.");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api.put(
        "/tenants/director/finance/policy/structure",
        {
          fee_structure_id: selectedStructureId,
          fee_item_id:
            selectedPolicyFeeItemId === "__structure__"
              ? null
              : selectedPolicyFeeItemId,
          allow_partial_enrollment: structurePolicyDraft.allow_partial_enrollment,
          min_percent_to_enroll: structurePolicyDraft.min_percent_to_enroll,
          min_amount_to_enroll: structurePolicyDraft.min_amount_to_enroll,
        },
        { tenantRequired: true }
      );
      await load(true);
      setNotice("Structure policy saved.");
    } catch (err: any) {
      setError(
        typeof err?.message === "string"
          ? err.message
          : "Failed to save structure policy"
      );
    } finally {
      setSaving(false);
    }
  }

  async function clearStructurePolicy() {
    if (!selectedStructureId) {
      setError("Select a fee structure before clearing policy.");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api.delete(
        "/tenants/director/finance/policy/structure",
        {
          fee_structure_id: selectedStructureId,
          fee_item_id:
            selectedPolicyFeeItemId === "__structure__"
              ? null
              : selectedPolicyFeeItemId,
        },
        { tenantRequired: true }
      );
      await load(true);
      setNotice("Structure policy cleared.");
    } catch (err: any) {
      setError(
        typeof err?.message === "string"
          ? err.message
          : "Failed to clear structure policy"
      );
    } finally {
      setSaving(false);
    }
  }

  const totals = useMemo(
    () =>
      invoices.reduce(
        (acc, inv) => {
          acc.total += toNumber(inv.total_amount);
          acc.paid += toNumber(inv.paid_amount);
          acc.balance += toNumber(inv.balance_amount);
          return acc;
        },
        { total: 0, paid: 0, balance: 0 }
      ),
    [invoices]
  );

  const collectionRate =
    totals.total > 0 ? Math.round((totals.paid / totals.total) * 100) : 0;

  const pieData = [
    { name: "paid", value: totals.paid },
    { name: "outstanding", value: totals.balance },
  ];

  const enrollmentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of enrollments) {
      map.set(row.id, enrollmentName(row.payload || {}));
    }
    return map;
  }, [enrollments]);

  const invoiceById = useMemo(() => {
    const map = new Map<string, Invoice>();
    for (const inv of invoices) {
      map.set(inv.id, inv);
    }
    return map;
  }, [invoices]);

  const selectedStructure =
    feeStructures.find((row) => row.id === selectedStructureId) || null;
  const selectedStructureItems = selectedStructure
    ? feeStructureItems[selectedStructure.id] || []
    : [];
  const viewingStructure =
    feeStructures.find((row) => row.id === viewStructureId) || null;
  const viewingStructureItems = viewingStructure
    ? feeStructureItems[viewingStructure.id] || []
    : [];

  const structureStats = useMemo(() => {
    const map = new Map<string, { itemCount: number; total: number }>();
    for (const structure of feeStructures) {
      const items = feeStructureItems[structure.id] || [];
      const total = items.reduce((sum, item) => sum + toNumber(item.amount), 0);
      map.set(structure.id, { itemCount: items.length, total });
    }
    return map;
  }, [feeStructures, feeStructureItems]);

  const hasCurrentScopePolicy = structurePolicies.some(
    (p) =>
      p.fee_structure_id === selectedStructureId &&
      (p.fee_item_id || null) ===
        (selectedPolicyFeeItemId === "__structure__"
          ? null
          : selectedPolicyFeeItemId)
  );

  const viewingStructureRows = useMemo(() => {
    return viewingStructureItems
      .slice()
      .sort((a, b) => {
        const ac = asString(a.category_code).toUpperCase();
        const bc = asString(b.category_code).toUpperCase();
        if (ac !== bc) return ac.localeCompare(bc);
        const ai = asString(a.fee_item_code).toUpperCase();
        const bi = asString(b.fee_item_code).toUpperCase();
        return ai.localeCompare(bi);
      });
  }, [viewingStructureItems]);

  const availableInvoiceTypes = useMemo(() => {
    const set = new Set<string>();
    for (const inv of invoices) {
      const type = normalizeInvoiceType(inv.invoice_type || "");
      if (type) set.add(type);
    }
    return Array.from(set).sort();
  }, [invoices]);

  const availableInvoiceStatuses = useMemo(() => {
    const set = new Set<string>();
    for (const inv of invoices) {
      const status = normalizeInvoiceStatus(inv.status || "");
      if (status) set.add(status);
    }
    return Array.from(set).sort();
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    const q = invoiceFilters.q.trim().toLowerCase();
    const type = normalizeInvoiceType(invoiceFilters.type || "");
    const status = normalizeInvoiceStatus(invoiceFilters.status || "");
    const enrollmentId = invoiceFilters.enrollment_id;
    const dateFrom = invoiceFilters.date_from;
    const dateTo = invoiceFilters.date_to;

    return invoices
      .filter((inv) => {
        if (enrollmentId && String(inv.enrollment_id || "") !== enrollmentId) {
          return false;
        }
        if (type && normalizeInvoiceType(inv.invoice_type || "") !== type) {
          return false;
        }
        if (status && normalizeInvoiceStatus(inv.status || "") !== status) {
          return false;
        }
        if (invoiceFilters.outstanding_only && toNumber(inv.balance_amount) <= 0) {
          return false;
        }
        if (inv.created_at) {
          const d = inv.created_at.slice(0, 10);
          if (dateFrom && d < dateFrom) return false;
          if (dateTo && d > dateTo) return false;
        }
        if (!q) return true;

        const student = (
          enrollmentNameById.get(String(inv.enrollment_id || "")) || ""
        ).toLowerCase();
        const hay = [
          String(inv.id || "").toLowerCase(),
          normalizeInvoiceType(inv.invoice_type || "").toLowerCase(),
          normalizeInvoiceStatus(inv.status || "").toLowerCase(),
          student,
        ];
        return hay.some((part) => part.includes(q));
      })
      .sort((a, b) => String(b.id).localeCompare(String(a.id)));
  }, [invoices, invoiceFilters, enrollmentNameById]);

  const decoratedPayments = useMemo<DecoratedPayment[]>(() => {
    return payments.map((payment) => {
      const names = new Set<string>();
      for (const alloc of payment.allocations || []) {
        const inv = invoiceById.get(String(alloc.invoice_id || ""));
        const enrollmentId = String(inv?.enrollment_id || "");
        const name = enrollmentNameById.get(enrollmentId);
        if (name) names.add(name);
      }
      return {
        ...payment,
        student_names: Array.from(names),
      };
    });
  }, [payments, invoiceById, enrollmentNameById]);

  const availablePaymentProviders = useMemo(() => {
    const set = new Set<string>();
    for (const payment of decoratedPayments) {
      const provider = asString(payment.provider).toUpperCase();
      if (provider) set.add(provider);
    }
    return Array.from(set).sort();
  }, [decoratedPayments]);

  const filteredPayments = useMemo(() => {
    const q = paymentFilters.q.trim().toLowerCase();
    const enrollmentId = paymentFilters.enrollment_id;
    const provider = asString(paymentFilters.provider).toUpperCase();

    return decoratedPayments
      .filter((payment) => {
        if (provider && asString(payment.provider).toUpperCase() !== provider) {
          return false;
        }

        const allocationInvoices = (payment.allocations || [])
          .map((alloc) => invoiceById.get(String(alloc.invoice_id || "")))
          .filter(Boolean) as Invoice[];

        if (
          enrollmentId &&
          !allocationInvoices.some(
            (inv) => String(inv.enrollment_id || "") === enrollmentId
          )
        ) {
          return false;
        }

        if (!q) return true;

        const textBlob = [
          String(payment.id || "").toLowerCase(),
          asString(payment.provider).toLowerCase(),
          asString(payment.reference).toLowerCase(),
          payment.student_names.join(" ").toLowerCase(),
          ...allocationInvoices.map((inv) => String(inv.id || "").toLowerCase()),
        ].join(" ");

        return textBlob.includes(q);
      })
      .sort((a, b) => String(b.id).localeCompare(String(a.id)));
  }, [decoratedPayments, paymentFilters, invoiceById]);

  const paidInvoices = useMemo(
    () => invoices.filter((inv) => isInvoiceSettled(inv)),
    [invoices]
  );

  const filteredReceiptInvoices = useMemo(() => {
    const q = receiptFilters.q.trim().toLowerCase();
    const enrollmentId = receiptFilters.enrollment_id;

    return paidInvoices
      .filter((inv) => {
        if (enrollmentId && String(inv.enrollment_id || "") !== enrollmentId) {
          return false;
        }
        if (!q) return true;

        const student = (
          enrollmentNameById.get(String(inv.enrollment_id || "")) || ""
        ).toLowerCase();
        const textBlob = [
          String(inv.id || "").toLowerCase(),
          normalizeInvoiceType(inv.invoice_type || "").toLowerCase(),
          student,
        ].join(" ");
        return textBlob.includes(q);
      })
      .sort((a, b) => String(b.id).localeCompare(String(a.id)));
  }, [paidInvoices, receiptFilters, enrollmentNameById]);

  const filteredReceiptPayments = useMemo(() => {
    const q = receiptFilters.q.trim().toLowerCase();
    const enrollmentId = receiptFilters.enrollment_id;

    return decoratedPayments
      .filter((payment) => {
        const paidLinkedInvoices = (payment.allocations || [])
          .map((alloc) => invoiceById.get(String(alloc.invoice_id || "")))
          .filter((inv): inv is Invoice => Boolean(inv && isInvoiceSettled(inv)));

        if (paidLinkedInvoices.length === 0) return false;

        if (
          enrollmentId &&
          !paidLinkedInvoices.some(
            (inv) => String(inv.enrollment_id || "") === enrollmentId
          )
        ) {
          return false;
        }

        if (!q) return true;

        const textBlob = [
          String(payment.id || "").toLowerCase(),
          asString(payment.provider).toLowerCase(),
          asString(payment.reference).toLowerCase(),
          payment.student_names.join(" ").toLowerCase(),
          ...paidLinkedInvoices.map((inv) => String(inv.id || "").toLowerCase()),
        ].join(" ");
        return textBlob.includes(q);
      })
      .sort((a, b) => String(b.id).localeCompare(String(a.id)));
  }, [decoratedPayments, receiptFilters, invoiceById]);

  const schoolName =
    printProfile.school_header || tenantInfo?.tenant_name || "School Management System";

  function printFeeStructure(structure: FeeStructure) {
    const items = feeStructureItems[structure.id] || [];
    const total = items.reduce((sum, item) => sum + toNumber(item.amount), 0);

    const rows =
      items.length === 0
        ? `<tr><td colspan="3">No fee items configured for this structure.</td></tr>`
        : items
            .map(
              (item) =>
                `<tr>
                  <td>${escapeHtml(item.fee_item_code || "")}</td>
                  <td>${escapeHtml(item.fee_item_name || "")}</td>
                  <td class="right">${escapeHtml(formatKes(toNumber(item.amount)))}</td>
                </tr>`
            )
            .join("");

    const body = `
      <div class="header">
        <div>
          <div class="title">Fee Structure</div>
          <div class="muted">${escapeHtml(schoolName)}</div>
        </div>
        <div class="muted">Generated: ${escapeHtml(new Date().toLocaleString())}</div>
      </div>
      <div class="card">
        <div class="grid">
          <div><strong>Document No:</strong> ${escapeHtml(structure.structure_no || "Pending")}</div>
          <div><strong>Structure Name:</strong> ${escapeHtml(structure.name)}</div>
          <div><strong>Class:</strong> ${escapeHtml(structure.class_code)}</div>
          <div><strong>Term:</strong> ${escapeHtml(structure.term_code || "GENERAL")}</div>
          <div><strong>Status:</strong> ${structure.is_active ? "Active" : "Inactive"}</div>
        </div>
      </div>
      <table>
        <thead>
          <tr><th>Item Code</th><th>Item Name</th><th class="right">Amount (KES)</th></tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr><th colspan="2" class="right">Total</th><th class="right">${escapeHtml(
            formatKes(total)
          )}</th></tr>
        </tfoot>
      </table>
      <div class="footer">${escapeHtml(printProfile.receipt_footer)}</div>
    `;

    printDocument(`Fee Structure ${structure.class_code}`, body, printProfile);
  }

  async function printEnterprisePdf(path: string) {
    try {
      const res = await apiFetchRaw(path, { method: "GET", tenantRequired: true });
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const newTab = window.open(url, "_blank");
      if (!newTab) {
        toast.error("Pop-up blocked. Please allow pop-ups to print.");
      }
      // Revoke blob URL after the browser has had time to load it
      setTimeout(() => window.URL.revokeObjectURL(url), 30_000);
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Unable to open print preview."
      );
    }
  }

  function printInvoice(invoice: Invoice) {
    void printEnterprisePdf(`/finance/documents/invoices/${invoice.id}/pdf`);
  }

  function printPaymentReceipt(payment: DecoratedPayment) {
    void printEnterprisePdf(`/finance/documents/payments/${payment.id}/pdf`);
  }

  async function downloadPdf(path: string, fallbackName: string) {
    try {
      const res = await apiFetchRaw(path, {
        method: "GET",
        tenantRequired: true,
      });
      const blob = await res.blob();
      const filename =
        res.headers.get("Content-Disposition")?.match(/filename="?([^"]+)"?/)?.[1] ||
        fallbackName;
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success("PDF download started.");
    } catch (err: any) {
      toast.error(typeof err?.message === "string" ? err.message : "Unable to download PDF");
    }
  }

  function downloadInvoicePdf(invoice: Invoice) {
    void downloadPdf(
      `/finance/documents/invoices/${invoice.id}/pdf`,
      `${invoice.invoice_no || invoice.id}.pdf`
    );
  }

  function downloadPaymentPdf(payment: DecoratedPayment) {
    void downloadPdf(
      `/finance/documents/payments/${payment.id}/pdf`,
      `${payment.receipt_no || payment.id}.pdf`
    );
  }

  function downloadStructurePdf(structure: FeeStructure) {
    void downloadPdf(
      `/finance/documents/fee-structures/${structure.id}/pdf`,
      `${structure.structure_no || structure.id}.pdf`
    );
  }

  if (loading) {
    return (
      <AppShell title="Director" nav={directorNav} activeHref={directorFinanceHref(section)}>
        <div className="flex min-h-[380px] items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            <p className="text-sm text-slate-500">Loading finance data…</p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Director" nav={directorNav} activeHref={directorFinanceHref(section)}>
      <div className="space-y-5">
        <div className="dashboard-hero rounded-[2rem] p-5 text-white shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-bold">{SECTION_TITLES[section]}</h1>
              <p className="mt-0.5 text-sm text-blue-100">
                {schoolName} · Multi-tenant finance monitoring and controls
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 backdrop-blur text-sm text-blue-100">
              <TrendingUp className="h-4 w-4 text-emerald-300" />
              <span>{collectionRate}% collected</span>
            </div>
          </div>
        </div>

        {error && (
          <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 shrink-0 text-red-500" />
              {error}
            </div>
            <button onClick={() => setError(null)} className="opacity-60 hover:opacity-100">
              ✕
            </button>
          </div>
        )}

        {notice && (
          <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 shrink-0 text-emerald-500" />
              {notice}
            </div>
            <button onClick={() => setNotice(null)} className="opacity-60 hover:opacity-100">
              ✕
            </button>
          </div>
        )}

        {section === "overview" && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Total Billed"
                value={formatKes(totals.total)}
                sub={`${invoices.length} invoice${invoices.length !== 1 ? "s" : ""}`}
                icon={Receipt}
                color="blue"
              />
              <StatCard
                label="Collected"
                value={formatKes(totals.paid)}
                sub={`${collectionRate}% collection rate`}
                icon={CheckCircle}
                color="emerald"
              />
              <StatCard
                label="Outstanding"
                value={formatKes(totals.balance)}
                sub={totals.balance > 0 ? "Pending collection" : "All clear"}
                icon={CircleDollarSign}
                color={totals.balance > 0 ? "amber" : "emerald"}
              />
              <StatCard
                label="Invoices"
                value={invoices.length}
                sub="Total in system"
                icon={FileText}
                color="slate"
              />
            </div>

            {totals.total > 0 && (
              <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <TrendingUp className="h-4 w-4 text-slate-400" />
                    Fee Collection Progress
                  </div>
                  <span className="text-sm font-bold text-slate-800">{collectionRate}%</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${collectionRate}%` }}
                  />
                </div>
                <div className="mt-2 flex justify-between text-xs text-slate-400">
                  <span>Collected {formatKes(totals.paid)}</span>
                  <span>Target {formatKes(totals.total)}</span>
                </div>
              </div>
            )}

            <div className="grid gap-5 lg:grid-cols-2">
              <SectionCard
                title="Collection Breakdown"
                subtitle="Live split between collected and outstanding fees"
                icon={TrendingUp}
              >
                {totals.total > 0 ? (
                  <div className="flex items-center gap-6">
                    <ChartContainer config={chartConfig} className="h-[220px] flex-1">
                      <PieChart>
                        <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                        <Pie
                          data={pieData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={60}
                          outerRadius={95}
                          strokeWidth={2}
                        >
                          {pieData.map((entry, index) => (
                            <Cell
                              key={entry.name}
                              fill={PIE_COLORS[index % PIE_COLORS.length]}
                            />
                          ))}
                        </Pie>
                      </PieChart>
                    </ChartContainer>

                    <div className="shrink-0 space-y-4">
                      <div>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                          Collected
                        </div>
                        <div className="mt-0.5 text-xl font-bold text-slate-800">
                          {collectionRate}%
                        </div>
                        <div className="text-xs text-slate-400">{formatKes(totals.paid)}</div>
                      </div>
                      <div>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                          Outstanding
                        </div>
                        <div className="mt-0.5 text-xl font-bold text-slate-800">
                          {100 - collectionRate}%
                        </div>
                        <div className="text-xs text-slate-400">{formatKes(totals.balance)}</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-[220px] items-center justify-center text-sm text-slate-400">
                    No invoice data yet
                  </div>
                )}

                <div className="mt-5 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4">
                  {[
                    { label: "Fee Categories", value: feeCategories.length, icon: Tag },
                    { label: "Fee Items", value: feeItems.length, icon: ListChecks },
                    { label: "Scholarships", value: scholarships.length, icon: GraduationCap },
                  ].map(({ label, value, icon: Icon }) => (
                    <div key={label} className="rounded-xl bg-slate-50 p-3 text-center">
                      <Icon className="mx-auto mb-1 h-4 w-4 text-slate-400" />
                      <div className="text-lg font-bold text-slate-800">{value}</div>
                      <div className="text-xs text-slate-400">{label}</div>
                    </div>
                  ))}
                </div>
              </SectionCard>

              <SectionCard
                title="Finance Policy"
                subtitle="Controls enrollment and fee payment rules for this institution"
                icon={ShieldAlert}
              >
                {!policy ? (
                  <div className="flex h-[200px] items-center justify-center text-sm text-slate-400">
                    Loading policy…
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* ── Global Toggles ─────────────────────────────── */}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Global Rules
                      </p>
                      <PolicyToggle
                        label="Allow Partial Enrollment (Global Fallback)"
                        description="Students can enroll after paying the minimum threshold below. Used when no structure-level policy exists."
                        enabled={policy.allow_partial_enrollment}
                        onToggle={() => {
                          setPolicy((p) =>
                            p ? { ...p, allow_partial_enrollment: !p.allow_partial_enrollment } : p
                          );
                          setPolicyDirty(true);
                        }}
                        icon={BadgePercent}
                      />

                      <PolicyToggle
                        label="Require Interview Fee Before Submit"
                        description="Intake form cannot be submitted until the interview invoice is fully paid."
                        enabled={policy.require_interview_fee_before_submit}
                        onToggle={() => {
                          setPolicy((p) =>
                            p
                              ? { ...p, require_interview_fee_before_submit: !p.require_interview_fee_before_submit }
                              : p
                          );
                          setPolicyDirty(true);
                        }}
                        icon={FileText}
                      />
                    </div>

                    {/* ── Partial Thresholds (only relevant when partial is on) ── */}
                    <div className={`space-y-3 rounded-xl border p-4 transition ${policy.allow_partial_enrollment ? "border-blue-100 bg-blue-50/40" : "border-slate-100 bg-slate-50 opacity-50"}`}>
                      <p className="text-xs font-semibold text-slate-600">
                        Minimum Payment Threshold
                        {!policy.allow_partial_enrollment && (
                          <span className="ml-2 text-slate-400 font-normal">(enable partial enrollment above to activate)</span>
                        )}
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                            <BadgePercent className="h-3.5 w-3.5 text-slate-400" />
                            Min. Percent to Enroll
                          </Label>
                          <div className="relative">
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              placeholder="e.g. 50"
                              disabled={!policy.allow_partial_enrollment}
                              value={policy.min_percent_to_enroll ?? ""}
                              onChange={(e) => {
                                setPolicy((p) =>
                                  p
                                    ? { ...p, min_percent_to_enroll: e.target.value === "" ? null : Number(e.target.value) }
                                    : p
                                );
                                setPolicyDirty(true);
                              }}
                              className="pr-8"
                            />
                            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                              %
                            </span>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                            <Banknote className="h-3.5 w-3.5 text-slate-400" />
                            Min. Amount to Enroll (KES)
                          </Label>
                          <div className="relative">
                            <Input
                              type="number"
                              min={0}
                              placeholder="e.g. 5000"
                              disabled={!policy.allow_partial_enrollment}
                              value={policy.min_amount_to_enroll ?? ""}
                              onChange={(e) => {
                                setPolicy((p) =>
                                  p
                                    ? { ...p, min_amount_to_enroll: e.target.value === "" ? null : e.target.value }
                                    : p
                                );
                                setPolicyDirty(true);
                              }}
                              className="pr-12"
                            />
                            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                              KES
                            </span>
                          </div>
                        </div>
                      </div>
                      <p className="text-xs text-slate-400">
                        A student must meet <strong>at least one</strong> of the thresholds above to be enrolled. Leave both blank to allow any partial amount.
                      </p>
                    </div>

                    <div className="border-t border-slate-100 pt-3">
                      <Button
                        onClick={savePolicy}
                        disabled={saving || !policyDirty}
                        className={`w-full ${policyDirty ? "bg-blue-600 hover:bg-blue-700" : "bg-slate-300"}`}
                      >
                        {saving ? (
                          <span className="flex items-center gap-2">Saving…</span>
                        ) : (
                          <span className="flex items-center gap-2">
                            <Save className="h-4 w-4" />
                            {policyDirty ? "Save Global Policy (unsaved changes)" : "Global Policy Saved"}
                          </span>
                        )}
                      </Button>
                    </div>

                    <div className="border-t border-slate-100 pt-4 space-y-3">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-800">
                          Structure Enrollment Policy
                        </h3>
                        <p className="text-xs text-slate-500">
                          Configure partial-enrollment rules per fee structure (class +
                          term) and optionally per fee item.
                        </p>
                      </div>

                      {feeStructures.length === 0 ? (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          No fee structures found. Ask secretary to create structures first.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="grid gap-4 lg:grid-cols-2">
                            <div className="min-w-0 space-y-1.5">
                              <Label className="text-xs font-medium text-slate-600">
                                Fee Structure
                              </Label>
                              <Select
                                value={selectedStructureId}
                                onValueChange={(v) => {
                                  setSelectedStructureId(v);
                                  setSelectedPolicyFeeItemId("__structure__");
                                }}
                              >
                                <SelectTrigger className="w-full min-w-0">
                                  <SelectValue
                                    className="truncate"
                                    placeholder="Select structure"
                                  />
                                </SelectTrigger>
                                <SelectContent>
                                  {feeStructures.map((s) => (
                                    <SelectItem
                                      key={s.id}
                                      value={s.id}
                                      className="max-w-[520px] truncate"
                                      title={`${s.class_code} · ${s.term_code || "GENERAL"} · ${s.name}`}
                                    >
                                      {s.class_code} · {s.term_code || "GENERAL"} · {s.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="min-w-0 space-y-1.5">
                              <Label className="text-xs font-medium text-slate-600">
                                Policy Scope
                              </Label>
                              <Select
                                value={selectedPolicyFeeItemId}
                                onValueChange={setSelectedPolicyFeeItemId}
                                disabled={!selectedStructure}
                              >
                                <SelectTrigger className="w-full min-w-0">
                                  <SelectValue
                                    className="truncate"
                                    placeholder="Select scope"
                                  />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem
                                    value="__structure__"
                                    title="Entire structure total"
                                  >
                                    Entire structure total
                                  </SelectItem>
                                  {selectedStructureItems.map((it) => (
                                    <SelectItem
                                      key={it.fee_item_id}
                                      value={it.fee_item_id}
                                      className="max-w-[520px] truncate"
                                      title={`${it.fee_item_code} · ${it.fee_item_name}`}
                                    >
                                      {it.fee_item_code} · {it.fee_item_name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>

                          <PolicyToggle
                            label="Allow Partial For Selected Scope"
                            description="If off, selected scope must be fully cleared before enrollment."
                            enabled={structurePolicyDraft.allow_partial_enrollment}
                            onToggle={() =>
                              setStructurePolicyDraft((p) => ({
                                ...p,
                                allow_partial_enrollment:
                                  !p.allow_partial_enrollment,
                              }))
                            }
                            icon={BadgePercent}
                          />

                          <div className={`grid gap-3 sm:grid-cols-2 rounded-lg p-3 transition ${structurePolicyDraft.allow_partial_enrollment ? "bg-blue-50/40 border border-blue-100" : "bg-slate-50 border border-slate-100 opacity-50"}`}>
                            {!structurePolicyDraft.allow_partial_enrollment && (
                              <p className="sm:col-span-2 text-xs text-slate-400">Enable partial above to set a minimum threshold for this scope.</p>
                            )}
                            <div className="space-y-1.5">
                              <Label className="text-xs font-medium text-slate-600">
                                Min. Percent For Scope
                              </Label>
                              <Input
                                type="number"
                                min={0}
                                max={100}
                                disabled={!structurePolicyDraft.allow_partial_enrollment}
                                value={structurePolicyDraft.min_percent_to_enroll ?? ""}
                                onChange={(e) =>
                                  setStructurePolicyDraft((p) => ({
                                    ...p,
                                    min_percent_to_enroll:
                                      e.target.value === ""
                                        ? null
                                        : Number(e.target.value),
                                  }))
                                }
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs font-medium text-slate-600">
                                Min. Amount For Scope (KES)
                              </Label>
                              <Input
                                type="number"
                                min={0}
                                disabled={!structurePolicyDraft.allow_partial_enrollment}
                                value={structurePolicyDraft.min_amount_to_enroll ?? ""}
                                onChange={(e) =>
                                  setStructurePolicyDraft((p) => ({
                                    ...p,
                                    min_amount_to_enroll:
                                      e.target.value === "" ? null : e.target.value,
                                  }))
                                }
                              />
                            </div>
                          </div>

                          <div className="flex gap-2">
                            <Button
                              onClick={saveStructurePolicy}
                              disabled={saving || !selectedStructureId}
                              className="flex-1 bg-blue-600 hover:bg-blue-700"
                            >
                              Save Scope Policy
                            </Button>
                            <Button
                              variant="outline"
                              onClick={clearStructurePolicy}
                              disabled={
                                saving ||
                                !selectedStructureId ||
                                !hasCurrentScopePolicy
                              }
                            >
                              Clear Scope Policy
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </SectionCard>
            </div>
          </>
        )}

        {section === "fee-structures" && (
          <SectionCard
            title="Tenant Fee Structures"
            subtitle="All structures created by the tenant secretary with totals and status"
            icon={ListChecks}
          >
            <div className="mb-4 grid gap-3 grid-cols-2 sm:grid-cols-4">
              <StatCard
                label="Structures"
                value={feeStructures.length}
                icon={ListChecks}
                color="blue"
              />
              <StatCard
                label="Active"
                value={feeStructures.filter((s) => s.is_active).length}
                icon={CheckCircle}
                color="emerald"
              />
              <StatCard
                label="Policies"
                value={structurePolicies.length}
                icon={ShieldAlert}
                color="slate"
              />
              <StatCard
                label="Item Lines"
                value={Object.values(feeStructureItems).reduce(
                  (sum, rows) => sum + rows.length,
                  0
                )}
                icon={Tag}
                color="amber"
              />
            </div>

            <div className="rounded-xl border border-slate-100 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead>Doc No</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead>Term</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Policy Scopes</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {feeStructures
                    .slice()
                    .sort((a, b) => {
                      const ac = asString(a.class_code).toUpperCase();
                      const bc = asString(b.class_code).toUpperCase();
                      if (ac !== bc) return ac.localeCompare(bc);
                      const at = asString(a.term_code || "GENERAL").toUpperCase();
                      const bt = asString(b.term_code || "GENERAL").toUpperCase();
                      if (at !== bt) return at.localeCompare(bt);
                      return asString(a.name).localeCompare(asString(b.name));
                    })
                    .map((structure) => {
                      const stats =
                        structureStats.get(structure.id) ||
                        ({ itemCount: 0, total: 0 } as const);
                      const policyCount = structurePolicies.filter(
                        (p) => p.fee_structure_id === structure.id
                      ).length;

                      return (
                        <TableRow key={structure.id}>
                          <TableCell className="font-mono text-xs text-slate-700">
                            {structure.structure_no || "—"}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-blue-700">
                            {structure.class_code}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-slate-600">
                            {structure.term_code || "GENERAL"}
                          </TableCell>
                          <TableCell className="text-sm">{structure.name}</TableCell>
                          <TableCell className="text-right text-sm">
                            {stats.itemCount}
                          </TableCell>
                          <TableCell className="text-right text-sm font-medium">
                            {formatKes(stats.total)}
                          </TableCell>
                          <TableCell>
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                                structure.is_active
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-slate-100 text-slate-500"
                              }`}
                            >
                              {structure.is_active ? "Active" : "Inactive"}
                            </span>
                          </TableCell>
                          <TableCell className="text-right text-sm">{policyCount}</TableCell>
                          <TableCell className="text-right">
                            <div className="inline-flex items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setViewStructureId(structure.id)}
                              >
                                <Eye className="mr-1 h-3.5 w-3.5" />
                                View
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => printFeeStructure(structure)}
                              >
                                <Printer className="mr-1 h-3.5 w-3.5" />
                                Print
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => downloadStructurePdf(structure)}
                              >
                                PDF
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}

                  {feeStructures.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="py-10 text-center text-sm text-slate-400">
                        No fee structures available.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            <Dialog
              open={Boolean(viewingStructure)}
              onOpenChange={(open) => {
                if (!open) setViewStructureId("");
              }}
            >
              <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-4xl">
                <DialogHeader>
                  <DialogTitle>Fee Structure Details</DialogTitle>
                  <DialogDescription>
                    Table view of the selected structure with its categories and fee items.
                  </DialogDescription>
                </DialogHeader>

                {viewingStructure && (
                  <div className="space-y-4">
                    <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 sm:grid-cols-3">
                      <div>
                        <span className="font-medium text-slate-900">Document:</span>{" "}
                        {viewingStructure.structure_no || "—"}
                      </div>
                      <div>
                        <span className="font-medium text-slate-900">Class:</span>{" "}
                        {viewingStructure.class_code}
                      </div>
                      <div>
                        <span className="font-medium text-slate-900">Term:</span>{" "}
                        {viewingStructure.term_code || "GENERAL"}
                      </div>
                      <div>
                        <span className="font-medium text-slate-900">Name:</span>{" "}
                        {viewingStructure.name}
                      </div>
                      <div>
                        <span className="font-medium text-slate-900">Status:</span>{" "}
                        {viewingStructure.is_active ? "Active" : "Inactive"}
                      </div>
                      <div>
                        <span className="font-medium text-slate-900">Total:</span>{" "}
                        {formatKes(
                          viewingStructureRows.reduce(
                            (sum, row) => sum + toNumber(row.amount),
                            0
                          )
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-100 overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-slate-50">
                            <TableHead>Category</TableHead>
                            <TableHead>Item Code</TableHead>
                            <TableHead>Item Name</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {viewingStructureRows.map((row, idx) => (
                            <TableRow key={`${row.fee_item_id}-${idx}`}>
                              <TableCell className="font-mono text-xs text-slate-700">
                                {row.category_code || "N/A"} ·{" "}
                                {row.category_name || "Uncategorized"}
                              </TableCell>
                              <TableCell className="font-mono text-xs text-blue-700">
                                {row.fee_item_code || "—"}
                              </TableCell>
                              <TableCell className="text-sm">
                                {row.fee_item_name || "—"}
                              </TableCell>
                              <TableCell className="text-right text-sm font-medium">
                                {formatKes(toNumber(row.amount))}
                              </TableCell>
                            </TableRow>
                          ))}

                          {viewingStructureRows.length === 0 && (
                            <TableRow>
                              <TableCell
                                colSpan={4}
                                className="py-10 text-center text-sm text-slate-400"
                              >
                                No fee items configured for this structure.
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                <DialogFooter className="gap-2">
                  {viewingStructure && (
                    <>
                      <Button
                        variant="outline"
                        onClick={() => printFeeStructure(viewingStructure)}
                      >
                        <Printer className="mr-1 h-3.5 w-3.5" />
                        Print
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => downloadStructurePdf(viewingStructure)}
                      >
                        PDF
                      </Button>
                    </>
                  )}
                  <Button onClick={() => setViewStructureId("")}>Close</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </SectionCard>
        )}

        {section === "invoices" && (
          <SectionCard
            title="Invoices"
            subtitle="Filter and review tenant invoices with deterministic ordering"
            icon={Receipt}
          >
            <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="grid gap-3 lg:grid-cols-12">
                <div className="lg:col-span-4">
                  <Label className="text-xs text-slate-600">Search</Label>
                  <Input
                    placeholder="Student, invoice id, type, status..."
                    value={invoiceFilters.q}
                    onChange={(e) =>
                      setInvoiceFilters((p) => ({ ...p, q: e.target.value }))
                    }
                  />
                </div>

                <div className="lg:col-span-3">
                  <Label className="text-xs text-slate-600">Student</Label>
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
                      {enrollments.map((row) => (
                        <SelectItem key={row.id} value={row.id}>
                          {enrollmentName(row.payload || {})}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="lg:col-span-2">
                  <Label className="text-xs text-slate-600">Type</Label>
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
                      {availableInvoiceTypes.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="lg:col-span-2">
                  <Label className="text-xs text-slate-600">Status</Label>
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
                      {availableInvoiceStatuses.map((status) => (
                        <SelectItem key={status} value={status}>
                          {status}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="lg:col-span-1 flex items-end gap-2">
                  <Button
                    variant={invoiceFilters.outstanding_only ? "default" : "outline"}
                    onClick={() =>
                      setInvoiceFilters((p) => ({
                        ...p,
                        outstanding_only: !p.outstanding_only,
                      }))
                    }
                    className="w-full"
                  >
                    Due
                  </Button>
                </div>
              </div>

              {/* Date range + export row */}
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[140px] space-y-1">
                  <Label className="text-xs text-slate-600">From Date</Label>
                  <input
                    type="date"
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                    value={invoiceFilters.date_from}
                    onChange={(e) =>
                      setInvoiceFilters((p) => ({ ...p, date_from: e.target.value }))
                    }
                  />
                </div>
                <div className="flex-1 min-w-[140px] space-y-1">
                  <Label className="text-xs text-slate-600">To Date</Label>
                  <input
                    type="date"
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                    value={invoiceFilters.date_to}
                    onChange={(e) =>
                      setInvoiceFilters((p) => ({ ...p, date_to: e.target.value }))
                    }
                  />
                </div>
                <Button
                  variant="outline"
                  onClick={() =>
                    exportInvoicesCsv(
                      filteredInvoices,
                      enrollmentNameById,
                      invoiceFilters.date_from,
                      invoiceFilters.date_to
                    )
                  }
                  disabled={filteredInvoices.length === 0}
                  className="flex items-center gap-2 shrink-0"
                >
                  <Download className="h-4 w-4" />
                  Export CSV ({filteredInvoices.length})
                </Button>
              </div>
            </div>

            <div className="mb-3 text-xs text-slate-500">
              Results: <strong>{filteredInvoices.length}</strong> · Total:&nbsp;
              <strong>{formatKes(
                filteredInvoices.reduce(
                  (sum, row) => sum + toNumber(row.total_amount),
                  0
                )
              )}</strong>
            </div>

            <div className="rounded-xl border border-slate-100 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead>Invoice No</TableHead>
                    <TableHead>Invoice ID</TableHead>
                    <TableHead>Student</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredInvoices.slice(0, 200).map((invoice) => {
                    const student =
                      enrollmentNameById.get(String(invoice.enrollment_id || "")) ||
                      "N/A";
                    return (
                      <TableRow key={invoice.id}>
                        <TableCell className="font-mono text-xs text-slate-700">
                          {invoice.invoice_no || "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-blue-700">
                          {invoice.id}
                        </TableCell>
                        <TableCell className="text-sm">{student}</TableCell>
                        <TableCell className="text-xs">
                          {normalizeInvoiceType(invoice.invoice_type || "")}
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                            {normalizeInvoiceStatus(invoice.status || "")}
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {formatKes(toNumber(invoice.total_amount))}
                        </TableCell>
                        <TableCell className="text-right text-sm text-emerald-700">
                          {formatKes(toNumber(invoice.paid_amount))}
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium text-red-600">
                          {formatKes(toNumber(invoice.balance_amount))}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="inline-flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => printInvoice(invoice)}
                            >
                              <Printer className="mr-1 h-3.5 w-3.5" />
                              Print
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => downloadInvoicePdf(invoice)}
                            >
                              PDF
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  {filteredInvoices.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="py-10 text-center text-sm text-slate-400">
                        No invoices match the selected filters.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </SectionCard>
        )}

        {section === "payments" && (
          <SectionCard
            title="Payments"
            subtitle="Payments linked to invoice allocations with tenant-safe traceability"
            icon={CircleDollarSign}
          >
            <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="grid gap-3 lg:grid-cols-12">
                <div className="lg:col-span-4">
                  <Label className="text-xs text-slate-600">Search</Label>
                  <Input
                    placeholder="Payment id, provider, reference, student..."
                    value={paymentFilters.q}
                    onChange={(e) =>
                      setPaymentFilters((p) => ({ ...p, q: e.target.value }))
                    }
                  />
                </div>

                <div className="lg:col-span-4">
                  <Label className="text-xs text-slate-600">Student</Label>
                  <Select
                    value={paymentFilters.enrollment_id || "__all__"}
                    onValueChange={(v) =>
                      setPaymentFilters((p) => ({
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
                      {enrollments.map((row) => (
                        <SelectItem key={row.id} value={row.id}>
                          {enrollmentName(row.payload || {})}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="lg:col-span-4">
                  <Label className="text-xs text-slate-600">Provider</Label>
                  <Select
                    value={paymentFilters.provider || "__all__"}
                    onValueChange={(v) =>
                      setPaymentFilters((p) => ({
                        ...p,
                        provider: v === "__all__" ? "" : v,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All providers" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All providers</SelectItem>
                      {availablePaymentProviders.map((provider) => (
                        <SelectItem key={provider} value={provider}>
                          {provider}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-100 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead>Receipt No</TableHead>
                    <TableHead>Payment ID</TableHead>
                    <TableHead>Student(s)</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Linked Invoices</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPayments.slice(0, 200).map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell className="font-mono text-xs text-slate-700">
                        {payment.receipt_no || "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-blue-700">
                        {payment.id}
                      </TableCell>
                      <TableCell className="text-sm">
                        {payment.student_names.length > 0
                          ? payment.student_names.join(", ")
                          : "N/A"}
                      </TableCell>
                      <TableCell className="text-xs">{payment.provider}</TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {payment.reference || "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium text-emerald-700">
                        {formatKes(toNumber(payment.amount))}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          {(payment.allocations || []).length === 0 && (
                            <span className="text-xs text-slate-400">No allocations</span>
                          )}
                          {(payment.allocations || []).map((alloc) => {
                            const inv = invoiceById.get(String(alloc.invoice_id || ""));
                            const invoiceId = String(alloc.invoice_id || "");
                            return (
                              <a
                                key={`${payment.id}-${invoiceId}`}
                                href={`${directorFinanceHref("invoices")}&q=${encodeURIComponent(
                                  invoiceId
                                )}`}
                                className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-200"
                                title="Open in invoices"
                              >
                                {invoiceId.slice(0, 8)} · {formatKes(toNumber(alloc.amount))}
                                {inv ? ` · ${normalizeInvoiceStatus(inv.status || "")}` : ""}
                              </a>
                            );
                          })}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => printPaymentReceipt(payment)}
                          >
                            <Printer className="mr-1 h-3.5 w-3.5" />
                            Print
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => downloadPaymentPdf(payment)}
                          >
                            PDF
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}

                  {filteredPayments.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="py-10 text-center text-sm text-slate-400">
                        No payments match the selected filters.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </SectionCard>
        )}

        {section === "receipts" && (
          <div className="space-y-5">
            <SectionCard
              title="Receipt Filters"
              subtitle="Use filters to find paid invoices and printable payment receipts"
              icon={Receipt}
            >
              <div className="grid gap-3 lg:grid-cols-12">
                <div className="lg:col-span-6">
                  <Label className="text-xs text-slate-600">Search</Label>
                  <Input
                    placeholder="Invoice id, payment id, student..."
                    value={receiptFilters.q}
                    onChange={(e) =>
                      setReceiptFilters((p) => ({ ...p, q: e.target.value }))
                    }
                  />
                </div>
                <div className="lg:col-span-4">
                  <Label className="text-xs text-slate-600">Student</Label>
                  <Select
                    value={receiptFilters.enrollment_id || "__all__"}
                    onValueChange={(v) =>
                      setReceiptFilters((p) => ({
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
                      {enrollments.map((row) => (
                        <SelectItem key={row.id} value={row.id}>
                          {enrollmentName(row.payload || {})}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="lg:col-span-2 flex items-end">
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() =>
                      setReceiptFilters({ q: "", enrollment_id: "" })
                    }
                  >
                    Reset
                  </Button>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="Paid Invoice Receipts"
              subtitle="Paid or fully settled invoices"
              icon={FileText}
            >
              <div className="mb-3 text-xs text-slate-500">
                Results: <strong>{filteredReceiptInvoices.length}</strong>
              </div>
              <div className="rounded-xl border border-slate-100 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead>Invoice No</TableHead>
                      <TableHead>Invoice ID</TableHead>
                      <TableHead>Student</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredReceiptInvoices.slice(0, 200).map((invoice) => (
                      <TableRow key={invoice.id}>
                        <TableCell className="font-mono text-xs text-slate-700">
                          {invoice.invoice_no || "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-blue-700">
                          {invoice.id}
                        </TableCell>
                        <TableCell className="text-sm">
                          {enrollmentNameById.get(String(invoice.enrollment_id || "")) ||
                            "N/A"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {normalizeInvoiceType(invoice.invoice_type || "")}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {formatKes(toNumber(invoice.total_amount))}
                        </TableCell>
                        <TableCell className="text-right text-sm text-emerald-700">
                          {formatKes(toNumber(invoice.paid_amount))}
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium">
                          {formatKes(toNumber(invoice.balance_amount))}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="inline-flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => printInvoice(invoice)}
                            >
                              <Printer className="mr-1 h-3.5 w-3.5" />
                              Print
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => downloadInvoicePdf(invoice)}
                            >
                              PDF
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}

                    {filteredReceiptInvoices.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="py-10 text-center text-sm text-slate-400">
                          No paid invoices found.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </SectionCard>

            <SectionCard
              title="Payment Receipts"
              subtitle="Payments linked to settled invoices"
              icon={CircleDollarSign}
            >
              <div className="mb-3 text-xs text-slate-500">
                Results: <strong>{filteredReceiptPayments.length}</strong>
              </div>
              <div className="rounded-xl border border-slate-100 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead>Receipt No</TableHead>
                      <TableHead>Receipt Ref</TableHead>
                      <TableHead>Student(s)</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredReceiptPayments.slice(0, 200).map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell className="font-mono text-xs text-slate-700">
                          {payment.receipt_no || "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-blue-700">
                          {payment.id}
                        </TableCell>
                        <TableCell className="text-sm">
                          {payment.student_names.length > 0
                            ? payment.student_names.join(", ")
                            : "N/A"}
                        </TableCell>
                        <TableCell className="text-xs">{payment.provider}</TableCell>
                        <TableCell className="text-xs text-slate-500">
                          {payment.reference || "—"}
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium text-emerald-700">
                          {formatKes(toNumber(payment.amount))}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="inline-flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => printPaymentReceipt(payment)}
                            >
                              <Printer className="mr-1 h-3.5 w-3.5" />
                              Print
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => downloadPaymentPdf(payment)}
                            >
                              PDF
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}

                    {filteredReceiptPayments.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="py-10 text-center text-sm text-slate-400">
                          No payment receipts found.
                        </TableCell>
                      </TableRow>
                    )}
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

export default function TenantFinancePage() {
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
      <TenantFinancePageContent />
    </Suspense>
  );
}
