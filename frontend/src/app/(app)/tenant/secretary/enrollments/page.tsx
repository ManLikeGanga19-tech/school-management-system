"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";

import { AppShell } from "@/components/layout/AppShell";
import {
  secretaryEnrollmentsHref,
  secretaryNav,
  type EnrollmentSection,
} from "@/components/layout/nav-config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  Lock,
  Loader2,
  MoreHorizontal,
  Pencil,
  Search,
  ShieldCheck,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";

// ✅ Use centralized api.ts (handles auth headers + silent refresh on 401)
import { api } from "@/lib/api";
import {
  buildDefaultTerms,
  normalizeTerms,
  termFromPayload,
  type TenantTerm,
} from "@/lib/school-setup/terms";

// ─── Constants ────────────────────────────────────────────────────────────────

const ADMISSION_NUMBER_START = 1;
const PAGE_SIZE = 10;
const MAX_SECRETARY_EDITS = 3;

// ─── Types ────────────────────────────────────────────────────────────────────

type EnrollmentRow = {
  id: string;
  status: string;
  payload: Record<string, unknown>;
  admission_number?: string | null;
  // Secretary edit-limit tracking (from backend EnrollmentOut)
  secretary_edit_count?: number;
  secretary_edit_locked?: boolean;
};

type EnrollmentPageResponse = {
  items: EnrollmentRow[];
  total: number;
  limit: number;
  offset: number;
};

type EnrollmentPageQuery = {
  page: number;
  search?: string;
  statusIn?: string[];
  statusNotIn?: string[];
  classCode?: string;
  termCode?: string;
};

type TenantClass = {
  id: string;
  name: string;
  code: string;
};

type ActionType =
  | "submit"
  | "approve"
  | "reject"
  | "enroll"
  | "transfer_request"
  | "transfer_approve";

type IntakeDraft = {
  student_name: string;
  admission_class: string;
  admission_term: string;
  intake_date: string;
  date_of_birth: string;
  gender: string;
  guardian_name: string;
  guardian_phone: string;
  guardian_email: string;
  previous_school: string;
  assessment_no: string;
  nemis_no: string;
  has_medical_conditions: boolean;
  medical_conditions_details: string;
  has_medication_in_school: boolean;
  medication_in_school_details: string;
  notes: string;
  documents: {
    birth_certificate: boolean;
    passport_photo: boolean;
    previous_report_card: boolean;
    transfer_letter: boolean;
  };
};

type ExistingStudentDraft = {
  student_name: string;
  admission_class: string;
  admission_term: string;
  intake_date: string;
  date_of_birth: string;
  gender: string;
  guardian_name: string;
  guardian_phone: string;
  guardian_email: string;
  previous_school: string;
  assessment_no: string;
  nemis_no: string;
  has_medical_conditions: boolean;
  medical_conditions_details: string;
  has_medication_in_school: boolean;
  medication_in_school_details: string;
  admission_number: string;
};

type UpdateDraft = {
  student_name: string;
  admission_class: string;
  admission_term: string;
  intake_date: string;
  date_of_birth: string;
  gender: string;
  guardian_name: string;
  guardian_phone: string;
  guardian_email: string;
  previous_school: string;
  assessment_no: string;
  nemis_no: string;
  has_medical_conditions: boolean;
  medical_conditions_details: string;
  has_medication_in_school: boolean;
  medication_in_school_details: string;
  notes: string;
};

type DocumentKey = keyof IntakeDraft["documents"];

// ─── Initial states ───────────────────────────────────────────────────────────

const todayIso = new Date().toISOString().slice(0, 10);

const INITIAL_DRAFT: IntakeDraft = {
  student_name: "",
  admission_class: "",
  admission_term: "",
  intake_date: todayIso,
  date_of_birth: "",
  gender: "",
  guardian_name: "",
  guardian_phone: "",
  guardian_email: "",
  previous_school: "",
  assessment_no: "",
  nemis_no: "",
  has_medical_conditions: false,
  medical_conditions_details: "",
  has_medication_in_school: false,
  medication_in_school_details: "",
  notes: "",
  documents: {
    birth_certificate: false,
    passport_photo: false,
    previous_report_card: false,
    transfer_letter: false,
  },
};

const INITIAL_EXISTING_STUDENT_DRAFT: ExistingStudentDraft = {
  student_name: "",
  admission_class: "",
  admission_term: "",
  intake_date: todayIso,
  date_of_birth: "",
  gender: "",
  guardian_name: "",
  guardian_phone: "",
  guardian_email: "",
  previous_school: "",
  assessment_no: "",
  nemis_no: "",
  has_medical_conditions: false,
  medical_conditions_details: "",
  has_medication_in_school: false,
  medication_in_school_details: "",
  admission_number: "",
};

const INITIAL_UPDATE_DRAFT: UpdateDraft = {
  student_name: "",
  admission_class: "",
  admission_term: "",
  intake_date: "",
  date_of_birth: "",
  gender: "",
  guardian_name: "",
  guardian_phone: "",
  guardian_email: "",
  previous_school: "",
  assessment_no: "",
  nemis_no: "",
  has_medical_conditions: false,
  medical_conditions_details: "",
  has_medication_in_school: false,
  medication_in_school_details: "",
  notes: "",
};

// ─── Static config ────────────────────────────────────────────────────────────

const chartConfig = { count: { label: "Count", color: "#3b82f6" } };

const intakeSteps = [
  { id: 1, label: "Student Profile" },
  { id: 2, label: "Guardian Contact" },
  { id: 3, label: "Requirements" },
  { id: 4, label: "Review & Submit" },
] as const;

const requirementChecklist: Array<{
  key: DocumentKey;
  label: string;
  description: string;
  required: boolean;
}> = [
    {
      key: "birth_certificate",
      label: "Birth Certificate",
      description: "Certified copy of birth certificate",
      required: true,
    },
    {
      key: "passport_photo",
      label: "Passport Photo",
      description: "Recent passport-size photograph",
      required: true,
    },
    {
      key: "previous_report_card",
      label: "Previous Report Card",
      description: "Most recent academic report",
      required: true,
    },
    {
      key: "transfer_letter",
      label: "Transfer Letter",
      description: "Required for transfer students only",
      required: false,
    },
  ];

const actionConfig: Record<ActionType, { label: string; description: string }> =
{
  submit: {
    label: "Submit",
    description: "Move intake from DRAFT → SUBMITTED for office review.",
  },
  approve: {
    label: "Approve",
    description: "Office has verified documents. Move to APPROVED.",
  },
  reject: {
    label: "Reject",
    description:
      "Reject the intake with a written reason. Requires rejection note.",
  },
  enroll: {
    label: "Mark Enrolled",
    description:
      "Final enrollment. Auto-generates Admission No. on confirmation.",
  },
  transfer_request: {
    label: "Transfer Request",
    description: "Mark student as having a pending transfer request.",
  },
  transfer_approve: {
    label: "Transfer Approve",
    description:
      "Complete transfer. Requires director-level authorization.",
  },
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function studentName(payload: Record<string, unknown>): string {
  for (const key of [
    "student_name",
    "studentName",
    "full_name",
    "fullName",
    "name",
  ]) {
    const v = payload[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "Unknown student";
}

function studentClass(payload: Record<string, unknown>): string {
  for (const key of ["admission_class", "class_code", "classCode", "grade"]) {
    const v = payload[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function payloadString(
  payload: Record<string, unknown>,
  keys: string[]
): string {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function payloadBoolean(
  payload: Record<string, unknown>,
  keys: string[]
): boolean {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "yes", "y", "1"].includes(normalized)) return true;
      if (["false", "no", "n", "0"].includes(normalized)) return false;
    }
  }
  return false;
}

function isInterviewFeePaidFromPayload(
  payload: Record<string, unknown>
): boolean | null {
  const candidates = [
    payload.interview_fee_paid,
    payload.interviewFeePaid,
    payload.has_paid_interview_fee,
    payload.hasPaidInterviewFee,
    payload.interview_fee_status,
    payload.interviewFeeStatus,
    payload.interview_fee_payment_status,
    payload.interviewFeePaymentStatus,
    payload.fee_paid,
  ];
  for (const v of candidates) {
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      const s = v.trim().toUpperCase();
      if (["PAID", "SUCCESS", "COMPLETED", "SETTLED", "TRUE", "YES"].includes(s))
        return true;
      if (["UNPAID", "PENDING", "FAILED", "FALSE", "NO"].includes(s))
        return false;
    }
  }
  return null;
}

const INTERVIEW_INVOICE_TYPES = new Set(["INTERVIEW", "INTERVIEW_FEE"]);
const PAID_INVOICE_STATUSES = new Set([
  "PAID",
  "SETTLED",
  "SUCCESS",
  "COMPLETED",
  "FULLY_PAID",
]);

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function invoiceRowsFromUnknown(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter(
      (row): row is Record<string, unknown> =>
        Boolean(row) && typeof row === "object"
    );
  }
  if (!value || typeof value !== "object") return [];

  const obj = value as Record<string, unknown>;
  const candidates = [obj.items, obj.results, obj.invoices, obj.data];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(
        (row): row is Record<string, unknown> =>
          Boolean(row) && typeof row === "object"
      );
    }
  }

  return [];
}

function isInterviewInvoiceRow(invoice: Record<string, unknown>): boolean {
  const rawType = invoice.invoice_type ?? invoice.purpose ?? invoice.type;
  if (typeof rawType !== "string" || !rawType.trim()) return true;
  return INTERVIEW_INVOICE_TYPES.has(rawType.trim().toUpperCase());
}

function isSettledInvoice(invoice: Record<string, unknown>): boolean {
  if (invoice.paid === true) return true;

  const status = String(
    invoice.status ?? invoice.payment_status ?? invoice.paymentStatus ?? ""
  )
    .trim()
    .toUpperCase();
  if (PAID_INVOICE_STATUSES.has(status)) return true;

  const total = toFiniteNumber(invoice.total_amount);
  const paid = toFiniteNumber(invoice.paid_amount);
  const balance = toFiniteNumber(invoice.balance_amount);

  if (total !== null && total > 0 && paid !== null && paid >= total) return true;
  if (balance !== null && balance <= 0) return true;

  return false;
}

function hasPaidInterviewInvoice(data: unknown): boolean {
  return invoiceRowsFromUnknown(data)
    .filter((inv) => isInterviewInvoiceRow(inv))
    .some((inv) => isSettledInvoice(inv));
}

function buildInterviewFeePayHref(enrollmentId: string): string {
  const qs = new URLSearchParams({
    section: "invoices",
    purpose: "INTERVIEW_FEE",
    enrollment_id: enrollmentId,
    ref: `enrollment:${enrollmentId}`,
  });
  return `/tenant/secretary/finance?${qs.toString()}`;
}

function formatAdmissionNumber(n: number): string {
  return `ADM-${String(n).padStart(4, "0")}`;
}

