"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  CalendarClock,
  Globe2,
  Mail,
  Phone,
  RefreshCw,
  Rocket,
  Search,
  ShieldCheck,
} from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { saasNav } from "@/components/layout/nav-config";
import {
  DashboardSectionLabel,
  DashboardStatCard,
  dashboardBadgeClasses,
} from "@/components/dashboard/dashboard-primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

type RolloutCounts = {
  total: number;
  new: number;
  contacting: number;
  scheduled: number;
  closed: number;
};

type RolloutResponse = {
  items: RolloutRequest[];
  total: number;
  counts: RolloutCounts;
};

function formatType(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-KE", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadge(status: RolloutStatus) {
  if (status === "NEW") return dashboardBadgeClasses("warning");
  if (status === "CONTACTING") return dashboardBadgeClasses("secondary");
  if (status === "SCHEDULED") return dashboardBadgeClasses("sage");
  return dashboardBadgeClasses("neutral");
}

export function SaasRolloutDeskPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<RolloutStatus | "ALL">("ALL");
  const [requestType, setRequestType] = useState<RolloutType>("ALL");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingId, setUpdatingId] = useState<string>("");
  const [data, setData] = useState<RolloutResponse>({
    items: [],
    total: 0,
    counts: { total: 0, new: 0, contacting: 0, scheduled: 0, closed: 0 },
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

      const res = await api.get<RolloutResponse>(`/admin/saas/rollout/requests?${params.toString()}`, {
        tenantRequired: false,
      });
      setData(res);
    } catch (err: any) {
      toast.error(typeof err?.message === "string" ? err.message : "Failed to load rollout desk");
    } finally {
      if (!silent) setLoading(false);
      setRefreshing(false);
    }
  }, [query, requestType, status]);

  useEffect(() => {
    void loadDesk();
  }, [loadDesk]);

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
      const updated = await api.patch<RolloutRequest>(
        `/admin/saas/rollout/requests/${id}`,
        { status: nextStatus },
        { tenantRequired: false }
      );
      setData((current) => ({
        ...current,
        items: current.items.map((item) => (item.id === id ? updated : item)),
      }));
      await loadDesk(true);
      toast.success(`Rollout request moved to ${formatType(nextStatus)}.`);
    } catch (err: any) {
      toast.error(typeof err?.message === "string" ? err.message : "Failed to update rollout request");
    } finally {
      setUpdatingId("");
    }
  }

  return (
    <AppShell title="Super Admin" nav={saasNav} activeHref="/saas/rollout">
      <div className="space-y-6">
        <section className="dashboard-hero rounded-[2rem] p-5 text-white sm:p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <DashboardSectionLabel
                icon={Rocket}
                className="border-white/15 bg-white/10 text-white/90 [&_svg]:text-white"
              >
                Rollout Desk
              </DashboardSectionLabel>
              <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">Prospect onboarding pipeline</h1>
              <p className="mt-3 text-sm leading-6 text-white/85 sm:text-base">
                Review public demo, enquiry, and school-visit requests before turning them into live tenant workspaces.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="rounded-[1.4rem] border border-white/15 bg-white/10 px-4 py-3 text-sm text-white/85">
                <div className="inline-flex items-center gap-2">
                  <ShieldCheck className="size-4" />
                  {data.total} tracked requests across the intake desk
                </div>
              </div>
              <Button
                variant="outline"
                className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                onClick={() => void loadDesk(true)}
                disabled={refreshing}
              >
                <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>
        </section>

        <section className="grid gap-4 grid-cols-2 xl:grid-cols-4">
          {activeSummary.map((item) => (
            <DashboardStatCard
              key={item.label}
              label={item.label}
              value={item.value}
              icon={item.icon}
              tone={item.tone}
            />
          ))}
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
          <Card className="dashboard-surface rounded-[1.75rem]">
            <CardHeader>
              <CardTitle className="text-base">Pipeline filters</CardTitle>
              <CardDescription>
                Search organizations, contacts, requested domains, and rollout context.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_220px_220px]">
                <div className="space-y-2">
                  <Label htmlFor="rollout-search">Search</Label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      id="rollout-search"
                      className="pl-9"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Novel School, director, novel-school..."
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={status} onValueChange={(value) => setStatus(value as RolloutStatus | "ALL")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All statuses</SelectItem>
                      <SelectItem value="NEW">New</SelectItem>
                      <SelectItem value="CONTACTING">Contacting</SelectItem>
                      <SelectItem value="SCHEDULED">Scheduled</SelectItem>
                      <SelectItem value="CLOSED">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Request type</Label>
                  <Select value={requestType} onValueChange={(value) => setRequestType(value as RolloutType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All types</SelectItem>
                      <SelectItem value="DEMO">Demo</SelectItem>
                      <SelectItem value="ENQUIRY">Enquiry</SelectItem>
                      <SelectItem value="SCHOOL_VISIT">School visit</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="dashboard-surface-muted rounded-[1.75rem] border-[#e2d4bf] bg-[#f7f3ec]/90">
            <CardHeader>
              <CardTitle className="text-base">Desk scope</CardTitle>
              <CardDescription>
                This section exists for intake qualification before a school becomes an active tenant.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-6 text-slate-600">
              <div className="rounded-[1.25rem] border border-[#e2d4bf] bg-white/92 p-4">Public requests stay separate from tenant authentication and SaaS operator sessions.</div>
              <div className="rounded-[1.25rem] border border-[#e2d4bf] bg-white/92 p-4">Requested subdomains can be validated before tenant activation and user provisioning.</div>
              <div className="rounded-[1.25rem] border border-[#e2d4bf] bg-white/92 p-4">Prospect contacts and institution context remain attached to one operational rollout record.</div>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-slate-950">Active rollout requests</h2>
              <p className="text-sm text-slate-500">{data.total} request{data.total === 1 ? "" : "s"} currently in the intake pipeline.</p>
            </div>
          </div>

          <div className="grid gap-4">
            {loading ? (
              <Card className="dashboard-surface rounded-[1.75rem]">
                <CardContent className="py-10 text-sm text-slate-500">Loading rollout requests...</CardContent>
              </Card>
            ) : data.items.length === 0 ? (
              <Card className="dashboard-surface rounded-[1.75rem]">
                <CardContent className="py-10 text-sm text-slate-500">
                  No rollout requests matched the current filters.
                </CardContent>
              </Card>
            ) : (
              data.items.map((row) => (
                <Card key={row.id} className="dashboard-surface overflow-hidden rounded-[1.75rem]">
                  <CardContent className="p-0">
                    <div className="grid gap-0 xl:grid-cols-[minmax(0,1.08fr)_minmax(21rem,0.92fr)]">
                      <div className="space-y-5 p-5 sm:p-6">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-lg font-semibold tracking-tight text-slate-950">
                                {row.organization_name}
                              </h3>
                              <Badge className={statusBadge(row.status)}>{formatType(row.status)}</Badge>
                              <Badge variant="outline">{formatType(row.request_type)}</Badge>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                              <span className="inline-flex items-center gap-1.5">
                                <CalendarClock className="size-4" />
                                {formatDate(row.created_at)}
                              </span>
                              {row.student_count ? (
                                <span className="inline-flex items-center gap-1.5">
                                  <Building2 className="size-4" />
                                  {row.student_count.toLocaleString()} students
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-3 xl:min-w-[18rem] xl:grid-cols-1">
                            {row.status !== "CONTACTING" && (
                              <Button
                                type="button"
                                variant="outline"
                                className="rounded-full"
                                disabled={updatingId === row.id}
                                onClick={() => void updateStatus(row.id, "CONTACTING")}
                              >
                                Contacting
                              </Button>
                            )}
                            {row.status !== "SCHEDULED" && (
                              <Button
                                type="button"
                                variant="outline"
                                className="rounded-full"
                                disabled={updatingId === row.id}
                                onClick={() => void updateStatus(row.id, "SCHEDULED")}
                              >
                                Schedule
                              </Button>
                            )}
                            {row.status !== "CLOSED" && (
                              <Button
                                type="button"
                                className="rounded-full bg-slate-950 text-white hover:bg-slate-800"
                                disabled={updatingId === row.id}
                                onClick={() => void updateStatus(row.id, "CLOSED")}
                              >
                                Close
                              </Button>
                            )}
                          </div>
                        </div>

                        {row.notes ? (
                          <div className="rounded-[1.25rem] border border-[#e2d4bf] bg-[#f8f3ec] p-4 text-sm leading-6 text-slate-600">
                            {row.notes}
                          </div>
                        ) : null}
                      </div>

                      <div className="grid gap-4 border-t border-[#e2d4bf] bg-[#f8f4ed]/90 p-5 sm:p-6 xl:border-l xl:border-t-0">
                        <div className="rounded-[1.25rem] border border-[#e2d4bf] bg-white/92 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Contact owner</p>
                          <div className="mt-3 space-y-2 text-sm text-slate-700">
                            <div className="inline-flex items-center gap-2">
                              <Mail className="size-4 text-slate-400" />
                              {row.contact_name} · {row.contact_email}
                            </div>
                            {row.contact_phone ? (
                              <div className="inline-flex items-center gap-2">
                                <Phone className="size-4 text-slate-400" />
                                {row.contact_phone}
                              </div>
                            ) : null}
                            {row.preferred_contact_method ? (
                              <div className="text-slate-500">
                                Preferred contact: {formatType(row.preferred_contact_method)}
                                {row.preferred_contact_window ? ` · ${row.preferred_contact_window}` : ""}
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <div className="rounded-[1.25rem] border border-[#e2d4bf] bg-white/92 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Requested school workspace</p>
                          <div className="mt-3 inline-flex items-center gap-2 text-sm text-slate-700">
                            <Globe2 className="size-4 text-slate-400" />
                            <span className="font-medium text-slate-950">
                              {row.requested_domain || "No preferred subdomain supplied"}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
