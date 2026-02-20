"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";

import { AppShell } from "@/components/layout/AppShell";
import {
  secretaryEnrollmentsHref,
  secretaryNav,
  type EnrollmentSection,
} from "@/components/layout/nav-config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Textarea } from "@/components/ui/textarea";

// ─── Types ────────────────────────────────────────────────────────────────────

type EnrollmentRow = {
  id: string;
  status: string;
  payload: Record<string, unknown>;
};

type ActionType =
  | "submit"
  | "approve"
  | "reject"
  | "enroll"
  | "transfer_request"
  | "transfer_approve";

type IntakeDraft = {
  student_name: string;
  admission_class: string;
  date_of_birth: string;
  gender: string;
  guardian_name: string;
  guardian_phone: string;
  guardian_email: string;
  previous_school: string;
  assessment_no: string;
  nemis_no: string;
  notes: string;
  documents: {
    birth_certificate: boolean;
    passport_photo: boolean;
    previous_report_card: boolean;
    transfer_letter: boolean;
  };
};

type ExistingStudentDraft = {
  student_name: string;
  admission_class: string;
  date_of_birth: string;
  guardian_name: string;
  guardian_phone: string;
  guardian_email: string;
  previous_school: string;
  assessment_no: string;
  nemis_no: string;
};

type DocumentKey = keyof IntakeDraft["documents"];

const INITIAL_DRAFT: IntakeDraft = {
  student_name: "",
  admission_class: "",
  date_of_birth: "",
  gender: "",
  guardian_name: "",
  guardian_phone: "",
  guardian_email: "",
  previous_school: "",
  assessment_no: "",
  nemis_no: "",
  notes: "",
  documents: {
    birth_certificate: false,
    passport_photo: false,
    previous_report_card: false,
    transfer_letter: false,
  },
};

const INITIAL_EXISTING_STUDENT_DRAFT: ExistingStudentDraft = {
  student_name: "",
  admission_class: "",
  date_of_birth: "",
  guardian_name: "",
  guardian_phone: "",
  guardian_email: "",
  previous_school: "",
  assessment_no: "",
  nemis_no: "",
};

const chartConfig = {
  count: { label: "Count", color: "#3b82f6" },
};

const intakeSteps = [
  { id: 1, label: "Student Profile", icon: "👤" },
  { id: 2, label: "Guardian Contact", icon: "📞" },
  { id: 3, label: "Requirements", icon: "📋" },
  { id: 4, label: "Review & Submit", icon: "✅" },
] as const;

const requirementChecklist: Array<{
  key: DocumentKey;
  label: string;
  description: string;
  required: boolean;
}> = [
  { key: "birth_certificate", label: "Birth Certificate", description: "Certified copy of birth certificate", required: true },
  { key: "passport_photo", label: "Passport Photo", description: "Recent passport-size photograph", required: true },
  { key: "previous_report_card", label: "Previous Report Card", description: "Most recent academic report", required: true },
  { key: "transfer_letter", label: "Transfer Letter", description: "Required for transfer students only", required: false },
];

const actionConfig: Record<ActionType, { label: string; description: string; color: string; icon: string }> = {
  submit: { label: "Submit", description: "Move intake from DRAFT → SUBMITTED for office review.", color: "blue", icon: "📤" },
  approve: { label: "Approve", description: "Office has verified documents. Move to APPROVED.", color: "emerald", icon: "✅" },
  reject: { label: "Reject", description: "Reject the intake with a written reason. Requires rejection note.", color: "red", icon: "❌" },
  enroll: { label: "Mark Enrolled", description: "Final enrollment. Requires Assessment No., NEMIS No. and fee rules.", color: "emerald", icon: "🎓" },
  transfer_request: { label: "Transfer Request", description: "Mark student as having a pending transfer request.", color: "amber", icon: "🔄" },
  transfer_approve: { label: "Transfer Approve", description: "Complete transfer. Requires director-level authorization.", color: "purple", icon: "✔️" },
};

// ─── Helpers & Sub-components ─────────────────────────────────────────────────

function studentName(payload: Record<string, unknown>) {
  const options = [payload.student_name, payload.studentName, payload.full_name, payload.fullName, payload.name];
  for (const item of options) {
    if (typeof item === "string" && item.trim()) return item;
  }
  return "Unknown student";
}

function studentClass(payload: Record<string, unknown>) {
  const options = [payload.admission_class, payload.class_code, payload.classCode, payload.grade];
  for (const item of options) {
    if (typeof item === "string" && item.trim()) return item;
  }
  return "";
}

