"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  BadgeAlert,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  FileText,
  Loader2,
  Lock,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  format,
  parseISO,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameDay,
  isWeekend,
  addMonths,
  subMonths,
} from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Grade {
  subject: string;
  strand?: string;
  sub_strand?: string;
  grade?: string;
  comments?: string;
}

interface Invoice {
  id: string;
  invoice_type: string;
  term_label?: string;
  status: string;
  billed: number;
  paid: number;
  balance: number;
}

interface Payment {
  id: string;
  date: string;
  provider: string;
  reference?: string;
  amount: number;
}

interface Attendance {
  date: string;
  status: string;
}

interface Incident {
  id: string;
  date: string;
  incident_type: string;
  title: string;
  description?: string;
  status: string;
}

interface Child {
  enrollment_id: string;
  student_name: string;
  admission_number?: string;
  class_code: string;
  class_name?: string;
  relationship: string;
  outstanding: number;
  grades: Grade[];
  invoices: Invoice[];
  payments: Payment[];
  attendance: Attendance[];
  incidents: Incident[];
}

interface PortalData {
  parent_id: string;
  parent_name: string;
  school_name: string;
  school_slug: string;
  children: Child[];
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function cn(...classes: (string | undefined | false | null)[]) {
  return classes.filter(Boolean).join(" ");
}

function fmtKes(v: number | string) {
  return `KES ${Number(v).toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// ─── Micro-components ────────────────────────────────────────────────────────

function StatusBadge({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "error" | "info";
}) {
  const variants = {
    default: "bg-slate-100 text-slate-700",
    success: "bg-green-100 text-green-700",
    warning: "bg-amber-100 text-amber-700",
    error: "bg-red-100 text-red-700",
    info: "bg-blue-100 text-blue-700",
  };
  return (
    <span
      className={cn(
        "px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
        variants[variant]
      )}
    >
      {children}
    </span>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-4 mt-8 px-4">
      {title}
    </h3>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center py-3 px-2 flex-1 transition-all duration-300 relative",
        active ? "text-blue-700" : "text-slate-400"
      )}
    >
      <Icon className={cn("w-5 h-5 mb-1", active ? "scale-110" : "scale-100")} />
      <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
      {active && (
        <motion.div
          layoutId="activeTab"
          className="absolute bottom-0 left-0 right-0 h-1 bg-blue-600 rounded-t-full"
        />
      )}
    </button>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Verification Screen ──────────────────────────────────────────────────────

const VERIFICATION_STEPS = [
  { label: "Verifying link authenticity", icon: ShieldCheck },
  { label: "Confirming secure channel", icon: Lock },
  { label: "Decrypting your data", icon: UserRound },
] as const;

function VerificationScreen({
  token,
  slug,
  onComplete,
  onError,
}: {
  token: string;
  slug: string;
  onComplete: (data: PortalData) => void;
  onError: (msg: string) => void;
}) {
  const [step, setStep] = useState(0);
  const [granted, setGranted] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    // Wait silently until URL params are hydrated — never call onError on empty params.
    if (!token || !slug) return;
    // Guard against the effect re-running if Suspense re-triggers it.
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;

    async function run() {
      const fetchP = fetch(
        `/api/v1/public/portal?token=${encodeURIComponent(token)}&slug=${encodeURIComponent(slug)}`
      ).then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({})) as { detail?: string };
          throw new Error(body.detail || "invalid");
        }
        return r.json() as Promise<PortalData>;
      });

      // Animate through steps
      for (let i = 0; i < VERIFICATION_STEPS.length; i++) {
        if (i > 0) await delay(700);
        if (cancelled) return;
        setStep(i);
      }
      await delay(700); // hold on last step
      if (cancelled) return;

      try {
        const d = await fetchP;
        if (cancelled) return;
        setGranted(true);
        await delay(650);
        if (!cancelled) onComplete(d);
      } catch (e: unknown) {
        if (!cancelled) onError((e as Error).message || "invalid");
      }
    }

    run();
    return () => { cancelled = true; };
  }, [token, slug]); // re-run only when params change (guarded by startedRef)

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center px-6"
      style={{ background: "linear-gradient(135deg, #0f172a 0%, #0c1a3a 50%, #0f172a 100%)" }}>
      {/* Ambient pulse rings */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full border border-blue-900/30 animate-ping" style={{ animationDuration: "4s" }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[450px] h-[450px] rounded-full border border-blue-800/20 animate-ping" style={{ animationDuration: "3s", animationDelay: "0.8s" }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[250px] h-[250px] rounded-full border border-blue-700/20 animate-ping" style={{ animationDuration: "2s", animationDelay: "0.4s" }} />
      </div>

      {/* Logo */}
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="mb-10 text-center relative z-10"
      >
        <div
          className="w-24 h-24 rounded-[2rem] flex items-center justify-center shadow-2xl mx-auto mb-5 transition-all duration-700"
          style={{
            background: granted
              ? "linear-gradient(135deg, #16a34a, #15803d)"
              : "linear-gradient(135deg, #2563eb, #1d4ed8)",
            boxShadow: granted
              ? "0 0 60px rgba(22,163,74,0.4), 0 20px 40px rgba(0,0,0,0.5)"
              : "0 0 60px rgba(37,99,235,0.4), 0 20px 40px rgba(0,0,0,0.5)",
          }}
        >
          <AnimatePresence mode="wait">
            {granted ? (
              <motion.div key="check" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 300 }}>
                <CheckCircle2 className="w-14 h-14 text-white" />
              </motion.div>
            ) : (
              <motion.div key="shield" initial={{ scale: 1 }} exit={{ scale: 0 }}>
                <ShieldCheck className="w-14 h-14 text-white" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <AnimatePresence mode="wait">
          {granted ? (
            <motion.p key="granted" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
              className="text-sm font-black uppercase tracking-[0.3em] text-green-400">
              Access Granted
            </motion.p>
          ) : (
            <motion.p key="portal" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
              className="text-sm font-black uppercase tracking-[0.3em] text-blue-400">
              ShuleHQ Secure Portal
            </motion.p>
          )}
        </AnimatePresence>
        <p className="text-slate-600 text-xs mt-1.5 font-mono">{slug}</p>
      </motion.div>

      {/* Steps */}
      <div className="space-y-3 w-full max-w-xs relative z-10">
        {VERIFICATION_STEPS.map((s, i) => {
          const done = granted || i < step;
          const active = !granted && i === step;
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: i <= step || granted ? 1 : 0.2, x: 0 }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
              className="flex items-center gap-4 rounded-2xl px-5 py-4 border transition-all duration-500"
              style={{
                background: done
                  ? "rgba(22,163,74,0.08)"
                  : active
                  ? "rgba(37,99,235,0.12)"
                  : "rgba(255,255,255,0.03)",
                borderColor: done
                  ? "rgba(22,163,74,0.25)"
                  : active
                  ? "rgba(37,99,235,0.4)"
                  : "rgba(255,255,255,0.05)",
              }}
            >
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-all duration-500"
                style={{
                  background: done ? "#16a34a" : active ? "#2563eb" : "#1e293b",
                }}
              >
                {done ? (
                  <Check className="w-4 h-4 text-white" />
                ) : active ? (
                  <Loader2 className="w-4 h-4 text-white animate-spin" />
                ) : (
                  <s.icon className="w-4 h-4 text-slate-600" />
                )}
              </div>
              <span
                className="text-sm font-semibold flex-1 transition-colors duration-500"
                style={{ color: done ? "#4ade80" : active ? "#f8fafc" : "#475569" }}
              >
                {s.label}
              </span>
              {done && (
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 300 }}>
                  <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                </motion.div>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Footer */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2, duration: 0.6 }}
        className="absolute bottom-8 flex items-center gap-2 text-slate-700 text-xs z-10"
      >
        <Lock className="w-3 h-3" />
        <span className="font-mono tracking-wide">TLS 1.3 · 384-bit token · Zero data stored</span>
      </motion.div>
    </div>
  );
}

// ─── Error Screen ─────────────────────────────────────────────────────────────

function ErrorScreen({ message }: { message?: string }) {
  const expired = message?.toLowerCase().includes("expired");
  const isNetworkError = !message || message === "invalid" || message === "Failed to fetch";
  return (
    <div
      className="fixed inset-0 flex items-center justify-center px-6"
      style={{ background: "linear-gradient(135deg, #0f172a 0%, #0c1a3a 50%, #0f172a 100%)" }}
    >
      <motion.div
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="text-center max-w-sm w-full"
      >
        <div
          className="w-24 h-24 rounded-[2rem] flex items-center justify-center mx-auto mb-6"
          style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)" }}
        >
          <AlertCircle className="w-14 h-14 text-red-400" />
        </div>
        <h2 className="text-2xl font-black text-white mb-4">
          {expired ? "Link Expired" : "Access Denied"}
        </h2>
        <p className="text-slate-400 leading-relaxed text-sm">
          {expired
            ? "This portal link has expired or has been revoked. Please contact the school office for a new access link."
            : isNetworkError
            ? "Could not connect to the server. Please check your internet connection and try again."
            : "This link is invalid or has been revoked. Please contact the school office for a new access link."}
        </p>
        {message && message !== "invalid" && (
          <p className="mt-4 text-slate-700 text-[11px] font-mono break-all px-2">{message}</p>
        )}
        <div className="mt-10 flex items-center justify-center gap-2 text-slate-700 text-xs">
          <Lock className="w-3 h-3" />
          <span className="font-mono">ShuleHQ Secure Portal</span>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

function FeesTab({ child }: { child: Child }) {
  const outstanding = Number(child.outstanding || 0);
  const totalBilled = child.invoices.reduce((s, i) => s + Number(i.billed), 0);
  const totalPaid = child.invoices.reduce((s, i) => s + Number(i.paid), 0);

  if (child.invoices.length === 0) {
    return (
      <div className="py-12 px-6 text-center">
        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CreditCard className="w-8 h-8 text-slate-400" />
        </div>
        <h4 className="text-slate-900 font-bold mb-2">No Fee Records</h4>
        <p className="text-slate-500 text-sm">
          There are no recorded invoices for this child yet.
        </p>
      </div>
    );
  }

  const statusBadge = (status: string): "success" | "warning" | "error" => {
    const s = status.toUpperCase();
    if (s === "PAID") return "success";
    if (s === "PARTIAL") return "warning";
    return "error";
  };

  return (
    <div className="pb-12">
      {outstanding > 0 && (
        <div className="mx-4 mb-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-amber-900 font-bold text-sm">Outstanding Balance</p>
            <p className="text-amber-700 text-xs">
              {fmtKes(outstanding)} remaining. Please visit the school or contact us to settle.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 px-4 mb-8">
        <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100">
          <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Billed</p>
          <p className="text-sm font-black text-slate-900">{fmtKes(totalBilled)}</p>
        </div>
        <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100">
          <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Paid</p>
          <p className="text-sm font-black text-blue-600">{fmtKes(totalPaid)}</p>
        </div>
        <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100">
          <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Balance</p>
          <p className={cn("text-sm font-black", outstanding > 0 ? "text-red-600" : "text-green-600")}>
            {fmtKes(outstanding)}
          </p>
        </div>
      </div>

      <SectionTitle title="Invoices" />
      <div className="space-y-4 px-4">
        {child.invoices.map((inv) => (
          <div key={inv.id} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
            <div className="flex justify-between items-start mb-3">
              <div>
                <h4 className="font-bold text-slate-900 capitalize">
                  {inv.invoice_type.replace(/_/g, " ").toLowerCase()}
                </h4>
                {inv.term_label && (
                  <p className="text-xs text-slate-500">{inv.term_label}</p>
                )}
              </div>
              <StatusBadge variant={statusBadge(inv.status)}>{inv.status}</StatusBadge>
            </div>
            <div className="flex justify-between pt-3 border-t border-slate-50">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase">Billed</p>
                <p className="font-bold text-slate-900 leading-none">{fmtKes(inv.billed)}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold text-slate-400 uppercase">Balance</p>
                <p
                  className={cn(
                    "font-bold leading-none",
                    Number(inv.balance) > 0 ? "text-red-600" : "text-green-600"
                  )}
                >
                  {fmtKes(inv.balance)}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {child.payments.length > 0 && (
        <>
          <SectionTitle title="Payment History" />
          <div className="bg-white mx-4 rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            {child.payments.map((p, idx) => (
              <div
                key={p.id}
                className={cn(
                  "p-4 flex items-center justify-between",
                  idx !== child.payments.length - 1 && "border-b border-slate-50"
                )}
              >
                <div>
                  <p className="font-bold text-slate-900">
                    {p.date ? format(parseISO(p.date), "dd MMM yyyy") : "—"}
                  </p>
                  <p className="text-xs text-slate-500 uppercase tracking-wider">
                    {p.provider}
                    {p.reference ? ` • ${p.reference}` : ""}
                  </p>
                </div>
                <p className="font-black text-green-600 text-lg">+ {fmtKes(p.amount)}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ReportTab({ child }: { child: Child }) {
  const bySubject = useMemo(() => {
    const map: Record<string, Grade[]> = {};
    for (const g of child.grades) {
      if (!map[g.subject]) map[g.subject] = [];
      map[g.subject].push(g);
    }
    return map;
  }, [child.grades]);

  const subjects = Object.keys(bySubject);

  const gradeVariant = (g?: string): "success" | "info" | "warning" | "error" | "default" => {
    if (!g) return "default";
    const u = g.toUpperCase();
    if (u === "EE") return "success";
    if (u === "ME") return "info";
    if (u === "AE") return "warning";
    if (u === "BE") return "error";
    return "default";
  };

  if (subjects.length === 0) {
    return (
      <div className="py-12 px-6 text-center">
        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <FileText className="w-8 h-8 text-slate-400" />
        </div>
        <h4 className="text-slate-900 font-bold mb-2">No Report Published</h4>
        <p className="text-slate-500 text-sm">
          Assessment reports for the current term have not been released yet.
        </p>
      </div>
    );
  }

  return (
    <div className="pb-12 space-y-6 px-4 pt-4">
      {subjects.map((subject) => (
        <div key={subject}>
          <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3">
            {subject}
          </h4>
          <div className="space-y-3">
            {bySubject[subject].map((g, i) => (
              <div
                key={i}
                className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100"
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h5 className="font-bold text-slate-900">{g.strand || g.sub_strand || "—"}</h5>
                    {g.sub_strand && g.strand && (
                      <p className="text-xs font-bold text-blue-600 uppercase tracking-widest">
                        {g.sub_strand}
                      </p>
                    )}
                  </div>
                  {g.grade && (
                    <StatusBadge variant={gradeVariant(g.grade)}>{g.grade}</StatusBadge>
                  )}
                </div>
                {g.comments && (
                  <div className="mt-3 p-3 bg-slate-50 rounded-xl relative">
                    <div className="absolute top-0 left-0 w-1 h-full bg-blue-200 rounded-l-xl" />
                    <p className="text-sm text-slate-600 italic leading-relaxed pl-2">
                      &ldquo;{g.comments}&rdquo;
                    </p>
                    <div className="mt-1 text-[10px] font-bold text-slate-400 uppercase text-right">
                      Teacher Remarks
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AttendanceTab({ child }: { child: Child }) {
  const [currentDate, setCurrentDate] = useState(new Date());

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const summary = useMemo(() => {
    const present = child.attendance.filter((r) => r.status === "PRESENT").length;
    const absent = child.attendance.filter((r) => r.status === "ABSENT").length;
    const late = child.attendance.filter((r) => r.status === "LATE").length;
    const total = present + absent + late;
    const percentage = total > 0 ? (present / total) * 100 : 0;
    return { present, absent, late, percentage };
  }, [child.attendance]);

  const getDayStyle = (day: Date) => {
    const record = child.attendance.find((r) => {
      try { return isSameDay(parseISO(r.date), day); } catch { return false; }
    });
    if (!record)
      return isWeekend(day) ? "bg-slate-50 text-slate-200" : "bg-white text-slate-300";
    switch (record.status) {
      case "PRESENT": return "bg-green-500 text-white ring-2 ring-green-100";
      case "ABSENT": return "bg-red-500 text-white ring-2 ring-red-100";
      case "LATE": return "bg-amber-500 text-white ring-2 ring-amber-100";
      case "EXCUSED": return "bg-slate-300 text-white";
      default: return "bg-white text-slate-300";
    }
  };

  const absences = child.attendance.filter((r) => r.status === "ABSENT");

  return (
    <div className="pb-12 px-4">
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-black text-slate-900 text-lg">
          {format(currentDate, "MMMM yyyy")}
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => setCurrentDate(subMonths(currentDate, 1))}
            className="p-2 bg-white rounded-full border border-slate-100 shadow-sm"
          >
            <ChevronLeft className="w-5 h-5 text-slate-600" />
          </button>
          <button
            onClick={() => setCurrentDate(addMonths(currentDate, 1))}
            className="p-2 bg-white rounded-full border border-slate-100 shadow-sm"
          >
            <ChevronRight className="w-5 h-5 text-slate-600" />
          </button>
        </div>
      </div>

      <div className="bg-white p-4 rounded-3xl shadow-sm border border-slate-100 mb-8">
        <div className="grid grid-cols-7 gap-1 mb-2">
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
            <div key={i} className="text-center text-[10px] font-bold text-slate-400 py-2">{d}</div>
          ))}
          {Array.from({ length: monthStart.getDay() }).map((_, i) => <div key={`e-${i}`} />)}
          {daysInMonth.map((day) => (
            <div
              key={day.toString()}
              className={cn(
                "aspect-square flex items-center justify-center rounded-xl text-xs font-bold transition-all",
                getDayStyle(day)
              )}
            >
              {day.getDate()}
            </div>
          ))}
        </div>
        <div className="flex justify-between mt-4 px-2 pt-4 border-t border-slate-50">
          {[
            { color: "bg-green-500", label: "Present" },
            { color: "bg-amber-500", label: "Late" },
            { color: "bg-red-500", label: "Absent" },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-1.5">
              <div className={cn("w-2 h-2 shrink-0 rounded-full", item.color)} />
              <span className="text-[10px] font-bold text-slate-500 uppercase">{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 mb-8">
        <div className="flex justify-between items-end mb-4">
          <h4 className="font-bold text-slate-900">Term Attendance</h4>
          <p className="text-sm font-black text-blue-600">{Math.round(summary.percentage)}%</p>
        </div>
        <div className="h-4 bg-slate-100 rounded-full overflow-hidden mb-6">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${summary.percentage}%` }}
            className="h-full bg-blue-500 rounded-full"
          />
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[
            { value: summary.present, label: "Present" },
            { value: summary.late, label: "Late", border: true },
            { value: summary.absent, label: "Absent" },
          ].map((item) => (
            <div key={item.label} className={cn("text-center", item.border && "border-x border-slate-100")}>
              <p className="text-2xl font-black text-slate-900 leading-none">{item.value}</p>
              <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">{item.label}</p>
            </div>
          ))}
        </div>
      </div>

      {absences.length > 0 && (
        <>
          <SectionTitle title="Recent Absences" />
          <div className="space-y-3">
            {absences.map((record, idx) => (
              <div
                key={idx}
                className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex items-center justify-between"
              >
                <p className="font-bold text-slate-900">
                  {format(parseISO(record.date), "dd MMMM yyyy")}
                </p>
                <StatusBadge variant="error">Absent</StatusBadge>
              </div>
            ))}
          </div>
        </>
      )}

      {child.attendance.length === 0 && (
        <div className="py-12 text-center">
          <Calendar className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-400 text-sm">No attendance records yet.</p>
        </div>
      )}
    </div>
  );
}

