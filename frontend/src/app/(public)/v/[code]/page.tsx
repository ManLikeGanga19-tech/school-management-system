"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ShieldCheck,
  ReceiptText,
  FileText,
} from "lucide-react";

type VerifyResult = {
  valid: boolean;
  document_type: string; // RECEIPT | INVOICE
  document_no: string;
  school_name: string;
  school_motto?: string | null;
  school_logo_url?: string | null;
  student_name: string;
  currency: string;
  amount: string;
  balance_amount?: string | null;
  status?: string | null;
  issued_at?: string | null;
  provider?: string | null;
  message: string;
};

function formatAmount(raw: string, currency: string): string {
  const n = parseFloat(raw);
  if (isNaN(n)) return raw;
  try {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: currency || "KES",
      minimumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${currency} ${n.toLocaleString("en-KE", { minimumFractionDigits: 2 })}`;
  }
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

export default function VerifyDocumentPage() {
  const params = useParams<{ code: string }>();
  const code = typeof params?.code === "string" ? params.code : "";

  const [state, setState] = useState<"loading" | "valid" | "invalid">("loading");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    if (!code) {
      setState("invalid");
      setErrorMsg("Missing verification code.");
      return;
    }

    const apiBase =
      typeof window !== "undefined"
        ? `${window.location.protocol}//${window.location.host}/api/v1`
        : "/api/v1";

    fetch(`${apiBase}/public/verify/${encodeURIComponent(code)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res
            .json()
            .catch(() => ({ detail: "Verification failed." }));
          throw new Error(body.detail || "Verification failed.");
        }
        return res.json() as Promise<VerifyResult>;
      })
      .then((data) => {
        setResult(data);
        setState("valid");
      })
      .catch((err) => {
        setErrorMsg(String(err.message || "Could not verify this document."));
        setState("invalid");
      });
  }, [code]);

  const isReceipt = result?.document_type === "RECEIPT";
  const docLabel = isReceipt ? "Receipt" : "Invoice";

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {/* School brand bar — never platform branding */}
        <div className="bg-teal-700 text-white text-center py-4 px-4">
          {result?.school_logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={result.school_logo_url}
              alt={result.school_name}
              className="h-10 mx-auto mb-1 object-contain"
            />
          ) : null}
          <p className="text-sm font-semibold tracking-wide">
            {result?.school_name || "Document Verification"}
          </p>
          {result?.school_motto ? (
            <p className="text-[11px] italic opacity-80 mt-0.5">
              {result.school_motto}
            </p>
          ) : null}
        </div>

        {state === "loading" && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-500">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">Verifying document…</p>
          </div>
        )}

        {state === "invalid" && (
          <div className="flex flex-col items-center justify-center py-12 gap-4 px-6 text-center">
            <div className="rounded-full bg-red-50 p-4">
              <XCircle className="h-10 w-10 text-red-500" />
            </div>
            <div>
              <p className="font-semibold text-gray-900">Document Not Valid</p>
              <p className="text-sm text-gray-500 mt-1">{errorMsg}</p>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              This document may be forged or tampered with. Report any suspicious
              documents to the school administration.
            </p>
          </div>
        )}

        {state === "valid" && result && (
          <div className="py-8 px-6 space-y-5">
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="rounded-full bg-green-50 p-3">
                <CheckCircle2 className="h-10 w-10 text-green-600" />
              </div>
              <p className="font-bold text-gray-900 text-lg">
                {docLabel} Verified
              </p>
              <p className="text-sm text-gray-500">{result.message}</p>
            </div>

            <hr className="border-gray-100" />

            <div className="space-y-3">
              <Row
                label="Document"
                value={
                  <span className="inline-flex items-center gap-1">
                    {isReceipt ? (
                      <ReceiptText className="h-3.5 w-3.5 text-teal-600" />
                    ) : (
                      <FileText className="h-3.5 w-3.5 text-teal-600" />
                    )}
                    {docLabel}
                  </span>
                }
              />
              <Row label={`${docLabel} No.`} value={result.document_no} mono />
              <Row label="Student" value={result.student_name} />
              <Row
                label={isReceipt ? "Amount Paid" : "Invoice Total"}
                value={formatAmount(result.amount, result.currency)}
                bold
              />
              {!isReceipt && result.balance_amount != null && (
                <Row
                  label="Balance Due"
                  value={formatAmount(result.balance_amount, result.currency)}
                />
              )}
              {!isReceipt && result.status && (
                <Row label="Status" value={result.status} />
              )}
              {isReceipt && result.provider && (
                <Row label="Paid Via" value={result.provider.toUpperCase()} />
              )}
              {result.issued_at && (
                <Row label="Date" value={formatDate(result.issued_at)} />
              )}
            </div>

            <hr className="border-gray-100" />

            <div className="flex items-start gap-2 text-xs text-gray-400">
              <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0 text-green-500" />
              <p>
                This {docLabel.toLowerCase()} was issued by{" "}
                <strong>{result.school_name}</strong>. The details shown are read
                live from the school&rsquo;s records, so they reflect the current
                status of the document.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  bold,
}: {
  label: string;
  value: React.ReactNode;
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
