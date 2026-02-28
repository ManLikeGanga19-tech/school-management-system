"use client";

import { Eye } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  admissionNumber,
  payloadBoolean,
  payloadString,
  studentClass,
  studentName,
  type EnrollmentRow,
} from "@/lib/students";
import { termFromPayload } from "@/lib/school-setup/terms";

type StudentDetailDialogProps = {
  row: EnrollmentRow | null;
  open: boolean;
  onClose: () => void;
};

export function StudentDetailDialog({
  row,
  open,
  onClose,
}: StudentDetailDialogProps) {
  if (!row) return null;

  const payload = row.payload || {};
  const admission = admissionNumber(row) || "—";

  const fields: Array<{ label: string; value: string }> = [
    { label: "Full Name", value: studentName(payload) },
    { label: "Admission Number", value: admission },
    { label: "Class", value: studentClass(payload) || "—" },
    { label: "Term", value: termFromPayload(payload) || "—" },
    { label: "Status", value: row.status || "—" },
    { label: "Intake Date", value: payloadString(payload, ["intake_date"]) || "—" },
    { label: "Date of Birth", value: payloadString(payload, ["date_of_birth"]) || "—" },
    { label: "Gender", value: payloadString(payload, ["gender"]) || "—" },
    { label: "Guardian Name", value: payloadString(payload, ["guardian_name"]) || "—" },
    { label: "Guardian Phone", value: payloadString(payload, ["guardian_phone"]) || "—" },
    { label: "Guardian Email", value: payloadString(payload, ["guardian_email"]) || "—" },
    { label: "Previous School", value: payloadString(payload, ["previous_school"]) || "—" },
    { label: "Assessment No.", value: payloadString(payload, ["assessment_no"]) || "—" },
    { label: "NEMIS No.", value: payloadString(payload, ["nemis_no"]) || "—" },
    {
      label: "Has Medical Condition",
      value: payloadBoolean(payload, [
        "has_medical_conditions",
        "has_underlying_medical_conditions",
      ])
        ? "Yes"
        : "No",
    },
    {
      label: "Medical Condition Details",
      value:
        payloadString(payload, [
          "medical_conditions_details",
          "underlying_medical_conditions",
          "medical_report",
        ]) || "—",
    },
    {
      label: "Medicine Kept In School",
      value: payloadBoolean(payload, [
        "has_medication_in_school",
        "medication_left_in_school",
      ])
        ? "Yes"
        : "No",
    },
    {
      label: "Medication Details",
      value:
        payloadString(payload, [
          "medication_in_school_details",
          "medication_prescription_details",
        ]) || "—",
    },
    { label: "Notes", value: payloadString(payload, ["notes"]) || "—" },
  ];

  const docsObj =
    payload.documents && typeof payload.documents === "object"
      ? (payload.documents as Record<string, unknown>)
      : null;
  const documentRows = docsObj
    ? Object.entries(docsObj).map(([key, value]) => ({
        key,
        present: Boolean(value),
      }))
    : [];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-slate-500" />
            Student Full Record
          </DialogTitle>
          <DialogDescription>
            Full details for {studentName(payload)}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[68vh] overflow-y-auto space-y-4">
          <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
            <span className="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 ring-1 ring-blue-200">
              {row.status || "UNKNOWN"}
            </span>
            {admission !== "—" && (
              <span className="font-mono text-xs font-semibold text-emerald-700">
                {admission}
              </span>
            )}
            <span className="ml-auto font-mono text-[11px] text-slate-400 select-all">
              {row.id}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            {fields.map((field) => (
              <div key={field.label} className="space-y-0.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  {field.label}
                </div>
                <div className="text-sm font-medium text-slate-900 break-words">
                  {field.value}
                </div>
              </div>
            ))}
          </div>

          {documentRows.length > 0 && (
            <div className="rounded-xl border border-slate-100 overflow-hidden">
              <div className="bg-slate-50 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Documents
              </div>
              <div className="grid grid-cols-2 gap-2 p-4">
                {documentRows.map((doc) => (
                  <div key={doc.key} className="flex items-center gap-2 text-sm">
                    <span className={doc.present ? "text-emerald-500" : "text-red-400"}>
                      {doc.present ? "✓" : "✗"}
                    </span>
                    <span className={doc.present ? "text-slate-700" : "text-slate-400"}>
                      {doc.key.replace(/_/g, " ")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
