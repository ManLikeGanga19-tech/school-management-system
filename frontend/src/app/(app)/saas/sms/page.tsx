"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { AppShell } from "@/components/layout/AppShell";
import { saasNav } from "@/components/layout/nav-config";
import { SaasPageHeader, SaasSurface } from "@/components/saas/page-chrome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  MessageSquare,
  RefreshCw,
  Pencil,
  SlidersHorizontal,
  Coins,
  Building2,
  TrendingUp,
  Plus,
  Minus,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Pricing = {
  id: string;
  price_per_unit_kes: number;
  updated_at: string | null;
};

type CreditAccount = {
  tenant_id: string;
  balance_units: number;
  updated_at: string | null;
};

type TenantOption = {
  id: string;
  name: string;
  slug: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-KE");
}

function fmtKes(v: number) {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(v);
}

function StatusBadge({ units }: { units: number }) {
  if (units === 0)
    return (
      <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
        Empty
      </span>
    );
  if (units < 50)
    return (
      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
        Low
      </span>
    );
  return (
    <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
      Active
    </span>
  );
}

// ─── Pricing card ─────────────────────────────────────────────────────────────

function PricingSection({
  pricing,
  loading,
  onUpdated,
}: {
  pricing: Pricing | null;
  loading: boolean;
  onUpdated: (p: Pricing) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  function openEdit() {
    setValue(pricing ? String(pricing.price_per_unit_kes) : "");
    setEditing(true);
  }

  async function save() {
    const num = parseFloat(value);
    if (isNaN(num) || num <= 0) {
      toast.error("Enter a positive price");
      return;
    }
    setSaving(true);
    try {
      const updated = await apiFetch<Pricing>("/admin/sms/pricing", {
        method: "PATCH",
        tenantRequired: false,
        body: JSON.stringify({ price_per_unit_kes: num }),
      });
      onUpdated(updated);
      setEditing(false);
      toast.success("Price updated");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update price");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SaasSurface className="p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <SlidersHorizontal className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              Platform price per SMS unit
            </p>
            {loading ? (
              <Skeleton className="mt-1 h-7 w-32" />
            ) : (
              <p className="text-2xl font-bold">
                {pricing ? fmtKes(pricing.price_per_unit_kes) : "—"}
                <span className="ml-1 text-sm font-normal text-muted-foreground">
                  / unit
                </span>
              </p>
            )}
            {pricing?.updated_at && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Last updated {fmtDate(pricing.updated_at)}
              </p>
            )}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={openEdit}
          disabled={loading}
        >
          <Pencil className="mr-1.5 h-3.5 w-3.5" />
          Edit price
        </Button>
      </div>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Update SMS unit price</DialogTitle>
            <DialogDescription>
              This price applies to all future top-ups. Existing balances are
              not affected.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="new-price">Price per unit (KES)</Label>
            <Input
              id="new-price"
              type="number"
              step="0.01"
              min="0.01"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="e.g. 1.50"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SaasSurface>
  );
}

// ─── Adjust credits dialog ─────────────────────────────────────────────────────

function AdjustDialog({
  account,
  tenantName,
  open,
  onClose,
  onDone,
}: {
  account: CreditAccount | null;
  tenantName: string;
  open: boolean;
  onClose: () => void;
  onDone: (tenantId: string, newBalance: number) => void;
}) {
  const [adjustment, setAdjustment] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const isAdd = !adjustment.startsWith("-");
  const num = parseInt(adjustment, 10);
  const preview =
    account && !isNaN(num) ? account.balance_units + num : null;

  async function submit() {
    if (!account) return;
    if (isNaN(num) || num === 0) {
      toast.error("Enter a non-zero adjustment");
      return;
    }
    setSaving(true);
    try {
      const result = await apiFetch<{
        tenant_id: string;
        new_balance: number;
      }>(`/admin/sms/accounts/${account.tenant_id}/adjust`, {
        method: "POST",
        tenantRequired: false,
        body: JSON.stringify({ adjustment: num, reason }),
      });
      onDone(result.tenant_id, result.new_balance);
      toast.success(
        `${Math.abs(num)} units ${num > 0 ? "added to" : "removed from"} ${tenantName}`
      );
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Adjustment failed");
    } finally {
      setSaving(false);
    }
  }

  function handleOpen(open: boolean) {
    if (!open) onClose();
  }

  useEffect(() => {
    if (open) {
      setAdjustment("");
      setReason("");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Adjust SMS credits</DialogTitle>
          <DialogDescription>
            Tenant: <strong>{tenantName}</strong>
            {account && (
              <>
                {" "}
                · Current balance:{" "}
                <strong>{account.balance_units.toLocaleString()} units</strong>
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="adj">
              Units (positive = add, negative = deduct)
            </Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-10 shrink-0"
                onClick={() =>
                  setAdjustment((v) =>
                    v.startsWith("-") ? v.slice(1) : v ? "-" + v : "-"
                  )
                }
              >
                {isAdd ? (
                  <Plus className="h-4 w-4" />
                ) : (
                  <Minus className="h-4 w-4" />
                )}
              </Button>
              <Input
                id="adj"
                type="number"
                placeholder="e.g. 100"
                value={adjustment}
                onChange={(e) => setAdjustment(e.target.value)}
              />
            </div>
            {preview !== null && (
              <p
                className={`text-xs ${preview < 0 ? "text-red-600" : "text-muted-foreground"}`}
              >
                New balance: {preview.toLocaleString()} units
                {preview < 0 && " — balance cannot go below 0"}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason (optional)</Label>
            <Input
              id="reason"
              placeholder="e.g. Onboarding gift, refund for failed batch…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={saving || isNaN(num) || num === 0}
            variant={!isNaN(num) && num < 0 ? "destructive" : "default"}
          >
            {saving ? "Saving…" : isNaN(num) || num >= 0 ? "Add credits" : "Deduct credits"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SaasSmsPage() {
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [accounts, setAccounts] = useState<CreditAccount[]>([]);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [loadingPricing, setLoadingPricing] = useState(true);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const [adjustTarget, setAdjustTarget] = useState<CreditAccount | null>(null);

  const tenantMap = Object.fromEntries(tenants.map((t) => [t.id, t]));

  const filtered = accounts.filter((a) => {
    if (!q.trim()) return true;
    const tenant = tenantMap[a.tenant_id];
    const search = q.toLowerCase();
    return (
      a.tenant_id.includes(search) ||
      tenant?.name?.toLowerCase().includes(search) ||
      tenant?.slug?.toLowerCase().includes(search)
    );
  });

  const totalUnits = accounts.reduce((s, a) => s + a.balance_units, 0);
  const emptyCount = accounts.filter((a) => a.balance_units === 0).length;
  const lowCount = accounts.filter(
    (a) => a.balance_units > 0 && a.balance_units < 50
  ).length;

  const loadPricing = useCallback(async () => {
    setLoadingPricing(true);
    try {
      const data = await apiFetch<Pricing>("/admin/sms/pricing", {
        method: "GET",
        tenantRequired: false,
      });
      setPricing(data);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load pricing");
    } finally {
      setLoadingPricing(false);
    }
  }, []);

  const loadAccounts = useCallback(async (silent = false) => {
    if (!silent) setLoadingAccounts(true);
    try {
      const data = await apiFetch<CreditAccount[]>("/admin/sms/accounts", {
        method: "GET",
        tenantRequired: false,
      });
      setAccounts(data ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load accounts");
    } finally {
      setLoadingAccounts(false);
    }
  }, []);

  const loadTenants = useCallback(async () => {
    try {
      const data = await apiFetch<TenantOption[]>("/admin/tenants", {
        method: "GET",
        tenantRequired: false,
      });
      setTenants(data ?? []);
    } catch {
      setTenants([]);
    }
  }, []);

  useEffect(() => {
    loadPricing();
    loadAccounts();
    loadTenants();
  }, [loadPricing, loadAccounts, loadTenants]);

  function handleAdjustDone(tenantId: string, newBalance: number) {
    setAccounts((prev) =>
      prev.map((a) =>
        a.tenant_id === tenantId ? { ...a, balance_units: newBalance } : a
      )
    );
    setAdjustTarget(null);
  }

  const adjustTenantName = adjustTarget
    ? (tenantMap[adjustTarget.tenant_id]?.name ?? adjustTarget.tenant_id)
    : "";

  return (
    <AppShell nav={saasNav} title="SMS Credits">
      <div className="space-y-6 p-4 sm:p-6">
        <SaasPageHeader
          title="SMS Credits"
          description="Manage per-unit pricing and tenant SMS credit balances. ShuleHQ holds the Africa's Talking account; schools buy credits via M-Pesa."
          badges={[{ label: "Africa's Talking reseller", icon: MessageSquare }]}
          metrics={[
            {
              label: "Price / unit",
              value: loadingPricing
                ? "…"
                : pricing
                  ? fmtKes(pricing.price_per_unit_kes)
                  : "—",
            },
            {
              label: "Total units held",
              value: loadingAccounts
                ? "…"
                : totalUnits.toLocaleString(),
            },
            {
              label: "Empty accounts",
              value: loadingAccounts ? "…" : emptyCount,
              tone: emptyCount > 0 ? "warning" : "default",
            },
            {
              label: "Low accounts",
              value: loadingAccounts ? "…" : lowCount,
              tone: lowCount > 0 ? "warning" : "default",
            },
          ]}
          actions={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                loadPricing();
                loadAccounts(true);
              }}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Refresh
            </Button>
          }
        />

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Pricing */}
        <PricingSection
          pricing={pricing}
          loading={loadingPricing}
          onUpdated={setPricing}
        />

        {/* Tenant accounts */}
        <SaasSurface>
          <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <span className="font-semibold">Tenant credit accounts</span>
              {!loadingAccounts && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {accounts.length}
                </span>
              )}
            </div>
            <Input
              className="h-8 w-full sm:w-64"
              placeholder="Search by name or slug…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          {loadingAccounts ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-lg" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
              <Coins className="h-8 w-8 opacity-30" />
              <p className="text-sm">
                {q ? "No accounts match your search" : "No accounts yet"}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>School</TableHead>
                  <TableHead>Tenant ID</TableHead>
                  <TableHead className="text-right">Balance (units)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((account) => {
                  const tenant = tenantMap[account.tenant_id];
                  return (
                    <TableRow key={account.tenant_id}>
                      <TableCell className="font-medium">
                        {tenant?.name ?? (
                          <span className="text-muted-foreground">Unknown</span>
                        )}
                        {tenant?.slug && (
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            ({tenant.slug})
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {account.tenant_id.slice(0, 8)}…
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {account.balance_units.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <StatusBadge units={account.balance_units} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {fmtDate(account.updated_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setAdjustTarget(account)}
                        >
                          <TrendingUp className="mr-1.5 h-3.5 w-3.5" />
                          Adjust
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </SaasSurface>
      </div>

      <AdjustDialog
        account={adjustTarget}
        tenantName={adjustTenantName}
        open={adjustTarget !== null}
        onClose={() => setAdjustTarget(null)}
        onDone={handleAdjustDone}
      />
    </AppShell>
  );
}
