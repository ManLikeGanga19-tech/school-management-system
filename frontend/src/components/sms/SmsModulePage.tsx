"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Coins,
  FileText,
  History,
  Loader2,
  Megaphone,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Users,
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
import { normalizeClassOptions, type TenantClassOption } from "@/lib/hr";

// ── Types ─────────────────────────────────────────────────────────────────────

type CreditAccount = {
  balance_units: number;
  price_per_unit_kes: number;
  updated_at: string | null;
};

type TopupResult = {
  topup_id: string;
  checkout_request_id: string | null;
  units_requested: number;
  amount_kes: number;
  status: string;
  duplicate: boolean;
};

type TopupHistory = {
  id: string;
  units_requested: number;
  amount_kes: number;
  price_per_unit_kes: number;
  phone_number: string;
  status: string;
  mpesa_receipt: string | null;
  checkout_request_id: string | null;
  created_at: string | null;
  completed_at: string | null;
};

type SmsMessage = {
  id: string;
  to_phone: string;
  recipient_name: string | null;
  message_body: string;
  units_deducted: number;
  status: string;
  provider_message_id: string | null;
  error_message: string | null;
  created_at: string | null;
  sent_at: string | null;
};

type Template = {
  id: string;
  name: string;
  body: string;
  variables: string[];
  created_at: string | null;
  updated_at: string | null;
};

type BroadcastRecipient = { phone: string; name: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

function asArr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}
function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function normAccount(raw: unknown): CreditAccount | null {
  const o = asObj(raw);
  if (!o) return null;
  return {
    balance_units: Number(o.balance_units ?? 0),
    price_per_unit_kes: Number(o.price_per_unit_kes ?? 1.5),
    updated_at: (o.updated_at as string) ?? null,
  };
}

function normTopupHistory(raw: unknown): TopupHistory[] {
  return asArr<unknown>(raw).flatMap((r) => {
    const o = asObj(r);
    if (!o?.id) return [];
    return [
      {
        id: String(o.id),
        units_requested: Number(o.units_requested ?? 0),
        amount_kes: Number(o.amount_kes ?? 0),
        price_per_unit_kes: Number(o.price_per_unit_kes ?? 0),
        phone_number: String(o.phone_number ?? ""),
        status: String(o.status ?? "pending"),
        mpesa_receipt: (o.mpesa_receipt as string) ?? null,
        checkout_request_id: (o.checkout_request_id as string) ?? null,
        created_at: (o.created_at as string) ?? null,
        completed_at: (o.completed_at as string) ?? null,
      },
    ];
  });
}

function normMessages(raw: unknown): SmsMessage[] {
  return asArr<unknown>(raw).flatMap((r) => {
    const o = asObj(r);
    if (!o?.id) return [];
    return [
      {
        id: String(o.id),
        to_phone: String(o.to_phone ?? ""),
        recipient_name: (o.recipient_name as string) ?? null,
        message_body: String(o.message_body ?? ""),
        units_deducted: Number(o.units_deducted ?? 1),
        status: String(o.status ?? "QUEUED"),
        provider_message_id: (o.provider_message_id as string) ?? null,
        error_message: (o.error_message as string) ?? null,
        created_at: (o.created_at as string) ?? null,
        sent_at: (o.sent_at as string) ?? null,
      },
    ];
  });
}

function normTemplates(raw: unknown): Template[] {
  return asArr<unknown>(raw).flatMap((r) => {
    const o = asObj(r);
    if (!o?.id) return [];
    return [
      {
        id: String(o.id),
        name: String(o.name ?? ""),
        body: String(o.body ?? ""),
        variables: asArr<string>(o.variables),
        created_at: (o.created_at as string) ?? null,
        updated_at: (o.updated_at as string) ?? null,
      },
    ];
  });
}

