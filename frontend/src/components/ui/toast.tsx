"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, XCircle, X } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type ToastVariant = "success" | "error";

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
  removing: boolean;
}

// ─── Global event bus ─────────────────────────────────────────────────────────

type ToastListener = (item: Omit<ToastItem, "id" | "removing">) => void;
const listeners: ToastListener[] = [];

function emit(item: Omit<ToastItem, "id" | "removing">) {
  listeners.forEach((fn) => fn(item));
}

// ─── Public API ───────────────────────────────────────────────────────────────

type ToastOpts = { description?: string };

function emitWithOpts(message: string, variant: ToastVariant, opts?: ToastOpts) {
  const full = opts?.description ? `${message} — ${opts.description}` : message;
  emit({ message: full, variant });
}

export const toast = {
  success: (message: string, opts?: ToastOpts) => emitWithOpts(message, "success", opts),
  error:   (message: string, opts?: ToastOpts) => emitWithOpts(message, "error", opts),
  message: (message: string, opts?: ToastOpts) => emitWithOpts(message, "success", opts),
  info:    (message: string, opts?: ToastOpts) => emitWithOpts(message, "success", opts),
  warning: (message: string, opts?: ToastOpts) => emitWithOpts(message, "error", opts),
};

// ─── Single toast card ────────────────────────────────────────────────────────

function ToastCard({
  item,
  onRemove,
}: {
  item: ToastItem;
  onRemove: (id: number) => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Mount → slide in
    const t1 = setTimeout(() => setVisible(true), 16);
    // Auto-dismiss
    const t2 = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onRemove(item.id), 350);
    }, 3800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isSuccess = item.variant === "success";

  return (
    <div
      style={{
        transform: visible ? "translateX(0)" : "translateX(calc(100% + 24px))",
        opacity: visible ? 1 : 0,
        transition: "transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease",
        pointerEvents: "auto",
        borderColor: isSuccess ? "rgba(22,163,74,0.3)" : "rgba(220,38,38,0.3)",
      }}
      className="relative flex items-start gap-3 rounded-xl border bg-white px-4 py-3.5 shadow-lg w-[320px] max-w-[calc(100vw-32px)]"
    >
      {/* Left accent bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl"
        style={{ background: isSuccess ? "#16a34a" : "#dc2626" }}
      />

      {/* Icon */}
      <div className="shrink-0 mt-0.5">
        {isSuccess
          ? <CheckCircle2 className="h-5 w-5 text-green-600" />
          : <XCircle className="h-5 w-5 text-red-600" />
        }
      </div>

      {/* Message */}
      <p className="flex-1 text-sm font-medium text-slate-800 leading-snug pr-4">
        {item.message}
      </p>

      {/* Dismiss */}
      <button
        onClick={() => {
          setVisible(false);
          setTimeout(() => onRemove(item.id), 350);
        }}
        className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      {/* Progress bar */}
      <div className="absolute bottom-0 left-1 right-0 h-0.5 rounded-b-xl overflow-hidden">
        <div
          className="h-full rounded-b-xl"
          style={{
            background: isSuccess ? "#16a34a" : "#dc2626",
            animation: "toast-progress 3.8s linear forwards",
          }}
        />
      </div>
    </div>
  );
}

// ─── Container rendered once at app root ──────────────────────────────────────

let idCounter = 0;

export function ToastContainer() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const mountedRef = useRef(false);

  const add = useCallback((raw: Omit<ToastItem, "id" | "removing">) => {
    const id = ++idCounter;
    setItems((prev) => [...prev.slice(-4), { ...raw, id, removing: false }]);
  }, []);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    listeners.push(add);
    return () => {
      mountedRef.current = false;
      const idx = listeners.indexOf(add);
      if (idx !== -1) listeners.splice(idx, 1);
    };
  }, [add]);

  if (typeof window === "undefined" || items.length === 0) return null;

  return createPortal(
    <>
      <style>{`
        @keyframes toast-progress {
          from { width: 100%; }
          to   { width: 0%; }
        }
      `}</style>
      <div
        className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2.5"
        style={{ pointerEvents: "none" }}
        aria-live="polite"
        aria-atomic="false"
      >
        {items.map((item) => (
          <ToastCard key={item.id} item={item} onRemove={remove} />
        ))}
      </div>
    </>,
    document.body
  );
}
