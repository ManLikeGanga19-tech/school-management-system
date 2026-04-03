"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  RefreshCw,
  UserRound,
  ClipboardList,
  Users,
  Phone,
  FileText,
  Pencil,
  Trash2,
  Plus,
  Save,
  X,
  History,
  AlertTriangle,
} from "lucide-react";

import { AppShell, type AppNavItem } from "@/components/layout/AppShell";
import { CarryForwardDialog } from "@/components/finance/CarryForwardDialog";
import { Badge } from "@/components/ui/badge";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { asArray } from "@/lib/utils/asArray";

// ─── Types ────────────────────────────────────────────────────────────────────

type StudentProfilePageProps = {
  appTitle: string;
  nav: AppNavItem[];
  activeHref: string;
  enrollmentId: string;
  backHref: string;
};

type EnrollmentInfo = {
  id: string;
  status: string;
  admission_number: string | null;
  student_id: string | null;
  student_name: string;
  class_code: string;
  term_code: string;
  payload: Record<string, unknown>;
  created_at: string | null;
  updated_at: string | null;
};

type FinanceTotals = {
  total_invoiced: string;
  total_paid: string;
  total_balance: string;
  invoice_count: number;
  payment_count: number;
};

type ExamTotals = {
  record_count: number;
  subject_count: number;
  term_count: number;
};

type SisStudent = {
  id: string;
  admission_no: string;
  first_name: string;
  last_name: string;
  other_names: string | null;
  gender: string | null;
  date_of_birth: string | null;
  phone: string | null;
  email: string | null;
  nationality: string | null;
  religion: string | null;
  home_address: string | null;
  county: string | null;
  sub_county: string | null;
  upi: string | null;
  birth_certificate_no: string | null;
  previous_school: string | null;
  previous_class: string | null;
  status: string;
};

type Guardian = {
  parent_id: string;
  relationship: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  phone_alt: string | null;
  email: string | null;
  id_type: string | null;
  address: string | null;
};

type EmergencyContact = {
  id: string;
  name: string;
  relationship: string | null;
  phone: string;
  phone_alt: string | null;
  email: string | null;
  is_primary: boolean;
  notes: string | null;
};

