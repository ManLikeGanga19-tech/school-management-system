"use client";

import { useState } from "react";
import { CheckCircle2, XCircle, ShieldCheck, Search } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { saasNav } from "@/components/layout/nav-config";
import { SaasPageHeader, SaasSurface } from "@/components/saas/page-chrome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";

type VerifyResult = {
  valid: boolean;
  receipt_no: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  student_name: string;
  amount: string;
  issued_at: string;
  provider?: string | null;
  received_at?: string | null;
  message: string;
};

function formatAmount(raw: string): string {
  const n = parseFloat(raw);
  if (isNaN(n)) return raw;
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 2,
  }).format(n);
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-KE", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function SaaSVerifyReceiptPage() {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function verify() {
    if (!token.trim()) {
      toast.error("Paste a receipt token to verify.");
      return;
    }
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const data = await api.get<VerifyResult>(
        `/admin/verify/receipt?token=${encodeURIComponent(token.trim())}`,
      );
      setResult(data);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Verification failed. Invalid or tampered token.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell title="SaaS Admin" nav={saasNav} activeHref="/saas/verify-receipt">
      <div className="space-y-6 max-w-2xl">
        <SaasPageHeader
          title="Receipt Verification"
          description="Cross-tenant receipt verification tool. All verifications are recorded in the audit log."
        />

        <SaasSurface>
          <div className="p-5 space-y-4">
            <div className="space-y-1.5">
              <Label>Receipt QR Token</Label>
              <p className="text-xs text-muted-foreground">
                Paste the JWT token extracted from the receipt QR code (e.g. from a scanner app).
              </p>
              <div className="flex gap-2">
                <Input
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…"
                  className="font-mono text-xs"
                  onKeyDown={(e) => e.key === "Enter" && verify()}
                />
                <Button onClick={verify} disabled={loading || !token.trim()} className="gap-2">
                  <Search className="h-4 w-4" />
                  {loading ? "Verifying…" : "Verify"}
                </Button>
              </div>
            </div>
          </div>
        </SaasSurface>

        {error && (
          <SaasSurface>
            <div className="p-5 flex items-start gap-3">
              <div className="rounded-full bg-red-50 p-2 shrink-0">
                <XCircle className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className="font-semibold text-sm">Verification Failed</p>
                <p className="text-sm text-muted-foreground mt-0.5">{error}</p>
              </div>
            </div>
          </SaasSurface>
        )}

        {result && (
          <SaasSurface>
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-green-50 p-2 shrink-0">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Receipt Valid</p>
                  <p className="text-xs text-muted-foreground">
                    Issued by <strong>{result.tenant_name}</strong> ({result.tenant_slug})
                  </p>
                </div>
              </div>

              <hr />

              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <ResultRow label="Receipt No." value={result.receipt_no} mono />
                <ResultRow label="Student" value={result.student_name} />
                <ResultRow label="Amount" value={formatAmount(result.amount)} bold />
                <ResultRow
                  label="Paid Via"
                  value={result.provider?.toUpperCase() || "—"}
                />
                <ResultRow
                  label="Date"
                  value={formatDate(result.received_at)}
                />
                <ResultRow
                  label="Issued At"
                  value={formatDate(result.issued_at)}
                />
                <ResultRow
                  label="Tenant ID"
                  value={result.tenant_id}
                  mono
                  span
                />
              </div>

              <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded p-3">
                <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
                <p>
                  This cross-tenant verification has been recorded in the system audit log with
                  your user ID and timestamp.
                </p>
              </div>
            </div>
          </SaasSurface>
        )}
      </div>
    </AppShell>
  );
}

function ResultRow({
  label,
  value,
  mono,
  bold,
  span,
}: {
  label: string;
  value: string;
  mono?: boolean;
  bold?: boolean;
  span?: boolean;
}) {
  return (
    <div className={span ? "col-span-2" : ""}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={[
          "text-sm",
          mono ? "font-mono text-xs break-all" : "",
          bold ? "font-semibold" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {value}
      </p>
    </div>
  );
}
