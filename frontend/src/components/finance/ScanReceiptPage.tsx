"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ScanLine,
  ShieldCheck,
  RefreshCw,
  Monitor,
  ReceiptText,
  FileText,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import type { AppNavItem } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";

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

/**
 * Pull the opaque verify_code out of a scanned QR. Genuine document QRs encode
 * a `/v/{code}` URL on this system; anything else is rejected so the scanner
 * only acts on QRs issued by this system.
 */
function extractCode(rawText: string): string | null {
  const text = rawText.trim();
  try {
    const url = new URL(text);
    const m = url.pathname.match(/\/v\/([A-Za-z0-9_-]{8,32})\/?$/);
    if (m) return m[1];
  } catch {
    if (/^[A-Za-z0-9_-]{8,32}$/.test(text)) return text;
  }
  return null;
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

interface Props {
  appTitle: string;
  nav: AppNavItem[];
  activeHref: string;
}

export function ScanReceiptPage({ appTitle, nav, activeHref }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<import("@zxing/browser").BrowserQRCodeReader | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);

  const [scanning, setScanning] = useState(false);
  const [state, setState] = useState<
    "idle" | "scanning" | "verifying" | "valid" | "invalid"
  >("idle");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [isMobile, setIsMobile] = useState<boolean | null>(null);

  useEffect(() => {
    setIsMobile(/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent));
  }, []);

  const stopScanner = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setScanning(false);
  }, []);

  const verifyScanned = useCallback(
    async (rawText: string) => {
      stopScanner();

      const code = extractCode(rawText);
      if (!code) {
        setErrorMsg("This QR code is not a recognised document from this system.");
        setState("invalid");
        return;
      }

      setState("verifying");
      try {
        const apiBase = `${window.location.protocol}//${window.location.host}/api/v1`;
        const res = await fetch(
          `${apiBase}/public/verify/${encodeURIComponent(code)}`
        );
        if (!res.ok) {
          const body = await res
            .json()
            .catch(() => ({ detail: "Verification failed." }));
          throw new Error(body.detail || "Verification failed.");
        }
        const data: VerifyResult = await res.json();
        setResult(data);
        setState("valid");
      } catch (err: unknown) {
        setErrorMsg(
          err instanceof Error ? err.message : "Could not verify this document."
        );
        setState("invalid");
      }
    },
    [stopScanner]
  );

  const startScanner = useCallback(async () => {
    setState("scanning");
    setScanning(true);
    setResult(null);
    setErrorMsg("");

    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");

      const reader = new BrowserQRCodeReader();
      readerRef.current = reader;

      const devices = await BrowserQRCodeReader.listVideoInputDevices();
      const device =
        devices.find((d) => /back|rear|environment/i.test(d.label)) ??
        devices[devices.length - 1];

      if (!device) {
        setErrorMsg("No camera found on this device.");
        setState("invalid");
        setScanning(false);
        return;
      }

      if (!videoRef.current) {
        setErrorMsg("Video element not ready.");
        setState("invalid");
        setScanning(false);
        return;
      }

      const controls = await reader.decodeFromVideoDevice(
        device.deviceId,
        videoRef.current,
        (res, error) => {
          if (res) {
            void verifyScanned(res.getText());
          }
          void error; // suppress continuous not-found errors
        }
      );
      controlsRef.current = controls;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Camera access denied.";
      setErrorMsg(
        msg.toLowerCase().includes("permission")
          ? "Camera permission denied. Please allow camera access and try again."
          : msg
      );
      setState("invalid");
      setScanning(false);
    }
  }, [verifyScanned]);

  useEffect(() => () => stopScanner(), [stopScanner]);

  const reset = () => {
    stopScanner();
    setState("idle");
    setResult(null);
    setErrorMsg("");
  };

  const isReceipt = result?.document_type === "RECEIPT";
  const docLabel = isReceipt ? "Receipt" : "Invoice";

  return (
    <AppShell title={appTitle} nav={nav} activeHref={activeHref}>
      <div className="max-w-md mx-auto space-y-4 px-2 py-4">
        <div>
          <h1 className="text-lg font-semibold">Scan &amp; Verify</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Point your camera at a receipt or invoice QR code to verify it
            instantly.
          </p>
        </div>

        {isMobile === false && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex gap-3">
            <Monitor className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800">
              <p className="font-medium">Best on mobile</p>
              <p className="mt-0.5 text-amber-700">
                This page works best on a mobile device with a camera. You can
                still use your desktop webcam below.
              </p>
            </div>
          </div>
        )}

        {(state === "idle" || state === "scanning") && (
          <div className="space-y-3">
            <div className="relative rounded-xl overflow-hidden bg-black aspect-square w-full border border-gray-200">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                autoPlay
                playsInline
                muted
              />
              {scanning && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-52 h-52 border-2 border-white rounded-xl opacity-80" />
                  <ScanLine className="absolute h-6 w-52 text-green-400 opacity-90 animate-bounce" />
                </div>
              )}
              {!scanning && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                  <p className="text-white text-sm font-medium">Camera off</p>
                </div>
              )}
            </div>

            {!scanning ? (
              <Button onClick={startScanner} className="w-full gap-2">
                <ScanLine className="h-4 w-4" />
                Start Camera
              </Button>
            ) : (
              <Button variant="outline" onClick={reset} className="w-full gap-2">
                Stop Camera
              </Button>
            )}
          </div>
        )}

        {state === "verifying" && (
          <div className="flex flex-col items-center gap-3 py-12 text-gray-500">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">Verifying document…</p>
          </div>
        )}

        {state === "valid" && result && (
          <div className="rounded-xl border border-green-200 bg-white overflow-hidden">
            <div className="bg-green-600 text-white px-4 py-3 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-semibold text-sm">{docLabel} Verified</span>
            </div>
            <div className="p-4 space-y-3">
              <div className="space-y-2">
                <Row label="School" value={result.school_name} />
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
              <div className="flex items-start gap-2 pt-2 border-t border-gray-100 text-xs text-gray-400">
                <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0 text-green-500" />
                <span>
                  Verified live against {result.school_name}&rsquo;s records.
                </span>
              </div>
              <Button variant="outline" onClick={reset} className="w-full gap-2 mt-1">
                <RefreshCw className="h-4 w-4" />
                Scan Another
              </Button>
            </div>
          </div>
        )}

        {state === "invalid" && (
          <div className="rounded-xl border border-red-200 bg-white overflow-hidden">
            <div className="bg-red-600 text-white px-4 py-3 flex items-center gap-2">
              <XCircle className="h-5 w-5" />
              <span className="font-semibold text-sm">Verification Failed</span>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-sm text-gray-700">
                {errorMsg || "This document could not be verified."}
              </p>
              <p className="text-xs text-gray-400">
                The document may be forged or tampered with. Report suspicious
                documents to the school administration.
              </p>
              <Button variant="outline" onClick={reset} className="w-full gap-2">
                <RefreshCw className="h-4 w-4" />
                Try Again
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
