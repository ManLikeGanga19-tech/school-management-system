"use client";

import * as React from "react";
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  RadialBar,
  RadialBarChart,
  Tooltip,
  TooltipProps,
  ResponsiveContainer,
  XAxis,
  YAxis,
  PolarAngleAxis,
  Legend,
  LabelList,
} from "recharts";

import { formatKes } from "@/lib/format";

/*
 * Enterprise dashboard chart kit.
 *
 * Used by both the secretary and director dashboards so the visual language
 * (palette, gradients, tooltips, empty states) stays consistent. All charts
 * render inside ResponsiveContainer; the parent picks the height. None of
 * these components fetch or transform data — they take the exact shape the
 * `/director/kpis` and `/tenants/secretary/dashboard` endpoints return.
 */

// ── Shared palette (matches dashboard-primitives tones) ─────────────────────

// Warm-anchored, CVD-safe palette (validated with the dataviz validator). The
// warm cards/shell carry the gold/orange identity; charts still need distinct
// hues, so semantic series map to a validated categorical set. Neutral "gray"
// is reserved for unspecified/other.
export const CHART_PALETTE = {
  male: "#2a78d6",
  maleSoft: "#cde2fb",
  female: "#eb6834",
  femaleSoft: "#fbd9c8",
  unspecified: "#a8a29e",
  unspecifiedSoft: "#e7e1d8",
  billed: "#eb6834",
  collected: "#1baf7a",
  outstanding: "#e34948",
  ink: "#1c1710",
  muted: "#78716c",
  grid: "#efe9df",
} as const;

const CLASS_COLORS = [
  "#2a78d6", "#eb6834", "#1baf7a", "#eda100",
  "#e87ba4", "#008300", "#4a3aa7", "#e34948",
];

const PROVIDER_COLORS: Record<string, string> = {
  MPESA: "#1baf7a",
  CASH: "#eb6834",
  BANK: "#2a78d6",
  CHEQUE: "#4a3aa7",
  OTHER: "#a8a29e",
};

// ── Helpers ────────────────────────────────────────────────────────────────

function compactCurrency(value: number) {
  if (value >= 1_000_000) return `KES ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `KES ${(value / 1_000).toFixed(1)}k`;
  return formatKes(value);
}

function EmptyState({ message, height = 220 }: { message: string; height?: number }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/40 text-center text-sm text-slate-400"
      style={{ height }}
    >
      {message}
    </div>
  );
}

type CardTooltipFormatter = (entry: {
  name: string;
  value: number;
  color: string;
}) => React.ReactNode;

function CardTooltip({
  active,
  payload,
  label,
  formatValue,
}: TooltipProps<number, string> & {
  formatValue?: CardTooltipFormatter;
}) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
      {label != null && (
        <div className="mb-1 font-semibold text-slate-700">{String(label)}</div>
      )}
      <div className="space-y-1">
        {payload.map((entry, i) => (
          <div key={i} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: (entry.color as string) ?? "#94a3b8" }}
              />
              <span className="capitalize text-slate-500">
                {String(entry.name ?? "")}
              </span>
            </div>
            <span className="font-semibold text-slate-800">
              {formatValue
                ? formatValue({
                    name: String(entry.name ?? ""),
                    value: Number(entry.value ?? 0),
                    color: (entry.color as string) ?? "#94a3b8",
                  })
                : entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Demographics donut (secretary + director) ──────────────────────────────

export type DemographicsData = {
  total_students: number;
  male_count: number;
  female_count: number;
  unspecified_count: number;
  male_pct: number;
  female_pct: number;
  unspecified_pct: number;
};

export function DemographicsDonut({
  data,
  height = 240,
}: {
  data: DemographicsData | null | undefined;
  height?: number;
}) {
  if (!data || data.total_students === 0) {
    return <EmptyState message="No student records yet" height={height} />;
  }
  const rows = [
    { key: "male",        name: "Boys",        value: data.male_count,        fill: CHART_PALETTE.male },
    { key: "female",      name: "Girls",       value: data.female_count,      fill: CHART_PALETTE.female },
    { key: "unspecified", name: "Unspecified", value: data.unspecified_count, fill: CHART_PALETTE.unspecified },
  ].filter((row) => row.value > 0);

  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <defs>
            <linearGradient id="grad-male" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%"  stopColor={CHART_PALETTE.male}     stopOpacity={1}    />
              <stop offset="100%" stopColor={CHART_PALETTE.male}    stopOpacity={0.75} />
            </linearGradient>
            <linearGradient id="grad-female" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%"  stopColor={CHART_PALETTE.female}   stopOpacity={1}    />
              <stop offset="100%" stopColor={CHART_PALETTE.female}  stopOpacity={0.75} />
            </linearGradient>
            <linearGradient id="grad-unspecified" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%"  stopColor={CHART_PALETTE.unspecified} stopOpacity={1} />
              <stop offset="100%" stopColor={CHART_PALETTE.unspecified} stopOpacity={0.6} />
            </linearGradient>
          </defs>
          <Tooltip
            content={
              <CardTooltip
                formatValue={(e) =>
                  `${e.value.toLocaleString()} (${Math.round((e.value / data.total_students) * 100)}%)`
                }
              />
            }
          />
          <Pie
            data={rows}
            innerRadius="62%"
            outerRadius="92%"
            paddingAngle={2}
            dataKey="value"
            nameKey="name"
            stroke="#ffffff"
            strokeWidth={3}
          >
            {rows.map((r) => (
              <Cell key={r.key} fill={`url(#grad-${r.key})`} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-3xl font-bold text-[var(--tenant-ink)]">
          {data.total_students.toLocaleString()}
        </div>
        <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--tenant-muted)]">
          Total students
        </div>
      </div>
    </div>
  );
}

