"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Building2,
  Users,
  Wallet,
  AlertTriangle,
  RefreshCw,
  Loader2,
  Layers,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
} from "recharts";
import { apiFetch } from "@/lib/api";
import { AppShell } from "@/components/layout/AppShell";
import { directorNav } from "@/components/layout/nav-config";
import { DashboardStatCard } from "@/components/dashboard/dashboard-primitives";
import { Button } from "@/components/ui/button";

type Campus = {
  tenant_id: string;
  name: string;
  slug: string;
  students: number;
  billed: number;
  collected: number;
  outstanding: number;
  collection_rate_pct: number;
};

type GroupDashboard = {
  grouped: boolean;
  group?: {
    name: string;
    slug: string;
    plan_name: string | null;
    state: "active" | "grace" | "locked";
    period_end: string | null;
  };
  totals?: {
    campuses: number;
    students: number;
    billed: number;
    collected: number;
    outstanding: number;
    collection_rate_pct: number;
  };
  campuses?: Campus[];
};

function kes(n: number): string {
  return `KES ${Math.round(n).toLocaleString("en-KE")}`;
}

const STATE_STYLES: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  grace: "bg-amber-50 text-amber-700 ring-amber-200",
  locked: "bg-red-50 text-red-700 ring-red-200",
};

export default function GroupOverviewPage() {
  const [data, setData] = useState<GroupDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await apiFetch<GroupDashboard>("/director/group-dashboard", {
        tenantRequired: true,
      } as never);
      setData(d ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the group overview.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const campuses = data?.campuses ?? [];
  const chartData = campuses.map((c) => ({
    name: c.name.length > 16 ? `${c.name.slice(0, 15)}…` : c.name,
    Billed: Math.round(c.billed),
    Collected: Math.round(c.collected),
  }));

  return (
    <AppShell title="Director" nav={directorNav} activeHref="/tenant/director/group">
      <div className="space-y-5">
        {/* ── Header ── */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-800">Group Overview</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Consolidated performance across every campus in your group.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {loading && (
          <div className="flex items-center justify-center rounded-2xl border border-slate-100 bg-white py-20 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        )}

        {!loading && error && (
          <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        )}

        {!loading && !error && data && !data.grouped && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-white py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
              <Building2 className="h-6 w-6 text-slate-300" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-600">
                This school isn&rsquo;t part of a group
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                Multi-campus overview is available for schools in an Enterprise group.
              </p>
            </div>
          </div>
        )}

        {!loading && !error && data?.grouped && data.totals && data.group && (
          <>
            {/* ── Group identity + subscription ── */}
            <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-800 to-slate-700 px-6 py-5 text-white sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10">
                  <Building2 className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-lg font-bold">{data.group.name}</div>
                  <div className="font-mono text-xs text-slate-300">{data.group.slug}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium">
                  <Layers className="h-3.5 w-3.5" />
                  {data.group.plan_name ?? "No tier"}
                </span>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ring-1 ring-inset ${
                    STATE_STYLES[data.group.state] ?? STATE_STYLES.active
                  }`}
                >
                  {data.group.state}
                </span>
              </div>
            </div>

            {/* ── KPI cards ── */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <DashboardStatCard
                label="Campuses"
                value={data.totals.campuses}
                sub="Schools in this group"
                icon={Building2}
                tone="accent"
              />
              <DashboardStatCard
                label="Students"
                value={data.totals.students.toLocaleString("en-KE")}
                sub="Across all campuses"
                icon={Users}
                tone="secondary"
              />
              <DashboardStatCard
                label="Collected"
                value={kes(data.totals.collected)}
                sub={`${data.totals.collection_rate_pct}% of billed`}
                icon={Wallet}
                tone="sage"
              />
              <DashboardStatCard
                label="Outstanding"
                value={kes(data.totals.outstanding)}
                sub="Fees still due"
                icon={AlertTriangle}
                tone="warning"
              />
            </div>

            {/* ── Chart: billed vs collected by campus ── */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-700">
                Billed vs Collected by campus
              </h2>
              {chartData.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-400">No campus data.</p>
              ) : (
                <div className="mt-4 h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eef2f5" vertical={false} />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        tickLine={false}
                        axisLine={{ stroke: "#e2e8f0" }}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
                      />
                      <Tooltip
                        formatter={(v: number) => kes(Number(v))}
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="Billed" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Collected" fill="#0d9488" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* ── Per-campus table ── */}
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-5 py-3">
                <h2 className="text-sm font-semibold text-slate-700">Campus breakdown</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                      <th className="px-5 py-2.5">Campus</th>
                      <th className="px-3 py-2.5 text-right">Students</th>
                      <th className="px-3 py-2.5 text-right">Billed</th>
                      <th className="px-3 py-2.5 text-right">Collected</th>
                      <th className="px-3 py-2.5 text-right">Outstanding</th>
                      <th className="px-5 py-2.5 text-right">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campuses.map((c) => (
                      <tr key={c.tenant_id} className="border-b border-slate-50 last:border-0">
                        <td className="px-5 py-3">
                          <div className="font-medium text-slate-800">{c.name}</div>
                          <div className="font-mono text-[11px] text-slate-400">{c.slug}</div>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-600">
                          {c.students.toLocaleString("en-KE")}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-600">
                          {kes(c.billed)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums font-medium text-slate-800">
                          {kes(c.collected)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-amber-700">
                          {kes(c.outstanding)}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span
                            className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${
                              c.collection_rate_pct >= 75
                                ? "bg-emerald-50 text-emerald-700"
                                : c.collection_rate_pct >= 40
                                  ? "bg-amber-50 text-amber-700"
                                  : "bg-red-50 text-red-700"
                            }`}
                          >
                            {c.collection_rate_pct}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {campuses.length > 0 && (
                    <tfoot>
                      <tr className="border-t border-slate-200 bg-slate-50 font-semibold text-slate-800">
                        <td className="px-5 py-3">Group total</td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {data.totals.students.toLocaleString("en-KE")}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {kes(data.totals.billed)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {kes(data.totals.collected)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-amber-700">
                          {kes(data.totals.outstanding)}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {data.totals.collection_rate_pct}%
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
