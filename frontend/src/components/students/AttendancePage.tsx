"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Users,
  CalendarDays,
  ClipboardCheck,
  BarChart2,
  Plus,
  RefreshCw,
  ChevronRight,
  CheckCircle,
  XCircle,
  Clock,
  ShieldCheck,
  Plane,
  ArrowLeft,
} from "lucide-react";

import { AppShell, type AppNavItem } from "@/components/layout/AppShell";
import { TenantPageHeader } from "@/components/tenant/page-chrome";
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
import { normalizeClassOptions, type TenantClassOption } from "@/lib/hr";
import { normalizeTerms as normalizeTermsFromSetup, type TenantTerm } from "@/lib/school-setup/terms";

type Props = {
  appTitle: string;
  nav: AppNavItem[];
  activeHref: string;
};

type AttendanceStatus = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED" | "OFF_GROUNDS";
type SessionStatus = "DRAFT" | "SUBMITTED" | "FINALIZED";
type SessionType = "MORNING" | "AFTERNOON" | "PERIOD";

type RosterStudent = {
  enrollment_id: string;
  student_id: string;
  admission_no: string;
  student_name: string;
  status: string;
};

type Session = {
  id: string;
  class_id: string;
  class_code: string;
  session_date: string;
  session_type: SessionType;
  period_number: number | null;
  status: SessionStatus;
  marked_by_user_id: string | null;
  submitted_at: string | null;
  finalized_at: string | null;
};

type AttendanceRecord = {
  id: string;
  enrollment_id: string;
  student_id: string;
  student_name: string;
  status: AttendanceStatus;
  notes: string | null;
};

type Tab = "roster" | "sessions" | "reports";

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

const STATUS_CONFIG: Record<
  AttendanceStatus,
  { label: string; icon: React.ReactNode; bg: string; text: string }
> = {
  PRESENT: { label: "Present", icon: <CheckCircle className="h-4 w-4" />, bg: "bg-emerald-100 hover:bg-emerald-200", text: "text-emerald-700" },
  ABSENT: { label: "Absent", icon: <XCircle className="h-4 w-4" />, bg: "bg-red-100 hover:bg-red-200", text: "text-red-700" },
  LATE: { label: "Late", icon: <Clock className="h-4 w-4" />, bg: "bg-amber-100 hover:bg-amber-200", text: "text-amber-700" },
  EXCUSED: { label: "Excused", icon: <ShieldCheck className="h-4 w-4" />, bg: "bg-blue-100 hover:bg-blue-200", text: "text-blue-700" },
  OFF_GROUNDS: { label: "Off Grounds", icon: <Plane className="h-4 w-4" />, bg: "bg-purple-100 hover:bg-purple-200", text: "text-purple-700" },
};

const STATUS_CYCLE: AttendanceStatus[] = ["PRESENT", "ABSENT", "LATE", "EXCUSED", "OFF_GROUNDS"];