type StudentDocument = {
  id: string;
  document_type: string;
  title: string;
  file_url: string;
  content_type: string | null;
  size_bytes: number | null;
  notes: string | null;
  uploaded_at: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
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

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function strOrNull(v: unknown): string | null {
  const s = str(v);
  return s || null;
}

function normalizeEnrollment(obj: Record<string, unknown>): EnrollmentInfo {
  const payload = asObject(obj.payload) ?? {};
  return {
    id: str(obj.id),
    status: str(obj.status),
    admission_number: strOrNull(obj.admission_number),
    student_id: strOrNull(obj.student_id),
    student_name: str(obj.student_name) || "Student",
    class_code: str(obj.class_code),
    term_code: str(obj.term_code),
    payload,
    created_at: strOrNull(obj.created_at),
    updated_at: strOrNull(obj.updated_at),
  };
}

function normalizeSisStudent(obj: Record<string, unknown>): SisStudent {
  return {
    id: str(obj.id),
    admission_no: str(obj.admission_no),
    first_name: str(obj.first_name),
    last_name: str(obj.last_name),
    other_names: strOrNull(obj.other_names),
    gender: strOrNull(obj.gender),
    date_of_birth: strOrNull(obj.date_of_birth),
    phone: strOrNull(obj.phone),
    email: strOrNull(obj.email),
    nationality: strOrNull(obj.nationality),
    religion: strOrNull(obj.religion),
    home_address: strOrNull(obj.home_address),
    county: strOrNull(obj.county),
    sub_county: strOrNull(obj.sub_county),
    upi: strOrNull(obj.upi),
    birth_certificate_no: strOrNull(obj.birth_certificate_no),
    previous_school: strOrNull(obj.previous_school),
    previous_class: strOrNull(obj.previous_class),
    status: str(obj.status),
  };
}

function normalizeGuardian(obj: Record<string, unknown>): Guardian {
  return {
    parent_id: str(obj.parent_id),
    relationship: strOrNull(obj.relationship),
    first_name: strOrNull(obj.first_name),
    last_name: strOrNull(obj.last_name),
    phone: strOrNull(obj.phone),
    phone_alt: strOrNull(obj.phone_alt),
    email: strOrNull(obj.email),
    id_type: strOrNull(obj.id_type),
    address: strOrNull(obj.address),
  };
}

function normalizeContact(obj: Record<string, unknown>): EmergencyContact {
  return {
    id: str(obj.id),
    name: str(obj.name),
    relationship: strOrNull(obj.relationship),
    phone: str(obj.phone),
    phone_alt: strOrNull(obj.phone_alt),
    email: strOrNull(obj.email),
    is_primary: Boolean(obj.is_primary),
    notes: strOrNull(obj.notes),
  };
}

function normalizeDocument(obj: Record<string, unknown>): StudentDocument {
  return {
    id: str(obj.id),
    document_type: str(obj.document_type),
    title: str(obj.title),
    file_url: str(obj.file_url),
    content_type: strOrNull(obj.content_type),
    size_bytes: obj.size_bytes != null ? toNumber(obj.size_bytes) : null,
    notes: strOrNull(obj.notes),
    uploaded_at: strOrNull(obj.uploaded_at),
  };
}

const DOC_TYPES = [
  "BIRTH_CERTIFICATE",
  "TRANSFER_LETTER",
  "NEMIS_REPORT",
  "ID_COPY",
  "MEDICAL_CERT",
  "OTHER",
];

type Tab = "overview" | "biodata" | "guardian" | "emergency" | "documents";

// ─── Sub-components ────────────────────────────────────────────────────────────

function FieldRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="mt-0.5 break-words text-sm font-medium text-slate-800">
        {value || <span className="text-slate-400">—</span>}
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function StudentProfilePage({
  appTitle,
  nav,
  activeHref,
  enrollmentId,
  backHref,
}: StudentProfilePageProps) {
  const [loading, setLoading] = useState(true);
  const [enrollment, setEnrollment] = useState<EnrollmentInfo | null>(null);
  const [financeTotals, setFinanceTotals] = useState<FinanceTotals | null>(null);
  const [examTotals, setExamTotals] = useState<ExamTotals | null>(null);

  const [tab, setTab] = useState<Tab>("overview");

  // Carry-forward
  const [cfDialogOpen, setCfDialogOpen] = useState(false);
  const [cfPendingCount, setCfPendingCount] = useState(0);
  const [cfPendingTotal, setCfPendingTotal] = useState("0");

  // SIS data
  const [sisStudent, setSisStudent] = useState<SisStudent | null>(null);
  const [sisLoading, setSisLoading] = useState(false);
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [documents, setDocuments] = useState<StudentDocument[]>([]);

  // Bio editing
  const [editingBio, setEditingBio] = useState(false);
  const [bioForm, setBioForm] = useState<Partial<SisStudent>>({});
  const [savingBio, setSavingBio] = useState(false);

  // Guardian editing
  const [editingGuardianId, setEditingGuardianId] = useState<string | null>(null);
  const [guardianForm, setGuardianForm] = useState<Partial<Guardian>>({});
  const [savingGuardian, setSavingGuardian] = useState(false);

  // Emergency contacts
  const [contactDialog, setContactDialog] = useState<"create" | "edit" | null>(null);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [contactForm, setContactForm] = useState({ name: "", relationship: "", phone: "", phone_alt: "", email: "", is_primary: false, notes: "" });
  const [savingContact, setSavingContact] = useState(false);
  const [deletingContactId, setDeletingContactId] = useState<string | null>(null);

  // Documents
  const [docDialog, setDocDialog] = useState(false);
  const [docForm, setDocForm] = useState({ document_type: "OTHER", title: "", file_url: "", notes: "" });
  const [savingDoc, setSavingDoc] = useState(false);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);

  // ── Load profile ──────────────────────────────────────────────────────────────
  const loadProfile = useCallback(async () => {
    const safeId = String(enrollmentId || "").trim();
    if (!safeId || !UUID_PATTERN.test(safeId)) {
      setLoading(false);
      toast.error("Invalid student profile link.");
      return;
    }
    setLoading(true);
    try {
      const raw = await api.get<unknown>(
        `/tenants/students/${encodeURIComponent(safeId)}/profile`,
        { tenantRequired: true, noRedirect: true }
      );
      const obj = asObject(raw);
      if (!obj) throw new Error("Invalid response");

      const enrollmentObj = asObject(obj.enrollment);
      if (!enrollmentObj) throw new Error("No enrollment");
      setEnrollment(normalizeEnrollment(enrollmentObj));

      const financeObj = asObject(obj.finance);
      const totalsObj = asObject(financeObj?.totals ?? null);
      if (totalsObj) {
        setFinanceTotals({
          total_invoiced: str(totalsObj.total_invoiced) || "0",
          total_paid: str(totalsObj.total_paid) || "0",
          total_balance: str(totalsObj.total_balance) || "0",
          invoice_count: toNumber(totalsObj.invoice_count),
          payment_count: toNumber(totalsObj.payment_count),
        });
      }

      const examsObj = asObject(obj.exams);
      const examTotalsObj = asObject(examsObj?.totals ?? null);
      if (examTotalsObj) {
        setExamTotals({
          record_count: toNumber(examTotalsObj.record_count),
          subject_count: toNumber(examTotalsObj.subject_count),
          term_count: toNumber(examTotalsObj.term_count),
        });
      }
    } catch {
      toast.error("Unable to load student profile.");
    } finally {
      setLoading(false);
    }
  }, [enrollmentId]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  // ── Load SIS data when student_id is available ────────────────────────────────
  const studentId = enrollment?.student_id ?? null;

  // ── Load carry-forward summary ────────────────────────────────────────────────
  const loadCfSummary = useCallback(async () => {
    if (!studentId) return;
    try {
      const res = await api.post("/secretary/finance/setup", {
        action: "get_carry_forward_summary",
        payload: { student_id: studentId },
      });
      const d = res.data?.data as { pending_count?: number; pending_total?: string } | undefined;
      setCfPendingCount(d?.pending_count ?? 0);
      setCfPendingTotal(d?.pending_total ?? "0");
    } catch {
      // non-critical — silently ignore
    }
  }, [studentId]);

  useEffect(() => {
    if (studentId) void loadCfSummary();
  }, [studentId, loadCfSummary]);

  const loadSis = useCallback(async () => {
    if (!studentId) return;
    setSisLoading(true);
    try {
      const [bioRaw, guardianRaw, contactRaw, docRaw] = await Promise.all([
        api.get<unknown>(`/students/${encodeURIComponent(studentId)}`, { tenantRequired: true, noRedirect: true }).catch(() => null),
        api.get<unknown>(`/students/${encodeURIComponent(studentId)}/guardian`, { tenantRequired: true, noRedirect: true }).catch(() => null),
        api.get<unknown>(`/students/${encodeURIComponent(studentId)}/emergency-contacts`, { tenantRequired: true, noRedirect: true }).catch(() => null),
        api.get<unknown>(`/students/${encodeURIComponent(studentId)}/documents`, { tenantRequired: true, noRedirect: true }).catch(() => null),
      ]);

      const bioObj = asObject(bioRaw);
      if (bioObj) setSisStudent(normalizeSisStudent(bioObj));

      setGuardians(
        asArray<unknown>(guardianRaw)
          .map((r) => asObject(r))
          .filter((r): r is Record<string, unknown> => Boolean(r))
          .map(normalizeGuardian)
      );
      setContacts(
        asArray<unknown>(contactRaw)
          .map((r) => asObject(r))
          .filter((r): r is Record<string, unknown> => Boolean(r))
          .map(normalizeContact)
      );
      setDocuments(
        asArray<unknown>(docRaw)
          .map((r) => asObject(r))
          .filter((r): r is Record<string, unknown> => Boolean(r))
          .map(normalizeDocument)
      );
    } catch {
      toast.error("Failed to load SIS data.");
    } finally {
      setSisLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    if (studentId && (tab === "biodata" || tab === "guardian" || tab === "emergency" || tab === "documents")) {
      void loadSis();
    }
  }, [tab, studentId, loadSis]);

  // ── Bio data save ─────────────────────────────────────────────────────────────
  function openEditBio() {
    if (!sisStudent) return;
    setBioForm({ ...sisStudent });
    setEditingBio(true);
  }

  async function saveBio() {
    if (!studentId) return;
    setSavingBio(true);
    try {
      const updated = await api.patch<unknown>(
        `/students/${encodeURIComponent(studentId)}/biodata`,
        bioForm,
        { tenantRequired: true }
      );
      const obj = asObject(updated);
      if (obj) setSisStudent(normalizeSisStudent(obj));
      setEditingBio(false);
      toast.success("Bio data updated.");
    } catch {
      toast.error("Failed to update bio data.");
    } finally {
      setSavingBio(false);
    }
  }

  // ── Guardian save ─────────────────────────────────────────────────────────────
  function openEditGuardian(g: Guardian) {
    setGuardianForm({ ...g });
    setEditingGuardianId(g.parent_id);
  }

  async function saveGuardian() {
    if (!studentId || !editingGuardianId) return;
    setSavingGuardian(true);
    try {
      const raw = await api.patch<unknown>(
        `/students/${encodeURIComponent(studentId)}/guardian/${encodeURIComponent(editingGuardianId)}`,
        guardianForm,
        { tenantRequired: true }
      );
      const updated = asArray<unknown>(raw)
        .map((r) => asObject(r))
        .filter((r): r is Record<string, unknown> => Boolean(r))
        .map(normalizeGuardian);
      if (updated.length) setGuardians(updated);
      else await loadSis();
      setEditingGuardianId(null);
      toast.success("Guardian updated.");
    } catch {
      toast.error("Failed to update guardian.");
    } finally {
      setSavingGuardian(false);
    }
  }

  // ── Emergency contacts ────────────────────────────────────────────────────────
  function openCreateContact() {
    setContactForm({ name: "", relationship: "", phone: "", phone_alt: "", email: "", is_primary: false, notes: "" });
    setEditingContactId(null);
    setContactDialog("create");
  }

  function openEditContact(c: EmergencyContact) {
    setContactForm({
      name: c.name,
      relationship: c.relationship ?? "",
      phone: c.phone,
      phone_alt: c.phone_alt ?? "",
      email: c.email ?? "",
      is_primary: c.is_primary,
      notes: c.notes ?? "",
    });
    setEditingContactId(c.id);
    setContactDialog("edit");
  }

  async function saveContact() {
    if (!studentId) return;
    if (!contactForm.name.trim() || !contactForm.phone.trim()) {
      toast.error("Name and phone are required.");
      return;
    }
    setSavingContact(true);
    try {
      if (editingContactId) {
        await api.patch<unknown>(
          `/students/${encodeURIComponent(studentId)}/emergency-contacts/${encodeURIComponent(editingContactId)}`,
          contactForm,
          { tenantRequired: true }
        );
      } else {
        await api.post<unknown>(
          `/students/${encodeURIComponent(studentId)}/emergency-contacts`,
          contactForm,
          { tenantRequired: true }
        );
      }
      await loadSis();
      setContactDialog(null);
      toast.success(editingContactId ? "Contact updated." : "Contact added.");
    } catch {
      toast.error("Failed to save contact.");
    } finally {
      setSavingContact(false);
    }
  }

  async function deleteContact(id: string) {
    if (!studentId) return;
    setSavingContact(true);
    try {
      await api.delete<unknown>(
        `/students/${encodeURIComponent(studentId)}/emergency-contacts/${encodeURIComponent(id)}`,
        { tenantRequired: true }
      );
      setContacts((prev) => prev.filter((c) => c.id !== id));
      setDeletingContactId(null);
      toast.success("Contact removed.");
    } catch {
      toast.error("Failed to remove contact.");
    } finally {
      setSavingContact(false);
    }
  }

  // ── Documents ─────────────────────────────────────────────────────────────────
  async function saveDocument() {
    if (!studentId) return;
    if (!docForm.title.trim() || !docForm.file_url.trim()) {
      toast.error("Title and URL are required.");
      return;
    }
    setSavingDoc(true);
    try {
      await api.post<unknown>(
        `/students/${encodeURIComponent(studentId)}/documents`,
        docForm,
        { tenantRequired: true }
      );
      await loadSis();
      setDocDialog(false);
      toast.success("Document registered.");
    } catch {
      toast.error("Failed to register document.");
    } finally {
      setSavingDoc(false);
    }
  }

  async function deleteDocument(id: string) {
    if (!studentId) return;
    setSavingDoc(true);
    try {
      await api.delete<unknown>(
        `/students/${encodeURIComponent(studentId)}/documents/${encodeURIComponent(id)}`,
        { tenantRequired: true }
      );
      setDocuments((prev) => prev.filter((d) => d.id !== id));
      setDeletingDocId(null);
      toast.success("Document removed.");
    } catch {
      toast.error("Failed to remove document.");
    } finally {
      setSavingDoc(false);
    }
  }

  // ── Tabs config ───────────────────────────────────────────────────────────────
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "Overview", icon: <ClipboardList className="h-3.5 w-3.5" /> },
    { id: "biodata", label: "Bio Data", icon: <UserRound className="h-3.5 w-3.5" /> },
    { id: "guardian", label: "Guardian", icon: <Users className="h-3.5 w-3.5" /> },
    { id: "emergency", label: "Emergency Contacts", icon: <Phone className="h-3.5 w-3.5" /> },
    { id: "documents", label: "Documents", icon: <FileText className="h-3.5 w-3.5" /> },
  ];

  const hasSis = Boolean(studentId);

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <AppShell title={appTitle} nav={nav} activeHref={activeHref}>
      <div className="space-y-5">
        {/* Hero */}
        <div className="dashboard-hero rounded-[2rem] p-5 text-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold">
                {loading ? "Student Profile" : enrollment?.student_name || "Student Profile"}
              </h1>
              <p className="mt-0.5 text-sm text-blue-100">
                {enrollment?.admission_number && (
                  <span className="font-mono mr-2">{enrollment.admission_number}</span>
                )}
                {enrollment?.class_code && (
                  <span className="mr-2">· {enrollment.class_code}</span>
                )}
                {enrollment?.status && (
                  <span className="opacity-75">{enrollment.status}</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white">
                <Link href={backHref}>
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back
                </Link>
              </Button>
              <Button variant="outline" className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => void loadProfile()}>
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </Button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-center">
              <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
              <p className="text-sm text-slate-500">Loading student profile…</p>
            </div>
          </div>
        ) : !enrollment ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Student profile could not be loaded.
          </div>
        ) : (
          <>
            {/* Quick stats */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: "Admission No.", value: enrollment.admission_number || "—", className: "font-mono text-emerald-700" },
                { label: "Class", value: enrollment.class_code || "—", className: "text-slate-900" },
                { label: "Invoiced", value: formatKes(financeTotals?.total_invoiced), className: "text-slate-900" },
                { label: "Balance", value: formatKes(financeTotals?.total_balance), className: "text-red-700" },
              ].map((c) => (
                <div key={c.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <div className="text-xs uppercase tracking-wide text-slate-500">{c.label}</div>
                  <div className={`mt-1 text-sm font-bold ${c.className}`}>{c.value}</div>
                </div>
              ))}
            </div>

            {/* Tabs */}
            <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
              <div className="flex gap-1 border-b border-slate-100 px-4 pt-3">
                {tabs.map((t) => {
                  const disabled = !hasSis && t.id !== "overview";
                  return (
                    <button
                      key={t.id}
                      onClick={() => !disabled && setTab(t.id)}
                      disabled={disabled}
                      className={`flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                        tab === t.id
                          ? "border-b-2 border-blue-600 text-blue-700"
                          : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      {t.icon}
                      {t.label}
                    </button>
                  );
                })}
                {!hasSis && (
                  <span className="ml-auto self-center text-xs text-slate-400 pr-2">
                    SIS record not linked
                  </span>
                )}
              </div>

              {/* ── OVERVIEW TAB ── */}
              {tab === "overview" && (
                <div className="space-y-6 p-6">
                  <div>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Enrollment Details</h3>
                    <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                      <FieldRow label="Full Name" value={enrollment.student_name} />
                      <FieldRow label="Admission Number" value={enrollment.admission_number} />
                      <FieldRow label="Class" value={enrollment.class_code} />
                      <FieldRow label="Term" value={enrollment.term_code} />
                      <FieldRow label="Status" value={enrollment.status} />
                    </div>
                  </div>
                  <div>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Finance Summary</h3>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                        <div className="text-xs text-slate-500">Invoiced</div>
                        <div className="mt-1 font-bold text-slate-900">{formatKes(financeTotals?.total_invoiced)}</div>
                      </div>
                      <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                        <div className="text-xs text-slate-500">Paid</div>
                        <div className="mt-1 font-bold text-emerald-700">{formatKes(financeTotals?.total_paid)}</div>
                      </div>
                      <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                        <div className="text-xs text-slate-500">Balance</div>
                        <div className="mt-1 font-bold text-red-700">{formatKes(financeTotals?.total_balance)}</div>
                      </div>
                    </div>
                  </div>
                  {/* ── Carry-Forward Balances ── */}
                  <div>
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Carry-Forward Balances
                      </h3>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1.5 text-xs"
                        onClick={() => setCfDialogOpen(true)}
                      >
                        <History className="h-3 w-3" />
                        Manage
                      </Button>
                    </div>
                    {cfPendingCount > 0 ? (
                      <button
                        className="w-full text-left rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 hover:bg-amber-100 transition-colors"
                        onClick={() => setCfDialogOpen(true)}
                      >
                        <div className="flex items-center gap-3">
                          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                          <div>
                            <p className="text-sm font-semibold text-amber-800">
                              {cfPendingCount} pending {cfPendingCount === 1 ? "balance" : "balances"}
                            </p>
                            <p className="text-xs text-amber-700">
                              Outstanding: KES {parseFloat(cfPendingTotal).toLocaleString("en-KE", { minimumFractionDigits: 2 })}
                              {" "}— will be included in next invoice if selected
                            </p>
                          </div>
                        </div>
                      </button>
                    ) : (
                      <button
                        className="w-full text-left rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 hover:bg-slate-100 transition-colors"
                        onClick={() => setCfDialogOpen(true)}
                      >
                        <p className="text-sm text-slate-400">No pending carry-forward balances</p>
                        <p className="text-xs text-slate-400 mt-0.5">Click to record outstanding balances from previous terms</p>
                      </button>
                    )}
                  </div>

                  <div>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Exam Summary</h3>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                        <div className="text-xs text-slate-500">Exam Records</div>
                        <div className="mt-1 font-bold text-slate-900">{examTotals?.record_count ?? 0}</div>
                      </div>
                      <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                        <div className="text-xs text-slate-500">Subjects</div>
                        <div className="mt-1 font-bold text-blue-700">{examTotals?.subject_count ?? 0}</div>
                      </div>
                      <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                        <div className="text-xs text-slate-500">Terms</div>
                        <div className="mt-1 font-bold text-emerald-700">{examTotals?.term_count ?? 0}</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ── BIO DATA TAB ── */}
              {tab === "biodata" && (
                <div className="p-6">
                  {sisLoading ? (
                    <div className="py-10 text-center text-sm text-slate-400">Loading…</div>
                  ) : !sisStudent ? (
                    <div className="py-10 text-center text-sm text-slate-400">No SIS record found.</div>
                  ) : editingBio ? (
                    <div className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {[
                          { key: "phone", label: "Phone" },
                          { key: "email", label: "Email" },
                          { key: "nationality", label: "Nationality" },
                          { key: "religion", label: "Religion" },
                          { key: "county", label: "County" },
                          { key: "sub_county", label: "Sub County" },
                          { key: "upi", label: "NEMIS UPI" },
                          { key: "birth_certificate_no", label: "Birth Cert No." },
                          { key: "previous_school", label: "Previous School" },
                          { key: "previous_class", label: "Previous Class" },
                        ].map(({ key, label }) => (
                          <div key={key} className="space-y-1.5">
                            <Label className="text-xs">{label}</Label>
                            <Input
                              value={(bioForm as Record<string, string | null>)[key] ?? ""}
                              onChange={(e) => setBioForm((p) => ({ ...p, [key]: e.target.value || null }))}
                            />
                          </div>
                        ))}
                        <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
                          <Label className="text-xs">Home Address</Label>
                          <Input
                            value={bioForm.home_address ?? ""}
                            onChange={(e) => setBioForm((p) => ({ ...p, home_address: e.target.value || null }))}
                          />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => void saveBio()} disabled={savingBio}>
                          <Save className="mr-1.5 h-3.5 w-3.5" />
                          {savingBio ? "Saving…" : "Save"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingBio(false)}>
                          <X className="mr-1.5 h-3.5 w-3.5" />Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex justify-end">
                        <Button size="sm" variant="outline" onClick={openEditBio}>
                          <Pencil className="mr-1.5 h-3.5 w-3.5" />Edit
                        </Button>
                      </div>
                      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                        <FieldRow label="Phone" value={sisStudent.phone} />
                        <FieldRow label="Email" value={sisStudent.email} />
                        <FieldRow label="Gender" value={sisStudent.gender} />
                        <FieldRow label="Date of Birth" value={sisStudent.date_of_birth} />
                        <FieldRow label="Nationality" value={sisStudent.nationality} />
                        <FieldRow label="Religion" value={sisStudent.religion} />
                        <FieldRow label="County" value={sisStudent.county} />
                        <FieldRow label="Sub County" value={sisStudent.sub_county} />
                        <FieldRow label="NEMIS UPI" value={sisStudent.upi} />
                        <FieldRow label="Birth Cert No." value={sisStudent.birth_certificate_no} />
                        <FieldRow label="Previous School" value={sisStudent.previous_school} />
                        <FieldRow label="Previous Class" value={sisStudent.previous_class} />
                        <div className="sm:col-span-2 lg:col-span-3">
                          <FieldRow label="Home Address" value={sisStudent.home_address} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── GUARDIAN TAB ── */}
              {tab === "guardian" && (
                <div className="p-6">
                  {sisLoading ? (
                    <div className="py-10 text-center text-sm text-slate-400">Loading…</div>
                  ) : guardians.length === 0 ? (
                    <div className="py-10 text-center text-sm text-slate-400">No guardian records found.</div>
                  ) : (
                    <div className="space-y-4">
                      {guardians.map((g) => (
                        <div key={g.parent_id} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                          {editingGuardianId === g.parent_id ? (
                            <div className="space-y-4">
                              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                {[
                                  { key: "first_name", label: "First Name" },
                                  { key: "last_name", label: "Last Name" },
                                  { key: "phone", label: "Phone" },
                                  { key: "phone_alt", label: "Alt Phone" },
                                  { key: "email", label: "Email" },
                                ].map(({ key, label }) => (
                                  <div key={key} className="space-y-1.5">
                                    <Label className="text-xs">{label}</Label>
                                    <Input
                                      value={(guardianForm as Record<string, string | null>)[key] ?? ""}
                                      onChange={(e) => setGuardianForm((p) => ({ ...p, [key]: e.target.value || null }))}
                                    />
                                  </div>
                                ))}
                                <div className="space-y-1.5">
                                  <Label className="text-xs">ID Type</Label>
                                  <Select value={guardianForm.id_type ?? ""} onValueChange={(v) => setGuardianForm((p) => ({ ...p, id_type: v || null }))}>
                                    <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="NATIONAL_ID">National ID</SelectItem>
                                      <SelectItem value="PASSPORT">Passport</SelectItem>
                                      <SelectItem value="OTHER">Other</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-1.5 sm:col-span-2">
                                  <Label className="text-xs">Address</Label>
                                  <Input value={guardianForm.address ?? ""} onChange={(e) => setGuardianForm((p) => ({ ...p, address: e.target.value || null }))} />
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <Button size="sm" onClick={() => void saveGuardian()} disabled={savingGuardian}>
                                  <Save className="mr-1.5 h-3.5 w-3.5" />{savingGuardian ? "Saving…" : "Save"}
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => setEditingGuardianId(null)}>
                                  <X className="mr-1.5 h-3.5 w-3.5" />Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div>
                              <div className="mb-3 flex items-center justify-between">
                                <div>
                                  <p className="text-sm font-semibold text-slate-800">
                                    {[g.first_name, g.last_name].filter(Boolean).join(" ") || "Guardian"}
                                  </p>
                                  {g.relationship && (
                                    <Badge variant="secondary" className="mt-0.5 text-xs">{g.relationship}</Badge>
                                  )}
                                </div>
                                <Button size="sm" variant="outline" onClick={() => openEditGuardian(g)}>
                                  <Pencil className="mr-1.5 h-3.5 w-3.5" />Edit
                                </Button>
                              </div>
                              <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                                <FieldRow label="Phone" value={g.phone} />
                                <FieldRow label="Alt Phone" value={g.phone_alt} />
                                <FieldRow label="Email" value={g.email} />
                                <FieldRow label="ID Type" value={g.id_type} />
                                <div className="sm:col-span-2">
                                  <FieldRow label="Address" value={g.address} />
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── EMERGENCY CONTACTS TAB ── */}
              {tab === "emergency" && (
                <div className="p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <p className="text-sm text-slate-500">{contacts.length} contact{contacts.length !== 1 ? "s" : ""}</p>
                    <Button size="sm" onClick={openCreateContact} disabled={savingContact}>
                      <Plus className="mr-1.5 h-3.5 w-3.5" />Add Contact
                    </Button>
                  </div>
                  {sisLoading ? (
                    <div className="py-10 text-center text-sm text-slate-400">Loading…</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-slate-50">
                            <TableHead className="text-xs">Name</TableHead>
                            <TableHead className="text-xs">Relationship</TableHead>
                            <TableHead className="text-xs">Phone</TableHead>
                            <TableHead className="text-xs">Email</TableHead>
                            <TableHead className="text-xs">Primary</TableHead>
                            <TableHead className="text-right text-xs">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {contacts.map((c) => (
                            <TableRow key={c.id}>
                              <TableCell className="text-sm font-medium">{c.name}</TableCell>
                              <TableCell className="text-xs text-slate-500">{c.relationship ?? "—"}</TableCell>
                              <TableCell className="text-xs">{c.phone}</TableCell>
                              <TableCell className="text-xs">{c.email ?? "—"}</TableCell>
                              <TableCell>
                                {c.is_primary && <Badge className="text-xs bg-emerald-50 text-emerald-700">Primary</Badge>}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-1">
                                  <button onClick={() => openEditContact(c)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition">
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button onClick={() => setDeletingContactId(c.id)} className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                          {contacts.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={6} className="py-10 text-center text-sm text-slate-400">No emergency contacts yet.</TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              )}

              {/* ── DOCUMENTS TAB ── */}
              {tab === "documents" && (
                <div className="p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <p className="text-sm text-slate-500">{documents.length} document{documents.length !== 1 ? "s" : ""}</p>
                    <Button size="sm" onClick={() => setDocDialog(true)} disabled={savingDoc}>
                      <Plus className="mr-1.5 h-3.5 w-3.5" />Register Document
                    </Button>
                  </div>
                  {sisLoading ? (
                    <div className="py-10 text-center text-sm text-slate-400">Loading…</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-slate-50">
                            <TableHead className="text-xs">Title</TableHead>
                            <TableHead className="text-xs">Type</TableHead>
                            <TableHead className="text-xs">Link</TableHead>
                            <TableHead className="text-xs">Uploaded</TableHead>
                            <TableHead className="text-right text-xs">Remove</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {documents.map((d) => (
                            <TableRow key={d.id}>
                              <TableCell className="text-sm font-medium">{d.title}</TableCell>
                              <TableCell>
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{d.document_type}</span>
                              </TableCell>
                              <TableCell>
                                <a href={d.file_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">View</a>
                              </TableCell>
                              <TableCell className="text-xs text-slate-500">{d.uploaded_at ? new Date(d.uploaded_at).toLocaleDateString() : "—"}</TableCell>
                              <TableCell className="text-right">
                                <button onClick={() => setDeletingDocId(d.id)} className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </TableCell>
                            </TableRow>
                          ))}
                          {documents.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={5} className="py-10 text-center text-sm text-slate-400">No documents registered yet.</TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Contact create/edit dialog ── */}
      <Dialog open={contactDialog !== null} onOpenChange={() => setContactDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{contactDialog === "edit" ? "Edit Contact" : "Add Emergency Contact"}</DialogTitle>
            <DialogDescription>Emergency contact for this student.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Name *</Label>
                <Input value={contactForm.name} onChange={(e) => setContactForm((p) => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Relationship</Label>
                <Input value={contactForm.relationship} onChange={(e) => setContactForm((p) => ({ ...p, relationship: e.target.value }))} placeholder="e.g. Uncle, Aunt" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Phone *</Label>
                <Input value={contactForm.phone} onChange={(e) => setContactForm((p) => ({ ...p, phone: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Alt Phone</Label>
                <Input value={contactForm.phone_alt} onChange={(e) => setContactForm((p) => ({ ...p, phone_alt: e.target.value }))} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label className="text-xs">Email</Label>
                <Input type="email" value={contactForm.email} onChange={(e) => setContactForm((p) => ({ ...p, email: e.target.value }))} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={contactForm.is_primary} onChange={(e) => setContactForm((p) => ({ ...p, is_primary: e.target.checked }))} className="h-4 w-4 rounded border-slate-300" />
              Mark as primary contact
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContactDialog(null)}>Cancel</Button>
            <Button onClick={() => void saveContact()} disabled={savingContact}>
              {savingContact ? "Saving…" : contactDialog === "edit" ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete contact confirm ── */}
      <Dialog open={deletingContactId !== null} onOpenChange={() => setDeletingContactId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Contact</DialogTitle>
            <DialogDescription>This will permanently remove the emergency contact.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingContactId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deletingContactId && void deleteContact(deletingContactId)} disabled={savingContact}>
              {savingContact ? "Removing…" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Document register dialog ── */}
      <Dialog open={docDialog} onOpenChange={setDocDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Register Document</DialogTitle>
            <DialogDescription>Link a document URL for this student.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Document Type</Label>
              <Select value={docForm.document_type} onValueChange={(v) => setDocForm((p) => ({ ...p, document_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOC_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Title *</Label>
              <Input value={docForm.title} onChange={(e) => setDocForm((p) => ({ ...p, title: e.target.value }))} placeholder="e.g. Birth Certificate 2024" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">File URL *</Label>
              <Input value={docForm.file_url} onChange={(e) => setDocForm((p) => ({ ...p, file_url: e.target.value }))} placeholder="https://…" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Input value={docForm.notes} onChange={(e) => setDocForm((p) => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDocDialog(false)}>Cancel</Button>
            <Button onClick={() => void saveDocument()} disabled={savingDoc}>
              {savingDoc ? "Saving…" : "Register"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete document confirm ── */}
      <Dialog open={deletingDocId !== null} onOpenChange={() => setDeletingDocId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Document</DialogTitle>
            <DialogDescription>Remove this document record? The file at the URL will not be deleted.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingDocId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deletingDocId && void deleteDocument(deletingDocId)} disabled={savingDoc}>
              {savingDoc ? "Removing…" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Carry-Forward Dialog ── */}
      {studentId && (
        <CarryForwardDialog
          open={cfDialogOpen}
          onOpenChange={setCfDialogOpen}
          studentId={studentId}
          studentName={enrollment?.student_name ?? "Student"}
          onChanged={() => void loadCfSummary()}
        />
      )}
    </AppShell>
  );
}
