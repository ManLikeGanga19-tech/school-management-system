"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";

import { api } from "@/lib/api";
import { toast } from "@/components/ui/sonner";

/*
 * Export pills for the director Finance — All Time section.
 *
 * Triggers /director/finance/export.csv or /director/finance/export.pdf and
 * streams the response into a download. The PDF endpoint renders against the
 * tenant print profile (school header + logo) to match every other branded
 * document in the system. Both endpoints write an audit event named
 * finance.report.export with the scope + format.
 */
export function DirectorFinanceExportButtons({ scope }: { scope: "all-time" }) {
  const [busy, setBusy] = useState<null | "csv" | "pdf">(null);

  async function exportTo(format: "csv" | "pdf") {
    if (busy) return;
    setBusy(format);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const filename =
        format === "csv"
          ? `finance-all-time-${stamp}.csv`
          : `finance-all-time-${stamp}.pdf`;
      await api.downloadFile(
        `/director/finance/export.${format}?scope=${scope}`,
        filename,
        { tenantRequired: true }
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => void exportTo("csv")}
        disabled={!!busy}
        className="inline-flex items-center gap-1.5 rounded-full border border-[#d8e8df] bg-white px-3 py-1.5 text-xs font-medium text-[#20644f] transition hover:bg-[#edf6f0] disabled:opacity-60"
      >
        {busy === "csv" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
        Export CSV
      </button>
      <button
        onClick={() => void exportTo("pdf")}
        disabled={!!busy}
        className="inline-flex items-center gap-1.5 rounded-full border border-[#cedfe1] bg-white px-3 py-1.5 text-xs font-medium text-[#173f49] transition hover:bg-[#e9f1f2] disabled:opacity-60"
      >
        {busy === "pdf" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
        Export PDF
      </button>
      <span className="hidden items-center gap-1 text-[10px] text-slate-400 sm:inline-flex">
        <Download className="h-3 w-3" />
        Branded report
      </span>
    </div>
  );
}
