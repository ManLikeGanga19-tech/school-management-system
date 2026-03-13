"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { AppShell } from "@/components/layout/AppShell";
import { saasNav } from "@/components/layout/nav-config";
import { DashboardStatCard } from "@/components/dashboard/dashboard-primitives";
import { SaasPageHeader, SaasSurface } from "@/components/saas/page-chrome";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { BillingEligibilityPreview } from "@/components/saas/BillingEligibilityPreview";
import {
  fetchSubscriptionBillingEligibility,
  type BillingPlan,
  type SubscriptionBillingEligibility,
} from "@/lib/admin/subscription-eligibility";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Building2,
  Search,
  RefreshCw,
  ShieldOff,
  ShieldCheck,
  Globe,
  XCircle,
  Activity,
  CheckCircle,
  Plus,
  Pencil,
  Copy,
  KeyRound,
  UserRound,
  WandSparkles,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ─── Types ────────────────────────────────────────────────────────────────────

type TenantRow = {
  id: string;
  slug: string;
  name: string;
  primary_domain: string | null;
  is_active: boolean;
  plan?: string | null;
  user_count?: number | null;
  admin_user_id?: string | null;
  admin_email?: string | null;
  admin_full_name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type TenantAccessPack = {
  tenantName: string;
  domain: string;
  adminEmail: string;
  adminPassword: string;
  adminFullName?: string | null;
};

type TenantPrintProfile = {
  tenant_id: string;
  logo_url: string | null;
  school_header: string | null;
  receipt_footer: string | null;
  paper_size: "A4" | "THERMAL_80MM";
  currency: string;
  thermal_width_mm: number;
  qr_enabled: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso?: string | null) {
  if (!iso) return "—";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-KE", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function avatarColor(id: string) {
  const palette = [
    "bg-blue-100 text-blue-700",
    "bg-emerald-100 text-emerald-700",
    "bg-amber-100 text-amber-700",
    "bg-purple-100 text-purple-700",
    "bg-rose-100 text-rose-700",
    "bg-cyan-100 text-cyan-700",
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

function formatBillingPlan(plan?: string | null): string {
  const normalized = String(plan ?? "").trim().toLowerCase();
  if (normalized === "per_term") return "Per Term";
  if (normalized === "per_year" || normalized === "full_year") return "Per Year";
  return String(plan ?? "");
}

function getTenantBaseHost() {
  const configured =
    process.env.NEXT_PUBLIC_TENANT_BASE_HOST?.trim() ||
    process.env.NEXT_PUBLIC_PUBLIC_HOST?.trim();
  if (configured) return configured;
  if (typeof window === "undefined") return "shulehq.co.ke";
  const hostname = window.location.hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "localhost";
  if (hostname.startsWith("admin.")) return hostname.slice("admin.".length);
  return hostname;
}

function suggestTenantDomain(slug: string) {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) return "";
  const baseHost = getTenantBaseHost();
  if (baseHost === "localhost") return `${normalized}.localhost`;
  return `${normalized}.${baseHost}`;
}

function tenantLoginUrl(domain: string) {
  const normalized = domain.trim();
  if (!normalized) return "";
  if (normalized.endsWith(".localhost") || normalized === "localhost") {
    return `http://${normalized}:3000/login`;
  }
  return `https://${normalized}/login`;
}

function generateTenantPassword(length = 14) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  const values = new Uint32Array(length);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(values);
  } else {
    for (let i = 0; i < length; i++) values[i] = Math.floor(Math.random() * alphabet.length);
  }
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join("");
}

const DEFAULT_PRINT_PROFILE: TenantPrintProfile = {
  tenant_id: "",
  logo_url: null,
  school_header: null,
  receipt_footer: null,
  paper_size: "A4",
  currency: "KES",
  thermal_width_mm: 80,
  qr_enabled: true,
};

