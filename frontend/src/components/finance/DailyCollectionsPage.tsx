"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Download, Loader2, RefreshCw, TrendingUp } from "lucide-react";

import { api } from "@/lib/api";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { formatKes, toNumber } from "@/components/finance/finance-utils";

// ── Types ────────────────────────────────────────────────────────────────────

type DayRow = {
  date: string;
  by_provider: Record<string, string>;
  total: string;
  count: number;
};

type DailyCollections = {
  date_from: string;
  date_to: string;
  timezone: string;
  currency: string;
  providers: string[];
  days: DayRow[];
  totals: {
    by_provider: Record<string, string>;
    total: string;
    count: number;
  };
};

const PROVIDER_LABELS: Record<string, string> = {
  MPESA: "M-Pesa",
  CASH: "Cash",
  BANK: "Bank",
  CHEQUE: "Cheque",
  OTHER: "Other",
};

function providerLabel(code: string): string {
  return PROVIDER_LABELS[code] ?? code;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtDay(iso: string): string {
  try {
    return new Date(`${iso}T00:00:00`).toLocaleDateString("en-KE", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export function DailyCollectionsPage() {
  const today = new Date();
  const thirtyAgo = new Date();
  thirtyAgo.setDate(today.getDate() - 29);

  const [dateFrom, setDateFrom] = useState(ymd(thirtyAgo));
  const [dateTo, setDateTo] = useState(ymd(today));
  const [data, setData] = useState<DailyCollections | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (from: string, to: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<DailyCollections>(
        `/finance/daily-collections?date_from=${encodeURIComponent(from)}&date_to=${encodeURIComponent(to)}`,
        { tenantRequired: true }
      );
      setData(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load daily collections.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(dateFrom, dateTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const providers = data?.providers ?? [];
  // Only show days that had activity, plus keep the range totals honest.
  const activeDays = (data?.days ?? []).filter((d) => toNumber(d.total) > 0 || d.count > 0);

  function exportCsv() {
    if (!data) return;
    // Same shape/formatting as the finance Invoices export: "(KES)" money
    // columns, raw 2-decimal amounts, "" escaping, name-period.csv filename.
    const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const money = (v: string | number) => toNumber(v).toFixed(2);
    const headers = [
      "Date",
      ...providers.map((p) => `${providerLabel(p)} (KES)`),
      "Total (KES)",
      "Payments",
    ];
    const body = activeDays.map((d) =>
      [
        d.date,
        ...providers.map((p) => money(d.by_provider[p] ?? 0)),
        money(d.total),
        String(d.count),
      ]
        .map((c) => csvCell(String(c)))
        .join(",")
    );
    const totalRow = [
      "TOTAL",
      ...providers.map((p) => money(data.totals.by_provider[p] ?? 0)),
      money(data.totals.total),
      String(data.totals.count),
    ]
      .map((c) => csvCell(String(c)))
      .join(",");
    const content = [headers.map(csvCell).join(","), ...body, totalRow].join("\n");
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `daily-collections-${data.date_from}_to_${data.date_to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV export started.");
  }

  const grandTotal = toNumber(data?.totals.total ?? 0);
  const grandCount = data?.totals.count ?? 0;
  const dayCount = activeDays.length;
  const avgPerActiveDay = dayCount > 0 ? grandTotal / dayCount : 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <CalendarDays className="h-5 w-5 shrink-0 text-[var(--tenant-primary)]" />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-[var(--tenant-ink)]">Daily Collections</h1>
            <p className="text-xs text-[var(--tenant-muted)]">
              Cash collected per day, by method. Reversed payments are excluded
              {data ? ` · ${data.timezone}` : ""}.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(dateFrom, dateTo)}
            className="flex-1 sm:flex-none"
            disabled={loading}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={exportCsv}
            className="flex-1 sm:flex-none"
            disabled={!data || activeDays.length === 0}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Date range */}
      <div className="rounded-xl border border-[var(--tenant-border)] bg-[var(--tenant-surface)] p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div>
            <Label className="text-xs text-[var(--tenant-muted)]">From</Label>
            <Input
              type="date"
              className="mt-1"
              value={dateFrom}
              max={dateTo}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs text-[var(--tenant-muted)]">To</Label>
            <Input
              type="date"
              className="mt-1"
              value={dateTo}
              min={dateFrom}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <Button
            onClick={() => void load(dateFrom, dateTo)}
            disabled={loading}
            className="w-full sm:w-auto"
          >
            {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            Apply
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Summary cards */}
      {data && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-[var(--tenant-border)] bg-[var(--tenant-surface)] p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--tenant-muted)]">
              Collected in range
            </p>
            <p className="mt-1 text-2xl font-bold text-[var(--tenant-primary)]">{formatKes(grandTotal)}</p>
            <p className="mt-0.5 text-xs text-[var(--tenant-muted)]">
              {grandCount} payment{grandCount === 1 ? "" : "s"}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--tenant-border)] bg-[var(--tenant-surface)] p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--tenant-muted)]">
              Days with collections
            </p>
            <p className="mt-1 text-2xl font-bold text-[var(--tenant-ink)]">{dayCount}</p>
            <p className="mt-0.5 text-xs text-[var(--tenant-muted)]">
              {fmtDay(data.date_from)} → {fmtDay(data.date_to)}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--tenant-border)] bg-[var(--tenant-surface)] p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--tenant-muted)]">
              Avg per active day
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-2xl font-bold text-[var(--tenant-ink)]">
              <TrendingUp className="h-5 w-5 text-[var(--tenant-primary)]" />
              {formatKes(avgPerActiveDay)}
            </p>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-[var(--tenant-border)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--tenant-surface-2)] text-left text-xs font-semibold uppercase tracking-wide text-[var(--tenant-muted)]">
                <th className="px-4 py-3 whitespace-nowrap">Date</th>
                {providers.map((p) => (
                  <th key={p} className="px-4 py-3 text-right whitespace-nowrap">
                    {providerLabel(p)}
                  </th>
                ))}
                <th className="px-4 py-3 text-right whitespace-nowrap">Total</th>
                <th className="px-4 py-3 text-right whitespace-nowrap">Payments</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={providers.length + 3} className="py-10 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-[var(--tenant-muted)]" />
                  </td>
                </tr>
              )}

              {!loading && activeDays.length === 0 && (
                <tr>
                  <td
                    colSpan={providers.length + 3}
                    className="py-10 text-center text-sm text-[var(--tenant-muted)]"
                  >
                    No collections in this range.
                  </td>
                </tr>
              )}

              {!loading &&
                activeDays.map((d) => (
                  <tr
                    key={d.date}
                    className="border-t border-[var(--tenant-border)] hover:bg-[var(--tenant-surface-2)]"
                  >
                    <td className="px-4 py-3 whitespace-nowrap font-medium text-[var(--tenant-ink)]">
                      {fmtDay(d.date)}
                    </td>
                    {providers.map((p) => {
                      const v = toNumber(d.by_provider[p] ?? 0);
                      return (
                        <td
                          key={p}
                          className={`px-4 py-3 text-right tabular-nums ${
                            v > 0 ? "text-[var(--tenant-ink)]" : "text-[var(--tenant-muted)]"
                          }`}
                        >
                          {v > 0 ? formatKes(v) : "—"}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-emerald-700">
                      {formatKes(toNumber(d.total))}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--tenant-muted)]">
                      {d.count}
                    </td>
                  </tr>
                ))}
            </tbody>
            {!loading && data && activeDays.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-[var(--tenant-border)] bg-[var(--tenant-surface-2)] font-semibold text-[var(--tenant-ink)]">
                  <td className="px-4 py-3">Total</td>
                  {providers.map((p) => (
                    <td key={p} className="px-4 py-3 text-right tabular-nums">
                      {formatKes(toNumber(data.totals.by_provider[p] ?? 0))}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-700">
                    {formatKes(grandTotal)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{grandCount}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
