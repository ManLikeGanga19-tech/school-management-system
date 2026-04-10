"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BadgeDollarSign,
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  RefreshCw,
  Settings,
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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { normalizeStaff, type TenantStaff } from "@/lib/hr";
import { asArray } from "@/lib/utils/asArray";

// ── Types ─────────────────────────────────────────────────────────────────────

type SalaryStructure = {
  id: string;
  staff_id: string;
  staff_name: string;
  basic_salary: number;
  house_allowance: number;
  transport_allowance: number;
  other_allowances: number;
  helb_deduction: number;
  loan_deduction: number;
  effective_from: string;
  notes: string | null;
  updated_at: string | null;
};

type Payslip = {
  id: string;
  staff_id: string;
  staff_name: string;
  pay_month: number;
  pay_year: number;
  gross_pay: number;
  total_deductions: number;
  net_pay: number;
  paye: number;
  nhif: number;
  nssf_employee: number;
  nssf_employer: number;
  helb_deduction: number;
  loan_deduction: number;
  basic_salary: number;
  house_allowance: number;
  transport_allowance: number;
  other_allowances: number;
  generated_at: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v : String(v ?? "");
}

function asNum(v: unknown): number {
  return Number(v ?? 0);
}

function normSalaryStructures(raw: unknown): SalaryStructure[] {
  return asArray<unknown>(raw).flatMap((r) => {
    const o = asObj(r);
    if (!o?.id) return [];
    return [
      {
        id: asStr(o.id),
        staff_id: asStr(o.staff_id),
        staff_name: asStr(o.staff_name) || "Unknown",
        basic_salary: asNum(o.basic_salary),
        house_allowance: asNum(o.house_allowance),
        transport_allowance: asNum(o.transport_allowance),
        other_allowances: asNum(o.other_allowances),
        helb_deduction: asNum(o.helb_deduction),
        loan_deduction: asNum(o.loan_deduction),
        effective_from: asStr(o.effective_from),
        notes: (o.notes as string) ?? null,
        updated_at: (o.updated_at as string) ?? null,
      },
    ];
  });
}

