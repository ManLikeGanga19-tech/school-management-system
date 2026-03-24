"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, XCircle, Loader2, ShieldCheck } from "lucide-react";

type VerifyResult = {
  valid: boolean;
  receipt_no: string;
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

function VerifyReceiptContent() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const slug = params.get("slug") ?? "";

  const [state, setState] = useState<"loading" | "valid" | "invalid">("loading");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    if (!token || !slug) {
      setState("invalid");
      setErrorMsg("Missing verification token or school identifier.");
      return;
    }

    const apiBase =
      typeof window !== "undefined"
        ? `${window.location.protocol}//${window.location.host}/api/v1`
        : "/api/v1";

    fetch(
      `${apiBase}/public/verify/receipt?token=${encodeURIComponent(token)}&slug=${encodeURIComponent(slug)}`,
    )
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({ detail: "Verification failed." }));
          throw new Error(body.detail || "Verification failed.");
        }
        return res.json() as Promise<VerifyResult>;
      })
      .then((data) => {
        setResult(data);
        setState("valid");
      })
      .catch((err) => {
        setErrorMsg(String(err.message || "Could not verify this receipt."));
        setState("invalid");
      });
  }, [token, slug]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {/* Brand bar */}
        <div className="bg-black text-white text-center py-3 px-4">
          <p className="text-xs font-medium tracking-wide uppercase opacity-70">
            ShuleHQ · Receipt Verification
          </p>
        </div>

        {state === "loading" && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-500">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">Verifying receipt…</p>
          </div>
        )}

        {state === "invalid" && (
          <div className="flex flex-col items-center justify-center py-12 gap-4 px-6 text-center">
            <div className="rounded-full bg-red-50 p-4">
              <XCircle className="h-10 w-10 text-red-500" />
            </div>
            <div>
              <p className="font-semibold text-gray-900">Receipt Not Valid</p>
              <p className="text-sm text-gray-500 mt-1">{errorMsg}</p>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              This receipt may be forged, tampered with, or does not belong to this school.
              Report any suspicious receipts to the school administration.
            </p>
          </div>
        )}

        {state === "valid" && result && (
          <div className="py-8 px-6 space-y-5">
            {/* Status badge */}
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="rounded-full bg-green-50 p-3">
                <CheckCircle2 className="h-10 w-10 text-green-600" />
              </div>
              <p className="font-bold text-gray-900 text-lg">Receipt Verified</p>
              <p className="text-sm text-gray-500">{result.tenant_name}</p>
            </div>

            <hr className="border-gray-100" />

            {/* Receipt details */}
            <div className="space-y-3">
              <Row label="Receipt No." value={result.receipt_no} mono />
              <Row label="Student" value={result.student_name} />
              <Row
                label="Amount"
                value={formatAmount(result.amount)}
                bold
              />
              {result.provider && (
                <Row label="Paid Via" value={result.provider.toUpperCase()} />
              )}
              {result.received_at && (
                <Row label="Date" value={formatDate(result.received_at)} />
              )}
            </div>

            <hr className="border-gray-100" />

            {/* Authenticity note */}
            <div className="flex items-start gap-2 text-xs text-gray-400">
              <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0 text-green-500" />
              <p>
                This receipt was issued by <strong>{result.tenant_name}</strong> and is
                cryptographically verified. The QR code cannot be duplicated without access
                to the school&rsquo;s private key.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function VerifyReceiptPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      }
    >
      <VerifyReceiptContent />
    </Suspense>
  );
}

function Row({
  label,
  value,
  mono,
  bold,
}: {
  label: string;
  value: string;
  mono?: boolean;
  bold?: boolean;
}) {
  return (
    <div className="flex justify-between items-start gap-2">
      <span className="text-xs text-gray-500 shrink-0">{label}</span>
      <span
        className={[
          "text-xs text-right",
          mono ? "font-mono" : "",
          bold ? "font-semibold text-gray-900" : "text-gray-700",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {value}
      </span>
    </div>
  );
}
