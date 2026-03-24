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
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import type { AppNavItem } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

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

interface Props {
  appTitle: string;
  nav: AppNavItem[];
  activeHref: string;
}

export function ScanReceiptPage({ appTitle, nav, activeHref }: Props) {
  const [tenantSlug, setTenantSlug] = useState("");

  useEffect(() => {
    api
      .get<{ tenant_slug?: string }>("/tenants/whoami")
      .then((d) => { if (d?.tenant_slug) setTenantSlug(d.tenant_slug); })
      .catch(() => {});
  }, []);
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<import("@zxing/browser").BrowserQRCodeReader | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);

  const [scanning, setScanning] = useState(false);
  const [state, setState] = useState<"idle" | "scanning" | "verifying" | "valid" | "invalid">(
    "idle"
  );
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

  const verifyToken = useCallback(
    async (rawText: string) => {
      stopScanner();
      setState("verifying");

      // Extract JWT — the QR may contain a full URL like https://…/verify/receipt?token=…&slug=…
      let token = rawText.trim();
      let slug = tenantSlug;
      try {
        const url = new URL(rawText);
        const t = url.searchParams.get("token");
        const s = url.searchParams.get("slug");
        if (t) token = t;
        if (s) slug = s;
      } catch {
        /* rawText is a bare JWT — use as-is */
      }

      try {
        const apiBase = `${window.location.protocol}//${window.location.host}/api/v1`;
        const res = await fetch(
          `${apiBase}/public/verify/receipt?token=${encodeURIComponent(token)}&slug=${encodeURIComponent(slug)}`
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({ detail: "Verification failed." }));
          throw new Error(body.detail || "Verification failed.");
        }
        const data: VerifyResult = await res.json();
        setResult(data);
        setState("valid");
      } catch (err: unknown) {
        setErrorMsg(err instanceof Error ? err.message : "Could not verify this receipt.");
        setState("invalid");
      }
    },
    [tenantSlug, stopScanner]
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
      // Prefer rear camera on mobile
      const device =
        devices.find((d) =>
          /back|rear|environment/i.test(d.label)
        ) ?? devices[devices.length - 1];

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
        (result, error) => {
          if (result) {
            void verifyToken(result.getText());
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
  }, [verifyToken]);

  // Clean up on unmount
  useEffect(() => () => stopScanner(), [stopScanner]);

  const reset = () => {
    stopScanner();
    setState("idle");
    setResult(null);
    setErrorMsg("");
  };

  return (
    <AppShell title={appTitle} nav={nav} activeHref={activeHref}>
      <div className="max-w-md mx-auto space-y-4 px-2 py-4">
        <div>
          <h1 className="text-lg font-semibold">Scan Receipt</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Point your camera at a receipt QR code to verify it instantly.
          </p>
        </div>

        {/* Desktop warning */}
        {isMobile === false && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex gap-3">
            <Monitor className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800">
              <p className="font-medium">Best on mobile</p>
              <p className="mt-0.5 text-amber-700">
                This page works best on a mobile device with a camera. You can still use your
                desktop webcam below.
              </p>
            </div>
          </div>
        )}

        {/* Camera viewfinder */}
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
              {/* Scan overlay */}
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

        {/* Verifying spinner */}
        {state === "verifying" && (
          <div className="flex flex-col items-center gap-3 py-12 text-gray-500">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">Verifying receipt…</p>
          </div>
        )}

        {/* Valid result */}
        {state === "valid" && result && (
          <div className="rounded-xl border border-green-200 bg-white overflow-hidden">
            <div className="bg-green-600 text-white px-4 py-3 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-semibold text-sm">Receipt Verified</span>
            </div>
            <div className="p-4 space-y-3">
              <div className="space-y-2">
                <Row label="School" value={result.tenant_name} />
                <Row label="Receipt No." value={result.receipt_no} mono />
                <Row label="Student" value={result.student_name} />
                <Row label="Amount" value={formatAmount(result.amount)} bold />
                {result.provider && (
                  <Row label="Paid Via" value={result.provider.toUpperCase()} />
                )}
                {result.received_at && (
                  <Row label="Date" value={formatDate(result.received_at)} />
                )}
              </div>
              <div className="flex items-start gap-2 pt-2 border-t border-gray-100 text-xs text-gray-400">
                <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0 text-green-500" />
                <span>Cryptographically verified receipt.</span>
              </div>
              <Button variant="outline" onClick={reset} className="w-full gap-2 mt-1">
                <RefreshCw className="h-4 w-4" />
                Scan Another
              </Button>
            </div>
          </div>
        )}

        {/* Invalid result */}
        {state === "invalid" && (
          <div className="rounded-xl border border-red-200 bg-white overflow-hidden">
            <div className="bg-red-600 text-white px-4 py-3 flex items-center gap-2">
              <XCircle className="h-5 w-5" />
              <span className="font-semibold text-sm">Verification Failed</span>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-sm text-gray-700">{errorMsg || "This receipt could not be verified."}</p>
              <p className="text-xs text-gray-400">
                This receipt may be forged, tampered with, or does not belong to this school.
                Report suspicious receipts to the school administration.
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