function nextAdmissionNumber(rows: EnrollmentRow[]): string {
  const existing = rows
    .map((r) => {
      const raw = r.admission_number ?? (r.payload as any)?.admission_number;
      if (!raw) return 0;
      const match = String(raw).match(/(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    })
    .filter((n) => n > 0);
  const max =
    existing.length > 0
      ? Math.max(...existing)
      : ADMISSION_NUMBER_START - 1;
  return formatAdmissionNumber(max + 1);
}

function statusToSuggestedActions(s: string): ActionType[] {
  switch (s) {
    case "DRAFT":
      return ["submit"];
    case "SUBMITTED":
      return ["approve", "reject"];
    case "APPROVED":
      return ["enroll", "transfer_request"];
    case "TRANSFER_REQUESTED":
      return ["transfer_approve"];
    default:
      return [];
  }
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

const EMPTY_ENROLLMENT_PAGE: EnrollmentPageResponse = {
  items: [],
  total: 0,
  limit: PAGE_SIZE,
  offset: 0,
};

function normalizeEnrollmentPage(value: unknown): EnrollmentPageResponse {
  const raw = (value ?? {}) as Partial<EnrollmentPageResponse>;
  const total =
    typeof raw.total === "number" && Number.isFinite(raw.total) && raw.total >= 0
      ? Math.trunc(raw.total)
      : 0;
  const limit =
    typeof raw.limit === "number" && Number.isFinite(raw.limit) && raw.limit > 0
      ? Math.trunc(raw.limit)
      : PAGE_SIZE;
  const offset =
    typeof raw.offset === "number" && Number.isFinite(raw.offset) && raw.offset >= 0
      ? Math.trunc(raw.offset)
      : 0;
  return {
    items: Array.isArray(raw.items) ? (raw.items as EnrollmentRow[]) : [],
    total,
    limit,
    offset,
  };
}

function buildEnrollmentPagedPath(query: EnrollmentPageQuery): string {
  const params = new URLSearchParams();
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(Math.max(0, (query.page - 1) * PAGE_SIZE)));

  const search = query.search?.trim();
  if (search) params.set("search", search);
  if (query.statusIn && query.statusIn.length > 0) {
    params.set("status_in", query.statusIn.join(","));
  }
  if (query.statusNotIn && query.statusNotIn.length > 0) {
    params.set("status_not_in", query.statusNotIn.join(","));
  }
  if (query.classCode) params.set("class_code", query.classCode);
  if (query.termCode) params.set("term_code", query.termCode);

  return `/enrollments/paged?${params.toString()}`;
}

function totalPagesFor(total: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / PAGE_SIZE));
}

// ─── Shared UI components ─────────────────────────────────────────────────────

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