function isNonEmpty(value: string) {
  return value.trim().length > 0;
}

function AlertBanner({ type, message, onDismiss }: { type: "error" | "success"; message: string; onDismiss: () => void }) {
  return (
    <div className={`flex items-start justify-between rounded-xl px-4 py-3 text-sm ${
      type === "error"
        ? "border border-red-200 bg-red-50 text-red-800"
        : "border border-emerald-200 bg-emerald-50 text-emerald-800"
    }`}>
      <div className="flex items-center gap-2">
        <span>{type === "error" ? "⚠️" : "✅"}</span>
        <span>{message}</span>
      </div>
      <button onClick={onDismiss} className="ml-4 opacity-60 hover:opacity-100">✕</button>
    </div>
  );
}

function FormField({ label, hint, children, required }: { label: string; hint?: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </Label>
      {children}
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function EnrollmentStatusBadge({ status }: { status: string }) {
  const s = status.toUpperCase();
  const styles: Record<string, string> = {
    ENROLLED: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    APPROVED: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
    SUBMITTED: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    DRAFT: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
    REJECTED: "bg-red-50 text-red-700 ring-1 ring-red-200",
    TRANSFER_REQUESTED: "bg-purple-50 text-purple-700 ring-1 ring-purple-200",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[s] ?? "bg-slate-100 text-slate-600 ring-1 ring-slate-200"}`}>
      {s.replace("_", " ")}
    </span>
  );
}

function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-10 text-center">
        <div className="flex flex-col items-center gap-1">
          <span className="text-2xl">📋</span>
          <span className="text-sm text-slate-400">{message}</span>
        </div>
      </TableCell>
    </TableRow>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function SecretaryEnrollmentsPageContent() {
  const searchParams = useSearchParams();
  const section: EnrollmentSection =
    searchParams.get("section") === "students" ? "students" : "intake";
  const activeEnrollmentsHref = secretaryEnrollmentsHref(section);

  const [rows, setRows] = useState<EnrollmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<IntakeDraft>(INITIAL_DRAFT);
  const [creating, setCreating] = useState(false);

  const [existingStudentDraft, setExistingStudentDraft] = useState<ExistingStudentDraft>(INITIAL_EXISTING_STUDENT_DRAFT);
  const [creatingExistingStudent, setCreatingExistingStudent] = useState(false);

  const [feeStructures, setFeeStructures] = useState<any[]>([]);
  const [selectedFeeStructureId, setSelectedFeeStructureId] = useState<string | null>(null);

  const [action, setAction] = useState<ActionType>("submit");
  const [targetId, setTargetId] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/tenant/secretary/enrollments", { method: "GET" });
      const data = await res.json().catch(() => []);
      if (!res.ok) {
        setRows([]);
        setError(typeof data?.detail === "string" ? data.detail : "Failed to load enrollments");
        return;
      }
      setRows(Array.isArray(data) ? data : []);
      setError(null);
    } catch {
      setRows([]);
      setError("Enrollment service is currently unavailable.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let mounted = true;
    (async function () {
      try {
        const res = await fetch("/api/v1/finance/fee-structures");
        if (!res.ok) return;
        const data = await res.json().catch(() => []);
        if (mounted && Array.isArray(data)) setFeeStructures(data);
      } catch { /* ignore */ }
    })();
    return () => { mounted = false; };
  }, []);

  const requiredDocsReady = requirementChecklist
    .filter((x) => x.required)
    .every((x) => draft.documents[x.key]);

  const baseFieldsReady =
    isNonEmpty(draft.student_name) &&
    isNonEmpty(draft.admission_class) &&
    isNonEmpty(draft.date_of_birth) &&
    isNonEmpty(draft.guardian_name) &&
    isNonEmpty(draft.guardian_phone);

  const canPost = baseFieldsReady && requiredDocsReady;

  function nextStep() {
    if (step === 1) {
      if (!isNonEmpty(draft.student_name) || !isNonEmpty(draft.admission_class) || !isNonEmpty(draft.date_of_birth)) {
        setError("Complete all required student profile fields before continuing.");
        return;
      }
    }
    if (step === 2) {
      if (!isNonEmpty(draft.guardian_name) || !isNonEmpty(draft.guardian_phone)) {
        setError("Guardian name and phone are required.");
        return;
      }
    }
    if (step === 3 && !requiredDocsReady) {
      setError("Confirm all required documents before proceeding to review.");
      return;
    }
    setError(null);
    setStep((prev) => Math.min(prev + 1, 4));
  }

  function prevStep() {
    setError(null);
    setStep((prev) => Math.max(prev - 1, 1));
  }

  async function createEnrollment() {
    if (!canPost) { setError("Complete required fields and documents first."); return; }
    setCreating(true);
    setError(null);
    setNotice(null);
    const payload: any = {
      student_name: draft.student_name.trim(),
      admission_class: draft.admission_class.trim(),
      date_of_birth: draft.date_of_birth,
      gender: draft.gender || null,
      guardian_name: draft.guardian_name.trim(),
      guardian_phone: draft.guardian_phone.trim(),
      guardian_email: draft.guardian_email.trim() || null,
      previous_school: draft.previous_school.trim() || null,
      assessment_no: draft.assessment_no.trim() || null,
      nemis_no: draft.nemis_no.trim() || null,
      notes: draft.notes.trim() || null,
      documents: draft.documents,
      currency: "KES",
    };
    if (selectedFeeStructureId) payload["_fee_structure_id"] = selectedFeeStructureId;
    try {
      const res = await fetch("/api/tenant/secretary/enrollments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(typeof data?.detail === "string" ? data.detail : "Failed to post enrollment"); return; }
      const createdId = String(data?.enrollment?.id || "");
      setTargetId(createdId);
      setDraft(INITIAL_DRAFT);
      setStep(1);
      setNotice(createdId ? `Enrollment created. ID: ${createdId}` : "Enrollment created successfully.");
      await load();
    } catch {
      setError("Unable to post enrollment. Please retry.");
    } finally {
      setCreating(false);
    }
  }

  async function createExistingStudentEnrollment() {
    if (!isNonEmpty(existingStudentDraft.student_name) || !isNonEmpty(existingStudentDraft.admission_class) ||
      !isNonEmpty(existingStudentDraft.guardian_name) || !isNonEmpty(existingStudentDraft.guardian_phone)) {
      setError("Student name, class, guardian name and phone are required.");
      return;
    }
    setCreatingExistingStudent(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/tenant/secretary/enrollments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          payload: {
            ...existingStudentDraft,
            date_of_birth: existingStudentDraft.date_of_birth || null,
            guardian_email: existingStudentDraft.guardian_email.trim() || null,
            previous_school: existingStudentDraft.previous_school.trim() || null,
            assessment_no: existingStudentDraft.assessment_no.trim() || null,
            nemis_no: existingStudentDraft.nemis_no.trim() || null,
            enrollment_source: "EXISTING_STUDENT",
            currency: "KES",
            documents: { birth_certificate: false, passport_photo: false, previous_report_card: false, transfer_letter: false },
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(typeof data?.detail === "string" ? data.detail : "Failed to add existing student."); return; }
      const createdId = String(data?.enrollment?.id || "");
      setExistingStudentDraft(INITIAL_EXISTING_STUDENT_DRAFT);
      setNotice(createdId ? `Existing student intake created. ID: ${createdId}` : "Existing student intake created.");
      await load();
    } catch {
      setError("Unable to add existing student. Please retry.");
    } finally {
      setCreatingExistingStudent(false);
    }
  }

  async function runAction() {
    if (!targetId.trim()) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/tenant/secretary/enrollments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enrollment_id: targetId.trim(),
          action,
          reason: action === "reject" ? reason.trim() : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(typeof data?.detail === "string" ? data.detail : "Action failed"); return; }
      setReason("");
      setNotice(`Action "${actionConfig[action].label}" completed for enrollment.`);
      await load();
    } catch {
      setError("Enrollment action failed: service unavailable.");
    } finally {
      setSubmitting(false);
    }
  }

  const chartData = Object.entries(
    rows.reduce((acc, row) => {
      const key = (row.status || "UNKNOWN").toUpperCase();
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ).map(([status, count]) => ({ status, count }));

  const studentRows = rows.filter((row) => String(row.status || "").toUpperCase() === "ENROLLED");
  const selectedEnrollment = rows.find((r) => r.id === targetId);

  return (
    <AppShell title="Secretary" nav={secretaryNav} activeHref={activeEnrollmentsHref}>
      <div className="space-y-5">

        {/* ── Page Header ── */}
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-600 to-blue-500 p-5 text-white shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold">
                {section === "students" ? "Enrolled Students" : "Enrollment Operations"}
              </h1>
              <p className="mt-0.5 text-sm text-blue-100">
                {section === "students"
                  ? "Manage existing student records and add returning students."
                  : "Register new student intake step-by-step, then manage the workflow queue."}
              </p>
            </div>
            <div className="flex items-center gap-3 text-right text-sm text-blue-100">
              <div>
                <div className="text-xl font-bold text-white">{rows.length}</div>
                <div className="text-xs">Total Records</div>
              </div>
              <div className="h-8 w-px bg-blue-400" />
              <div>
                <div className="text-xl font-bold text-white">{studentRows.length}</div>
                <div className="text-xs">Enrolled</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Alerts ── */}
        {error && <AlertBanner type="error" message={error} onDismiss={() => setError(null)} />}
        {notice && <AlertBanner type="success" message={notice} onDismiss={() => setNotice(null)} />}

        {/* ══════════════════════════════════════════════════════════════
            INTAKE SECTION
        ══════════════════════════════════════════════════════════════ */}
        {section === "intake" && (
          <div className="space-y-5">

            {/* Step-by-step intake form + workflow panel */}
            <div className="grid gap-5 xl:grid-cols-3">

              {/* ── Intake Wizard ── */}
              <div className="xl:col-span-2 rounded-2xl border border-slate-200 bg-white shadow-sm">
                {/* Step Progress Bar */}
                <div className="border-b border-slate-100 px-6 pt-5 pb-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">New Student Intake</h2>
                      <p className="text-xs text-slate-500">Complete all steps to register a new student</p>
                    </div>
                    <span className="text-xs font-medium text-slate-400">Step {step} of 4</span>
                  </div>

                  {/* Step Pills */}
                  <div className="flex items-center gap-1">
                    {intakeSteps.map((s, idx) => (
                      <div key={s.id} className="flex flex-1 items-center">
                        <button
                          onClick={() => step > s.id && setStep(s.id)}
                          className={`flex flex-1 flex-col items-center gap-1 rounded-xl py-2 px-1 text-center transition ${
                            step === s.id
                              ? "bg-blue-600 text-white"
                              : step > s.id
                              ? "bg-emerald-50 text-emerald-700 cursor-pointer hover:bg-emerald-100"
                              : "bg-slate-50 text-slate-400 cursor-default"
                          }`}
                        >
                          <span className="text-base">{step > s.id ? "✓" : s.icon}</span>
                          <span className="text-xs font-medium leading-tight">{s.label}</span>
                        </button>
                        {idx < intakeSteps.length - 1 && (
                          <div className={`mx-1 h-0.5 w-4 shrink-0 rounded-full ${step > s.id ? "bg-emerald-300" : "bg-slate-200"}`} />
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Step Content */}
                <div className="p-6">

                  {/* Step 1 — Student Profile */}
                  {step === 1 && (
                    <div className="space-y-4">
                      <div className="mb-4 rounded-xl border border-blue-50 bg-blue-50/50 px-4 py-2.5 text-sm text-blue-800">
                        Enter the student's personal details exactly as they appear on their birth certificate.
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <FormField label="Full Name" required hint="As appearing on birth certificate">
                          <Input
                            placeholder="e.g. Achieng Atieno"
                            value={draft.student_name}
                            onChange={(e) => setDraft((p) => ({ ...p, student_name: e.target.value }))}
                          />
                        </FormField>
                        <FormField label="Admission Class" required hint="e.g. GRADE_7, FORM_1, PP2">
                          <Input
                            placeholder="e.g. GRADE_7"
                            value={draft.admission_class}
                            onChange={(e) => setDraft((p) => ({ ...p, admission_class: e.target.value }))}
                          />
                        </FormField>
                        <FormField label="Date of Birth" required>
                          <Input
                            type="date"
                            value={draft.date_of_birth}
                            onChange={(e) => setDraft((p) => ({ ...p, date_of_birth: e.target.value }))}
                          />
                        </FormField>
                        <FormField label="Gender">
                          <Select
                            value={draft.gender || "__none__"}
                            onValueChange={(value) => setDraft((p) => ({ ...p, gender: value === "__none__" ? "" : value }))}
                          >
                            <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">Not specified</SelectItem>
                              <SelectItem value="MALE">Male</SelectItem>
                              <SelectItem value="FEMALE">Female</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormField>
                      </div>
                    </div>
                  )}

                  {/* Step 2 — Guardian Contact */}
                  {step === 2 && (
                    <div className="space-y-4">
                      <div className="mb-4 rounded-xl border border-blue-50 bg-blue-50/50 px-4 py-2.5 text-sm text-blue-800">
                        Provide accurate guardian contact details. These will be used for all school communications.
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <FormField label="Guardian Full Name" required>
                          <Input
                            placeholder="e.g. Jane Atieno"
                            value={draft.guardian_name}
                            onChange={(e) => setDraft((p) => ({ ...p, guardian_name: e.target.value }))}
                          />
                        </FormField>
                        <FormField label="Guardian Phone" required hint="Include country code e.g. +254…">
                          <Input
                            placeholder="+2547XXXXXXXX"
                            value={draft.guardian_phone}
                            onChange={(e) => setDraft((p) => ({ ...p, guardian_phone: e.target.value }))}
                          />
                        </FormField>
                        <FormField label="Guardian Email" hint="Optional — for digital communications">
                          <Input
                            placeholder="guardian@example.com"
                            value={draft.guardian_email}
                            onChange={(e) => setDraft((p) => ({ ...p, guardian_email: e.target.value }))}
                          />
                        </FormField>
                        <FormField label="Previous School" hint="Leave blank if not applicable">
                          <Input
                            placeholder="e.g. Sunshine Academy"
                            value={draft.previous_school}
                            onChange={(e) => setDraft((p) => ({ ...p, previous_school: e.target.value }))}
                          />
                        </FormField>
                      </div>
                    </div>
                  )}

                  {/* Step 3 — Requirements */}
                  {step === 3 && (
                    <div className="space-y-5">
                      <div className="mb-2 rounded-xl border border-amber-50 bg-amber-50/60 px-4 py-2.5 text-sm text-amber-800">
                        ⚠️ Assessment No. and NEMIS No. are required later during final enrollment. You can add them now if available.
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <FormField label="Assessment Number" hint="Required for final enrollment action">
                          <Input
                            placeholder="Leave blank if not yet assigned"
                            value={draft.assessment_no}
                            onChange={(e) => setDraft((p) => ({ ...p, assessment_no: e.target.value }))}
                          />
                        </FormField>
                        <FormField label="NEMIS Number" hint="National Education Management Information System ID">
                          <Input
                            placeholder="Leave blank if not yet assigned"
                            value={draft.nemis_no}
                            onChange={(e) => setDraft((p) => ({ ...p, nemis_no: e.target.value }))}
                          />
                        </FormField>
                      </div>

                      <FormField label="Additional Notes" hint="Admission desk notes, special considerations, etc.">
                        <Textarea
                          placeholder="Any notes from the admission desk…"
                          value={draft.notes}
                          onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))}
                          className="resize-none"
                          rows={3}
                        />
                      </FormField>

                      <div>
                        <Label className="mb-2 block text-sm font-medium text-slate-700">
                          Document Checklist
                        </Label>
                        <div className="space-y-2">
                          {requirementChecklist.map((item) => (
                            <label
                              key={item.key}
                              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                                draft.documents[item.key]
                                  ? "border-emerald-200 bg-emerald-50"
                                  : item.required
                                  ? "border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/30"
                                  : "border-slate-100 bg-slate-50 hover:bg-slate-100"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={draft.documents[item.key]}
                                onChange={(e) =>
                                  setDraft((p) => ({
                                    ...p,
                                    documents: { ...p.documents, [item.key]: e.target.checked },
                                  }))
                                }
                                className="mt-0.5 h-4 w-4 accent-blue-600"
                              />
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-slate-800">{item.label}</span>
                                  {item.required ? (
                                    <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-600">Required</span>
                                  ) : (
                                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">Optional</span>
                                  )}
                                </div>
                                <p className="mt-0.5 text-xs text-slate-400">{item.description}</p>
                              </div>
                              {draft.documents[item.key] && (
                                <span className="text-emerald-500 text-sm">✓</span>
                              )}
                            </label>
                          ))}
                        </div>
                        <p className="mt-2 text-xs text-slate-400">
                          All invoices in this system are handled in KES. Finance policy checks are applied on submit/enroll actions.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Step 4 — Review & Submit */}
                  {step === 4 && (
                    <div className="space-y-5">
                      <div className="rounded-xl border border-slate-100 overflow-hidden">
                        <div className="bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Student Details
                        </div>
                        <div className="grid grid-cols-2 gap-x-6 gap-y-3 p-4 text-sm">
                          <div><span className="text-slate-400">Full Name:</span> <span className="font-medium">{draft.student_name || "—"}</span></div>
                          <div><span className="text-slate-400">Class:</span> <span className="font-medium">{draft.admission_class || "—"}</span></div>
                          <div><span className="text-slate-400">Date of Birth:</span> <span className="font-medium">{draft.date_of_birth || "—"}</span></div>
                          <div><span className="text-slate-400">Gender:</span> <span className="font-medium">{draft.gender || "Not specified"}</span></div>
                          <div><span className="text-slate-400">Guardian:</span> <span className="font-medium">{draft.guardian_name || "—"}</span></div>
                          <div><span className="text-slate-400">Phone:</span> <span className="font-medium">{draft.guardian_phone || "—"}</span></div>
                          {draft.guardian_email && <div><span className="text-slate-400">Email:</span> <span className="font-medium">{draft.guardian_email}</span></div>}
                          {draft.previous_school && <div><span className="text-slate-400">Prev. School:</span> <span className="font-medium">{draft.previous_school}</span></div>}
                          {draft.assessment_no && <div><span className="text-slate-400">Assessment No.:</span> <span className="font-mono font-medium">{draft.assessment_no}</span></div>}
                          {draft.nemis_no && <div><span className="text-slate-400">NEMIS No.:</span> <span className="font-mono font-medium">{draft.nemis_no}</span></div>}
                        </div>
                      </div>

                      {/* Documents summary */}
                      <div className="rounded-xl border border-slate-100 overflow-hidden">
                        <div className="bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Document Checklist
                        </div>
                        <div className="p-4 grid grid-cols-2 gap-2">
                          {requirementChecklist.map((item) => (
                            <div key={item.key} className="flex items-center gap-2 text-sm">
                              <span className={draft.documents[item.key] ? "text-emerald-500" : "text-red-400"}>
                                {draft.documents[item.key] ? "✓" : "✗"}
                              </span>
                              <span className={draft.documents[item.key] ? "text-slate-700" : "text-slate-400"}>{item.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Fee Structure */}
                      <div className="rounded-xl border border-slate-100 p-4">
                        <FormField label="Fee Structure (Optional)" hint="Link a fee structure to automatically generate a fees invoice.">
                          <Select
                            value={selectedFeeStructureId || "__none__"}
                            onValueChange={(v) => setSelectedFeeStructureId(v === "__none__" ? null : v)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="No fee structure — skip" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">No fee structure — skip</SelectItem>
                              {feeStructures.map((s) => (
                                <SelectItem key={s.id} value={s.id}>
                                  {s.name} ({s.class_code || s.code || ""})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormField>
                      </div>

                      {/* Validation summary */}
                      <div className={`rounded-xl border px-4 py-3 text-sm ${canPost ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                        <div className="font-semibold mb-1">{canPost ? "✅ Ready to submit" : "⚠️ Not ready yet"}</div>
                        <div className="flex flex-wrap gap-2 mt-1">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${baseFieldsReady ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                            {baseFieldsReady ? "✓" : "✗"} Required fields
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${requiredDocsReady ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                            {requiredDocsReady ? "✓" : "✗"} Documents confirmed
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Navigation */}
                  <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4">
                    <Button type="button" variant="outline" onClick={prevStep} disabled={step === 1}>
                      ← Previous
                    </Button>
                    <div className="flex gap-2">
                      {step < 4 && (
                        <Button type="button" onClick={nextStep} className="bg-blue-600 hover:bg-blue-700">
                          Next →
                        </Button>
                      )}
                      {step === 4 && (
                        <Button
                          type="button"
                          onClick={createEnrollment}
                          disabled={!canPost || creating}
                          className="bg-blue-600 hover:bg-blue-700"
                        >
                          {creating ? (
                            <span className="flex items-center gap-2">
                              <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              Submitting…
                            </span>
                          ) : "Submit Intake"}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Workflow Action Panel ── */}
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-5 py-4">
                  <h2 className="text-base font-semibold text-slate-900">Workflow Actions</h2>
                  <p className="mt-0.5 text-xs text-slate-500">Move an enrollment through the approval pipeline</p>
                </div>
                <div className="p-5 space-y-4">

                  {/* Select enrollment */}
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Select Student</Label>
                    <Select
                      value={targetId || "__none__"}
                      onValueChange={(value) => setTargetId(value === "__none__" ? "" : value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Choose from queue…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Choose from queue…</SelectItem>
                        {rows.slice(0, 30).map((row) => (
                          <SelectItem key={row.id} value={row.id}>
                            {studentName(row.payload || {})}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {/* Or paste ID */}
                    <Input
                      placeholder="Or paste enrollment ID directly"
                      value={targetId}
                      onChange={(e) => setTargetId(e.target.value)}
                      className="text-xs"
                    />

                    {/* Selected enrollment preview */}
                    {selectedEnrollment && (
                      <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                        <div className="font-semibold">{studentName(selectedEnrollment.payload || {})}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <EnrollmentStatusBadge status={selectedEnrollment.status} />
                          <span className="text-blue-500">{studentClass(selectedEnrollment.payload || {})}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Action selector */}
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Action</Label>
                    <div className="grid gap-1.5">
                      {(Object.keys(actionConfig) as ActionType[]).map((act) => {
                        const cfg = actionConfig[act];
                        return (
                          <button
                            key={act}
                            onClick={() => setAction(act)}
                            className={`flex items-start gap-2 rounded-xl border p-2.5 text-left transition ${
                              action === act
                                ? "border-blue-200 bg-blue-50"
                                : "border-slate-100 hover:border-slate-200 hover:bg-slate-50"
                            }`}
                          >
                            <span className="text-base">{cfg.icon}</span>
                            <div>
                              <div className={`text-xs font-semibold ${action === act ? "text-blue-800" : "text-slate-700"}`}>{cfg.label}</div>
                              <div className="text-xs text-slate-400 leading-tight mt-0.5">{cfg.description}</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Rejection reason */}
                  {action === "reject" && (
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rejection Reason *</Label>
                      <Textarea
                        placeholder="State the reason for rejection…"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        className="resize-none text-sm"
                        rows={3}
                      />
                    </div>
                  )}

                  <Button
                    onClick={runAction}
                    disabled={submitting || !targetId.trim()}
                    className="w-full bg-blue-600 hover:bg-blue-700"
                  >
                    {submitting ? (
                      <span className="flex items-center gap-2">
                        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Running…
                      </span>
                    ) : `Run: ${actionConfig[action].label}`}
                  </Button>
                </div>
              </div>
            </div>

            {/* ── Status Chart + Queue Table ── */}
            <div className="grid gap-5 xl:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
                <h3 className="mb-3 text-sm font-semibold text-slate-800">Enrollment Status Overview</h3>
                <ChartContainer config={chartConfig} className="h-[200px] w-full">
                  <BarChart accessibilityLayer data={chartData}>
                    <CartesianGrid vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="status" tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 10 }} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" fill="var(--color-count)" radius={6} />
                  </BarChart>
                </ChartContainer>
              </div>

              <div className="xl:col-span-2 rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-5 py-4 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-800">Enrollment Queue</h3>
                  <span className="text-xs text-slate-400">{rows.length} records</span>
                </div>
                <div className="overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50">
                        <TableHead className="text-xs">Student</TableHead>
                        <TableHead className="text-xs">Class</TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                        <TableHead className="text-xs">ID</TableHead>
                        <TableHead className="text-xs"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {!loading && rows.slice(0, 15).map((row) => (
                        <TableRow
                          key={row.id}
                          className={`hover:bg-slate-50 cursor-pointer ${targetId === row.id ? "bg-blue-50" : ""}`}
                          onClick={() => setTargetId(row.id)}
                        >
                          <TableCell className="text-sm font-medium">{studentName(row.payload || {})}</TableCell>
                          <TableCell>
                            <span className="font-mono text-xs text-slate-500">{studentClass(row.payload || {}) || "—"}</span>
                          </TableCell>
                          <TableCell><EnrollmentStatusBadge status={row.status} /></TableCell>
                          <TableCell className="font-mono text-xs text-slate-400">{row.id.slice(0, 8)}…</TableCell>
                          <TableCell>
                            <button
                              onClick={(e) => { e.stopPropagation(); setTargetId(row.id); }}
                              className="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 transition"
                            >
                              Select
                            </button>
                          </TableCell>
                        </TableRow>
                      ))}
                      {!loading && rows.length === 0 && (
                        <EmptyRow colSpan={5} message="No enrollments found." />
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════
            STUDENTS SECTION
        ══════════════════════════════════════════════════════════════ */}
        {section === "students" && (
          <div className="space-y-5">

            {/* Add Existing Student */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-6 py-4">
                <h2 className="text-base font-semibold text-slate-900">Add Existing Student</h2>
                <p className="mt-0.5 text-sm text-slate-500">Register a returning or already-enrolled student into the system.</p>
              </div>
              <div className="p-6">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <FormField label="Student Full Name" required>
                    <Input
                      placeholder="e.g. Achieng Atieno"
                      value={existingStudentDraft.student_name}
                      onChange={(e) => setExistingStudentDraft((p) => ({ ...p, student_name: e.target.value }))}
                    />
                  </FormField>
                  <FormField label="Admission Class" required>
                    <Input
                      placeholder="e.g. GRADE_7"
                      value={existingStudentDraft.admission_class}
                      onChange={(e) => setExistingStudentDraft((p) => ({ ...p, admission_class: e.target.value }))}
                    />
                  </FormField>
                  <FormField label="Date of Birth">
                    <Input
                      type="date"
                      value={existingStudentDraft.date_of_birth}
                      onChange={(e) => setExistingStudentDraft((p) => ({ ...p, date_of_birth: e.target.value }))}
                    />
                  </FormField>
                  <FormField label="Previous School">
                    <Input
                      placeholder="Optional"
                      value={existingStudentDraft.previous_school}
                      onChange={(e) => setExistingStudentDraft((p) => ({ ...p, previous_school: e.target.value }))}
                    />
                  </FormField>
                  <FormField label="Guardian Name" required>
                    <Input
                      placeholder="e.g. Jane Atieno"
                      value={existingStudentDraft.guardian_name}
                      onChange={(e) => setExistingStudentDraft((p) => ({ ...p, guardian_name: e.target.value }))}
                    />
                  </FormField>
                  <FormField label="Guardian Phone" required>
                    <Input
                      placeholder="+2547XXXXXXXX"
                      value={existingStudentDraft.guardian_phone}
                      onChange={(e) => setExistingStudentDraft((p) => ({ ...p, guardian_phone: e.target.value }))}
                    />
                  </FormField>
                  <FormField label="Guardian Email">
                    <Input
                      placeholder="guardian@example.com"
                      value={existingStudentDraft.guardian_email}
                      onChange={(e) => setExistingStudentDraft((p) => ({ ...p, guardian_email: e.target.value }))}
                    />
                  </FormField>
                  <FormField label="Assessment Number">
                    <Input
                      placeholder="Optional"
                      value={existingStudentDraft.assessment_no}
                      onChange={(e) => setExistingStudentDraft((p) => ({ ...p, assessment_no: e.target.value }))}
                    />
                  </FormField>
                  <FormField label="NEMIS Number">
                    <Input
                      placeholder="Optional"
                      value={existingStudentDraft.nemis_no}
                      onChange={(e) => setExistingStudentDraft((p) => ({ ...p, nemis_no: e.target.value }))}
                    />
                  </FormField>
                </div>
                <div className="mt-5 flex gap-2">
                  <Button
                    onClick={createExistingStudentEnrollment}
                    disabled={creatingExistingStudent}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {creatingExistingStudent ? "Adding…" : "+ Add Student"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setExistingStudentDraft(INITIAL_EXISTING_STUDENT_DRAFT)}
                    disabled={creatingExistingStudent}
                  >
                    Clear
                  </Button>
                </div>
              </div>
            </div>

            {/* Enrolled Students Table */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-6 py-4 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Enrolled Students</h2>
                  <p className="mt-0.5 text-xs text-slate-500">Students with ENROLLED status under this tenant</p>
                </div>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                  {studentRows.length} enrolled
                </span>
              </div>
              <div className="overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs">Student Name</TableHead>
                      <TableHead className="text-xs">Class</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs">Record ID</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!loading && studentRows.slice(0, 20).map((row) => (
                      <TableRow key={row.id} className="hover:bg-slate-50">
                        <TableCell className="text-sm font-medium">{studentName(row.payload || {})}</TableCell>
                        <TableCell>
                          <span className="font-mono text-xs text-slate-500">{studentClass(row.payload || {}) || "—"}</span>
                        </TableCell>
                        <TableCell><EnrollmentStatusBadge status={row.status} /></TableCell>
                        <TableCell className="font-mono text-xs text-slate-400">{row.id}</TableCell>
                      </TableRow>
                    ))}
                    {!loading && studentRows.length === 0 && (
                      <EmptyRow colSpan={4} message="No enrolled students found." />
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default function SecretaryEnrollmentsPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          <p className="text-sm text-slate-500">Loading enrollments…</p>
        </div>
      </div>
    }>
      <SecretaryEnrollmentsPageContent />
    </Suspense>
  );
}