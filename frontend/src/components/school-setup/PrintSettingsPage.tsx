"use client";

import { useCallback, useEffect, useState } from "react";
import { Save, Printer } from "lucide-react";

import { AppShell, type AppNavItem } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";

type PrintSettingsPageProps = {
  appTitle: string;
  nav: AppNavItem[];
  activeHref: string;
};

type PrintProfile = {
  tenant_id?: string;
  school_header?: string | null;
  receipt_footer?: string | null;
  paper_size?: string;
  currency?: string;
  thermal_width_mm?: number;
  qr_enabled?: boolean;
  po_box?: string | null;
  physical_address?: string | null;
  phone?: string | null;
  email?: string | null;
  school_motto?: string | null;
  authorized_signatory_name?: string | null;
  authorized_signatory_title?: string | null;
};

const DEFAULT: PrintProfile = {
  school_header: "",
  receipt_footer: "Thank you for your payment.",
  paper_size: "A4",
  currency: "KES",
  thermal_width_mm: 80,
  qr_enabled: true,
  po_box: "",
  physical_address: "",
  phone: "",
  email: "",
  school_motto: "",
  authorized_signatory_name: "",
  authorized_signatory_title: "Authorized Signatory",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border rounded-lg p-5 space-y-4">
      <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-sm">{label}</Label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {children}
    </div>
  );
}

