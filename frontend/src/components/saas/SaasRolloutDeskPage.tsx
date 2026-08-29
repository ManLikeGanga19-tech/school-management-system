"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePersistedState } from "@/lib/usePersistedState";
import {
  Building2, CalendarClock, Globe2, Mail, Phone, RefreshCw, Rocket, Search,
  ShieldCheck, Inbox,
} from "lucide-react";

import { AdminShell } from "@/components/admin/AdminShell";
import { DashboardStatCard, dashboardBadgeClasses } from "@/components/admin/admin-primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/sonner";

type RolloutStatus = "NEW" | "CONTACTING" | "SCHEDULED" | "CLOSED";
type RolloutType = "ALL" | "DEMO" | "ENQUIRY" | "SCHOOL_VISIT";

type RolloutRequest = {
  id: string;
  account_id: string;
  request_type: Exclude<RolloutType, "ALL">;
  status: RolloutStatus;
  organization_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone?: string | null;
  student_count?: number | null;
  preferred_contact_method?: string | null;
  preferred_contact_window?: string | null;
  requested_domain?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
};

type RolloutCounts = { total: number; new: number; contacting: number; scheduled: number; closed: number };
type RolloutResponse = { items: RolloutRequest[]; total: number; counts: RolloutCounts };

function formatType(value: string) {
  return value.toLowerCase().split("_").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-KE", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function statusBadge(status: RolloutStatus) {
  if (status === "NEW") return dashboardBadgeClasses("warning");
  if (status === "CONTACTING") return dashboardBadgeClasses("secondary");
  if (status === "SCHEDULED") return dashboardBadgeClasses("sage");
  return dashboardBadgeClasses("neutral");
}

function statusDot(status: RolloutStatus) {
  if (status === "NEW") return "bg-[var(--admin-gold)]";
  if (status === "CONTACTING") return "bg-[var(--admin-slate)]";
  if (status === "SCHEDULED") return "bg-[var(--admin-success)]";
  return "bg-[var(--admin-muted)]";
}

