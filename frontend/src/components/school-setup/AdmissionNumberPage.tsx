"use client";

import { useCallback, useEffect, useState } from "react";
import { Hash, Save, Info } from "lucide-react";

import { AppShell, type AppNavItem } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";

type AdmissionSettings = {
  prefix: string;
  last_number: number;
};

type Props = {
  title: string;
  nav: AppNavItem[];
  activeHref: string;
  readOnly?: boolean;
};

function preview(prefix: string, lastNumber: number): string {
  const next = lastNumber + 1;
  if (!prefix) return String(next);
  return `${prefix}${String(next).padStart(4, "0")}`;
}

export function AdmissionNumberPage({ title, nav, activeHref, readOnly }: Props) {
  const [prefix, setPrefix] = useState("ADM-");
  const [lastNumber, setLastNumber] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<AdmissionSettings>("/tenants/admission-settings");
      setPrefix(data.prefix ?? "ADM-");
      setLastNumber(data.last_number ?? 0);
      setDirty(false);
    } catch {
      toast.error("Failed to load admission settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (lastNumber < 0) {
      toast.error("Last admission number cannot be negative.");
      return;
    }
    setSaving(true);
    try {
      await api.put("/tenants/admission-settings", { prefix, last_number: lastNumber });
      toast.success("Admission number settings saved.");
      setDirty(false);
    } catch {
      toast.error("Failed to save admission settings.");
    } finally {
      setSaving(false);
    }
  }

  const nextPreview = preview(prefix, lastNumber);

  return (
    <AppShell title={title} nav={nav} activeHref={activeHref}>
      <div className="max-w-xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center gap-3">
          <Hash className="h-6 w-6 text-slate-500" />
          <div>
            <h1 className="text-xl font-semibold">Admission Number Counter</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Configure how admission numbers are formatted and where the counter starts.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="animate-pulse space-y-4">
            <div className="h-10 bg-slate-100 rounded-lg" />
            <div className="h-10 bg-slate-100 rounded-lg" />
          </div>
        ) : (
          <div className="border rounded-xl p-6 space-y-6 bg-white">
            {/* Prefix */}
            <div className="space-y-1.5">
              <Label htmlFor="prefix">Admission Number Prefix</Label>
              <p className="text-xs text-muted-foreground">
                Optional text placed before the number. Leave blank for plain numbers (e.g.{" "}
                <span className="font-mono">6021</span>). Common examples:{" "}
                <span className="font-mono">ADM-</span>,{" "}
                <span className="font-mono">SCH/</span>,{" "}
                <span className="font-mono">STD-</span>.
              </p>
              <Input
                id="prefix"
                placeholder="e.g. ADM- or leave blank"
                value={prefix}
                onChange={(e) => { setPrefix(e.target.value); setDirty(true); }}
                maxLength={30}
                disabled={readOnly}
              />
            </div>

            {/* Last number */}
            <div className="space-y-1.5">
              <Label htmlFor="last_number">Last Admission Number Issued</Label>
              <p className="text-xs text-muted-foreground">
                Enter the number of the last student who was admitted before this system was set up.
                The next student added will receive the number after this.
              </p>
              <Input
                id="last_number"
                type="number"
                min={0}
                step={1}
                placeholder="e.g. 350"
                value={lastNumber}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  setLastNumber(isNaN(v) ? 0 : v);
                  setDirty(true);
                }}
                disabled={readOnly}
              />
            </div>

            {/* Preview */}
            <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-3 flex items-start gap-3">
              <Info className="h-4 w-4 mt-0.5 text-blue-500 shrink-0" />
              <div className="text-sm text-blue-800">
                <span className="font-medium">Next admission number will be: </span>
                <span className="font-mono font-bold">{nextPreview}</span>
              </div>
            </div>

            {!readOnly && (
              <div className="flex justify-end">
                <Button onClick={save} disabled={saving || !dirty}>
                  <Save className="h-4 w-4 mr-2" />
                  {saving ? "Saving…" : "Save Settings"}
                </Button>
              </div>
            )}
          </div>
        )}

        <div className="rounded-lg bg-amber-50 border border-amber-100 px-4 py-3 text-sm text-amber-800 space-y-1">
          <p className="font-medium">How this works</p>
          <ul className="list-disc list-inside space-y-1 text-xs">
            <li>
              When a new student is enrolled, the system picks the highest existing number
              (from the database <em>and</em> the value above) then adds 1.
            </li>
            <li>
              If your school previously used paper records and the last student got number{" "}
              <span className="font-mono">350</span>, set the counter to{" "}
              <span className="font-mono">350</span>. The next student will get{" "}
              <span className="font-mono">{prefix || ""}351</span>.
            </li>
            <li>
              The prefix is just a display label — only the numeric part is used for sequencing.
            </li>
          </ul>
        </div>
      </div>
    </AppShell>
  );
}