function normalizePrintProfile(
  value: Partial<TenantPrintProfile> | null | undefined,
  tenantId: string
): TenantPrintProfile {
  const paper = String(value?.paper_size ?? "A4").toUpperCase();
  const width = Number(value?.thermal_width_mm ?? 80);
  return {
    tenant_id: String(value?.tenant_id ?? tenantId),
    logo_url: value?.logo_url ?? null,
    school_header: value?.school_header ?? null,
    receipt_footer: value?.receipt_footer ?? null,
    paper_size: paper === "THERMAL_80MM" ? "THERMAL_80MM" : "A4",
    currency: String(value?.currency ?? "KES").toUpperCase(),
    thermal_width_mm: Number.isFinite(width) ? Math.max(58, Math.min(120, width)) : 80,
    qr_enabled: value?.qr_enabled ?? true,
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SaaSTenantsPage() {
  const [rows, setRows]     = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr]       = useState<string | null>(null);

  // Filters
  const [q, setQ]           = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");

  // Confirm dialogs
  const [suspendTarget, setSuspendTarget] = useState<TenantRow | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<TenantRow | null>(null);
  const [actionBusy, setActionBusy]       = useState(false);

  // ── Create tenant dialog ──────────────────────────────────────────────────
  const [createOpen, setCreateOpen]         = useState(false);
  const [cName, setCName]                   = useState("");
  const [cSlug, setCSlug]                   = useState("");
  const [cSlugManual, setCSlugManual]       = useState(false);
  const [cDomain, setCDomain]               = useState("");
  const [cDomainManual, setCDomainManual]   = useState(false);
  const [cBillingPlan, setCBillingPlan]     = useState<string>("__none__");
  const [cAdminEmail, setCAdminEmail]       = useState("");
  const [cAdminFullName, setCAdminFullName] = useState("");
  const [cAdminPassword, setCAdminPassword] = useState("");
  const [creating, setCreating]             = useState(false);
  const [createEligibility, setCreateEligibility] = useState<SubscriptionBillingEligibility | null>(null);
  const [createEligibilityLoading, setCreateEligibilityLoading] = useState(false);
  const [createEligibilityError, setCreateEligibilityError] = useState<string | null>(null);

  // ── Edit tenant dialog ───────────────────────────────────────────────────
  const [editOpen, setEditOpen]             = useState(false);
  const [editTarget, setEditTarget]         = useState<TenantRow | null>(null);
  const [eName, setEName]                   = useState("");
  const [eSlug, setESlug]                   = useState("");
  const [eSlugManual, setESlugManual]       = useState(false);
  const [eDomain, setEDomain]               = useState("");
  const [eDomainManual, setEDomainManual]   = useState(false);
  const [eAdminEmail, setEAdminEmail]       = useState("");
  const [eAdminFullName, setEAdminFullName] = useState("");
  const [eAdminPassword, setEAdminPassword] = useState("");
  const [editing, setEditing]               = useState(false);
  const [accessPack, setAccessPack]         = useState<TenantAccessPack | null>(null);

  // ── Tenant print profile ────────────────────────────────────────────────
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileTarget, setProfileTarget] = useState<TenantRow | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [printProfile, setPrintProfile] = useState<TenantPrintProfile>(DEFAULT_PRINT_PROFILE);

  const BILLING_PLANS: Array<{ value: BillingPlan; label: string }> = [
    { value: "per_term", label: "Per Term" },
    { value: "per_year", label: "Per Year" },
  ];

  function slugify(name: string) {
    return name.toLowerCase().trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
  }

  function handleNameChange(val: string) {
    setCName(val);
    if (!cSlugManual) {
      const nextSlug = slugify(val);
      setCSlug(nextSlug);
      if (!cDomainManual) setCDomain(suggestTenantDomain(nextSlug));
    }
  }

  function handleSlugChange(val: string) {
    const normalized = val.toLowerCase().replace(/[^a-z0-9-]/g, "");
    setCSlug(normalized);
    setCSlugManual(true);
    if (!cDomainManual) setCDomain(suggestTenantDomain(normalized));
  }

  function handleDomainChange(val: string) {
    setCDomain(val.trim().toLowerCase());
    setCDomainManual(true);
  }

  function resetCreateForm() {
    setCName(""); setCSlug(""); setCSlugManual(false);
    setCDomain(""); setCDomainManual(false);
    setCBillingPlan("__none__");
    setCAdminEmail("");
    setCAdminFullName("");
    setCAdminPassword("");
    setCreateEligibility(null);
    setCreateEligibilityError(null);
  }

  function openEditDialog(tenant: TenantRow) {
    setEditTarget(tenant);
    setEName(tenant.name);
    setESlug(tenant.slug);
    setESlugManual(true);
    const suggestedDomain = suggestTenantDomain(tenant.slug);
    const resolvedDomain = tenant.primary_domain?.trim() || suggestedDomain;
    setEDomain(resolvedDomain);
    setEDomainManual(Boolean(tenant.primary_domain && tenant.primary_domain !== suggestedDomain));
    setEAdminEmail(tenant.admin_email ?? "");
    setEAdminFullName(tenant.admin_full_name ?? "");
    setEAdminPassword("");
    setEditOpen(true);
  }

  function resetEditForm() {
    setEditTarget(null);
    setEName("");
    setESlug("");
    setESlugManual(false);
    setEDomain("");
    setEDomainManual(false);
    setEAdminEmail("");
    setEAdminFullName("");
    setEAdminPassword("");
  }

  function handleEditNameChange(val: string) {
    setEName(val);
    if (!eSlugManual) {
      const nextSlug = slugify(val);
      setESlug(nextSlug);
      if (!eDomainManual) setEDomain(suggestTenantDomain(nextSlug));
    }
  }

  function handleEditSlugChange(val: string) {
    const normalized = val.toLowerCase().replace(/[^a-z0-9-]/g, "");
    setESlug(normalized);
    setESlugManual(true);
    if (!eDomainManual) setEDomain(suggestTenantDomain(normalized));
  }

  function handleEditDomainChange(val: string) {
    setEDomain(val.trim().toLowerCase());
    setEDomainManual(true);
  }

  async function copyAccessPack(pack: TenantAccessPack) {
    const message = [
      `School: ${pack.tenantName}`,
      pack.adminFullName ? `Contact: ${pack.adminFullName}` : null,
      `Login URL: ${tenantLoginUrl(pack.domain)}`,
      `Email: ${pack.adminEmail}`,
      `Password: ${pack.adminPassword}`,
    ]
      .filter(Boolean)
      .join("\n");
    try {
      await navigator.clipboard.writeText(message);
      toast.success("Tenant access pack copied");
    } catch {
      toast.error("Unable to copy access pack");
    }
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async function createTenant() {
    const name   = cName.trim();
    const slug   = cSlug.trim();
    const domain = cDomain.trim() || null;
    const billingPlan = cBillingPlan !== "__none__" ? cBillingPlan : null;
    const adminEmail = cAdminEmail.trim().toLowerCase() || null;
    const adminFullName = cAdminFullName.trim() || null;
    const adminPassword = cAdminPassword.trim() || null;

    if (!name) return toast.error("Institution name is required");
    if (!slug) return toast.error("Slug is required");
    if (!/^[a-z0-9-]+$/.test(slug)) return toast.error("Slug: lowercase letters, numbers, hyphens only");
    if ((adminFullName || adminPassword) && !adminEmail) return toast.error("Admin email is required before setting school access");
    if (adminEmail && !adminPassword) return toast.error("Admin password is required when provisioning tenant access");

    setCreating(true);
    try {
      const created = await apiFetch<TenantRow>("/admin/tenants", {
        method: "POST",
        tenantRequired: false,
        body: JSON.stringify({
          name,
          slug,
          primary_domain: domain,
          plan: billingPlan,
          admin_email: adminEmail,
          admin_full_name: adminFullName,
          admin_password: adminPassword,
        }),
        headers: { "Content-Type": "application/json" },
      } as any);
      if (adminEmail && adminPassword) {
        setAccessPack({
          tenantName: created.name,
          domain: created.primary_domain || domain || suggestTenantDomain(created.slug),
          adminEmail,
          adminPassword,
          adminFullName,
        });
      }
      toast.success(`Tenant "${name}" created`);
      setCreateOpen(false);
      resetCreateForm();
      await load(true);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create tenant");
    } finally {
      setCreating(false);
    }
  }

  async function saveTenantChanges() {
    if (!editTarget) return;

    const name = eName.trim();
    const slug = eSlug.trim();
    const domain = eDomain.trim() || null;
    const adminEmail = eAdminEmail.trim().toLowerCase() || null;
    const adminFullName = eAdminFullName.trim() || null;
    const adminPassword = eAdminPassword.trim() || null;

    if (!name) return toast.error("Institution name is required");
    if (!slug) return toast.error("Slug is required");
    if (!/^[a-z0-9-]+$/.test(slug)) return toast.error("Slug: lowercase letters, numbers, hyphens only");
    if ((adminFullName || adminPassword) && !adminEmail) return toast.error("Admin email is required before setting school access");
    if (adminEmail && !adminPassword && adminEmail !== (editTarget.admin_email ?? "").toLowerCase()) {
      return toast.error("Admin password is required when provisioning tenant access");
    }

    setEditing(true);
    try {
      const updated = await apiFetch<TenantRow>(`/admin/tenants/${editTarget.id}`, {
        method: "PATCH",
        tenantRequired: false,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          slug,
          primary_domain: domain,
          admin_email: adminEmail,
          admin_full_name: adminFullName,
          ...(adminPassword ? { admin_password: adminPassword } : {}),
        }),
      });
      if (adminEmail && adminPassword) {
        setAccessPack({
          tenantName: updated.name,
          domain: updated.primary_domain || domain || suggestTenantDomain(updated.slug),
          adminEmail,
          adminPassword,
          adminFullName,
        });
      }
      toast.success(`Tenant "${updated.name}" updated`);
      setEditOpen(false);
      resetEditForm();
      await load(true);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update tenant");
    } finally {
      setEditing(false);
    }
  }

  // ── Load ─────────────────────────────────────────────────────────────────

  async function load(silent = false) {
    if (!silent) setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (status === "active")   params.set("is_active", "true");
      if (status === "inactive") params.set("is_active", "false");

      const data = await apiFetch<TenantRow[]>(
        `/admin/tenants?${params.toString()}`,
        { method: "GET", tenantRequired: false }
      );
      setRows(data ?? []);
    } catch (e: any) {
      setErr(e?.message ?? "Couldn't load tenants");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(true), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadEligibility() {
      if (!createOpen || cBillingPlan === "__none__") {
        setCreateEligibility(null);
        setCreateEligibilityError(null);
        setCreateEligibilityLoading(false);
        return;
      }

      setCreateEligibilityLoading(true);
      setCreateEligibilityError(null);
      try {
        const eligibility = await fetchSubscriptionBillingEligibility(cBillingPlan as BillingPlan);
        if (!cancelled) setCreateEligibility(eligibility);
      } catch (error: any) {
        if (!cancelled) {
          setCreateEligibility(null);
          setCreateEligibilityError(error?.message ?? "Unable to resolve the current billing window.");
        }
      } finally {
        if (!cancelled) setCreateEligibilityLoading(false);
      }
    }

    void loadEligibility();
    return () => {
      cancelled = true;
    };
  }, [cBillingPlan, createOpen]);

  // ── Actions ───────────────────────────────────────────────────────────────

  async function suspend(id: string) {
    setActionBusy(true);
    try {
      await apiFetch(`/admin/tenants/${id}/suspend`, {
        method: "POST",
        tenantRequired: false,
      });
      toast.success("Tenant suspended");
      setSuspendTarget(null);
      await load(true);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to suspend tenant");
    } finally {
      setActionBusy(false);
    }
  }

  async function restore(id: string) {
    setActionBusy(true);
    try {
      await apiFetch(`/admin/tenants/${id}/restore`, {
        method: "POST",
        tenantRequired: false,
      });
      toast.success("Tenant restored");
      setRestoreTarget(null);
      await load(true);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to restore tenant");
    } finally {
      setActionBusy(false);
    }
  }

  async function openPrintProfileEditor(tenant: TenantRow) {
    setProfileTarget(tenant);
    setProfileOpen(true);
    setProfileBusy(true);
    try {
      const data = await apiFetch<Partial<TenantPrintProfile>>(
        `/admin/tenants/${tenant.id}/print-profile`,
        { method: "GET", tenantRequired: false }
      );
      setPrintProfile(normalizePrintProfile(data, tenant.id));
    } catch (e: any) {
      setPrintProfile(normalizePrintProfile(DEFAULT_PRINT_PROFILE, tenant.id));
      toast.error(e?.message ?? "Failed to load print profile");
    } finally {
      setProfileBusy(false);
    }
  }

  async function savePrintProfileSettings() {
    if (!profileTarget) return;
    setProfileBusy(true);
    try {
      const payload = {
        logo_url: printProfile.logo_url?.trim() || null,
        school_header: printProfile.school_header?.trim() || null,
        receipt_footer: printProfile.receipt_footer?.trim() || null,
        paper_size: printProfile.paper_size,
        currency: printProfile.currency.trim().toUpperCase() || "KES",
        thermal_width_mm: Number(printProfile.thermal_width_mm || 80),
        qr_enabled: Boolean(printProfile.qr_enabled),
      };
      const saved = await apiFetch<Partial<TenantPrintProfile>>(
        `/admin/tenants/${profileTarget.id}/print-profile`,
        {
          method: "PUT",
          tenantRequired: false,
          body: JSON.stringify(payload),
          headers: { "Content-Type": "application/json" },
        }
      );
      setPrintProfile(normalizePrintProfile(saved, profileTarget.id));
      toast.success(`Print profile saved for "${profileTarget.name}"`);
      setProfileOpen(false);
      setProfileTarget(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save print profile");
    } finally {
      setProfileBusy(false);
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const activeCount   = rows.filter((r) => r.is_active).length;
  const inactiveCount = rows.length - activeCount;
  const activeRate    = rows.length > 0 ? Math.round((activeCount / rows.length) * 100) : 0;

  const filteredRows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      const matchStatus =
        status === "all" ||
        (status === "active" && r.is_active) ||
        (status === "inactive" && !r.is_active);
      const matchSearch =
        !term ||
        r.name.toLowerCase().includes(term) ||
        r.slug.toLowerCase().includes(term) ||
        (r.primary_domain ?? "").toLowerCase().includes(term);
      return matchStatus && matchSearch;
    });
  }, [rows, q, status]);

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppShell title="Super Admin" nav={saasNav} activeHref="/saas/tenants">

      {/* ── Create tenant dialog ── */}
      <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) resetCreateForm(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Onboard New Tenant</DialogTitle>
            <DialogDescription>
              Create a new institution, pre-wire its tenant domain, and prepare the director login pack for manual delivery.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Institution Name <span className="text-red-500">*</span></Label>
              <Input placeholder="e.g. Nairobi Academy" value={cName} onChange={(e) => handleNameChange(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Slug <span className="text-red-500">*</span></Label>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="nairobi-academy"
                  value={cSlug}
                  onChange={(e) => handleSlugChange(e.target.value)}
                  className="font-mono"
                />
                {cSlugManual && (
                  <button type="button" onClick={() => { setCSlug(slugify(cName)); setCSlugManual(false); }} className="shrink-0 text-xs text-blue-500 hover:underline">
                    Reset
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Lowercase letters, numbers, hyphens only.
                {cSlug && <span className="ml-1">Preview: <code className="rounded bg-slate-100 px-1">{cSlug}</code></span>}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Primary Domain</Label>
              <div className="flex items-center gap-2">
                <Input placeholder="novel-school.shulehq.co.ke" value={cDomain} onChange={(e) => handleDomainChange(e.target.value)} />
                {cSlug && (
                  <button
                    type="button"
                    onClick={() => {
                      setCDomain(suggestTenantDomain(cSlug));
                      setCDomainManual(false);
                    }}
                    className="shrink-0 text-xs text-blue-500 hover:underline"
                  >
                    Autofill
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Autofilled from the tenant slug and base host, but you can override it for custom routing.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Initial Billing Plan</Label>
              <Select value={cBillingPlan} onValueChange={setCBillingPlan}>
                <SelectTrigger><SelectValue placeholder="No plan assigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No plan (assign later)</SelectItem>
                  {BILLING_PLANS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {cBillingPlan !== "__none__" ? (
              <BillingEligibilityPreview
                eligibility={createEligibility}
                loading={createEligibilityLoading}
                error={createEligibilityError}
                title="First billing window"
              />
            ) : null}
            <Separator />
            <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">School admin access</p>
                  <p className="text-xs text-slate-500">
                    Set the director login details now so you can share them directly over WhatsApp.
                  </p>
                </div>
                <KeyRound className="mt-0.5 h-4 w-4 text-slate-400" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600">Director/Admin Name</Label>
                <Input placeholder="Novel School Director" value={cAdminFullName} onChange={(e) => setCAdminFullName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600">Director/Admin Email</Label>
                <Input type="email" placeholder="director@novelschool.ac.ke" value={cAdminEmail} onChange={(e) => setCAdminEmail(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <Label className="text-xs font-medium text-slate-600">Initial Password</Label>
                  <button
                    type="button"
                    onClick={() => setCAdminPassword(generateTenantPassword())}
                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                  >
                    <WandSparkles className="h-3.5 w-3.5" />
                    Generate secure password
                  </button>
                </div>
                <PasswordInput
                  placeholder="Set a password to share with the school"
                  value={cAdminPassword}
                  onChange={(e) => setCAdminPassword(e.target.value)}
                />
              </div>
              {cAdminEmail && cAdminPassword && (
                <div className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs text-slate-600">
                  <div className="font-medium text-slate-900">Access pack preview</div>
                  <div className="mt-1 space-y-1">
                    <div>Login URL: <span className="font-mono">{tenantLoginUrl(cDomain || suggestTenantDomain(cSlug))}</span></div>
                    <div>Email: <span className="font-mono">{cAdminEmail}</span></div>
                    <div>Password: <span className="font-mono">{cAdminPassword}</span></div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); resetCreateForm(); }} disabled={creating}>Cancel</Button>
            <Button
              onClick={() => void createTenant()}
              disabled={creating || !cName.trim() || !cSlug.trim()}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {creating ? (
                <span className="flex items-center gap-2">
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Creating…
                </span>
              ) : "Onboard Tenant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) resetEditForm();
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit Tenant Profile</DialogTitle>
            <DialogDescription>
              Update tenant identity, override the routed domain, and reset the director login pack when needed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600">Institution Name</Label>
                <Input value={eName} onChange={(e) => handleEditNameChange(e.target.value)} autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600">Slug</Label>
                <div className="flex items-center gap-2">
                  <Input value={eSlug} onChange={(e) => handleEditSlugChange(e.target.value)} className="font-mono" />
                  {eSlugManual && (
                    <button
                      type="button"
                      onClick={() => {
                        const nextSlug = slugify(eName);
                        setESlug(nextSlug);
                        setESlugManual(false);
                        if (!eDomainManual) setEDomain(suggestTenantDomain(nextSlug));
                      }}
                      className="shrink-0 text-xs text-blue-500 hover:underline"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Primary Domain</Label>
              <div className="flex items-center gap-2">
                <Input value={eDomain} onChange={(e) => handleEditDomainChange(e.target.value)} />
                <button
                  type="button"
                  onClick={() => {
                    setEDomain(suggestTenantDomain(eSlug));
                    setEDomainManual(false);
                  }}
                  className="shrink-0 text-xs text-blue-500 hover:underline"
                >
                  Autofill
                </button>
              </div>
              <p className="text-xs text-slate-400">
                Derived from the slug by default. Keep it editable for mapped custom domains.
              </p>
            </div>

            <Separator />

            <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Tenant admin access</p>
                  <p className="text-xs text-slate-500">
                    Maintain the school director credentials without exposing any stored password.
                  </p>
                </div>
                <UserRound className="mt-0.5 h-4 w-4 text-slate-400" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-slate-600">Director/Admin Name</Label>
                  <Input value={eAdminFullName} onChange={(e) => setEAdminFullName(e.target.value)} placeholder="School director name" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-slate-600">Director/Admin Email</Label>
                  <Input type="email" value={eAdminEmail} onChange={(e) => setEAdminEmail(e.target.value)} placeholder="director@school.ac.ke" />
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <Label className="text-xs font-medium text-slate-600">Reset Password</Label>
                  <button
                    type="button"
                    onClick={() => setEAdminPassword(generateTenantPassword())}
                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                  >
                    <WandSparkles className="h-3.5 w-3.5" />
                    Generate secure password
                  </button>
                </div>
                <PasswordInput
                  value={eAdminPassword}
                  onChange={(e) => setEAdminPassword(e.target.value)}
                  placeholder="Leave blank to keep the current password"
                />
              </div>
              {eAdminEmail && eAdminPassword && (
                <div className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs text-slate-600">
                  <div className="font-medium text-slate-900">Access pack preview</div>
                  <div className="mt-1 space-y-1">
                    <div>Login URL: <span className="font-mono">{tenantLoginUrl(eDomain || suggestTenantDomain(eSlug))}</span></div>
                    <div>Email: <span className="font-mono">{eAdminEmail}</span></div>
                    <div>Password: <span className="font-mono">{eAdminPassword}</span></div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditOpen(false); resetEditForm(); }} disabled={editing}>Cancel</Button>
            <Button onClick={() => void saveTenantChanges()} disabled={editing || !editTarget} className="bg-blue-600 hover:bg-blue-700">
              {editing ? "Saving…" : "Save Tenant Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Print profile dialog ── */}
      <Dialog
        open={profileOpen}
        onOpenChange={(o) => {
          setProfileOpen(o);
          if (!o) setProfileTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Tenant Print Profile</DialogTitle>
            <DialogDescription>
              Configure standardized documents for{" "}
              <strong>{profileTarget?.name ?? "this tenant"}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Logo URL</Label>
              <Input
                placeholder="https://..."
                value={printProfile.logo_url ?? ""}
                onChange={(e) =>
                  setPrintProfile((p) => ({ ...p, logo_url: e.target.value || null }))
                }
                disabled={profileBusy}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">School Header</Label>
              <Input
                placeholder="Printed document header"
                value={printProfile.school_header ?? ""}
                onChange={(e) =>
                  setPrintProfile((p) => ({ ...p, school_header: e.target.value || null }))
                }
                disabled={profileBusy}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Receipt Footer</Label>
              <Input
                placeholder="Footer text for receipts/documents"
                value={printProfile.receipt_footer ?? ""}
                onChange={(e) =>
                  setPrintProfile((p) => ({ ...p, receipt_footer: e.target.value || null }))
                }
                disabled={profileBusy}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600">Paper Size</Label>
                <Select
                  value={printProfile.paper_size}
                  onValueChange={(v: "A4" | "THERMAL_80MM") =>
                    setPrintProfile((p) => ({ ...p, paper_size: v }))
                  }
                  disabled={profileBusy}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A4">A4</SelectItem>
                    <SelectItem value="THERMAL_80MM">Thermal 80mm</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600">Currency</Label>
                <Input
                  placeholder="KES"
                  value={printProfile.currency}
                  onChange={(e) =>
                    setPrintProfile((p) => ({ ...p, currency: e.target.value.toUpperCase() }))
                  }
                  disabled={profileBusy}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600">Thermal Width (mm)</Label>
                <Input
                  type="number"
                  min={58}
                  max={120}
                  value={String(printProfile.thermal_width_mm)}
                  onChange={(e) =>
                    setPrintProfile((p) => ({
                      ...p,
                      thermal_width_mm: Number(e.target.value || 80),
                    }))
                  }
                  disabled={profileBusy}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600">Verification QR</Label>
                <label className="inline-flex h-10 w-full items-center gap-2 rounded-md border px-3 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={printProfile.qr_enabled}
                    onChange={(e) =>
                      setPrintProfile((p) => ({ ...p, qr_enabled: e.target.checked }))
                    }
                    disabled={profileBusy}
                  />
                  Enable QR payload in documents
                </label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setProfileOpen(false);
                setProfileTarget(null);
              }}
              disabled={profileBusy}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void savePrintProfileSettings()}
              disabled={profileBusy || !profileTarget}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {profileBusy ? "Saving…" : "Save Print Profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Suspend confirmation ── */}
      <AlertDialog open={!!suspendTarget} onOpenChange={() => setSuspendTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Suspend "{suspendTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This tenant and all their users will immediately lose access to the platform
              until restored. Their data is preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={actionBusy}
              onClick={() => suspendTarget && void suspend(suspendTarget.id)}
            >
              {actionBusy ? "Suspending…" : "Yes, Suspend"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Restore confirmation ── */}
      <AlertDialog open={!!restoreTarget} onOpenChange={() => setRestoreTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore "{restoreTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This tenant and their users will immediately regain full access to the platform.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={actionBusy}
              onClick={() => restoreTarget && void restore(restoreTarget.id)}
            >
              {actionBusy ? "Restoring…" : "Yes, Restore"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="space-y-5">

        {/* ── Header ── */}
        <SaasPageHeader
          title="Tenant Management"
          description="Operate the school portfolio from one control layer: onboard tenants, manage domains, tune print profiles, and handle suspensions safely."
          badges={[
            { label: "Super Admin", icon: Building2 },
            { label: "Tenant Portfolio", icon: Globe },
          ]}
          metrics={[
            { label: "Total", value: rows.length },
            { label: "Active", value: activeCount },
            { label: "Inactive", value: inactiveCount, tone: inactiveCount > 0 ? "warning" : "default" },
          ]}
        />

        {/* ── Error ── */}
        {err && (
          <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 shrink-0 text-red-500" />
              {err}
            </div>
            <button onClick={() => setErr(null)} className="ml-4 opacity-60 hover:opacity-100">✕</button>
          </div>
        )}

        {accessPack && (
          <SaasSurface className="border-emerald-200 bg-emerald-50/70">
            <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <KeyRound className="h-4 w-4 text-emerald-600" />
                  Tenant access pack ready
                </div>
                <div className="grid gap-1 text-sm text-slate-700">
                  <div><span className="font-medium">Tenant:</span> {accessPack.tenantName}</div>
                  {accessPack.adminFullName ? <div><span className="font-medium">Contact:</span> {accessPack.adminFullName}</div> : null}
                  <div><span className="font-medium">Login URL:</span> <span className="font-mono">{tenantLoginUrl(accessPack.domain)}</span></div>
                  <div><span className="font-medium">Email:</span> <span className="font-mono">{accessPack.adminEmail}</span></div>
                  <div><span className="font-medium">Password:</span> <span className="font-mono">{accessPack.adminPassword}</span></div>
                </div>
                <p className="text-xs text-slate-500">
                  This password is shown once from the form input. It is not read back from storage.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => void copyAccessPack(accessPack)}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy for WhatsApp
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setAccessPack(null)}
                >
                  Dismiss
                </Button>
              </div>
            </div>
          </SaasSurface>
        )}

        {/* ── Stat pills ── */}
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <DashboardStatCard label="Total Tenants" value={rows.length} sub="Institutions on the platform" icon={Building2} tone="accent" />
          <DashboardStatCard label="Active" value={activeCount} sub="Schools currently allowed to operate" icon={ShieldCheck} tone="sage" />
          <DashboardStatCard label="Inactive" value={inactiveCount} sub="Suspended or inactive tenant footprints" icon={ShieldOff} tone={inactiveCount > 0 ? "warning" : "neutral"} />
          <DashboardStatCard label="Activity Rate" value={`${activeRate}%`} sub="Share of active tenants in portfolio" icon={Activity} tone="secondary" />
        </div>

        {/* ── Search / filter / table card ── */}
        <SaasSurface className="overflow-hidden">

          {/* Toolbar */}
          <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-slate-400" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Tenant List</h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  {filteredRows.length} of {rows.length} tenant{rows.length !== 1 ? "s" : ""}
                  {(q.trim() || status !== "all") ? " matching filters" : ""}
                </p>
              </div>
            </div>

            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              {/* Search */}
              <div className="relative w-full sm:w-auto">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search name, slug, domain…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void load()}
                  className="h-8 w-full pl-8 text-xs sm:w-56"
                />
              </div>

              {/* Status filter */}
              <Select value={status} onValueChange={(v: any) => setStatus(v)}>
                <SelectTrigger className="h-8 w-full text-xs sm:w-36">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="active">Active only</SelectItem>
                  <SelectItem value="inactive">Inactive only</SelectItem>
                </SelectContent>
              </Select>

              <Button
                size="sm"
                className="h-8 bg-blue-600 text-xs hover:bg-blue-700"
                onClick={() => void load()}
                disabled={loading}
              >
                <Search className="mr-1.5 h-3 w-3" />
                Apply
              </Button>

              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => void load(true)}
                disabled={loading}
              >
                <RefreshCw className="h-3 w-3" />
                Refresh
              </Button>

              <Button
                size="sm"
                className="h-8 gap-1.5 bg-emerald-600 text-xs hover:bg-emerald-700"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="h-3.5 w-3.5" />
                New Tenant
              </Button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 hover:bg-slate-50">
                  <TableHead className="w-10 text-xs" />
                  <TableHead className="text-xs">Institution</TableHead>
                  <TableHead className="text-xs">Slug</TableHead>
                  <TableHead className="text-xs">Domain</TableHead>
                  <TableHead className="text-xs">Billing Plan</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Created</TableHead>
                  <TableHead className="w-56 text-xs">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>

                {/* Loading state */}
                {loading && (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={8} className="py-3 px-5">
                        <Skeleton className="h-10 w-full rounded-xl" />
                      </TableCell>
                    </TableRow>
                  ))
                )}

                {/* Empty state */}
                {!loading && filteredRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-12 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <Building2 className="h-7 w-7 text-slate-200" />
                        <p className="text-sm text-slate-400">
                          {q.trim() || status !== "all"
                            ? "No tenants match your filters."
                            : "No tenants yet."}
                        </p>
                        {(q.trim() || status !== "all") && (
                          <button
                            onClick={() => { setQ(""); setStatus("all"); }}
                            className="mt-1 text-xs text-blue-500 hover:underline"
                          >
                            Clear filters
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}

                {/* Data rows */}
                {!loading && filteredRows.map((t) => (
                  <TableRow key={t.id} className="hover:bg-slate-50">

                    {/* Avatar */}
                    <TableCell className="py-3 pl-5">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${avatarColor(t.id)}`}>
                        {t.name[0]?.toUpperCase() ?? "T"}
                      </div>
                    </TableCell>

                    {/* Name + user count */}
                    <TableCell className="py-3">
                      <div className="text-sm font-semibold text-slate-900">{t.name}</div>
                      <div className="space-y-0.5 text-xs text-slate-400">
                        {t.user_count !== undefined && t.user_count !== null ? (
                          <div>
                            {t.user_count} user{t.user_count !== 1 ? "s" : ""}
                          </div>
                        ) : null}
                        {t.admin_email ? (
                          <div className="font-mono text-slate-500">{t.admin_email}</div>
                        ) : (
                          <div>No director/admin access configured</div>
                        )}
                      </div>
                    </TableCell>

                    {/* Slug with tooltip for full ID */}
                    <TableCell className="py-3">
                      <TooltipProvider delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <code className="cursor-default rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-200">
                              {t.slug}
                            </code>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <span className="font-mono text-xs">ID: {t.id}</span>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>

                    {/* Domain */}
                    <TableCell className="py-3">
                      {t.primary_domain ? (
                        <div className="flex items-center gap-1 text-xs text-slate-600">
                          <Globe className="h-3 w-3 text-slate-400" />
                          {t.primary_domain}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </TableCell>

                    {/* Billing plan */}
                    <TableCell className="py-3">
                      {t.plan ? (
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-blue-100">
                          {formatBillingPlan(t.plan)}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </TableCell>

                    {/* Status badge */}
                    <TableCell className="py-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        t.is_active
                          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                          : "bg-red-50 text-red-600 ring-1 ring-red-200"
                      }`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${t.is_active ? "bg-emerald-500" : "bg-red-500"}`} />
                        {t.is_active ? "Active" : "Suspended"}
                      </span>
                    </TableCell>

                    {/* Created at */}
                    <TableCell className="py-3 text-xs text-slate-400">
                      {timeAgo(t.created_at)}
                    </TableCell>

                    {/* Actions */}
                    <TableCell className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1.5 text-xs"
                          onClick={() => openEditDialog(t)}
                        >
                          <Pencil className="h-3 w-3" />
                          Edit
                        </Button>
                        {t.is_active ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1.5 border-red-200 bg-red-50 text-xs text-red-700 hover:bg-red-100 hover:border-red-300"
                            onClick={() => setSuspendTarget(t)}
                          >
                            <ShieldOff className="h-3 w-3" />
                            Suspend
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1.5 border-emerald-200 bg-emerald-50 text-xs text-emerald-700 hover:bg-emerald-100 hover:border-emerald-300"
                            onClick={() => setRestoreTarget(t)}
                          >
                            <ShieldCheck className="h-3 w-3" />
                            Restore
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => void openPrintProfileEditor(t)}
                        >
                          Print Setup
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Table footer */}
          {filteredRows.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-6 py-3">
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                {activeCount} active
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <Activity className="h-3.5 w-3.5 text-red-400" />
                {inactiveCount} suspended
              </span>
              <span className="text-xs text-slate-400 sm:ml-auto">
                Auto-refreshes every 30s
              </span>
            </div>
          )}
        </SaasSurface>
      </div>
    </AppShell>
  );
}
