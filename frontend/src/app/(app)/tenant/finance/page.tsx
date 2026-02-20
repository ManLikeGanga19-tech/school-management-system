"use client";

import { useEffect, useState } from "react";
import { Pie, PieChart, Cell } from "recharts";
import {
  Receipt,
  CheckCircle,
  CircleDollarSign,
  FileText,
  TrendingUp,
  ShieldAlert,
  Tag,
  ListChecks,
  GraduationCap,
  Save,
  ToggleLeft,
  ToggleRight,
  BadgePercent,
  Banknote,
} from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { directorNav } from "@/components/layout/nav-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

// ─── Types ────────────────────────────────────────────────────────────────────

type Policy = {
  allow_partial_enrollment: boolean;
  min_percent_to_enroll: number | null;
  min_amount_to_enroll: string | null;
  require_interview_fee_before_submit: boolean;
};

type Invoice = {
  id: string;
  total_amount: string | number;
  paid_amount: string | number;
  balance_amount: string | number;
  status: string;
};

// ─── Chart config ─────────────────────────────────────────────────────────────

const chartConfig = {
  paid:        { label: "Collected",   color: "#10b981" },
  outstanding: { label: "Outstanding", color: "#f59e0b" },
};

const PIE_COLORS = ["#10b981", "#f59e0b"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toNumber(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function formatKes(value: number) {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(value);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  color: "blue" | "emerald" | "amber" | "slate";
}) {
  const palettes = {
    blue:    { wrap: "border-blue-100 bg-blue-50",       icon: "bg-blue-100 text-blue-600",       val: "text-blue-900",    sub: "text-blue-400" },
    emerald: { wrap: "border-emerald-100 bg-emerald-50", icon: "bg-emerald-100 text-emerald-600", val: "text-emerald-900", sub: "text-emerald-400" },
    amber:   { wrap: "border-amber-100 bg-amber-50",     icon: "bg-amber-100 text-amber-600",     val: "text-amber-900",   sub: "text-amber-400" },
    slate:   { wrap: "border-slate-100 bg-slate-50",     icon: "bg-slate-100 text-slate-500",     val: "text-slate-900",   sub: "text-slate-400" },
  };
  const p = palettes[color];
  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${p.wrap}`}>
      <div className={`inline-flex rounded-xl p-2.5 ${p.icon}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className={`mt-4 text-2xl font-bold tracking-tight ${p.val}`}>{value}</div>
      <div className="mt-0.5 text-sm font-medium text-slate-600">{label}</div>
      {sub && <div className={`mt-0.5 text-xs ${p.sub}`}>{sub}</div>}
    </div>
  );
}

