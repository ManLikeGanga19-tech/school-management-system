"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Users,
  ClipboardCheck,
  BarChart2,
  Plus,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  ShieldCheck,
  Plane,
  ArrowLeft,
  CalendarDays,
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
import { normalizeTerms as normalizeTermsFromSetup, defaultTermId, type TenantTerm } from "@/lib/school-setup/terms";

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
  session_date: string;
  session_type: SessionType;
  period_number: number | null;
  status: SessionStatus;
};

type AttendanceRecord = {
  id: string;
  enrollment_id: string;
  student_id: string;
  student_name: string;
  admission_no: string;
  status: AttendanceStatus;
  notes: string | null;
};

type Mark = { status: AttendanceStatus; notes: string };

type ReportRow = {
  student_id: string;
  student_name: string;
  admission_no: string;
  present: number;
  absent: number;
  late: number;
  excused: number;
  off_grounds: number;
  total: number;
};

type Tab = "register" | "roster" | "reports";

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

const STATUS_ORDER: AttendanceStatus[] = ["PRESENT", "ABSENT", "LATE", "EXCUSED", "OFF_GROUNDS"];

const STATUS_CONFIG: Record<
  AttendanceStatus,
  { label: string; short: string; icon: React.ReactNode; on: string; off: string }
> = {
  PRESENT: {
    label: "Present", short: "P", icon: <CheckCircle className="h-4 w-4" />,
    on: "bg-emerald-600 text-white border-emerald-600",
    off: "bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50",
  },
  ABSENT: {
    label: "Absent", short: "A", icon: <XCircle className="h-4 w-4" />,
    on: "bg-red-600 text-white border-red-600",
    off: "bg-white text-red-700 border-red-200 hover:bg-red-50",
  },
  LATE: {
    label: "Late", short: "L", icon: <Clock className="h-4 w-4" />,
    on: "bg-amber-500 text-white border-amber-500",
    off: "bg-white text-amber-700 border-amber-200 hover:bg-amber-50",
  },
  EXCUSED: {
    label: "Excused", short: "E", icon: <ShieldCheck className="h-4 w-4" />,
    on: "bg-blue-600 text-white border-blue-600",
    off: "bg-white text-blue-700 border-blue-200 hover:bg-blue-50",
  },
  OFF_GROUNDS: {
    label: "Off Grounds", short: "O", icon: <Plane className="h-4 w-4" />,
    on: "bg-purple-600 text-white border-purple-600",
    off: "bg-white text-purple-700 border-purple-200 hover:bg-purple-50",
  },
};

function normalizeSession(raw: unknown): Session | null {
  const r = asObject(raw);
  if (!r || !str(r.id)) return null;
  return {
    id: str(r.id),
    session_date: str(r.session_date),
    session_type: (str(r.session_type) || "MORNING") as SessionType,
    period_number: r.period_number != null ? num(r.period_number) : null,
    status: (str(r.status) || "DRAFT") as SessionStatus,
  };
}

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

