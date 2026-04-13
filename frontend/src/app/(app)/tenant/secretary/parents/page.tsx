"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/sonner";
import { AppShell } from "@/components/layout/AppShell";
import { secretaryNav } from "@/components/layout/nav-config";
import { api } from "@/lib/api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  ChevronRight,
  Edit2,
  Link2,
  Link2Off,
  Loader2,
  RefreshCw,
  Search,
  UserPlus,
  Users,
  WalletCards,
  X,
} from "lucide-react";

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
  student_name: string;
  class_code: string;
  admission_number: string | null;
  relationship: string;
  is_primary: boolean;
  outstanding: string | number;
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

type Invoice = {
  invoice_id: string;
  enrollment_id: string;
  student_name: string;
  invoice_type: string;
  invoice_no: string | null;
  status: string;
  total_amount: string | number;
  paid_amount: string | number;
  balance_amount: string | number;
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
  if (v === undefined || v === null) return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isNaN(n) ? 0 : n;
}

function fmtKes(v: string | number | undefined | null) {
  return `KES ${toNum(v).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function normalizeType(t: string) {
  if (!t) return t;
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
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

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
    slate: "bg-slate-50 text-slate-700 ring-slate-200",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    amber: "bg-amber-50 text-amber-700 ring-amber-200",
    red: "bg-red-50 text-red-600 ring-red-200",
    blue: "bg-blue-50 text-blue-700 ring-blue-200",
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
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function EmptyState({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <div className="text-3xl text-slate-300">{icon}</div>
      <p className="text-sm font-medium text-slate-500">{title}</p>
      <p className="max-w-xs text-xs text-slate-400">{body}</p>
    </div>
  );
}

function Spinner() {
  return <Loader2 className="h-4 w-4 animate-spin text-slate-400" />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Add/Edit parent modal
// ─────────────────────────────────────────────────────────────────────────────

type ParentFormData = {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  phone_alt: string;
  national_id: string;
  occupation: string;
  address: string;
};

const EMPTY_FORM: ParentFormData = {
  first_name: "", last_name: "", phone: "", email: "",
  phone_alt: "", national_id: "", occupation: "", address: "",
};

function ParentFormModal({
  initial,
  onSave,
  onClose,
  saving,
}: {
  initial?: Partial<ParentFormData>;
  onSave: (data: ParentFormData) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<ParentFormData>({ ...EMPTY_FORM, ...initial });
  const set = (k: keyof ParentFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

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
          {([["first_name", "First Name", true], ["last_name", "Last Name", true], ["phone", "Phone *", true], ["email", "Email", false], ["phone_alt", "Alt. Phone", false], ["national_id", "National ID", false], ["occupation", "Occupation", false], ["address", "Address", false]] as [keyof ParentFormData, string, boolean][]).map(([key, label, req]) => (
            <div key={key} className={key === "address" ? "col-span-2" : ""}>
              <label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
              <Input
                value={form[key]}
                onChange={set(key)}
                placeholder={label}
                required={req}
                className="h-9 text-sm"
              />
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
            {saving && <Spinner />} Save
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
  enrollments,
  alreadyLinked,
  onLink,
  onClose,
  saving,
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
                    {enrollmentName(e.payload)} {e.payload?.class_code ? `· ${e.payload.class_code}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {available.length === 0 && (
              <p className="mt-2 text-xs text-slate-400">All enrolled students are already linked to this parent.</p>
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
            {saving && <Spinner />} Link Student
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Parent detail view
// ─────────────────────────────────────────────────────────────────────────────

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
  const [detail, setDetail] = useState<ParentDetail | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [saving, setSaving] = useState(false);
  const [unlinking, setUnlinking] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      const [det, invs] = await Promise.all([
        api.get<ParentDetail>(`/parents/${parentId}`, { tenantRequired: true }),
        api.get<Invoice[]>(`/parents/${parentId}/invoices`, { tenantRequired: true }),
      ]);
      setDetail(det);
      setInvoices(Array.isArray(invs) ? invs : []);
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
      toast.error((e as { message?: string })?.message || "Failed to update guardian");
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
    if (!confirm(`Unlink ${studentName} from this guardian?`)) return;
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
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!detail) return null;

  const totalOutstanding = invoices.reduce((s, inv) => s + toNum(inv.balance_amount), 0);
  const linkedIds = detail.children.map((c) => c.enrollment_id);

  return (
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

      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Parents
        </button>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
        <span className="text-sm font-semibold text-slate-800">{detail.name}</span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Pill label="Children" value={detail.children.length} />
        <Pill label="Outstanding" value={fmtKes(totalOutstanding)} color={totalOutstanding > 0 ? "amber" : "emerald"} />
        <Pill label="Phone" value={detail.phone} color="blue" />
        <Pill label="Portal" value={detail.has_portal_access ? "Active" : "Not set up"} color={detail.has_portal_access ? "emerald" : "slate"} />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* Left column: contact info + children */}
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

          <SectionCard
            title="Linked Children"
            action={
              <button onClick={() => setShowLink(true)} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
                <Link2 className="h-3 w-3" /> Link Student
              </button>
            }
          >
            {detail.children.length === 0 ? (
              <EmptyState icon={<Users />} title="No children linked" body="Click 'Link Student' to connect this guardian to an enrollment." />
            ) : (
              <div className="space-y-2">
                {detail.children.map((child) => (
                  <div key={child.link_id} className="flex items-start justify-between rounded-xl border border-slate-100 p-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{child.student_name}</p>
                      <p className="text-xs text-slate-500">
                        {child.class_code || "—"}
                        {child.admission_number ? ` · ${child.admission_number}` : ""}
                      </p>
                      <p className="text-xs text-slate-400">{child.relationship}</p>
                      {toNum(child.outstanding) > 0 && (
                        <p className="mt-1 text-xs font-semibold text-red-600">
                          Outstanding: {fmtKes(child.outstanding)}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => void handleUnlink(child.link_id, child.student_name)}
                      disabled={unlinking === child.link_id}
                      title="Unlink"
                      className="ml-2 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                    >
                      {unlinking === child.link_id ? <Spinner /> : <Link2Off className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        {/* Right column: outstanding invoices + link to finance */}
        <div className="lg:col-span-3">
          <SectionCard title="Outstanding Invoices">
            {invoices.length === 0 ? (
              <EmptyState
                icon={<WalletCards />}
                title="All fees settled"
                body="No outstanding invoices for any of this guardian's children."
              />
            ) : (
              <div className="space-y-3">
                <div className="overflow-x-auto rounded-xl border border-slate-100">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50">
                        <TableHead className="text-xs">Student</TableHead>
                        <TableHead className="text-xs">Type</TableHead>
                        <TableHead className="text-xs text-right">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoices.map((inv) => (
                        <TableRow key={inv.invoice_id} className="hover:bg-slate-50">
                          <TableCell className="text-sm font-medium">{inv.student_name}</TableCell>
                          <TableCell>
                            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs">
                              {normalizeType(inv.invoice_type)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right text-sm font-bold text-red-600">
                            {fmtKes(inv.balance_amount)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow>
                        <TableCell colSpan={2} className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Total</TableCell>
                        <TableCell className="text-right text-sm font-bold text-red-700">
                          {fmtKes(invoices.reduce((s, i) => s + toNum(i.balance_amount), 0))}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>

                {/* Finance CTA */}
                <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                  <p className="text-sm font-medium text-blue-800">Record a payment</p>
                  <p className="mt-0.5 text-xs text-blue-600">
                    All payments — including bulk payments for multiple children — are recorded
                    in the Finance module to keep all transactions in one place.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {detail.children.map((child) => (
                      toNum(child.outstanding) > 0 && (
                        <a
                          key={child.enrollment_id}
                          href={`/tenant/secretary/finance?section=payments&enrollment_id=${child.enrollment_id}`}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition"
                        >
                          Pay for {child.student_name}
                        </a>
                      )
                    ))}
                    <a
                      href="/tenant/secretary/finance?section=payments"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 transition"
                    >
                      Open Finance →
                    </a>
                  </div>
                </div>
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

function SecretaryParentsPageContent() {
  const [parents, setParents] = useState<ParentListItem[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [classes, setClasses] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addSaving, setAddSaving] = useState(false);

  const loadParents = useCallback(async (cc?: string) => {
    setLoading(true);
    const classParam = cc !== undefined ? cc : classFilter;
    const qs = classParam ? `?class_code=${encodeURIComponent(classParam)}` : "";
    try {
      const [ps, enrs] = await Promise.all([
        api.get<ParentListItem[]>(`/parents${qs}`, { tenantRequired: true }),
        api.get<unknown>("/enrollments/", { tenantRequired: true, noRedirect: true }).catch(() => [] as unknown),
      ]);
      setParents(Array.isArray(ps) ? ps : []);

      // Normalize enrollments for link modal
      const rawEnrs = Array.isArray(enrs)
        ? enrs
        : Array.isArray((enrs as { items?: unknown[] })?.items)
          ? (enrs as { items: unknown[] }).items
          : [];
      const enrList = rawEnrs
        .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null && "id" in e)
        .map((e) => ({ id: String(e.id), payload: (e.payload as Record<string, unknown>) || {} }));
      setEnrollments(enrList);

      // Derive unique class codes from enrollment payloads for the filter dropdown
      const codes = Array.from(new Set(
        enrList.map((e) => (e.payload?.class_code as string) || (e.payload?.admission_class as string) || "")
          .filter(Boolean)
      )).sort();
      setClasses(codes);
    } catch {
      toast.error("Failed to load parents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadParents(""); }, [loadParents]);
  useEffect(() => { void loadParents(classFilter); }, [classFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await api.post<SyncResult>("/parents/sync-from-enrollments", {}, { tenantRequired: true });
      toast.success(
        `Sync done — ${res.created} new parent${res.created !== 1 ? "s" : ""} created, ${res.linked} student${res.linked !== 1 ? "s" : ""} linked`
      );
      await loadParents();
    } catch { toast.error("Sync failed"); }
    finally { setSyncing(false); }
  }

  async function handleAddParent(data: ParentFormData) {
    setAddSaving(true);
    try {
      const created = await api.post<ParentDetail>("/parents", data, { tenantRequired: true });
      toast.success(`${created.name} added`);
      setShowAdd(false);
      await loadParents();
      setSelectedId(created.id);
    } catch (e: unknown) {
      toast.error((e as { message?: string })?.message || "Failed to add guardian");
    } finally { setAddSaving(false); }
  }

  // Server-side class filter is applied via API; client-side filters text search
  const filtered = parents.filter((p) => {
    const ql = q.trim().toLowerCase();
    if (ql && !p.name.toLowerCase().includes(ql) && !p.phone.includes(ql) && !(p.email || "").toLowerCase().includes(ql)) {
      return false;
    }
    return true;
  });

  const totalOutstanding = parents.reduce((s, p) => s + toNum(p.outstanding_total), 0);

  if (selectedId) {
    return (
      <AppShell nav={secretaryNav} title="Parents">
        <div className="mx-auto max-w-6xl px-4 py-6">
          <ParentDetailView
            parentId={selectedId}
            enrollments={enrollments}
            onBack={() => setSelectedId(null)}
            onUpdated={loadParents}
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell nav={secretaryNav} title="Parents">
      {showAdd && (
        <ParentFormModal
          onSave={handleAddParent}
          onClose={() => setShowAdd(false)}
          saving={addSaving}
        />
      )}

      <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
        {/* Page header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Parents & Guardians</h1>
            <p className="text-sm text-slate-500">
              Manage guardian records and link children to their enrollments.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition"
            >
              {syncing ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
              {syncing ? "Syncing…" : "Sync from Enrollments"}
            </button>
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition"
            >
              <UserPlus className="h-4 w-4" /> Add Guardian
            </button>
          </div>
        </div>

        {/* Summary pills */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Pill label="Total Parents" value={parents.length} color="blue" />
          <Pill label="Total Outstanding" value={fmtKes(totalOutstanding)} color={totalOutstanding > 0 ? "amber" : "emerald"} />
          <Pill label="With Portal Access" value={parents.filter((p) => p.has_portal_access).length} color="slate" />
        </div>

        {/* Search + Class filter */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={q}
              onChange={(e) => { setQ(e.target.value); }}
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
                {classes.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Parents table */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white">
            <EmptyState
              icon={<Users />}
              title={parents.length === 0 ? "No guardian records yet" : "No results match your search"}
              body={
                parents.length === 0
                  ? "Click 'Sync from Enrollments' to auto-import guardians from existing enrollment data, or add them manually."
                  : "Try a different name, phone number, or email."
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-sm">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="text-xs">Name</TableHead>
                  <TableHead className="text-xs">Phone</TableHead>
                  <TableHead className="text-xs">Email</TableHead>
                  <TableHead className="text-xs text-center">Children</TableHead>
                  <TableHead className="text-xs text-right">Outstanding</TableHead>
                  <TableHead className="text-xs text-center">Portal</TableHead>
                  <TableHead className="text-xs"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((parent) => (
                  <TableRow
                    key={parent.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => setSelectedId(parent.id)}
                  >
                    <TableCell className="font-medium text-slate-800">{parent.name}</TableCell>
                    <TableCell className="text-sm text-slate-600">{parent.phone}</TableCell>
                    <TableCell className="text-sm text-slate-500">{parent.email || "—"}</TableCell>
                    <TableCell className="text-center">
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                        <Users className="h-3 w-3" /> {parent.child_count}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={`text-sm font-semibold ${toNum(parent.outstanding_total) > 0 ? "text-red-600" : "text-emerald-600"}`}>
                        {fmtKes(parent.outstanding_total)}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      {parent.has_portal_access ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">Active</span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {toNum(parent.outstanding_total) > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
                          <WalletCards className="h-3 w-3" /> Pay
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="border-t border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-500">
              {filtered.length} guardian{filtered.length !== 1 ? "s" : ""}
              {q ? ` matching "${q}"` : ""}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default function SecretaryParentsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
        </div>
      }
    >
      <SecretaryParentsPageContent />
    </Suspense>
  );
}