export function SaasRolloutDeskPage() {
  const [query, setQuery] = usePersistedState("saas.rollout.query", "");
  const [status, setStatus] = usePersistedState<RolloutStatus | "ALL">("saas.rollout.status", "ALL");
  const [requestType, setRequestType] = useState<RolloutType>("ALL");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingId, setUpdatingId] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [data, setData] = useState<RolloutResponse>({
    items: [], total: 0, counts: { total: 0, new: 0, contacting: 0, scheduled: 0, closed: 0 },
  });

  const loadDesk = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", "40");
      params.set("offset", "0");
      if (query.trim()) params.set("q", query.trim());
      if (status !== "ALL") params.set("status", status);
      if (requestType !== "ALL") params.set("request_type", requestType);
      const res = await api.get<RolloutResponse>(`/admin/saas/rollout/requests?${params.toString()}`, { tenantRequired: false });
      setData(res);
    } catch (err: any) {
      toast.error(typeof err?.message === "string" ? err.message : "Failed to load rollout desk");
    } finally {
      if (!silent) setLoading(false);
      setRefreshing(false);
    }
  }, [query, requestType, status]);

  useEffect(() => { void loadDesk(); }, [loadDesk]);

  // Keep a valid selection as the list changes (auto-select first).
  useEffect(() => {
    if (data.items.length === 0) { setSelectedId(null); return; }
    setSelectedId((cur) => (cur && data.items.some((i) => i.id === cur) ? cur : data.items[0].id));
  }, [data.items]);

  const activeSummary = useMemo(
    () => [
      { label: "New intake", value: data.counts.new, tone: "warning" as const, icon: Rocket },
      { label: "Contacting", value: data.counts.contacting, tone: "secondary" as const, icon: Mail },
      { label: "Scheduled", value: data.counts.scheduled, tone: "sage" as const, icon: CalendarClock },
      { label: "Closed", value: data.counts.closed, tone: "neutral" as const, icon: ShieldCheck },
    ],
    [data.counts]
  );

  async function updateStatus(id: string, nextStatus: RolloutStatus) {
    setUpdatingId(id);
    try {
      const updated = await api.patch<RolloutRequest>(`/admin/saas/rollout/requests/${id}`, { status: nextStatus }, { tenantRequired: false });
      setData((current) => ({ ...current, items: current.items.map((item) => (item.id === id ? updated : item)) }));
      await loadDesk(true);
      toast.success(`Rollout request moved to ${formatType(nextStatus)}.`);
    } catch (err: any) {
      toast.error(typeof err?.message === "string" ? err.message : "Failed to update rollout request");
    } finally {
      setUpdatingId("");
    }
  }

  const selected = data.items.find((r) => r.id === selectedId) ?? null;

  return (
    <AdminShell title="Super Admin" activeHref="/saas/rollout">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-md bg-[var(--admin-primary)] px-2.5 py-0.5 text-xs font-semibold text-white">
              <Rocket className="h-3 w-3 text-[var(--admin-gold)]" /> Rollout Desk
            </span>
            <h1 className="font-serif mt-2 text-2xl font-bold tracking-tight text-[var(--admin-ink)]">Prospect onboarding pipeline</h1>
            <p className="mt-1 text-sm text-[var(--admin-muted)]">Triage public demo, enquiry &amp; school-visit requests before onboarding them as tenants.</p>
          </div>
          <Button
            variant="outline"
            className="border-[var(--admin-border)] bg-white text-[var(--admin-ink)] hover:bg-[var(--admin-surface-2)]"
            onClick={() => void loadDesk(true)}
            disabled={refreshing}
          >
            <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {activeSummary.map((item) => (
            <DashboardStatCard key={item.label} label={item.label} value={item.value} icon={item.icon} tone={item.tone} />
          ))}
        </div>

        {/* Two-pane inbox */}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:items-start">
          {/* LEFT — request list */}
          <div className="flex flex-col overflow-hidden rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] shadow-[0_1px_2px_rgba(19,33,41,0.05)]">
            <div className="space-y-2 border-b border-[var(--admin-border)] p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--admin-muted)]" />
                <Input className="h-9 pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search organizations, contacts…" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Select value={requestType} onValueChange={(v) => setRequestType(v as RolloutType)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All types</SelectItem>
                    <SelectItem value="DEMO">Demo</SelectItem>
                    <SelectItem value="ENQUIRY">Enquiry</SelectItem>
                    <SelectItem value="SCHOOL_VISIT">School visit</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={status} onValueChange={(v) => setStatus(v as RolloutStatus | "ALL")}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All statuses</SelectItem>
                    <SelectItem value="NEW">New</SelectItem>
                    <SelectItem value="CONTACTING">Contacting</SelectItem>
                    <SelectItem value="SCHEDULED">Scheduled</SelectItem>
                    <SelectItem value="CLOSED">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="max-h-[600px] divide-y divide-[var(--admin-border)] overflow-y-auto">
              {loading ? (
                <div className="p-6 text-sm text-[var(--admin-muted)]">Loading requests…</div>
              ) : data.items.length === 0 ? (
                <div className="flex flex-col items-center gap-2 p-10 text-center">
                  <Inbox className="h-8 w-8 text-[var(--admin-border)]" />
                  <p className="text-sm text-[var(--admin-muted)]">No requests match your filters.</p>
                </div>
              ) : (
                data.items.map((row) => {
                  const active = row.id === selectedId;
                  return (
                    <button
                      key={row.id}
                      onClick={() => setSelectedId(row.id)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${active ? "bg-[var(--admin-surface-2)]" : "hover:bg-[var(--admin-surface-2)]/60"}`}
                    >
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${statusDot(row.status)}`} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-[var(--admin-ink)]">{row.organization_name}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--admin-muted)]">
                          <span className="truncate">{row.contact_name}</span>
                          <span>·</span>
                          <span className="shrink-0">{formatDate(row.created_at)}</span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className="text-[10px]">{formatType(row.request_type)}</Badge>
                          <Badge className={statusBadge(row.status)}>{formatType(row.status)}</Badge>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* RIGHT — detail + workflow */}
          <div className="min-h-[420px] rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] shadow-[0_1px_2px_rgba(19,33,41,0.05)]">
            {selected ? (
              <div className="flex h-full flex-col">
                <div className="border-b border-[var(--admin-border)] p-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-serif text-xl font-bold tracking-tight text-[var(--admin-ink)]">{selected.organization_name}</h2>
                    <Badge className={statusBadge(selected.status)}>{formatType(selected.status)}</Badge>
                    <Badge variant="outline">{formatType(selected.request_type)}</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-[var(--admin-muted)]">
                    <span className="inline-flex items-center gap-1.5"><CalendarClock className="size-4" />{formatDate(selected.created_at)}</span>
                    {selected.student_count ? (
                      <span className="inline-flex items-center gap-1.5"><Building2 className="size-4" />{selected.student_count.toLocaleString()} students</span>
                    ) : null}
                  </div>
                </div>

                <div className="flex-1 space-y-4 overflow-y-auto p-6">
                  <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--admin-muted)]">Contact</p>
                    <div className="mt-2 space-y-1.5 text-sm text-[var(--admin-ink)]">
                      <div className="inline-flex items-center gap-2"><Mail className="size-4 text-[var(--admin-muted)]" />{selected.contact_name} · {selected.contact_email}</div>
                      {selected.contact_phone ? <div className="inline-flex items-center gap-2"><Phone className="size-4 text-[var(--admin-muted)]" />{selected.contact_phone}</div> : null}
                      {selected.preferred_contact_method ? (
                        <div className="text-[var(--admin-muted)]">Preferred: {formatType(selected.preferred_contact_method)}{selected.preferred_contact_window ? ` · ${selected.preferred_contact_window}` : ""}</div>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--admin-muted)]">Requested workspace</p>
                    <div className="mt-2 inline-flex items-center gap-2 text-sm text-[var(--admin-ink)]">
                      <Globe2 className="size-4 text-[var(--admin-muted)]" />
                      <span className="font-medium">{selected.requested_domain || "No preferred subdomain supplied"}</span>
                    </div>
                  </div>

                  {selected.notes ? (
                    <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--admin-muted)]">Notes</p>
                      <p className="mt-2 text-sm leading-6 text-[var(--admin-ink)]">{selected.notes}</p>
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-[var(--admin-border)] p-4">
                  <span className="mr-auto text-xs font-medium text-[var(--admin-muted)]">Move to</span>
                  {(["CONTACTING", "SCHEDULED", "CLOSED"] as RolloutStatus[]).map((s) => (
                    <Button
                      key={s}
                      type="button"
                      size="sm"
                      className={s === "CLOSED"
                        ? "bg-[var(--admin-primary)] text-white hover:bg-[var(--admin-slate)]"
                        : "border border-[var(--admin-border)] bg-white text-[var(--admin-ink)] hover:bg-[var(--admin-surface-2)]"}
                      variant={s === "CLOSED" ? "default" : "outline"}
                      disabled={updatingId === selected.id || selected.status === s}
                      onClick={() => void updateStatus(selected.id, s)}
                    >
                      {formatType(s)}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-3 text-center">
                <Inbox className="h-10 w-10 text-[var(--admin-border)]" />
                <p className="text-sm text-[var(--admin-muted)]">Select a request to view its details.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
