"use client";

import { useCallback, useEffect, useState } from "react";
import { usePersistedState } from "@/lib/usePersistedState";
import {
  ArrowLeft,
  BarChart2,
  Check,
  ChevronRight,
  Copy,
  Download,
  Edit2,
  ExternalLink,
  KeyRound,
  Link2,
  Link2Off,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  Trash2,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
  WalletCards,
  X,
} from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { CarryForwardDialog } from "@/components/finance/CarryForwardDialog";
import { toast } from "@/components/ui/sonner";
import { AppShell } from "@/components/layout/AppShell";
import { directorNav } from "@/components/layout/nav-config";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
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

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type ParentListItem = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  child_count: number;
  outstanding_total: string | number;
  has_portal_access: boolean;
};

type LinkedChild = {
  link_id: string;
  enrollment_id: string;
  student_id: string | null;
  student_name: string;
  class_code: string;
  admission_number: string | null;
  relationship: string;
  is_primary: boolean;
  outstanding: string | number;
  balance_adjustment_net: string | number;
};

type ParentDetail = {
  id: string;
  first_name: string;
  last_name: string;
  name: string;
  phone: string;
  email: string | null;
  phone_alt: string | null;
  national_id: string | null;
  occupation: string | null;
  address: string | null;
  has_portal_access: boolean;
  children: LinkedChild[];
  outstanding_total: string | number;
};

type AllInvoice = {
  invoice_id: string;
  enrollment_id: string;
  student_name: string;
  invoice_type: string;
  invoice_no: string | null;
  status: string;
  total_amount: string | number;
  paid_amount: string | number;
  balance_amount: string | number;
  created_at?: string;
};

type PaymentRecord = {
  payment_id: string;
  receipt_no: string | null;
  provider: string;
  amount: string | number;
  received_at: string;
  student_name: string;
};

type SmsMessage = {
  id: string;
  message_body: string;
  status: string;
  created_at: string;
  sent_at: string | null;
  delivered_at: string | null;
};

type PortalToken = {
  id: string;
  label: string | null;
  is_active: boolean;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
};

type PortalTokenCreated = PortalToken & {
  raw_token: string;
  school_slug: string;
};

type DistributionLine = {
  invoice_id: string;
  enrollment_id: string;
  student_name: string;
  invoice_type: string;
  amount: string | number;
};

type PaymentPreview = {
  total: string | number;
  lines: DistributionLine[];
  unallocated: string | number;
};

type Analytics = {
  total_parents: number;
  total_outstanding: number;
  total_billed: number;
  collection_rate_pct: number;
  with_portal_access: number;
};

type Enrollment = { id: string; payload: Record<string, unknown> };

type SyncResult = {
  created: number;
  linked: number;
  already_existed: number;
  skipped_no_phone: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function toNum(v: string | number | undefined | null): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isNaN(n) ? 0 : n;
}

function fmtKes(v: string | number | undefined | null) {
  return `KES ${toNum(v).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" });
}

function normalizeType(t: string) {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function enrollmentName(payload: Record<string, unknown>): string {
  return (
    (payload?.student_name as string) ||
    (payload?.studentName as string) ||
    (payload?.full_name as string) ||
    "Unknown"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// UI primitives
// ─────────────────────────────────────────────────────────────────────────────

function Spinner({ sm }: { sm?: boolean }) {
  return <Loader2 className={`animate-spin text-slate-400 ${sm ? "h-3.5 w-3.5" : "h-5 w-5"}`} />;
}

function StatCard({
  label,
  value,
  sub,
  color = "slate",
  icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: "slate" | "blue" | "emerald" | "amber" | "red";
  icon?: React.ReactNode;
}) {
  const palette = {
    slate:   "bg-white border-slate-200 text-slate-800",
    blue:    "bg-blue-50 border-blue-200 text-blue-900",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-900",
    amber:   "bg-amber-50 border-amber-200 text-amber-900",
    red:     "bg-red-50 border-red-200 text-red-900",
  };
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${palette[color]}`}>
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium opacity-60">{label}</p>
        {icon && <span className="opacity-40">{icon}</span>}
      </div>
      <p className="mt-1.5 text-2xl font-bold tracking-tight">{value}</p>
      {sub && <p className="mt-0.5 text-xs opacity-55">{sub}</p>}
    </div>
  );
}

function Pill({
  label,
  value,
  color = "slate",
}: {
  label: string;
  value: string | number;
  color?: "slate" | "emerald" | "amber" | "red" | "blue";
}) {
  const colors = {
    slate:   "bg-slate-50 text-slate-700 ring-slate-200",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    amber:   "bg-amber-50 text-amber-700 ring-amber-200",
    red:     "bg-red-50 text-red-600 ring-red-200",
    blue:    "bg-blue-50 text-blue-700 ring-blue-200",
  };
  return (
    <div className={`rounded-xl px-4 py-3 ring-1 ${colors[color]}`}>
      <p className="text-xs font-medium opacity-70">{label}</p>
      <p className="mt-0.5 text-lg font-bold">{value}</p>
    </div>
  );
}

function SectionCard({
  title,
  action,
  children,
  padded = true,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  padded?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {action}
      </div>
      <div className={padded ? "p-5" : ""}>{children}</div>
    </div>
  );
}