export function DemographicsLegend({ data }: { data: DemographicsData }) {
  const items = [
    { name: "Boys",        count: data.male_count,        pct: data.male_pct,        color: CHART_PALETTE.male },
    { name: "Girls",       count: data.female_count,      pct: data.female_pct,      color: CHART_PALETTE.female },
    { name: "Unspecified", count: data.unspecified_count, pct: data.unspecified_pct, color: CHART_PALETTE.unspecified },
  ].filter((i) => i.count > 0);
  return (
    <div className="space-y-2">
      {items.map((it) => (
        <div key={it.name} className="flex items-center justify-between gap-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: it.color }} />
            <span className="text-[var(--tenant-muted)]">{it.name}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-semibold text-[var(--tenant-ink)]">{it.count.toLocaleString()}</span>
            <span className="text-xs text-[var(--tenant-muted)]">{it.pct}%</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Collection-rate gauge (director) ────────────────────────────────────────

export function CollectionRateGauge({
  ratePct,
  billed,
  collected,
  height = 200,
}: {
  ratePct: number;
  billed: number;
  collected: number;
  height?: number;
}) {
  const clamped = Math.max(0, Math.min(100, ratePct));
  const fill =
    clamped >= 80 ? "#1baf7a" : clamped >= 50 ? "#eda100" : "#e34948";
  return (
    <div>
      {/* Arc holds only the headline % — the amount caption sits below it, so
          nothing renders behind the curve. */}
      <div className="relative mx-auto" style={{ height, maxWidth: Math.round(height * 1.7) }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            innerRadius="70%"
            outerRadius="100%"
            data={[{ name: "Collection rate", value: clamped, fill }]}
            startAngle={210}
            endAngle={-30}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar
              background={{ fill: CHART_PALETTE.grid }}
              dataKey="value"
              cornerRadius={12}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-3xl font-bold leading-none" style={{ color: fill }}>
            {clamped}%
          </div>
          <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--tenant-muted)]">
            Collected
          </div>
        </div>
      </div>
      <p className="mt-2 text-center text-xs text-[var(--tenant-muted)]">
        <span className="font-semibold text-[var(--tenant-ink)]">{compactCurrency(collected)}</span> of {compactCurrency(billed)} collected
      </p>
    </div>
  );
}

// ── Per-class billed vs collected (director) ────────────────────────────────

export type FinanceByClassRow = {
  class_code: string;
  billed: number;
  collected: number;
  outstanding: number;
  invoice_count: number;
};

export function FinanceByClassChart({
  rows,
  height = 280,
}: {
  rows: FinanceByClassRow[];
  height?: number;
}) {
  if (!rows.length) return <EmptyState message="No invoices issued yet" height={height} />;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="bar-billed" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={CHART_PALETTE.billed} stopOpacity={0.95} />
              <stop offset="100%" stopColor={CHART_PALETTE.billed} stopOpacity={0.55} />
            </linearGradient>
            <linearGradient id="bar-collected" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={CHART_PALETTE.collected} stopOpacity={0.95} />
              <stop offset="100%" stopColor={CHART_PALETTE.collected} stopOpacity={0.55} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={CHART_PALETTE.grid} vertical={false} />
          <XAxis
            dataKey="class_code"
            tick={{ fontSize: 11, fill: CHART_PALETTE.muted }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tickFormatter={(v) => compactCurrency(Number(v))}
            tick={{ fontSize: 11, fill: CHART_PALETTE.muted }}
            tickLine={false}
            axisLine={false}
            width={80}
          />
          <Tooltip
            cursor={{ fill: "rgba(23,63,73,0.04)" }}
            content={<CardTooltip formatValue={(e) => compactCurrency(e.value ?? 0)} />}
          />
          <Legend
            iconType="circle"
            wrapperStyle={{ fontSize: 12, color: CHART_PALETTE.muted, paddingTop: 8 }}
          />
          <Bar dataKey="billed"    name="Billed"    fill="url(#bar-billed)"    radius={[6, 6, 0, 0]} />
          <Bar dataKey="collected" name="Collected" fill="url(#bar-collected)" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Per-term trend (director) ──────────────────────────────────────────────

export type FinanceByTermRow = {
  academic_year: number;
  term_number: number;
  label: string;
  billed: number;
  collected: number;
  outstanding: number;
  invoice_count: number;
};

export function FinanceByTermChart({
  rows,
  height = 280,
}: {
  rows: FinanceByTermRow[];
  height?: number;
}) {
  if (!rows.length) return <EmptyState message="No tagged terms yet" height={height} />;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="term-billed" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={CHART_PALETTE.billed} stopOpacity={0.9} />
              <stop offset="100%" stopColor={CHART_PALETTE.billed} stopOpacity={0.45} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={CHART_PALETTE.grid} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: CHART_PALETTE.muted }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tickFormatter={(v) => compactCurrency(Number(v))}
            tick={{ fontSize: 11, fill: CHART_PALETTE.muted }}
            tickLine={false}
            axisLine={false}
            width={80}
          />
          <Tooltip
            cursor={{ fill: "rgba(23,63,73,0.04)" }}
            content={<CardTooltip formatValue={(e) => compactCurrency(e.value ?? 0)} />}
          />
          <Legend
            iconType="circle"
            wrapperStyle={{ fontSize: 12, color: CHART_PALETTE.muted, paddingTop: 8 }}
          />
          <Bar dataKey="billed" name="Billed" fill="url(#term-billed)" radius={[6, 6, 0, 0]} barSize={28} />
          <Line
            dataKey="collected"
            name="Collected"
            stroke={CHART_PALETTE.collected}
            strokeWidth={2.5}
            dot={{ r: 4, strokeWidth: 2, fill: "#fff" }}
            activeDot={{ r: 6 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Per-provider donut (director) ──────────────────────────────────────────

export type FinanceByProviderRow = {
  provider: string;
  payment_count: number;
  amount: number;
};

export function FinanceByProviderChart({
  rows,
  height = 260,
}: {
  rows: FinanceByProviderRow[];
  height?: number;
}) {
  if (!rows.length) return <EmptyState message="No payments recorded yet" height={height} />;
  const total = rows.reduce((acc, r) => acc + r.amount, 0);
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip
              content={
                <CardTooltip
                  formatValue={(e) => {
                    const pct = total ? Math.round((e.value / total) * 100) : 0;
                    return `${compactCurrency(e.value)} (${pct}%)`;
                  }}
                />
              }
            />
            <Pie
              data={rows}
              dataKey="amount"
              nameKey="provider"
              innerRadius="55%"
              outerRadius="90%"
              paddingAngle={2}
              stroke="#ffffff"
              strokeWidth={3}
            >
              {rows.map((r) => (
                <Cell
                  key={r.provider}
                  fill={PROVIDER_COLORS[r.provider] ?? PROVIDER_COLORS.OTHER}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-col justify-center gap-2">
        {rows.map((r) => {
          const pct = total ? Math.round((r.amount / total) * 100) : 0;
          return (
            <div key={r.provider} className="rounded-lg border border-slate-100 bg-white px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: PROVIDER_COLORS[r.provider] ?? PROVIDER_COLORS.OTHER }}
                  />
                  <span className="text-sm font-medium text-slate-700">{r.provider}</span>
                </div>
                <span className="text-xs text-slate-400">{pct}%</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                <span>{r.payment_count.toLocaleString()} payments</span>
                <span className="font-semibold text-slate-700">{compactCurrency(r.amount)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Top-N outstanding (director, horizontal bar with money labels) ─────────

export type TopOutstandingRow = {
  student_id: string | null;
  student_name: string;
  admission_no: string | null;
  class_code: string | null;
  outstanding: number;
  invoice_count: number;
};

export function TopOutstandingChart({
  rows,
  height = 320,
}: {
  rows: TopOutstandingRow[];
  height?: number;
}) {
  if (!rows.length) {
    return <EmptyState message="No outstanding balances — every invoice is settled." height={height} />;
  }
  const top = rows.slice(0, 8);
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={top}
          layout="vertical"
          margin={{ top: 6, right: 56, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="bar-outstanding" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%"   stopColor={CHART_PALETTE.outstanding} stopOpacity={0.95} />
              <stop offset="100%" stopColor={CHART_PALETTE.outstanding} stopOpacity={0.55} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={CHART_PALETTE.grid} horizontal={false} />
          <XAxis
            type="number"
            tickFormatter={(v) => compactCurrency(Number(v))}
            tick={{ fontSize: 11, fill: CHART_PALETTE.muted }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="student_name"
            tick={{ fontSize: 11, fill: CHART_PALETTE.ink }}
            tickLine={false}
            axisLine={false}
            width={170}
          />
          <Tooltip
            cursor={{ fill: "rgba(162,77,53,0.06)" }}
            content={
              <CardTooltip
                formatValue={(e) => compactCurrency(e.value)}
              />
            }
          />
          <Bar dataKey="outstanding" name="Outstanding" fill="url(#bar-outstanding)" radius={[0, 8, 8, 0]}>
            <LabelList
              dataKey="outstanding"
              position="right"
              formatter={(v: number) => compactCurrency(Number(v))}
              fill={CHART_PALETTE.outstanding}
              fontSize={11}
              fontWeight={600}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Class palette getter (exported for reuse) ──────────────────────────────

export function classColor(index: number): string {
  return CLASS_COLORS[index % CLASS_COLORS.length];
}
