"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import {
  CheckCircle,
  XCircle,
  GraduationCap,
  ArrowRightLeft,
  Send,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  Eye,
  Loader2,
  MoreHorizontal,
  Pencil,
  Search,
  Trash2,
  AlertTriangle,
  RefreshCw,
  LockIcon,
} from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import {
  directorEnrollmentsHref,
  directorNav,
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
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import {
  buildDefaultTerms,
  normalizeTerms,
  termFromPayload,
  type TenantTerm,
} from "@/lib/school-setup/terms";

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 10;
const MAX_SECRETARY_EDITS = 3;

// ─── Types ────────────────────────────────────────────────────────────────────

type EnrollmentRow = {
  id: string;
  status: string;
  payload: Record<string, unknown>;
  admission_number?: string | null;
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

// ─── Initial states ───────────────────────────────────────────────────────────

const INITIAL_UPDATE_DRAFT: UpdateDraft = {
  student_name: "", admission_class: "", admission_term: "", intake_date: "",
  date_of_birth: "", gender: "", guardian_name: "",
  guardian_phone: "", guardian_email: "", previous_school: "",
  assessment_no: "", nemis_no: "",
  has_medical_conditions: false, medical_conditions_details: "",
  has_medication_in_school: false, medication_in_school_details: "",
  notes: "",
};

// ─── Static config ────────────────────────────────────────────────────────────

const chartConfig = { count: { label: "Count", color: "#3b82f6" } };

const requirementChecklist = [
  { key: "birth_certificate",    label: "Birth Certificate"    },
  { key: "passport_photo",       label: "Passport Photo"       },
  { key: "previous_report_card", label: "Previous Report Card" },
  { key: "transfer_letter",      label: "Transfer Letter"      },
] as const;

const actionConfig: Record<ActionType, {
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
}> = {
  submit:           { label: "Submit",           description: "Move DRAFT → SUBMITTED for office review.",          icon: Send,           iconColor: "text-blue-600"    },
  approve:          { label: "Approve",          description: "Verify documents and move to APPROVED.",             icon: CheckCircle,    iconColor: "text-emerald-600" },
  reject:           { label: "Reject",           description: "Reject this intake. A written reason is required.",  icon: XCircle,        iconColor: "text-red-500"     },
  enroll:           { label: "Mark Enrolled",    description: "Final enrollment. Requires Assessment + NEMIS No.",  icon: GraduationCap,  iconColor: "text-emerald-600" },
  transfer_request: { label: "Transfer Request", description: "Mark student as having a pending transfer request.", icon: ArrowRightLeft, iconColor: "text-amber-600"   },
  transfer_approve: { label: "Transfer Approve", description: "Complete transfer. Director-level authorization.",   icon: ShieldCheck,    iconColor: "text-purple-600"  },
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function studentName(payload: Record<string, unknown>): string {
  for (const key of ["student_name", "studentName", "full_name", "fullName", "name"]) {
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

function isNonEmpty(v: string): boolean { return v.trim().length > 0; }

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
      if (["true", "yes", "y", "1"].includes(normalized)) return true;
      if (["false", "no", "n", "0"].includes(normalized)) return false;
    }
  }
  return false;
}

function statusToSuggestedActions(s: string): ActionType[] {
  switch (s.toUpperCase()) {
    case "DRAFT":              return ["submit"];
    case "SUBMITTED":          return ["approve", "reject"];
    case "APPROVED":           return ["enroll", "transfer_request"];
    case "TRANSFER_REQUESTED": return ["transfer_approve"];
    default:                   return [];
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

// ─── Shared UI ────────────────────────────────────────────────────────────────

function FormField({ label, hint, children, required }: {
  label: string; hint?: string; children: React.ReactNode; required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium text-slate-700">
        {label}{required && <span className="ml-0.5 text-red-500">*</span>}
      </Label>
      {children}
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function EnrollmentStatusBadge({ status }: { status: string }) {
  const s = status.toUpperCase();
  const map: Record<string, string> = {
    ENROLLED:           "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    ENROLLED_PARTIAL:   "bg-teal-50 text-teal-700 ring-1 ring-teal-200",
    APPROVED:           "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
    SUBMITTED:          "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    DRAFT:              "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
    REJECTED:           "bg-red-50 text-red-700 ring-1 ring-red-200",
    TRANSFER_REQUESTED: "bg-purple-50 text-purple-700 ring-1 ring-purple-200",
    DELETED:            "bg-red-100 text-red-800 ring-1 ring-red-300",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[s] ?? "bg-slate-100 text-slate-600 ring-1 ring-slate-200"}`}>
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

function PaginationControls({ page, totalPages, setPage, totalItems, label = "records" }: {
  page: number; totalPages: number; setPage: (p: number) => void; totalItems: number; label?: string;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
      <span className="text-xs text-slate-400">{totalItems} {label} · Page {page} of {totalPages}</span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="h-7 w-7"
          onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
          let n: number;
          if (totalPages <= 5)             n = i + 1;
          else if (page <= 3)              n = i + 1;
          else if (page >= totalPages - 2) n = totalPages - 4 + i;
          else                             n = page - 2 + i;
          return (
            <Button key={n} variant={n === page ? "default" : "ghost"} size="icon"
              className={`h-7 w-7 text-xs ${n === page ? "bg-blue-600 text-white hover:bg-blue-700" : ""}`}
              onClick={() => setPage(n)}>
              {n}
            </Button>
          );
        })}
        <Button variant="ghost" size="icon" className="h-7 w-7"
          onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function SearchInput({ value, onChange, placeholder = "Search…" }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
      <Input value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} className="h-8 pl-8 text-xs" />
    </div>
  );
}

function ClassSelect({ value, onChange, classes, loadingClasses }: {
  value: string; onChange: (v: string) => void;
  classes: TenantClass[]; loadingClasses: boolean;
}) {
  return (
    <Select value={value || "__none__"} onValueChange={(v) => onChange(v === "__none__" ? "" : v)} disabled={loadingClasses}>
      <SelectTrigger>
        <SelectValue placeholder={loadingClasses ? "Loading classes…" : "Select a class"} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">{loadingClasses ? "Loading…" : "Select a class"}</SelectItem>
        {classes.map((c) => <SelectItem key={c.id} value={c.code}>{c.name}</SelectItem>)}
        {!loadingClasses && classes.length === 0 && (
          <SelectItem value="__empty__" disabled>No classes configured yet</SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}

function TermSelect({ value, onChange, terms, loadingTerms }: {
  value: string;
  onChange: (v: string) => void;
  terms: TenantTerm[];
  loadingTerms: boolean;
}) {
  return (
    <Select
      value={value || "__none__"}
      onValueChange={(v) => onChange(v === "__none__" ? "" : v)}
      disabled={loadingTerms}
    >
      <SelectTrigger>
        <SelectValue placeholder={loadingTerms ? "Loading terms…" : "Select term"} />
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

// ─── Student Detail Dialog ────────────────────────────────────────────────────

function StudentDetailDialog({ row, open, onClose }: {
  row: EnrollmentRow | null; open: boolean; onClose: () => void;
}) {
  if (!row) return null;
  const p = row.payload || {};
  const admNum = row.admission_number ?? (p as any)?.admission_number ?? "—";

  const fields = [
    { label: "Full Name",         value: studentName(p) },
    { label: "Admission Number",  value: admNum },
    { label: "Class",             value: studentClass(p) || "—" },
    { label: "Term",              value: termFromPayload(p) || "—" },
    { label: "Intake Date",       value: (p as any)?.intake_date || "—" },
    { label: "Date of Birth",     value: (p as any)?.date_of_birth || "—" },
    { label: "Gender",            value: (p as any)?.gender || "—" },
    { label: "Guardian Name",     value: (p as any)?.guardian_name || "—" },
    { label: "Guardian Phone",    value: (p as any)?.guardian_phone || "—" },
    { label: "Guardian Email",    value: (p as any)?.guardian_email || "—" },
    { label: "Previous School",   value: (p as any)?.previous_school || "—" },
    { label: "Assessment No.",    value: (p as any)?.assessment_no || "—" },
    { label: "NEMIS No.",         value: (p as any)?.nemis_no || "—" },
    { label: "Enrollment Source", value: (p as any)?.enrollment_source || "INTAKE" },
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
    { label: "Notes",             value: (p as any)?.notes || "—" },
  ];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-slate-500" /> Student Record
          </DialogTitle>
          <DialogDescription>Full details for {studentName(p)}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] overflow-y-auto space-y-4 pr-1">
          <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 flex-wrap">
            <EnrollmentStatusBadge status={row.status} />
            {admNum !== "—" && <span className="font-mono text-xs font-semibold text-emerald-700">{admNum}</span>}
            <span className="ml-auto font-mono text-[11px] text-slate-400 select-all">{row.id}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            {fields.map(({ label, value }) => (
              <div key={label} className="space-y-0.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
                <div className="text-sm font-medium text-slate-900 break-all">{value || "—"}</div>
              </div>
            ))}
          </div>
          {(p as any)?.documents && (
            <div className="rounded-xl border border-slate-100 overflow-hidden">
              <div className="bg-slate-50 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Documents</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-4">
                {requirementChecklist.map((item) => {
                  const checked = !!(p as any).documents?.[item.key];
                  return (
                    <div key={item.key} className="flex items-center gap-2 text-sm">
                      <span className={checked ? "text-emerald-500" : "text-red-400"}>{checked ? "✓" : "✗"}</span>
                      <span className={checked ? "text-slate-700" : "text-slate-400"}>{item.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Update Dialog ────────────────────────────────────────────────────────────
// Director has NO edit-count restrictions — can update at any time.

function UpdateEnrollmentDialog({ row, open, onClose, onSave, saving, classes, terms, loadingClasses, loadingTerms }: {
  row: EnrollmentRow | null; open: boolean; onClose: () => void;
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
        student_name:    String((p as any)?.student_name    ?? studentName(p)),
        admission_class: String((p as any)?.admission_class ?? studentClass(p) ?? ""),
        admission_term:  String((p as any)?.admission_term  ?? termFromPayload(p) ?? ""),
        intake_date:     String((p as any)?.intake_date     ?? ""),
        date_of_birth:   String((p as any)?.date_of_birth   ?? ""),
        gender:          String((p as any)?.gender          ?? ""),
        guardian_name:   String((p as any)?.guardian_name   ?? ""),
        guardian_phone:  String((p as any)?.guardian_phone  ?? ""),
        guardian_email:  String((p as any)?.guardian_email  ?? ""),
        previous_school: String((p as any)?.previous_school ?? ""),
        assessment_no:   String((p as any)?.assessment_no   ?? ""),
        nemis_no:        String((p as any)?.nemis_no        ?? ""),
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
        notes:           String((p as any)?.notes           ?? ""),
      });
    }
  }, [row]);

  if (!row) return null;

  const canSave = !saving && isNonEmpty(draft.student_name) && isNonEmpty(draft.admission_class)
    && isNonEmpty(draft.guardian_name) && isNonEmpty(draft.guardian_phone);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-slate-500" />
            Update Student — {studentName(row.payload || {})}
          </DialogTitle>
          <DialogDescription>
            Director-level edit — no update limit applies.{" "}
            Status: <span className="font-semibold">{row.status}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] overflow-y-auto pr-1">
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <FormField label="Full Name" required>
              <Input value={draft.student_name} onChange={(e) => setDraft((p) => ({ ...p, student_name: e.target.value }))} />
            </FormField>
            <FormField label="Admission Class" required hint="Select from configured school classes">
              <ClassSelect value={draft.admission_class} onChange={(v) => setDraft((p) => ({ ...p, admission_class: v }))}
                classes={classes} loadingClasses={loadingClasses} />
            </FormField>
            <FormField label="Admission Term" hint="Academic term this enrollment belongs to">
              <TermSelect
                value={draft.admission_term}
                onChange={(v) => setDraft((p) => ({ ...p, admission_term: v }))}
                terms={terms}
                loadingTerms={loadingTerms}
              />
            </FormField>
            <FormField label="Intake Date">
              <Input type="date" value={draft.intake_date} onChange={(e) => setDraft((p) => ({ ...p, intake_date: e.target.value }))} />
            </FormField>
            <FormField label="Date of Birth">
              <Input type="date" value={draft.date_of_birth} onChange={(e) => setDraft((p) => ({ ...p, date_of_birth: e.target.value }))} />
            </FormField>
            <FormField label="Gender">
              <Select value={draft.gender || "__none__"} onValueChange={(v) => setDraft((p) => ({ ...p, gender: v === "__none__" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Not specified</SelectItem>
                  <SelectItem value="MALE">Male</SelectItem>
                  <SelectItem value="FEMALE">Female</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Guardian Full Name" required>
              <Input value={draft.guardian_name} onChange={(e) => setDraft((p) => ({ ...p, guardian_name: e.target.value }))} />
            </FormField>
            <FormField label="Guardian Phone" required>
              <Input value={draft.guardian_phone} onChange={(e) => setDraft((p) => ({ ...p, guardian_phone: e.target.value }))} />
            </FormField>
            <FormField label="Guardian Email">
              <Input value={draft.guardian_email} onChange={(e) => setDraft((p) => ({ ...p, guardian_email: e.target.value }))} />
            </FormField>
            <FormField label="Previous School">
              <Input value={draft.previous_school} onChange={(e) => setDraft((p) => ({ ...p, previous_school: e.target.value }))} />
            </FormField>
            <FormField label="Assessment Number" hint="Required for final enroll action">
              <Input value={draft.assessment_no} onChange={(e) => setDraft((p) => ({ ...p, assessment_no: e.target.value }))} />
            </FormField>
            <FormField label="NEMIS Number">
              <Input value={draft.nemis_no} onChange={(e) => setDraft((p) => ({ ...p, nemis_no: e.target.value }))} />
            </FormField>
            <FormField label="Underlying Medical Condition">
              <Select
                value={draft.has_medical_conditions ? "YES" : "NO"}
                onValueChange={(v) =>
                  setDraft((p) => ({
                    ...p,
                    has_medical_conditions: v === "YES",
                    medical_conditions_details: v === "YES" ? p.medical_conditions_details : "",
                  }))
                }
              >
                <SelectTrigger><SelectValue placeholder="Select option" /></SelectTrigger>
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
                    medication_in_school_details: v === "YES" ? p.medication_in_school_details : "",
                  }))
                }
              >
                <SelectTrigger><SelectValue placeholder="Select option" /></SelectTrigger>
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
                  hint="Diagnosis, triggers, and emergency guidance."
                >
                  <Textarea
                    value={draft.medical_conditions_details}
                    rows={3}
                    className="resize-none"
                    onChange={(e) => setDraft((p) => ({ ...p, medical_conditions_details: e.target.value }))}
                  />
                </FormField>
              </div>
            )}
            {draft.has_medication_in_school && (
              <div className="md:col-span-2">
                <FormField
                  label="Medication Details"
                  hint="Medicine names, dosage, and school handling instructions."
                >
                  <Textarea
                    value={draft.medication_in_school_details}
                    rows={3}
                    className="resize-none"
                    onChange={(e) => setDraft((p) => ({ ...p, medication_in_school_details: e.target.value }))}
                  />
                </FormField>
              </div>
            )}
            <div className="md:col-span-2">
              <FormField label="Notes">
                <Textarea value={draft.notes} rows={3} className="resize-none" onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))} />
              </FormField>
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(row.id, draft)} disabled={!canSave} className="bg-blue-600 hover:bg-blue-700">
            {saving
              ? <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</span>
              : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Director Override Dialog ─────────────────────────────────────────────────

function DirectorOverrideDialog({ row, open, onClose, onConfirm, loading }: {
  row: EnrollmentRow | null; open: boolean; onClose: () => void;
  onConfirm: (note: string) => Promise<void>; loading: boolean;
}) {
  const [note, setNote] = useState("");
  useEffect(() => { if (open) setNote(""); }, [open]);
  if (!row) return null;
  const admissionNumber = row.admission_number ?? (row.payload as any)?.admission_number;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-blue-600" /> Unlock Secretary Edit Lock
          </DialogTitle>
          <DialogDescription>Reset the edit counter for this enrolled student record.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-800">{studentName(row.payload || {})}</span>
              <EnrollmentStatusBadge status={row.status} />
            </div>
            {admissionNumber && (
              <span className="font-mono text-xs font-semibold text-emerald-700">{admissionNumber}</span>
            )}
          </div>
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-red-800">
              <LockIcon className="h-3.5 w-3.5" />
              Edit counter will be reset to 0.
            </div>
            <p className="mt-1 text-xs text-red-700">
              Confirming this override resets the counter to 0, allowing {MAX_SECRETARY_EDITS} further secretary edits.
              This action is recorded in the audit log.
            </p>
          </div>
          <FormField label="Override Reason (optional but recommended)">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Guardian requested class change following fee clearance…"
              rows={3} className="resize-none" />
          </FormField>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={() => onConfirm(note)} disabled={loading} className="bg-blue-600 hover:bg-blue-700">
            {loading
              ? <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Unlocking…</span>
              : <span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Confirm Override</span>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete Confirmation Dialog ───────────────────────────────────────────────
//
// Two-step deletion flow:
//   Step 1 — Soft delete: status set to DELETED  (POST director enrollments action:"delete")
//   Step 2 — Hard delete: permanent removal from DB  (DELETE /api/v1/enrollments/{id})
//
// Director must explicitly confirm each step separately.

function DeleteStudentDialog({ row, open, onClose, onSoftDelete, onHardDelete, softDeleting, hardDeleting }: {
  row: EnrollmentRow | null; open: boolean; onClose: () => void;
  onSoftDelete: (id: string) => Promise<void>;
  onHardDelete: (id: string) => Promise<void>;
  softDeleting: boolean; hardDeleting: boolean;
}) {
  const [step, setStep] = useState<"soft" | "hard">("soft");
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    if (open) { setStep("soft"); setConfirmText(""); }
  }, [open, row?.id]);

  if (!row) return null;
  const name = studentName(row.payload || {});
  const admissionNumber = row.admission_number ?? (row.payload as any)?.admission_number;
  const isSoftDeleted = row.status.toUpperCase() === "DELETED";

  // If already soft-deleted, skip straight to hard delete step
  const currentStep = isSoftDeleted ? "hard" : step;
  const hardDeleteConfirmPhrase = "DELETE PERMANENTLY";

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-700">
            <Trash2 className="h-5 w-5" />
            {currentStep === "soft" ? "Delete Student Record" : "Permanently Delete Record"}
          </DialogTitle>
          <DialogDescription>
            {currentStep === "soft"
              ? "This will mark the student as DELETED. The record remains in the database until permanently removed."
              : "This will permanently erase all data for this student. This action cannot be undone."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Student info */}
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-800">{name}</span>
              <EnrollmentStatusBadge status={row.status} />
            </div>
            <div className="flex items-center gap-3 text-xs">
              {admissionNumber && (
                <span className="font-mono font-semibold text-emerald-700">{admissionNumber}</span>
              )}
              <span className="font-mono text-slate-400">{row.id.slice(0, 16)}…</span>
            </div>
          </div>

          {/* Step indicator */}
          <div className="flex items-center gap-2">
            <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${currentStep === "soft" ? "bg-amber-500 text-white" : "bg-red-100 text-red-400 line-through"}`}>1</div>
            <span className={`text-xs ${currentStep === "soft" ? "font-semibold text-amber-700" : "text-slate-400"}`}>Soft Delete (mark DELETED)</span>
            <div className="h-px flex-1 bg-slate-200" />
            <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${currentStep === "hard" ? "bg-red-600 text-white" : "bg-slate-100 text-slate-400"}`}>2</div>
            <span className={`text-xs ${currentStep === "hard" ? "font-semibold text-red-700" : "text-slate-400"}`}>Permanent Delete</span>
          </div>

          {currentStep === "soft" && (
            <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
                <AlertTriangle className="h-4 w-4" /> Student will be marked as DELETED
              </div>
              <p className="mt-1 text-xs text-amber-700">
                The student's record will be hidden from all standard views but remains recoverable.
                A second confirmation is required to permanently erase the data.
              </p>
            </div>
          )}

          {currentStep === "hard" && (
            <div className="space-y-3">
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-red-800">
                  <AlertTriangle className="h-4 w-4" /> This will permanently delete all data
                </div>
                <p className="mt-1 text-xs text-red-700">
                  All records, invoices, documents and audit history for <strong>{name}</strong> will be
                  permanently removed from this tenant's database. This cannot be undone.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-600">
                  Type <span className="font-mono text-red-600">{hardDeleteConfirmPhrase}</span> to confirm
                </Label>
                <Input
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={hardDeleteConfirmPhrase}
                  className="border-red-200 font-mono text-sm focus:ring-red-300"
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={softDeleting || hardDeleting}>Cancel</Button>

          {currentStep === "soft" && (
            <Button
              onClick={async () => { await onSoftDelete(row.id); setStep("hard"); }}
              disabled={softDeleting}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {softDeleting
                ? <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Deleting…</span>
                : <span className="flex items-center gap-1.5"><Trash2 className="h-3.5 w-3.5" /> Mark as Deleted</span>}
            </Button>
          )}

          {currentStep === "hard" && (
            <Button
              onClick={() => onHardDelete(row.id)}
              disabled={hardDeleting || confirmText !== hardDeleteConfirmPhrase}
              className="bg-red-600 hover:bg-red-700"
            >
              {hardDeleting
                ? <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Deleting forever…</span>
                : <span className="flex items-center gap-1.5"><Trash2 className="h-3.5 w-3.5" /> Permanently Delete</span>}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function TenantEnrollmentsPageContent() {
  const searchParams = useSearchParams();
  const section: EnrollmentSection =
    searchParams.get("section") === "students" ? "students" : "intake";
  const activeEnrollmentsHref = directorEnrollmentsHref(section);

  // ── Data ──
  const [rows, setRows]       = useState<EnrollmentRow[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Classes ──
  const [tenantClasses, setTenantClasses]   = useState<TenantClass[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [tenantTerms, setTenantTerms] = useState<TenantTerm[]>([]);
  const [loadingTerms, setLoadingTerms] = useState(true);

  // ── Workflow ──
  const [selectedAction, setSelectedAction] = useState<ActionType>("approve");
  const [targetId, setTargetId]             = useState("");
  const [rejectReason, setRejectReason]     = useState("");
  const [submitting, setSubmitting]         = useState(false);

  // ── Search ──
  const [workflowSearch, setWorkflowSearch]           = useState("");
  const [queueSearch, setQueueSearch]                 = useState("");
  const [studentsSearch, setStudentsSearch]           = useState("");
  const [studentsClassFilter, setStudentsClassFilter] = useState("__all__");
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

  // ── Dialogs ──
  const [viewOpen, setViewOpen]             = useState(false);
  const [viewRow, setViewRow]               = useState<EnrollmentRow | null>(null);

  const [updateOpen, setUpdateOpen]         = useState(false);
  const [updateRow, setUpdateRow]           = useState<EnrollmentRow | null>(null);
  const [updateSaving, setUpdateSaving]     = useState(false);

  const [deleteOpen, setDeleteOpen]         = useState(false);
  const [deleteRow, setDeleteRow]           = useState<EnrollmentRow | null>(null);
  const [softDeleting, setSoftDeleting]     = useState(false);
  const [hardDeleting, setHardDeleting]     = useState(false);

  const [overrideOpen, setOverrideOpen]       = useState(false);
  const [overrideRow, setOverrideRow]         = useState<EnrollmentRow | null>(null);
  const [overrideLoading, setOverrideLoading] = useState(false);

  const [rejectDialogOpen, setRejectDialogOpen]   = useState(false);
  const [rejectDialogTargetId, setRejectDialogTargetId] = useState("");
  const [rejectDialogText, setRejectDialogText]   = useState("");

  // ── Loaders ───────────────────────────────────────────────────────────────

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await api.get<EnrollmentRow[]>("/enrollments/", { tenantRequired: true });
      setRows(Array.isArray(data) ? data : []);
    } catch (err: any) {
      if (!silent) toast.error(typeof err?.message === "string" ? err.message : "Failed to load enrollments");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

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

  const loadWorkflowPage = useCallback(async (silent = false) => {
    if (!silent) setWorkflowLoading(true);
    try {
      const pageData = await fetchEnrollmentPage({
        page: workflowPage,
        search: workflowSearch,
        statusNotIn: ["ENROLLED", "ENROLLED_PARTIAL", "DELETED"],
      });
      setWorkflowPageData(pageData);
      const maxPage = totalPagesFor(pageData.total);
      if (workflowPage > maxPage) setWorkflowPage(maxPage);
    } catch (err: any) {
      setWorkflowPageData(EMPTY_ENROLLMENT_PAGE);
      if (!silent) {
        toast.error(
          typeof err?.message === "string" ? err.message : "Failed to load workflow records."
        );
      }
    } finally {
      if (!silent) setWorkflowLoading(false);
    }
  }, [fetchEnrollmentPage, workflowPage, workflowSearch]);

  const loadQueuePage = useCallback(async (silent = false) => {
    if (!silent) setQueueLoading(true);
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
      if (!silent) {
        toast.error(
          typeof err?.message === "string" ? err.message : "Failed to load enrollment queue."
        );
      }
    } finally {
      if (!silent) setQueueLoading(false);
    }
  }, [fetchEnrollmentPage, queuePage, queueSearch]);

  const loadStudentsPage = useCallback(async (silent = false) => {
    if (!silent) setStudentsLoading(true);
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
      if (!silent) {
        toast.error(
          typeof err?.message === "string" ? err.message : "Failed to load enrolled students."
        );
      }
    } finally {
      if (!silent) setStudentsLoading(false);
    }
  }, [
    fetchEnrollmentPage,
    studentsPage,
    studentsSearch,
    studentsClassFilter,
    studentsTermFilter,
  ]);

  const reloadPagedTables = useCallback(async (silent = false) => {
    await Promise.all([
      loadWorkflowPage(silent),
      loadQueuePage(silent),
      loadStudentsPage(silent),
    ]);
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
    void load();
    const t = setInterval(() => {
      void Promise.all([load(true), reloadPagedTables(true)]);
    }, 15_000);
    return () => clearInterval(t);
  }, [load, reloadPagedTables]);

 useEffect(() => {
  let mounted = true;
  setLoadingClasses(true);

  (async () => {
    try {
      const data = await api.get<any[]>(
        "/tenants/classes",
        { tenantRequired: true } // your client should inject X-Tenant-Slug + Authorization
      );

      if (!mounted) return;
      setTenantClasses(Array.isArray(data) ? data : []);
    } finally {
      if (mounted) setLoadingClasses(false);
    }
  })();

  return () => { mounted = false; };
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
        setTenantTerms(normalized.length > 0 ? normalized : buildDefaultTerms());
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

  // ── Derived ───────────────────────────────────────────────────────────────

  const enrolledRows = useMemo(
    () => rows.filter((r) => ["ENROLLED", "ENROLLED_PARTIAL"].includes(r.status.toUpperCase())),
    [rows]
  );

  const uniqueClasses = useMemo(() => {
    const s = new Set<string>();
    enrolledRows.forEach((r) => { const c = studentClass(r.payload || {}); if (c) s.add(c); });
    return Array.from(s).sort();
  }, [enrolledRows]);

  const uniqueTerms = useMemo(() => {
    const s = new Set<string>();
    enrolledRows.forEach((r) => {
      const term = termFromPayload(r.payload || {});
      if (term) s.add(term);
    });
    return Array.from(s).sort();
  }, [enrolledRows]);

  const chartData = useMemo(
    () => Object.entries(
      rows.reduce((acc, r) => {
        const k = r.status.toUpperCase();
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    ).map(([status, count]) => ({ status, count })),
    [rows]
  );

  const pendingCount = useMemo(
    () => rows.filter((r) => ["SUBMITTED", "APPROVED"].includes(r.status.toUpperCase())).length,
    [rows]
  );
  // ── Pagination ────────────────────────────────────────────────────────────
  const workflowRows = workflowPageData.items;
  const queueRows = queuePageData.items;
  const studentsRows = studentsPageData.items;

  const workflowTotalPages = totalPagesFor(workflowPageData.total);
  const queueTotalPages = totalPagesFor(queuePageData.total);
  const studentsTotalPages = totalPagesFor(studentsPageData.total);

  // ── API calls ─────────────────────────────────────────────────────────────

  async function runWorkflowAction(enrollmentId: string, act: ActionType, reason?: string) {
    setSubmitting(true);
    try {
      await api.post<any>(
        act === "submit"
          ? `/enrollments/${enrollmentId}/submit`
          : act === "approve"
            ? `/enrollments/${enrollmentId}/approve`
            : act === "reject"
              ? `/enrollments/${enrollmentId}/reject`
              : act === "enroll"
                ? `/enrollments/${enrollmentId}/enroll`
                : act === "transfer_request"
                  ? `/enrollments/${enrollmentId}/transfer/request`
                  : `/enrollments/${enrollmentId}/transfer/approve`,
        act === "reject" ? { reason: reason?.trim() || null } : undefined,
        { tenantRequired: true }
      );
      toast.success(`Action "${actionConfig[act].label}" completed successfully.`);
      await Promise.all([load(true), reloadPagedTables()]);
    } catch (err: any) {
      toast.error(typeof err?.message === "string" ? err.message : "Action failed: service unavailable.");
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
            student_name:    d.student_name.trim(),
            admission_class: d.admission_class.trim(),
            admission_term:  d.admission_term.trim() || null,
            intake_date:     d.intake_date || null,
            date_of_birth:   d.date_of_birth || null,
            gender:          d.gender || null,
            guardian_name:   d.guardian_name.trim(),
            guardian_phone:  d.guardian_phone.trim(),
            guardian_email:  d.guardian_email.trim() || null,
            previous_school: d.previous_school.trim() || null,
            assessment_no:   d.assessment_no.trim() || null,
            nemis_no:        d.nemis_no.trim() || null,
            has_medical_conditions: d.has_medical_conditions,
            medical_conditions_details: d.has_medical_conditions
              ? d.medical_conditions_details.trim() || null
              : null,
            has_medication_in_school: d.has_medication_in_school,
            medication_in_school_details: d.has_medication_in_school
              ? d.medication_in_school_details.trim() || null
              : null,
            notes:           d.notes.trim() || null,
          },
        },
        { tenantRequired: true }
      );
      toast.success("Student record updated successfully.");
      setUpdateOpen(false); setUpdateRow(null);
      await Promise.all([load(true), reloadPagedTables()]);
    } catch (err: any) {
      toast.error(typeof err?.message === "string" ? err.message : "Update failed: service unavailable.");
    } finally {
      setUpdateSaving(false);
    }
  }

  async function softDeleteStudent(id: string) {
    setSoftDeleting(true);
    try {
      await api.post<any>(
        `/enrollments/${id}/soft-delete`,
        undefined,
        { tenantRequired: true }
      );
      // Update local state immediately so dialog shows updated status
      setRows((prev) => prev.map((r) => r.id === id ? { ...r, status: "DELETED" } : r));
      setDeleteRow((prev) => prev ? { ...prev, status: "DELETED" } : prev);
      toast.success("Student marked as DELETED.");
      await Promise.all([load(true), reloadPagedTables()]);
    } catch (err: any) {
      toast.error(typeof err?.message === "string" ? err.message : "Delete failed: service unavailable.");
    } finally {
      setSoftDeleting(false);
    }
  }

  async function hardDeleteStudent(id: string) {
    setHardDeleting(true);
    try {
      await api.delete<any>(`/enrollments/${id}`, undefined, { tenantRequired: true });
      setRows((prev) => prev.filter((r) => r.id !== id));
      setDeleteOpen(false); setDeleteRow(null);
      toast.success("Student record permanently deleted from the system.");
      await Promise.all([load(true), reloadPagedTables()]);
    } catch (err: any) {
      toast.error(typeof err?.message === "string" ? err.message : "Permanent delete failed: service unavailable.");
    } finally {
      setHardDeleting(false);
    }
  }

  async function runDirectorOverride(note: string) {
    if (!overrideRow) return;
    setOverrideLoading(true);
    try {
      await api.post<any>(`/enrollments/${overrideRow.id}/director-override`, { note: note.trim() || null }, { tenantRequired: true });
      toast.success(`Edit lock cleared for ${studentName(overrideRow.payload || {})}.`);
      setOverrideOpen(false); setOverrideRow(null);
      await Promise.all([load(true), reloadPagedTables()]);
    } catch (err: any) {
      toast.error(typeof err?.message === "string" ? err.message : "Override failed: service unavailable.");
    } finally {
      setOverrideLoading(false);
    }
  }

  async function confirmRejectDialog() {
    setRejectDialogOpen(false);
    await runWorkflowAction(rejectDialogTargetId, "reject", rejectDialogText);
  }

  // ── Action dispatcher (from ⋯ menu in workflow table) ────────────────────

  function dispatchAction(row: EnrollmentRow, act: ActionType) {
    if (act === "reject") {
      setRejectDialogTargetId(row.id);
      setRejectDialogText("");
      setRejectDialogOpen(true);
      return;
    }
    void runWorkflowAction(row.id, act);
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppShell title="Director" nav={directorNav} activeHref={activeEnrollmentsHref}>
      <div className="space-y-5">

        {/* ── Dialogs — always mounted ── */}

        <StudentDetailDialog row={viewRow} open={viewOpen} onClose={() => { setViewOpen(false); setViewRow(null); }} />

        <UpdateEnrollmentDialog
          row={updateRow} open={updateOpen}
          onClose={() => { setUpdateOpen(false); setUpdateRow(null); }}
          onSave={saveUpdate} saving={updateSaving}
          classes={tenantClasses}
          terms={tenantTerms}
          loadingClasses={loadingClasses}
          loadingTerms={loadingTerms}
        />

        <DeleteStudentDialog
          row={deleteRow} open={deleteOpen}
          onClose={() => { setDeleteOpen(false); setDeleteRow(null); }}
          onSoftDelete={softDeleteStudent} onHardDelete={hardDeleteStudent}
          softDeleting={softDeleting} hardDeleting={hardDeleting}
        />

        <DirectorOverrideDialog
          row={overrideRow} open={overrideOpen}
          onClose={() => { setOverrideOpen(false); setOverrideRow(null); }}
          onConfirm={runDirectorOverride} loading={overrideLoading}
        />

        {/* Reject dialog */}
        <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
          <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-[520px]">
            <DialogHeader>
              <DialogTitle>Reject Enrollment</DialogTitle>
              <DialogDescription>Provide a written reason. This will be recorded in the workflow.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rejection Reason *</Label>
              <Textarea value={rejectDialogText} onChange={(e) => setRejectDialogText(e.target.value)}
                placeholder="State the reason for rejection…" rows={4} className="resize-none" />
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>Cancel</Button>
              <Button onClick={confirmRejectDialog} disabled={submitting || !rejectDialogText.trim()}
                className="bg-red-600 hover:bg-red-700">
                {submitting
                  ? <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Rejecting…</span>
                  : "Confirm Reject"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Page Header ── */}
        <div className="dashboard-hero rounded-[2rem] p-5 text-white shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold">
                {section === "students" ? "Enrolled Students" : "Enrollment Operations"}
              </h1>
              <p className="mt-0.5 text-sm text-blue-100">
                {section === "students"
                  ? "Manage student records — view, edit, and permanently remove learners."
                  : "Director-level approval workflow for student intake management."}
              </p>
            </div>
            <div className="flex items-center gap-3 text-right text-sm text-blue-100">
              <div>
                <div className="text-xl font-bold text-white">{rows.length}</div>
                <div className="text-xs">Total</div>
              </div>
              <div className="h-8 w-px bg-blue-400" />
              <div>
                <div className="text-xl font-bold text-white">{enrolledRows.length}</div>
                <div className="text-xs">Enrolled</div>
              </div>
              {pendingCount > 0 && (
                <>
                  <div className="h-8 w-px bg-blue-400" />
                  <div>
                    <div className="text-xl font-bold text-amber-300">{pendingCount}</div>
                    <div className="text-xs">Pending</div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════════
            INTAKE SECTION
        ══════════════════════════════════════════════════════════════ */}
        {section === "intake" && (
          <div className="space-y-5">

            {/* 1) OVERVIEW */}
            <div className="grid gap-5 xl:grid-cols-3">
              <div className="dashboard-surface rounded-[1.6rem] p-5">
                <h3 className="mb-3 text-sm font-semibold text-slate-800">Enrollment Status Overview</h3>
                {chartData.length > 0 ? (
                  <ChartContainer config={chartConfig} className="h-[200px] w-full">
                    <BarChart accessibilityLayer data={chartData}>
                      <CartesianGrid vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="status" tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 10 }} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="count" fill="var(--color-count)" radius={6} />
                    </BarChart>
                  </ChartContainer>
                ) : (
                  <div className="flex h-[200px] items-center justify-center text-sm text-slate-400">No enrollment data yet</div>
                )}
              </div>

              <div className="xl:col-span-2 dashboard-surface rounded-[1.6rem] p-5">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">Pipeline Snapshot</h3>
                    <p className="mt-0.5 text-xs text-slate-500">Current status distribution across all records.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">Total: {rows.length}</Badge>
                    <Badge variant="secondary" className="text-xs">Enrolled: {enrolledRows.length}</Badge>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  {["DRAFT", "SUBMITTED", "APPROVED"].map((s) => {
                    const count = rows.filter((r) => r.status.toUpperCase() === s).length;
                    const accent = s === "SUBMITTED" ? "border-amber-100 bg-amber-50"
                      : s === "APPROVED" ? "border-blue-100 bg-blue-50"
                      : "border-slate-100 bg-slate-50";
                    return (
                      <div key={s} className={`rounded-xl border ${accent} px-4 py-3`}>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{s}</div>
                        <div className="mt-1 text-2xl font-bold text-slate-900">{count}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 2) WORKFLOW ACTIONS TABLE */}
            <div className="dashboard-surface rounded-[1.6rem]">
              <div className="border-b border-slate-100 px-6 py-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Workflow Actions</h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Use the ⋯ menu to run workflow actions. Click a row to view full details.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <SearchInput value={workflowSearch} onChange={setWorkflowSearch} placeholder="Search student, class, ID…" />
                  <button onClick={() => void Promise.all([load(true), reloadPagedTables(true)])}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 transition">
                    <RefreshCw className="h-3 w-3" /> Refresh
                  </button>
                  <span className="text-xs text-slate-400 whitespace-nowrap">{workflowPageData.total} records</span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs">Student</TableHead>
                      <TableHead className="text-xs">Adm. No.</TableHead>
                      <TableHead className="text-xs">Class</TableHead>
                      <TableHead className="text-xs">Term</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs">Intake Date</TableHead>
                      <TableHead className="text-xs">Record ID</TableHead>
                      <TableHead className="text-xs w-[60px] text-right"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!workflowLoading && workflowRows.map((row) => {
                      const admNum     = row.admission_number ?? (row.payload as any)?.admission_number;
                      const intakeDate = (row.payload as any)?.intake_date;
                      const suggested  = statusToSuggestedActions(row.status);

                      return (
                        <TableRow key={row.id}
                          className={`cursor-pointer hover:bg-slate-50 ${targetId === row.id ? "bg-blue-50/40" : ""}`}
                          onClick={() => { setTargetId(row.id); setViewRow(row); setViewOpen(true); }}>
                          <TableCell className="text-sm font-medium">{studentName(row.payload || {})}</TableCell>
                          <TableCell>
                            {admNum
                              ? <span className="font-mono text-xs font-semibold text-emerald-700">{admNum}</span>
                              : <span className="text-xs text-slate-300">—</span>}
                          </TableCell>
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
                          <TableCell className="font-mono text-xs text-slate-400">{row.id.slice(0, 8)}…</TableCell>
                          <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setTargetId(row.id); }}>
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-64">
                                <DropdownMenuLabel className="text-xs">Workflow Actions</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                {(Object.keys(actionConfig) as ActionType[]).map((act) => {
                                  const cfg = actionConfig[act];
                                  const ActionIcon = cfg.icon;
                                  const isSugg = suggested.includes(act);
                                  return (
                                    <DropdownMenuItem key={act}
                                      onClick={() => dispatchAction(row, act)}
                                      className="flex items-start gap-2">
                                      <ActionIcon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${cfg.iconColor}`} />
                                      <div className="flex-1">
                                        <div className="text-sm font-medium">
                                          {cfg.label}
                                          {isSugg && (
                                            <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 ring-1 ring-blue-200">Suggested</span>
                                          )}
                                        </div>
                                        <div className="mt-0.5 text-xs text-slate-400">{cfg.description}</div>
                                      </div>
                                    </DropdownMenuItem>
                                  );
                                })}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => { setViewRow(row); setViewOpen(true); }}
                                  className="flex items-center gap-2">
                                  <Eye className="h-3.5 w-3.5 text-slate-500" />
                                  <span className="text-sm">View Full Record</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => { setUpdateRow(row); setUpdateOpen(true); }}
                                  className="flex items-center gap-2">
                                  <Pencil className="h-3.5 w-3.5 text-slate-500" />
                                  <span className="text-sm">Edit Record</span>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {!workflowLoading && workflowRows.length === 0 && (
                      <EmptyRow colSpan={8}
                        message={workflowSearch ? "No results match your search." : "No pending workflow items."} />
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

            {/* 3) ENROLLMENT QUEUE */}
            <div className="dashboard-surface rounded-[1.6rem]">
              <div className="border-b border-slate-100 px-5 py-4 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Enrollment Queue</h3>
                  <p className="mt-0.5 text-xs text-slate-500">All records across all statuses. Click a row to view full details.</p>
                </div>
                <div className="flex items-center gap-3">
                  <SearchInput value={queueSearch} onChange={setQueueSearch} placeholder="Search student, class, ADM…" />
                  <span className="text-xs text-slate-400 whitespace-nowrap">{queuePageData.total} records</span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs">Student</TableHead>
                      <TableHead className="text-xs">Adm. No.</TableHead>
                      <TableHead className="text-xs">Class</TableHead>
                      <TableHead className="text-xs">Term</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs">Intake Date</TableHead>
                      <TableHead className="text-xs">Record ID</TableHead>
                      <TableHead className="text-xs"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!queueLoading && queueRows.map((row) => {
                      const admNum     = row.admission_number ?? (row.payload as any)?.admission_number;
                      const intakeDate = (row.payload as any)?.intake_date;
                      return (
                        <TableRow key={row.id}
                          className={`cursor-pointer hover:bg-slate-50 ${targetId === row.id ? "bg-blue-50" : ""}`}
                          onClick={() => { setTargetId(row.id); setViewRow(row); setViewOpen(true); }}>
                          <TableCell className="text-sm font-medium">{studentName(row.payload || {})}</TableCell>
                          <TableCell>
                            {admNum
                              ? <span className="font-mono text-xs font-semibold text-emerald-700">{admNum}</span>
                              : <span className="text-xs text-slate-300">Not assigned</span>}
                          </TableCell>
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
                          <TableCell className="font-mono text-xs text-slate-400">{row.id.slice(0, 8)}…</TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => { setTargetId(row.id); setViewRow(row); setViewOpen(true); }}
                              className="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 transition">
                              View
                            </button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {!queueLoading && queueRows.length === 0 && (
                      <EmptyRow colSpan={8} message={queueSearch ? "No results match your search." : "No enrollments found."} />
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
          <div className="dashboard-surface rounded-[1.6rem]">
            <div className="border-b border-slate-100 px-6 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Enrolled Students</h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Director-level management. View, edit, or permanently remove student records.
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
                      {uniqueClasses.map((cls) => <SelectItem key={cls} value={cls}>{cls}</SelectItem>)}
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
                    const admNum     = row.admission_number ?? (row.payload as any)?.admission_number;
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

                        {/* ── Director action cell ── */}
                        <TableCell className="py-2 text-center">
                          <div className="flex flex-col items-center gap-1.5">
                            {/* Row 1: View + Edit */}
                            <div className="flex items-center gap-1">
                              <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs"
                                onClick={() => { setViewRow(row); setViewOpen(true); }}>
                                <Eye className="h-3 w-3" /> View
                              </Button>
                              <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs"
                                onClick={() => { setUpdateRow(row); setUpdateOpen(true); }}>
                                <Pencil className="h-3 w-3" /> Edit
                              </Button>
                            </div>

                            {/* Row 2: Delete (always available to director) */}
                            <TooltipProvider delayDuration={200}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="ghost" size="sm"
                                    className="h-7 gap-1 px-2 text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
                                    onClick={() => { setDeleteRow(row); setDeleteOpen(true); }}>
                                    <Trash2 className="h-3 w-3" /> Delete
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs">
                                  Director-only: permanently remove this student record
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  {!studentsLoading && studentsRows.length === 0 && (
                    <EmptyRow colSpan={8}
                      message={studentsSearch || studentsClassFilter !== "__all__" || studentsTermFilter !== "__all__"
                        ? "No students match your search or filter."
                        : "No enrolled students found."} />
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
        )}
      </div>
    </AppShell>
  );
}

export default function TenantEnrollmentsPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          <p className="text-sm text-slate-500">Loading enrollments…</p>
        </div>
      </div>
    }>
      <TenantEnrollmentsPageContent />
    </Suspense>
  );
}