function statusBadge(status: string) {
  const s = status.toUpperCase();
  if (s === "COMPLETED" || s === "SENT" || s === "DELIVERED")
    return "bg-green-100 text-green-800";
  if (s === "FAILED" || s === "CANCELLED") return "bg-red-100 text-red-800";
  if (s === "PENDING" || s === "QUEUED") return "bg-yellow-100 text-yellow-800";
  return "bg-gray-100 text-gray-700";
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-KE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  title: "Director" | "Secretary";
  nav: AppNavItem[];
  canTopup?: boolean; // Director only
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function SmsModulePage({ title, nav, canTopup = false }: Props) {
  const searchParams = useSearchParams();
  const section = (searchParams.get("section") ?? "send") as
    | "send"
    | "broadcast"
    | "history"
    | "templates"
    | "credits";

  // ── State ─────────────────────────────────────────────────────────────────

  const [account, setAccount] = useState<CreditAccount | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);

  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);

  const [topupHistory, setTopupHistory] = useState<TopupHistory[]>([]);
  const [topupLoading, setTopupLoading] = useState(false);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  // Send form
  const [sendPhone, setSendPhone] = useState("");
  const [sendName, setSendName] = useState("");
  const [sendBody, setSendBody] = useState("");
  const [sending, setSending] = useState(false);

  // Broadcast form
  const [bcastBody, setBcastBody] = useState("");
  const [bcastRecipients, setBcastRecipients] = useState("");
  const [broadcasting, setBroadcasting] = useState(false);

  // Broadcast enhancements: class filter + parent autofill
  const [classes, setClasses] = useState<TenantClassOption[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [loadingParents, setLoadingParents] = useState(false);

  // Top-up dialog
  const [topupOpen, setTopupOpen] = useState(false);
  const [topupPhone, setTopupPhone] = useState("");
  const [topupUnits, setTopupUnits] = useState("");
  const [toppingUp, setToppingUp] = useState(false);
  const [pendingCheckoutId, setPendingCheckoutId] = useState<string | null>(null);
  const [pollInterval, setPollInterval] = useState<ReturnType<typeof setInterval> | null>(null);

  // Template dialogs
  const [tmplDialogOpen, setTmplDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [tmplName, setTmplName] = useState("");
  const [tmplBody, setTmplBody] = useState("");
  const [tmplSaving, setTmplSaving] = useState(false);

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchAccount = useCallback(async () => {
    setAccountLoading(true);
    try {
      const res = await api.get<unknown>("/sms/account", { tenantRequired: true });
      setAccount(normAccount(res));
    } catch {
      // ignore
    } finally {
      setAccountLoading(false);
    }
  }, []);

  const fetchMessages = useCallback(async () => {
    setMessagesLoading(true);
    try {
      const res = await api.get<unknown>("/sms/messages", { tenantRequired: true });
      setMessages(normMessages(res));
    } catch {
      // ignore
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  const fetchTopupHistory = useCallback(async () => {
    setTopupLoading(true);
    try {
      const res = await api.get<unknown>("/sms/topup/history", { tenantRequired: true });
      setTopupHistory(normTopupHistory(res));
    } catch {
      // ignore
    } finally {
      setTopupLoading(false);
    }
  }, []);

  const fetchTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const res = await api.get<unknown>("/sms/templates", { tenantRequired: true });
      setTemplates(normTemplates(res));
    } catch {
      // ignore
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  const fetchClasses = useCallback(async () => {
    try {
      const res = await api.get<unknown>("/tenants/classes", { tenantRequired: true });
      setClasses(normalizeClassOptions(res));
    } catch {
      // ignore
    }
  }, []);

  async function loadParents() {
    setLoadingParents(true);
    try {
      const params = selectedClassId ? `?class_id=${selectedClassId}` : "";
      const res = await api.get<unknown[]>(`/tenants/sms/recipients${params}`, {
        tenantRequired: true,
      });
      const lines = (Array.isArray(res) ? res : []).map((r) => {
        const o = r as Record<string, unknown>;
        const phone = String(o.phone ?? "");
        const name = String(o.name ?? "").trim();
        return name ? `${phone} ${name}` : phone;
      });
      setBcastRecipients(lines.join("\n"));
      toast.success(`Loaded ${lines.length} parent(s)`);
    } catch {
      toast.error("Failed to load parents");
    } finally {
      setLoadingParents(false);
    }
  }

  useEffect(() => {
    fetchAccount();
    if (section === "history") fetchMessages();
    if (section === "credits") fetchTopupHistory();
    if (section === "templates") fetchTemplates();
    if (section === "broadcast") { fetchClasses(); fetchTemplates(); }
  }, [section, fetchAccount, fetchMessages, fetchTopupHistory, fetchTemplates, fetchClasses]);

  // ── Top-up polling ─────────────────────────────────────────────────────────

  const stopPolling = useCallback(() => {
    if (pollInterval) {
      clearInterval(pollInterval);
      setPollInterval(null);
    }
  }, [pollInterval]);

  useEffect(() => () => { if (pollInterval) clearInterval(pollInterval); }, [pollInterval]);

  const startPolling = useCallback((checkoutId: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await api.get<Record<string, unknown>>(
          `/sms/topup/status?checkout_request_id=${encodeURIComponent(checkoutId)}`,
          { tenantRequired: true }
        );
        const status = String((res as Record<string, unknown>)?.status ?? "");
        if (status === "completed") {
          clearInterval(interval);
          setPollInterval(null);
          setPendingCheckoutId(null);
          toast.success("SMS credits added successfully!");
          fetchAccount();
          fetchTopupHistory();
        } else if (status === "failed" || status === "cancelled") {
          clearInterval(interval);
          setPollInterval(null);
          setPendingCheckoutId(null);
          toast.error("Top-up payment failed. Please try again.");
        }
      } catch {
        // ignore polling errors
      }
    }, 3000);
    setPollInterval(interval);
  }, [fetchAccount, fetchTopupHistory]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!sendPhone || !sendBody) return;
    setSending(true);
    try {
      await api.post<unknown>("/sms/send", {
        to_phone: sendPhone,
        message_body: sendBody,
        recipient_name: sendName || undefined,
      }, { tenantRequired: true });
      toast.success("SMS sent successfully!");
      setSendPhone("");
      setSendName("");
      setSendBody("");
      fetchAccount();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to send SMS";
      toast.error(msg);
    } finally {
      setSending(false);
    }
  }

  async function handleBroadcast(e: React.FormEvent) {
    e.preventDefault();
    if (!bcastBody || !bcastRecipients) return;

    // Parse recipients: "07XXXXXXXX Name" or "07XXXXXXXX" per line
    const lines = bcastRecipients.split("\n").map(l => l.trim()).filter(Boolean);
    const recipients: BroadcastRecipient[] = lines.map(line => {
      const parts = line.split(/\s+/);
      return { phone: parts[0], name: parts.slice(1).join(" ") || "" };
    });

    if (recipients.length === 0) {
      toast.error("No valid recipients");
      return;
    }

    setBroadcasting(true);
    try {
      const res = await api.post<Record<string, unknown>>("/sms/send/broadcast", {
        recipients,
        message_body: bcastBody,
      }, { tenantRequired: true });
      const sent = Number(res?.sent ?? 0);
      const failed = Number(res?.failed ?? 0);
      toast.success(`Broadcast complete: ${sent} sent, ${failed} failed`);
      setBcastBody("");
      setBcastRecipients("");
      fetchAccount();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Broadcast failed";
      toast.error(msg);
    } finally {
      setBroadcasting(false);
    }
  }

  async function handleTopup(e: React.FormEvent) {
    e.preventDefault();
    if (!topupPhone || !topupUnits) return;
    const units = parseInt(topupUnits);
    if (isNaN(units) || units < 10) {
      toast.error("Minimum top-up is 10 units");
      return;
    }
    setToppingUp(true);
    try {
      const res = await api.post<Record<string, unknown>>("/sms/topup", {
        phone_number: topupPhone,
        units_requested: units,
      }, { tenantRequired: true });
      const checkoutId = String(res?.checkout_request_id ?? "");
      setPendingCheckoutId(checkoutId);
      toast.success("M-Pesa STK push sent! Check your phone.");
      setTopupOpen(false);
      setTopupPhone("");
      setTopupUnits("");
      if (checkoutId) startPolling(checkoutId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Top-up initiation failed";
      toast.error(msg);
    } finally {
      setToppingUp(false);
    }
  }

  function openCreateTemplate() {
    setEditingTemplate(null);
    setTmplName("");
    setTmplBody("");
    setTmplDialogOpen(true);
  }

  function openEditTemplate(tmpl: Template) {
    setEditingTemplate(tmpl);
    setTmplName(tmpl.name);
    setTmplBody(tmpl.body);
    setTmplDialogOpen(true);
  }

  async function handleSaveTemplate(e: React.FormEvent) {
    e.preventDefault();
    if (!tmplName || !tmplBody) return;
    setTmplSaving(true);
    try {
      if (editingTemplate) {
        await api.patch<unknown>(`/sms/templates/${editingTemplate.id}`, {
          name: tmplName, body: tmplBody,
        }, { tenantRequired: true });
        toast.success("Template updated");
      } else {
        await api.post<unknown>("/sms/templates", {
          name: tmplName, body: tmplBody, variables: [],
        }, { tenantRequired: true });
        toast.success("Template created");
      }
      setTmplDialogOpen(false);
      fetchTemplates();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Save failed";
      toast.error(msg);
    } finally {
      setTmplSaving(false);
    }
  }

  async function handleDeleteTemplate(id: string) {
    if (!confirm("Delete this template?")) return;
    try {
      await api.delete<unknown>(`/sms/templates/${id}`, {}, { tenantRequired: true });
      toast.success("Template deleted");
      fetchTemplates();
    } catch {
      toast.error("Failed to delete template");
    }
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  const price = account?.price_per_unit_kes ?? 1.5;
  const units = parseInt(topupUnits) || 0;
  const topupCost = units > 0 ? (units * price).toFixed(2) : null;

  // ── Sections ───────────────────────────────────────────────────────────────

  const renderCreditsPanel = () => (
    <div className="space-y-6">
      {/* Balance card */}
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500">SMS Credit Balance</p>
            <p className="text-4xl font-bold text-gray-900">
              {accountLoading ? "…" : (account?.balance_units ?? 0).toLocaleString()}
            </p>
            <p className="text-sm text-gray-500">units remaining</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-500">Price per SMS</p>
            <p className="text-2xl font-semibold text-blue-700">
              KES {price.toFixed(2)}
            </p>
          </div>
        </div>
        {canTopup && (
          <div className="mt-4">
            <Button onClick={() => setTopupOpen(true)} className="gap-2">
              <Coins className="h-4 w-4" /> Buy Credits via M-Pesa
            </Button>
          </div>
        )}
        {pendingCheckoutId && (
          <div className="mt-3 flex items-center gap-2 rounded-md bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
            <Loader2 className="h-4 w-4 animate-spin" />
            Waiting for M-Pesa payment confirmation…
          </div>
        )}
      </div>

      {/* Top-up history */}
      <div className="rounded-lg border bg-white shadow-sm">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="font-medium">Top-up History</h3>
          <Button variant="ghost" size="sm" onClick={fetchTopupHistory} className="gap-1">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
        {topupLoading ? (
          <div className="flex items-center justify-center py-8 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : topupHistory.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">No top-up history yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-right">Units</th>
                  <th className="px-4 py-2 text-right">Amount (KES)</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {topupHistory.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-600">{fmtDate(t.created_at)}</td>
                    <td className="px-4 py-2 text-right font-medium">{t.units_requested.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right">{t.amount_kes.toFixed(2)}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(t.status)}`}>
                        {t.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-500">
                      {t.mpesa_receipt ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );

  const renderSendPanel = () => (
    <div className="max-w-xl">
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <h3 className="mb-4 font-semibold text-gray-800">Send Single SMS</h3>
        <form onSubmit={handleSend} className="space-y-4">
          <div>
            <Label htmlFor="sendPhone">Phone Number</Label>
            <Input
              id="sendPhone"
              placeholder="07XXXXXXXX"
              value={sendPhone}
              onChange={(e) => setSendPhone(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="sendName">Recipient Name (optional)</Label>
            <Input
              id="sendName"
              placeholder="e.g. Jane Wanjiru"
              value={sendName}
              onChange={(e) => setSendName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="sendBody">Message</Label>
            <Textarea
              id="sendBody"
              placeholder="Type your message here…"
              rows={4}
              value={sendBody}
              onChange={(e) => setSendBody(e.target.value)}
              required
            />
            <p className="mt-1 text-xs text-gray-400">
              {sendBody.length} / 160 chars
              {sendBody.length > 160 ? ` (${Math.ceil(sendBody.length / 160)} SMS segments)` : ""}
            </p>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              Balance: <span className="font-semibold">{account?.balance_units ?? 0} units</span>
            </p>
            <Button type="submit" disabled={sending} className="gap-2">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send SMS
            </Button>
          </div>
        </form>
      </div>
    </div>
  );

  const renderBroadcastPanel = () => (
    <div className="max-w-2xl space-y-4">
      {/* Parent phone autofill */}
      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-medium text-gray-700">Load parents automatically</p>
        <div className="flex items-center gap-2">
          <Select value={selectedClassId} onValueChange={setSelectedClassId}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All classes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All classes</SelectItem>
              {classes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            onClick={loadParents}
            disabled={loadingParents}
            className="gap-2"
          >
            {loadingParents ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Users className="h-4 w-4" />
            )}
            Load Parents
          </Button>
          <p className="text-xs text-gray-400">
            Loads parent phone numbers{selectedClassId ? " for selected class" : " for all classes"}
          </p>
        </div>
      </div>

      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <h3 className="mb-1 font-semibold text-gray-800">Broadcast SMS</h3>
        <p className="mb-4 text-sm text-gray-500">
          Send the same message to multiple parents. Enter one number per line (optionally followed by the name).
        </p>
        <form onSubmit={handleBroadcast} className="space-y-4">
          <div>
            <Label>Recipients (one per line)</Label>
            <Textarea
              placeholder={"0712345678 Jane Wanjiru\n0723456789 Peter Kamau\n0734567890"}
              rows={6}
              value={bcastRecipients}
              onChange={(e) => setBcastRecipients(e.target.value)}
              className="font-mono text-sm"
              required
            />
            <p className="mt-1 text-xs text-gray-400">
              {bcastRecipients.split("\n").filter(l => l.trim()).length} recipient(s)
            </p>
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <Label>Message</Label>
              {templates.length > 0 && (
                <Select
                  value=""
                  onValueChange={(id) => {
                    const tmpl = templates.find((t) => t.id === id);
                    if (tmpl) setBcastBody(tmpl.body);
                  }}
                >
                  <SelectTrigger className="h-7 w-48 text-xs">
                    <SelectValue placeholder="Use template…" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id} className="text-xs">
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <Textarea
              placeholder="Type your message…"
              rows={4}
              value={bcastBody}
              onChange={(e) => setBcastBody(e.target.value)}
              required
            />
            <p className="mt-1 text-xs text-gray-400">{bcastBody.length} chars</p>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              Balance: <span className="font-semibold">{account?.balance_units ?? 0} units</span>
            </p>
            <Button type="submit" disabled={broadcasting} className="gap-2">
              {broadcasting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
              Broadcast
            </Button>
          </div>
        </form>
      </div>
    </div>
  );

  const renderHistoryPanel = () => (
    <div className="rounded-lg border bg-white shadow-sm">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="font-medium">Message History</h3>
        <Button variant="ghost" size="sm" onClick={fetchMessages} className="gap-1">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>
      {messagesLoading ? (
        <div className="flex items-center justify-center py-8 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : messages.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">No messages sent yet</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left">Date</th>
                <th className="px-4 py-2 text-left">To</th>
                <th className="px-4 py-2 text-left">Message</th>
                <th className="px-4 py-2 text-center">Units</th>
                <th className="px-4 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {messages.map((m) => (
                <tr key={m.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">{fmtDate(m.created_at)}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <p className="font-medium">{m.recipient_name ?? m.to_phone}</p>
                    {m.recipient_name && <p className="text-xs text-gray-400">{m.to_phone}</p>}
                  </td>
                  <td className="max-w-xs px-4 py-2 text-gray-700 truncate">{m.message_body}</td>
                  <td className="px-4 py-2 text-center">{m.units_deducted}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(m.status)}`}>
                      {m.status}
                    </span>
                    {m.error_message && (
                      <p className="mt-0.5 text-xs text-red-500">{m.error_message}</p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const renderTemplatesPanel = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          Create reusable message templates for common notifications.
        </p>
        <Button onClick={openCreateTemplate} className="gap-2">
          <Plus className="h-4 w-4" /> New Template
        </Button>
      </div>
      <div className="rounded-lg border bg-white shadow-sm">
        {templatesLoading ? (
          <div className="flex items-center justify-center py-8 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : templates.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">
            No templates yet. Create one to reuse common messages.
          </p>
        ) : (
          <div className="divide-y">
            {templates.map((t) => (
              <div key={t.id} className="flex items-start justify-between gap-4 px-4 py-4 hover:bg-gray-50">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-800">{t.name}</p>
                  <p className="mt-0.5 text-sm text-gray-500 truncate">{t.body}</p>
                  {t.variables.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {t.variables.map((v) => (
                        <span key={v} className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">
                          {"{" + v + "}"}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => openEditTemplate(t)}>
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700"
                    onClick={() => handleDeleteTemplate(t.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // ── Section tabs ───────────────────────────────────────────────────────────

  const tabs = [
    { id: "send",      label: "Send",            icon: Send },
    { id: "broadcast", label: "Broadcast",        icon: Megaphone },
    { id: "history",   label: "History",          icon: History },
    { id: "templates", label: "Templates",         icon: FileText },
    { id: "credits",   label: "Credits",           icon: Coins },
  ] as const;

  return (
    <AppShell nav={nav} title={`${title} — Messages`}>
      <div className="space-y-6 p-4 md:p-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <MessageSquare className="h-6 w-6 text-blue-600" />
          <div>
            <h1 className="text-xl font-semibold text-gray-900">SMS Messaging</h1>
            <p className="text-sm text-gray-500">
              Send SMS notifications to parents and guardians
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700">
            <Coins className="h-4 w-4" />
            {accountLoading ? "…" : (account?.balance_units ?? 0).toLocaleString()} credits
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1 w-fit">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = section === tab.id;
            return (
              <a
                key={tab.id}
                href={`?section=${tab.id}`}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-white shadow-sm text-gray-900"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </a>
            );
          })}
        </div>

        {/* Section content */}
        {section === "send" && renderSendPanel()}
        {section === "broadcast" && renderBroadcastPanel()}
        {section === "history" && renderHistoryPanel()}
        {section === "templates" && renderTemplatesPanel()}
        {section === "credits" && renderCreditsPanel()}
      </div>

      {/* Top-up Dialog */}
      <Dialog open={topupOpen} onOpenChange={setTopupOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Buy SMS Credits via M-Pesa</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleTopup} className="space-y-4">
            <div>
              <Label>M-Pesa Phone Number</Label>
              <Input
                placeholder="07XXXXXXXX"
                value={topupPhone}
                onChange={(e) => setTopupPhone(e.target.value)}
                required
              />
            </div>
            <div>
              <Label>Number of SMS Credits</Label>
              <Input
                type="number"
                placeholder="e.g. 200"
                min={10}
                max={50000}
                value={topupUnits}
                onChange={(e) => setTopupUnits(e.target.value)}
                required
              />
            </div>
            {topupCost && (
              <div className="rounded-md bg-blue-50 px-4 py-3 text-sm">
                <p className="text-gray-600">Total cost:</p>
                <p className="text-xl font-bold text-blue-700">KES {topupCost}</p>
                <p className="text-xs text-gray-400">
                  {units.toLocaleString()} credits × KES {price.toFixed(2)} each
                </p>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setTopupOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={toppingUp} className="gap-2">
                {toppingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
                Send STK Push
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Template Dialog */}
      <Dialog open={tmplDialogOpen} onOpenChange={setTmplDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTemplate ? "Edit Template" : "New Template"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveTemplate} className="space-y-4">
            <div>
              <Label>Template Name</Label>
              <Input
                placeholder="e.g. Fee Reminder"
                value={tmplName}
                onChange={(e) => setTmplName(e.target.value)}
                required
              />
            </div>
            <div>
              <Label>Message Body</Label>
              <Textarea
                placeholder="Dear {parent_name}, your child {student_name} has an outstanding balance…"
                rows={5}
                value={tmplBody}
                onChange={(e) => setTmplBody(e.target.value)}
                required
              />
              <p className="mt-1 text-xs text-gray-400">
                Use {"{variable_name}"} for placeholders
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setTmplDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={tmplSaving} className="gap-2">
                {tmplSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingTemplate ? "Save Changes" : "Create Template"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
