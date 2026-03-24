"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { AppShell } from "@/components/layout/AppShell";
import { saasNav } from "@/components/layout/nav-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { Building2, CalendarDays, RefreshCw, Save, Send } from "lucide-react";

type SaaSAcademicCalendarTerm = {
  term_no: number;
  term_code: string;
  term_name: string;
  start_date?: string | null;
  end_date?: string | null;
  is_active: boolean;
  updated_at?: string | null;
};

type SaaSAcademicCalendarResponse = {
  academic_year: number;
  terms: SaaSAcademicCalendarTerm[];
};

type SaaSAcademicCalendarApplyResponse = {
  academic_year: number;
  tenants_targeted: number;
  affected_terms: number;
  created_terms: number;
  updated_terms: number;
  skipped_terms: number;
};

type TenantOption = {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
};

type ApplyScope = "all" | "selected";

const YEAR_MIN = 2000;
const YEAR_MAX = 2100;
const yearNow = new Date().getFullYear();
const DEFAULT_YEARS = [yearNow - 1, yearNow, yearNow + 1];

function normalizeTerms(
  year: number,
  terms: SaaSAcademicCalendarTerm[] | null | undefined
): SaaSAcademicCalendarTerm[] {
  const byNo = new Map<number, SaaSAcademicCalendarTerm>();
  for (const t of terms ?? []) {
    if (![1, 2, 3].includes(t.term_no)) continue;
    byNo.set(t.term_no, {
      term_no: t.term_no,
      term_code: String(t.term_code || `TERM_${t.term_no}_${year}`).toUpperCase(),
      term_name: String(t.term_name || `Term ${t.term_no} ${year}`),
      start_date: t.start_date || "",
      end_date: t.end_date || "",
      is_active: Boolean(t.is_active),
      updated_at: t.updated_at || null,
    });
  }

  return [1, 2, 3].map((n) => {
    const row = byNo.get(n);
    if (row) return row;
    return {
      term_no: n,
      term_code: `TERM_${n}_${year}`,
      term_name: `Term ${n} ${year}`,
      start_date: "",
      end_date: "",
      is_active: true,
      updated_at: null,
    };
  });
}

function toDateDisplay(value?: string | null) {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-KE");
}