export function PrintSettingsPage({ appTitle, nav, activeHref }: PrintSettingsPageProps) {
  const [profile, setProfile] = useState<PrintProfile>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<PrintProfile>("/tenants/print-profile");
      setProfile({
        ...DEFAULT,
        ...data,
        school_header: data.school_header ?? "",
        receipt_footer: data.receipt_footer ?? "Thank you for your payment.",
        po_box: data.po_box ?? "",
        physical_address: data.physical_address ?? "",
        phone: data.phone ?? "",
        email: data.email ?? "",
        school_motto: data.school_motto ?? "",
        authorized_signatory_name: data.authorized_signatory_name ?? "",
        authorized_signatory_title: data.authorized_signatory_title ?? "Authorized Signatory",
      });
      setDirty(false);
    } catch {
      toast.error("Failed to load print settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function update<K extends keyof PrintProfile>(key: K, value: PrintProfile[K]) {
    setProfile((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      await api.put("/tenants/print-profile", {
        school_header: profile.school_header?.trim() || null,
        receipt_footer: profile.receipt_footer?.trim() || null,
        paper_size: profile.paper_size || "A4",
        currency: profile.currency?.trim().toUpperCase() || "KES",
        thermal_width_mm: Number(profile.thermal_width_mm || 80),
        qr_enabled: Boolean(profile.qr_enabled),
        po_box: profile.po_box?.trim() || null,
        physical_address: profile.physical_address?.trim() || null,
        phone: profile.phone?.trim() || null,
        email: profile.email?.trim() || null,
        school_motto: profile.school_motto?.trim() || null,
        authorized_signatory_name: profile.authorized_signatory_name?.trim() || null,
        authorized_signatory_title: profile.authorized_signatory_title?.trim() || null,
      });
      toast.success("Print settings saved.");
      setDirty(false);
    } catch {
      toast.error("Failed to save print settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell title={appTitle} nav={nav} activeHref={activeHref}>
      <div className="max-w-2xl mx-auto py-6 px-4 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Printer className="h-5 w-5 text-muted-foreground" />
            <div>
              <h1 className="text-lg font-semibold">Print Settings</h1>
              <p className="text-sm text-muted-foreground">
                Customize how receipts, invoices, and reports are printed.
              </p>
            </div>
          </div>
          <Button
            onClick={save}
            disabled={saving || !dirty || loading}
            size="sm"
            className="gap-2"
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving…" : dirty ? "Save Changes" : "Saved"}
          </Button>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
        ) : (
          <div className="space-y-5">
            {/* School Identity */}
            <Section title="School Identity on Receipts">
              <Field label="School Name (Header)" hint="Printed at the top of every receipt">
                <Input
                  value={profile.school_header ?? ""}
                  onChange={(e) => update("school_header", e.target.value)}
                  placeholder="e.g. Novel Junior School"
                  maxLength={500}
                />
              </Field>
              <Field label="School Motto" hint="Printed below the school name">
                <Input
                  value={profile.school_motto ?? ""}
                  onChange={(e) => update("school_motto", e.target.value)}
                  placeholder="e.g. Excellence Through Discipline"
                  maxLength={500}
                />
              </Field>
            </Section>

            {/* Contact Details */}
            <Section title="Contact Details">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="P.O. Box">
                  <Input
                    value={profile.po_box ?? ""}
                    onChange={(e) => update("po_box", e.target.value)}
                    placeholder="e.g. 1234-00100 Nairobi"
                    maxLength={100}
                  />
                </Field>
                <Field label="Phone">
                  <Input
                    value={profile.phone ?? ""}
                    onChange={(e) => update("phone", e.target.value)}
                    placeholder="e.g. +254 700 000 000"
                    maxLength={50}
                  />
                </Field>
              </div>
              <Field label="Physical Address">
                <Input
                  value={profile.physical_address ?? ""}
                  onChange={(e) => update("physical_address", e.target.value)}
                  placeholder="e.g. Thika Road, off Runda Estate, Nairobi"
                  maxLength={300}
                />
              </Field>
              <Field label="Email">
                <Input
                  type="email"
                  value={profile.email ?? ""}
                  onChange={(e) => update("email", e.target.value)}
                  placeholder="e.g. accounts@school.ac.ke"
                  maxLength={255}
                />
              </Field>
            </Section>

            {/* Signatory */}
            <Section title="Authorized Signatory">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Name" hint="Printed above the signature line">
                  <Input
                    value={profile.authorized_signatory_name ?? ""}
                    onChange={(e) => update("authorized_signatory_name", e.target.value)}
                    placeholder="e.g. John Kamau"
                    maxLength={200}
                  />
                </Field>
                <Field label="Title">
                  <Input
                    value={profile.authorized_signatory_title ?? ""}
                    onChange={(e) => update("authorized_signatory_title", e.target.value)}
                    placeholder="e.g. Finance Officer"
                    maxLength={200}
                  />
                </Field>
              </div>
            </Section>

            {/* Receipt Footer */}
            <Section title="Receipt Footer">
              <Field label="Footer Message" hint="Printed at the bottom of every receipt">
                <Textarea
                  value={profile.receipt_footer ?? ""}
                  onChange={(e) => update("receipt_footer", e.target.value)}
                  placeholder="Thank you for your payment."
                  rows={2}
                  maxLength={500}
                />
              </Field>
            </Section>

            {/* Paper & Format */}
            <Section title="Paper Format">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Default Paper Size">
                  <Select
                    value={profile.paper_size ?? "A4"}
                    onValueChange={(v) => update("paper_size", v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A4">A4 (Full Page)</SelectItem>
                      <SelectItem value="THERMAL_80MM">Thermal 80mm</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Currency Code">
                  <Input
                    value={profile.currency ?? "KES"}
                    onChange={(e) => update("currency", e.target.value)}
                    placeholder="KES"
                    maxLength={10}
                    className="uppercase"
                  />
                </Field>
              </div>

              {profile.paper_size === "THERMAL_80MM" && (
                <Field label="Thermal Roll Width (mm)">
                  <Input
                    type="number"
                    min={58}
                    max={120}
                    value={profile.thermal_width_mm ?? 80}
                    onChange={(e) =>
                      update("thermal_width_mm", parseInt(e.target.value) || 80)
                    }
                  />
                </Field>
              )}
            </Section>

            {/* QR Verification */}
            <Section title="Receipt QR Verification">
              <div className="flex items-center justify-between rounded-md border p-4">
                <div>
                  <p className="text-sm font-medium">Embed QR Code on Receipts</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    A QR code linking to the public receipt verification page is embedded on
                    every printed receipt. Scanning it confirms authenticity without logging in.
                  </p>
                </div>
                <Button
                  type="button"
                  variant={profile.qr_enabled ? "default" : "outline"}
                  size="sm"
                  onClick={() => update("qr_enabled", !profile.qr_enabled)}
                >
                  {profile.qr_enabled ? "Enabled" : "Disabled"}
                </Button>
              </div>
              {profile.qr_enabled && (
                <p className="text-xs text-muted-foreground">
                  Receipts will include a QR code linking to{" "}
                  <span className="font-mono">
                    [your-school].shulehq.co.ke/verify/receipt?token=…
                  </span>{" "}
                  — scannable by anyone to verify authenticity.
                </p>
              )}
            </Section>
          </div>
        )}
      </div>
    </AppShell>
  );
}