function PolicyToggle({
  label,
  description,
  enabled,
  onToggle,
  icon: Icon,
}: {
  label: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition ${
        enabled
          ? "border-blue-200 bg-blue-50"
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      <div className={`mt-0.5 rounded-lg p-1.5 ${enabled ? "bg-blue-100 text-blue-600" : "bg-slate-100 text-slate-400"}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1">
        <div className={`text-sm font-semibold ${enabled ? "text-blue-900" : "text-slate-700"}`}>
          {label}
        </div>
        <div className="mt-0.5 text-xs text-slate-400">{description}</div>
      </div>
      <div className="mt-0.5 shrink-0">
        {enabled ? (
          <ToggleRight className="h-5 w-5 text-blue-600" />
        ) : (
          <ToggleLeft className="h-5 w-5 text-slate-300" />
        )}
      </div>
    </button>
  );
}

function SectionCard({
  title,
  subtitle,
  icon: Icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-6 py-4">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-slate-400" />}
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        </div>
        {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TenantFinancePage() {
  const [invoices, setInvoices]         = useState<Invoice[]>([]);
  const [policy, setPolicy]             = useState<Policy | null>(null);
  const [feeCategories, setFeeCategories] = useState<any[]>([]);
  const [feeItems, setFeeItems]         = useState<any[]>([]);
  const [scholarships, setScholarships] = useState<any[]>([]);
  const [error, setError]               = useState<string | null>(null);
  const [notice, setNotice]             = useState<string | null>(null);
  const [saving, setSaving]             = useState(false);

  async function load() {
    const res = await fetch("/api/tenant/director/finance", { method: "GET" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError("Failed to load finance data"); return; }
    setPolicy(data?.policy || null);
    setInvoices(Array.isArray(data?.invoices) ? data.invoices : []);
    setFeeCategories(Array.isArray(data?.fee_categories) ? data.fee_categories : []);
    setFeeItems(Array.isArray(data?.fee_items) ? data.fee_items : []);
    setScholarships(Array.isArray(data?.scholarships) ? data.scholarships : []);
    setError(null);
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => clearInterval(timer);
  }, []);

  async function savePolicy() {
    if (!policy) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    const res = await fetch("/api/tenant/director/finance/policy", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(policy),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(typeof data?.detail === "string" ? data.detail : "Failed to update policy");
      return;
    }
    setPolicy(data as Policy);
    setNotice("Finance policy saved successfully.");
  }

  const totals = invoices.reduce(
    (acc, inv) => {
      acc.total   += toNumber(inv.total_amount);
      acc.paid    += toNumber(inv.paid_amount);
      acc.balance += toNumber(inv.balance_amount);
      return acc;
    },
    { total: 0, paid: 0, balance: 0 }
  );

  const collectionRate = totals.total > 0 ? Math.round((totals.paid / totals.total) * 100) : 0;

  const pieData = [
    { name: "paid",        value: totals.paid    },
    { name: "outstanding", value: totals.balance },
  ];

  return (
    <AppShell title="Director" nav={directorNav} activeHref="/tenant/finance?section=fee-structures">
      <div className="space-y-5">

        {/* ── Header ── */}
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-700 to-blue-500 p-5 text-white shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-bold">Finance Control Centre</h1>
              <p className="mt-0.5 text-sm text-blue-100">
                Real-time monitoring and policy management · All figures in KES
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 backdrop-blur text-sm text-blue-100">
              <TrendingUp className="h-4 w-4 text-emerald-300" />
              <span>{collectionRate}% collected</span>
            </div>
          </div>
        </div>

        {/* ── Alerts ── */}
        {error && (
          <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 shrink-0 text-red-500" />
              {error}
            </div>
            <button onClick={() => setError(null)} className="opacity-60 hover:opacity-100">✕</button>
          </div>
        )}
        {notice && (
          <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 shrink-0 text-emerald-500" />
              {notice}
            </div>
            <button onClick={() => setNotice(null)} className="opacity-60 hover:opacity-100">✕</button>
          </div>
        )}

        {/* ── KPI Cards ── */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Total Billed"
            value={formatKes(totals.total)}
            sub={`${invoices.length} invoice${invoices.length !== 1 ? "s" : ""}`}
            icon={Receipt}
            color="blue"
          />
          <StatCard
            label="Collected"
            value={formatKes(totals.paid)}
            sub={`${collectionRate}% collection rate`}
            icon={CheckCircle}
            color="emerald"
          />
          <StatCard
            label="Outstanding"
            value={formatKes(totals.balance)}
            sub={totals.balance > 0 ? "Pending collection" : "All clear"}
            icon={CircleDollarSign}
            color={totals.balance > 0 ? "amber" : "emerald"}
          />
          <StatCard
            label="Invoices"
            value={invoices.length}
            sub="Total in system"
            icon={FileText}
            color="slate"
          />
        </div>

        {/* ── Collection progress bar ── */}
        {totals.total > 0 && (
          <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <TrendingUp className="h-4 w-4 text-slate-400" />
                Fee Collection Progress
              </div>
              <span className="text-sm font-bold text-slate-800">{collectionRate}%</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${collectionRate}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between text-xs text-slate-400">
              <span>Collected {formatKes(totals.paid)}</span>
              <span>Target {formatKes(totals.total)}</span>
            </div>
          </div>
        )}

        {/* ── Chart + Policy ── */}
        <div className="grid gap-5 lg:grid-cols-2">

          {/* Collection pie chart */}
          <SectionCard
            title="Collection Breakdown"
            subtitle="Live split between collected and outstanding fees"
            icon={TrendingUp}
          >
            {totals.total > 0 ? (
              <div className="flex items-center gap-6">
                <ChartContainer config={chartConfig} className="h-[220px] flex-1">
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={60}
                      outerRadius={95}
                      strokeWidth={2}
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>

                <div className="shrink-0 space-y-4">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                      Collected
                    </div>
                    <div className="mt-0.5 text-xl font-bold text-slate-800">{collectionRate}%</div>
                    <div className="text-xs text-slate-400">{formatKes(totals.paid)}</div>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                      Outstanding
                    </div>
                    <div className="mt-0.5 text-xl font-bold text-slate-800">{100 - collectionRate}%</div>
                    <div className="text-xs text-slate-400">{formatKes(totals.balance)}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-[220px] items-center justify-center text-sm text-slate-400">
                No invoice data yet
              </div>
            )}

            {/* Catalogue summary */}
            <div className="mt-5 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4">
              {[
                { label: "Fee Categories", value: feeCategories.length, icon: Tag },
                { label: "Fee Items",      value: feeItems.length,      icon: ListChecks },
                { label: "Scholarships",   value: scholarships.length,  icon: GraduationCap },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="rounded-xl bg-slate-50 p-3 text-center">
                  <Icon className="mx-auto h-4 w-4 text-slate-400 mb-1" />
                  <div className="text-lg font-bold text-slate-800">{value}</div>
                  <div className="text-xs text-slate-400">{label}</div>
                </div>
              ))}
            </div>
          </SectionCard>

          {/* Finance policy panel */}
          <SectionCard
            title="Finance Policy"
            subtitle="Controls enrollment and fee payment rules for this institution"
            icon={ShieldAlert}
          >
            {!policy ? (
              <div className="flex h-[200px] items-center justify-center text-sm text-slate-400">
                Loading policy…
              </div>
            ) : (
              <div className="space-y-4">

                {/* Toggle switches */}
                <PolicyToggle
                  label="Allow Partial Enrollment"
                  description="Students can be enrolled without paying the full fee amount."
                  enabled={policy.allow_partial_enrollment}
                  onToggle={() =>
                    setPolicy((p) => p ? { ...p, allow_partial_enrollment: !p.allow_partial_enrollment } : p)
                  }
                  icon={BadgePercent}
                />

                <PolicyToggle
                  label="Require Interview Fee Before Submit"
                  description="Intake cannot be submitted until the interview invoice is paid."
                  enabled={policy.require_interview_fee_before_submit}
                  onToggle={() =>
                    setPolicy((p) =>
                      p ? { ...p, require_interview_fee_before_submit: !p.require_interview_fee_before_submit } : p
                    )
                  }
                  icon={FileText}
                />

                {/* Numeric thresholds */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                      <BadgePercent className="h-3.5 w-3.5 text-slate-400" />
                      Min. Percent to Enroll
                    </Label>
                    <div className="relative">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        placeholder="e.g. 50"
                        value={policy.min_percent_to_enroll ?? ""}
                        onChange={(e) =>
                          setPolicy((p) =>
                            p
                              ? { ...p, min_percent_to_enroll: e.target.value === "" ? null : Number(e.target.value) }
                              : p
                          )
                        }
                        className="pr-8"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                        %
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">Leave blank to disable</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                      <Banknote className="h-3.5 w-3.5 text-slate-400" />
                      Min. Amount to Enroll (KES)
                    </Label>
                    <div className="relative">
                      <Input
                        type="number"
                        min={0}
                        placeholder="e.g. 5000"
                        value={policy.min_amount_to_enroll ?? ""}
                        onChange={(e) =>
                          setPolicy((p) =>
                            p
                              ? { ...p, min_amount_to_enroll: e.target.value === "" ? null : e.target.value }
                              : p
                          )
                        }
                        className="pr-12"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                        KES
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">Leave blank to disable</p>
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-3">
                  <Button
                    onClick={savePolicy}
                    disabled={saving}
                    className="w-full bg-blue-600 hover:bg-blue-700"
                  >
                    {saving ? (
                      <span className="flex items-center gap-2">
                        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Saving…
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Save className="h-4 w-4" />
                        Save Policy
                      </span>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </AppShell>
  );
}