export function AttendancePage({ appTitle, nav, activeHref }: Props) {
  const [tab, setTab] = useState<Tab>("register");

  // Reference data
  const [classes, setClasses] = useState<TenantClassOption[]>([]);
  const [terms, setTerms] = useState<TenantTerm[]>([]);

  // Shared selector — one class + term drives every tab.
  const [classId, setClassId] = useState("");
  const [termId, setTermId] = useState("");

  // Register tab
  const [regDate, setRegDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [regType, setRegType] = useState<SessionType>("MORNING");
  const [regPeriod, setRegPeriod] = useState("1");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessLoading, setSessLoading] = useState(false);
  const [takingRegister, setTakingRegister] = useState(false);

  // Roll call
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [rollCall, setRollCall] = useState<AttendanceRecord[]>([]);
  const [rollCallLoading, setRollCallLoading] = useState(false);
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [busyRoll, setBusyRoll] = useState(false);

  // Roster tab
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [enrollDialog, setEnrollDialog] = useState(false);
  const [enrollStudentId, setEnrollStudentId] = useState("");
  const [savingRoster, setSavingRoster] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Reports tab
  const [report, setReport] = useState<ReportRow[] | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  // ── Reference data ─────────────────────────────────────────────────────────
  const loadRef = useCallback(async () => {
    try {
      const [classesRaw, termsRaw] = await Promise.all([
        api.get<unknown>("/tenants/classes", { tenantRequired: true }).catch(() => []),
        api.get<unknown>("/tenants/terms", { tenantRequired: true }).catch(() => []),
      ]);
      const cls = normalizeClassOptions(classesRaw);
      setClasses(cls);
      setClassId((c) => c || (cls[0]?.id ?? ""));
      const ts = normalizeTermsFromSetup(termsRaw);
      setTerms(ts);
      setTermId((t) => t || defaultTermId(ts));
    } catch {
      toast.error("Failed to load classes and terms.");
    }
  }, []);

  useEffect(() => { void loadRef(); }, [loadRef]);

  // ── Sessions for the selected class + date ─────────────────────────────────
  const loadSessions = useCallback(async (): Promise<Session[]> => {
    if (!classId || !termId) { setSessions([]); return []; }
    setSessLoading(true);
    try {
      const raw = await api.get<unknown>(
        `/attendance/sessions?class_id=${encodeURIComponent(classId)}` +
          `&term_id=${encodeURIComponent(termId)}&session_date=${regDate}`,
        { tenantRequired: true }
      );
      const list = asArray<unknown>(raw)
        .map(normalizeSession)
        .filter((s): s is Session => s !== null);
      setSessions(list);
      return list;
    } catch {
      toast.error("Failed to load sessions.");
      return [];
    } finally {
      setSessLoading(false);
    }
  }, [classId, termId, regDate]);

  useEffect(() => {
    if (tab === "register") void loadSessions();
  }, [tab, loadSessions]);

  // ── Take register: create-or-open the session, then roll call ──────────────
  async function takeRegister() {
    if (!classId || !termId) { toast.error("Select a class and term first."); return; }
    const periodNo = regType === "PERIOD" ? Number(regPeriod) || 1 : null;
    setTakingRegister(true);
    try {
      const created = await api.post<unknown>(
        "/attendance/sessions",
        {
          class_id: classId,
          term_id: termId,
          session_date: regDate,
          session_type: regType,
          period_number: periodNo,
        },
        { tenantRequired: true }
      );
      const session = normalizeSession(created);
      if (session) {
        await loadSessions();
        await openRollCall(session);
        return;
      }
    } catch {
      // A session of this type already exists for the date — open that one.
    }
    const list = await loadSessions();
    const match = list.find(
      (s) => s.session_type === regType &&
        (regType !== "PERIOD" || s.period_number === (regType === "PERIOD" ? Number(regPeriod) || 1 : null))
    );
    if (match) {
      await openRollCall(match);
    } else {
      toast.error("Could not open the register for this class and date.");
    }
    setTakingRegister(false);
  }

  // ── Roll call ──────────────────────────────────────────────────────────────
  const openRollCall = useCallback(async (session: Session) => {
    setActiveSession(session);
    setRollCallLoading(true);
    setTakingRegister(false);
    try {
      const raw = await api.get<unknown>(
        `/attendance/sessions/${encodeURIComponent(session.id)}`,
        { tenantRequired: true }
      );
      const records = asArray<unknown>(asObject(raw)?.records ?? [])
        .map((r) => asObject(r))
        .filter((r): r is Record<string, unknown> => Boolean(r))
        .map((r) => ({
          id: str(r.id),
          enrollment_id: str(r.enrollment_id),
          student_id: str(r.student_id),
          student_name: str(r.student_name),
          admission_no: str(r.admission_no),
          status: (str(r.status) || "PRESENT") as AttendanceStatus,
          notes: r.notes ? str(r.notes) : null,
        }));
      setRollCall(records);
      const initial: Record<string, Mark> = {};
      records.forEach((r) => { initial[r.student_id] = { status: r.status, notes: r.notes ?? "" }; });
      setMarks(initial);
    } catch {
      toast.error("Failed to load the roll call.");
    } finally {
      setRollCallLoading(false);
    }
  }, []);

  function setMark(studentId: string, status: AttendanceStatus) {
    setMarks((prev) => ({
      ...prev,
      [studentId]: { status, notes: status === "PRESENT" ? "" : prev[studentId]?.notes ?? "" },
    }));
  }

  function setNote(studentId: string, notes: string) {
    setMarks((prev) => ({
      ...prev,
      [studentId]: { status: prev[studentId]?.status ?? "PRESENT", notes },
    }));
  }

  function markAllPresent() {
    setMarks((prev) => {
      const next: Record<string, Mark> = {};
      rollCall.forEach((r) => { next[r.student_id] = { status: "PRESENT", notes: "" }; });
      return { ...prev, ...next };
    });
  }

  const tally = useMemo(() => {
    const t: Record<AttendanceStatus, number> = {
      PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0, OFF_GROUNDS: 0,
    };
    rollCall.forEach((r) => { t[marks[r.student_id]?.status ?? "PRESENT"] += 1; });
    return t;
  }, [rollCall, marks]);

  async function saveRollCall(silent = false): Promise<boolean> {
    if (!activeSession) return false;
    try {
      const records = rollCall.map((r) => {
        const m = marks[r.student_id] ?? { status: "PRESENT" as AttendanceStatus, notes: "" };
        return {
          student_id: r.student_id,
          status: m.status,
          notes: m.status === "PRESENT" ? null : (m.notes.trim() || null),
        };
      });
      await api.post<unknown>(
        `/attendance/sessions/${encodeURIComponent(activeSession.id)}/records`,
        { records },
        { tenantRequired: true }
      );
      if (!silent) toast.success("Register saved.");
      return true;
    } catch {
      toast.error("Failed to save the register.");
      return false;
    }
  }

  async function submitSession() {
    if (!activeSession) return;
    setBusyRoll(true);
    try {
      if (!(await saveRollCall(true))) return;
      await api.post<unknown>(
        `/attendance/sessions/${encodeURIComponent(activeSession.id)}/submit`,
        {}, { tenantRequired: true }
      );
      setActiveSession((s) => (s ? { ...s, status: "SUBMITTED" } : s));
      toast.success("Register submitted.");
    } catch {
      toast.error("Failed to submit the register.");
    } finally {
      setBusyRoll(false);
    }
  }

  async function finalizeSession() {
    if (!activeSession) return;
    setBusyRoll(true);
    try {
      await api.post<unknown>(
        `/attendance/sessions/${encodeURIComponent(activeSession.id)}/finalize`,
        {}, { tenantRequired: true }
      );
      setActiveSession((s) => (s ? { ...s, status: "FINALIZED" } : s));
      toast.success("Register finalized.");
    } catch {
      toast.error("Failed to finalize the register.");
    } finally {
      setBusyRoll(false);
    }
  }

  async function saveDraft() {
    setBusyRoll(true);
    await saveRollCall();
    setBusyRoll(false);
  }

  // ── Roster ─────────────────────────────────────────────────────────────────
  const loadRoster = useCallback(async () => {
    if (!classId || !termId) { setRoster([]); return; }
    setRosterLoading(true);
    try {
      const raw = await api.get<unknown>(
        `/attendance/classes/${encodeURIComponent(classId)}/roster?term_id=${encodeURIComponent(termId)}`,
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
      toast.error("Failed to load the roster.");
    } finally {
      setRosterLoading(false);
    }
  }, [classId, termId]);

  useEffect(() => {
    if (tab === "roster") void loadRoster();
  }, [tab, loadRoster]);

  async function syncRoster() {
    if (!classId || !termId) {
      toast.error("Select a class and term first.");
      return;
    }
    setSyncing(true);
    try {
      const res = await api.post<{ synced?: number }>(
        `/attendance/classes/${encodeURIComponent(classId)}/sync-roster?term_id=${encodeURIComponent(termId)}`,
        {},
        { tenantRequired: true }
      );
      const n = res?.synced ?? 0;
      toast.success(
        n > 0
          ? `Added ${n} enrolled student${n === 1 ? "" : "s"} to the roster.`
          : "Roster already up to date — every enrolled student is on it."
      );
      await loadRoster();
    } catch (err: unknown) {
      const msg = asObject(err)?.detail;
      toast.error(typeof msg === "string" ? msg : "Failed to sync the roster.");
    } finally {
      setSyncing(false);
    }
  }

  async function enrollStudent() {
    if (!classId || !termId || !enrollStudentId.trim()) {
      toast.error("Select a class and term, and enter a student ID.");
      return;
    }
    setSavingRoster(true);
    try {
      await api.post<unknown>(
        `/attendance/classes/${encodeURIComponent(classId)}/enroll`,
        { student_id: enrollStudentId.trim(), term_id: termId },
        { tenantRequired: true }
      );
      toast.success("Student added to the class.");
      setEnrollDialog(false);
      setEnrollStudentId("");
      await loadRoster();
    } catch (err: unknown) {
      const msg = asObject(err)?.detail;
      toast.error(typeof msg === "string" ? msg : "Failed to add the student.");
    } finally {
      setSavingRoster(false);
    }
  }

  async function withdrawStudent(enrollmentId: string) {
    setSavingRoster(true);
    try {
      await api.patch<unknown>(
        `/attendance/classes/${encodeURIComponent(classId)}/roster/${encodeURIComponent(enrollmentId)}`,
        { status: "WITHDRAWN" },
        { tenantRequired: true }
      );
      toast.success("Student withdrawn.");
      await loadRoster();
    } catch {
      toast.error("Failed to withdraw the student.");
    } finally {
      setSavingRoster(false);
    }
  }

  // ── Reports ────────────────────────────────────────────────────────────────
  const loadReport = useCallback(async () => {
    if (!classId || !termId) { setReport(null); return; }
    setReportLoading(true);
    try {
      const raw = await api.get<unknown>(
        `/attendance/classes/${encodeURIComponent(classId)}/report?term_id=${encodeURIComponent(termId)}`,
        { tenantRequired: true }
      );
      setReport(
        asArray<unknown>(raw)
          .map((r) => asObject(r))
          .filter((r): r is Record<string, unknown> => Boolean(r))
          .map((r) => ({
            student_id: str(r.student_id),
            student_name: str(r.student_name),
            admission_no: str(r.admission_no),
            present: num(r.present),
            absent: num(r.absent),
            late: num(r.late),
            excused: num(r.excused),
            off_grounds: num(r.off_grounds),
            total: num(r.total),
          }))
      );
    } catch {
      toast.error("Failed to load the attendance report.");
    } finally {
      setReportLoading(false);
    }
  }, [classId, termId]);

  useEffect(() => {
    if (tab === "reports") void loadReport();
  }, [tab, loadReport]);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "register", label: "Take Register", icon: <ClipboardCheck className="h-3.5 w-3.5" /> },
    { id: "roster", label: "Class Roster", icon: <Users className="h-3.5 w-3.5" /> },
    { id: "reports", label: "Reports", icon: <BarChart2 className="h-3.5 w-3.5" /> },
  ];

  // ════════════════════════════════════════════════════════════════════════════
  // ROLL CALL VIEW
  // ════════════════════════════════════════════════════════════════════════════
  if (activeSession) {
    const locked = activeSession.status === "FINALIZED";
    return (
      <AppShell title={appTitle} nav={nav} activeHref={activeHref}>
        <div className="space-y-5">
          <div className="dashboard-hero rounded-[2rem] p-5 text-white">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold">Roll Call</h1>
                <p className="mt-0.5 text-sm text-blue-100">
                  {activeSession.session_date} · {activeSession.session_type}
                  {activeSession.period_number ? ` · Period ${activeSession.period_number}` : ""}
                  {" · "}<SessionStatusBadge status={activeSession.status} />
                </p>
              </div>
              <Button
                variant="outline"
                className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                onClick={() => { setActiveSession(null); void loadSessions(); }}
              >
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />Back
              </Button>
            </div>
          </div>

          {/* Tally + actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap gap-2">
              {STATUS_ORDER.map((s) => (
                <span
                  key={s}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold ${STATUS_CONFIG[s].off}`}
                >
                  {STATUS_CONFIG[s].icon}
                  {tally[s]} {STATUS_CONFIG[s].label}
                </span>
              ))}
            </div>
            {!locked && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={markAllPresent} disabled={busyRoll}>
                  Mark all present
                </Button>
                <Button size="sm" variant="outline" onClick={() => void saveDraft()} disabled={busyRoll}>
                  Save draft
                </Button>
                {activeSession.status === "DRAFT" && (
                  <Button size="sm" onClick={() => void submitSession()} disabled={busyRoll}>
                    Submit
                  </Button>
                )}
                {activeSession.status === "SUBMITTED" && (
                  <Button size="sm" onClick={() => void finalizeSession()} disabled={busyRoll}>
                    Finalize
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Roll call list */}
          <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
            {rollCallLoading ? (
              <div className="py-16 text-center text-sm text-slate-400">Loading the roll call…</div>
            ) : rollCall.length === 0 ? (
              <div className="py-16 text-center text-sm text-slate-400">
                No students on this class roster. Add students under the Class Roster tab.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {rollCall.map((r, i) => {
                  const mark = marks[r.student_id] ?? { status: "PRESENT" as AttendanceStatus, notes: "" };
                  return (
                    <div key={r.student_id} className="px-4 py-3 sm:px-6">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900">
                            <span className="mr-2 text-xs text-slate-400">{i + 1}.</span>
                            {r.student_name || "Unnamed student"}
                          </p>
                          <p className="font-mono text-xs text-slate-400">
                            {r.admission_no || "No admission no."}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {STATUS_ORDER.map((s) => {
                            const cfg = STATUS_CONFIG[s];
                            const active = mark.status === s;
                            return (
                              <button
                                key={s}
                                type="button"
                                disabled={locked}
                                onClick={() => setMark(r.student_id, s)}
                                title={cfg.label}
                                className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-default disabled:opacity-60 ${active ? cfg.on : cfg.off}`}
                              >
                                {cfg.icon}
                                <span className="hidden sm:inline">{cfg.label}</span>
                                <span className="sm:hidden">{cfg.short}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      {mark.status !== "PRESENT" && (
                        <Input
                          value={mark.notes}
                          disabled={locked}
                          onChange={(e) => setNote(r.student_id, e.target.value)}
                          placeholder={`Reason for ${STATUS_CONFIG[mark.status].label.toLowerCase()} (optional)…`}
                          className="mt-2 h-8 text-sm"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </AppShell>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // MAIN VIEW
  // ════════════════════════════════════════════════════════════════════════════
  return (
    <AppShell title={appTitle} nav={nav} activeHref={activeHref}>
      <div className="space-y-6">
        <TenantPageHeader
          title="Attendance"
          description="Take the daily register, manage class rosters, and review attendance reports."
          badges={[{ label: "Students" }]}
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadRef()}
              className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh
            </Button>
          }
        />

        {/* Shared class + term selector — drives every tab */}
        <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="w-52 space-y-1.5">
            <Label className="text-xs">Class</Label>
            <Select value={classId} onValueChange={setClassId}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select class…" /></SelectTrigger>
              <SelectContent>
                {classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name || c.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="w-52 space-y-1.5">
            <Label className="text-xs">Term</Label>
            <Select value={termId} onValueChange={setTermId}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select term…" /></SelectTrigger>
              <SelectContent>
                {terms.map((t) => <SelectItem key={t.id} value={t.id}>{t.name || t.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

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

          {/* ── TAKE REGISTER TAB ── */}
          {tab === "register" && (
            <div className="space-y-5 p-6">
              {!classId || !termId ? (
                <div className="py-10 text-center text-sm text-slate-400">
                  Select a class and term above to take the register.
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <div className="w-44 space-y-1.5">
                      <Label className="text-xs">Date</Label>
                      <Input
                        type="date"
                        className="h-9 bg-white text-sm"
                        value={regDate}
                        onChange={(e) => setRegDate(e.target.value)}
                      />
                    </div>
                    <div className="w-40 space-y-1.5">
                      <Label className="text-xs">Session</Label>
                      <Select value={regType} onValueChange={(v) => setRegType(v as SessionType)}>
                        <SelectTrigger className="h-9 bg-white text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="MORNING">Morning</SelectItem>
                          <SelectItem value="AFTERNOON">Afternoon</SelectItem>
                          <SelectItem value="PERIOD">Period</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {regType === "PERIOD" && (
                      <div className="w-28 space-y-1.5">
                        <Label className="text-xs">Period no.</Label>
                        <Input
                          type="number"
                          min={1}
                          className="h-9 bg-white text-sm"
                          value={regPeriod}
                          onChange={(e) => setRegPeriod(e.target.value)}
                        />
                      </div>
                    )}
                    <Button onClick={() => void takeRegister()} disabled={takingRegister} className="h-9">
                      <ClipboardCheck className="mr-1.5 h-4 w-4" />
                      {takingRegister ? "Opening…" : "Take Register"}
                    </Button>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <CalendarDays className="h-3.5 w-3.5" />
                      Registers on {regDate}
                    </div>
                    <div className="overflow-x-auto rounded-xl border border-slate-100">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-slate-50">
                            <TableHead className="text-xs">Session</TableHead>
                            <TableHead className="text-xs">Period</TableHead>
                            <TableHead className="text-xs">Status</TableHead>
                            <TableHead className="text-right text-xs">Action</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sessLoading ? (
                            <TableRow><TableCell colSpan={4} className="py-10 text-center text-sm text-slate-400">Loading…</TableCell></TableRow>
                          ) : sessions.length === 0 ? (
                            <TableRow><TableCell colSpan={4} className="py-10 text-center text-sm text-slate-400">No registers taken for this date yet — use Take Register above.</TableCell></TableRow>
                          ) : (
                            sessions.map((s) => (
                              <TableRow key={s.id} className="hover:bg-slate-50">
                                <TableCell className="text-xs font-medium">{s.session_type}</TableCell>
                                <TableCell className="text-xs text-slate-500">{s.period_number ?? "—"}</TableCell>
                                <TableCell><SessionStatusBadge status={s.status} /></TableCell>
                                <TableCell className="text-right">
                                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void openRollCall(s)}>
                                    {s.status === "FINALIZED" ? "View" : "Open"}
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── ROSTER TAB ── */}
          {tab === "roster" && (
            <div className="space-y-4 p-6">
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-500">
                  {roster.length} student{roster.length === 1 ? "" : "s"} on this class roster
                </p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void syncRoster()} disabled={!classId || !termId || syncing}>
                    <RefreshCw className={`mr-1 h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
                    {syncing ? "Syncing…" : "Sync from Enrollments"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEnrollDialog(true)} disabled={!classId || !termId}>
                    <Plus className="mr-1 h-3.5 w-3.5" />Add Student
                  </Button>
                </div>
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-100">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs">Student Name</TableHead>
                      <TableHead className="text-xs">Admission No.</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-right text-xs">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rosterLoading ? (
                      <TableRow><TableCell colSpan={4} className="py-10 text-center text-sm text-slate-400">Loading…</TableCell></TableRow>
                    ) : roster.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="py-10 text-center text-sm text-slate-400">No students on this class roster yet.</TableCell></TableRow>
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

          {/* ── REPORTS TAB ── */}
          {tab === "reports" && (
            <div className="space-y-4 p-6">
              <p className="text-sm text-slate-500">
                Attendance for the selected class and term — counted from finalized registers only.
              </p>
              <div className="overflow-x-auto rounded-xl border border-slate-100">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs">Student</TableHead>
                      <TableHead className="text-xs">Adm No.</TableHead>
                      <TableHead className="text-right text-xs">Present</TableHead>
                      <TableHead className="text-right text-xs">Absent</TableHead>
                      <TableHead className="text-right text-xs">Late</TableHead>
                      <TableHead className="text-right text-xs">Excused</TableHead>
                      <TableHead className="text-right text-xs">Sessions</TableHead>
                      <TableHead className="text-right text-xs">Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reportLoading ? (
                      <TableRow><TableCell colSpan={8} className="py-10 text-center text-sm text-slate-400">Loading…</TableCell></TableRow>
                    ) : !report || report.length === 0 ? (
                      <TableRow><TableCell colSpan={8} className="py-10 text-center text-sm text-slate-400">No finalized attendance for this class and term yet.</TableCell></TableRow>
                    ) : (
                      report.map((r) => (
                        <TableRow key={r.student_id}>
                          <TableCell className="text-sm font-medium">{r.student_name}</TableCell>
                          <TableCell className="font-mono text-xs text-slate-500">{r.admission_no || "—"}</TableCell>
                          <TableCell className="text-right text-xs text-emerald-700">{r.present}</TableCell>
                          <TableCell className="text-right text-xs text-red-700">{r.absent}</TableCell>
                          <TableCell className="text-right text-xs text-amber-700">{r.late}</TableCell>
                          <TableCell className="text-right text-xs">{r.excused}</TableCell>
                          <TableCell className="text-right text-xs">{r.total}</TableCell>
                          <TableCell className="text-right text-xs font-semibold">
                            {r.total > 0 ? `${Math.round((r.present / r.total) * 100)}%` : "—"}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Add student dialog ── */}
      <Dialog open={enrollDialog} onOpenChange={setEnrollDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Student to Class</DialogTitle>
            <DialogDescription>
              Add a student to this class roster for the selected term.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Student ID (UUID)</Label>
              <Input
                value={enrollStudentId}
                onChange={(e) => setEnrollStudentId(e.target.value)}
                placeholder="Paste the student UUID…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEnrollDialog(false)}>Cancel</Button>
            <Button onClick={() => void enrollStudent()} disabled={savingRoster}>
              {savingRoster ? "Adding…" : "Add Student"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
