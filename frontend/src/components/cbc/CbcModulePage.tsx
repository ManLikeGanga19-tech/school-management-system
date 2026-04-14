"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  BookOpenCheck,
  BookOpenText,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Download,
  FileBarChart,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Sprout,
  X,
} from "lucide-react";

import { AppShell, type AppNavItem } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { api } from "@/lib/api";
import { normalizeTerms, type TenantTerm } from "@/lib/school-setup/terms";
import { normalizeClassOptions, type TenantClassOption } from "@/lib/hr";
import { normalizeEnrollmentRows, studentName, type EnrollmentRow } from "@/lib/students";

// ── Types ─────────────────────────────────────────────────────────────────────

type GradeBand = "LOWER_PRIMARY" | "UPPER_PRIMARY" | "JUNIOR_SECONDARY";

type SubStrand = {
  id: string;
  name: string;
  code: string;
  display_order: number;
  is_active: boolean;
};

type Strand = {
  id: string;
  name: string;
  code: string;
  display_order: number;
  is_active: boolean;
  sub_strands: SubStrand[];
};

type LearningArea = {
  id: string;
  name: string;
  code: string;
  grade_band: GradeBand;
  display_order: number;
  is_active: boolean;
  strands: Strand[];
};

type CurriculumTree = {
  learning_areas: LearningArea[];
};

