"use client";

import { useCallback, useEffect, useState } from "react";
import { BookOpenText, RefreshCw, Save } from "lucide-react";

import { AppShell, type AppNavItem } from "@/components/layout/AppShell";
import { TenantPageHeader } from "@/components/tenant/page-chrome";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { api, apiFetch } from "@/lib/api";

type CurriculumType = "CBC" | "8-4-4" | "IGCSE";

type Props = {
  appTitle: string;
  nav: AppNavItem[];
  activeHref: string;
  readonly?: boolean;
};

const CURRICULA: { value: CurriculumType; label: string; description: string }[] = [
  {
    value: "CBC",
    label: "CBC — Competency Based Curriculum",
    description:
      "Kenyan competency-based curriculum. Graded by strand/sub-strand performance levels: BE · AE · ME · EE.",
  },
  {
    value: "8-4-4",
    label: "8-4-4",
    description:
      "Traditional Kenyan system. Subjects graded 0–100 with letter grades. Generates term report cards with class positions.",
  },
  {
    value: "IGCSE",
    label: "IGCSE — Cambridge International",
    description:
      "Cambridge IGCSE curriculum. Subject grades A*–G. Cambridge-style transcript format.",
  },
];

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function CurriculumSetupPage({ appTitle, nav, activeHref, readonly = false }: Props) {
  const [current, setCurrent] = useState<CurriculumType>("CBC");
  const [selected, setSelected] = useState<CurriculumType>("CBC");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const raw = await api.get<unknown>("/tenants/profile", { tenantRequired: true });
      const obj = asObject(raw);
      const ct = ((obj?.curriculum_type as string) || "CBC").toUpperCase() as CurriculumType;
      const safe: CurriculumType = ["CBC", "8-4-4", "IGCSE"].includes(ct) ? ct : "CBC";
      setCurrent(safe);
      setSelected(safe);
    } catch {
      toast.error("Failed to load curriculum type.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (readonly) return;
    setSaving(true);
    try {
      const raw = await apiFetch<unknown>("/tenants/profile", {
        method: "PUT",
        tenantRequired: true,
        body: JSON.stringify({ curriculum_type: selected }),
      });
      const obj = asObject(raw);
      const ct = ((obj?.curriculum_type as string) || selected).toUpperCase() as CurriculumType;
      setCurrent(ct);
      setSelected(ct);
      toast.success(`Curriculum type set to ${ct}.`);
    } catch {
      toast.error("Failed to update curriculum type.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <AppShell title={appTitle} nav={nav} activeHref={activeHref}>
        <div className="flex min-h-[380px] items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            <p className="text-sm text-slate-500">Loading…</p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title={appTitle} nav={nav} activeHref={activeHref}>
      <div className="space-y-6">
        <TenantPageHeader
          title="Curriculum Type"
          description="Set the academic curriculum framework for this school. This drives report card formats, grading logic, and assessment types."
          badges={[{ label: "School Setup" }]}
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load()}
              className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Refresh
            </Button>
          }
        />

        <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 px-6 py-4">
            <BookOpenText className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-900">Curriculum Framework</h2>
            {!readonly && (
              <span className="ml-auto text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                Changes affect report cards and grading
              </span>
            )}
          </div>

          <div className="space-y-3 p-6">
            {CURRICULA.map((c) => {
              const isActive = current === c.value;
              const isSelected = selected === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  disabled={readonly}
                  onClick={() => !readonly && setSelected(c.value)}
                  className={`w-full rounded-xl border-2 p-4 text-left transition-all disabled:cursor-default ${
                    isSelected
                      ? "border-blue-500 bg-blue-50"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-4 w-4 rounded-full border-2 flex-shrink-0 ${
                        isSelected
                          ? "border-blue-500 bg-blue-500"
                          : "border-slate-300 bg-white"
                      }`}
                    >
                      {isSelected && (
                        <div className="m-auto h-1.5 w-1.5 rounded-full bg-white" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-semibold ${isSelected ? "text-blue-900" : "text-slate-800"}`}>
                          {c.label}
                        </p>
                        {isActive && (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                            Current
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">{c.description}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {!readonly && (
            <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4">
              <p className="text-xs text-slate-500">
                {selected !== current
                  ? `Changing from ${current} → ${selected}`
                  : "No changes"}
              </p>
              <Button
                onClick={() => void save()}
                disabled={saving || selected === current}
              >
                <Save className="mr-1.5 h-3.5 w-3.5" />
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          )}

          {readonly && (
            <div className="border-t border-slate-100 px-6 py-3">
              <p className="text-xs text-slate-400">
                Contact the director to change the curriculum type.
              </p>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