function EnrollmentStatusBadge({ status }: { status: string }) {
  const s = status.toUpperCase();
  const map: Record<string, string> = {
    ENROLLED:
      "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    ENROLLED_PARTIAL: "bg-teal-50 text-teal-700 ring-1 ring-teal-200",
    APPROVED: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
    SUBMITTED: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    DRAFT: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
    REJECTED: "bg-red-50 text-red-700 ring-1 ring-red-200",
    TRANSFER_REQUESTED:
      "bg-purple-50 text-purple-700 ring-1 ring-purple-200",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[s] ??
        "bg-slate-100 text-slate-600 ring-1 ring-slate-200"
        }`}
    >
      {s.replace(/_/g, " ")}
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

function PaginationControls({
  page,
  totalPages,
  setPage,
  totalItems,
  label = "records",
}: {
  page: number;
  totalPages: number;
  setPage: (p: number) => void;
  totalItems: number;
  label?: string;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
      <span className="text-xs text-slate-400">
        {totalItems} {label} · Page {page} of {totalPages}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setPage(Math.max(1, page - 1))}
          disabled={page === 1}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
          let n: number;
          if (totalPages <= 5) n = i + 1;
          else if (page <= 3) n = i + 1;
          else if (page >= totalPages - 2) n = totalPages - 4 + i;
          else n = page - 2 + i;
          return (
            <Button
              key={n}
              variant={n === page ? "default" : "ghost"}
              size="icon"
              className={`h-7 w-7 text-xs ${n === page
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : ""
                }`}
              onClick={() => setPage(n)}
            >
              {n}
            </Button>
          );
        })}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setPage(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 pl-8 text-xs"
      />
    </div>
  );
}

// ─── Class dropdown ───────────────────────────────────────────────────────────

function ClassSelect({
  value,
  onChange,
  classes,
  loadingClasses,
  placeholder = "Select class",
}: {
  value: string;
  onChange: (v: string) => void;
  classes: TenantClass[];
  loadingClasses: boolean;
  placeholder?: string;
}) {
  return (
    <Select
      value={value || "__none__"}
      onValueChange={(v) => onChange(v === "__none__" ? "" : v)}
      disabled={loadingClasses}
    >
      <SelectTrigger>
        <SelectValue
          placeholder={loadingClasses ? "Loading classes…" : placeholder}
        />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">
          {loadingClasses ? "Loading…" : "Select a class"}
        </SelectItem>
        {classes.map((c) => (
          <SelectItem key={c.id} value={c.code}>
            {c.name}
          </SelectItem>
        ))}
        {!loadingClasses && classes.length === 0 && (
          <SelectItem value="__empty__" disabled>
            No classes configured yet
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}

function TermSelect({
  value,
  onChange,
  terms,
  loadingTerms,
  placeholder = "Select term",
}: {
  value: string;
  onChange: (v: string) => void;
  terms: TenantTerm[];
  loadingTerms: boolean;
  placeholder?: string;
}) {
  return (
    <Select
      value={value || "__none__"}
      onValueChange={(v) => onChange(v === "__none__" ? "" : v)}
      disabled={loadingTerms}
    >
      <SelectTrigger>
        <SelectValue
          placeholder={loadingTerms ? "Loading terms…" : placeholder}
        />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">
          {loadingTerms ? "Loading…" : "Select a term"}
        </SelectItem>
        {terms.map((term) => (
          <SelectItem key={term.id} value={term.code}>
            {term.name}
          </SelectItem>
        ))}
        {!loadingTerms && terms.length === 0 && (
          <SelectItem value="__empty__" disabled>
            No terms configured yet
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}

// ─── Edit limit badge ─────────────────────────────────────────────────────────

function EditLimitBadge({ count, locked }: { count: number; locked: boolean }) {
  const used = Math.min(count ?? 0, MAX_SECRETARY_EDITS);

  if (locked || used >= MAX_SECRETARY_EDITS) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700 ring-1 ring-red-200">
        <Lock className="h-2.5 w-2.5" />
        {used}/{MAX_SECRETARY_EDITS} — Locked
      </span>
    );
  }

  if (used === MAX_SECRETARY_EDITS - 1) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">
        ⚠ {used}/{MAX_SECRETARY_EDITS} edits used
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-slate-200">
      {used}/{MAX_SECRETARY_EDITS} edits used
    </span>
  );
}

// ─── Director Override Dialog ─────────────────────────────────────────────────

function DirectorOverrideDialog({
  row,
  open,
  onClose,
  onConfirm,
  loading,
}: {
  row: EnrollmentRow | null;
  open: boolean;
  onClose: () => void;
  onConfirm: (note: string) => Promise<void>;
  loading: boolean;
}) {
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) setNote("");
  }, [open]);

  if (!row) return null;

  const name = studentName(row.payload || {});
  const count = row.secretary_edit_count ?? 0;
  const admissionNumber = row.admission_number ?? (row.payload as any)?.admission_number;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-900">
            <ShieldCheck className="h-5 w-5 text-blue-600" />
            Director Override — Unlock Student Record
          </DialogTitle>
          <DialogDescription>
            The secretary edit limit has been reached for this student. Confirm
            override to reset the counter and allow further edits.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-800">
                {name}
              </span>
              <EnrollmentStatusBadge status={row.status} />
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500">
              {admissionNumber && (
                <span className="font-mono font-semibold text-emerald-700">
                  {admissionNumber}
                </span>
              )}
              <span className="font-mono text-slate-400">
                {row.id.slice(0, 16)}…
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-red-800">
              <Lock className="h-3.5 w-3.5" />
              Edit limit reached — {count}/{MAX_SECRETARY_EDITS} secretary edits
              used
            </div>
            <p className="text-xs text-red-700">
              Confirming this override will reset the edit counter to 0,
              allowing the secretary to make up to {MAX_SECRETARY_EDITS} further
              updates. This action is recorded in the audit log with your
              identity and note.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-slate-700">
              Override Reason{" "}
              <span className="text-slate-400 font-normal">
                (optional but recommended)
              </span>
            </Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Guardian requested class change following fee clearance…"
              rows={3}
              className="resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm(note)}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {loading ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Unlocking…
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" /> Confirm Override
              </span>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Interview fee cell ───────────────────────────────────────────────────────

function InterviewFeeCell({
  enrollmentId,
  payload,
  onPayClick,
}: {
  enrollmentId: string;
  payload: Record<string, unknown>;
  onPayClick: () => void;
}) {
  const fromPayload = isInterviewFeePaidFromPayload(payload);
  const [status, setStatus] = useState<"loading" | "paid" | "unpaid">(
    fromPayload === true ? "paid" : "loading"
  );

  useEffect(() => {
    let mounted = true;
    setStatus(fromPayload === true ? "paid" : "loading");

    (async () => {
      try {
        const qs = new URLSearchParams({
          enrollment_id: enrollmentId,
          invoice_type: "INTERVIEW",
        });
        const data = await api.get<unknown>(
          `/finance/invoices?${qs.toString()}`,
          { tenantRequired: true, noRedirect: true }
        );

        if (!mounted) return;

        const paidFromInvoice = hasPaidInterviewInvoice(data);
        if (paidFromInvoice || fromPayload === true) {
          setStatus("paid");
          return;
        }
        setStatus("unpaid");
      } catch {
        if (!mounted) return;
        setStatus(fromPayload === true ? "paid" : "unpaid");
      }
    })();

    return () => {
      mounted = false;
    };
  }, [enrollmentId, fromPayload]);

  if (status === "loading") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-slate-400">
        <Loader2 className="h-3 w-3 animate-spin" /> Checking…
      </span>
    );
  }

  if (status === "paid") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
        ✓ Paid
      </span>
    );
  }

  return (
    <Button variant="outline" size="sm" className="h-8" onClick={onPayClick}>
      Pay Interview Fee
    </Button>
  );
}
// ─── Student Detail Dialog ────────────────────────────────────────────────────

function StudentDetailDialog({
  row,
  open,
  onClose,
}: {
  row: EnrollmentRow | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!row) return null;
  const p = row.payload || {};
  const admNum = row.admission_number ?? (p as any)?.admission_number ?? "—";

  const fields: Array<{ label: string; value: string | null | undefined }> = [
    { label: "Full Name", value: studentName(p) },
    { label: "Admission Number", value: admNum },
    { label: "Class", value: studentClass(p) || "—" },
    { label: "Term", value: termFromPayload(p) || "—" },
    { label: "Intake Date", value: (p as any)?.intake_date || "—" },
    { label: "Date of Birth", value: (p as any)?.date_of_birth || "—" },
    { label: "Gender", value: (p as any)?.gender || "—" },
    { label: "Guardian Name", value: (p as any)?.guardian_name || "—" },
    { label: "Guardian Phone", value: (p as any)?.guardian_phone || "—" },
    { label: "Guardian Email", value: (p as any)?.guardian_email || "—" },
    { label: "Previous School", value: (p as any)?.previous_school || "—" },
    { label: "Assessment No.", value: (p as any)?.assessment_no || "—" },
    { label: "NEMIS No.", value: (p as any)?.nemis_no || "—" },
    {
      label: "Enrollment Source",
      value: (p as any)?.enrollment_source || "INTAKE",
    },
    {
      label: "Has Medical Condition",
      value: payloadBoolean(p, [
        "has_medical_conditions",
        "has_underlying_medical_conditions",
      ])
        ? "Yes"
        : "No",
    },
    {
      label: "Medical Condition Details",
      value:
        payloadString(p, [
          "medical_conditions_details",
          "underlying_medical_conditions",
          "medical_report",
        ]) || "—",
    },
    {
      label: "Medicine Kept In School",
      value: payloadBoolean(p, [
        "has_medication_in_school",
        "medication_left_in_school",
      ])
        ? "Yes"
        : "No",
    },
    {
      label: "Medication Details",
      value:
        payloadString(p, [
          "medication_in_school_details",
          "medication_prescription_details",
        ]) || "—",
    },
    { label: "Notes", value: (p as any)?.notes || "—" },
  ];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-slate-500" />
            Student Record
          </DialogTitle>
          <DialogDescription>Full details for {studentName(p)}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] overflow-y-auto space-y-4">
          <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
            <EnrollmentStatusBadge status={row.status} />
            {admNum && admNum !== "—" && (
              <span className="font-mono text-xs font-semibold text-emerald-700">
                {admNum}
              </span>
            )}
            <EditLimitBadge
              count={row.secretary_edit_count ?? 0}
              locked={row.secretary_edit_locked ?? false}
            />
            <span className="ml-auto font-mono text-[11px] text-slate-400 select-all">
              {row.id}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            {fields.map(({ label, value }) => (
              <div key={label} className="space-y-0.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {label}
                </div>
                <div className="text-sm font-medium text-slate-900 break-all">
                  {value || "—"}
                </div>
              </div>
            ))}
          </div>

          {(p as any)?.documents && (
            <div className="rounded-xl border border-slate-100 overflow-hidden">
              <div className="bg-slate-50 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Documents
              </div>
              <div className="grid grid-cols-2 gap-2 p-4">
                {requirementChecklist.map((item) => {
                  const checked = !!(p as any).documents?.[item.key];
                  return (
                    <div
                      key={item.key}
                      className="flex items-center gap-2 text-sm"
                    >
                      <span
                        className={
                          checked ? "text-emerald-500" : "text-red-400"
                        }
                      >
                        {checked ? "✓" : "✗"}
                      </span>
                      <span
                        className={
                          checked ? "text-slate-700" : "text-slate-400"
                        }
                      >
                        {item.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Update / Patch Dialog ────────────────────────────────────────────────────

function UpdateEnrollmentDialog({
  row,
  open,
  onClose,
  onSave,
  saving,
  classes,
  terms,
  loadingClasses,
  loadingTerms,
}: {
  row: EnrollmentRow | null;
  open: boolean;
  onClose: () => void;
  onSave: (id: string, draft: UpdateDraft) => Promise<void>;
  saving: boolean;
  classes: TenantClass[];
  terms: TenantTerm[];
  loadingClasses: boolean;
  loadingTerms: boolean;
}) {
  const [draft, setDraft] = useState<UpdateDraft>(INITIAL_UPDATE_DRAFT);

  useEffect(() => {
    if (row) {
      const p = row.payload || {};
      setDraft({
        student_name: String((p as any)?.student_name ?? studentName(p)),
        admission_class: String(
          (p as any)?.admission_class ?? studentClass(p) ?? ""
        ),
        admission_term: String(
          (p as any)?.admission_term ?? termFromPayload(p) ?? ""
        ),
        intake_date: String((p as any)?.intake_date ?? ""),
        date_of_birth: String((p as any)?.date_of_birth ?? ""),
        gender: String((p as any)?.gender ?? ""),
        guardian_name: String((p as any)?.guardian_name ?? ""),
        guardian_phone: String((p as any)?.guardian_phone ?? ""),
        guardian_email: String((p as any)?.guardian_email ?? ""),
        previous_school: String((p as any)?.previous_school ?? ""),
        assessment_no: String((p as any)?.assessment_no ?? ""),
        nemis_no: String((p as any)?.nemis_no ?? ""),
        has_medical_conditions: payloadBoolean(p, [
          "has_medical_conditions",
          "has_underlying_medical_conditions",
        ]),
        medical_conditions_details: payloadString(p, [
          "medical_conditions_details",
          "underlying_medical_conditions",
          "medical_report",
        ]),
        has_medication_in_school: payloadBoolean(p, [
          "has_medication_in_school",
          "medication_left_in_school",
        ]),
        medication_in_school_details: payloadString(p, [
          "medication_in_school_details",
          "medication_prescription_details",
        ]),
        notes: String((p as any)?.notes ?? ""),
      });
    }
  }, [row]);

  if (!row) return null;

  const editCount = row.secretary_edit_count ?? 0;
  const editLocked = row.secretary_edit_locked ?? false;
  const isEnrolled = ["ENROLLED", "ENROLLED_PARTIAL"].includes(
    row.status.toUpperCase()
  );

  const canSave =
    !saving &&
    isNonEmpty(draft.student_name) &&
    isNonEmpty(draft.admission_class) &&
    isNonEmpty(draft.guardian_name) &&
    isNonEmpty(draft.guardian_phone);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-slate-500" />
            Update Student — {studentName(row.payload || {})}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="flex items-center gap-2 flex-wrap">
              <span>
                Status: <span className="font-semibold">{row.status}</span>
              </span>
              {isEnrolled && (
                <EditLimitBadge count={editCount} locked={editLocked} />
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto">
          <div className="grid gap-4 py-2 md:grid-cols-2">
            <FormField label="Full Name" required>
              <Input
                value={draft.student_name}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, student_name: e.target.value }))
                }
              />
            </FormField>

            <FormField
              label="Admission Class"
              required
              hint="Select from configured school classes"
            >
              <ClassSelect
                value={draft.admission_class}
                onChange={(v) =>
                  setDraft((p) => ({ ...p, admission_class: v }))
                }
                classes={classes}
                loadingClasses={loadingClasses}
              />
            </FormField>

            <FormField label="Intake Date" hint="Date applicant was registered">
              <Input
                type="date"
                value={draft.intake_date}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, intake_date: e.target.value }))
                }
              />
            </FormField>

            <FormField
              label="Admission Term"
              hint="Academic term this enrollment belongs to"
            >
              <TermSelect
                value={draft.admission_term}
                onChange={(v) =>
                  setDraft((p) => ({ ...p, admission_term: v }))
                }
                terms={terms}
                loadingTerms={loadingTerms}
              />
            </FormField>

            <FormField label="Date of Birth">
              <Input
                type="date"
                value={draft.date_of_birth}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, date_of_birth: e.target.value }))
                }
              />
            </FormField>

            <FormField label="Gender">
              <Select
                value={draft.gender || "__none__"}
                onValueChange={(v) =>
                  setDraft((p) => ({
                    ...p,
                    gender: v === "__none__" ? "" : v,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select gender" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Not specified</SelectItem>
                  <SelectItem value="MALE">Male</SelectItem>
                  <SelectItem value="FEMALE">Female</SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            <FormField label="Guardian Full Name" required>
              <Input
                value={draft.guardian_name}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, guardian_name: e.target.value }))
                }
              />
            </FormField>

            <FormField label="Guardian Phone" required>
              <Input
                value={draft.guardian_phone}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, guardian_phone: e.target.value }))
                }
              />
            </FormField>

            <FormField label="Guardian Email">
              <Input
                value={draft.guardian_email}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, guardian_email: e.target.value }))
                }
              />
            </FormField>

            <FormField label="Previous School">
              <Input
                value={draft.previous_school}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    previous_school: e.target.value,
                  }))
                }
              />
            </FormField>

            <FormField label="Assessment Number" hint="Required for final enroll action">
              <Input
                value={draft.assessment_no}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, assessment_no: e.target.value }))
                }
              />
            </FormField>

            <FormField label="NEMIS Number">
              <Input
                value={draft.nemis_no}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, nemis_no: e.target.value }))
                }
              />
            </FormField>

            <FormField label="Underlying Medical Condition">
              <Select
                value={draft.has_medical_conditions ? "YES" : "NO"}
                onValueChange={(v) =>
                  setDraft((p) => ({
                    ...p,
                    has_medical_conditions: v === "YES",
                    medical_conditions_details:
                      v === "YES" ? p.medical_conditions_details : "",
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select option" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NO">No</SelectItem>
                  <SelectItem value="YES">Yes</SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            <FormField label="Medicine Left In School">
              <Select
                value={draft.has_medication_in_school ? "YES" : "NO"}
                onValueChange={(v) =>
                  setDraft((p) => ({
                    ...p,
                    has_medication_in_school: v === "YES",
                    medication_in_school_details:
                      v === "YES" ? p.medication_in_school_details : "",
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select option" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NO">No</SelectItem>
                  <SelectItem value="YES">Yes</SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            {draft.has_medical_conditions && (
              <div className="md:col-span-2">
                <FormField
                  label="Medical Condition Details"
                  hint="Describe diagnosis, triggers, and emergency guidance."
                >
                  <Textarea
                    value={draft.medical_conditions_details}
                    rows={3}
                    className="resize-none"
                    onChange={(e) =>
                      setDraft((p) => ({
                        ...p,
                        medical_conditions_details: e.target.value,
                      }))
                    }
                  />
                </FormField>
              </div>
            )}

            {draft.has_medication_in_school && (
              <div className="md:col-span-2">
                <FormField
                  label="Medication Details"
                  hint="Medicine names, dosage schedule, and handling instructions."
                >
                  <Textarea
                    value={draft.medication_in_school_details}
                    rows={3}
                    className="resize-none"
                    onChange={(e) =>
                      setDraft((p) => ({
                        ...p,
                        medication_in_school_details: e.target.value,
                      }))
                    }
                  />
                </FormField>
              </div>
            )}

            <div className="md:col-span-2">
              <FormField label="Notes">
                <Textarea
                  value={draft.notes}
                  rows={3}
                  className="resize-none"
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, notes: e.target.value }))
                  }
                />
              </FormField>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => onSave(row.id, draft)}
            disabled={!canSave}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {saving ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
              </span>
            ) : (
              "Save Changes"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Students table action cell ───────────────────────────────────────────────

function StudentActionCell({
  row,
  onView,
  onUpdate,
  onDirectorOverride,
}: {
  row: EnrollmentRow;
  onView: () => void;
  onUpdate: () => void;
  onDirectorOverride: () => void;
}) {
  const count = row.secretary_edit_count ?? 0;
  const locked = row.secretary_edit_locked ?? false;
  const isLocked = locked || count >= MAX_SECRETARY_EDITS;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={onView}
        >
          <Eye className="h-3 w-3" />
          View
        </Button>

        {isLocked ? (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs cursor-not-allowed opacity-50 border-red-200 text-red-500"
                    disabled
                  >
                    <Lock className="h-3 w-3" />
                    Update
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs max-w-[200px] text-center">
                Edit limit reached ({MAX_SECRETARY_EDITS}/{MAX_SECRETARY_EDITS}). A director must unlock this record.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={onUpdate}
          >
            <Pencil className="h-3 w-3" />
            Update
          </Button>
        )}
      </div>

      <EditLimitBadge count={count} locked={locked} />

      {isLocked && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-[10px] text-blue-700 hover:bg-blue-50 hover:text-blue-800"
          onClick={onDirectorOverride}
        >
          <ShieldCheck className="h-3 w-3" />
          Director Override
        </Button>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function SecretaryEnrollmentsPageContent() {
  const searchParams = useSearchParams();
  const section: EnrollmentSection =
    searchParams.get("section") === "students" ? "students" : "intake";
  const activeEnrollmentsHref = secretaryEnrollmentsHref(section);

  // ── Core data ──
  const [rows, setRows] = useState<EnrollmentRow[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Tenant classes ──
  const [tenantClasses, setTenantClasses] = useState<TenantClass[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [tenantTerms, setTenantTerms] = useState<TenantTerm[]>([]);
  const [loadingTerms, setLoadingTerms] = useState(true);

  // ── Intake wizard ──
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<IntakeDraft>(INITIAL_DRAFT);
  const [creating, setCreating] = useState(false);
  const [selectedFeeStructureId, setSelectedFeeStructureId] = useState<
    string | null
  >(null);
  const [feeStructures, setFeeStructures] = useState<any[]>([]);

  // ── Existing student ──
  const [existingStudentDraft, setExistingStudentDraft] =
    useState<ExistingStudentDraft>(INITIAL_EXISTING_STUDENT_DRAFT);
  const [creatingExistingStudent, setCreatingExistingStudent] =
    useState(false);

  // ── Workflow ──
  const [action, setAction] = useState<ActionType>("submit");
  const [targetId, setTargetId] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // ── Search / filter ──
  const [workflowSearch, setWorkflowSearch] = useState("");
  const [queueSearch, setQueueSearch] = useState("");
  const [studentsSearch, setStudentsSearch] = useState("");
  const [studentsClassFilter, setStudentsClassFilter] =
    useState("__all__");
  const [studentsTermFilter, setStudentsTermFilter] = useState("__all__");

  // ── Server-side pagination state ──
  const [workflowPage, setWorkflowPage] = useState(1);
  const [queuePage, setQueuePage] = useState(1);
  const [studentsPage, setStudentsPage] = useState(1);

  const [workflowPageData, setWorkflowPageData] =
    useState<EnrollmentPageResponse>(EMPTY_ENROLLMENT_PAGE);
  const [queuePageData, setQueuePageData] =
    useState<EnrollmentPageResponse>(EMPTY_ENROLLMENT_PAGE);
  const [studentsPageData, setStudentsPageData] =
    useState<EnrollmentPageResponse>(EMPTY_ENROLLMENT_PAGE);

  const [workflowLoading, setWorkflowLoading] = useState(true);
  const [queueLoading, setQueueLoading] = useState(true);
  const [studentsLoading, setStudentsLoading] = useState(true);

  // ── Standard dialogs ──
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState("");
  const [rejectText, setRejectText] = useState("");

  const [payInterviewOpen, setPayInterviewOpen] = useState(false);
  const [payInterviewTargetId, setPayInterviewTargetId] = useState("");

  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateTargetRow, setUpdateTargetRow] =
    useState<EnrollmentRow | null>(null);
  const [updateSaving, setUpdateSaving] = useState(false);

  const [viewOpen, setViewOpen] = useState(false);
  const [viewTargetRow, setViewTargetRow] =
    useState<EnrollmentRow | null>(null);

  // ── Director override dialog ──
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideRow, setOverrideRow] = useState<EnrollmentRow | null>(
    null
  );
  const [overrideLoading, setOverrideLoading] = useState(false);

  // ── Data loaders ──────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<EnrollmentRow[]>(
        "/enrollments/",
        { tenantRequired: true }
      );
      setRows(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setRows([]);
      toast.error(
        typeof err?.message === "string"
          ? err.message
          : "Enrollment service is currently unavailable."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // ✅ Removed interval refresh logic; rely on api.ts for auth refresh, and manual reloads after actions.
  useEffect(() => {
    load();
  }, [load]);

  const fetchEnrollmentPage = useCallback(
    async (query: EnrollmentPageQuery): Promise<EnrollmentPageResponse> => {
      const data = await api.get<EnrollmentPageResponse>(
        buildEnrollmentPagedPath(query),
        { tenantRequired: true }
      );
      return normalizeEnrollmentPage(data);
    },
    []
  );

  const loadWorkflowPage = useCallback(async () => {
    setWorkflowLoading(true);
    try {
      const pageData = await fetchEnrollmentPage({
        page: workflowPage,
        search: workflowSearch,
        statusNotIn: ["ENROLLED", "ENROLLED_PARTIAL"],
      });
      setWorkflowPageData(pageData);
      const maxPage = totalPagesFor(pageData.total);
      if (workflowPage > maxPage) setWorkflowPage(maxPage);
    } catch (err: any) {
      setWorkflowPageData(EMPTY_ENROLLMENT_PAGE);
      toast.error(
        typeof err?.message === "string"
          ? err.message
          : "Failed to load workflow records."
      );
    } finally {
      setWorkflowLoading(false);
    }
  }, [fetchEnrollmentPage, workflowPage, workflowSearch]);

  const loadQueuePage = useCallback(async () => {
    setQueueLoading(true);
    try {
      const pageData = await fetchEnrollmentPage({
        page: queuePage,
        search: queueSearch,
      });
      setQueuePageData(pageData);
      const maxPage = totalPagesFor(pageData.total);
      if (queuePage > maxPage) setQueuePage(maxPage);
    } catch (err: any) {
      setQueuePageData(EMPTY_ENROLLMENT_PAGE);
      toast.error(
        typeof err?.message === "string"
          ? err.message
          : "Failed to load enrollment queue."
      );
    } finally {
      setQueueLoading(false);
    }
  }, [fetchEnrollmentPage, queuePage, queueSearch]);

  const loadStudentsPage = useCallback(async () => {
    setStudentsLoading(true);
    try {
      const pageData = await fetchEnrollmentPage({
        page: studentsPage,
        search: studentsSearch,
        statusIn: ["ENROLLED", "ENROLLED_PARTIAL"],
        classCode:
          studentsClassFilter !== "__all__" ? studentsClassFilter : undefined,
        termCode: studentsTermFilter !== "__all__" ? studentsTermFilter : undefined,
      });
      setStudentsPageData(pageData);
      const maxPage = totalPagesFor(pageData.total);
      if (studentsPage > maxPage) setStudentsPage(maxPage);
    } catch (err: any) {
      setStudentsPageData(EMPTY_ENROLLMENT_PAGE);
      toast.error(
        typeof err?.message === "string"
          ? err.message
          : "Failed to load enrolled students."
      );
    } finally {
      setStudentsLoading(false);
    }
  }, [
    fetchEnrollmentPage,
    studentsPage,
    studentsSearch,
    studentsClassFilter,
    studentsTermFilter,
  ]);

  const reloadPagedTables = useCallback(async () => {
    await Promise.all([loadWorkflowPage(), loadQueuePage(), loadStudentsPage()]);
  }, [loadQueuePage, loadStudentsPage, loadWorkflowPage]);

  useEffect(() => {
    setWorkflowPage(1);
  }, [workflowSearch]);

  useEffect(() => {
    setQueuePage(1);
  }, [queueSearch]);

  useEffect(() => {
    setStudentsPage(1);
  }, [studentsSearch, studentsClassFilter, studentsTermFilter]);

  useEffect(() => {
    void loadWorkflowPage();
  }, [loadWorkflowPage]);

  useEffect(() => {
    void loadQueuePage();
  }, [loadQueuePage]);

  useEffect(() => {
    void loadStudentsPage();
  }, [loadStudentsPage]);

  useEffect(() => {
    let mounted = true;
    setLoadingClasses(true);
    (async () => {
      try {
        const data = await api.get<TenantClass[]>("/tenants/classes", {
          tenantRequired: true,
          noRedirect: true,
        });
        if (!mounted) return;
        setTenantClasses(Array.isArray(data) ? data : []);
      } catch {
        // keep existing behavior (silent fail + loading false)
      } finally {
        if (mounted) setLoadingClasses(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await api.get<any[]>("/finance/fee-structures", {
          tenantRequired: true,
          noRedirect: true,
        });
        if (mounted && Array.isArray(data)) setFeeStructures(data);
      } catch {
        /* optional — silent fail */
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    setLoadingTerms(true);
    (async () => {
      try {
        const data = await api.get<unknown>("/tenants/terms", {
          tenantRequired: true,
          noRedirect: true,
        });
        if (!mounted) return;
        const normalized = normalizeTerms(data);
        setTenantTerms(
          normalized.length > 0 ? normalized : buildDefaultTerms()
        );
      } catch {
        if (!mounted) return;
        setTenantTerms(buildDefaultTerms());
      } finally {
        if (mounted) setLoadingTerms(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // ── Derived data ──────────────────────────────────────────────────────────

  const studentRows = useMemo(
    () =>
      rows.filter((r) =>
        ["ENROLLED", "ENROLLED_PARTIAL"].includes(
          String(r.status || "").toUpperCase()
        )
      ),
    [rows]
  );

  const uniqueClasses = useMemo(() => {
    const s = new Set<string>();
    studentRows.forEach((r) => {
      const c = studentClass(r.payload || {});
      if (c) s.add(c);
    });
    return Array.from(s).sort();
  }, [studentRows]);

  const uniqueTerms = useMemo(() => {
    const s = new Set<string>();
    studentRows.forEach((r) => {
      const term = termFromPayload(r.payload || {});
      if (term) s.add(term);
    });
    return Array.from(s).sort();
  }, [studentRows]);

  // ── Pagination ────────────────────────────────────────────────────────────
  const workflowRows = workflowPageData.items;
  const queueRows = queuePageData.items;
  const studentsRows = studentsPageData.items;

  const workflowTotalPages = totalPagesFor(workflowPageData.total);
  const queueTotalPages = totalPagesFor(queuePageData.total);
  const studentsTotalPages = totalPagesFor(studentsPageData.total);

  // ── Wizard helpers ────────────────────────────────────────────────────────

  const requiredDocsReady = requirementChecklist
    .filter((x) => x.required)
    .every((x) => draft.documents[x.key]);

  const baseFieldsReady =
    isNonEmpty(draft.student_name) &&
    isNonEmpty(draft.admission_class) &&
    isNonEmpty(draft.date_of_birth) &&
    isNonEmpty(draft.guardian_name) &&
    isNonEmpty(draft.guardian_phone);

  const canPost = baseFieldsReady && requiredDocsReady;

  function nextStep() {
    if (step === 1) {
      if (
        !isNonEmpty(draft.student_name) ||
        !isNonEmpty(draft.admission_class) ||
        !isNonEmpty(draft.date_of_birth)
      ) {
        toast.error(
          "Complete all required student profile fields before continuing."
        );
        return;
      }
    }
    if (step === 2) {
      if (!isNonEmpty(draft.guardian_name) || !isNonEmpty(draft.guardian_phone)) {
        toast.error("Guardian name and phone are required.");
        return;
      }
    }
    if (step === 3 && !requiredDocsReady) {
      toast.error(
        "Confirm all required documents before proceeding to review."
      );
      return;
    }
    setStep((p) => Math.min(p + 1, 4));
  }

  function prevStep() {
    setStep((p) => Math.max(p - 1, 1));
  }

  // ── API calls ─────────────────────────────────────────────────────────────

  async function createEnrollment() {
    if (!canPost) {
      toast.error("Complete required fields and documents first.");
      return;
    }
    setCreating(true);
    const payload: any = {
      student_name: draft.student_name.trim(),
      admission_class: draft.admission_class.trim(),
      admission_term: draft.admission_term.trim() || null,
      intake_date: draft.intake_date || null,
      date_of_birth: draft.date_of_birth,
      gender: draft.gender || null,
      guardian_name: draft.guardian_name.trim(),
      guardian_phone: draft.guardian_phone.trim(),
      guardian_email: draft.guardian_email.trim() || null,
      previous_school: draft.previous_school.trim() || null,
      assessment_no: draft.assessment_no.trim() || null,
      nemis_no: draft.nemis_no.trim() || null,
      has_medical_conditions: draft.has_medical_conditions,
      medical_conditions_details: draft.has_medical_conditions
        ? draft.medical_conditions_details.trim() || null
        : null,
      has_medication_in_school: draft.has_medication_in_school,
      medication_in_school_details: draft.has_medication_in_school
        ? draft.medication_in_school_details.trim() || null
        : null,
      notes: draft.notes.trim() || null,
      documents: draft.documents,
      currency: "KES",
    };
    if (selectedFeeStructureId) payload._fee_structure_id = selectedFeeStructureId;

    try {
      const data = await api.post<any>(
        "/enrollments/",
        { payload },
        { tenantRequired: true }
      );
      const createdId = String(data?.enrollment?.id || "");
      setTargetId(createdId);
      setDraft(INITIAL_DRAFT);
      setStep(1);
      toast.success(
        createdId
          ? `Enrollment created — ID: ${createdId}`
          : "Enrollment created successfully."
      );
      await Promise.all([load(), reloadPagedTables()]);
    } catch (err: any) {
      toast.error(
        typeof err?.message === "string"
          ? err.message
          : "Unable to post enrollment. Please retry."
      );
    } finally {
      setCreating(false);
    }
  }

  async function createExistingStudentEnrollment() {
    if (
      !isNonEmpty(existingStudentDraft.student_name) ||
      !isNonEmpty(existingStudentDraft.admission_class) ||
      !isNonEmpty(existingStudentDraft.guardian_name) ||
      !isNonEmpty(existingStudentDraft.guardian_phone)
    ) {
      toast.error("Student name, class, guardian name and phone are required.");
      return;
    }
    setCreatingExistingStudent(true);
    try {
      const data = await api.post<any>(
        "/enrollments/",
        {
          payload: {
            student_name: existingStudentDraft.student_name.trim(),
            admission_class: existingStudentDraft.admission_class.trim(),
            admission_term: existingStudentDraft.admission_term.trim() || null,
            intake_date: existingStudentDraft.intake_date || null,
            date_of_birth: existingStudentDraft.date_of_birth || null,
            gender: existingStudentDraft.gender || null,
            guardian_name: existingStudentDraft.guardian_name.trim(),
            guardian_phone: existingStudentDraft.guardian_phone.trim(),
            guardian_email: existingStudentDraft.guardian_email.trim() || null,
            previous_school: existingStudentDraft.previous_school.trim() || null,
            assessment_no: existingStudentDraft.assessment_no.trim() || null,
            nemis_no: existingStudentDraft.nemis_no.trim() || null,
            has_medical_conditions: existingStudentDraft.has_medical_conditions,
            medical_conditions_details: existingStudentDraft.has_medical_conditions
              ? existingStudentDraft.medical_conditions_details.trim() || null
              : null,
            has_medication_in_school: existingStudentDraft.has_medication_in_school,
            medication_in_school_details: existingStudentDraft.has_medication_in_school
              ? existingStudentDraft.medication_in_school_details.trim() || null
              : null,
            admission_number: existingStudentDraft.admission_number.trim() || null,
            enrollment_source: "EXISTING_STUDENT",
            currency: "KES",
            documents: {
              birth_certificate: false,
              passport_photo: false,
              previous_report_card: false,
              transfer_letter: false,
            },
          },
        },
        { tenantRequired: true }
      );

      const createdId = String(data?.enrollment?.id || "");
      setExistingStudentDraft(INITIAL_EXISTING_STUDENT_DRAFT);
      toast.success(
        createdId
          ? `Existing student created — ID: ${createdId}`
          : "Existing student intake created."
      );
      await Promise.all([load(), reloadPagedTables()]);
    } catch (err: any) {
      toast.error(
        typeof err?.message === "string"
          ? err.message
          : "Unable to add existing student. Please retry."
      );
    } finally {
      setCreatingExistingStudent(false);
    }
  }

  async function runActionFor(enrollmentId: string, act: ActionType) {
    if (!enrollmentId) return;
    if (act === "reject") {
      setRejectTargetId(enrollmentId);
      setRejectText("");
      setRejectOpen(true);
      return;
    }
    setTargetId(enrollmentId);
    setAction(act);
    setReason("");
    setSubmitting(true);
    const isEnroll = act === "enroll";
    const autoAdm = isEnroll ? nextAdmissionNumber(rows) : undefined;

    try {
      if (act === "submit") {
        await api.post<any>(
          `/enrollments/${enrollmentId}/submit`,
          undefined,
          { tenantRequired: true }
        );
      } else if (act === "approve") {
        await api.post<any>(
          `/enrollments/${enrollmentId}/approve`,
          undefined,
          { tenantRequired: true }
        );
      } else if (act === "enroll") {
        await api.post<any>(
          `/enrollments/${enrollmentId}/enroll`,
          { admission_number: autoAdm },
          { tenantRequired: true }
        );
      } else if (act === "transfer_request") {
        await api.post<any>(
          `/enrollments/${enrollmentId}/transfer/request`,
          undefined,
          { tenantRequired: true }
        );
      } else if (act === "transfer_approve") {
        await api.post<any>(
          `/enrollments/${enrollmentId}/transfer/approve`,
          undefined,
          { tenantRequired: true }
        );
      }

      toast.success(
        isEnroll
          ? `Enrollment complete. Admission number: ${autoAdm}`
          : `Action "${actionConfig[act].label}" completed.`
      );
      await Promise.all([load(), reloadPagedTables()]);
    } catch (err: any) {
      toast.error(
        typeof err?.message === "string"
          ? err.message
          : "Enrollment action failed: service unavailable."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmReject() {
    if (!rejectTargetId) return;
    setRejectOpen(false);
    setSubmitting(true);
    try {
      await api.post<any>(
        `/enrollments/${rejectTargetId}/reject`,
        { reason: rejectText.trim() },
        { tenantRequired: true }
      );

      toast.success("Intake rejected successfully.");
      await Promise.all([load(), reloadPagedTables()]);
    } catch (err: any) {
      toast.error(
        typeof err?.message === "string"
          ? err.message
          : "Rejection failed: service unavailable."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function saveUpdate(id: string, d: UpdateDraft) {
    setUpdateSaving(true);
    try {
      await api.patch<any>(
        `/enrollments/${id}`,
        {
          payload: {
            student_name: d.student_name.trim(),
            admission_class: d.admission_class.trim(),
            admission_term: d.admission_term.trim() || null,
            intake_date: d.intake_date || null,
            date_of_birth: d.date_of_birth || null,
            gender: d.gender || null,
            guardian_name: d.guardian_name.trim(),
            guardian_phone: d.guardian_phone.trim(),
            guardian_email: d.guardian_email.trim() || null,
            previous_school: d.previous_school.trim() || null,
            assessment_no: d.assessment_no.trim() || null,
            nemis_no: d.nemis_no.trim() || null,
            has_medical_conditions: d.has_medical_conditions,
            medical_conditions_details: d.has_medical_conditions
              ? d.medical_conditions_details.trim() || null
              : null,
            has_medication_in_school: d.has_medication_in_school,
            medication_in_school_details: d.has_medication_in_school
              ? d.medication_in_school_details.trim() || null
              : null,
            notes: d.notes.trim() || null,
          },
        },
        { tenantRequired: true }
      );

      toast.success("Student record updated successfully.");
      setUpdateOpen(false);
      setUpdateTargetRow(null);
      await Promise.all([load(), reloadPagedTables()]);
    } catch (err: any) {
      toast.error(
        typeof err?.message === "string"
          ? err.message
          : "Update failed: service unavailable."
      );
    } finally {
      setUpdateSaving(false);
    }
  }

  async function runDirectorOverride(note: string) {
    if (!overrideRow) return;
    setOverrideLoading(true);
    try {
      await api.post<any>(
        `/enrollments/${overrideRow.id}/director-override`,
        { note: note.trim() || null },
        { tenantRequired: true }
      );

      toast.success(
        `Record unlocked for ${studentName(
          overrideRow.payload || {}
        )}. Secretary can now make further edits.`
      );
      setOverrideOpen(false);
      setOverrideRow(null);
      await Promise.all([load(), reloadPagedTables()]);
    } catch (err: any) {
      toast.error(
        typeof err?.message === "string"
          ? err.message
          : "Override failed: service unavailable."
      );
    } finally {
      setOverrideLoading(false);
    }
  }

  function openPayInterview(enrollmentId: string) {
    setPayInterviewTargetId(enrollmentId);
    setPayInterviewOpen(true);
  }

  // ── Chart data ────────────────────────────────────────────────────────────

  const chartData = useMemo(
    () =>
      Object.entries(
        rows.reduce((acc, r) => {
          const k = (r.status || "UNKNOWN").toUpperCase();
          acc[k] = (acc[k] || 0) + 1;
          return acc;
        }, {} as Record<string, number>)
      ).map(([status, count]) => ({ status, count })),
    [rows]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <AppShell title="Secretary" nav={secretaryNav} activeHref={activeEnrollmentsHref}>
      <div className="space-y-5">

        {/* ── All dialogs — always mounted ── */}

        <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
          <DialogContent className="sm:max-w-[520px]">
            <DialogHeader>
              <DialogTitle>Reject Intake</DialogTitle>
              <DialogDescription>Provide a clear reason. This will be recorded in the workflow.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rejection Reason *</Label>
              <Textarea value={rejectText} onChange={(e) => setRejectText(e.target.value)}
                placeholder="State the reason for rejection…" rows={4} className="resize-none" />
              <p className="text-xs text-slate-400">Enrollment ID: <span className="font-mono">{rejectTargetId || "—"}</span></p>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
              <Button onClick={confirmReject} disabled={submitting || !rejectText.trim()}
                className="bg-red-600 hover:bg-red-700">
                {submitting
                  ? <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Rejecting…</span>
                  : "Confirm Reject"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={payInterviewOpen} onOpenChange={setPayInterviewOpen}>
          <DialogContent className="sm:max-w-[520px]">
            <DialogHeader>
              <DialogTitle>Pay Interview Fee</DialogTitle>
              <DialogDescription>Interview fee payment is required before submitting intake for review.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Enrollment Reference</Label>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
                {payInterviewTargetId ? `enrollment:${payInterviewTargetId}` : "—"}
              </div>
              <p className="text-xs text-slate-400">After payment is confirmed, return here and the intake can be submitted.</p>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setPayInterviewOpen(false)}>Cancel</Button>
              <Button disabled={!payInterviewTargetId} className="bg-blue-600 hover:bg-blue-700"
                onClick={() => { window.location.href = buildInterviewFeePayHref(payInterviewTargetId); }}>
                Proceed to Payment
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <UpdateEnrollmentDialog
          row={updateTargetRow} open={updateOpen}
          onClose={() => { setUpdateOpen(false); setUpdateTargetRow(null); }}
          onSave={saveUpdate} saving={updateSaving}
          classes={tenantClasses}
          terms={tenantTerms}
          loadingClasses={loadingClasses}
          loadingTerms={loadingTerms}
        />

        <StudentDetailDialog
          row={viewTargetRow} open={viewOpen}
          onClose={() => { setViewOpen(false); setViewTargetRow(null); }}
        />

        <DirectorOverrideDialog
          row={overrideRow}
          open={overrideOpen}
          onClose={() => { setOverrideOpen(false); setOverrideRow(null); }}
          onConfirm={runDirectorOverride}
          loading={overrideLoading}
        />

        {/* ── Page Header ── */}
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-600 to-blue-500 p-5 text-white shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold">
                {section === "students" ? "Enrolled Students" : "Enrollment Operations"}
              </h1>
              <p className="mt-0.5 text-sm text-blue-100">
                {section === "students"
                  ? "Manage existing student records and add returning students."
                  : "Register new student intake step-by-step, then manage the workflow queue."}
              </p>
            </div>
            <div className="flex items-center gap-3 text-right text-sm text-blue-100">
              <div>
                <div className="text-xl font-bold text-white">{rows.length}</div>
                <div className="text-xs">Total Records</div>
              </div>
              <div className="h-8 w-px bg-blue-400" />
              <div>
                <div className="text-xl font-bold text-white">{studentRows.length}</div>
                <div className="text-xs">Enrolled</div>
              </div>
            </div>
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════════
            INTAKE SECTION
        ══════════════════════════════════════════════════════════════ */}
        {section === "intake" && (
          <div className="space-y-5">

            {/* 1) STATUS OVERVIEW */}
            <div className="grid gap-5 xl:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
                <h3 className="mb-3 text-sm font-semibold text-slate-800">Enrollment Status Overview</h3>
                <ChartContainer config={chartConfig} className="h-[200px] w-full">
                  <BarChart accessibilityLayer data={chartData}>
                    <CartesianGrid vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="status" tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 10 }} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" fill="var(--color-count)" radius={6} />
                  </BarChart>
                </ChartContainer>
              </div>

              <div className="xl:col-span-2 rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">Overview</h3>
                    <p className="mt-0.5 text-xs text-slate-500">Quick snapshot of pipeline + enrolled totals.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">Total: {rows.length}</Badge>
                    <Badge variant="secondary" className="text-xs">Enrolled: {studentRows.length}</Badge>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  {["DRAFT", "SUBMITTED", "APPROVED"].map((s) => {
                    const count = rows.filter((r) => String(r.status || "").toUpperCase() === s).length;
                    return (
                      <div key={s} className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{s}</div>
                        <div className="mt-1 text-2xl font-bold text-slate-900">{count}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 2) NEW STUDENT INTAKE WIZARD */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="border-b border-slate-100 px-6 py-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">New Student Intake</h2>
                  <p className="mt-0.5 text-xs text-slate-500">Track intake progress and complete the current step in one view.</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
                    Step {step} of 4
                  </span>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${canPost ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-amber-50 text-amber-800 ring-amber-200"}`}>
                    {canPost ? "Ready" : "In progress"}
                  </span>
                </div>
              </div>

              <div className="grid gap-0 lg:grid-cols-12">
                {/* Steps sidebar */}
                <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-slate-100">
                  <div className="px-6 py-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Intake Steps</div>
                    <p className="mt-1 text-xs text-slate-400">Click a completed step to review.</p>
                  </div>
                  <div className="px-2 pb-2">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50">
                          <TableHead className="text-xs w-[60px]">Step</TableHead>
                          <TableHead className="text-xs">Stage</TableHead>
                          <TableHead className="text-xs w-[120px]">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {intakeSteps.map((s) => {
                          const state = step === s.id ? "Current" : step > s.id ? "Completed" : "Pending";
                          const pill =
                            state === "Current" ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200"
                              : state === "Completed" ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                                : "bg-slate-100 text-slate-600 ring-1 ring-slate-200";
                          return (
                            <TableRow key={s.id}
                              className={`cursor-default ${step === s.id ? "bg-blue-50/40" : "hover:bg-slate-50"} ${step > s.id ? "cursor-pointer" : ""}`}
                              onClick={() => { if (step > s.id) setStep(s.id); }}>
                              <TableCell className="font-mono text-xs text-slate-500">{s.id}</TableCell>
                              <TableCell className="text-sm font-medium text-slate-900">{s.label}</TableCell>
                              <TableCell>
                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${pill}`}>{state}</span>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                {/* Form area */}
                <div className="lg:col-span-8">
                  <div className="px-6 py-4 border-b border-slate-100">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">
                          {intakeSteps.find((s) => s.id === step)?.label}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {step === 1 ? "Enter student personal details exactly as they appear on official documents."
                            : step === 2 ? "Provide accurate guardian contact details for school communications."
                              : step === 3 ? "Confirm required documents and add optional identifiers if available."
                                : "Review everything and submit the intake to the office workflow."}
                        </div>
                      </div>
                      {step === 4 && (
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
                          Review Mode
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="p-6">
                    {step === 1 && (
                      <div className="grid gap-4 md:grid-cols-2">
                        <FormField label="Full Name" required hint="As appearing on birth certificate">
                          <Input placeholder="e.g. Achieng Atieno" value={draft.student_name}
                            onChange={(e) => setDraft((p) => ({ ...p, student_name: e.target.value }))} />
                        </FormField>
                        <FormField label="Admission Class" required hint="Select from configured school classes">
                          <ClassSelect value={draft.admission_class}
                            onChange={(v) => setDraft((p) => ({ ...p, admission_class: v }))}
                            classes={tenantClasses} loadingClasses={loadingClasses} />
                        </FormField>
                        <FormField label="Admission Term" hint="Academic term for this intake">
                          <TermSelect
                            value={draft.admission_term}
                            onChange={(v) => setDraft((p) => ({ ...p, admission_term: v }))}
                            terms={tenantTerms}
                            loadingTerms={loadingTerms}
                          />
                        </FormField>
                        <FormField label="Intake Date" required hint="Date of registration / application">
                          <Input type="date" value={draft.intake_date}
                            onChange={(e) => setDraft((p) => ({ ...p, intake_date: e.target.value }))} />
                        </FormField>
                        <FormField label="Date of Birth" required>
                          <Input type="date" value={draft.date_of_birth}
                            onChange={(e) => setDraft((p) => ({ ...p, date_of_birth: e.target.value }))} />
                        </FormField>
                        <FormField label="Gender">
                          <Select value={draft.gender || "__none__"}
                            onValueChange={(v) => setDraft((p) => ({ ...p, gender: v === "__none__" ? "" : v }))}>
                            <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">Not specified</SelectItem>
                              <SelectItem value="MALE">Male</SelectItem>
                              <SelectItem value="FEMALE">Female</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormField>
                      </div>
                    )}

                    {step === 2 && (
                      <div className="grid gap-4 md:grid-cols-2">
                        <FormField label="Guardian Full Name" required>
                          <Input placeholder="e.g. Jane Atieno" value={draft.guardian_name}
                            onChange={(e) => setDraft((p) => ({ ...p, guardian_name: e.target.value }))} />
                        </FormField>
                        <FormField label="Guardian Phone" required hint="Include country code e.g. +254…">
                          <Input placeholder="+2547XXXXXXXX" value={draft.guardian_phone}
                            onChange={(e) => setDraft((p) => ({ ...p, guardian_phone: e.target.value }))} />
                        </FormField>
                        <FormField label="Guardian Email" hint="Optional — for digital communications">
                          <Input placeholder="guardian@example.com" value={draft.guardian_email}
                            onChange={(e) => setDraft((p) => ({ ...p, guardian_email: e.target.value }))} />
                        </FormField>
                        <FormField label="Previous School" hint="Leave blank if not applicable">
                          <Input placeholder="e.g. Sunshine Academy" value={draft.previous_school}
                            onChange={(e) => setDraft((p) => ({ ...p, previous_school: e.target.value }))} />
                        </FormField>

                        <FormField label="Underlying Medical Conditions">
                          <Select
                            value={draft.has_medical_conditions ? "YES" : "NO"}
                            onValueChange={(v) =>
                              setDraft((p) => ({
                                ...p,
                                has_medical_conditions: v === "YES",
                                medical_conditions_details:
                                  v === "YES" ? p.medical_conditions_details : "",
                              }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select option" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="NO">No</SelectItem>
                              <SelectItem value="YES">Yes</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormField>

                        <FormField label="Medicine Left In School">
                          <Select
                            value={draft.has_medication_in_school ? "YES" : "NO"}
                            onValueChange={(v) =>
                              setDraft((p) => ({
                                ...p,
                                has_medication_in_school: v === "YES",
                                medication_in_school_details:
                                  v === "YES" ? p.medication_in_school_details : "",
                              }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select option" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="NO">No</SelectItem>
                              <SelectItem value="YES">Yes</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormField>

                        {draft.has_medical_conditions && (
                          <div className="md:col-span-2">
                            <FormField
                              label="Medical Condition Details"
                              hint="Diagnosis, triggers, and emergency response notes."
                            >
                              <Textarea
                                placeholder="e.g. Asthma — carry inhaler. Avoid heavy dust exposure."
                                value={draft.medical_conditions_details}
                                onChange={(e) =>
                                  setDraft((p) => ({
                                    ...p,
                                    medical_conditions_details: e.target.value,
                                  }))
                                }
                                className="resize-none"
                                rows={3}
                              />
                            </FormField>
                          </div>
                        )}

                        {draft.has_medication_in_school && (
                          <div className="md:col-span-2">
                            <FormField
                              label="Medication Details"
                              hint="Medication names, dosage, and handling instructions."
                            >
                              <Textarea
                                placeholder="e.g. Salbutamol inhaler — 2 puffs when needed, kept with nurse."
                                value={draft.medication_in_school_details}
                                onChange={(e) =>
                                  setDraft((p) => ({
                                    ...p,
                                    medication_in_school_details: e.target.value,
                                  }))
                                }
                                className="resize-none"
                                rows={3}
                              />
                            </FormField>
                          </div>
                        )}
                      </div>
                    )}

                    {step === 3 && (
                      <div className="space-y-5">
                        <div className="rounded-xl border border-amber-50 bg-amber-50/60 px-4 py-2.5 text-sm text-amber-800">
                          ⚠️ Assessment No. and NEMIS No. are required later during final enrollment. You can add them now if available.
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <FormField label="Assessment Number" hint="Required for final enrollment action">
                            <Input placeholder="Leave blank if not yet assigned" value={draft.assessment_no}
                              onChange={(e) => setDraft((p) => ({ ...p, assessment_no: e.target.value }))} />
                          </FormField>
                          <FormField label="NEMIS Number" hint="National Education Management Information System ID">
                            <Input placeholder="Leave blank if not yet assigned" value={draft.nemis_no}
                              onChange={(e) => setDraft((p) => ({ ...p, nemis_no: e.target.value }))} />
                          </FormField>
                        </div>
                        <FormField label="Additional Notes" hint="Admission desk notes, special considerations, etc.">
                          <Textarea placeholder="Any notes from the admission desk…" value={draft.notes}
                            onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))}
                            className="resize-none" rows={3} />
                        </FormField>
                        <div>
                          <Label className="mb-2 block text-sm font-medium text-slate-700">Document Checklist</Label>
                          <div className="space-y-2">
                            {requirementChecklist.map((item) => (
                              <label key={item.key} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${draft.documents[item.key]
                                ? "border-emerald-200 bg-emerald-50"
                                : item.required
                                  ? "border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/30"
                                  : "border-slate-100 bg-slate-50 hover:bg-slate-100"
                                }`}>
                                <input type="checkbox" checked={draft.documents[item.key]}
                                  onChange={(e) => setDraft((p) => ({
                                    ...p, documents: { ...p.documents, [item.key]: e.target.checked }
                                  }))} className="mt-0.5 h-4 w-4 accent-blue-600" />
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-slate-800">{item.label}</span>
                                    {item.required
                                      ? <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-600">Required</span>
                                      : <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">Optional</span>}
                                  </div>
                                  <p className="mt-0.5 text-xs text-slate-400">{item.description}</p>
                                </div>
                                {draft.documents[item.key] && <span className="text-emerald-500 text-sm">✓</span>}
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {step === 4 && (
                      <div className="space-y-5">
                        <div className="rounded-xl border border-slate-100 overflow-hidden">
                          <div className="bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Student Details</div>
                          <div className="grid grid-cols-2 gap-x-6 gap-y-3 p-4 text-sm">
                            <div><span className="text-slate-400">Full Name:</span> <span className="font-medium">{draft.student_name || "—"}</span></div>
                            <div><span className="text-slate-400">Class:</span> <span className="font-medium">{draft.admission_class || "—"}</span></div>
                            <div><span className="text-slate-400">Term:</span> <span className="font-medium">{draft.admission_term || "—"}</span></div>
                            <div><span className="text-slate-400">Intake Date:</span> <span className="font-medium">{draft.intake_date || "—"}</span></div>
                            <div><span className="text-slate-400">Date of Birth:</span> <span className="font-medium">{draft.date_of_birth || "—"}</span></div>
                            <div><span className="text-slate-400">Gender:</span> <span className="font-medium">{draft.gender || "Not specified"}</span></div>
                            <div><span className="text-slate-400">Guardian:</span> <span className="font-medium">{draft.guardian_name || "—"}</span></div>
                            <div><span className="text-slate-400">Phone:</span> <span className="font-medium">{draft.guardian_phone || "—"}</span></div>
                            <div><span className="text-slate-400">Medical Condition:</span> <span className="font-medium">{draft.has_medical_conditions ? "Yes" : "No"}</span></div>
                            <div><span className="text-slate-400">Medicine In School:</span> <span className="font-medium">{draft.has_medication_in_school ? "Yes" : "No"}</span></div>
                            {draft.has_medical_conditions && (
                              <div className="col-span-2">
                                <span className="text-slate-400">Medical Details:</span>{" "}
                                <span className="font-medium">{draft.medical_conditions_details || "—"}</span>
                              </div>
                            )}
                            {draft.has_medication_in_school && (
                              <div className="col-span-2">
                                <span className="text-slate-400">Medication Details:</span>{" "}
                                <span className="font-medium">{draft.medication_in_school_details || "—"}</span>
                              </div>
                            )}
                            {draft.guardian_email && <div><span className="text-slate-400">Email:</span> <span className="font-medium">{draft.guardian_email}</span></div>}
                            {draft.previous_school && <div><span className="text-slate-400">Prev. School:</span> <span className="font-medium">{draft.previous_school}</span></div>}
                            {draft.assessment_no && <div><span className="text-slate-400">Assessment No.:</span> <span className="font-mono font-medium">{draft.assessment_no}</span></div>}
                            {draft.nemis_no && <div><span className="text-slate-400">NEMIS No.:</span> <span className="font-mono font-medium">{draft.nemis_no}</span></div>}
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-100 overflow-hidden">
                          <div className="bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Document Checklist</div>
                          <div className="p-4 grid grid-cols-2 gap-2">
                            {requirementChecklist.map((item) => (
                              <div key={item.key} className="flex items-center gap-2 text-sm">
                                <span className={draft.documents[item.key] ? "text-emerald-500" : "text-red-400"}>
                                  {draft.documents[item.key] ? "✓" : "✗"}
                                </span>
                                <span className={draft.documents[item.key] ? "text-slate-700" : "text-slate-400"}>{item.label}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-100 p-4">
                          <div className="mb-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                            💡 When this student is marked as <strong>Enrolled</strong>, an Admission Number will be
                            auto-generated using the next available number in your existing sequence.
                          </div>
                          <FormField label="Fee Structure (Optional)" hint="Link a fee structure to automatically generate a fees invoice.">
                            <Select value={selectedFeeStructureId || "__none__"}
                              onValueChange={(v) => setSelectedFeeStructureId(v === "__none__" ? null : v)}>
                              <SelectTrigger><SelectValue placeholder="No fee structure — skip" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">No fee structure — skip</SelectItem>
                                {feeStructures.map((s) => (
                                  <SelectItem key={s.id} value={s.id}>{s.name} ({s.class_code || s.code || ""})</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormField>
                        </div>
                        <div className={`rounded-xl border px-4 py-3 text-sm ${canPost ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                          <div className="font-semibold mb-1">{canPost ? "✅ Ready to submit" : "⚠️ Not ready yet"}</div>
                          <div className="flex flex-wrap gap-2 mt-1">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${baseFieldsReady ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                              {baseFieldsReady ? "✓" : "✗"} Required fields
                            </span>
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${requiredDocsReady ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                              {requiredDocsReady ? "✓" : "✗"} Documents confirmed
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="border-t border-slate-100 px-6 py-4 flex items-center justify-between">
                    <Button type="button" variant="outline" onClick={prevStep} disabled={step === 1}>← Previous</Button>
                    <div className="flex gap-2">
                      {step < 4 && (
                        <Button type="button" onClick={nextStep} className="bg-blue-600 hover:bg-blue-700">Next →</Button>
                      )}
                      {step === 4 && (
                        <Button type="button" onClick={createEnrollment} disabled={!canPost || creating}
                          className="bg-blue-600 hover:bg-blue-700">
                          {creating
                            ? <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Submitting…</span>
                            : "Submit Intake"}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 3) WORKFLOW ACTIONS TABLE */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-6 py-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Workflow Actions</h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Click any row to view full student details. Use the Update button to edit, or ⋯ menu for workflow actions.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <SearchInput value={workflowSearch} onChange={setWorkflowSearch} placeholder="Search student, class, ID…" />
                  <div className="text-xs text-slate-400 whitespace-nowrap">
                    {submitting
                      ? <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Running…</span>
                      : `${workflowPageData.total} records`}
                  </div>
                </div>
              </div>

              <div className="overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs">Student</TableHead>
                      <TableHead className="text-xs">Class</TableHead>
                      <TableHead className="text-xs">Term</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs">Student ID</TableHead>
                      <TableHead className="text-xs w-[160px]">Interview Fee</TableHead>
                      <TableHead className="text-xs w-[110px] text-center">Update</TableHead>
                      <TableHead className="text-xs w-[60px] text-right"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!workflowLoading && workflowRows.map((row) => {
                      const statusUpper = String(row.status || "").toUpperCase();
                      const suggested = statusToSuggestedActions(statusUpper);

                      return (
                        <TableRow
                          key={row.id}
                          className={`cursor-pointer hover:bg-slate-50 ${targetId === row.id ? "bg-blue-50/40" : ""}`}
                          onClick={() => { setTargetId(row.id); setViewTargetRow(row); setViewOpen(true); }}
                        >
                          <TableCell className="text-sm font-medium">{studentName(row.payload || {})}</TableCell>
                          <TableCell>
                            <span className="font-mono text-xs text-slate-500">{studentClass(row.payload || {}) || "—"}</span>
                          </TableCell>
                          <TableCell>
                            <span className="font-mono text-xs text-slate-500">
                              {termFromPayload(row.payload || {}) || "—"}
                            </span>
                          </TableCell>
                          <TableCell><EnrollmentStatusBadge status={row.status} /></TableCell>
                          <TableCell className="font-mono text-xs text-slate-400">{row.id}</TableCell>

                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <InterviewFeeCell
                              enrollmentId={row.id}
                              payload={row.payload || {}}
                              onPayClick={() => openPayInterview(row.id)}
                            />
                          </TableCell>

                          <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                            <Button variant="outline" size="sm" className="h-8 gap-1 text-xs"
                              onClick={() => { setUpdateTargetRow(row); setUpdateOpen(true); }}>
                              <Pencil className="h-3.5 w-3.5" /> Update
                            </Button>
                          </TableCell>

                          <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon"
                                  onClick={(e) => { e.stopPropagation(); setTargetId(row.id); }}>
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-64">
                                <DropdownMenuLabel className="text-xs">Workflow Actions</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                {(Object.keys(actionConfig) as ActionType[]).map((act) => {
                                  const isSuggested = suggested.includes(act);
                                  return (
                                    <DropdownMenuItem key={act}
                                      onClick={async () => { await runActionFor(row.id, act); }}
                                      className="flex items-start gap-2">
                                      <div className="flex-1">
                                        <div className="text-sm font-medium">
                                          {actionConfig[act].label}
                                          {isSuggested && (
                                            <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 ring-1 ring-blue-200">
                                              Suggested
                                            </span>
                                          )}
                                        </div>
                                        <div className="mt-0.5 text-xs text-slate-500">{actionConfig[act].description}</div>
                                      </div>
                                    </DropdownMenuItem>
                                  );
                                })}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })}

                    {!workflowLoading && workflowRows.length === 0 && (
                      <EmptyRow colSpan={8}
                        message={workflowSearch ? "No results match your search." : "No workflow items found (non-enrolled)."} />
                    )}
                  </TableBody>
                </Table>
              </div>

              <PaginationControls
                page={workflowPage}
                totalPages={workflowTotalPages}
                setPage={setWorkflowPage}
                totalItems={workflowPageData.total}
                label="workflow items"
              />
            </div>

            {/* 4) ENROLLMENT QUEUE */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-4 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Enrollment Queue</h3>
                  <p className="mt-0.5 text-xs text-slate-500">All intake records across all statuses. Click a row to view details.</p>
                </div>
                <div className="flex items-center gap-3">
                  <SearchInput value={queueSearch} onChange={setQueueSearch} placeholder="Search student, class, ID…" />
                  <span className="text-xs text-slate-400 whitespace-nowrap">
                    {queuePageData.total} records
                  </span>
                </div>
              </div>
              <div className="overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs">Student</TableHead>
                      <TableHead className="text-xs">Class</TableHead>
                      <TableHead className="text-xs">Term</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs">Intake Date</TableHead>
                      <TableHead className="text-xs">Admission No.</TableHead>
                      <TableHead className="text-xs">ID</TableHead>
                      <TableHead className="text-xs"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!queueLoading && queueRows.map((row) => {
                      const admNum = row.admission_number ?? (row.payload as any)?.admission_number;
                      const intakeDate = (row.payload as any)?.intake_date;
                      return (
                        <TableRow key={row.id}
                          className={`cursor-pointer hover:bg-slate-50 ${targetId === row.id ? "bg-blue-50" : ""}`}
                          onClick={() => { setTargetId(row.id); setViewTargetRow(row); setViewOpen(true); }}>
                          <TableCell className="text-sm font-medium">{studentName(row.payload || {})}</TableCell>
                          <TableCell>
                            <span className="font-mono text-xs text-slate-500">{studentClass(row.payload || {}) || "—"}</span>
                          </TableCell>
                          <TableCell>
                            <span className="font-mono text-xs text-slate-500">
                              {termFromPayload(row.payload || {}) || "—"}
                            </span>
                          </TableCell>
                          <TableCell><EnrollmentStatusBadge status={row.status} /></TableCell>
                          <TableCell className="text-xs text-slate-500">{intakeDate || "—"}</TableCell>
                          <TableCell>
                            {admNum
                              ? <span className="font-mono text-xs font-semibold text-emerald-700">{admNum}</span>
                              : <span className="text-xs text-slate-300">Not assigned</span>}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-slate-400">{row.id.slice(0, 8)}…</TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => { setTargetId(row.id); setViewTargetRow(row); setViewOpen(true); }}
                              className="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 transition">
                              View
                            </button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {!queueLoading && queueRows.length === 0 && (
                      <EmptyRow colSpan={8}
                        message={queueSearch ? "No results match your search." : "No enrollments found."} />
                    )}
                  </TableBody>
                </Table>
              </div>
              <PaginationControls
                page={queuePage}
                totalPages={queueTotalPages}
                setPage={setQueuePage}
                totalItems={queuePageData.total}
                label="records"
              />
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════
            STUDENTS SECTION
        ══════════════════════════════════════════════════════════════ */}
        {section === "students" && (
          <div className="space-y-5">

            {/* Add Existing Student */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-6 py-4">
                <h2 className="text-base font-semibold text-slate-900">Add Existing Student</h2>
                <p className="mt-0.5 text-sm text-slate-500">Register a returning or already-enrolled student into the system.</p>
              </div>
              <div className="p-6">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <FormField label="Student Full Name" required>
                    <Input placeholder="e.g. Achieng Atieno" value={existingStudentDraft.student_name}
                      onChange={(e) => setExistingStudentDraft((p) => ({ ...p, student_name: e.target.value }))} />
                  </FormField>
                  <FormField label="Admission Class" required hint="Select from configured school classes">
                    <ClassSelect value={existingStudentDraft.admission_class}
                      onChange={(v) => setExistingStudentDraft((p) => ({ ...p, admission_class: v }))}
                      classes={tenantClasses} loadingClasses={loadingClasses} />
                  </FormField>
                  <FormField label="Admission Term" hint="Academic term for this student">
                    <TermSelect
                      value={existingStudentDraft.admission_term}
                      onChange={(v) =>
                        setExistingStudentDraft((p) => ({
                          ...p,
                          admission_term: v,
                        }))
                      }
                      terms={tenantTerms}
                      loadingTerms={loadingTerms}
                    />
                  </FormField>
                  <FormField label="Intake Date" hint="Date student was originally registered">
                    <Input type="date" value={existingStudentDraft.intake_date}
                      onChange={(e) => setExistingStudentDraft((p) => ({ ...p, intake_date: e.target.value }))} />
                  </FormField>
                  <FormField label="Admission Number" hint="Manual entry for existing students — leave blank to auto-assign">
                    <Input placeholder="e.g. ADM-0042" value={existingStudentDraft.admission_number}
                      onChange={(e) => setExistingStudentDraft((p) => ({ ...p, admission_number: e.target.value }))} />
                  </FormField>
                  <FormField label="Date of Birth">
                    <Input type="date" value={existingStudentDraft.date_of_birth}
                      onChange={(e) => setExistingStudentDraft((p) => ({ ...p, date_of_birth: e.target.value }))} />
                  </FormField>
                  <FormField label="Gender">
                    <Select value={existingStudentDraft.gender || "__none__"}
                      onValueChange={(v) => setExistingStudentDraft((p) => ({ ...p, gender: v === "__none__" ? "" : v }))}>
                      <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Not specified</SelectItem>
                        <SelectItem value="MALE">Male</SelectItem>
                        <SelectItem value="FEMALE">Female</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormField>
                  <FormField label="Previous School">
                    <Input placeholder="Optional" value={existingStudentDraft.previous_school}
                      onChange={(e) => setExistingStudentDraft((p) => ({ ...p, previous_school: e.target.value }))} />
                  </FormField>
                  <FormField label="Guardian Name" required>
                    <Input placeholder="e.g. Jane Atieno" value={existingStudentDraft.guardian_name}
                      onChange={(e) => setExistingStudentDraft((p) => ({ ...p, guardian_name: e.target.value }))} />
                  </FormField>
                  <FormField label="Guardian Phone" required>
                    <Input placeholder="+2547XXXXXXXX" value={existingStudentDraft.guardian_phone}
                      onChange={(e) => setExistingStudentDraft((p) => ({ ...p, guardian_phone: e.target.value }))} />
                  </FormField>
                  <FormField label="Guardian Email">
                    <Input placeholder="guardian@example.com" value={existingStudentDraft.guardian_email}
                      onChange={(e) => setExistingStudentDraft((p) => ({ ...p, guardian_email: e.target.value }))} />
                  </FormField>
                  <FormField label="Assessment Number">
                    <Input placeholder="Optional" value={existingStudentDraft.assessment_no}
                      onChange={(e) => setExistingStudentDraft((p) => ({ ...p, assessment_no: e.target.value }))} />
                  </FormField>
                  <FormField label="NEMIS Number">
                    <Input placeholder="Optional" value={existingStudentDraft.nemis_no}
                      onChange={(e) => setExistingStudentDraft((p) => ({ ...p, nemis_no: e.target.value }))} />
                  </FormField>
                  <FormField label="Underlying Medical Conditions">
                    <Select
                      value={existingStudentDraft.has_medical_conditions ? "YES" : "NO"}
                      onValueChange={(v) =>
                        setExistingStudentDraft((p) => ({
                          ...p,
                          has_medical_conditions: v === "YES",
                          medical_conditions_details:
                            v === "YES" ? p.medical_conditions_details : "",
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select option" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NO">No</SelectItem>
                        <SelectItem value="YES">Yes</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormField>
                  <FormField label="Medicine Left In School">
                    <Select
                      value={existingStudentDraft.has_medication_in_school ? "YES" : "NO"}
                      onValueChange={(v) =>
                        setExistingStudentDraft((p) => ({
                          ...p,
                          has_medication_in_school: v === "YES",
                          medication_in_school_details:
                            v === "YES" ? p.medication_in_school_details : "",
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select option" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NO">No</SelectItem>
                        <SelectItem value="YES">Yes</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormField>
                  {existingStudentDraft.has_medical_conditions && (
                    <div className="lg:col-span-3">
                      <FormField
                        label="Medical Condition Details"
                        hint="Diagnosis, triggers, and emergency handling guidance."
                      >
                        <Textarea
                          placeholder="Describe underlying medical conditions"
                          value={existingStudentDraft.medical_conditions_details}
                          onChange={(e) =>
                            setExistingStudentDraft((p) => ({
                              ...p,
                              medical_conditions_details: e.target.value,
                            }))
                          }
                          className="resize-none"
                          rows={3}
                        />
                      </FormField>
                    </div>
                  )}
                  {existingStudentDraft.has_medication_in_school && (
                    <div className="lg:col-span-3">
                      <FormField
                        label="Medication Details"
                        hint="Medication names, dosage plan, and where it is stored."
                      >
                        <Textarea
                          placeholder="Describe school medication prescription details"
                          value={existingStudentDraft.medication_in_school_details}
                          onChange={(e) =>
                            setExistingStudentDraft((p) => ({
                              ...p,
                              medication_in_school_details: e.target.value,
                            }))
                          }
                          className="resize-none"
                          rows={3}
                        />
                      </FormField>
                    </div>
                  )}
                </div>
                <div className="mt-5 flex gap-2">
                  <Button onClick={createExistingStudentEnrollment} disabled={creatingExistingStudent}
                    className="bg-blue-600 hover:bg-blue-700">
                    {creatingExistingStudent
                      ? <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Adding…</span>
                      : "+ Add Student"}
                  </Button>
                  <Button variant="outline"
                    onClick={() => setExistingStudentDraft(INITIAL_EXISTING_STUDENT_DRAFT)}
                    disabled={creatingExistingStudent}>
                    Clear
                  </Button>
                </div>
              </div>
            </div>

            {/* ── Enrolled Students Table ── */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-6 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">Enrolled Students</h2>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Students with ENROLLED status. Secretaries may update each record up to {MAX_SECRETARY_EDITS}×;
                      beyond that a director override is required.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <SearchInput value={studentsSearch} onChange={setStudentsSearch} placeholder="Search name, class, ADM…" />
                    <Select value={studentsClassFilter} onValueChange={setStudentsClassFilter}>
                      <SelectTrigger className="h-8 w-[160px] text-xs">
                        <SelectValue placeholder="Filter by class" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">All Classes</SelectItem>
                        {uniqueClasses.map((cls) => (
                          <SelectItem key={cls} value={cls}>{cls}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={studentsTermFilter} onValueChange={setStudentsTermFilter}>
                      <SelectTrigger className="h-8 w-[160px] text-xs">
                        <SelectValue placeholder="Filter by term" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">All Terms</SelectItem>
                        {uniqueTerms.map((term) => (
                          <SelectItem key={term} value={term}>
                            {term}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 whitespace-nowrap">
                      {studentsPageData.total} enrolled
                    </span>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs">Student Name</TableHead>
                      <TableHead className="text-xs">Adm. No.</TableHead>
                      <TableHead className="text-xs">Class</TableHead>
                      <TableHead className="text-xs">Term</TableHead>
                      <TableHead className="text-xs">Intake Date</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs">Record ID</TableHead>
                      <TableHead className="text-xs w-[180px] text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!studentsLoading && studentsRows.map((row) => {
                      const admNum = row.admission_number ?? (row.payload as any)?.admission_number;
                      const intakeDate = (row.payload as any)?.intake_date;
                      return (
                        <TableRow key={row.id} className="hover:bg-slate-50 align-top">
                          <TableCell className="text-sm font-medium pt-3">{studentName(row.payload || {})}</TableCell>
                          <TableCell className="pt-3">
                            {admNum
                              ? <span className="font-mono text-xs font-semibold text-emerald-700">{admNum}</span>
                              : <span className="text-xs text-slate-300">—</span>}
                          </TableCell>
                          <TableCell className="pt-3">
                            <span className="font-mono text-xs text-slate-500">{studentClass(row.payload || {}) || "—"}</span>
                          </TableCell>
                          <TableCell className="pt-3">
                            <span className="font-mono text-xs text-slate-500">
                              {termFromPayload(row.payload || {}) || "—"}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs text-slate-500 pt-3">{intakeDate || "—"}</TableCell>
                          <TableCell className="pt-3"><EnrollmentStatusBadge status={row.status} /></TableCell>
                          <TableCell className="font-mono text-xs text-slate-400 pt-3">{row.id}</TableCell>

                          <TableCell className="text-center py-2">
                            <StudentActionCell
                              row={row}
                              onView={() => { setViewTargetRow(row); setViewOpen(true); }}
                              onUpdate={() => { setUpdateTargetRow(row); setUpdateOpen(true); }}
                              onDirectorOverride={() => { setOverrideRow(row); setOverrideOpen(true); }}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}

                    {!studentsLoading && studentsRows.length === 0 && (
                      <EmptyRow colSpan={8}
                        message={
                          studentsSearch ||
                          studentsClassFilter !== "__all__" ||
                          studentsTermFilter !== "__all__"
                          ? "No students match your search or filter."
                          : "No enrolled students found."
                        }
                      />
                    )}
                  </TableBody>
                </Table>
              </div>

              <PaginationControls
                page={studentsPage}
                totalPages={studentsTotalPages}
                setPage={setStudentsPage}
                totalItems={studentsPageData.total}
                label="students"
              />
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default function SecretaryEnrollmentsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            <p className="text-sm text-slate-500">Loading enrollments…</p>
          </div>
        </div>
      }
    >
      <SecretaryEnrollmentsPageContent />
    </Suspense>
  );
}