type Assessment = {
  id: string;
  enrollment_id: string;
  student_id: string;
  sub_strand_id: string;
  term_id: string;
  performance_level: "BE" | "AE" | "ME" | "EE";
  teacher_observations?: string | null;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const GRADE_BANDS: { value: GradeBand; label: string }[] = [
  { value: "LOWER_PRIMARY",    label: "Lower Primary (Grades 1–3)" },
  { value: "UPPER_PRIMARY",    label: "Upper Primary (Grades 4–6)" },
  { value: "JUNIOR_SECONDARY", label: "Junior Secondary (Grades 7–9)" },
];

const PERFORMANCE_LEVELS: { value: string; label: string; color: string }[] = [
  { value: "BE", label: "BE — Below Expectation",        color: "bg-red-100 text-red-700 border-red-200" },
  { value: "AE", label: "AE — Approaching Expectation",  color: "bg-amber-100 text-amber-700 border-amber-200" },
  { value: "ME", label: "ME — Meeting Expectation",      color: "bg-green-100 text-green-700 border-green-200" },
  { value: "EE", label: "EE — Exceeding Expectation",    color: "bg-blue-100 text-blue-700 border-blue-200" },
];

const LEVEL_BADGE: Record<string, string> = {
  BE: "bg-red-100 text-red-700 border border-red-200",
  AE: "bg-amber-100 text-amber-700 border border-amber-200",
  ME: "bg-green-100 text-green-700 border border-green-200",
  EE: "bg-blue-100 text-blue-700 border border-blue-200",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeCurriculum(data: unknown): CurriculumTree {
  if (!data || typeof data !== "object") return { learning_areas: [] };
  const d = data as Record<string, unknown>;
  return {
    learning_areas: Array.isArray(d.learning_areas)
      ? (d.learning_areas as LearningArea[])
      : [],
  };
}

function normalizeAssessments(data: unknown): Assessment[] {
  return Array.isArray(data) ? (data as Assessment[]) : [];
}

// ── Component ─────────────────────────────────────────────────────────────────

type CbcModulePageProps = {
  title: string;
  nav: AppNavItem[];
  canManageCurriculum?: boolean;
};

export function CbcModulePage({ title, nav, canManageCurriculum = false }: CbcModulePageProps) {
  const searchParams = useSearchParams();
  const section = (searchParams.get("section") ?? "assessments") as "assessments" | "curriculum" | "reports" | "analytics";

  return (
    <AppShell title={title} nav={nav}>
      <div className="p-4 md:p-6 space-y-4">
        {section === "curriculum" && (
          <CurriculumTab canManage={canManageCurriculum} />
        )}
        {section === "assessments" && (
          <AssessmentsTab />
        )}
        {section === "reports" && (
          <ReportsTab />
        )}
        {section === "analytics" && (
          <AnalyticsTab />
        )}
      </div>
    </AppShell>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TAB: Curriculum Management
// ═══════════════════════════════════════════════════════════════════

type CurriculumTabProps = { canManage: boolean };

function CurriculumTab({ canManage }: CurriculumTabProps) {
  const [curriculum, setCurriculum] = useState<CurriculumTree>({ learning_areas: [] });
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [filterBand, setFilterBand] = useState<string>("all");
  const [expandedLAs, setExpandedLAs] = useState<Set<string>>(new Set());
  const [expandedStrands, setExpandedStrands] = useState<Set<string>>(new Set());

  // Dialogs
  const [laDialog, setLaDialog] = useState(false);
  const [strandDialog, setStrandDialog] = useState(false);
  const [ssDialog, setSsDialog] = useState(false);
  const [editTarget, setEditTarget] = useState<{ type: "la" | "strand" | "ss"; item: LearningArea | Strand | SubStrand } | null>(null);
  const [laForm, setLaForm] = useState({ name: "", code: "", grade_band: "LOWER_PRIMARY" as GradeBand, display_order: 0 });
  const [strandForm, setStrandForm] = useState({ name: "", code: "", learning_area_id: "", display_order: 0 });
  const [ssForm, setSsForm] = useState({ name: "", code: "", strand_id: "", display_order: 0 });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const band = filterBand === "all" ? "" : `?grade_band=${filterBand}&active_only=false`;
      const res = await api.get(`/cbc/curriculum${band}`);
      setCurriculum(normalizeCurriculum(res));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to load curriculum");
    } finally {
      setLoading(false);
    }
  }, [filterBand]);

  useEffect(() => { load(); }, [load]);

  const toggleLA = (id: string) => {
    setExpandedLAs(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  };

  const toggleStrand = (id: string) => {
    setExpandedStrands(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  };

  const handleSeed = async () => {
    setSeeding(true);
    try {
      await api.post("/cbc/curriculum/seed", {});
      toast.success("Default Kenya CBC curriculum seeded");
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Seed failed");
    } finally {
      setSeeding(false);
    }
  };

  const openEditLA = (la: LearningArea) => {
    setLaForm({ name: la.name, code: la.code, grade_band: la.grade_band, display_order: la.display_order });
    setEditTarget({ type: "la", item: la });
    setLaDialog(true);
  };

  const openEditStrand = (s: Strand) => {
    setStrandForm({ name: s.name, code: s.code, learning_area_id: "", display_order: s.display_order });
    setEditTarget({ type: "strand", item: s });
    setStrandDialog(true);
  };

  const openEditSS = (ss: SubStrand) => {
    setSsForm({ name: ss.name, code: ss.code, strand_id: "", display_order: ss.display_order });
    setEditTarget({ type: "ss", item: ss });
    setSsDialog(true);
  };

  const saveLearningArea = async () => {
    setSaving(true);
    try {
      if (editTarget?.type === "la") {
        await api.patch(`/cbc/curriculum/learning-areas/${editTarget.item.id}`, laForm);
        toast.success("Learning area updated");
      } else {
        await api.post("/cbc/curriculum/learning-areas", laForm);
        toast.success("Learning area created");
      }
      setLaDialog(false);
      setEditTarget(null);
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const saveStrand = async () => {
    setSaving(true);
    try {
      if (editTarget?.type === "strand") {
        await api.patch(`/cbc/curriculum/strands/${editTarget.item.id}`, strandForm);
        toast.success("Strand updated");
      } else {
        await api.post("/cbc/curriculum/strands", strandForm);
        toast.success("Strand created");
      }
      setStrandDialog(false);
      setEditTarget(null);
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const saveSubStrand = async () => {
    setSaving(true);
    try {
      if (editTarget?.type === "ss") {
        await api.patch(`/cbc/curriculum/sub-strands/${editTarget.item.id}`, ssForm);
        toast.success("Sub-strand updated");
      } else {
        await api.post("/cbc/curriculum/sub-strands", ssForm);
        toast.success("Sub-strand created");
      }
      setSsDialog(false);
      setEditTarget(null);
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <BookOpenText className="h-5 w-5 text-blue-600" />
            CBC Curriculum Structure
          </h2>
          <p className="text-sm text-slate-500">Learning areas → Strands → Sub-strands</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Select value={filterBand} onValueChange={setFilterBand}>
            <SelectTrigger className="w-48 h-8 text-sm">
              <SelectValue placeholder="All grade bands" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Grade Bands</SelectItem>
              {GRADE_BANDS.map(b => (
                <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          {canManage && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSeed}
                disabled={seeding || curriculum.learning_areas.length > 0}
                title={curriculum.learning_areas.length > 0 ? "Curriculum already seeded" : undefined}
              >
                <Sprout className="h-3.5 w-3.5 mr-1" />
                {seeding ? "Seeding…" : curriculum.learning_areas.length > 0 ? "Already Seeded" : "Seed Kenya CBC"}
              </Button>
              <Button size="sm" onClick={() => { setEditTarget(null); setLaForm({ name: "", code: "", grade_band: "LOWER_PRIMARY", display_order: 0 }); setLaDialog(true); }}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Learning Area
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Tree */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : curriculum.learning_areas.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-slate-500">
          <BookOpenCheck className="mx-auto mb-2 h-8 w-8 opacity-40" />
          <p className="text-sm">No curriculum structure found.</p>
          {canManage && (
            <p className="text-xs mt-1">Click "Seed Kenya CBC" to load the default Kenya curriculum.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {curriculum.learning_areas.map(la => (
            <div key={la.id} className="rounded-lg border bg-white overflow-hidden">
              {/* Learning Area row */}
              <div
                className="flex items-center justify-between px-4 py-2.5 bg-blue-50 cursor-pointer hover:bg-blue-100 transition-colors"
                onClick={() => toggleLA(la.id)}
              >
                <div className="flex items-center gap-2">
                  {expandedLAs.has(la.id) ? <ChevronDown className="h-4 w-4 text-blue-600" /> : <ChevronRight className="h-4 w-4 text-blue-600" />}
                  <span className="font-semibold text-sm text-blue-800">{la.name}</span>
                  <span className="text-xs text-blue-500 font-mono">{la.code}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 border border-blue-200">
                    {la.grade_band.replace(/_/g, " ")}
                  </span>
                  {!la.is_active && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">Inactive</span>
                  )}
                </div>
                <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  <span className="text-xs text-slate-400 mr-2">{la.strands.length} strand{la.strands.length !== 1 ? "s" : ""}</span>
                  {canManage && (
                    <>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditLA(la)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                        setStrandForm({ name: "", code: "", learning_area_id: la.id, display_order: 0 });
                        setEditTarget(null);
                        setStrandDialog(true);
                      }}>
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {/* Strands */}
              {expandedLAs.has(la.id) && (
                <div className="divide-y">
                  {la.strands.map(strand => (
                    <div key={strand.id}>
                      <div
                        className="flex items-center justify-between px-6 py-2 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors"
                        onClick={() => toggleStrand(strand.id)}
                      >
                        <div className="flex items-center gap-2">
                          {expandedStrands.has(strand.id) ? <ChevronDown className="h-3.5 w-3.5 text-slate-500" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-500" />}
                          <span className="text-sm font-medium">{strand.name}</span>
                          <span className="text-xs font-mono text-slate-400">{strand.code}</span>
                          {!strand.is_active && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">Inactive</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          <span className="text-xs text-slate-400 mr-2">{strand.sub_strands.length} sub-strand{strand.sub_strands.length !== 1 ? "s" : ""}</span>
                          {canManage && (
                            <>
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEditStrand(strand)}>
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => {
                                setSsForm({ name: "", code: "", strand_id: strand.id, display_order: 0 });
                                setEditTarget(null);
                                setSsDialog(true);
                              }}>
                                <Plus className="h-3 w-3" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Sub-strands */}
                      {expandedStrands.has(strand.id) && (
                        <div className="divide-y">
                          {strand.sub_strands.map(ss => (
                            <div key={ss.id} className="flex items-center justify-between px-10 py-1.5 hover:bg-slate-50">
                              <div className="flex items-center gap-2">
                                <span className="text-sm">{ss.name}</span>
                                <span className="text-xs font-mono text-slate-400">{ss.code}</span>
                                {!ss.is_active && (
                                  <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">Inactive</span>
                                )}
                              </div>
                              {canManage && (
                                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEditSS(ss)}>
                                  <Pencil className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Learning Area Dialog */}
      <Dialog open={laDialog} onOpenChange={setLaDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editTarget?.type === "la" ? "Edit Learning Area" : "New Learning Area"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={laForm.name} onChange={e => setLaForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. English Language" />
            </div>
            <div className="space-y-1">
              <Label>Code</Label>
              <Input value={laForm.code} onChange={e => setLaForm(p => ({ ...p, code: e.target.value }))} placeholder="e.g. ENG-UP" className="uppercase" />
            </div>
            <div className="space-y-1">
              <Label>Grade Band</Label>
              <Select value={laForm.grade_band} onValueChange={v => setLaForm(p => ({ ...p, grade_band: v as GradeBand }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GRADE_BANDS.map(b => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Display Order</Label>
              <Input type="number" min="0" value={laForm.display_order} onChange={e => setLaForm(p => ({ ...p, display_order: parseInt(e.target.value) || 0 }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLaDialog(false)}>Cancel</Button>
            <Button onClick={saveLearningArea} disabled={saving || !laForm.name || !laForm.code}>
              {saving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              <Save className="h-3.5 w-3.5 mr-1" />
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Strand Dialog */}
      <Dialog open={strandDialog} onOpenChange={setStrandDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editTarget?.type === "strand" ? "Edit Strand" : "New Strand"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={strandForm.name} onChange={e => setStrandForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Reading" />
            </div>
            <div className="space-y-1">
              <Label>Code</Label>
              <Input value={strandForm.code} onChange={e => setStrandForm(p => ({ ...p, code: e.target.value }))} placeholder="e.g. RD" className="uppercase" />
            </div>
            <div className="space-y-1">
              <Label>Display Order</Label>
              <Input type="number" min="0" value={strandForm.display_order} onChange={e => setStrandForm(p => ({ ...p, display_order: parseInt(e.target.value) || 0 }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStrandDialog(false)}>Cancel</Button>
            <Button onClick={saveStrand} disabled={saving || !strandForm.name || !strandForm.code}>
              {saving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              <Save className="h-3.5 w-3.5 mr-1" />
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sub-strand Dialog */}
      <Dialog open={ssDialog} onOpenChange={setSsDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editTarget?.type === "ss" ? "Edit Sub-strand" : "New Sub-strand"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={ssForm.name} onChange={e => setSsForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Reading Comprehension" />
            </div>
            <div className="space-y-1">
              <Label>Code</Label>
              <Input value={ssForm.code} onChange={e => setSsForm(p => ({ ...p, code: e.target.value }))} placeholder="e.g. RD1" className="uppercase" />
            </div>
            <div className="space-y-1">
              <Label>Display Order</Label>
              <Input type="number" min="0" value={ssForm.display_order} onChange={e => setSsForm(p => ({ ...p, display_order: parseInt(e.target.value) || 0 }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSsDialog(false)}>Cancel</Button>
            <Button onClick={saveSubStrand} disabled={saving || !ssForm.name || !ssForm.code}>
              {saving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              <Save className="h-3.5 w-3.5 mr-1" />
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TAB: Assessments Entry
// ═══════════════════════════════════════════════════════════════════

function AssessmentsTab() {
  const [terms, setTerms] = useState<TenantTerm[]>([]);
  const [classes, setClasses] = useState<TenantClassOption[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);
  const [curriculum, setCurriculum] = useState<CurriculumTree>({ learning_areas: [] });
  const [existingAssessments, setExistingAssessments] = useState<Assessment[]>([]);

  const [selectedTerm, setSelectedTerm] = useState("");
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedEnrollment, setSelectedEnrollment] = useState("");
  const [filterBand, setFilterBand] = useState<string>("all");

  const [loadingEnrollments, setLoadingEnrollments] = useState(false);
  const [loadingCurriculum, setLoadingCurriculum] = useState(false);
  const [saving, setSaving] = useState(false);

  // Mutable map: sub_strand_id -> { level, observations }
  const [assessmentDraft, setAssessmentDraft] = useState<Record<string, { performance_level: string; teacher_observations: string }>>({});

  const loadBootstrap = useCallback(async () => {
    try {
      const [termsRes, classesRes] = await Promise.all([
        api.get("/tenants/terms"),
        api.get("/tenants/classes"),
      ]);
      setTerms(normalizeTerms(termsRes));
      setClasses(normalizeClassOptions(classesRes));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to load setup data");
    }
  }, []);

  useEffect(() => { loadBootstrap(); }, [loadBootstrap]);

  useEffect(() => {
    if (!selectedClass || !selectedTerm) { setEnrollments([]); return; }
    setLoadingEnrollments(true);
    api.get(`/attendance/classes/${selectedClass}/roster?term_id=${selectedTerm}`)
      .then(res => setEnrollments(normalizeEnrollmentRows(res)))
      .catch(e => toast.error(e instanceof Error ? e.message : "Failed to load students"))
      .finally(() => setLoadingEnrollments(false));
  }, [selectedClass, selectedTerm]);

  useEffect(() => {
    if (!selectedEnrollment || !selectedTerm) {
      setCurriculum({ learning_areas: [] });
      setExistingAssessments([]);
      setAssessmentDraft({});
      return;
    }
    setLoadingCurriculum(true);
    const band = filterBand === "all" ? "" : `&grade_band=${filterBand}`;
    Promise.all([
      api.get(`/cbc/curriculum?active_only=true${band}`),
      api.get(`/cbc/assessments?enrollment_id=${selectedEnrollment}&term_id=${selectedTerm}`),
    ])
      .then(([currRes, assRes]) => {
        const tree = normalizeCurriculum(currRes);
        const existing = normalizeAssessments(assRes);
        setCurriculum(tree);
        setExistingAssessments(existing);
        // Pre-fill draft from existing
        const draft: Record<string, { performance_level: string; teacher_observations: string }> = {};
        for (const a of existing) {
          draft[a.sub_strand_id] = {
            performance_level: a.performance_level,
            teacher_observations: a.teacher_observations ?? "",
          };
        }
        setAssessmentDraft(draft);
      })
      .catch(e => toast.error(e instanceof Error ? e.message : "Failed to load assessment data"))
      .finally(() => setLoadingCurriculum(false));
  }, [selectedEnrollment, selectedTerm, filterBand]);

  const setLevel = (ssId: string, level: string) => {
    setAssessmentDraft(prev => ({
      ...prev,
      [ssId]: { performance_level: level, teacher_observations: prev[ssId]?.teacher_observations ?? "" },
    }));
  };

  const setObs = (ssId: string, obs: string) => {
    setAssessmentDraft(prev => ({
      ...prev,
      [ssId]: { performance_level: prev[ssId]?.performance_level ?? "", teacher_observations: obs },
    }));
  };

  const handleSave = async () => {
    if (!selectedEnrollment || !selectedTerm) return;
    const assessments = Object.entries(assessmentDraft)
      .filter(([, v]) => !!v.performance_level)
      .map(([sub_strand_id, v]) => ({
        sub_strand_id,
        performance_level: v.performance_level,
        teacher_observations: v.teacher_observations || null,
      }));
    if (assessments.length === 0) {
      toast.error("No performance levels entered");
      return;
    }
    setSaving(true);
    try {
      await api.put("/cbc/assessments", {
        enrollment_id: selectedEnrollment,
        term_id: selectedTerm,
        assessments,
      });
      toast.success(`Saved ${assessments.length} assessment${assessments.length !== 1 ? "s" : ""}`);
      // Refresh existing
      const assRes = await api.get(`/cbc/assessments?enrollment_id=${selectedEnrollment}&term_id=${selectedTerm}`);
      setExistingAssessments(normalizeAssessments(assRes));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const selectedStudent = enrollments.find(e => e.id === selectedEnrollment);

  const totalSubStrands = curriculum.learning_areas.reduce(
    (acc, la) => acc + la.strands.reduce((a2, s) => a2 + s.sub_strands.length, 0), 0
  );
  const filledCount = Object.values(assessmentDraft).filter(v => v.performance_level).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-green-600" />
            CBC Assessment Entry
          </h2>
          <p className="text-sm text-slate-500">Enter performance levels for each learner per sub-strand</p>
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 bg-slate-50 rounded-lg border">
        <div className="space-y-1">
          <Label className="text-xs">Term</Label>
          <Select value={selectedTerm} onValueChange={v => { setSelectedTerm(v); setSelectedEnrollment(""); }}>
            <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select term…" /></SelectTrigger>
            <SelectContent>
              {terms.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Class</Label>
          <Select value={selectedClass} onValueChange={v => { setSelectedClass(v); setSelectedEnrollment(""); }}>
            <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select class…" /></SelectTrigger>
            <SelectContent>
              {classes.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Student</Label>
          <Select value={selectedEnrollment} onValueChange={setSelectedEnrollment} disabled={loadingEnrollments || enrollments.length === 0}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder={loadingEnrollments ? "Loading…" : "Select student…"} />
            </SelectTrigger>
            <SelectContent>
              {enrollments.map(e => (
                <SelectItem key={e.id} value={e.id}>{studentName(e)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Grade Band</Label>
          <Select value={filterBand} onValueChange={setFilterBand}>
            <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All bands" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Bands</SelectItem>
              {GRADE_BANDS.map(b => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Assessment grid */}
      {!selectedEnrollment ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-slate-400">
          <ClipboardList className="mx-auto mb-2 h-8 w-8 opacity-40" />
          <p className="text-sm">Select a term, class, and student to enter assessments.</p>
        </div>
      ) : loadingCurriculum ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : curriculum.learning_areas.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-slate-400">
          <BookOpenCheck className="mx-auto mb-2 h-8 w-8 opacity-40" />
          <p className="text-sm">No curriculum structure found. Ask the director to seed the CBC curriculum first.</p>
        </div>
      ) : (
        <>
          {/* Progress bar */}
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{filledCount} / {totalSubStrands} sub-strands assessed</span>
            <span className="font-medium text-slate-700">{selectedStudent ? studentName(selectedStudent) : ""}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all"
              style={{ width: totalSubStrands ? `${(filledCount / totalSubStrands) * 100}%` : "0%" }}
            />
          </div>

          {/* Learning areas */}
          <div className="space-y-3">
            {curriculum.learning_areas.map(la => (
              <div key={la.id} className="rounded-lg border overflow-hidden">
                <div className="px-4 py-2.5 bg-blue-50 border-b">
                  <span className="font-semibold text-sm text-blue-800">{la.name}</span>
                  <span className="ml-2 text-xs text-blue-500">{la.grade_band.replace(/_/g, " ")}</span>
                </div>
                {la.strands.map(strand => (
                  <div key={strand.id} className="border-b last:border-b-0">
                    <div className="px-4 py-1.5 bg-slate-50 border-b">
                      <span className="text-sm font-medium text-slate-700">{strand.name}</span>
                    </div>
                    <div className="divide-y">
                      {strand.sub_strands.map(ss => {
                        const draft = assessmentDraft[ss.id];
                        const level = draft?.performance_level ?? "";
                        return (
                          <div key={ss.id} className="px-4 py-3 grid grid-cols-1 md:grid-cols-3 gap-3 items-start hover:bg-slate-50">
                            {/* Sub-strand name */}
                            <div>
                              <p className="text-sm font-medium">{ss.name}</p>
                              <p className="text-xs text-slate-400 font-mono">{ss.code}</p>
                            </div>
                            {/* Level picker */}
                            <div className="flex gap-1.5 flex-wrap">
                              {PERFORMANCE_LEVELS.map(pl => (
                                <button
                                  key={pl.value}
                                  onClick={() => setLevel(ss.id, pl.value)}
                                  className={`px-2.5 py-1 text-xs font-semibold rounded border transition-all ${
                                    level === pl.value
                                      ? pl.color + " ring-1 ring-current"
                                      : "bg-white text-slate-500 border-slate-200 hover:border-slate-400"
                                  }`}
                                >
                                  {pl.value}
                                </button>
                              ))}
                              {level && (
                                <button
                                  onClick={() => setLevel(ss.id, "")}
                                  className="px-1.5 py-1 text-xs text-slate-400 hover:text-red-500"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                            {/* Observations */}
                            <Textarea
                              placeholder="Teacher observations (optional)"
                              className="text-xs h-16 resize-none"
                              value={draft?.teacher_observations ?? ""}
                              onChange={e => setObs(ss.id, e.target.value)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Save button */}
          <div className="flex justify-end pt-2">
            <Button onClick={handleSave} disabled={saving || filledCount === 0} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save {filledCount} Assessment{filledCount !== 1 ? "s" : ""}
            </Button>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-3 pt-1 text-xs text-slate-500">
            {PERFORMANCE_LEVELS.map(pl => (
              <span key={pl.value} className={`px-2 py-0.5 rounded border font-medium ${pl.color}`}>
                {pl.label}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TAB: Progress Reports
// ═══════════════════════════════════════════════════════════════════

function ReportsTab() {
  const [terms, setTerms] = useState<TenantTerm[]>([]);
  const [classes, setClasses] = useState<TenantClassOption[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);

  const [selectedTerm, setSelectedTerm] = useState("");
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedEnrollment, setSelectedEnrollment] = useState("");

  const [loadingEnrollments, setLoadingEnrollments] = useState(false);
  const [reportData, setReportData] = useState<null | Record<string, unknown>>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const loadBootstrap = useCallback(async () => {
    try {
      const [termsRes, classesRes] = await Promise.all([
        api.get("/tenants/terms"),
        api.get("/tenants/classes"),
      ]);
      setTerms(normalizeTerms(termsRes));
      setClasses(normalizeClassOptions(classesRes));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to load data");
    }
  }, []);

  useEffect(() => { loadBootstrap(); }, [loadBootstrap]);

  useEffect(() => {
    if (!selectedClass || !selectedTerm) { setEnrollments([]); return; }
    setLoadingEnrollments(true);
    api.get(`/attendance/classes/${selectedClass}/roster?term_id=${selectedTerm}`)
      .then(res => setEnrollments(normalizeEnrollmentRows(res)))
      .catch(e => toast.error(e instanceof Error ? e.message : "Failed to load students"))
      .finally(() => setLoadingEnrollments(false));
  }, [selectedClass, selectedTerm]);

  useEffect(() => {
    if (!selectedEnrollment || !selectedTerm) { setReportData(null); return; }
    setLoadingReport(true);
    api.get(`/cbc/enrollments/${selectedEnrollment}/term/${selectedTerm}/report`)
      .then(res => setReportData(res as Record<string, unknown>))
      .catch(e => toast.error(e instanceof Error ? e.message : "Failed to load report"))
      .finally(() => setLoadingReport(false));
  }, [selectedEnrollment, selectedTerm]);

  const handleDownloadPdf = async () => {
    if (!selectedEnrollment || !selectedTerm) return;
    setDownloadingPdf(true);
    try {
      const response = await fetch(
        `/api/v1/cbc/enrollments/${selectedEnrollment}/term/${selectedTerm}/pdf`,
        {
          headers: {
            Authorization: `Bearer ${document.cookie.match(/access_token=([^;]+)/)?.[1] ?? ""}`,
          },
        }
      );
      if (!response.ok) throw new Error("PDF download failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cbc_report_${selectedEnrollment}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "PDF download failed");
    } finally {
      setDownloadingPdf(false);
    }
  };

  const las = (reportData?.learning_areas as unknown[]) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <FileBarChart className="h-5 w-5 text-purple-600" />
            CBC Progress Reports
          </h2>
          <p className="text-sm text-slate-500">View and download learner progress reports</p>
        </div>
        {reportData && (
          <Button variant="outline" size="sm" onClick={handleDownloadPdf} disabled={downloadingPdf}>
            {downloadingPdf ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
            Download PDF
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 p-4 bg-slate-50 rounded-lg border">
        <div className="space-y-1">
          <Label className="text-xs">Term</Label>
          <Select value={selectedTerm} onValueChange={v => { setSelectedTerm(v); setSelectedEnrollment(""); setReportData(null); }}>
            <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select term…" /></SelectTrigger>
            <SelectContent>
              {terms.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Class</Label>
          <Select value={selectedClass} onValueChange={v => { setSelectedClass(v); setSelectedEnrollment(""); setReportData(null); }}>
            <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select class…" /></SelectTrigger>
            <SelectContent>
              {classes.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Student</Label>
          <Select value={selectedEnrollment} onValueChange={setSelectedEnrollment} disabled={loadingEnrollments || enrollments.length === 0}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder={loadingEnrollments ? "Loading…" : "Select student…"} />
            </SelectTrigger>
            <SelectContent>
              {enrollments.map(e => (
                <SelectItem key={e.id} value={e.id}>{studentName(e)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Report view */}
      {!selectedEnrollment ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-slate-400">
          <FileBarChart className="mx-auto mb-2 h-8 w-8 opacity-40" />
          <p className="text-sm">Select a term, class and student to view their progress report.</p>
        </div>
      ) : loadingReport ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : !reportData ? null : (
        <div className="space-y-1">
          {/* Header */}
          <div className="rounded-lg bg-blue-600 text-white p-4 flex flex-wrap gap-4">
            <div>
              <p className="text-xs opacity-70">Learner</p>
              <p className="font-semibold">{String(reportData.student_name ?? "—")}</p>
            </div>
            <div>
              <p className="text-xs opacity-70">Admission No.</p>
              <p className="font-semibold">{String(reportData.admission_no ?? "—")}</p>
            </div>
            <div>
              <p className="text-xs opacity-70">Class</p>
              <p className="font-semibold">{String(reportData.class_name ?? "—")}</p>
            </div>
            <div>
              <p className="text-xs opacity-70">Term</p>
              <p className="font-semibold">{String(reportData.term_name ?? "—")}</p>
            </div>
          </div>

          {las.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-slate-400">
              <p className="text-sm">No assessments recorded for this learner in this term.</p>
            </div>
          ) : (
            (las as Array<Record<string, unknown>>).map(la => (
              <div key={String(la.learning_area_id)} className="rounded-lg border overflow-hidden">
                <div className="px-4 py-2.5 bg-blue-50 border-b flex items-center gap-2">
                  <span className="font-semibold text-sm text-blue-800">{String(la.learning_area_name)}</span>
                  <span className="text-xs text-blue-400">{String(la.grade_band ?? "").replace(/_/g, " ")}</span>
                </div>
                {(la.strands as Array<Record<string, unknown>>).map(strand => (
                  <div key={String(strand.strand_id)} className="border-b last:border-b-0">
                    <div className="px-4 py-1.5 bg-slate-50 border-b">
                      <span className="text-sm font-medium">{String(strand.strand_name)}</span>
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-slate-50/50">
                          <th className="text-left px-4 py-1.5 font-medium text-xs text-slate-500 w-1/2">Sub-strand</th>
                          <th className="text-center px-4 py-1.5 font-medium text-xs text-slate-500 w-20">Level</th>
                          <th className="text-left px-4 py-1.5 font-medium text-xs text-slate-500">Observations</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(strand.sub_strands as Array<Record<string, unknown>>).map(ss => (
                          <tr key={String(ss.sub_strand_id)} className="border-b last:border-b-0 hover:bg-slate-50">
                            <td className="px-4 py-2">{String(ss.sub_strand_name)}</td>
                            <td className="px-4 py-2 text-center">
                              <span className={`px-2 py-0.5 rounded text-xs font-semibold ${LEVEL_BADGE[String(ss.performance_level)] ?? "bg-slate-100 text-slate-600"}`}>
                                {String(ss.performance_level)}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-xs text-slate-500">{String(ss.teacher_observations ?? "")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            ))
          )}

          {/* Legend */}
          <div className="flex flex-wrap gap-3 pt-2 text-xs">
            {PERFORMANCE_LEVELS.map(pl => (
              <span key={pl.value} className={`px-2 py-0.5 rounded border font-medium ${pl.color}`}>
                {pl.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
// TAB: Analytics (Step 3A + Step 4)
// ═══════════════════════════════════════════════════════════════════

type LevelDistribution = {
  learning_area_id: string;
  learning_area_name: string;
  grade_band: string;
  be_count: number;
  ae_count: number;
  me_count: number;
  ee_count: number;
  total_assessed: number;
  total_possible: number;
  completion_pct: number;
};

type SupportFlag = {
  enrollment_id: string;
  student_name: string;
  admission_no: string;
  be_count: number;
  learning_areas_flagged: string[];
};

type ClassAnalytics = {
  class_code: string;
  term_id: string;
  term_name: string;
  enrolled_count: number;
  distribution: LevelDistribution[];
  support_flags: SupportFlag[];
  overall_completion_pct: number;
};

type SupportReportRow = {
  enrollment_id: string;
  student_name: string;
  admission_no: string;
  class_code: string;
  be_total: number;
  ae_total: number;
  me_total: number;
  ee_total: number;
  total_assessed: number;
  flagged_areas: string[];
};

type SupportReport = {
  class_code: string;
  term_id: string;
  term_name: string;
  generated_at: string;
  students: SupportReportRow[];
};

const LEVEL_COLORS = {
  BE: { bg: "bg-red-500", text: "text-red-700", badge: "bg-red-100 text-red-700" },
  AE: { bg: "bg-amber-400", text: "text-amber-700", badge: "bg-amber-100 text-amber-700" },
  ME: { bg: "bg-green-500", text: "text-green-700", badge: "bg-green-100 text-green-700" },
  EE: { bg: "bg-blue-500", text: "text-blue-700", badge: "bg-blue-100 text-blue-700" },
};

function LevelBar({ label, count, total, colorClass }: { label: string; count: number; total: number; colorClass: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-6 font-bold text-slate-600">{label}</span>
      <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full ${colorClass} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-12 text-right text-slate-500">{count} ({pct}%)</span>
    </div>
  );
}

function AnalyticsTab() {
  const [classes, setClasses] = useState<TenantClassOption[]>([]);
  const [terms, setTerms] = useState<TenantTerm[]>([]);
  const [classCode, setClassCode] = useState("");
  const [termId, setTermId] = useState("");
  const [analytics, setAnalytics] = useState<ClassAnalytics | null>(null);
  const [supportReport, setSupportReport] = useState<SupportReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeView, setActiveView] = useState<"distribution" | "support">("distribution");
  const [downloadingCsv, setDownloadingCsv] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get("/classes/", { tenantRequired: true }).catch(() => []),
      api.get("/terms/", { tenantRequired: true }).catch(() => []),
    ]).then(([cls, trms]) => {
      setClasses(normalizeClassOptions(cls));
      setTerms(normalizeTerms(trms));
    });
  }, []);

  async function loadAnalytics() {
    if (!classCode || !termId) return;
    setLoading(true);
    setAnalytics(null);
    setSupportReport(null);
    try {
      const [ana, sup] = await Promise.all([
        api.get<ClassAnalytics>(`/cbc/classes/${classCode}/term/${termId}/analytics`, { tenantRequired: true }),
        api.get<SupportReport>(`/cbc/classes/${classCode}/term/${termId}/support-report`, { tenantRequired: true }),
      ]);
      setAnalytics(ana);
      setSupportReport(sup);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }

  async function downloadCsv() {
    if (!classCode || !termId) return;
    setDownloadingCsv(true);
    try {
      await api.downloadFile(
        `/cbc/classes/${classCode}/term/${termId}/support-report/csv`,
        `support_report_${classCode}.csv`,
        { tenantRequired: true },
      );
    } catch {
      toast.error("Failed to download CSV");
    } finally {
      setDownloadingCsv(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-500">Class</label>
          <Select value={classCode} onValueChange={setClassCode}>
            <SelectTrigger className="h-9 w-44">
              <SelectValue placeholder="Select class" />
            </SelectTrigger>
            <SelectContent>
              {classes.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-500">Term</label>
          <Select value={termId} onValueChange={setTermId}>
            <SelectTrigger className="h-9 w-44">
              <SelectValue placeholder="Select term" />
            </SelectTrigger>
            <SelectContent>
              {terms.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => void loadAnalytics()} disabled={!classCode || !termId || loading} size="sm">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileBarChart className="h-4 w-4" />}
          {loading ? "Loading…" : "Load Analytics"}
        </Button>
      </div>

      {analytics && (
        <>
          {/* Summary pills */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Enrolled", value: analytics.enrolled_count, color: "bg-slate-50 border-slate-200 text-slate-800" },
              { label: "Overall Completion", value: `${analytics.overall_completion_pct}%`, color: "bg-blue-50 border-blue-200 text-blue-800" },
              { label: "Learning Areas", value: analytics.distribution.length, color: "bg-emerald-50 border-emerald-200 text-emerald-800" },
              { label: "Support Alerts", value: analytics.support_flags.length, color: analytics.support_flags.length > 0 ? "bg-red-50 border-red-200 text-red-800" : "bg-slate-50 border-slate-200 text-slate-800" },
            ].map((pill) => (
              <div key={pill.label} className={`rounded-xl border p-3 ${pill.color}`}>
                <p className="text-xs opacity-70">{pill.label}</p>
                <p className="text-xl font-bold">{pill.value}</p>
              </div>
            ))}
          </div>

          {/* View toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setActiveView("distribution")}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${activeView === "distribution" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              Level Distribution
            </button>
            <button
              onClick={() => setActiveView("support")}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${activeView === "support" ? "bg-red-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              Learner Support {analytics.support_flags.length > 0 && <span className="ml-1 bg-red-100 text-red-700 text-xs px-1.5 py-0.5 rounded-full">{analytics.support_flags.length}</span>}
            </button>
          </div>

          {/* Distribution view */}
          {activeView === "distribution" && (
            <div className="space-y-4">
              {analytics.distribution.map((la) => (
                <div key={la.learning_area_id} className="rounded-2xl border border-slate-100 bg-white shadow-sm p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-slate-800">{la.learning_area_name}</p>
                      <p className="text-xs text-slate-400">{la.grade_band.replace(/_/g, " ")}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-500">Completion</p>
                      <p className={`text-sm font-bold ${la.completion_pct >= 80 ? "text-green-600" : la.completion_pct >= 50 ? "text-amber-600" : "text-red-600"}`}>
                        {la.completion_pct}%
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <LevelBar label="EE" count={la.ee_count} total={la.total_assessed} colorClass={LEVEL_COLORS.EE.bg} />
                    <LevelBar label="ME" count={la.me_count} total={la.total_assessed} colorClass={LEVEL_COLORS.ME.bg} />
                    <LevelBar label="AE" count={la.ae_count} total={la.total_assessed} colorClass={LEVEL_COLORS.AE.bg} />
                    <LevelBar label="BE" count={la.be_count} total={la.total_assessed} colorClass={LEVEL_COLORS.BE.bg} />
                  </div>
                  <p className="text-xs text-slate-400">{la.total_assessed} of {la.total_possible} possible assessments recorded</p>
                </div>
              ))}
            </div>
          )}

          {/* Support view */}
          {activeView === "support" && supportReport && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-500">
                  Students with ≥3 BE ratings in any learning area are flagged for support.
                </p>
                <button
                  onClick={() => void downloadCsv()}
                  disabled={downloadingCsv}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition"
                >
                  {downloadingCsv ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                  Export CSV
                </button>
              </div>

              {/* Flagged students */}
              {analytics.support_flags.length > 0 && (
                <div className="rounded-2xl border border-red-100 bg-red-50 p-4 space-y-2">
                  <p className="text-sm font-semibold text-red-800">
                    {analytics.support_flags.length} student{analytics.support_flags.length !== 1 ? "s" : ""} flagged for support
                  </p>
                  <div className="space-y-2">
                    {analytics.support_flags.map((f) => (
                      <div key={f.enrollment_id} className="flex items-start justify-between rounded-xl bg-white border border-red-100 p-3">
                        <div>
                          <p className="font-medium text-slate-800 text-sm">{f.student_name}</p>
                          <p className="text-xs text-slate-400">{f.admission_no}</p>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {f.learning_areas_flagged.map((la) => (
                              <span key={la} className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-xs">{la}</span>
                            ))}
                          </div>
                        </div>
                        <span className="text-xs font-bold text-red-600">{f.be_count} BE</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Full class table */}
              <div className="overflow-x-auto rounded-xl border border-slate-100">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                    <tr>
                      <th className="px-4 py-2 text-left">Student</th>
                      <th className="px-4 py-2 text-center">BE</th>
                      <th className="px-4 py-2 text-center">AE</th>
                      <th className="px-4 py-2 text-center">ME</th>
                      <th className="px-4 py-2 text-center">EE</th>
                      <th className="px-4 py-2 text-center">Assessed</th>
                      <th className="px-4 py-2 text-left">Flagged Areas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {supportReport.students.map((s) => (
                      <tr key={s.enrollment_id} className={s.flagged_areas.length > 0 ? "bg-red-50/40" : "hover:bg-slate-50"}>
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-slate-800">{s.student_name}</p>
                          <p className="text-xs text-slate-400">{s.admission_no}</p>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`px-2 py-0.5 rounded text-xs font-bold ${s.be_total > 0 ? LEVEL_COLORS.BE.badge : "text-slate-400"}`}>{s.be_total}</span>
                        </td>
                        <td className="px-4 py-2.5 text-center text-xs">{s.ae_total}</td>
                        <td className="px-4 py-2.5 text-center text-xs">{s.me_total}</td>
                        <td className="px-4 py-2.5 text-center text-xs">{s.ee_total}</td>
                        <td className="px-4 py-2.5 text-center text-xs text-slate-500">{s.total_assessed}</td>
                        <td className="px-4 py-2.5">
                          {s.flagged_areas.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {s.flagged_areas.map((la) => (
                                <span key={la} className="px-1 py-0.5 rounded bg-red-100 text-red-700 text-xs">{la}</span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {!analytics && !loading && (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-slate-400">
          <FileBarChart className="h-10 w-10 opacity-30" />
          <p className="text-sm">Select a class and term, then click Load Analytics</p>
        </div>
      )}
    </div>
  );
}