function EmptyState({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <div className="text-3xl text-slate-300">{icon}</div>
      <p className="text-sm font-medium text-slate-500">{title}</p>
      <p className="max-w-xs text-xs text-slate-400">{body}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PAID: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    PARTIAL: "bg-amber-50 text-amber-700 ring-amber-200",
    UNPAID: "bg-red-50 text-red-600 ring-red-200",
    VOID: "bg-slate-100 text-slate-500 ring-slate-200",
    DELIVERED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    SENT: "bg-blue-50 text-blue-700 ring-blue-200",
    FAILED: "bg-red-50 text-red-600 ring-red-200",
    PENDING: "bg-slate-50 text-slate-600 ring-slate-200",
  };
  const cls = map[status.toUpperCase()] ?? "bg-slate-50 text-slate-600 ring-slate-200";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${cls}`}>
      {normalizeType(status)}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Parent form modal (add/edit)
// ─────────────────────────────────────────────────────────────────────────────

type ParentFormData = {
  first_name: string; last_name: string; phone: string; email: string;
  phone_alt: string; national_id: string; occupation: string; address: string;
};
const EMPTY_FORM: ParentFormData = {
  first_name: "", last_name: "", phone: "", email: "",
  phone_alt: "", national_id: "", occupation: "", address: "",
};

function ParentFormModal({
  initial, onSave, onClose, saving,
}: {
  initial?: Partial<ParentFormData>;
  onSave: (data: ParentFormData) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<ParentFormData>({ ...EMPTY_FORM, ...initial });
  const set = (k: keyof ParentFormData) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((p) => ({ ...p, [k]: e.target.value }));

  const fields: [keyof ParentFormData, string, boolean][] = [
    ["first_name", "First Name *", true],
    ["last_name", "Last Name *", true],
    ["phone", "Phone *", true],
    ["email", "Email", false],
    ["phone_alt", "Alt. Phone", false],
    ["national_id", "National ID", false],
    ["occupation", "Occupation", false],
    ["address", "Address", false],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-800">
            {initial?.first_name ? "Edit Guardian" : "Add Guardian"}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-4 p-5">
          {fields.map(([key, label, req]) => (
            <div key={key} className={key === "address" ? "col-span-2" : ""}>
              <label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
              <Input value={form[key]} onChange={set(key)} placeholder={label.replace(" *", "")} required={req} className="h-9 text-sm" />
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-100 px-5 py-4">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
          <button
            onClick={() => onSave(form)}
            disabled={saving || !form.first_name || !form.phone}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving && <Spinner sm />} Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Link enrollment modal
// ─────────────────────────────────────────────────────────────────────────────

function LinkEnrollmentModal({
  enrollments, alreadyLinked, onLink, onClose, saving,
}: {
  enrollments: Enrollment[];
  alreadyLinked: string[];
  onLink: (enrollmentId: string, relationship: string) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [relationship, setRelationship] = useState("GUARDIAN");
  const available = enrollments.filter((e) => !alreadyLinked.includes(e.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-800">Link a Student</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 p-5">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Student (Enrollment)</label>
            <Select value={selectedId || "__none__"} onValueChange={(v) => setSelectedId(v === "__none__" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Select student…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Select student…</SelectItem>
                {available.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {enrollmentName(e.payload)}{e.payload?.class_code ? ` · ${e.payload.class_code}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {available.length === 0 && (
              <p className="mt-2 text-xs text-slate-400">All enrolled students are already linked.</p>
            )}
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Relationship</label>
            <Select value={relationship} onValueChange={setRelationship}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["FATHER", "MOTHER", "GUARDIAN", "SPONSOR"].map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-100 px-5 py-4">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
          <button
            onClick={() => onLink(selectedId, relationship)}
            disabled={saving || !selectedId}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving && <Spinner sm />} Link Student
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Record payment modal
// ─────────────────────────────────────────────────────────────────────────────

