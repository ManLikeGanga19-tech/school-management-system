"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock,
  FileText,
  Loader2,
  MessageSquarePlus,
  Plus,
  RefreshCw,
  Save,
  Shield,
  UserX,
  X,
} from "lucide-react";

import { AppShell, type AppNavItem } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { api, apiFetch } from "@/lib/api";
import { normalizeTerms, type TenantTerm } from "@/lib/school-setup/terms";
import { normalizeClassOptions, type TenantClassOption } from "@/lib/hr";
import { normalizeEnrollmentRows, studentName, type EnrollmentRow } from "@/lib/students";

// ── Types ──────────────────────────────────────────────────────────────────────

const INCIDENT_TYPES = [
  "BULLYING", "FIGHTING", "TRUANCY", "MISCONDUCT", "VANDALISM",
  "SUBSTANCE_ABUSE", "HARASSMENT", "THEFT", "INSUBORDINATION", "OTHER",
];
const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const STATUSES = ["OPEN", "UNDER_REVIEW", "RESOLVED", "CLOSED"];
const ROLES = ["PERPETRATOR", "VICTIM", "WITNESS"];
const ACTIONS = ["WARNING", "DETENTION", "SUSPENSION", "EXPULSION", "PARENT_MEETING", "COUNSELLING", "NONE"];

type IncidentStudent = {
  id: string;
  student_id: string;
  student_name?: string;
  admission_no?: string;
  class_name?: string;
  role: string;
  action_taken?: string;
  action_notes?: string;
  parent_notified: boolean;
  parent_notified_at?: string;
};

type Followup = {
  id: string;
  followup_date: string;
  notes: string;
  created_by_name?: string;
  created_at: string;
};

type Incident = {
  id: string;
  incident_date: string;
  incident_type: string;
  severity: string;
  title: string;
  status: string;
  location?: string;
  description?: string;
  reported_by_name?: string;
  resolution_notes?: string;
  resolved_at?: string;
  students: IncidentStudent[];
  followups: Followup[];
  created_at: string;
};

type IncidentListItem = {
  id: string;
  incident_date: string;
  incident_type: string;
  severity: string;
  title: string;
  status: string;
  location?: string;
  student_count: number;
  created_at: string;
};

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function asStr(v: unknown): string { return typeof v === "string" ? v : ""; }
function asArr(v: unknown): unknown[] { return Array.isArray(v) ? v : []; }

function normIncidents(raw: unknown): IncidentListItem[] {
  return asArr(raw).map((r) => {
    const o = asObject(r);
    if (!o) return null;
    return {
      id: asStr(o.id),
      incident_date: asStr(o.incident_date),
      incident_type: asStr(o.incident_type),
      severity: asStr(o.severity),
      title: asStr(o.title),
      status: asStr(o.status),
      location: o.location ? asStr(o.location) : undefined,
      student_count: Number(o.student_count ?? 0),
      created_at: asStr(o.created_at),
    };
  }).filter((x): x is IncidentListItem => Boolean(x?.id));
}

function normIncident(raw: unknown): Incident | null {
  const o = asObject(raw);
  if (!o) return null;
  return {
    id: asStr(o.id),
    incident_date: asStr(o.incident_date),
    incident_type: asStr(o.incident_type),
    severity: asStr(o.severity),
    title: asStr(o.title),
    status: asStr(o.status),
    location: o.location ? asStr(o.location) : undefined,
    description: o.description ? asStr(o.description) : undefined,
    reported_by_name: o.reported_by_name ? asStr(o.reported_by_name) : undefined,
    resolution_notes: o.resolution_notes ? asStr(o.resolution_notes) : undefined,
    resolved_at: o.resolved_at ? asStr(o.resolved_at) : undefined,
    students: asArr(o.students).map((s) => {
      const so = asObject(s);
      if (!so) return null;
      return {
        id: asStr(so.id),
        student_id: asStr(so.student_id),
        student_name: so.student_name ? asStr(so.student_name) : undefined,
        admission_no: so.admission_no ? asStr(so.admission_no) : undefined,
        class_name: so.class_name ? asStr(so.class_name) : undefined,
        role: asStr(so.role),
        action_taken: so.action_taken ? asStr(so.action_taken) : undefined,
        action_notes: so.action_notes ? asStr(so.action_notes) : undefined,
        parent_notified: Boolean(so.parent_notified),
        parent_notified_at: so.parent_notified_at ? asStr(so.parent_notified_at) : undefined,
      };
    }).filter((x): x is IncidentStudent => Boolean(x?.id)),
    followups: asArr(o.followups).map((f) => {
      const fo = asObject(f);
      if (!fo) return null;
      return {
        id: asStr(fo.id),
        followup_date: asStr(fo.followup_date),
        notes: asStr(fo.notes),
        created_by_name: fo.created_by_name ? asStr(fo.created_by_name) : undefined,
        created_at: asStr(fo.created_at),
      };
    }).filter((x): x is Followup => Boolean(x?.id)),
    created_at: asStr(o.created_at),
  };
}

