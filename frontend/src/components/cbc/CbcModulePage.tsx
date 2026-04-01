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
import { Switch } from "@/components/ui/switch";
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
  appTitle: string;
  nav: AppNavItem[];
  canManageCurriculum?: boolean;
};

export function CbcModulePage({ appTitle, nav, canManageCurriculum = false }: CbcModulePageProps) {
  const searchParams = useSearchParams();
  const section = (searchParams.get("section") ?? "assessments") as "assessments" | "curriculum" | "reports";

  return (
    <AppShell appTitle={appTitle} nav={nav}>
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
              <Button variant="outline" size="sm" onClick={handleSeed} disabled={seeding}>
                <Sprout className="h-3.5 w-3.5 mr-1" />
                {seeding ? "Seeding…" : "Seed Kenya CBC"}
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