function normPayslips(raw: unknown): Payslip[] {
  return asArray<unknown>(raw).flatMap((r) => {
    const o = asObj(r);
    if (!o?.id) return [];
    return [
      {
        id: asStr(o.id),
        staff_id: asStr(o.staff_id),
        staff_name: asStr(o.staff_name) || "Unknown",
        pay_month: asNum(o.pay_month),
        pay_year: asNum(o.pay_year),
        gross_pay: asNum(o.gross_pay),
        total_deductions: asNum(o.total_deductions),
        net_pay: asNum(o.net_pay),
        paye: asNum(o.paye),
        nhif: asNum(o.nhif),
        nssf_employee: asNum(o.nssf_employee),
        nssf_employer: asNum(o.nssf_employer),
        helb_deduction: asNum(o.helb_deduction),
        loan_deduction: asNum(o.loan_deduction),
        basic_salary: asNum(o.basic_salary),
        house_allowance: asNum(o.house_allowance),
        transport_allowance: asNum(o.transport_allowance),
        other_allowances: asNum(o.other_allowances),
        generated_at: (o.generated_at as string) ?? null,
      },
    ];
  });
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function fmtKes(n: number) {
  return `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-KE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  appTitle: string;
  nav: AppNavItem[];
  activeHref: string;
};

type Tab = "structures" | "generate" | "payslips";

// ── Component ─────────────────────────────────────────────────────────────────

export function PayrollPage({ appTitle, nav, activeHref }: Props) {
  const [tab, setTab] = useState<Tab>("structures");

  // Salary structures
  const [structures, setStructures] = useState<SalaryStructure[]>([]);
  const [structuresLoading, setStructuresLoading] = useState(false);

  // Payslips
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [payslipsLoading, setPayslipsLoading] = useState(false);
  const [expandedPayslip, setExpandedPayslip] = useState<string | null>(null);

  // Staff list (for salary structure upsert + generate form)
  const [staff, setStaff] = useState<TenantStaff[]>([]);

  // Salary structure dialog
  const [structDialogOpen, setStructDialogOpen] = useState(false);
  const [structTarget, setStructTarget] = useState<SalaryStructure | null>(null);
  const [structSaving, setStructSaving] = useState(false);
  const [structForm, setStructForm] = useState({
    staff_id: "",
    basic_salary: "",
    house_allowance: "0",
    transport_allowance: "0",
    other_allowances: "0",
    helb_deduction: "0",
    loan_deduction: "0",
    effective_from: "",
    notes: "",
  });

  // Generate payslips form
  const [genMonth, setGenMonth] = useState(String(new Date().getMonth() + 1));
  const [genYear, setGenYear] = useState(String(new Date().getFullYear()));
  const [generating, setGenerating] = useState(false);

  // Payslip filters
  const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()));
  const [filterMonth, setFilterMonth] = useState("");

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchStructures = useCallback(async () => {
    setStructuresLoading(true);
    try {
      const res = await api.get<unknown>("/tenants/hr/salary-structures", {
        tenantRequired: true,
      });
      setStructures(normSalaryStructures(res));
    } catch {
      toast.error("Failed to load salary structures");
    } finally {
      setStructuresLoading(false);
    }
  }, []);

  const fetchPayslips = useCallback(async () => {
    setPayslipsLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterYear) params.set("pay_year", filterYear);
      if (filterMonth) params.set("pay_month", filterMonth);
      const res = await api.get<unknown>(
        `/tenants/hr/payroll/payslips${params.toString() ? `?${params}` : ""}`,
        { tenantRequired: true }
      );
      setPayslips(normPayslips(res));
    } catch {
      toast.error("Failed to load payslips");
    } finally {
      setPayslipsLoading(false);
    }
  }, [filterYear, filterMonth]);

  const fetchStaff = useCallback(async () => {
    try {
      const res = await api.get<unknown>("/tenants/hr/staff?limit=500", {
        tenantRequired: true,
      });
      setStaff(normalizeStaff(res));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchStaff();
    if (tab === "structures") fetchStructures();
    if (tab === "payslips") fetchPayslips();
  }, [tab, fetchStructures, fetchPayslips, fetchStaff]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  function openEditStructure(s: SalaryStructure) {
    setStructTarget(s);
    setStructForm({
      staff_id: s.staff_id,
      basic_salary: String(s.basic_salary),
      house_allowance: String(s.house_allowance),
      transport_allowance: String(s.transport_allowance),
      other_allowances: String(s.other_allowances),
      helb_deduction: String(s.helb_deduction),
      loan_deduction: String(s.loan_deduction),
      effective_from: s.effective_from,
      notes: s.notes ?? "",
    });
    setStructDialogOpen(true);
  }

  function openCreateStructure() {
    setStructTarget(null);
    setStructForm({
      staff_id: "",
      basic_salary: "",
      house_allowance: "0",
      transport_allowance: "0",
      other_allowances: "0",
      helb_deduction: "0",
      loan_deduction: "0",
      effective_from: new Date().toISOString().split("T")[0],
      notes: "",
    });
    setStructDialogOpen(true);
  }

  async function handleSaveStructure(e: React.FormEvent) {
    e.preventDefault();
    const staffId = structTarget?.staff_id ?? structForm.staff_id;
    if (!staffId) return;
    setStructSaving(true);
    try {
      await api.put<unknown>(
        `/tenants/hr/salary-structures/${staffId}`,
        {
          basic_salary: Number(structForm.basic_salary),
          house_allowance: Number(structForm.house_allowance),
          transport_allowance: Number(structForm.transport_allowance),
          other_allowances: Number(structForm.other_allowances),
          helb_deduction: Number(structForm.helb_deduction),
          loan_deduction: Number(structForm.loan_deduction),
          effective_from: structForm.effective_from,
          notes: structForm.notes || undefined,
        },
        { tenantRequired: true }
      );
      toast.success("Salary structure saved");
      setStructDialogOpen(false);
      fetchStructures();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setStructSaving(false);
    }
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setGenerating(true);
    try {
      const res = await api.post<unknown[]>(
        "/tenants/hr/payroll/generate",
        {
          pay_month: Number(genMonth),
          pay_year: Number(genYear),
        },
        { tenantRequired: true }
      );
      const count = Array.isArray(res) ? res.length : 0;
      toast.success(`Generated ${count} payslip(s) for ${MONTHS[Number(genMonth) - 1]} ${genYear}`);
      setTab("payslips");
      setFilterYear(genYear);
      setFilterMonth(genMonth);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  // ── Tabs ───────────────────────────────────────────────────────────────────

  const tabs: { id: Tab; label: string }[] = [
    { id: "structures", label: "Salary Structures" },
    { id: "generate", label: "Generate Payslips" },
    { id: "payslips", label: "Payslip History" },
  ];

  // ── Render sections ────────────────────────────────────────────────────────

  const renderStructures = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          Define each staff member&apos;s pay components. Required before generating payslips.
        </p>
        <Button onClick={openCreateStructure} className="gap-2">
          <Plus className="h-4 w-4" /> Add Structure
        </Button>
      </div>
      <div className="rounded-lg border bg-white shadow-sm">
        {structuresLoading ? (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : structures.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-400">
            No salary structures yet. Add one to get started.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-left">Staff</th>
                  <th className="px-4 py-2 text-right">Basic</th>
                  <th className="px-4 py-2 text-right">House Allow.</th>
                  <th className="px-4 py-2 text-right">Transport</th>
                  <th className="px-4 py-2 text-right">Gross</th>
                  <th className="px-4 py-2 text-left">Effective</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {structures.map((s) => {
                  const gross =
                    s.basic_salary + s.house_allowance + s.transport_allowance + s.other_allowances;
                  return (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium">{s.staff_name}</td>
                      <td className="px-4 py-2 text-right">{s.basic_salary.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right">{s.house_allowance.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right">{s.transport_allowance.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right font-semibold text-blue-700">
                        {gross.toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-gray-500">{fmtDate(s.effective_from)}</td>
                      <td className="px-4 py-2 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditStructure(s)}
                          className="gap-1"
                        >
                          <Settings className="h-3.5 w-3.5" /> Edit
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );

  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 6 }, (_, i) => currentYear - 2 + i);

  const renderGenerate = () => (
    <div className="max-w-md">
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <h3 className="mb-1 font-semibold text-gray-800">Generate Monthly Payslips</h3>
        <p className="mb-4 text-sm text-gray-500">
          Payslips are computed from each staff member&apos;s salary structure using current Kenya
          statutory rates (PAYE, NHIF, NSSF). Already-generated slips for the same month are
          skipped.
        </p>
        <form onSubmit={handleGenerate} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Month</Label>
              <select
                className="w-full rounded-md border px-3 py-2 text-sm"
                value={genMonth}
                onChange={(e) => setGenMonth(e.target.value)}
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={String(i + 1)}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Year</Label>
              <select
                className="w-full rounded-md border px-3 py-2 text-sm"
                value={genYear}
                onChange={(e) => setGenYear(e.target.value)}
              >
                {yearOptions.map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="rounded-md bg-blue-50 px-4 py-3 text-sm text-blue-800">
            Will generate payslips for <strong>all staff</strong> with an active salary structure
            for <strong>{MONTHS[Number(genMonth) - 1]} {genYear}</strong>.
          </div>
          <Button type="submit" disabled={generating} className="w-full gap-2">
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <BadgeDollarSign className="h-4 w-4" />
            )}
            Generate Payslips
          </Button>
        </form>
      </div>
    </div>
  );

  const renderPayslips = () => (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <label className="mr-2 text-sm text-gray-500">Year:</label>
          <select
            className="rounded-md border px-2 py-1.5 text-sm"
            value={filterYear}
            onChange={(e) => setFilterYear(e.target.value)}
          >
            {yearOptions.map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mr-2 text-sm text-gray-500">Month:</label>
          <select
            className="rounded-md border px-2 py-1.5 text-sm"
            value={filterMonth}
            onChange={(e) => setFilterMonth(e.target.value)}
          >
            <option value="">All</option>
            {MONTHS.map((m, i) => (
              <option key={m} value={String(i + 1)}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <Button variant="ghost" size="sm" onClick={fetchPayslips} className="gap-1">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      <div className="rounded-lg border bg-white shadow-sm">
        {payslipsLoading ? (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : payslips.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-400">No payslips found</p>
        ) : (
          <div className="divide-y">
            {payslips.map((p) => {
              const expanded = expandedPayslip === p.id;
              return (
                <div key={p.id}>
                  <div
                    className="flex cursor-pointer items-center gap-4 px-4 py-3 hover:bg-gray-50"
                    onClick={() => setExpandedPayslip(expanded ? null : p.id)}
                  >
                    {expanded ? (
                      <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-800">{p.staff_name}</p>
                      <p className="text-xs text-gray-400">
                        {MONTHS[p.pay_month - 1]} {p.pay_year}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-green-700">{fmtKes(p.net_pay)}</p>
                      <p className="text-xs text-gray-400">net pay</p>
                    </div>
                  </div>
                  {expanded && (
                    <div className="border-t bg-gray-50 px-8 py-4 text-sm">
                      <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 max-w-lg">
                        <p className="text-gray-500">Basic Salary</p>
                        <p className="text-right">{fmtKes(p.basic_salary)}</p>
                        <p className="text-gray-500">House Allowance</p>
                        <p className="text-right">{fmtKes(p.house_allowance)}</p>
                        <p className="text-gray-500">Transport Allowance</p>
                        <p className="text-right">{fmtKes(p.transport_allowance)}</p>
                        <p className="text-gray-500">Other Allowances</p>
                        <p className="text-right">{fmtKes(p.other_allowances)}</p>
                        <p className="font-semibold">Gross Pay</p>
                        <p className="text-right font-semibold">{fmtKes(p.gross_pay)}</p>
                        <div className="col-span-2 my-1 border-t" />
                        <p className="text-gray-500">PAYE</p>
                        <p className="text-right text-red-600">- {fmtKes(p.paye)}</p>
                        <p className="text-gray-500">NHIF</p>
                        <p className="text-right text-red-600">- {fmtKes(p.nhif)}</p>
                        <p className="text-gray-500">NSSF (Employee)</p>
                        <p className="text-right text-red-600">- {fmtKes(p.nssf_employee)}</p>
                        <p className="text-gray-500">NSSF (Employer)</p>
                        <p className="text-right text-gray-400">{fmtKes(p.nssf_employer)}</p>
                        {p.helb_deduction > 0 && (
                          <>
                            <p className="text-gray-500">HELB</p>
                            <p className="text-right text-red-600">- {fmtKes(p.helb_deduction)}</p>
                          </>
                        )}
                        {p.loan_deduction > 0 && (
                          <>
                            <p className="text-gray-500">Loan Deduction</p>
                            <p className="text-right text-red-600">- {fmtKes(p.loan_deduction)}</p>
                          </>
                        )}
                        <p className="text-gray-500">Total Deductions</p>
                        <p className="text-right font-semibold text-red-700">
                          - {fmtKes(p.total_deductions)}
                        </p>
                        <div className="col-span-2 my-1 border-t" />
                        <p className="text-lg font-bold text-green-800">Net Pay</p>
                        <p className="text-right text-lg font-bold text-green-800">
                          {fmtKes(p.net_pay)}
                        </p>
                      </div>
                      <p className="mt-3 text-xs text-gray-400">
                        Generated: {fmtDate(p.generated_at)}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <AppShell nav={nav} title={`${appTitle} — Payroll`} activeHref={activeHref}>
      <div className="space-y-6 p-4 md:p-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <BadgeDollarSign className="h-6 w-6 text-blue-600" />
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Payroll</h1>
            <p className="text-sm text-gray-500">
              Manage salary structures and generate monthly payslips
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1 w-fit">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                tab === t.id
                  ? "bg-white shadow-sm text-gray-900"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {tab === "structures" && renderStructures()}
        {tab === "generate" && renderGenerate()}
        {tab === "payslips" && renderPayslips()}
      </div>

      {/* Salary Structure Dialog */}
      <Dialog open={structDialogOpen} onOpenChange={setStructDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {structTarget ? `Edit Salary Structure — ${structTarget.staff_name}` : "Add Salary Structure"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveStructure} className="space-y-4">
            {!structTarget && (
              <div>
                <Label>Staff Member</Label>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={structForm.staff_id}
                  onChange={(e) => setStructForm((f) => ({ ...f, staff_id: e.target.value }))}
                  required
                >
                  <option value="">Select staff…</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name} ({s.staff_no})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Basic Salary (KES)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={structForm.basic_salary}
                  onChange={(e) => setStructForm((f) => ({ ...f, basic_salary: e.target.value }))}
                  required
                />
              </div>
              <div>
                <Label>House Allowance (KES)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={structForm.house_allowance}
                  onChange={(e) => setStructForm((f) => ({ ...f, house_allowance: e.target.value }))}
                />
              </div>
              <div>
                <Label>Transport Allowance (KES)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={structForm.transport_allowance}
                  onChange={(e) =>
                    setStructForm((f) => ({ ...f, transport_allowance: e.target.value }))
                  }
                />
              </div>
              <div>
                <Label>Other Allowances (KES)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={structForm.other_allowances}
                  onChange={(e) =>
                    setStructForm((f) => ({ ...f, other_allowances: e.target.value }))
                  }
                />
              </div>
              <div>
                <Label>HELB Deduction (KES)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={structForm.helb_deduction}
                  onChange={(e) =>
                    setStructForm((f) => ({ ...f, helb_deduction: e.target.value }))
                  }
                />
              </div>
              <div>
                <Label>Loan Deduction (KES)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={structForm.loan_deduction}
                  onChange={(e) =>
                    setStructForm((f) => ({ ...f, loan_deduction: e.target.value }))
                  }
                />
              </div>
            </div>
            <div>
              <Label>Effective From</Label>
              <Input
                type="date"
                value={structForm.effective_from}
                onChange={(e) => setStructForm((f) => ({ ...f, effective_from: e.target.value }))}
                required
              />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea
                rows={2}
                value={structForm.notes}
                onChange={(e) => setStructForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setStructDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={structSaving}>
                {structSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
