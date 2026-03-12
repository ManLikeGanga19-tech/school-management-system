"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Loader2, LogOut, Rocket, ShieldCheck } from "lucide-react";

import { useProspectSession } from "@/components/marketing/ProspectSessionProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";

type ProspectRequestRow = {
  id: string;
  request_type: string;
  status: string;
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

function getErrorMessage(data: any, fallback: string) {
  if (!data) return fallback;
  if (typeof data.detail === "string" && data.detail.trim()) return data.detail;
  if (typeof data.message === "string" && data.message.trim()) return data.message;
  return fallback;
}

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
  return date.toLocaleString();
}

const initialRequestState = {
  request_type: "DEMO",
  organization_name: "",
  requested_domain: "",
  contact_phone: "",
  student_count: "",
  preferred_contact_method: "EMAIL",
  preferred_contact_window: "",
  notes: "",
};

export function ProspectEngagementPanel() {
  const { account, loading, setAccount } = useProspectSession();
  const [requests, setRequests] = useState<ProspectRequestRow[]>([]);
  const [requestPending, setRequestPending] = useState(false);
  const [requestState, setRequestState] = useState(initialRequestState);

  const requestCountLabel = useMemo(() => {
    if (!requests.length) return "No requests submitted yet";
    return `${requests.length} request${requests.length === 1 ? "" : "s"} submitted`;
  }, [requests.length]);

  useEffect(() => {
    let active = true;

    const syncRequests = async () => {
      if (!account) {
        if (active) {
          setRequests([]);
          setRequestState(initialRequestState);
        }
        return;
      }

      setRequestState((current) => ({
        ...current,
        organization_name: current.organization_name || account.organization_name || "",
        contact_phone: current.contact_phone || account.phone || "",
      }));

      try {
        const res = await fetch("/api/prospect/requests", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(getErrorMessage(data, "Failed to load requests"));
        }
        const data = await res.json().catch(() => []);
        if (active) {
          setRequests(Array.isArray(data) ? data : []);
        }
      } catch {
        if (active) setRequests([]);
      }
    };

    void syncRequests();
    return () => {
      active = false;
    };
  }, [account]);

  async function handleLogout() {
    try {
      await fetch("/api/prospect/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } finally {
      setAccount(null);
      setRequests([]);
      setRequestState(initialRequestState);
      toast.success("Signed out.");
    }
  }

  async function handleRequestSubmit() {
    if (!account) {
      toast.error("Sign in before submitting a request.");
      return;
    }

    setRequestPending(true);
    try {
      const payload = {
        ...requestState,
        student_count:
          requestState.student_count.trim() === ""
            ? null
            : Number.parseInt(requestState.student_count, 10),
      };

      const res = await fetch("/api/prospect/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(getErrorMessage(data, "Failed to submit request"));
      }

      setRequests((current) => [data as ProspectRequestRow, ...current]);
      setRequestState((current) => ({
        ...initialRequestState,
        organization_name: current.organization_name,
        contact_phone: current.contact_phone,
      }));
      toast.success("Request submitted. The rollout team can now follow up.");
    } catch (err: any) {
      toast.error(err?.message || "Failed to submit request");
    } finally {
      setRequestPending(false);
    }
  }

  return (
    <Card className="relative overflow-hidden rounded-[2rem] border border-slate-200/80 bg-white/94 shadow-[0_30px_90px_rgba(15,23,42,0.14)]">
      <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,#b9512d,#173f49)]" />
      <CardHeader className="space-y-4 pb-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-600">
              <Rocket className="size-3.5 text-[#b9512d]" />
              Guided rollout desk
            </div>
            <CardTitle className="mt-4 text-2xl tracking-tight text-slate-950 sm:text-3xl">
              Secure your demo, enquiry, or school visit.
            </CardTitle>
            <CardDescription className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              Prospects use a dedicated access flow before they request a rollout conversation. School users and SaaS admins do not sign in here.
            </CardDescription>
          </div>
          <div className="hidden rounded-2xl border border-slate-200 bg-slate-50/80 p-3 text-slate-700 sm:block">
            <ShieldCheck className="size-5" />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {loading ? (
          <div className="flex min-h-56 items-center justify-center rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70">
            <div className="flex items-center gap-3 text-sm text-slate-500">
              <Loader2 className="size-4 animate-spin" />
              Loading request desk...
            </div>
          </div>
        ) : !account ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
            <div className="space-y-4 rounded-[1.5rem] border border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(241,245,249,0.75))] p-5">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-slate-950">Create access once, then manage every rollout request from one record.</h3>
                <p className="text-sm leading-6 text-slate-600">
                  The public request desk is gated on purpose. Institution contacts create a prospect workspace first, then return here to request a demo, a discovery enquiry, or an on-site rollout session.
                </p>
              </div>

              <div className="space-y-3">
                {[
                  "Dedicated prospect access before tenant activation",
                  "Requested school subdomain captured from the first interaction",
                  "One operational request history across demo, enquiry, and site visit",
                ].map((item) => (
                  <div key={item} className="rounded-[1.25rem] border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-600 shadow-sm">
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex h-full flex-col justify-between rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Prospect access required</p>
                <h3 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Use the dedicated access pages, then return here to submit the request.</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  This keeps public prospect onboarding separate from live school and SaaS authentication while preserving one controlled request history per institution.
                </p>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <Button asChild className="rounded-full bg-slate-950 text-white hover:bg-slate-800">
                  <Link href="/create-access">Create access</Link>
                </Button>
                <Button asChild variant="outline" className="rounded-full border-slate-300 bg-white/90">
                  <Link href="/sign-in">Sign in</Link>
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.08fr)_minmax(18rem,0.92fr)]">
            <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-500">Signed in as</p>
                  <h3 className="text-2xl font-semibold tracking-tight text-slate-950">{account.full_name}</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    {account.organization_name} · {account.email}
                  </p>
                </div>
                <Button type="button" variant="outline" className="rounded-full" onClick={handleLogout}>
                  <LogOut className="size-4" />
                  Sign out
                </Button>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="request-type">Request type</Label>
                  <Select
                    value={requestState.request_type}
                    onValueChange={(value) => setRequestState((s) => ({ ...s, request_type: value }))}
                  >
                    <SelectTrigger id="request-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DEMO">Demo request</SelectItem>
                      <SelectItem value="ENQUIRY">General enquiry</SelectItem>
                      <SelectItem value="SCHOOL_VISIT">School visit / integration workshop</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="request-organization">Institution</Label>
                  <Input
                    id="request-organization"
                    value={requestState.organization_name}
                    onChange={(e) => setRequestState((s) => ({ ...s, organization_name: e.target.value }))}
                    placeholder="School or group name"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="request-domain">Preferred school subdomain</Label>
                  <Input
                    id="request-domain"
                    value={requestState.requested_domain}
                    onChange={(e) => setRequestState((s) => ({ ...s, requested_domain: e.target.value }))}
                    placeholder="novel-school"
                  />
                  <p className="text-xs leading-5 text-slate-500">
                    The rollout team uses this when preparing the tenant host for your school users.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="request-phone">Contact phone</Label>
                  <Input
                    id="request-phone"
                    value={requestState.contact_phone}
                    onChange={(e) => setRequestState((s) => ({ ...s, contact_phone: e.target.value }))}
                    placeholder="+254..."
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="request-students">Student count</Label>
                  <Input
                    id="request-students"
                    inputMode="numeric"
                    value={requestState.student_count}
                    onChange={(e) => setRequestState((s) => ({ ...s, student_count: e.target.value }))}
                    placeholder="Optional"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="request-method">Preferred contact method</Label>
                  <Select
                    value={requestState.preferred_contact_method}
                    onValueChange={(value) =>
                      setRequestState((s) => ({ ...s, preferred_contact_method: value }))
                    }
                  >
                    <SelectTrigger id="request-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="EMAIL">Email</SelectItem>
                      <SelectItem value="PHONE">Phone call</SelectItem>
                      <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                      <SelectItem value="MEETING">Scheduled meeting</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="request-window">Preferred contact window</Label>
                  <Input
                    id="request-window"
                    value={requestState.preferred_contact_window}
                    onChange={(e) =>
                      setRequestState((s) => ({ ...s, preferred_contact_window: e.target.value }))
                    }
                    placeholder="e.g. Weekdays 10:00-14:00"
                  />
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="request-notes">Context for the rollout team</Label>
                  <Textarea
                    id="request-notes"
                    value={requestState.notes}
                    onChange={(e) => setRequestState((s) => ({ ...s, notes: e.target.value }))}
                    placeholder="Tell us whether you need a demo, discovery call, on-site visit, data migration planning, or stakeholder session."
                    className="min-h-28"
                  />
                </div>

                <div className="sm:col-span-2">
                  <Button
                    type="button"
                    className="w-full rounded-full bg-[#b9512d] text-white hover:bg-[#9f4525]"
                    disabled={requestPending}
                    onClick={handleRequestSubmit}
                  >
                    {requestPending ? "Submitting request..." : "Submit request to rollout team"}
                  </Button>
                </div>
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-500">Request history</p>
                  <h3 className="text-xl font-semibold tracking-tight text-slate-950">{requestCountLabel}</h3>
                </div>
                <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  controlled
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {requests.length === 0 ? (
                  <div className="rounded-[1.25rem] border border-dashed border-slate-200 bg-white px-4 py-6 text-sm leading-6 text-slate-500">
                    Your team has not submitted any rollout requests yet. Use the form to open the first one.
                  </div>
                ) : (
                  requests.map((row) => (
                    <article
                      key={row.id}
                      className="rounded-[1.25rem] border border-slate-200 bg-white px-4 py-4 shadow-sm"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-slate-950">{formatType(row.request_type)}</p>
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{row.status}</p>
                        </div>
                        <div className="text-xs text-slate-500">{formatDate(row.created_at)}</div>
                      </div>

                      <div className="mt-3 space-y-2 text-sm text-slate-600">
                        <p>{row.organization_name}</p>
                        {row.requested_domain && (
                          <p>
                            Requested school workspace:{" "}
                            <span className="font-medium text-slate-900">{row.requested_domain}</span>
                          </p>
                        )}
                        {row.preferred_contact_method && (
                          <p>
                            Preferred contact: {formatType(row.preferred_contact_method)}
                            {row.preferred_contact_window ? ` · ${row.preferred_contact_window}` : ""}
                          </p>
                        )}
                        {row.notes && <p className="leading-6 text-slate-500">{row.notes}</p>}
                      </div>
                    </article>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
