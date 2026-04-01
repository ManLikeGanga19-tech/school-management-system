"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, RefreshCw, Save } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import type { AppNavItem } from "@/components/layout/AppShell";
import { TenantPageHeader } from "@/components/tenant/page-chrome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { asObject, readApiError } from "./finance-utils";

type PaymentSettings = {
  id?: string;
  mpesa_paybill?: string | null;
  mpesa_business_no?: string | null;
  mpesa_account_format?: string | null;
  bank_name?: string | null;
  bank_account_name?: string | null;
  bank_account_number?: string | null;
  bank_branch?: string | null;
  cash_payment_instructions?: string | null;
  uniform_details_text?: string | null;
  assessment_books_amount?: string | null;
  assessment_books_note?: string | null;
};

type Props = {
  role: "director" | "secretary";
  nav: AppNavItem[];
  activeHref: string;
};

export function PaymentSettingsPage({ role, nav, activeHref }: Props) {
  const canManage = role === "director";

  const [settings, setSettings] = useState<PaymentSettings>({});
  const [form, setForm] = useState<PaymentSettings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const body = await api.get<unknown>("/finance/payment-settings", { tenantRequired: true });
      const obj = asObject(body) as PaymentSettings | null;
      if (obj) {
        setSettings(obj);
        setForm(obj);
      }
    } catch (err: unknown) {
      // 404 means no settings yet — show empty form
      const e = err as { status?: number };
      if (e?.status !== 404) {
        toast.error("Failed to load payment settings.");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function updateField(field: keyof PaymentSettings, value: string) {
    setForm((p) => ({ ...p, [field]: value }));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      await api.put<unknown>("/finance/payment-settings", form, { tenantRequired: true });
      toast.success("Payment settings saved.");
      setDirty(false);
      await load(true);
    } catch (err: unknown) {
      toast.error(readApiError(err, "Failed to save settings."));
    } finally {
      setSaving(false);
    }
  }

  function FieldGroup({ children }: { children: React.ReactNode }) {
    return <div className="space-y-4">{children}</div>;
  }

  function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
    return (
      <div className="border-b border-slate-100 pb-3">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
    );
  }

  function Field({
    label,
    field,
    placeholder,
    hint,
    type = "text",
  }: {
    label: string;
    field: keyof PaymentSettings;
    placeholder?: string;
    hint?: string;
    type?: string;
  }) {
    return (
      <div className="space-y-1.5">
        <Label className="text-sm">{label}</Label>
        <Input
          type={type}
          placeholder={placeholder}
          value={(form[field] as string) ?? ""}
          onChange={(e) => updateField(field, e.target.value)}
          disabled={!canManage}
          className="max-w-sm"
        />
        {hint && <p className="text-xs text-slate-400">{hint}</p>}
      </div>
    );
  }

  if (loading) {
    return (
      <AppShell title={role === "director" ? "Director" : "Secretary"} nav={nav} activeHref={activeHref}>
        <div className="flex min-h-[380px] items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            <p className="text-sm text-slate-500">Loading payment settings…</p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title={role === "director" ? "Director" : "Secretary"} nav={nav} activeHref={activeHref}>
      <div className="space-y-6">
        <TenantPageHeader
          title="Payment Settings"
          description="Configure M-PESA, bank details, uniform requirements, and assessment book fees. These are printed on invoices and fee structure sheets."
          badges={[{ label: "Finance Setup" }]}
          actions={
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void load()}
                className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Refresh
              </Button>
            </div>
          }
        />

        <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-slate-400" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Payment & Billing Details</h2>
                <p className="text-xs text-slate-400">
                  {canManage ? "Edit and save your payment configuration." : "View-only mode."}
                </p>
              </div>
            </div>
            {canManage && (
              <Button size="sm" onClick={() => void save()} disabled={saving || !dirty}>
                <Save className="mr-1.5 h-3.5 w-3.5" />
                {saving ? "Saving…" : "Save Changes"}
              </Button>
            )}
          </div>

          <div className="divide-y divide-slate-50 px-6 py-5 space-y-6">
            {/* M-PESA */}
            <FieldGroup>
              <SectionHeader
                title="M-PESA Paybill"
                subtitle="Used on fee structure sheets and invoices."
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="Paybill Number" field="mpesa_paybill" placeholder="e.g. 522522" />
                <Field label="Business / Till Number" field="mpesa_business_no" placeholder="e.g. 1234567" />
                <Field
                  label="Account Reference Format"
                  field="mpesa_account_format"
                  placeholder="e.g. Admission No."
                  hint="Instructions for what to enter as account reference."
                />
              </div>
            </FieldGroup>

            {/* Bank */}
            <FieldGroup>
              <SectionHeader title="Bank Account Details" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Bank Name" field="bank_name" placeholder="e.g. Equity Bank" />
                <Field label="Branch" field="bank_branch" placeholder="e.g. Westlands" />
                <Field label="Account Name" field="bank_account_name" placeholder="e.g. NOVEL JUNIOR SCHOOL" />
                <Field label="Account Number" field="bank_account_number" placeholder="e.g. 0123456789" />
              </div>
            </FieldGroup>

            {/* Cash / Other */}
            <FieldGroup>
              <SectionHeader
                title="Cash / Other Payment Instructions"
                subtitle="Printed at the bottom of invoices."
              />
              <div className="space-y-1.5">
                <Label className="text-sm">Instructions</Label>
                <Textarea
                  rows={3}
                  placeholder="e.g. Cash payments to be made at the school bursar's office. Ensure you get an official receipt."
                  value={(form.cash_payment_instructions as string) ?? ""}
                  onChange={(e) => updateField("cash_payment_instructions", e.target.value)}
                  disabled={!canManage}
                  className="max-w-xl"
                />
              </div>
            </FieldGroup>

            {/* Uniform */}
            <FieldGroup>
              <SectionHeader
                title="Uniform Requirements"
                subtitle="Displayed on fee structure sheets."
              />
              <div className="space-y-1.5">
                <Label className="text-sm">Uniform Details</Label>
                <Textarea
                  rows={4}
                  placeholder="e.g. School uniform: White shirt with school badge, grey trousers/skirt, black shoes. Available from the school shop."
                  value={(form.uniform_details_text as string) ?? ""}
                  onChange={(e) => updateField("uniform_details_text", e.target.value)}
                  disabled={!canManage}
                  className="max-w-xl"
                />
              </div>
            </FieldGroup>

            {/* Assessment books */}
            <FieldGroup>
              <SectionHeader
                title="Assessment Books"
                subtitle="Charged once per year — displayed on fee structure sheets."
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label="Amount (KES)"
                  field="assessment_books_amount"
                  placeholder="e.g. 350"
                  type="number"
                />
                <Field
                  label="Description"
                  field="assessment_books_note"
                  placeholder="e.g. Assessment books (once per year)"
                />
              </div>
            </FieldGroup>
          </div>

          {canManage && dirty && (
            <div className="border-t border-slate-100 bg-amber-50/50 px-6 py-3 flex items-center justify-between">
              <p className="text-xs text-amber-700">You have unsaved changes.</p>
              <Button size="sm" onClick={() => void save()} disabled={saving}>
                <Save className="mr-1.5 h-3.5 w-3.5" />
                {saving ? "Saving…" : "Save Now"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