export default function SaaSAcademicCalendarPage() {
  const [academicYear, setAcademicYear] = useState<number>(yearNow);
  const [terms, setTerms] = useState<SaaSAcademicCalendarTerm[]>(normalizeTerms(yearNow, []));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tenantOptions, setTenantOptions] = useState<TenantOption[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(true);
  const [tenantSearch, setTenantSearch] = useState("");
  const [applyScope, setApplyScope] = useState<ApplyScope>("all");
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [selectedTenantIds, setSelectedTenantIds] = useState<string[]>([]);
  const [lastApplyResult, setLastApplyResult] = useState<SaaSAcademicCalendarApplyResponse | null>(null);

  const filteredTenants = useMemo(() => {
    const q = tenantSearch.trim().toLowerCase();
    if (!q) return tenantOptions;
    return tenantOptions.filter(
      (t) => t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q)
    );
  }, [tenantOptions, tenantSearch]);

  const allFilteredSelected =
    filteredTenants.length > 0 &&
    filteredTenants.every((t) => selectedTenantIds.includes(t.id));

  const loadCalendar = useCallback(
    async (year: number, silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const data = await apiFetch<SaaSAcademicCalendarResponse>(
          `/admin/saas/academic-calendar?academic_year=${year}`,
          { method: "GET", tenantRequired: false }
        );
        setAcademicYear(Number(data.academic_year || year));
        setTerms(normalizeTerms(Number(data.academic_year || year), data.terms));
      } catch (e: any) {
        const msg = e?.message || "Failed to load academic calendar";
        setError(msg);
        toast.error(msg);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    []
  );

  const loadTenants = useCallback(async () => {
    setTenantsLoading(true);
    try {
      const data = await apiFetch<TenantOption[]>("/admin/tenants?is_active=true", {
        method: "GET",
        tenantRequired: false,
      });
      const rows = Array.isArray(data) ? data.filter((t) => t.is_active) : [];
      setTenantOptions(rows);
    } catch {
      setTenantOptions([]);
    } finally {
      setTenantsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCalendar(yearNow);
    void loadTenants();
  }, [loadCalendar, loadTenants]);

  const setTermField = useCallback(
    (termNo: number, patch: Partial<SaaSAcademicCalendarTerm>) => {
      setTerms((prev) =>
        prev.map((item) => (item.term_no === termNo ? { ...item, ...patch } : item))
      );
    },
    []
  );

  const validateTerms = useCallback((): string | null => {
    const seen = new Set<number>();
    for (const t of terms) {
      if (seen.has(t.term_no)) return "Duplicate term numbers detected.";
      seen.add(t.term_no);

      const startDate = (t.start_date || "").trim();
      const endDate = (t.end_date || "").trim();
      if (!startDate || !endDate) {
        return `Term ${t.term_no}: start date and end date are required.`;
      }
      if (endDate < startDate) {
        return `Term ${t.term_no}: end date cannot be before start date.`;
      }
    }
    return null;
  }, [terms]);

  const onSave = useCallback(async () => {
    if (academicYear < YEAR_MIN || academicYear > YEAR_MAX) {
      toast.error(`Academic year must be between ${YEAR_MIN} and ${YEAR_MAX}.`);
      return;
    }

    const validationError = validateTerms();
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setSaving(true);
    try {
      const payload = {
        academic_year: academicYear,
        terms: terms
          .slice()
          .sort((a, b) => a.term_no - b.term_no)
          .map((t) => ({
            term_no: t.term_no,
            term_code: String(t.term_code || `TERM_${t.term_no}_${academicYear}`).toUpperCase(),
            term_name: String(t.term_name || `Term ${t.term_no} ${academicYear}`).trim(),
            start_date: String(t.start_date || ""),
            end_date: String(t.end_date || ""),
            is_active: Boolean(t.is_active),
          })),
      };

      const data = await apiFetch<SaaSAcademicCalendarResponse>("/admin/saas/academic-calendar", {
        method: "PUT",
        tenantRequired: false,
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
      });

      setTerms(normalizeTerms(data.academic_year, data.terms));
      toast.success("Academic calendar saved.");
    } catch (e: any) {
      toast.error(e?.message || "Failed to save academic calendar.");
    } finally {
      setSaving(false);
    }
  }, [academicYear, terms, validateTerms]);

  const toggleTenant = useCallback((tenantId: string) => {
    setSelectedTenantIds((prev) =>
      prev.includes(tenantId) ? prev.filter((id) => id !== tenantId) : [...prev, tenantId]
    );
  }, []);

  const toggleAllFiltered = useCallback(() => {
    setSelectedTenantIds((prev) => {
      if (allFilteredSelected) {
        const filtered = new Set(filteredTenants.map((t) => t.id));
        return prev.filter((id) => !filtered.has(id));
      }
      const next = new Set(prev);
      filteredTenants.forEach((t) => next.add(t.id));
      return Array.from(next);
    });
  }, [allFilteredSelected, filteredTenants]);

  const onApply = useCallback(async () => {
    if (academicYear < YEAR_MIN || academicYear > YEAR_MAX) {
      toast.error(`Academic year must be between ${YEAR_MIN} and ${YEAR_MAX}.`);
      return;
    }
    if (applyScope === "selected" && selectedTenantIds.length === 0) {
      toast.error("Select at least one tenant or switch to Apply to all active tenants.");
      return;
    }

    setApplying(true);
    try {
      const payload: {
        academic_year: number;
        only_missing: boolean;
        tenant_ids?: string[];
      } = {
        academic_year: academicYear,
        only_missing: onlyMissing,
      };
      if (applyScope === "selected") {
        payload.tenant_ids = selectedTenantIds;
      }

      const data = await apiFetch<SaaSAcademicCalendarApplyResponse>(
        "/admin/saas/academic-calendar/apply",
        {
          method: "POST",
          tenantRequired: false,
          body: JSON.stringify(payload),
          headers: { "Content-Type": "application/json" },
        }
      );
      setLastApplyResult(data);
      toast.success("Academic calendar applied to tenant terms.");
    } catch (e: any) {
      toast.error(e?.message || "Failed to apply academic calendar to tenants.");
    } finally {
      setApplying(false);
    }
  }, [academicYear, applyScope, onlyMissing, selectedTenantIds]);

  return (
    <AppShell title="Super Admin" nav={saasNav} activeHref="/saas/academic-calendar">
      <div className="space-y-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200">
                <CalendarDays className="h-3 w-3" />
                National Calendar Control
              </div>
              <h1 className="mt-2 text-xl font-bold text-slate-900">Academic Calendar</h1>
              <p className="mt-0.5 text-sm text-slate-500">
                Define term windows once, then apply them to tenant schools for per-term billing.
              </p>
            </div>
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() => void loadCalendar(academicYear, true)}
              disabled={loading || saving}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <div className="w-full sm:w-44">
                <Label htmlFor="academic-year">Academic Year</Label>
                <Input
                  id="academic-year"
                  type="number"
                  min={YEAR_MIN}
                  max={YEAR_MAX}
                  value={academicYear}
                  onChange={(e) => setAcademicYear(Number(e.target.value || yearNow))}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {DEFAULT_YEARS.map((y) => (
                  <Button
                    key={y}
                    variant={academicYear === y ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setAcademicYear(y);
                      void loadCalendar(y);
                    }}
                  >
                    {y}
                  </Button>
                ))}
              </div>

              <Button
                variant="outline"
                className="gap-1.5"
                onClick={() => void loadCalendar(academicYear)}
              >
                <RefreshCw className="h-4 w-4" />
                Load Year
              </Button>
            </div>

            {error && (
              <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="overflow-x-auto rounded-xl border border-slate-100">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50 hover:bg-slate-50">
                    <TableHead className="w-12 sm:w-[80px] text-xs">Term</TableHead>
                    <TableHead className="min-w-[130px] sm:min-w-[180px] text-xs">Term Code</TableHead>
                    <TableHead className="min-w-[150px] sm:min-w-[220px] text-xs">Term Name</TableHead>
                    <TableHead className="min-w-[120px] sm:min-w-[160px] text-xs">Start Date</TableHead>
                    <TableHead className="min-w-[120px] sm:min-w-[160px] text-xs">End Date</TableHead>
                    <TableHead className="w-20 text-xs">Active</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading
                    ? Array.from({ length: 3 }).map((_, idx) => (
                        <TableRow key={idx}>
                          <TableCell colSpan={6}>
                            <Skeleton className="h-10 w-full" />
                          </TableCell>
                        </TableRow>
                      ))
                    : terms.map((term) => (
                        <TableRow key={term.term_no}>
                          <TableCell className="font-semibold text-slate-800">
                            Term {term.term_no}
                          </TableCell>
                          <TableCell>
                            <Input
                              value={term.term_code}
                              onChange={(e) =>
                                setTermField(term.term_no, {
                                  term_code: e.target.value.toUpperCase(),
                                })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={term.term_name}
                              onChange={(e) =>
                                setTermField(term.term_no, {
                                  term_name: e.target.value,
                                })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="date"
                              value={term.start_date || ""}
                              onChange={(e) =>
                                setTermField(term.term_no, {
                                  start_date: e.target.value,
                                })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="date"
                              value={term.end_date || ""}
                              onChange={(e) =>
                                setTermField(term.term_no, {
                                  end_date: e.target.value,
                                })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-slate-300"
                                checked={term.is_active}
                                onChange={(e) =>
                                  setTermField(term.term_no, {
                                    is_active: e.target.checked,
                                  })
                                }
                              />
                              Active
                            </label>
                          </TableCell>
                        </TableRow>
                      ))}
                </TableBody>
              </Table>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {terms.map((term) => (
                <div key={`summary-${term.term_no}`} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                  <p className="text-xs font-semibold text-slate-700">{term.term_name || `Term ${term.term_no}`}</p>
                  <p className="text-xs text-slate-500">
                    {toDateDisplay(term.start_date)} - {toDateDisplay(term.end_date)}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-500">
                Save once per year, then apply to active tenants to keep billing terms aligned.
              </p>
              <Button className="gap-1.5" onClick={() => void onSave()} disabled={saving || loading}>
                <Save className="h-4 w-4" />
                {saving ? "Saving..." : "Save Calendar"}
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-slate-500" />
              <h2 className="text-sm font-semibold text-slate-900">Apply to Tenants</h2>
            </div>
            <p className="mb-4 text-xs text-slate-500">
              Push this year&apos;s term windows into each tenant&apos;s term setup.
            </p>

            <div className="space-y-3">
              <div>
                <Label className="text-xs text-slate-500">Target Scope</Label>
                <Select
                  value={applyScope}
                  onValueChange={(v) => {
                    setApplyScope(v as ApplyScope);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All active tenants</SelectItem>
                    <SelectItem value="selected">Only selected tenants</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300"
                  checked={onlyMissing}
                  onChange={(e) => setOnlyMissing(e.target.checked)}
                />
                Only add missing terms (do not overwrite existing)
              </label>

              {applyScope === "selected" && (
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <Input
                      placeholder="Search tenant..."
                      value={tenantSearch}
                      onChange={(e) => setTenantSearch(e.target.value)}
                      className="h-8"
                    />
                    <Button variant="outline" size="sm" onClick={toggleAllFiltered} disabled={tenantsLoading}>
                      {allFilteredSelected ? "Unselect" : "Select"} all
                    </Button>
                  </div>

                  <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                    {tenantsLoading && <Skeleton className="h-8 w-full" />}
                    {!tenantsLoading && filteredTenants.length === 0 && (
                      <p className="px-1 py-4 text-center text-xs text-slate-400">No tenants found.</p>
                    )}
                    {!tenantsLoading &&
                      filteredTenants.map((t) => {
                        const checked = selectedTenantIds.includes(t.id);
                        return (
                          <label
                            key={t.id}
                            className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition ${
                              checked ? "bg-blue-50 text-blue-700" : "hover:bg-slate-50"
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-slate-300"
                              checked={checked}
                              onChange={() => toggleTenant(t.id)}
                            />
                            <span className="truncate">{t.name}</span>
                            <span className="ml-auto truncate text-xs text-slate-400">{t.slug}</span>
                          </label>
                        );
                      })}
                  </div>
                  <p className="mt-2 text-xs text-slate-500">{selectedTenantIds.length} selected</p>
                </div>
              )}
            </div>

            <Button className="mt-4 w-full gap-1.5" onClick={() => void onApply()} disabled={applying || saving}>
              <Send className="h-4 w-4" />
              {applying ? "Applying..." : "Apply to Tenants"}
            </Button>

            {lastApplyResult && (
              <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-sm font-semibold text-emerald-800">Last Apply Result</p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-emerald-700">
                  <div>Tenants: {lastApplyResult.tenants_targeted}</div>
                  <div>Affected: {lastApplyResult.affected_terms}</div>
                  <div>Created: {lastApplyResult.created_terms}</div>
                  <div>Updated: {lastApplyResult.updated_terms}</div>
                  <div>Skipped: {lastApplyResult.skipped_terms}</div>
                  <div>Year: {lastApplyResult.academic_year}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