function RecordPaymentModal({
  parentId,
  outstandingInvoices,
  onSaved,
  onClose,
}: {
  parentId: string;
  outstandingInvoices: AllInvoice[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [provider, setProvider] = useState("MPESA");
  const [reference, setReference] = useState("");
  const [preview, setPreview] = useState<PaymentPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [recording, setRecording] = useState(false);

  async function handlePreview() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    setPreviewing(true);
    try {
      const res = await api.post<PaymentPreview>(
        `/parents/${parentId}/payments/preview?amount=${amt}&strategy=oldest_first`,
        {},
        { tenantRequired: true }
      );
      setPreview(res);
    } catch (e: unknown) {
      toast.error((e as { message?: string })?.message || "Preview failed");
    } finally {
      setPreviewing(false);
    }
  }

  async function handleRecord() {
    if (!preview) return;
    setRecording(true);
    try {
      await api.post(
        `/parents/${parentId}/payments`,
        {
          provider,
          reference: reference.trim() || null,
          amount: parseFloat(amount),
          allocations: preview.lines.map((l) => ({ invoice_id: l.invoice_id, amount: toNum(l.amount) })),
        },
        { tenantRequired: true }
      );
      toast.success("Payment recorded successfully");
      onSaved();
      onClose();
    } catch (e: unknown) {
      toast.error((e as { message?: string })?.message || "Failed to record payment");
    } finally {
      setRecording(false);
    }
  }

  const unpaidInvoices = outstandingInvoices.filter(
    (inv) => inv.status === "UNPAID" || inv.status === "PARTIAL"
  );
  const totalBalance = unpaidInvoices.reduce((s, i) => s + toNum(i.balance_amount), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-800">Record Payment</h2>
            <p className="text-xs text-slate-400">Total outstanding: {fmtKes(totalBalance)}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Amount (KES) *</label>
              <Input
                type="number"
                min="1"
                step="0.01"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setPreview(null); }}
                placeholder="0.00"
                className="h-9 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Payment Method *</label>
              <Select value={provider} onValueChange={(v) => setProvider(v)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["CASH", "MPESA", "BANK", "CHEQUE"].map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600">Reference / Receipt No. (optional)</label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. MPESA transaction code" className="h-9 text-sm" />
            </div>
          </div>

          <button
            onClick={() => void handlePreview()}
            disabled={previewing || !amount}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
          >
            {previewing ? <Spinner sm /> : <BarChart2 className="h-4 w-4" />}
            {previewing ? "Calculating…" : "Preview Distribution"}
          </button>

          {preview && (
            <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50 p-4">
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Distribution Preview</p>
              {preview.lines.map((line, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700">{line.student_name} — {normalizeType(line.invoice_type)}</span>
                  <span className="font-semibold text-slate-800">{fmtKes(line.amount)}</span>
                </div>
              ))}
              {toNum(preview.unallocated) > 0 && (
                <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-sm">
                  <span className="text-amber-600">Unallocated</span>
                  <span className="font-semibold text-amber-600">{fmtKes(preview.unallocated)}</span>
                </div>
              )}
              <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-sm font-bold">
                <span className="text-slate-700">Total</span>
                <span>{fmtKes(preview.total)}</span>
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-100 px-5 py-4">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
          <button
            onClick={() => void handleRecord()}
            disabled={recording || !preview}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {recording && <Spinner sm />} Record Payment
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Finance tab
// ─────────────────────────────────────────────────────────────────────────────

function FinanceTab({
  parentId,
  detail,
  onPaymentRecorded,
}: {
  parentId: string;
  detail: ParentDetail;
  onPaymentRecorded: () => void;
}) {
  const [allInvoices, setAllInvoices] = useState<AllInvoice[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPayment, setShowPayment] = useState(false);
  const [statusFilter, setStatusFilter] = usePersistedState("dir.parents.status", "ALL");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [invs, pays] = await Promise.all([
        api.get<AllInvoice[]>(`/parents/${parentId}/all-invoices`, { tenantRequired: true }),
        api.get<PaymentRecord[]>(`/parents/${parentId}/payment-history`, { tenantRequired: true }),
      ]);
      setAllInvoices(Array.isArray(invs) ? invs : []);
      setPayments(Array.isArray(pays) ? pays : []);
    } catch {
      toast.error("Failed to load finance data");
    } finally {
      setLoading(false);
    }
  }, [parentId]);

  useEffect(() => { void load(); }, [load]);

  const filteredInvoices = statusFilter === "ALL"
    ? allInvoices
    : allInvoices.filter((i) => i.status === statusFilter);

  const totalBilled = allInvoices.reduce((s, i) => s + toNum(i.total_amount), 0);
  const totalPaid = allInvoices.reduce((s, i) => s + toNum(i.paid_amount), 0);
  const totalBalance = allInvoices.reduce((s, i) => s + toNum(i.balance_amount), 0);
  const outstandingInvoices = allInvoices.filter((i) => i.status === "UNPAID" || i.status === "PARTIAL");

  if (loading) {
    return (
      <div className="flex justify-center py-12"><Spinner /></div>
    );
  }

  return (
    <div className="space-y-5">
      {showPayment && (
        <RecordPaymentModal
          parentId={parentId}
          outstandingInvoices={allInvoices}
          onSaved={() => { void load(); onPaymentRecorded(); }}
          onClose={() => setShowPayment(false)}
        />
      )}

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Pill label="Total Billed" value={fmtKes(totalBilled)} color="slate" />
        <Pill label="Total Paid" value={fmtKes(totalPaid)} color="emerald" />
        <Pill label="Balance" value={fmtKes(totalBalance)} color={totalBalance > 0 ? "amber" : "emerald"} />
      </div>

      {/* Invoices */}
      <SectionCard
        title="All Invoices"
        padded={false}
        action={
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["ALL", "UNPAID", "PARTIAL", "PAID", "VOID"].map((s) => (
                  <SelectItem key={s} value={s} className="text-xs">{s === "ALL" ? "All Status" : s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {outstandingInvoices.length > 0 && (
              <button
                onClick={() => setShowPayment(true)}
                className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                <WalletCards className="h-3 w-3" /> Record Payment
              </button>
            )}
          </div>
        }
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="text-xs">Student</TableHead>
                <TableHead className="text-xs">Type</TableHead>
                <TableHead className="text-xs">Invoice #</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-right text-xs">Billed</TableHead>
                <TableHead className="text-right text-xs">Paid</TableHead>
                <TableHead className="text-right text-xs">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredInvoices.map((inv) => (
                <TableRow key={inv.invoice_id} className="hover:bg-slate-50">
                  <TableCell className="text-sm font-medium">{inv.student_name}</TableCell>
                  <TableCell>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{normalizeType(inv.invoice_type)}</span>
                  </TableCell>
                  <TableCell className="text-xs text-slate-400">{inv.invoice_no || "—"}</TableCell>
                  <TableCell><StatusBadge status={inv.status} /></TableCell>
                  <TableCell className="text-right text-sm">{fmtKes(inv.total_amount)}</TableCell>
                  <TableCell className="text-right text-sm text-emerald-600">{fmtKes(inv.paid_amount)}</TableCell>
                  <TableCell className="text-right text-sm font-semibold text-red-600">{fmtKes(inv.balance_amount)}</TableCell>
                </TableRow>
              ))}
              {filteredInvoices.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-slate-400">
                    No invoices found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </SectionCard>

      {/* Payment history */}
      <SectionCard title="Payment History" padded={false}>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="text-xs">Date</TableHead>
                <TableHead className="text-xs">Student</TableHead>
                <TableHead className="text-xs">Method</TableHead>
                <TableHead className="text-xs">Reference</TableHead>
                <TableHead className="text-right text-xs">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((pay) => (
                <TableRow key={pay.payment_id} className="hover:bg-slate-50">
                  <TableCell className="text-xs text-slate-500">{fmtDate(pay.received_at)}</TableCell>
                  <TableCell className="text-sm font-medium">{pay.student_name}</TableCell>
                  <TableCell>
                    <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700">{pay.provider}</span>
                  </TableCell>
                  <TableCell className="text-xs text-slate-400 font-mono">{pay.receipt_no || "—"}</TableCell>
                  <TableCell className="text-right text-sm font-semibold text-emerald-700">{fmtKes(pay.amount)}</TableCell>
                </TableRow>
              ))}
              {payments.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-sm text-slate-400">No payments recorded yet</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </SectionCard>

      {/* Finance deep-link */}
      {outstandingInvoices.length > 0 && (
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
          <p className="text-sm font-medium text-blue-800">Record payment in Finance</p>
          <p className="mt-0.5 text-xs text-blue-600">
            Payments are recorded in the Finance module. Open the by-student
            view for any of this guardian&apos;s children below.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {Array.from(
              new Map(
                detail.children
                  .filter((c) => c.student_id && toNum(c.outstanding) > 0)
                  .map((c) => [c.student_id, c])
              ).values()
            ).map((child) => (
              <a
                key={child.link_id}
                href={`/tenant/director/finance?section=record-payment&student_id=${encodeURIComponent(child.student_id!)}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition"
              >
                Pay for {child.student_name}
              </a>
            ))}
            <a
              href="/tenant/director/finance?section=record-payment"
              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 transition"
            >
              Open Finance →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Communications tab
// ─────────────────────────────────────────────────────────────────────────────

function CommunicationsTab({
  parentId,
  detail,
}: {
  parentId: string;
  detail: ParentDetail;
}) {
  const [smsHistory, setSmsHistory] = useState<SmsMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingPortalSms, setSendingPortalSms] = useState(false);
  const [sendingReminder, setSendingReminder] = useState(false);
  const [portalLabel, setPortalLabel] = useState("");
  const [showPortalForm, setShowPortalForm] = useState(false);
  const [lastPortalUrl, setLastPortalUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const msgs = await api.get<SmsMessage[]>(`/parents/${parentId}/sms-history`, { tenantRequired: true });
      setSmsHistory(Array.isArray(msgs) ? msgs : []);
    } catch {
      setSmsHistory([]);
    } finally {
      setLoading(false);
    }
  }, [parentId]);

  useEffect(() => { void load(); }, [load]);

  async function handleSendPortalSms() {
    setSendingPortalSms(true);
    try {
      const res = await api.post<{
        raw_token?: string;
        school_slug?: string;
        portal_url?: string;
        sms_warning?: string;
      }>(
        `/parents/${parentId}/send-portal-sms`,
        { label: portalLabel.trim() || null },
        { tenantRequired: true }
      );
      if (res.sms_warning) {
        toast.error(`Portal link created but SMS failed: ${res.sms_warning}`);
      } else {
        toast.success("Portal link sent via SMS!");
      }
      if (res.portal_url) {
        setLastPortalUrl(res.portal_url);
      } else if (res.raw_token && res.school_slug) {
        const base = typeof window !== "undefined" ? window.location.origin : "";
        setLastPortalUrl(`${base}/portal?token=${encodeURIComponent(res.raw_token)}&slug=${encodeURIComponent(res.school_slug)}`);
      }
      setShowPortalForm(false);
      setPortalLabel("");
      await load();
    } catch (e: unknown) {
      toast.error((e as { message?: string })?.message || "Failed to send portal SMS");
    } finally {
      setSendingPortalSms(false);
    }
  }

  async function handleSendFeeReminder() {
    setSendingReminder(true);
    try {
      const message =
        `Dear ${detail.name}, you have an outstanding fee balance of ${fmtKes(detail.outstanding_total)}. ` +
        `Please visit the school office to make payment. Thank you.`;
      await api.post(
        "/sms/send",
        { to_phone: detail.phone, message_body: message, recipient_name: detail.name },
        { tenantRequired: true }
      );
      toast.success("Fee reminder sent");
      await load();
    } catch (e: unknown) {
      toast.error((e as { message?: string })?.message || "Failed to send reminder");
    } finally {
      setSendingReminder(false);
    }
  }

  async function handleCopy(url: string) {
    await navigator.clipboard.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-5">
      {/* Action buttons */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => void handleSendFeeReminder()}
          disabled={sendingReminder || toNum(detail.outstanding_total) === 0}
          className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition"
        >
          {sendingReminder ? <Spinner sm /> : <MessageSquare className="h-4 w-4" />}
          Send Fee Reminder SMS
        </button>
        <button
          onClick={() => setShowPortalForm(!showPortalForm)}
          className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 transition"
        >
          <Send className="h-4 w-4" />
          Send Portal Link via SMS
        </button>
      </div>

      {/* Portal SMS form */}
      {showPortalForm && (
        <div className="rounded-2xl border border-blue-100 bg-blue-50 p-5 space-y-3">
          <div>
            <p className="text-sm font-semibold text-blue-900">Send Portal Access Link via SMS</p>
            <p className="text-xs text-blue-600 mt-0.5">
              A unique portal link will be generated and sent to {detail.phone}. The guardian can
              use it to view their children&apos;s records and fee balances anytime.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-blue-800">Label (optional)</label>
            <Input
              value={portalLabel}
              onChange={(e) => setPortalLabel(e.target.value)}
              placeholder="e.g. Term 2 Portal Link"
              className="h-9 text-sm bg-white"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void handleSendPortalSms()}
              disabled={sendingPortalSms}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {sendingPortalSms ? <Spinner sm /> : <Send className="h-3.5 w-3.5" />}
              {sendingPortalSms ? "Sending…" : "Send via SMS"}
            </button>
            <button
              onClick={() => { setShowPortalForm(false); setPortalLabel(""); }}
              className="rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm text-blue-600 hover:bg-blue-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Last portal URL (shown after send) */}
      {lastPortalUrl && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 space-y-2">
          <p className="text-xs font-bold text-emerald-800">Portal link generated</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg border border-emerald-200 bg-white px-2 py-1.5 text-[11px] text-slate-700">
              {lastPortalUrl}
            </code>
            <button
              onClick={() => void handleCopy(lastPortalUrl)}
              className="shrink-0 flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
            <a
              href={lastPortalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-2.5 py-1.5 text-xs text-emerald-700 hover:bg-emerald-50"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <button onClick={() => setLastPortalUrl(null)} className="text-[11px] text-emerald-500 hover:text-emerald-700 underline underline-offset-2">
            Dismiss
          </button>
        </div>
      )}

      {/* SMS history */}
      <SectionCard title="SMS History (last 50)" padded={false}>
        {loading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : smsHistory.length === 0 ? (
          <div className="px-5 py-5">
            <EmptyState
              icon={<MessageSquare />}
              title="No SMS messages yet"
              body="Messages sent to this guardian will appear here."
            />
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {smsHistory.map((msg) => (
              <div key={msg.id} className="px-5 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <p className="flex-1 text-sm text-slate-700 leading-relaxed">{msg.message_body}</p>
                  <StatusBadge status={msg.status} />
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Sent {fmtDate(msg.sent_at || msg.created_at)}
                  {msg.delivered_at ? ` · Delivered ${fmtDate(msg.delivered_at)}` : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Portal tab
// ─────────────────────────────────────────────────────────────────────────────

function PortalTab({ parentId }: { parentId: string }) {
  const { confirm: confirmAction, confirmDialog } = useConfirm();
  const [tokens, setTokens] = useState<PortalToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [newToken, setNewToken] = useState<{ url: string; label: string | null } | null>(null);
  const [copied, setCopied] = useState(false);

  const loadTokens = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<PortalToken[]>(`/parents/${parentId}/portal-tokens`, { tenantRequired: true });
      setTokens(Array.isArray(res) ? res : []);
    } catch {
      setTokens([]);
    } finally {
      setLoading(false);
    }
  }, [parentId]);

  useEffect(() => { void loadTokens(); }, [loadTokens]);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const res = await api.post<PortalTokenCreated>(
        `/parents/${parentId}/portal-token`,
        { label: label.trim() || null },
        { tenantRequired: true }
      );
      const base = typeof window !== "undefined" ? window.location.origin : "";
      const url = `${base}/portal?token=${encodeURIComponent(res.raw_token)}&slug=${encodeURIComponent(res.school_slug)}`;
      setNewToken({ url, label: res.label });
      setShowForm(false);
      setLabel("");
      await loadTokens();
    } catch (e: unknown) {
      toast.error((e as { message?: string })?.message || "Failed to generate link");
    } finally {
      setGenerating(false);
    }
  }

  async function handleRevoke(tokenId: string) {
    const ok = await confirmAction({ title: "Revoke Portal Link", message: "Revoke this portal link? The parent will no longer be able to use it.", confirmLabel: "Revoke", danger: true });
    if (!ok) return;
    setRevoking(tokenId);
    try {
      await api.delete(`/parents/${parentId}/portal-tokens/${tokenId}`, { tenantRequired: true });
      toast.success("Portal link revoked");
      await loadTokens();
    } catch {
      toast.error("Failed to revoke link");
    } finally {
      setRevoking(null);
    }
  }

  async function handleCopy(url: string) {
    await navigator.clipboard.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
    <div className="space-y-5">
      {/* Info banner */}
      <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
        <p className="text-sm font-medium text-slate-800">Parent Portal Access</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Generate shareable links to give guardians read-only access to their children&apos;s records,
          grades, and fee balances. Links can be revoked at any time.
        </p>
      </div>

      {/* Generate form */}
      {showForm ? (
        <div className="space-y-3 rounded-2xl border border-blue-100 bg-blue-50 p-5">
          <p className="text-sm font-semibold text-blue-900">Generate New Portal Link</p>
          <div>
            <label className="mb-1 block text-xs font-medium text-blue-800">Label (optional)</label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. WhatsApp link, SMS link" className="h-9 text-sm bg-white" />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void handleGenerate()}
              disabled={generating}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {generating ? <Spinner sm /> : <KeyRound className="h-3.5 w-3.5" />}
              {generating ? "Generating…" : "Generate Link"}
            </button>
            <button onClick={() => { setShowForm(false); setLabel(""); }} className="rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm text-blue-600 hover:bg-blue-50">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition shadow-sm"
        >
          <KeyRound className="h-4 w-4 text-blue-500" /> Generate New Portal Link
        </button>
      )}

      {/* Newly generated token */}
      {newToken && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 space-y-2">
          <p className="text-xs font-bold text-emerald-800">
            Portal link generated{newToken.label ? ` · ${newToken.label}` : ""}
          </p>
          <p className="text-xs text-emerald-600">Copy this link and share it with the guardian. It will not be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg border border-emerald-200 bg-white px-2 py-1.5 text-[11px] text-slate-700">
              {newToken.url}
            </code>
            <button
              onClick={() => void handleCopy(newToken.url)}
              className="shrink-0 flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
            <a
              href={newToken.url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-2.5 py-1.5 text-xs text-emerald-700 hover:bg-emerald-50"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <button onClick={() => setNewToken(null)} className="text-[11px] text-emerald-500 underline underline-offset-2 hover:text-emerald-700">
            Dismiss
          </button>
        </div>
      )}

      {/* Token list */}
      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : tokens.length === 0 ? (
        <EmptyState
          icon={<KeyRound />}
          title="No portal links yet"
          body="Generate a link to give this guardian view-only access to their children's records."
        />
      ) : (
        <SectionCard title={`Active Links (${tokens.length})`} padded={false}>
          <div className="divide-y divide-slate-50">
            {tokens.map((t) => (
              <div key={t.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">{t.label || "Unnamed link"}</p>
                  <p className="text-xs text-slate-400">
                    Created {fmtDate(t.created_at)}
                    {t.last_used_at ? ` · Last used ${fmtDate(t.last_used_at)}` : " · Never used"}
                  </p>
                </div>
                <button
                  onClick={() => void handleRevoke(t.id)}
                  disabled={revoking === t.id}
                  title="Revoke"
                  className="ml-3 rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                >
                  {revoking === t.id ? <Spinner sm /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
    {confirmDialog}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail view (tabbed)
// ─────────────────────────────────────────────────────────────────────────────

type DetailTab = "overview" | "finance" | "communications" | "portal";

function ParentDetailView({
  parentId,
  enrollments,
  onBack,
  onUpdated,
}: {
  parentId: string;
  enrollments: Enrollment[];
  onBack: () => void;
  onUpdated: () => void;
}) {
  const { confirm: confirmAction, confirmDialog } = useConfirm();
  const [detail, setDetail] = useState<ParentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [showEdit, setShowEdit] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [saving, setSaving] = useState(false);
  const [unlinking, setUnlinking] = useState<string | null>(null);
  const [adjustingStudent, setAdjustingStudent] = useState<{ id: string; name: string } | null>(null);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      const det = await api.get<ParentDetail>(`/parents/${parentId}`, { tenantRequired: true });
      setDetail(det);
    } catch {
      toast.error("Failed to load parent details");
    } finally {
      setLoading(false);
    }
  }, [parentId]);

  useEffect(() => { void loadDetail(); }, [loadDetail]);

  async function handleEdit(data: ParentFormData) {
    setSaving(true);
    try {
      await api.put(`/parents/${parentId}`, data, { tenantRequired: true });
      toast.success("Guardian updated");
      setShowEdit(false);
      await loadDetail();
      onUpdated();
    } catch (e: unknown) {
      toast.error((e as { message?: string })?.message || "Failed to update");
    } finally { setSaving(false); }
  }

  async function handleLink(enrollmentId: string, relationship: string) {
    setSaving(true);
    try {
      await api.post(`/parents/${parentId}/links`, { enrollment_id: enrollmentId, relationship }, { tenantRequired: true });
      toast.success("Student linked");
      setShowLink(false);
      await loadDetail();
      onUpdated();
    } catch { toast.error("Failed to link student"); }
    finally { setSaving(false); }
  }

  async function handleUnlink(linkId: string, studentName: string) {
    const ok = await confirmAction({ title: "Unlink Student", message: `Unlink ${studentName} from this guardian?`, confirmLabel: "Unlink", danger: true });
    if (!ok) return;
    setUnlinking(linkId);
    try {
      await api.delete(`/parents/${parentId}/links/${linkId}`, { tenantRequired: true });
      toast.success("Student unlinked");
      await loadDetail();
      onUpdated();
    } catch { toast.error("Failed to unlink student"); }
    finally { setUnlinking(null); }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-24"><Spinner /></div>;
  }

  if (!detail) return null;

  const linkedIds = detail.children.map((c) => c.enrollment_id);

  const tabs: { key: DetailTab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "finance", label: "Finance" },
    { key: "communications", label: "Communications" },
    { key: "portal", label: "Portal" },
  ];

  return (
    <>
    <div className="space-y-5">
      {showEdit && (
        <ParentFormModal
          initial={{ first_name: detail.first_name, last_name: detail.last_name, phone: detail.phone, email: detail.email || "", phone_alt: detail.phone_alt || "", national_id: detail.national_id || "", occupation: detail.occupation || "", address: detail.address || "" }}
          onSave={handleEdit}
          onClose={() => setShowEdit(false)}
          saving={saving}
        />
      )}
      {showLink && (
        <LinkEnrollmentModal
          enrollments={enrollments}
          alreadyLinked={linkedIds}
          onLink={handleLink}
          onClose={() => setShowLink(false)}
          saving={saving}
        />
      )}

      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Parents
        </button>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
        <span className="text-sm font-semibold text-slate-800">{detail.name}</span>
      </div>

      {/* Summary pills */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Pill label="Children" value={detail.children.length} color="blue" />
        <Pill label="Outstanding" value={fmtKes(detail.outstanding_total)} color={toNum(detail.outstanding_total) > 0 ? "amber" : "emerald"} />
        <Pill label="Phone" value={detail.phone} color="slate" />
        <Pill label="Portal" value={detail.has_portal_access ? "Active" : "Not set up"} color={detail.has_portal_access ? "emerald" : "slate"} />
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <nav className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === "overview" && (
        <div className="grid gap-5 lg:grid-cols-5">
          <div className="space-y-5 lg:col-span-2">
            <SectionCard
              title="Contact Info"
              action={
                <button onClick={() => setShowEdit(true)} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
                  <Edit2 className="h-3 w-3" /> Edit
                </button>
              }
            >
              <dl className="space-y-2 text-sm">
                {[
                  ["Name", detail.name],
                  ["Phone", detail.phone],
                  ["Alt. Phone", detail.phone_alt || "—"],
                  ["Email", detail.email || "—"],
                  ["National ID", detail.national_id || "—"],
                  ["Occupation", detail.occupation || "—"],
                  ["Address", detail.address || "—"],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4">
                    <dt className="text-slate-500 shrink-0">{label}</dt>
                    <dd className="font-medium text-slate-800 text-right truncate">{value}</dd>
                  </div>
                ))}
              </dl>
            </SectionCard>
          </div>

          <div className="space-y-5 lg:col-span-3">
            <SectionCard
              title="Linked Children"
              action={
                <button onClick={() => setShowLink(true)} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
                  <Link2 className="h-3 w-3" /> Link Student
                </button>
              }
            >
              {detail.children.length === 0 ? (
                <EmptyState icon={<Users />} title="No children linked" body="Link a student to connect this guardian to an enrollment." />
              ) : (
                <div className="space-y-2">
                  {detail.children.map((child) => {
                    const adjNet = toNum(child.balance_adjustment_net);
                    const adjLabel =
                      adjNet > 0
                        ? `Balance adjustment (debit): ${fmtKes(adjNet)}`
                        : adjNet < 0
                          ? `Credit on file: ${fmtKes(Math.abs(adjNet))}`
                          : null;
                    return (
                      <div key={child.link_id} className="flex items-start justify-between rounded-xl border border-slate-100 p-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-800">{child.student_name}</p>
                          <p className="text-xs text-slate-500">
                            {child.class_code || "—"}
                            {child.admission_number ? ` · ${child.admission_number}` : ""}
                          </p>
                          <p className="text-xs text-slate-400">{child.relationship}{child.is_primary ? " · Primary" : ""}</p>
                          {toNum(child.outstanding) > 0 && (
                            <p className="mt-1 text-xs font-semibold text-red-600">
                              Outstanding: {fmtKes(child.outstanding)}
                            </p>
                          )}
                          {adjLabel && (
                            <p className={`mt-0.5 text-xs font-medium ${adjNet < 0 ? "text-emerald-700" : "text-amber-700"}`}>
                              {adjLabel}
                            </p>
                          )}
                        </div>
                        <div className="ml-2 flex flex-col items-end gap-1">
                          {child.student_id && (
                            <button
                              onClick={() => setAdjustingStudent({ id: child.student_id!, name: child.student_name })}
                              title="Adjust balance (debit or credit)"
                              className="rounded p-1 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                            >
                              <Wallet className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => void handleUnlink(child.link_id, child.student_name)}
                            disabled={unlinking === child.link_id}
                            title="Unlink"
                            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                          >
                            {unlinking === child.link_id ? <Spinner sm /> : <Link2Off className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>

            {/* Quick finance summary */}
            {toNum(detail.outstanding_total) > 0 && (
              <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-amber-900">Outstanding Balance</p>
                    <p className="text-2xl font-bold text-amber-700 mt-1">{fmtKes(detail.outstanding_total)}</p>
                  </div>
                  <button
                    onClick={() => setActiveTab("finance")}
                    className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 transition"
                  >
                    View Finance →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "finance" && (
        <FinanceTab parentId={parentId} detail={detail} onPaymentRecorded={() => { void loadDetail(); onUpdated(); }} />
      )}

      {activeTab === "communications" && (
        <CommunicationsTab parentId={parentId} detail={detail} />
      )}

      {activeTab === "portal" && (
        <PortalTab parentId={parentId} />
      )}
    </div>
    {confirmDialog}
    {adjustingStudent && (
      <CarryForwardDialog
        open={!!adjustingStudent}
        onOpenChange={(o) => { if (!o) setAdjustingStudent(null); }}
        studentId={adjustingStudent.id}
        studentName={adjustingStudent.name}
        onChanged={() => void loadDetail()}
      />
    )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function DirectorParentsPage() {
  const { confirm, confirmDialog } = useConfirm();
  const [parents, setParents] = useState<ParentListItem[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [classes, setClasses] = useState<string[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [q, setQ] = usePersistedState("dir.parents.q", "");
  const [classFilter, setClassFilter] = usePersistedState("dir.parents.class", "");
  const [syncing, setSyncing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkSmsSending, setBulkSmsSending] = useState(false);

  const loadAll = useCallback(async (cc?: string) => {
    setLoading(true);
    const classParam = cc !== undefined ? cc : classFilter;
    const qs = classParam ? `?class_code=${encodeURIComponent(classParam)}` : "";
    try {
      const [ps, enrs, anl] = await Promise.all([
        api.get<ParentListItem[]>(`/parents${qs}`, { tenantRequired: true }),
        api.get<unknown>("/enrollments/", { tenantRequired: true, noRedirect: true }).catch(() => [] as unknown),
        api.get<Analytics>("/parents/analytics", { tenantRequired: true }).catch(() => null),
      ]);
      setParents(Array.isArray(ps) ? ps : []);
      setAnalytics(anl);

      const rawEnrs = Array.isArray(enrs)
        ? enrs
        : Array.isArray((enrs as { items?: unknown[] })?.items)
          ? (enrs as { items: unknown[] }).items
          : [];
      const enrList = rawEnrs
        .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null && "id" in e)
        .map((e) => ({ id: String(e.id), payload: (e.payload as Record<string, unknown>) || {} }));
      setEnrollments(enrList);

      const codes = Array.from(new Set(
        enrList.map((e) => (e.payload?.class_code as string) || (e.payload?.admission_class as string) || "")
          .filter(Boolean)
      )).sort();
      setClasses(codes);
    } catch {
      toast.error("Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [classFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void loadAll(""); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!loading) void loadAll(classFilter); }, [classFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await api.post<SyncResult>("/parents/sync-from-enrollments", {}, { tenantRequired: true });
      toast.success(`Sync done — ${res.created} new, ${res.linked} linked`);
      await loadAll();
    } catch { toast.error("Sync failed"); }
    finally { setSyncing(false); }
  }

  async function handleExport() {
    setExporting(true);
    try {
      await api.downloadFile("/parents/export.csv", "parents.csv", { tenantRequired: true });
      toast.success("CSV downloaded");
    } catch { toast.error("Export failed"); }
    finally { setExporting(false); }
  }

  async function handleAddParent(data: ParentFormData) {
    setAddSaving(true);
    try {
      const created = await api.post<ParentDetail>("/parents", data, { tenantRequired: true });
      toast.success(`${created.name} added`);
      setShowAdd(false);
      await loadAll();
      setSelectedId(created.id);
    } catch (e: unknown) {
      toast.error((e as { message?: string })?.message || "Failed to add guardian");
    } finally { setAddSaving(false); }
  }

  async function handleBulkPortalSms() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const ok1 = await confirm({ title: "Send Portal Links", message: `Send portal access links via SMS to ${ids.length} guardian(s)?`, confirmLabel: "Send" });
    if (!ok1) return;
    setBulkSmsSending(true);
    let sent = 0;
    let failed = 0;
    for (const parentId of ids) {
      try {
        await api.post(`/parents/${parentId}/send-portal-sms`, {}, { tenantRequired: true });
        sent++;
      } catch { failed++; }
    }
    toast.success(`Portal SMS sent: ${sent} delivered${failed > 0 ? `, ${failed} failed` : ""}`);
    setBulkSmsSending(false);
    setSelected(new Set());
    await loadAll();
  }

  async function handleBulkFeeReminder() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const ok2 = await confirm({ title: "Send Fee Reminders", message: `Send fee reminder SMS to ${ids.length} guardian(s) with outstanding balances?`, confirmLabel: "Send" });
    if (!ok2) return;
    setBulkSmsSending(true);
    let sent = 0;
    let failed = 0;
    for (const parentId of ids) {
      const parent = parents.find((p) => p.id === parentId);
      if (!parent || toNum(parent.outstanding_total) === 0) continue;
      try {
        const message =
          `Dear ${parent.name}, you have an outstanding fee balance of ${fmtKes(parent.outstanding_total)}. ` +
          `Please visit the school office to make payment. Thank you.`;
        await api.post(
          "/sms/send",
          { to_phone: parent.phone, message_body: message, recipient_name: parent.name },
          { tenantRequired: true }
        );
        sent++;
      } catch { failed++; }
    }
    toast.success(`Fee reminders sent: ${sent} delivered${failed > 0 ? `, ${failed} failed` : ""}`);
    setBulkSmsSending(false);
    setSelected(new Set());
  }

  const filtered = parents.filter((p) => {
    const ql = q.trim().toLowerCase();
    if (ql && !p.name.toLowerCase().includes(ql) && !p.phone.includes(ql) && !(p.email || "").toLowerCase().includes(ql)) {
      return false;
    }
    return true;
  });

  const allChecked = filtered.length > 0 && filtered.every((p) => selected.has(p.id));
  const someChecked = filtered.some((p) => selected.has(p.id));

  function toggleAll() {
    if (allChecked) {
      setSelected((prev) => { const next = new Set(prev); filtered.forEach((p) => next.delete(p.id)); return next; });
    } else {
      setSelected((prev) => { const next = new Set(prev); filtered.forEach((p) => next.add(p.id)); return next; });
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // ── Detail view ────────────────────────────────────────────────────────────

  if (selectedId) {
    return (
      <AppShell nav={directorNav} title="Director" activeHref="/tenant/director/parents">
        <div className="mx-auto max-w-6xl px-4 py-6">
          <ParentDetailView
            parentId={selectedId}
            enrollments={enrollments}
            onBack={() => setSelectedId(null)}
            onUpdated={() => void loadAll()}
          />
        </div>
      </AppShell>
    );
  }

  // ── List view ──────────────────────────────────────────────────────────────

  return (
    <AppShell nav={directorNav} title="Director" activeHref="/tenant/director/parents">
      {showAdd && (
        <ParentFormModal onSave={handleAddParent} onClose={() => setShowAdd(false)} saving={addSaving} />
      )}

      <div className="mx-auto max-w-7xl px-4 py-6 space-y-6">
        {/* Page header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Parents &amp; Guardians</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Full guardian management — finance, communications, and portal access.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void handleSync()}
              disabled={syncing}
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 shadow-sm transition"
            >
              {syncing ? <Spinner sm /> : <RefreshCw className="h-4 w-4" />}
              {syncing ? "Syncing…" : "Sync from Enrollments"}
            </button>
            <button
              onClick={() => void handleExport()}
              disabled={exporting}
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 shadow-sm transition"
            >
              {exporting ? <Spinner sm /> : <Download className="h-4 w-4" />}
              {exporting ? "Exporting…" : "Export CSV"}
            </button>
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 rounded-xl bg-blue-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-700 shadow-sm transition"
            >
              <UserPlus className="h-4 w-4" /> Add Guardian
            </button>
          </div>
        </div>

        {/* Analytics bar */}
        {analytics && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <StatCard
              label="Total Parents"
              value={analytics.total_parents}
              color="blue"
              icon={<Users className="h-5 w-5" />}
            />
            <StatCard
              label="Total Outstanding"
              value={fmtKes(analytics.total_outstanding)}
              color={analytics.total_outstanding > 0 ? "amber" : "emerald"}
              icon={<WalletCards className="h-5 w-5" />}
            />
            <StatCard
              label="Total Billed"
              value={fmtKes(analytics.total_billed)}
              color="slate"
              icon={<BarChart2 className="h-5 w-5" />}
            />
            <StatCard
              label="Collection Rate"
              value={`${analytics.collection_rate_pct.toFixed(1)}%`}
              sub={analytics.collection_rate_pct >= 80 ? "On track" : "Needs attention"}
              color={analytics.collection_rate_pct >= 80 ? "emerald" : analytics.collection_rate_pct >= 50 ? "amber" : "red"}
              icon={<TrendingUp className="h-5 w-5" />}
            />
            <StatCard
              label="With Portal Access"
              value={analytics.with_portal_access}
              sub={`of ${analytics.total_parents} parents`}
              color="slate"
              icon={<KeyRound className="h-5 w-5" />}
            />
          </div>
        )}

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3">
            <span className="text-sm font-medium text-blue-800">{selected.size} selected</span>
            <div className="flex gap-2 ml-auto">
              <button
                onClick={() => void handleBulkFeeReminder()}
                disabled={bulkSmsSending}
                className="flex items-center gap-1.5 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
              >
                {bulkSmsSending ? <Spinner sm /> : <MessageSquare className="h-3.5 w-3.5" />}
                Send Fee Reminder
              </button>
              <button
                onClick={() => void handleBulkPortalSms()}
                disabled={bulkSmsSending}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {bulkSmsSending ? <Spinner sm /> : <Send className="h-3.5 w-3.5" />}
                Send Portal Links
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {/* Search + filter */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name, phone, or email…"
              className="h-10 pl-9"
            />
          </div>
          {classes.length > 0 && (
            <Select value={classFilter} onValueChange={(v) => setClassFilter(v === "ALL" ? "" : v)}>
              <SelectTrigger className="h-10 w-full sm:w-44">
                <SelectValue placeholder="All Classes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Classes</SelectItem>
                {classes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Parents table */}
        <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-center space-y-2">
                <Spinner />
                <p className="text-sm text-slate-400">Loading parents…</p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        checked={allChecked}
                        ref={(el) => { if (el) el.indeterminate = someChecked && !allChecked; }}
                        onChange={toggleAll}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 cursor-pointer"
                      />
                    </TableHead>
                    <TableHead className="text-xs">Guardian</TableHead>
                    <TableHead className="text-xs">Phone</TableHead>
                    <TableHead className="text-xs">Children</TableHead>
                    <TableHead className="text-xs">Outstanding</TableHead>
                    <TableHead className="text-xs">Portal</TableHead>
                    <TableHead className="text-xs"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((p) => {
                    const isSelected = selected.has(p.id);
                    return (
                      <TableRow
                        key={p.id}
                        className={`cursor-pointer transition ${isSelected ? "bg-blue-50" : "hover:bg-slate-50"}`}
                        onClick={() => setSelectedId(p.id)}
                      >
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleOne(p.id)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 cursor-pointer"
                          />
                        </TableCell>
                        <TableCell>
                          <p className="text-sm font-semibold text-slate-800">{p.name}</p>
                          {p.email && <p className="text-xs text-slate-400">{p.email}</p>}
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">{p.phone}</TableCell>
                        <TableCell className="text-sm text-slate-600">{p.child_count}</TableCell>
                        <TableCell>
                          <span className={`text-sm font-semibold ${toNum(p.outstanding_total) > 0 ? "text-red-600" : "text-emerald-600"}`}>
                            {fmtKes(p.outstanding_total)}
                          </span>
                        </TableCell>
                        <TableCell>
                          {p.has_portal_access ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                              Not set
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <ChevronRight className="h-4 w-4 text-slate-300" />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filtered.length === 0 && !loading && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-16 text-center">
                        <EmptyState
                          icon={<Users />}
                          title={q || classFilter ? "No parents match your search" : "No parents yet"}
                          body={q || classFilter ? "Try adjusting your search or filter." : "Click 'Sync from Enrollments' to automatically import guardians from student records, or add one manually."}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
          {/* Table footer */}
          {!loading && filtered.length > 0 && (
            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
              <p className="text-xs text-slate-400">
                Showing {filtered.length} of {parents.length} guardian{parents.length !== 1 ? "s" : ""}
              </p>
              {selected.size > 0 && (
                <p className="text-xs font-medium text-blue-600">{selected.size} selected</p>
              )}
            </div>
          )}
        </div>
      </div>
      {confirmDialog}
    </AppShell>
  );
}