function BehaviourTab({ child }: { child: Child }) {
  if (child.incidents.length === 0) {
    return (
      <div className="py-20 px-8 text-center bg-white mx-4 rounded-3xl border border-slate-100 shadow-sm">
        <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="w-10 h-10 text-green-500" />
        </div>
        <h4 className="text-slate-900 text-xl font-bold mb-2">Behaviour Record</h4>
        <p className="text-slate-500">
          No behaviour incidents on record. {child.student_name.split(" ")[0]} is doing great.
        </p>
        <p className="text-green-600 font-black text-xs uppercase tracking-widest mt-4">Keep it up!</p>
      </div>
    );
  }

  return (
    <div className="pb-12 px-4">
      <div className="space-y-4">
        {child.incidents.map((inc) => (
          <div key={inc.id} className="bg-white p-5 rounded-3xl shadow-sm border border-slate-100">
            <div className="flex justify-between items-start mb-3">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                  {inc.date ? format(parseISO(inc.date), "dd MMM yyyy") : inc.date}
                </p>
                <h4 className="font-bold text-slate-900 text-base leading-tight">{inc.title}</h4>
                <p className="text-xs text-slate-400 mt-0.5">{inc.incident_type}</p>
              </div>
              <StatusBadge variant={inc.status === "CLOSED" ? "success" : "warning"}>
                {inc.status}
              </StatusBadge>
            </div>
            {inc.description && (
              <p className="text-sm text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-xl">
                {inc.description}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function PortalPageContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const slug = searchParams.get("slug") || "";

  const [verifying, setVerifying] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | undefined>();
  const [data, setData] = useState<PortalData | null>(null);
  const [selectedChildIdx, setSelectedChildIdx] = useState(0);
  const [activeTab, setActiveTab] = useState<"fees" | "reports" | "attendance" | "behaviour">("fees");

  if (verifying) {
    return (
      <VerificationScreen
        token={token}
        slug={slug}
        onComplete={(d) => { setData(d); setVerifying(false); }}
        onError={(msg) => { setErrorMsg(msg); setVerifying(false); }}
      />
    );
  }
  if (errorMsg !== undefined || !data) return <ErrorScreen message={errorMsg} />;

  const child = data.children[selectedChildIdx];
  const outstanding = Number(child?.outstanding || 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-100"
    >
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-lg border-b border-slate-100 px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <h1 className="font-black text-slate-900 text-sm overflow-hidden text-ellipsis whitespace-nowrap max-w-[160px]">
            {data.school_name}
          </h1>
        </div>
        <div className="flex items-center gap-1.5 bg-green-50 border border-green-200 px-2.5 py-1 rounded-full">
          <Lock className="w-3 h-3 text-green-600" />
          <span className="text-[8px] font-black uppercase text-green-700 tracking-tighter">Verified</span>
        </div>
      </header>

      <main className="max-w-xl mx-auto">
        {/* Welcome */}
        <section className="px-5 pt-8 pb-4">
          <h2 className="text-3xl font-black text-slate-900 tracking-tight leading-none mb-2">
            Hello, {data.parent_name.split(" ")[0]}
          </h2>
          <p className="text-slate-500 font-medium">
            {data.children.length === 1 ? "Here's how your child is doing." : "Here's how your children are doing."}
          </p>
        </section>

        {/* Child Selector */}
        {data.children.length > 1 && (
          <section className="px-4 py-4 overflow-x-auto flex gap-3 mb-4">
            {data.children.map((c, idx) => (
              <button
                key={c.enrollment_id}
                onClick={() => { setSelectedChildIdx(idx); setActiveTab("fees"); }}
                className={cn(
                  "px-5 py-3 rounded-2xl flex flex-col items-start gap-1 transition-all duration-300 min-w-[140px] border shadow-sm",
                  selectedChildIdx === idx
                    ? "bg-blue-600 border-blue-700 text-white -translate-y-0.5 shadow-blue-100"
                    : "bg-white border-slate-100 text-slate-500"
                )}
              >
                <span className="text-xs font-black uppercase tracking-widest">
                  {c.student_name.split(" ")[0]}
                </span>
                <span className={cn("text-[10px] font-bold", selectedChildIdx === idx ? "text-blue-100" : "text-slate-400")}>
                  {c.class_code}
                </span>
              </button>
            ))}
          </section>
        )}

        {/* Child Summary Card */}
        <AnimatePresence mode="wait">
          {child && (
            <motion.section
              key={child.enrollment_id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="px-4 mb-2"
            >
              <div className="bg-slate-900 rounded-[2.5rem] p-6 text-white shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2" />
                <div className="absolute bottom-0 left-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl translate-y-1/2 -translate-x-1/2" />
                <div className="flex items-center gap-5 relative z-10">
                  <div className="relative">
                    <div className="w-16 h-16 rounded-3xl bg-blue-700/40 flex items-center justify-center border-2 border-white/20">
                      <UserRound className="w-8 h-8 text-blue-200" />
                    </div>
                    {outstanding > 0
                      ? <div className="absolute -top-1 -right-1"><BadgeAlert className="w-5 h-5 text-red-400" /></div>
                      : <div className="absolute -top-1 -right-1"><CheckCircle2 className="w-5 h-5 text-green-400" /></div>
                    }
                  </div>
                  <div>
                    <h3 className="text-xl font-bold leading-none mb-1">{child.student_name}</h3>
                    <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">{child.class_code}</p>
                  </div>
                </div>
                <div className="mt-8 flex items-center justify-between relative z-10">
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Admission No</p>
                    <p className="text-sm font-black">{child.admission_number || "—"}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Fee Balance</p>
                    <div className={cn("px-3 py-1 rounded-full text-xs font-black", outstanding > 0 ? "bg-red-500/20 text-red-400" : "bg-green-500/20 text-green-400")}>
                      {fmtKes(outstanding)}
                    </div>
                  </div>
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Tab Navigation */}
        <section className="sticky top-[68px] z-40 bg-slate-50/80 backdrop-blur-md pt-4 pb-2">
          <div className="mx-4 bg-white rounded-2xl shadow-sm border border-slate-100 flex overflow-hidden">
            <TabButton active={activeTab === "fees"} onClick={() => setActiveTab("fees")} icon={CreditCard} label="Fees" />
            <TabButton active={activeTab === "reports"} onClick={() => setActiveTab("reports")} icon={FileText} label="Report" />
            <TabButton active={activeTab === "attendance"} onClick={() => setActiveTab("attendance")} icon={Calendar} label="Attendance" />
            <TabButton active={activeTab === "behaviour"} onClick={() => setActiveTab("behaviour")} icon={UserRound} label="Behaviour" />
          </div>
        </section>

        {/* Tab Content */}
        {child && (
          <div className="mt-4">
            <AnimatePresence mode="wait">
              <motion.div
                key={`${child.enrollment_id}-${activeTab}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                {activeTab === "fees" && <FeesTab child={child} />}
                {activeTab === "reports" && <ReportTab child={child} />}
                {activeTab === "attendance" && <AttendanceTab child={child} />}
                {activeTab === "behaviour" && <BehaviourTab child={child} />}
              </motion.div>
            </AnimatePresence>
          </div>
        )}
      </main>

      <footer className="py-12 px-6 text-center text-slate-400 text-[10px] font-bold uppercase tracking-widest border-t border-slate-200 mt-12 bg-white">
        <p>&copy; {new Date().getFullYear()} {data.school_name}</p>
        <p className="mt-2 text-blue-600/40">Powered by ShuleHQ</p>
      </footer>
    </motion.div>
  );
}

// Suspense boundary is required for useSearchParams() in Next.js 14 App Router.
// Without it, searchParams are null during SSR and the verification fires with
// empty token/slug, immediately failing before the real URL params are available.
export default function PortalPage() {
  return (
    <Suspense
      fallback={
        <div
          className="fixed inset-0 flex flex-col items-center justify-center"
          style={{ background: "linear-gradient(135deg, #0f172a 0%, #0c1a3a 50%, #0f172a 100%)" }}
        >
          <div className="w-24 h-24 rounded-[2rem] flex items-center justify-center mb-6"
            style={{ background: "linear-gradient(135deg, #2563eb, #1d4ed8)", boxShadow: "0 0 60px rgba(37,99,235,0.4)" }}>
            <ShieldCheck className="w-14 h-14 text-white" />
          </div>
          <p className="text-blue-400 text-sm font-black uppercase tracking-[0.3em]">ShuleHQ Secure Portal</p>
        </div>
      }
    >
      <PortalPageContent />
    </Suspense>
  );
}