export function AttendancePage({ appTitle, nav, activeHref }: Props) {
  const [tab, setTab] = useState<Tab>("roster");

  // Reference data
  const [classes, setClasses] = useState<TenantClassOption[]>([]);
  const [terms, setTerms] = useState<TenantTerm[]>([]);
  const [refLoading, setRefLoading] = useState(true);

  // Roster state
  const [rosterClassId, setRosterClassId] = useState("");
  const [rosterTermId, setRosterTermId] = useState("");
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [enrollDialog, setEnrollDialog] = useState(false);
  const [enrollStudentId, setEnrollStudentId] = useState("");
  const [enrollTermId, setEnrollTermId] = useState("");
  const [savingRoster, setSavingRoster] = useState(false);

  // Sessions state
  const [sessClassId, setSessClassId] = useState("");
  const [sessTermId, setSessTermId] = useState("");
  const [sessDate, setSessDate] = useState(new Date().toISOString().slice(0, 10));
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessLoading, setSessLoading] = useState(false);
  const [createSessDialog, setCreateSessDialog] = useState(false);
  const [sessForm, setSessForm] = useState({ session_type: "MORNING" as SessionType, session_date: new Date().toISOString().slice(0, 10), period_number: "" });
  const [savingSess, setSavingSess] = useState(false);

  // Roll call (opened from session)
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [rollCall, setRollCall] = useState<AttendanceRecord[]>([]);
  const [rollCallLoading, setRollCallLoading] = useState(false);
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  const [submittingRoll, setSubmittingRoll] = useState(false);

  // Reports state
  const [reportType, setReportType] = useState<"student" | "class">("class");
  const [reportClassId, setReportClassId] = useState("");
  const [reportTermId, setReportTermId] = useState("");
  const [reportStudentId, setReportStudentId] = useState("");
  const [reportData, setReportData] = useState<unknown>(null);
  const [reportLoading, setReportLoading] = useState(false);

  // ── Load reference data ────────────────────────────────────────────────────
  const loadRef = useCallback(async () => {
    setRefLoading(true);
    try {
      const [classesRaw, termsRaw] = await Promise.all([
        api.get<unknown>("/tenants/classes", { tenantRequired: true }).catch(() => []),
        api.get<unknown>("/tenants/terms", { tenantRequired: true }).catch(() => []),
      ]);
      const cls = normalizeClassOptions(classesRaw);
      setClasses(cls);
      if (cls[0]) { setRosterClassId(cls[0].id); setSessClassId(cls[0].id); setReportClassId(cls[0].id); }

      const ts = normalizeTermsFromSetup(termsRaw);
      setTerms(ts);
      if (ts[0]) { setRosterTermId(ts[0].id); setEnrollTermId(ts[0].id); setReportTermId(ts[0].id); setSessTermId(ts[0].id); }
    } catch {
      toast.error("Failed to load classes/terms.");
    } finally {
      setRefLoading(false);
    }
  }, []);

  useEffect(() => { void loadRef(); }, [loadRef]);

  // ── Load roster ────────────────────────────────────────────────────────────
  const loadRoster = useCallback(async () => {
    if (!rosterClassId || !rosterTermId) return;
    setRosterLoading(true);
    try {
      const raw = await api.get<unknown>(
        `/attendance/classes/${encodeURIComponent(rosterClassId)}/roster?term_id=${encodeURIComponent(rosterTermId)}`,
        { tenantRequired: true }
      );
      setRoster(
        asArray<unknown>(raw)
          .map((r) => asObject(r))
          .filter((r): r is Record<string, unknown> => Boolean(r))
          .map((r) => ({
            enrollment_id: str(r.enrollment_id || r.id),
            student_id: str(r.student_id),
            admission_no: str(r.admission_no || r.admission_number),
            student_name: str(r.student_name),
            status: str(r.status) || "ACTIVE",
          }))
      );
    } catch {
      toast.error("Failed to load roster.");
    } finally {
      setRosterLoading(false);
    }
  }, [rosterClassId, rosterTermId]);

  useEffect(() => { if (tab === "roster") void loadRoster(); }, [tab, loadRoster]);

  // ── Enroll student ─────────────────────────────────────────────────────────
  async function enrollStudent() {
    if (!rosterClassId || !enrollStudentId.trim() || !enrollTermId) {
      toast.error("Student ID and term are required.");
      return;
    }
    setSavingRoster(true);
    try {
      await api.post<unknown>(
        `/attendance/classes/${encodeURIComponent(rosterClassId)}/enroll`,
        { student_id: enrollStudentId.trim(), term_id: enrollTermId },
        { tenantRequired: true }
      );
      toast.success("Student enrolled in class.");
      setEnrollDialog(false);
      setEnrollStudentId("");
      await loadRoster();
    } catch (err: unknown) {
      const msg = asObject(err)?.detail;
      toast.error(typeof msg === "string" ? msg : "Failed to enroll student.");
    } finally {
      setSavingRoster(false);
    }
  }

  async function withdrawStudent(enrollmentId: string) {
    setSavingRoster(true);
    try {
      await api.patch<unknown>(
        `/attendance/classes/${encodeURIComponent(rosterClassId)}/roster/${encodeURIComponent(enrollmentId)}`,
        { status: "WITHDRAWN" },
        { tenantRequired: true }
      );
      toast.success("Student withdrawn.");
      await loadRoster();
    } catch {
      toast.error("Failed to withdraw student.");
    } finally {
      setSavingRoster(false);
    }
  }

  // ── Load sessions ──────────────────────────────────────────────────────────
  const loadSessions = useCallback(async () => {
    if (!sessClassId || !sessTermId) return;
    setSessLoading(true);
    try {
      const raw = await api.get<unknown>(
        `/attendance/sessions?class_id=${encodeURIComponent(sessClassId)}&term_id=${encodeURIComponent(sessTermId)}&session_date=${sessDate}`,
        { tenantRequired: true }
      );
      setSessions(
        asArray<unknown>(raw)
          .map((r) => asObject(r))
          .filter((r): r is Record<string, unknown> => Boolean(r))
          .map((r) => ({
            id: str(r.id),
            class_id: str(r.class_id),
            class_code: str(r.class_code),
            session_date: str(r.session_date),
            session_type: (str(r.session_type) || "MORNING") as SessionType,
            period_number: r.period_number != null ? Number(r.period_number) : null,
            status: (str(r.status) || "DRAFT") as SessionStatus,
            marked_by_user_id: r.marked_by_user_id ? str(r.marked_by_user_id) : null,
            submitted_at: r.submitted_at ? str(r.submitted_at) : null,
            finalized_at: r.finalized_at ? str(r.finalized_at) : null,
          }))
      );
    } catch {
      toast.error("Failed to load sessions.");
    } finally {
      setSessLoading(false);
    }
  }, [sessClassId, sessTermId, sessDate]);

  useEffect(() => { if (tab === "sessions") void loadSessions(); }, [tab, loadSessions]);

  // ── Create session ─────────────────────────────────────────────────────────
  async function createSession() {
    if (!sessClassId) { toast.error("Select a class first."); return; }
    if (!sessTermId) { toast.error("Select a term first."); return; }
    setSavingSess(true);
    try {
      await api.post<unknown>(
        "/attendance/sessions",
        {
          class_id: sessClassId,
          term_id: sessTermId,
          session_date: sessForm.session_date,
          session_type: sessForm.session_type,
          period_number: sessForm.period_number ? Number(sessForm.period_number) : null,
        },
        { tenantRequired: true }
      );
      toast.success("Session created.");
      setCreateSessDialog(false);
      await loadSessions();
    } catch (err: unknown) {
      const msg = asObject(err)?.detail;
      toast.error(typeof msg === "string" ? msg : "Failed to create session.");
    } finally {
      setSavingSess(false);
    }
  }

  // ── Open roll call ─────────────────────────────────────────────────────────
  async function openRollCall(session: Session) {
    setActiveSession(session);
    setRollCallLoading(true);
    try {
      const raw = await api.get<unknown>(
        `/attendance/sessions/${encodeURIComponent(session.id)}`,
        { tenantRequired: true }
      );
      const obj = asObject(raw);
      const records = asArray<unknown>(obj?.records ?? [])
        .map((r) => asObject(r))
        .filter((r): r is Record<string, unknown> => Boolean(r))
        .map((r) => ({
          id: str(r.id),
          enrollment_id: str(r.enrollment_id),
          student_id: str(r.student_id),
          student_name: str(r.student_name),
          status: (str(r.status) || "PRESENT") as AttendanceStatus,
          notes: r.notes ? str(r.notes) : null,
        }));
      setRollCall(records);
      const initialMarks: Record<string, AttendanceStatus> = {};
      records.forEach((r) => { initialMarks[r.enrollment_id] = r.status; });
      setMarks(initialMarks);
    } catch {
      toast.error("Failed to load roll call.");
    } finally {
      setRollCallLoading(false);
    }
  }

  function cycleStatus(enrollmentId: string) {
    setMarks((prev) => {
      const current = prev[enrollmentId] || "PRESENT";
      const idx = STATUS_CYCLE.indexOf(current);
      return { ...prev, [enrollmentId]: STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length] };
    });
  }

  async function saveRollCall() {
    if (!activeSession) return;
    setSubmittingRoll(true);
    try {
      const records = rollCall.map((r) => ({
        enrollment_id: r.enrollment_id,
        status: marks[r.enrollment_id] || "PRESENT",
      }));
      await api.post<unknown>(
        `/attendance/sessions/${encodeURIComponent(activeSession.id)}/records`,
        { records },
        { tenantRequired: true }
      );
      toast.success("Roll call saved.");
    } catch {
      toast.error("Failed to save roll call.");
    } finally {
      setSubmittingRoll(false);
    }
  }

  async function submitSession() {
    if (!activeSession) return;
    setSubmittingRoll(true);
    try {
      await saveRollCall();
      await api.post<unknown>(
        `/attendance/sessions/${encodeURIComponent(activeSession.id)}/submit`,
        {},
        { tenantRequired: true }
      );
      setActiveSession((s) => s ? { ...s, status: "SUBMITTED" } : s);
      toast.success("Session submitted.");
    } catch {
      toast.error("Failed to submit session.");
    } finally {
      setSubmittingRoll(false);
    }
  }

  async function finalizeSession() {
    if (!activeSession) return;
    setSubmittingRoll(true);
    try {
      await api.post<unknown>(
        `/attendance/sessions/${encodeURIComponent(activeSession.id)}/finalize`,
        {},
        { tenantRequired: true }
      );
      setActiveSession((s) => s ? { ...s, status: "FINALIZED" } : s);
      toast.success("Session finalized.");
      await loadSessions();
    } catch {
      toast.error("Failed to finalize session.");
    } finally {
      setSubmittingRoll(false);
    }
  }

  // ── Load report ────────────────────────────────────────────────────────────
  async function loadReport() {
    setReportLoading(true);
    try {
      let path = "";
      if (reportType === "class" && reportClassId && reportTermId) {
        path = `/attendance/classes/${encodeURIComponent(reportClassId)}/report?term_id=${encodeURIComponent(reportTermId)}`;
      } else if (reportType === "student" && reportStudentId && reportTermId) {
        path = `/attendance/students/${encodeURIComponent(reportStudentId)}/summary?term_id=${encodeURIComponent(reportTermId)}`;
      } else {
        toast.error("Fill in all fields for the report.");
        setReportLoading(false);
        return;
      }
      const raw = await api.get<unknown>(path, { tenantRequired: true });
      setReportData(raw);
    } catch {
      toast.error("Failed to load attendance report.");
    } finally {
      setReportLoading(false);
    }
  }

  // ── Status badge ───────────────────────────────────────────────────────────
  function SessionStatusBadge({ status }: { status: SessionStatus }) {
    const map: Record<SessionStatus, string> = {
      DRAFT: "bg-slate-100 text-slate-600",
      SUBMITTED: "bg-amber-100 text-amber-700",
      FINALIZED: "bg-emerald-100 text-emerald-700",
    };
    return (
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${map[status]}`}>
        {status}
      </span>
    );
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "roster", label: "Class Roster", icon: <Users className="h-3.5 w-3.5" /> },
    { id: "sessions", label: "Sessions & Roll Call", icon: <ClipboardCheck className="h-3.5 w-3.5" /> },
    { id: "reports", label: "Reports", icon: <BarChart2 className="h-3.5 w-3.5" /> },
  ];

  // ── If roll call is open, show it ──────────────────────────────────────────
  if (activeSession) {
    const isFinalized = activeSession.status === "FINALIZED";
    return (
      <AppShell title={appTitle} nav={nav} activeHref={activeHref}>
        <div className="space-y-5">
          <div className="dashboard-hero rounded-[2rem] p-5 text-white">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold">Roll Call</h1>
                <p className="mt-0.5 text-sm text-blue-100">
                  {activeSession.session_date} · {activeSession.session_type}
                  {activeSession.period_number ? ` · Period ${activeSession.period_number}` : ""}
                  {" · "}<SessionStatusBadge status={activeSession.status} />
                </p>
              </div>
              <Button variant="outline" className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => { setActiveSession(null); void loadSessions(); }}>
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />Back
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900">{rollCall.length} students</p>
                <p className="text-xs text-slate-400">Click status button to cycle through: Present → Absent → Late → Excused → Off Grounds</p>
              </div>
              {!isFinalized && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => void saveRollCall()} disabled={submittingRoll}>
                    Save Draft
                  </Button>
                  {activeSession.status === "DRAFT" && (
                    <Button size="sm" onClick={() => void submitSession()} disabled={submittingRoll}>
                      Submit
                    </Button>
                  )}
                  {activeSession.status === "SUBMITTED" && (
                    <Button size="sm" onClick={() => void finalizeSession()} disabled={submittingRoll}>
                      Finalize
                    </Button>
                  )}
                </div>
              )}
            </div>
            {rollCallLoading ? (
              <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs">#</TableHead>
                      <TableHead className="text-xs">Student</TableHead>
                      <TableHead className="text-xs">Adm No.</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rollCall.map((r, i) => {
                      const status = marks[r.enrollment_id] || r.status;
                      const cfg = STATUS_CONFIG[status];
                      return (
                        <TableRow key={r.enrollment_id}>
                          <TableCell className="text-xs text-slate-400">{i + 1}</TableCell>
                          <TableCell className="text-sm font-medium">{r.student_name}</TableCell>
                          <TableCell className="font-mono text-xs text-slate-500">{r.student_id}</TableCell>
                          <TableCell>
                            <button
                              disabled={isFinalized}
                              onClick={() => cycleStatus(r.enrollment_id)}
                              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${cfg.bg} ${cfg.text} disabled:opacity-60 disabled:cursor-default`}
                            >
                              {cfg.icon}
                              {cfg.label}
                            </button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {rollCall.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="py-10 text-center text-sm text-slate-400">
                          No students enrolled in this class for this session.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title={appTitle} nav={nav} activeHref={activeHref}>
      <div className="space-y-6">
        <TenantPageHeader
          title="Attendance"
          description="Manage class rosters, mark attendance sessions, and view attendance reports."
          badges={[{ label: "Students" }]}
          actions={
            <Button variant="outline" size="sm" onClick={() => void loadRef()} className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white">
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh
            </Button>
          }
        />

        <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
          {/* Tabs */}
          <div className="flex gap-1 border-b border-slate-100 px-4 pt-3">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-xs font-medium transition-colors ${
                  tab === t.id
                    ? "border-b-2 border-blue-600 text-blue-700"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          {/* ── ROSTER TAB ── */}
          {tab === "roster" && (
            <div className="p-6 space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-48 space-y-1.5">
                  <Label className="text-xs">Class</Label>
                  <Select value={rosterClassId} onValueChange={setRosterClassId}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select class…" /></SelectTrigger>
                    <SelectContent>
                      {classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name || c.code}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-48 space-y-1.5">
                  <Label className="text-xs">Term</Label>
                  <Select value={rosterTermId} onValueChange={setRosterTermId}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select term…" /></SelectTrigger>
                    <SelectContent>
                      {terms.map((t) => <SelectItem key={t.id} value={t.id}>{t.name || t.code}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Button size="sm" className="h-8" onClick={() => void loadRoster()} disabled={rosterLoading}>
                  Load Roster
                </Button>
                <Button size="sm" variant="outline" className="h-8 ml-auto" onClick={() => setEnrollDialog(true)}>
                  <Plus className="mr-1 h-3.5 w-3.5" />Enroll Student
                </Button>
              </div>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs">Student Name</TableHead>
                      <TableHead className="text-xs">Admission No.</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-right text-xs">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rosterLoading ? (
                      <TableRow><TableCell colSpan={4} className="py-10 text-center text-sm text-slate-400">Loading…</TableCell></TableRow>
                    ) : roster.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="py-10 text-center text-sm text-slate-400">No students enrolled. Select a class and term, then load roster.</TableCell></TableRow>
                    ) : (
                      roster.map((s) => (
                        <TableRow key={s.enrollment_id}>
                          <TableCell className="text-sm font-medium">{s.student_name}</TableCell>
                          <TableCell className="font-mono text-xs text-slate-500">{s.admission_no || "—"}</TableCell>
                          <TableCell>
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                              {s.status}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            {s.status === "ACTIVE" && (
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void withdrawStudent(s.enrollment_id)} disabled={savingRoster}>
                                Withdraw
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* ── SESSIONS TAB ── */}
          {tab === "sessions" && (
            <div className="p-6 space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-48 space-y-1.5">
                  <Label className="text-xs">Class</Label>
                  <Select value={sessClassId} onValueChange={setSessClassId}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select class…" /></SelectTrigger>
                    <SelectContent>
                      {classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name || c.code}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-40 space-y-1.5">
                  <Label className="text-xs">Term</Label>
                  <Select value={sessTermId} onValueChange={setSessTermId}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select term…" /></SelectTrigger>
                    <SelectContent>
                      {terms.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-40 space-y-1.5">
                  <Label className="text-xs">Date</Label>
                  <Input type="date" className="h-8 text-sm" value={sessDate} onChange={(e) => setSessDate(e.target.value)} />
                </div>
                <Button size="sm" className="h-8" onClick={() => void loadSessions()} disabled={sessLoading}>
                  Load Sessions
                </Button>
                <Button size="sm" className="h-8 ml-auto" onClick={() => { setSessForm({ session_type: "MORNING", session_date: sessDate, period_number: "" }); setCreateSessDialog(true); }}>
                  <Plus className="mr-1 h-3.5 w-3.5" />New Session
                </Button>
              </div>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs">Date</TableHead>
                      <TableHead className="text-xs">Type</TableHead>
                      <TableHead className="text-xs">Period</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-right text-xs">Open</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessLoading ? (
                      <TableRow><TableCell colSpan={5} className="py-10 text-center text-sm text-slate-400">Loading…</TableCell></TableRow>
                    ) : sessions.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="py-10 text-center text-sm text-slate-400">No sessions for this class and date.</TableCell></TableRow>
                    ) : (
                      sessions.map((s) => (
                        <TableRow key={s.id} className="hover:bg-slate-50">
                          <TableCell className="text-sm">{s.session_date}</TableCell>
                          <TableCell className="text-xs font-medium">{s.session_type}</TableCell>
                          <TableCell className="text-xs text-slate-500">{s.period_number ?? "—"}</TableCell>
                          <TableCell><SessionStatusBadge status={s.status} /></TableCell>
                          <TableCell className="text-right">
                            <button onClick={() => void openRollCall(s)} className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition">
                              <ChevronRight className="h-4 w-4" />
                            </button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* ── REPORTS TAB ── */}
          {tab === "reports" && (
            <div className="p-6 space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-40 space-y-1.5">
                  <Label className="text-xs">Report Type</Label>
                  <Select value={reportType} onValueChange={(v) => setReportType(v as "student" | "class")}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="class">Class Report</SelectItem>
                      <SelectItem value="student">Student Summary</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {reportType === "class" && (
                  <div className="w-48 space-y-1.5">
                    <Label className="text-xs">Class</Label>
                    <Select value={reportClassId} onValueChange={setReportClassId}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select class…" /></SelectTrigger>
                      <SelectContent>
                        {classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name || c.code}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {reportType === "student" && (
                  <div className="w-64 space-y-1.5">
                    <Label className="text-xs">Student ID (UUID)</Label>
                    <Input className="h-8 text-sm" value={reportStudentId} onChange={(e) => setReportStudentId(e.target.value)} placeholder="Student UUID" />
                  </div>
                )}
                <div className="w-48 space-y-1.5">
                  <Label className="text-xs">Term</Label>
                  <Select value={reportTermId} onValueChange={setReportTermId}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select term…" /></SelectTrigger>
                    <SelectContent>
                      {terms.map((t) => <SelectItem key={t.id} value={t.id}>{t.name || t.code}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Button size="sm" className="h-8" onClick={() => void loadReport()} disabled={reportLoading}>
                  {reportLoading ? "Loading…" : "Run Report"}
                </Button>
              </div>

              {reportData !== null && (
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                  <pre className="max-h-96 overflow-auto text-xs text-slate-700">
                    {JSON.stringify(reportData, null, 2)}
                  </pre>
                </div>
              )}

              {!reportData && !reportLoading && (
                <div className="py-10 text-center text-sm text-slate-400">
                  Select filters and click Run Report to see attendance data.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Enroll student dialog ── */}
      <Dialog open={enrollDialog} onOpenChange={setEnrollDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enroll Student in Class</DialogTitle>
            <DialogDescription>Add a student to this class for the selected term.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Student ID (UUID)</Label>
              <Input value={enrollStudentId} onChange={(e) => setEnrollStudentId(e.target.value)} placeholder="Paste student UUID…" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Term</Label>
              <Select value={enrollTermId} onValueChange={setEnrollTermId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {terms.map((t) => <SelectItem key={t.id} value={t.id}>{t.name || t.code}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEnrollDialog(false)}>Cancel</Button>
            <Button onClick={() => void enrollStudent()} disabled={savingRoster}>
              {savingRoster ? "Enrolling…" : "Enroll"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Create session dialog ── */}
      <Dialog open={createSessDialog} onOpenChange={setCreateSessDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Attendance Session</DialogTitle>
            <DialogDescription>Create a new session to mark roll call.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Date</Label>
                <Input type="date" value={sessForm.session_date} onChange={(e) => setSessForm((p) => ({ ...p, session_date: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Session Type</Label>
                <Select value={sessForm.session_type} onValueChange={(v) => setSessForm((p) => ({ ...p, session_type: v as SessionType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MORNING">Morning</SelectItem>
                    <SelectItem value="AFTERNOON">Afternoon</SelectItem>
                    <SelectItem value="PERIOD">Period</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {sessForm.session_type === "PERIOD" && (
                <div className="space-y-1.5 col-span-2">
                  <Label className="text-xs">Period Number</Label>
                  <Input type="number" min={1} value={sessForm.period_number} onChange={(e) => setSessForm((p) => ({ ...p, period_number: e.target.value }))} placeholder="e.g. 1" />
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateSessDialog(false)}>Cancel</Button>
            <Button onClick={() => void createSession()} disabled={savingSess}>
              {savingSess ? "Creating…" : "Create Session"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
