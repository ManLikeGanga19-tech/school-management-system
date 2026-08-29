"use client";

/**
 * Admin dashboard charts — snapshot composition of the live SaaS KPIs (no
 * backend change; all data comes from the metrics/summary already loaded).
 * Recharts (already a dependency). Prestige card styling. Every chart carries a
 * legend/labels so identity is never colour-alone.
 */

import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, LabelList,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { formatKes } from "@/lib/format";

// Reserved status palette (semantic states) — paired with labels, never colour-alone.
const STATUS = {
  active: "#10b981", trialing: "#2a78d6", past_due: "#f59e0b",
  cancelled: "#dc2626", inactive: "#9ca3af",
};
// Validated categorical palette (blue/orange/violet/cyan/pink) — CVD-safe.
const CATEGORICAL = ["#2a78d6", "#d97706", "#7c3aed", "#0891b2", "#be185d"];

type Metrics = {
  subscriptions: { active: number; trialing: number; past_due: number; cancelled: number; plans: { name: string; count: number; price: number }[] };
};
type Summary = { active_tenants: number; inactive_tenants: number };

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 shadow-[0_1px_2px_rgba(19,33,41,0.05)]">
      <div className="mb-3">
        <h3 className="font-serif text-base font-bold tracking-tight text-[var(--admin-ink)]">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-xs text-[var(--admin-muted)]">{subtitle}</p> : null}
      </div>
      {children}
    </div>
  );
}

function tip(fmt?: (v: number) => string) {
  return function TT({ active, payload }: any) {
    if (!active || !payload?.length) return null;
    const p = payload[0];
    const val = Number(p.value ?? 0);
    return (
      <div className="rounded-lg border border-[var(--admin-border)] bg-white px-3 py-2 text-xs shadow-md">
        <div className="font-semibold text-[var(--admin-ink)]">{p.payload?.name ?? p.name}</div>
        <div className="text-[var(--admin-muted)]">{fmt ? fmt(val) : val.toLocaleString()}</div>
      </div>
    );
  };
}

function Donut({ data, fmtLegend }: { data: { name: string; value: number; color: string }[]; fmtLegend?: (n: number) => string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <div className="flex h-[180px] items-center justify-center text-sm text-[var(--admin-muted)]">No data yet</div>;
  return (
    <div className="flex items-center gap-4">
      <div className="h-[160px] w-[160px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={2} stroke="#ffffff" strokeWidth={2}>
              {data.map((d) => <Cell key={d.name} fill={d.color} />)}
            </Pie>
            <Tooltip content={tip(fmtLegend)} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex-1 space-y-1.5">
        {data.map((d) => (
          <li key={d.name} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: d.color }} />
            <span className="flex-1 text-[var(--admin-muted)]">{d.name}</span>
            <span className="font-semibold text-[var(--admin-ink)]">{fmtLegend ? fmtLegend(d.value) : d.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Bars({ data, fmt }: { data: { name: string; value: number }[]; fmt?: (v: number) => string }) {
  if (data.length === 0) return <div className="flex h-[180px] items-center justify-center text-sm text-[var(--admin-muted)]">No plans configured</div>;
  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: 8 }}>
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
          <YAxis hide />
          <Tooltip cursor={{ fill: "#00000008" }} content={tip(fmt)} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={48}>
            {data.map((_, i) => <Cell key={i} fill={CATEGORICAL[i % CATEGORICAL.length]} />)}
            <LabelList dataKey="value" position="top" formatter={(v: number) => (fmt ? fmt(v) : v)} style={{ fontSize: 11, fontWeight: 600, fill: "#191c1d" }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DashboardCharts({ metrics, summary }: { metrics: Metrics | null; summary: Summary | null }) {
  const subs = metrics?.subscriptions;
  const plans = subs?.plans ?? [];

  const subStatus = subs
    ? [
        { name: "Active", value: subs.active, color: STATUS.active },
        { name: "Trialing", value: subs.trialing, color: STATUS.trialing },
        { name: "Past due", value: subs.past_due, color: STATUS.past_due },
        { name: "Cancelled", value: subs.cancelled, color: STATUS.cancelled },
      ].filter((d) => d.value > 0)
    : [];

  const tenantStatus = summary
    ? [
        { name: "Active", value: summary.active_tenants, color: STATUS.active },
        { name: "Inactive", value: summary.inactive_tenants, color: STATUS.inactive },
      ].filter((d) => d.value > 0)
    : [];

  const planDist = plans.map((p) => ({ name: p.name, value: p.count }));
  const planRevenue = plans.map((p) => ({ name: p.name, value: p.count * p.price }));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Subscription status" subtitle="Active, trialing, past-due & cancelled">
        <Donut data={subStatus} />
      </Card>
      <Card title="Tenant status" subtitle="Active vs inactive institutions">
        <Donut data={tenantStatus} />
      </Card>
      <Card title="Plan distribution" subtitle="Tenants on each plan">
        <Bars data={planDist} />
      </Card>
      <Card title="Revenue by plan" subtitle="Estimated recurring revenue (KES)">
        <Bars data={planRevenue} fmt={(v) => formatKes(v)} />
      </Card>
    </div>
  );
}