// ── Severity badge ─────────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    LOW: "bg-emerald-100 text-emerald-700",
    MEDIUM: "bg-amber-100 text-amber-700",
    HIGH: "bg-orange-100 text-orange-700",
    CRITICAL: "bg-red-100 text-red-700",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${colors[severity] ?? "bg-slate-100 text-slate-600"}`}>
      {severity}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    OPEN: "bg-blue-100 text-blue-700",
    UNDER_REVIEW: "bg-amber-100 text-amber-700",
    RESOLVED: "bg-emerald-100 text-emerald-700",
    CLOSED: "bg-slate-100 text-slate-500",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${colors[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status.replace("_", " ")}
    </span>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

type Props = {
  title: string;
  nav: AppNavItem[];
  canManage?: boolean;
  canResolve?: boolean;
};

export function DisciplineModulePage({ title, nav, canManage = false, canResolve = false }: Props) {
  const params = useSearchParams();
  const section = (params?.get("section") || "incidents") as "incidents" | "new";

  const [incidents, setIncidents] = useState<IncidentListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Filters
  const [filterStatus, setFilterStatus] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterSeverity, setFilterSeverity] = useState("");

  // New incident form
  const [newForm, setNewForm] = useState({
    incident_date: new Date().toISOString().slice(0, 10),
    incident_type: "MISCONDUCT",
    severity: "LOW",
    title: "",
    description: "",
    location: "",
  });
  const [savingNew, setSavingNew] = useState(false);

  // Add student dialog
  const [addStudentOpen, setAddStudentOpen] = useState(false);
  const [terms, setTerms] = useState<TenantTerm[]>([]);
  const [classes, setClasses] = useState<TenantClassOption[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);
  const [selectedTermId, setSelectedTermId] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState("");
  const [studentRole, setStudentRole] = useState("PERPETRATOR");
  const [studentAction, setStudentAction] = useState("");
  const [studentActionNotes, setStudentActionNotes] = useState("");
  const [savingStudent, setSavingStudent] = useState(false);

  // Update status dialog
  const [updateStatusOpen, setUpdateStatusOpen] = useState(false);
  const [newStatus, setNewStatus] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [savingStatus, setSavingStatus] = useState(false);

  // Add followup
  const [followupOpen, setFollowupOpen] = useState(false);
  const [followupDate, setFollowupDate] = useState(new Date().toISOString().slice(0, 10));
  const [followupNotes, setFollowupNotes] = useState("");
  const [savingFollowup, setSavingFollowup] = useState(false);

  const loadIncidents = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: "50", offset: "0" });
      if (filterStatus) qs.set("status", filterStatus);
      if (filterType) qs.set("incident_type", filterType);
      if (filterSeverity) qs.set("severity", filterSeverity);
      const raw = await api.get<unknown>(`/discipline/incidents?${qs}`, { tenantRequired: true });
      const obj = asObject(raw);
      setTotal(Number(obj?.total ?? 0));
      setIncidents(normIncidents(obj?.items));
    } catch {
      toast.error("Failed to load incidents.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [filterStatus, filterType, filterSeverity]);

  useEffect(() => { void loadIncidents(); }, [loadIncidents]);

  // Load terms + classes when add student dialog opens
  useEffect(() => {
    if (!addStudentOpen) return;
    Promise.all([
      api.get<unknown>("/tenants/terms", { tenantRequired: true }),
      api.get<unknown>("/tenants/classes", { tenantRequired: true }),
    ]).then(([t, c]) => {
      setTerms(normalizeTerms(t));
      setClasses(normalizeClassOptions(c));
    }).catch(() => {});
  }, [addStudentOpen]);

  // Load enrollments when class+term selected
  useEffect(() => {
    if (!selectedClassId || !selectedTermId) { setEnrollments([]); return; }
    api.get<unknown>(`/students/enrollments?class_id=${selectedClassId}&term_id=${selectedTermId}`, { tenantRequired: true })
      .then((r) => setEnrollments(normalizeEnrollmentRows(r)))
      .catch(() => setEnrollments([]));
  }, [selectedClassId, selectedTermId]);

  async function openIncident(id: string) {
    setLoadingDetail(true);
    try {
      const raw = await api.get<unknown>(`/discipline/incidents/${id}`, { tenantRequired: true });
      const obj = asObject(raw);
      const inc = normIncident(obj?.incident);
      setSelectedIncident(inc);
    } catch {
      toast.error("Failed to load incident.");
    } finally {
      setLoadingDetail(false);
    }
  }

  async function createIncident() {
    if (!newForm.title.trim()) { toast.error("Title is required."); return; }
    setSavingNew(true);
    try {
      await apiFetch("/discipline/incidents", {
        method: "POST",
        tenantRequired: true,
        body: JSON.stringify({
          incident_date: newForm.incident_date,
          incident_type: newForm.incident_type,
          severity: newForm.severity,
          title: newForm.title.trim(),
          description: newForm.description.trim() || undefined,
          location: newForm.location.trim() || undefined,
        }),
      });
      toast.success("Incident created.");
      setNewForm({ incident_date: new Date().toISOString().slice(0, 10), incident_type: "MISCONDUCT", severity: "LOW", title: "", description: "", location: "" });
      await loadIncidents(true);
      // Switch to incidents view
      window.history.replaceState(null, "", "?section=incidents");
      window.location.reload();
    } catch {
      toast.error("Failed to create incident.");
    } finally {
      setSavingNew(false);
    }
  }

  async function addStudent() {
    if (!selectedIncident || !selectedEnrollmentId) { toast.error("Select a student first."); return; }
    const enrollment = enrollments.find((e) => e.id === selectedEnrollmentId);
    if (!enrollment) return;
    setSavingStudent(true);
    try {
      const raw = await apiFetch(`/discipline/incidents/${selectedIncident.id}/students`, {
        method: "POST",
        tenantRequired: true,
        body: JSON.stringify({
          student_id: asStr(enrollment.payload?.student_id) || selectedEnrollmentId,
          enrollment_id: selectedEnrollmentId,
          role: studentRole,
          action_taken: studentAction || undefined,
          action_notes: studentActionNotes.trim() || undefined,
        }),
      });
      const obj = asObject(await (raw as Response).json?.() ?? raw);
      const inc = normIncident(asObject(obj)?.incident);
      if (inc) setSelectedIncident(inc);
      setAddStudentOpen(false);
      setSelectedEnrollmentId(""); setStudentAction(""); setStudentActionNotes("");
      toast.success("Student added to incident.");
      await loadIncidents(true);
    } catch {
      toast.error("Failed to add student.");
    } finally {
      setSavingStudent(false);
    }
  }

  async function updateStatus() {
    if (!selectedIncident || !newStatus) return;
    setSavingStatus(true);
    try {
      const raw = await apiFetch(`/discipline/incidents/${selectedIncident.id}`, {
        method: "PATCH",
        tenantRequired: true,
        body: JSON.stringify({
          status: newStatus,
          resolution_notes: resolutionNotes.trim() || undefined,
        }),
      });
      const json = asObject(await (raw as Response).json?.() ?? raw);
      const inc = normIncident(asObject(json)?.incident);
      if (inc) setSelectedIncident(inc);
      setUpdateStatusOpen(false);
      setResolutionNotes("");
      toast.success(`Status updated to ${newStatus}.`);
      await loadIncidents(true);
    } catch {
      toast.error("Failed to update status.");
    } finally {
      setSavingStatus(false);
    }
  }

  async function addFollowup() {
    if (!selectedIncident || !followupNotes.trim()) { toast.error("Notes are required."); return; }
    setSavingFollowup(true);
    try {
      const raw = await apiFetch(`/discipline/incidents/${selectedIncident.id}/followups`, {
        method: "POST",
        tenantRequired: true,
        body: JSON.stringify({ followup_date: followupDate, notes: followupNotes.trim() }),
      });
      const json = asObject(await (raw as Response).json?.() ?? raw);
      const inc = normIncident(asObject(json)?.incident);
      if (inc) setSelectedIncident(inc);
      setFollowupOpen(false);
      setFollowupNotes("");
      toast.success("Follow-up added.");
    } catch {
      toast.error("Failed to add follow-up.");
    } finally {
      setSavingFollowup(false);
    }
  }

  async function removeStudent(linkId: string) {
    if (!selectedIncident) return;
    if (!confirm("Remove this student from the incident?")) return;
    try {
      await apiFetch(`/discipline/incidents/${selectedIncident.id}/students/${linkId}`, {
        method: "DELETE",
        tenantRequired: true,
      });
      const raw = await api.get<unknown>(`/discipline/incidents/${selectedIncident.id}`, { tenantRequired: true });
      const obj = asObject(raw);
      const inc = normIncident(obj?.incident);
      if (inc) setSelectedIncident(inc);
      await loadIncidents(true);
      toast.success("Student removed.");
    } catch {
      toast.error("Failed to remove student.");
    }
  }

  const activeHref = `/tenant/${title.toLowerCase()}/discipline?section=${section}`;

  if (loading) {
    return (
      <AppShell title={title} nav={nav} activeHref={activeHref}>
        <div className="flex min-h-[380px] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title={title} nav={nav} activeHref={activeHref}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-red-600" />
            <h1 className="text-lg font-semibold text-slate-900">Discipline</h1>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{total} incidents</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void loadIncidents()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Refresh
            </Button>
            {canManage && (
              <Button size="sm" asChild>
                <a href="?section=new">
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  New Incident
                </a>
              </Button>
            )}
          </div>
        </div>

        {/* Section tabs */}
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 w-fit">
          {(["incidents", ...(canManage ? ["new"] : [])] as const).map((s) => (
            <a
              key={s}
              href={`?section=${s}`}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${section === s ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            >
              {s === "incidents" ? "Incidents" : "New Incident"}
            </a>
          ))}
        </div>

        {/* ── Incidents list ───────────────────────────────────────────────── */}
        {section === "incidents" && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Left: list */}
            <div className="space-y-3">
              {/* Filters */}
              <div className="flex flex-wrap gap-2">
                <select
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm"
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                >
                  <option value="">All statuses</option>
                  {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                </select>
                <select
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm"
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                >
                  <option value="">All types</option>
                  {INCIDENT_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
                </select>
                <select
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm"
                  value={filterSeverity}
                  onChange={(e) => setFilterSeverity(e.target.value)}
                >
                  <option value="">All severities</option>
                  {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              {incidents.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-12 text-center">
                  <Shield className="mx-auto mb-3 h-8 w-8 text-slate-300" />
                  <p className="text-sm text-slate-500">No incidents found.</p>
                  {canManage && (
                    <Button size="sm" className="mt-4" asChild>
                      <a href="?section=new"><Plus className="mr-1.5 h-3.5 w-3.5" />Log First Incident</a>
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {incidents.map((inc) => (
                    <button
                      key={inc.id}
                      onClick={() => void openIncident(inc.id)}
                      className={`w-full rounded-xl border p-4 text-left transition-all hover:shadow-sm ${selectedIncident?.id === inc.id ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white hover:border-slate-300"}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-800">{inc.title}</p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {inc.incident_date} · {inc.incident_type.replace("_", " ")}
                            {inc.location ? ` · ${inc.location}` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <SeverityBadge severity={inc.severity} />
                          <StatusBadge status={inc.status} />
                        </div>
                      </div>
                      <div className="mt-2 flex items-center gap-3 text-xs text-slate-400">
                        <span className="flex items-center gap-1">
                          <UserX className="h-3 w-3" />
                          {inc.student_count} student{inc.student_count !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Right: detail */}
            <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
              {loadingDetail ? (
                <div className="flex h-64 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                </div>
              ) : !selectedIncident ? (
                <div className="flex h-64 items-center justify-center text-sm text-slate-400">
                  Select an incident to view details
                </div>
              ) : (
                <div className="p-5 space-y-4">
                  {/* Title bar */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="font-semibold text-slate-900">{selectedIncident.title}</h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {selectedIncident.incident_date} · {selectedIncident.incident_type.replace("_", " ")}
                        {selectedIncident.location ? ` · ${selectedIncident.location}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <SeverityBadge severity={selectedIncident.severity} />
                      <StatusBadge status={selectedIncident.status} />
                    </div>
                  </div>

                  {selectedIncident.description && (
                    <p className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3">{selectedIncident.description}</p>
                  )}

                  {selectedIncident.resolution_notes && (
                    <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3">
                      <p className="text-xs font-semibold text-emerald-700 mb-1">Resolution</p>
                      <p className="text-sm text-emerald-800">{selectedIncident.resolution_notes}</p>
                    </div>
                  )}

                  {/* Actions */}
                  {(canManage || canResolve) && selectedIncident.status !== "CLOSED" && (
                    <div className="flex flex-wrap gap-2">
                      {canManage && (
                        <Button size="sm" variant="outline" onClick={() => setAddStudentOpen(true)}>
                          <UserX className="mr-1.5 h-3.5 w-3.5" />
                          Add Student
                        </Button>
                      )}
                      {canManage && (
                        <Button size="sm" variant="outline" onClick={() => { setFollowupOpen(true); }}>
                          <MessageSquarePlus className="mr-1.5 h-3.5 w-3.5" />
                          Follow-up
                        </Button>
                      )}
                      {(canManage || canResolve) && (
                        <Button size="sm" variant="outline" onClick={() => { setNewStatus(selectedIncident.status); setUpdateStatusOpen(true); }}>
                          <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                          Update Status
                        </Button>
                      )}
                    </div>
                  )}

                  {/* Students */}
                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Students Involved</h3>
                    {selectedIncident.students.length === 0 ? (
                      <p className="text-xs text-slate-400">No students linked yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {selectedIncident.students.map((s) => (
                          <div key={s.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm font-medium text-slate-800">{s.student_name || "Unknown"}</p>
                                <p className="text-xs text-slate-500">
                                  {s.admission_no && `${s.admission_no} · `}
                                  {s.class_name && `${s.class_name} · `}
                                  <span className="font-medium">{s.role}</span>
                                  {s.action_taken && ` → ${s.action_taken.replace("_", " ")}`}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                {s.parent_notified && (
                                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-700">Parent notified</span>
                                )}
                                {canManage && selectedIncident.status !== "CLOSED" && (
                                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-slate-400 hover:text-red-500"
                                    onClick={() => void removeStudent(s.id)}>
                                    <X className="h-3 w-3" />
                                  </Button>
                                )}
                              </div>
                            </div>
                            {s.action_notes && <p className="mt-1 text-xs text-slate-500 italic">{s.action_notes}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Follow-ups */}
                  {selectedIncident.followups.length > 0 && (
                    <div>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Follow-ups</h3>
                      <div className="space-y-2">
                        {selectedIncident.followups.map((f) => (
                          <div key={f.id} className="rounded-lg border border-slate-100 bg-amber-50 p-3">
                            <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                              <span className="font-medium">{f.followup_date}</span>
                              <span>{f.created_by_name}</span>
                            </div>
                            <p className="text-sm text-slate-700">{f.notes}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <p className="text-[10px] text-slate-400">
                    Reported by {selectedIncident.reported_by_name || "system"} · {selectedIncident.created_at.slice(0, 10)}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── New Incident form ────────────────────────────────────────────── */}
        {section === "new" && canManage && (
          <div className="max-w-2xl space-y-4">
            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-6">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <h2 className="text-sm font-semibold text-slate-900">Log New Incident</h2>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs">Incident Date *</Label>
                    <Input type="date" className="mt-1" value={newForm.incident_date}
                      onChange={(e) => setNewForm((f) => ({ ...f, incident_date: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-xs">Type *</Label>
                    <select className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                      value={newForm.incident_type} onChange={(e) => setNewForm((f) => ({ ...f, incident_type: e.target.value }))}>
                      {INCIDENT_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs">Severity</Label>
                    <select className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                      value={newForm.severity} onChange={(e) => setNewForm((f) => ({ ...f, severity: e.target.value }))}>
                      {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs">Location</Label>
                    <Input className="mt-1" placeholder="e.g. Playground, Classroom 3B"
                      value={newForm.location} onChange={(e) => setNewForm((f) => ({ ...f, location: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Title *</Label>
                  <Input className="mt-1" placeholder="Brief description of the incident"
                    value={newForm.title} onChange={(e) => setNewForm((f) => ({ ...f, title: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Full Description</Label>
                  <Textarea className="mt-1" rows={4} placeholder="Detailed account of what happened…"
                    value={newForm.description} onChange={(e) => setNewForm((f) => ({ ...f, description: e.target.value }))} />
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <Button variant="outline" asChild><a href="?section=incidents">Cancel</a></Button>
                <Button onClick={() => void createIncident()} disabled={savingNew}>
                  {savingNew ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                  Create Incident
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add student dialog */}
      <Dialog open={addStudentOpen} onOpenChange={setAddStudentOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Student to Incident</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Term</Label>
              <select className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                value={selectedTermId} onChange={(e) => { setSelectedTermId(e.target.value); setSelectedEnrollmentId(""); }}>
                <option value="">— Select term —</option>
                {terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">Class</Label>
              <select className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                value={selectedClassId} onChange={(e) => { setSelectedClassId(e.target.value); setSelectedEnrollmentId(""); }}>
                <option value="">— Select class —</option>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">Student</Label>
              <select className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                value={selectedEnrollmentId} onChange={(e) => setSelectedEnrollmentId(e.target.value)}
                disabled={!selectedClassId || !selectedTermId}>
                <option value="">— Select student —</option>
                {enrollments.map((e) => <option key={e.id} value={e.id}>{studentName(e)}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Role</Label>
                <select className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                  value={studentRole} onChange={(e) => setStudentRole(e.target.value)}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">Action Taken</Label>
                <select className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                  value={studentAction} onChange={(e) => setStudentAction(e.target.value)}>
                  <option value="">— None —</option>
                  {ACTIONS.map((a) => <option key={a} value={a}>{a.replace("_", " ")}</option>)}
                </select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Action Notes</Label>
              <Textarea className="mt-1" rows={2} value={studentActionNotes}
                onChange={(e) => setStudentActionNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddStudentOpen(false)}>Cancel</Button>
            <Button onClick={() => void addStudent()} disabled={savingStudent || !selectedEnrollmentId}>
              {savingStudent ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Add Student
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Update status dialog */}
      <Dialog open={updateStatusOpen} onOpenChange={setUpdateStatusOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Update Incident Status</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">New Status</Label>
              <select className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
                {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
              </select>
            </div>
            {(newStatus === "RESOLVED" || newStatus === "CLOSED") && (
              <div>
                <Label className="text-xs">Resolution Notes</Label>
                <Textarea className="mt-1" rows={3} value={resolutionNotes}
                  placeholder="Describe how this was resolved…"
                  onChange={(e) => setResolutionNotes(e.target.value)} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpdateStatusOpen(false)}>Cancel</Button>
            <Button onClick={() => void updateStatus()} disabled={savingStatus}>
              {savingStatus ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Follow-up dialog */}
      <Dialog open={followupOpen} onOpenChange={setFollowupOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Follow-up Note</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" className="mt-1" value={followupDate}
                onChange={(e) => setFollowupDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Notes *</Label>
              <Textarea className="mt-1" rows={4} value={followupNotes}
                placeholder="What happened at this follow-up? Actions taken, parent response, etc."
                onChange={(e) => setFollowupNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFollowupOpen(false)}>Cancel</Button>
            <Button onClick={() => void addFollowup()} disabled={savingFollowup || !followupNotes.trim()}>
              {savingFollowup ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Add Note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
