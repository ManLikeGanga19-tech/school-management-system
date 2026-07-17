"use client";

/**
 * RollCallPage — the principal's daily roll-call board (Phase X).
 *
 * Teachers mark each class's MORNING attendance session (the roll call);
 * this board gives the head the live school-wide picture:
 *   * summary tiles (attendance rate, marked/unmarked classes, absentees)
 *   * class grid — who has/hasn't marked, per-class counts
 *   * absentee digest with one-click guardian SMS (once per day)
 *   * chronic-absence radar (3+ absences in the last 7 school days)
 *   * "Finalize Day" locks every marked session in one action
 */

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CalendarCheck,
  CheckCircle2,
  Lock,
  RefreshCw,
  ShieldAlert,
  Users,
} from "lucide-react";

import { AppShell, type AppNavItem } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";

type RollCallClass = {
  class_id: string;
  class_code: string;
  class_name: string;
  roster_size: number;
  session_id: string | null;
  session_status: string | null;
  marked: boolean;
  present: number;
  absent: number;
  late: number;
  excused: number;
  off_grounds: number;
};

type RollCallBoard = {
  date: string;
  summary: {
    total_classes: number;
    marked_classes: number;
    unmarked_classes: number;
    finalized_classes: number;
    day_finalized: boolean;
    present: number;
    absent: number;
    late: number;
    excused: number;
    off_grounds: number;
    attendance_rate: number | null;
  };
  classes: RollCallClass[];
  absentees: {
    record_id: string;
    enrollment_id: string | null;
    student_name: string;
    class_code: string;
    guardian_phone_available: boolean;
  }[];
  chronic_absentees: {
    student_name: string;
    class_code: string;
    absence_count: number;
    enrollment_id: string | null;
  }[];
  chronic_rule: { threshold: number; window_school_days: number };
};

