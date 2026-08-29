"use client";

import { useCallback, useEffect, useState } from "react";
import { BookOpenCheck, ChevronDown, ChevronRight, Loader2, TrendingUp } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { parentNav } from "@/components/layout/nav-config";
import { api } from "@/lib/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── Types ────────────────────────────────────────────────────────────────────

type TermOption = {
  term_id: string;
  term_name: string;
  term_code: string;
  is_active: boolean;
};

type ReportSubStrand = {
  sub_strand_id: string;
  sub_strand_name: string;
  sub_strand_code: string;
  performance_level: string;
  teacher_observations?: string | null;
};

type ReportStrand = {
  strand_id: string;
  strand_name: string;
  strand_code: string;
  sub_strands: ReportSubStrand[];
};

type ReportLearningArea = {
  learning_area_id: string;
  learning_area_name: string;
  learning_area_code: string;
  grade_band: string;
  strands: ReportStrand[];
};

type CbcReport = {
  enrollment_id: string;
  student_name: string;
  admission_no: string;
  class_name: string;
  class_code: string;
  term_name: string;
  academic_year: string;
  class_teacher_comment: string;
  principal_comment: string;
  conduct: string;
  next_term_begins: string;
  learning_areas: ReportLearningArea[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const LEVEL_STYLE: Record<string, { badge: string; bar: string; label: string }> = {
  EE: { badge: "bg-blue-100 text-blue-700 border border-blue-200",   bar: "bg-blue-500",  label: "Exceeding Expectation" },
  ME: { badge: "bg-green-100 text-green-700 border border-green-200", bar: "bg-green-500", label: "Meeting Expectation" },
  AE: { badge: "bg-amber-100 text-amber-700 border border-amber-200", bar: "bg-amber-400", label: "Approaching Expectation" },
  BE: { badge: "bg-red-100 text-red-700 border border-red-200",       bar: "bg-red-500",   label: "Below Expectation" },
};

function levelBadge(level: string) {
  const s = LEVEL_STYLE[level] ?? { badge: "bg-slate-100 text-[var(--tenant-muted)]", label: level };
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${s.badge}`}>
      {level} — {s.label}
    </span>
  );
}

function overallLevel(areas: ReportLearningArea[]): string {
  const counts: Record<string, number> = { BE: 0, AE: 0, ME: 0, EE: 0 };
  for (const la of areas) {
    for (const strand of la.strands) {
      for (const ss of strand.sub_strands) {
        counts[ss.performance_level] = (counts[ss.performance_level] ?? 0) + 1;
      }
    }
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return "—";
  const dominant = (["EE", "ME", "AE", "BE"] as const).find(
    (l) => counts[l] / total > 0.4
  );
  return dominant ?? "Mixed";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LearningAreaCard({ la }: { la: ReportLearningArea }) {
  const [open, setOpen] = useState(true);
  const allSubs = la.strands.flatMap((s) => s.sub_strands);
  const counts = { BE: 0, AE: 0, ME: 0, EE: 0 };
  for (const ss of allSubs) {
    counts[ss.performance_level as keyof typeof counts] =
      (counts[ss.performance_level as keyof typeof counts] ?? 0) + 1;
  }
  const total = allSubs.length;

  return (
    <div className="rounded-2xl border border-[var(--tenant-border)] bg-[var(--tenant-surface)] shadow-sm overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-[var(--tenant-surface-2)] transition text-left"
      >
        <div>
          <p className="font-semibold text-[var(--tenant-ink)]">{la.learning_area_name}</p>
          <p className="text-xs text-[var(--tenant-muted)] mt-0.5">{la.grade_band.replace(/_/g, " ")} · {total} sub-strand{total !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Mini distribution */}
          <div className="hidden sm:flex gap-1">
            {(["EE", "ME", "AE", "BE"] as const).map((lvl) => counts[lvl] > 0 && (
              <span key={lvl} className={`px-1.5 py-0.5 rounded text-xs font-bold ${LEVEL_STYLE[lvl].badge}`}>
                {lvl} {counts[lvl]}
              </span>
            ))}
          </div>
          {open ? <ChevronDown className="h-4 w-4 text-[var(--tenant-muted)]" /> : <ChevronRight className="h-4 w-4 text-[var(--tenant-muted)]" />}
        </div>
      </button>

      {/* Progress bar */}
      {total > 0 && (
        <div className="flex h-2 w-full">
          {(["EE", "ME", "AE", "BE"] as const).map((lvl) => (
            counts[lvl] > 0 && (
              <div
                key={lvl}
                className={LEVEL_STYLE[lvl].bar}
                style={{ width: `${(counts[lvl] / total) * 100}%` }}
                title={`${lvl}: ${counts[lvl]}`}
              />
            )
          ))}
        </div>
      )}

      {/* Strand breakdown */}
      {open && (
        <div className="divide-y divide-[var(--tenant-border)]">
          {la.strands.map((strand) => (
            <div key={strand.strand_id} className="px-5 py-3">
              <p className="text-xs font-semibold text-[var(--tenant-muted)] uppercase tracking-wide mb-2">{strand.strand_name}</p>
              <div className="space-y-1.5">
                {strand.sub_strands.map((ss) => (
                  <div key={ss.sub_strand_id} className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[var(--tenant-ink)] truncate">{ss.sub_strand_name}</p>
                      {ss.teacher_observations && (
                        <p className="text-xs text-[var(--tenant-muted)] mt-0.5 italic">"{ss.teacher_observations}"</p>
                      )}
                    </div>
                    {levelBadge(ss.performance_level)}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ParentProgressPage() {
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [termId, setTermId] = useState<string>("");
  const [report, setReport] = useState<CbcReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [noData, setNoData] = useState(false);
  const [termLoading, setTermLoading] = useState(false);

  // Initial load: fetch terms + default report
  useEffect(() => {
    async function init() {
      setLoading(true);
      setNoData(false);
      try {
        const termList = await api.get<TermOption[]>("/portal/cbc/terms", { tenantRequired: true });
        const tl = Array.isArray(termList) ? termList : [];
        setTerms(tl);
        if (tl.length > 0) {
          setTermId(tl[0].term_id);
          const rpt = await api.get<CbcReport>(`/portal/cbc/report?term_id=${tl[0].term_id}`, { tenantRequired: true });
          setReport(rpt);
        } else {
          setNoData(true);
        }
      } catch {
        setNoData(true);
      } finally {
        setLoading(false);
      }
    }
    void init();
  }, []);

  const loadTerm = useCallback(async (tid: string) => {
    setTermId(tid);
    setTermLoading(true);
    try {
      const rpt = await api.get<CbcReport>(`/portal/cbc/report?term_id=${tid}`, { tenantRequired: true });
      setReport(rpt);
    } catch {
      setReport(null);
    } finally {
      setTermLoading(false);
    }
  }, []);

  if (loading) {
    return (
      <AppShell nav={parentNav} title="Progress">
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--tenant-primary)]" />
        </div>
      </AppShell>
    );
  }

  if (noData) {
    return (
      <AppShell nav={parentNav} title="Progress">
        <div className="mx-auto max-w-2xl px-4 py-16 text-center space-y-3">
          <BookOpenCheck className="h-12 w-12 text-[var(--tenant-muted)] opacity-40 mx-auto" />
          <p className="text-[var(--tenant-muted)] font-medium">No CBC progress reports available yet</p>
          <p className="text-[var(--tenant-muted)] text-sm">Your child's teacher will enter assessments at the end of each term. Check back then.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell nav={parentNav} title="My Child's Progress">
      <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
        {/* Hero */}
        <div className="dashboard-hero rounded-2xl px-5 py-5 text-white shadow-sm sm:px-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <p className="text-white/70 text-xs font-medium uppercase tracking-wide">CBC Learner Progress</p>
              <h1 className="text-2xl font-bold mt-1">{report?.student_name ?? "—"}</h1>
              <p className="text-white/70 text-sm mt-0.5">{report?.class_name} · {report?.academic_year}</p>
            </div>
            <div className="flex items-center gap-1.5 text-white/90 text-sm">
              <TrendingUp className="h-4 w-4" />
              {report && overallLevel(report.learning_areas)}
            </div>
          </div>
        </div>

        {/* Term selector */}
        {terms.length > 1 && (
          <div className="flex items-center gap-3">
            <p className="text-sm text-[var(--tenant-muted)] shrink-0">Showing results for:</p>
            <Select value={termId} onValueChange={(v) => void loadTerm(v)} disabled={termLoading}>
              <SelectTrigger className="h-9 w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {terms.map((t) => (
                  <SelectItem key={t.term_id} value={t.term_id}>
                    {t.term_name} {t.is_active ? "· Current" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {termLoading && <Loader2 className="h-4 w-4 animate-spin text-[var(--tenant-primary)]" />}
          </div>
        )}

        {/* Report */}
        {report && !termLoading && (
          <>
            {/* Learning areas */}
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-[var(--tenant-muted)] uppercase tracking-wide">
                Learning Areas — {report.term_name}
              </h2>
              {report.learning_areas.length === 0 ? (
                <div className="rounded-xl border border-[var(--tenant-border)] bg-[var(--tenant-surface)] p-8 text-center text-[var(--tenant-muted)] text-sm">
                  No assessments recorded for this term yet.
                </div>
              ) : (
                report.learning_areas.map((la) => (
                  <LearningAreaCard key={la.learning_area_id} la={la} />
                ))
              )}
            </div>

            {/* Teacher comments */}
            {(report.class_teacher_comment || report.principal_comment || report.conduct) && (
              <div className="rounded-2xl border border-[var(--tenant-border)] bg-[var(--tenant-surface)] shadow-sm p-5 space-y-4">
                <h2 className="text-sm font-semibold text-[var(--tenant-ink)]">Teacher Remarks</h2>
                {report.class_teacher_comment && (
                  <div>
                    <p className="text-xs text-[var(--tenant-muted)] mb-1">Class Teacher</p>
                    <p className="text-sm text-[var(--tenant-ink)] italic">"{report.class_teacher_comment}"</p>
                  </div>
                )}
                {report.principal_comment && (
                  <div>
                    <p className="text-xs text-[var(--tenant-muted)] mb-1">Principal</p>
                    <p className="text-sm text-[var(--tenant-ink)] italic">"{report.principal_comment}"</p>
                  </div>
                )}
                {report.conduct && (
                  <div>
                    <p className="text-xs text-[var(--tenant-muted)] mb-1">Conduct</p>
                    <p className="text-sm font-semibold text-[var(--tenant-ink)]">{report.conduct}</p>
                  </div>
                )}
                {report.next_term_begins && (
                  <p className="text-xs text-[var(--tenant-muted)] pt-2 border-t border-[var(--tenant-border)]">
                    Next term begins: <span className="font-medium">{report.next_term_begins}</span>
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
