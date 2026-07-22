"use client";

/**
 * SaaS › Backups — the platform admin's safety net for the live production
 * system. "Create & download" builds a full database + student-documents
 * backup on the server and streams it straight to your drive (external
 * drive included); the ledger below records every backup with its checksum.
 * See docs/ops/BACKUP_RESTORE_RUNBOOK.md.
 */

import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiFetchRaw } from "@/lib/api";
import { AppShell } from "@/components/layout/AppShell";
import { saasNav } from "@/components/layout/nav-config";
import { SaasPageHeader, SaasSurface } from "@/components/saas/page-chrome";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DatabaseBackup, RefreshCw, ShieldCheck, CheckCircle2, XCircle, Loader2,
} from "lucide-react";

type BackupRow = {
  id: string;
  created_at: string | null;
  kind: string;
  status: string;
  filename: string | null;
  size_bytes: number | null;
  sha256: string | null;
  db_table_data_count: number | null;
  media_file_count: number | null;
  alembic_head: string | null;
  pg_dump_version: string | null;
  duration_ms: number | null;
  error: string | null;
};

function fmtBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }); }
  catch { return iso; }
}

export default function SaasBackupsPage() {
  const [rows, setRows] = useState<BackupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ items: BackupRow[] }>("/admin/backups", { tenantRequired: false });
      setRows(data.items || []);
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message || "Failed to load backups.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createAndDownload() {
    setCreating(true);
    const started = Date.now();
    toast.info("Creating backup — this may take a moment for larger databases…");
    try {
      const res = await apiFetchRaw("/admin/backups", { method: "POST", tenantRequired: false });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: "Backup failed." }));
        throw new Error(body.detail || "Backup failed.");
      }
      // Stream to a file the browser saves wherever you choose (incl. external drive).
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const m = cd.match(/filename="?([^"]+)"?/);
      const filename = m ? m[1] : `shulehq-backup-${Date.now()}.tar`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success(
        `Backup downloaded (${fmtBytes(blob.size)}, ${((Date.now() - started) / 1000).toFixed(1)}s). ` +
        "Store it on a separate drive.",
      );
      await load();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message || "Backup failed.");
      await load();
    } finally {
      setCreating(false);
    }
  }

  const lastSuccess = rows.find((r) => r.status === "SUCCESS");

  return (
    <AppShell title="SaaS" nav={saasNav} activeHref="/saas/backups">
      <div className="space-y-5">
        <SaasPageHeader
          title="Database Backups"
          description="Full database + student-documents backups. Create one now and download it to a separate drive — your guarantee that no tenant's work is ever lost."
          metrics={[
            { label: "Backups on record", value: rows.length },
            {
              label: "Last successful",
              value: lastSuccess ? fmtDate(lastSuccess.created_at) : "None yet",
              tone: lastSuccess ? "default" : "warning",
            },
          ]}
          actions={
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
              </Button>
              <Button size="sm" onClick={() => void createAndDownload()} disabled={creating}>
                {creating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <DatabaseBackup className="mr-1.5 h-3.5 w-3.5" />}
                {creating ? "Creating…" : "Create & Download"}
              </Button>
            </div>
          }
        />

        <SaasSurface>
          <div className="flex items-start gap-3 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 text-sm text-emerald-900">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <div>
              <p className="font-medium">3-2-1 rule</p>
              <p className="mt-0.5 text-emerald-800/90">
                Keep at least three copies on two kinds of media with one off-site.
                This download is your off-site / cold copy — save it to an external
                drive and rotate it. Each backup&rsquo;s SHA-256 is recorded below so
                you can verify integrity before restoring.
              </p>
            </div>
          </div>
        </SaasSurface>

        <SaasSurface>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">When</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Kind</TableHead>
                  <TableHead className="text-xs text-right">Size</TableHead>
                  <TableHead className="text-xs text-right">Tables</TableHead>
                  <TableHead className="text-xs text-right">Docs</TableHead>
                  <TableHead className="text-xs">Alembic head</TableHead>
                  <TableHead className="text-xs">SHA-256</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!loading && rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm">{fmtDate(r.created_at)}</TableCell>
                    <TableCell>
                      {r.status === "SUCCESS" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                          <CheckCircle2 className="h-3 w-3" /> Success
                        </span>
                      ) : r.status === "FAILED" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 ring-1 ring-red-200" title={r.error || ""}>
                          <XCircle className="h-3 w-3" /> Failed
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
                          <Loader2 className="h-3 w-3 animate-spin" /> Running
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">{r.kind}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{fmtBytes(r.size_bytes)}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-slate-600">{r.db_table_data_count ?? "—"}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-slate-600">{r.media_file_count ?? "—"}</TableCell>
                    <TableCell className="font-mono text-[11px] text-slate-500">{r.alembic_head || "—"}</TableCell>
                    <TableCell className="font-mono text-[10px] text-slate-400" title={r.sha256 || ""}>
                      {r.sha256 ? `${r.sha256.slice(0, 12)}…` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-sm text-slate-400">
                      No backups yet. Click <span className="font-medium">Create &amp; Download</span> to take your first one.
                    </TableCell>
                  </TableRow>
                )}
                {loading && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-sm text-slate-400">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </SaasSurface>
      </div>
    </AppShell>
  );
}