type Props = {
  appTitle: string;
  nav: AppNavItem[];
  activeHref: string;
  profileBasePath: string;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

export function RollCallPage({ appTitle, nav, activeHref, profileBasePath }: Props) {
  const [date, setDate] = useState(todayIso());
  const [board, setBoard] = useState<RollCallBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [finalizing, setFinalizing] = useState(false);
  const [notifying, setNotifying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<RollCallBoard>(
        `/tenants/principal/roll-call?date=${encodeURIComponent(date)}`,
        { tenantRequired: true, noRedirect: true },
      );
      setBoard(data);
    } catch (err: unknown) {
      setBoard(null);
      const msg = (err as { message?: string })?.message;
      toast.error(msg || "Failed to load the roll-call board.");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { void load(); }, [load]);

  async function finalizeDay() {
    setFinalizing(true);
    try {
      const r = await api.post<{ sessions_finalized: number }>(
        "/tenants/principal/roll-call/finalize",
        { date },
        { tenantRequired: true },
      );
      toast.success(
        r.sessions_finalized > 0
          ? `Day finalized — ${r.sessions_finalized} class session${r.sessions_finalized === 1 ? "" : "s"} locked.`
          : "Nothing to finalize — no marked sessions for this date.",
      );
      await load();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        || (err as { message?: string })?.message;
      toast.error(detail || "Failed to finalize the day.");
    } finally {
      setFinalizing(false);
    }
  }

  async function notifyGuardians() {
    setNotifying(true);
    try {
      const r = await api.post<{ sent: number; skipped: number; absentees: number }>(
        "/tenants/principal/roll-call/notify-absentees",
        { date },
        { tenantRequired: true },
      );
      toast.success(
        `Guardian SMS sent for ${r.sent} of ${r.absentees} absentees` +
        (r.skipped ? ` (${r.skipped} skipped — no phone on record).` : "."),
      );
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        || (err as { message?: string })?.message;
      toast.error(detail || "Failed to send guardian notifications.");
    } finally {
      setNotifying(false);
    }
  }

  const s = board?.summary;

  return (
    <AppShell title={appTitle} nav={nav} activeHref={activeHref}>
      <div className="space-y-5">
        {/* Hero */}
        <div className="dashboard-hero rounded-[2rem] p-5 text-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold">Roll Call</h1>
              <p className="mt-0.5 text-sm text-blue-100">
                Daily school-wide attendance oversight — teachers mark, you verify and finalize.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value || todayIso())}
                className="h-9 w-40 border-white/30 bg-white/10 text-white"
              />
              <Button
                variant="outline"
                className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                onClick={() => void load()}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </Button>
            </div>
          </div>
        </div>

        {/* Summary tiles */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Attendance Rate</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">
              {s?.attendance_rate != null ? `${s.attendance_rate}%` : "—"}
            </div>
            <div className="text-xs text-slate-400">
              {s ? `${s.present + s.late} of ${s.present + s.absent + s.late + s.excused + s.off_grounds} marked in` : ""}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Classes Marked</div>
            <div className={`mt-1 text-2xl font-bold ${s && s.unmarked_classes > 0 ? "text-amber-600" : "text-emerald-700"}`}>
              {s ? `${s.marked_classes}/${s.total_classes}` : "—"}
            </div>
            <div className="text-xs text-slate-400">
              {s && s.unmarked_classes > 0
                ? `${s.unmarked_classes} class${s.unmarked_classes === 1 ? "" : "es"} not yet marked`
                : "All classes marked"}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Absent Today</div>
            <div className={`mt-1 text-2xl font-bold ${s && s.absent > 0 ? "text-red-600" : "text-slate-900"}`}>
              {s?.absent ?? "—"}
            </div>
            <div className="text-xs text-slate-400">
              {s ? `${s.late} late · ${s.excused} excused · ${s.off_grounds} off-grounds` : ""}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Day Status</div>
            <div className={`mt-1 flex items-center gap-1.5 text-lg font-bold ${s?.day_finalized ? "text-emerald-700" : "text-slate-700"}`}>
              {s?.day_finalized ? <><Lock className="h-4 w-4" /> Finalized</> : <>Open</>}
            </div>
            <div className="text-xs text-slate-400">
              {s ? `${s.finalized_classes} of ${s.marked_classes} sessions locked` : ""}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => void finalizeDay()}
            disabled={finalizing || loading || !s || s.marked_classes === 0 || s.day_finalized}
          >
            <Lock className="mr-1.5 h-3.5 w-3.5" />
            {finalizing ? "Finalizing…" : "Finalize Day"}
          </Button>
          <Button
            variant="outline"
            onClick={() => void notifyGuardians()}
            disabled={notifying || loading || !board || board.absentees.length === 0}
            title="Send one SMS to each absentee's guardian (at most once per day)"
          >
            <Bell className="mr-1.5 h-3.5 w-3.5" />
            {notifying ? "Sending…" : `Notify Absentee Guardians (${board?.absentees.length ?? 0})`}
          </Button>
        </div>

        {/* Class grid */}
        <div className="dashboard-surface rounded-[1.6rem]">
          <div className="border-b border-slate-100 px-6 py-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <CalendarCheck className="h-4 w-4 text-slate-400" /> Class Register Status
            </h2>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="text-xs">Class</TableHead>
                <TableHead className="text-xs">Roster</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-right text-xs">Present</TableHead>
                <TableHead className="text-right text-xs">Absent</TableHead>
                <TableHead className="text-right text-xs">Late</TableHead>
                <TableHead className="text-right text-xs">Excused</TableHead>
                <TableHead className="text-right text-xs">Off-grounds</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!loading && board?.classes.map((c) => (
                <TableRow key={c.class_id} className="hover:bg-slate-50">
                  <TableCell className="text-sm font-medium">
                    {c.class_code}
                    <span className="ml-1.5 text-xs text-slate-400">{c.class_name}</span>
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">{c.roster_size}</TableCell>
                  <TableCell>
                    {!c.marked ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
                        <AlertTriangle className="h-3 w-3" /> Not marked
                      </span>
                    ) : c.session_status === "FINALIZED" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                        <Lock className="h-3 w-3" /> Finalized
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 ring-1 ring-blue-200">
                        <CheckCircle2 className="h-3 w-3" /> {c.session_status === "SUBMITTED" ? "Submitted" : "Marked"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-emerald-700">{c.marked ? c.present : "—"}</TableCell>
                  <TableCell className={`text-right text-sm tabular-nums ${c.absent > 0 ? "font-semibold text-red-600" : "text-slate-500"}`}>{c.marked ? c.absent : "—"}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-slate-600">{c.marked ? c.late : "—"}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-slate-600">{c.marked ? c.excused : "—"}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-slate-600">{c.marked ? c.off_grounds : "—"}</TableCell>
                </TableRow>
              ))}
              {!loading && (board?.classes.length ?? 0) === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-sm text-slate-400">
                    No classes configured yet — set up classes under School Setup.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* Absentee digest */}
          <div className="dashboard-surface rounded-[1.6rem]">
            <div className="border-b border-slate-100 px-6 py-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Users className="h-4 w-4 text-red-400" />
                Absent Today ({board?.absentees.length ?? 0})
              </h2>
            </div>
            <div className="max-h-80 overflow-y-auto px-6 py-3">
              {(board?.absentees.length ?? 0) === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">No absentees recorded.</p>
              ) : (
                <ul className="divide-y divide-slate-50">
                  {board?.absentees.map((a) => (
                    <li key={a.record_id} className="flex items-center justify-between py-2">
                      <div>
                        <span className="text-sm font-medium text-slate-800">{a.student_name}</span>
                        <span className="ml-2 font-mono text-xs text-slate-400">{a.class_code}</span>
                      </div>
                      {!a.guardian_phone_available && (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">
                          No guardian phone
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Chronic absence radar */}
          <div className="dashboard-surface rounded-[1.6rem]">
            <div className="border-b border-slate-100 px-6 py-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ShieldAlert className="h-4 w-4 text-amber-500" />
                Chronic Absence Radar
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                {board ? `${board.chronic_rule.threshold}+ absences in the last ${board.chronic_rule.window_school_days} school days` : ""}
              </p>
            </div>
            <div className="max-h-80 overflow-y-auto px-6 py-3">
              {(board?.chronic_absentees.length ?? 0) === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">No students on the radar. 🎉</p>
              ) : (
                <ul className="divide-y divide-slate-50">
                  {board?.chronic_absentees.map((c, i) => (
                    <li key={i} className="flex items-center justify-between py-2">
                      <div>
                        <span className="text-sm font-medium text-slate-800">{c.student_name}</span>
                        <span className="ml-2 font-mono text-xs text-slate-400">{c.class_code}</span>
                      </div>
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-bold text-red-700 ring-1 ring-red-200">
                        {c.absence_count} absences
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
