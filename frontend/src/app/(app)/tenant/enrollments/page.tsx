"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  CheckCircle,
  XCircle,
  GraduationCap,
  ArrowRightLeft,
  Send,
  ShieldCheck,
  ChevronRight,
  RefreshCw,
} from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import {
  directorEnrollmentsHref,
  directorNav,
  type EnrollmentSection,
} from "@/components/layout/nav-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";

// ─── Types ────────────────────────────────────────────────────────────────────

type EnrollmentRow = {
  id: string;
  status: string;
  payload: Record<string, unknown>;
};

type ActionType =
  | "submit"
  | "approve"
  | "reject"
  | "enroll"
  | "transfer_request"
  | "transfer_approve";

// ─── Config ───────────────────────────────────────────────────────────────────

const chartConfig = {
  count: { label: "Count", color: "#3b82f6" },
};

const actionConfig: Record<
  ActionType,
  {
    label: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    iconColor: string;
  }
> = {
  submit: {
    label: "Submit",
    description: "Move intake from DRAFT to SUBMITTED for office review.",
    icon: Send,
    iconColor: "text-blue-600",
  },
  approve: {
    label: "Approve",
    description: "Verify documents and move intake to APPROVED status.",
    icon: CheckCircle,
    iconColor: "text-emerald-600",
  },
  reject: {
    label: "Reject",
    description: "Reject this intake. A written reason is required.",
    icon: XCircle,
    iconColor: "text-red-500",
  },
  enroll: {
    label: "Mark Enrolled",
    description: "Final enrollment. Requires Assessment No. and NEMIS No.",
    icon: GraduationCap,
    iconColor: "text-emerald-600",
  },
  transfer_request: {
    label: "Transfer Request",
    description: "Mark student as having a pending transfer request.",
    icon: ArrowRightLeft,
    iconColor: "text-amber-600",
  },
  transfer_approve: {
    label: "Transfer Approve",
    description: "Complete transfer. Director-level authorization.",
    icon: ShieldCheck,
    iconColor: "text-purple-600",
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function studentName(payload: Record<string, unknown>) {
  const options = [
    payload.student_name,
    payload.studentName,
    payload.full_name,
    payload.fullName,
    payload.name,
  ];
  for (const item of options) {
    if (typeof item === "string" && item.trim()) return item;
  }
  return "Unknown student";
}

function studentClass(payload: Record<string, unknown>) {
  const options = [
    payload.admission_class,
    payload.class_code,
    payload.classCode,
    payload.grade,
  ];
  for (const item of options) {
    if (typeof item === "string" && item.trim()) return item;
  }
  return "";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function EnrollmentStatusBadge({ status }: { status: string }) {
  const s = status.toUpperCase();
  const styles: Record<string, string> = {
    ENROLLED:             "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    APPROVED:             "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
    SUBMITTED:            "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    DRAFT:                "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
    REJECTED:             "bg-red-50 text-red-600 ring-1 ring-red-200",
    TRANSFER_REQUESTED:   "bg-purple-50 text-purple-700 ring-1 ring-purple-200",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        styles[s] ?? "bg-slate-100 text-slate-600 ring-1 ring-slate-200"
      }`}
    >
      {s.replace("_", " ")}
    </span>
  );
}

function AlertBanner({
  type,
  message,
  onDismiss,
}: {
  type: "error" | "success";
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div
      className={`flex items-start justify-between rounded-xl px-4 py-3 text-sm ${
        type === "error"
          ? "border border-red-200 bg-red-50 text-red-800"
          : "border border-emerald-200 bg-emerald-50 text-emerald-800"
      }`}
    >
      <span>{message}</span>
      <button onClick={onDismiss} className="ml-4 opacity-60 hover:opacity-100">
        ✕
      </button>
    </div>
  );
}

function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-12 text-center">
        <div className="flex flex-col items-center gap-1">
          <GraduationCap className="h-6 w-6 text-slate-300" />
          <span className="text-sm text-slate-400">{message}</span>
        </div>
      </TableCell>
    </TableRow>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function TenantEnrollmentsPageContent() {
  const searchParams = useSearchParams();
  const section: EnrollmentSection =
    searchParams.get("section") === "students" ? "students" : "intake";

  const [rows, setRows] = useState<EnrollmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [action, setAction] = useState<ActionType>("approve");
  const [targetId, setTargetId] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/tenant/director/enrollments", { method: "GET" });
      const data = await res.json().catch(() => []);
      if (!res.ok) {
        setRows([]);
        setError(typeof data?.detail === "string" ? data.detail : "Failed to load enrollments");
        return;
      }
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setRows([]);
      setError("Enrollment service is currently unavailable.");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(true), 15000);
    return () => clearInterval(timer);
  }, []);

  async function runAction() {
    if (!targetId.trim()) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/tenant/director/enrollments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enrollment_id: targetId.trim(),
          action,
          reason: action === "reject" ? reason.trim() : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data?.detail === "string" ? data.detail : "Action failed");
        return;
      }
      setReason("");
      setNotice(`Action "${actionConfig[action].label}" completed successfully.`);
      await load(true);
    } catch {
      setError("Enrollment action failed: service unavailable.");
    } finally {
      setSubmitting(false);
    }
  }

  const chartData = Object.entries(
    rows.reduce((acc, row) => {
      const key = (row.status || "UNKNOWN").toUpperCase();
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ).map(([status, count]) => ({ status, count }));

  const tableRows = useMemo(
    () =>
      section === "students"
        ? rows.filter((row) => String(row.status || "").toUpperCase() === "ENROLLED")
        : rows,
    [rows, section]
  );

  const activeEnrollmentsHref = directorEnrollmentsHref(section);
  const selectedEnrollment = rows.find((r) => r.id === targetId);

  const pendingCount = rows.filter((r) =>
    ["SUBMITTED", "APPROVED"].includes(r.status.toUpperCase())
  ).length;
  const enrolledCount = rows.filter((r) => r.status.toUpperCase() === "ENROLLED").length;

  return (
    <AppShell title="Director" nav={directorNav} activeHref={activeEnrollmentsHref}>
      <div className="space-y-5">

        {/* ── Header ── */}
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-700 to-blue-500 p-5 text-white shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-bold">
                {section === "students" ? "Enrolled Students" : "Enrollment Operations"}
              </h1>
              <p className="mt-0.5 text-sm text-blue-100">
                {section === "students"
                  ? "Review all enrolled learners under this tenant."
                  : "Director-level approval workflow for student intake."}
              </p>
            </div>
            <div className="flex items-center gap-3 text-center text-sm text-blue-100">
              <div>
                <div className="text-2xl font-bold text-white">{rows.length}</div>
                <div className="text-xs">Total</div>
              </div>
              <div className="h-8 w-px bg-blue-400" />
              <div>
                <div className="text-2xl font-bold text-white">{enrolledCount}</div>
                <div className="text-xs">Enrolled</div>
              </div>
              {pendingCount > 0 && (
                <>
                  <div className="h-8 w-px bg-blue-400" />
                  <div>
                    <div className="text-2xl font-bold text-amber-300">{pendingCount}</div>
                    <div className="text-xs">Pending Review</div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Alerts ── */}
        {error && <AlertBanner type="error" message={error} onDismiss={() => setError(null)} />}
        {notice && <AlertBanner type="success" message={notice} onDismiss={() => setNotice(null)} />}

        {/* ── INTAKE SECTION ── */}
        {section === "intake" && (
          <div className="grid gap-5 lg:grid-cols-3">

            {/* Workflow Action Panel */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="text-sm font-semibold text-slate-900">Workflow Actions</h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  Move an enrollment through the approval pipeline
                </p>
              </div>
              <div className="p-5 space-y-4">

                {/* Select enrollment */}
                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Select Enrollment
                  </Label>
                  <select
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={targetId || "__none__"}
                    onChange={(e) =>
                      setTargetId(e.target.value === "__none__" ? "" : e.target.value)
                    }
                  >
                    <option value="__none__">Choose from queue…</option>
                    {rows.slice(0, 50).map((row) => (
                      <option key={row.id} value={row.id}>
                        {studentName(row.payload || {})} — {row.status}
                      </option>
                    ))}
                  </select>
                  <Input
                    placeholder="Or paste enrollment ID directly"
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    className="text-xs"
                  />
                </div>

                {/* Selected preview */}
                {selectedEnrollment && (
                  <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5 text-xs">
                    <div className="font-semibold text-blue-900">
                      {studentName(selectedEnrollment.payload || {})}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <EnrollmentStatusBadge status={selectedEnrollment.status} />
                      {studentClass(selectedEnrollment.payload || "") && (
                        <span className="font-mono text-blue-500">
                          {studentClass(selectedEnrollment.payload || {})}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Action selector */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Action
                  </Label>
                  <div className="grid gap-1.5">
                    {(Object.keys(actionConfig) as ActionType[]).map((act) => {
                      const cfg = actionConfig[act];
                      const ActionIcon = cfg.icon;
                      return (
                        <button
                          key={act}
                          onClick={() => setAction(act)}
                          className={`flex items-start gap-2.5 rounded-xl border p-2.5 text-left transition ${
                            action === act
                              ? "border-blue-200 bg-blue-50"
                              : "border-slate-100 hover:border-slate-200 hover:bg-slate-50"
                          }`}
                        >
                          <ActionIcon
                            className={`mt-0.5 h-4 w-4 shrink-0 ${
                              action === act ? cfg.iconColor : "text-slate-400"
                            }`}
                          />
                          <div>
                            <div
                              className={`text-xs font-semibold ${
                                action === act ? "text-blue-800" : "text-slate-700"
                              }`}
                            >
                              {cfg.label}
                            </div>
                            <div className="mt-0.5 text-xs leading-tight text-slate-400">
                              {cfg.description}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Rejection reason */}
                {action === "reject" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Rejection Reason *
                    </Label>
                    <Textarea
                      placeholder="State the reason for rejection…"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className="resize-none text-sm"
                      rows={3}
                    />
                  </div>
                )}

                <Button
                  onClick={runAction}
                  disabled={submitting || !targetId.trim()}
                  className="w-full bg-blue-600 hover:bg-blue-700"
                >
                  {submitting ? (
                    <span className="flex items-center gap-2">
                      <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Running…
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      {(() => {
                        const Icon = actionConfig[action].icon;
                        return <Icon className="h-4 w-4" />;
                      })()}
                      Run: {actionConfig[action].label}
                    </span>
                  )}
                </Button>
              </div>
            </div>

            {/* Chart + Queue — right 2 cols */}
            <div className="lg:col-span-2 space-y-5">
              {/* Status chart */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="mb-3 text-sm font-semibold text-slate-800">
                  Enrollment Status Overview
                </h3>
                {chartData.length > 0 ? (
                  <ChartContainer config={chartConfig} className="h-[190px] w-full">
                    <BarChart accessibilityLayer data={chartData}>
                      <CartesianGrid vertical={false} stroke="#f1f5f9" />
                      <XAxis
                        dataKey="status"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        tick={{ fontSize: 11, fill: "#94a3b8" }}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="count" fill="var(--color-count)" radius={6} />
                    </BarChart>
                  </ChartContainer>
                ) : (
                  <div className="flex h-[190px] items-center justify-center text-sm text-slate-400">
                    No enrollment data yet
                  </div>
                )}
              </div>

              {/* Queue table */}
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">Enrollment Queue</h3>
                    <p className="mt-0.5 text-xs text-slate-400">
                      Click a row to select it for an action
                    </p>
                  </div>
                  <button
                    onClick={() => void load(true)}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 transition"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Refresh
                  </button>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs">Student</TableHead>
                      <TableHead className="text-xs">Class</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs">ID</TableHead>
                      <TableHead className="text-xs" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!loading &&
                      rows.slice(0, 15).map((row) => (
                        <TableRow
                          key={row.id}
                          onClick={() => setTargetId(row.id)}
                          className={`cursor-pointer hover:bg-slate-50 ${
                            targetId === row.id ? "bg-blue-50" : ""
                          }`}
                        >
                          <TableCell className="text-sm font-medium">
                            {studentName(row.payload || {})}
                          </TableCell>
                          <TableCell>
                            <span className="font-mono text-xs text-slate-400">
                              {studentClass(row.payload || {}) || "—"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <EnrollmentStatusBadge status={row.status} />
                          </TableCell>
                          <TableCell className="font-mono text-xs text-slate-300">
                            {row.id.slice(0, 8)}…
                          </TableCell>
                          <TableCell>
                            <ChevronRight
                              className={`h-3.5 w-3.5 transition ${
                                targetId === row.id ? "text-blue-500" : "text-slate-200"
                              }`}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    {!loading && rows.length === 0 && (
                      <EmptyRow colSpan={5} message="No enrollments found." />
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        )}

        {/* ── STUDENTS SECTION ── */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                {section === "students" ? "Enrolled Students" : "Recent Enrollments"}
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                {section === "students"
                  ? `${tableRows.length} enrolled learner${tableRows.length !== 1 ? "s" : ""}`
                  : `${tableRows.length} record${tableRows.length !== 1 ? "s" : ""} in queue`}
              </p>
            </div>
            {section === "students" && (
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                {tableRows.length} enrolled
              </span>
            )}
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="text-xs">Student</TableHead>
                <TableHead className="text-xs">Class</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Record ID</TableHead>
                {section === "intake" && <TableHead className="text-xs" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {!loading &&
                tableRows.slice(0, 20).map((row) => (
                  <TableRow
                    key={row.id}
                    className={`hover:bg-slate-50 ${
                      section === "intake" ? "cursor-pointer" : ""
                    } ${targetId === row.id ? "bg-blue-50" : ""}`}
                    onClick={() => section === "intake" && setTargetId(row.id)}
                  >
                    <TableCell className="text-sm font-medium">
                      {studentName(row.payload || {})}
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs text-slate-400">
                        {studentClass(row.payload || {}) || "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <EnrollmentStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-300">{row.id}</TableCell>
                    {section === "intake" && (
                      <TableCell>
                        <ChevronRight
                          className={`h-3.5 w-3.5 transition ${
                            targetId === row.id ? "text-blue-500" : "text-slate-200"
                          }`}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              {!loading && tableRows.length === 0 && (
                <EmptyRow
                  colSpan={section === "intake" ? 5 : 4}
                  message={
                    section === "students"
                      ? "No enrolled students found."
                      : "No enrollments found."
                  }
                />
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </AppShell>
  );
}

export default function TenantEnrollmentsPage() {
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
      <TenantEnrollmentsPageContent />
    </Suspense>
  );
}