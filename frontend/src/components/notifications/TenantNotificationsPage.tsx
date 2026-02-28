"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BellRing,
  CheckCheck,
  Info,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import { AppShell, type AppNavItem } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type TenantNotificationsPageProps = {
  appTitle: string;
  nav: AppNavItem[];
  activeHref: string;
};

type TenantNotification = {
  id: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
  due_at: string | null;
  unread: boolean;
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNotifications(input: unknown): TenantNotification[] {
  return asArray<unknown>(input)
    .map((raw): TenantNotification | null => {
      const row = asObject(raw);
      if (!row) return null;
      const id = asString(row.id);
      const title = asString(row.title);
      const message = asString(row.message);
      const createdAt = asString(row.created_at);
      if (!id || !title || !message || !createdAt) return null;
      return {
        id,
        type: asString(row.type).toUpperCase() || "GENERAL",
        severity: asString(row.severity).toLowerCase() || "info",
        title,
        message,
        entity_type: asString(row.entity_type) || null,
        entity_id: asString(row.entity_id) || null,
        created_at: createdAt,
        due_at: asString(row.due_at) || null,
        unread: row.unread === undefined ? true : Boolean(row.unread),
      };
    })
    .filter((row): row is TenantNotification => Boolean(row))
    .sort((a, b) => {
      const dueA = a.due_at || "";
      const dueB = b.due_at || "";
      if (dueA && dueB && dueA !== dueB) return dueA.localeCompare(dueB);
      return b.created_at.localeCompare(a.created_at);
    });
}

function formatDateTime(value: string | null): string {
  if (!value) return "N/A";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export function TenantNotificationsPage({
  appTitle,
  nav,
  activeHref,
}: TenantNotificationsPageProps) {
  const [rows, setRows] = useState<TenantNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState("__all__");
  const [typeFilter, setTypeFilter] = useState("__all__");
  const [selectedNotificationId, setSelectedNotificationId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [markingNotificationId, setMarkingNotificationId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [deletingNotificationId, setDeletingNotificationId] = useState<string | null>(null);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (!silent) setLoading(true);
    try {
      const raw = await api.get<unknown>("/tenants/notifications?limit=500", {
        tenantRequired: true,
        noRedirect: true,
      });
      setRows(normalizeNotifications(raw));
    } catch (err: any) {
      if (!silent) {
        setRows([]);
        toast.error(typeof err?.message === "string" ? err.message : "Failed to load notifications");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void load({ silent: true });
    }, 8_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      const searchMatch =
        !q ||
        row.title.toLowerCase().includes(q) ||
        row.message.toLowerCase().includes(q) ||
        row.type.toLowerCase().includes(q);
      const severityMatch = severityFilter === "__all__" || row.severity === severityFilter;
      const typeMatch = typeFilter === "__all__" || row.type === typeFilter;
      return searchMatch && severityMatch && typeMatch;
    });
  }, [query, rows, severityFilter, typeFilter]);

  const unreadCount = useMemo(() => filtered.filter((row) => row.unread).length, [filtered]);
  const selectedNotification = useMemo(
    () =>
      selectedNotificationId
        ? rows.find((row) => row.id === selectedNotificationId) || null
        : null,
    [rows, selectedNotificationId]
  );

  const severityValues = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => row.severity)))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    [rows]
  );

  const typeValues = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => row.type)))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    [rows]
  );

  function SeverityIcon({ severity }: { severity: string }) {
    if (severity === "warning") return <TriangleAlert className="h-3.5 w-3.5 text-amber-600" />;
    if (severity === "error") return <ShieldAlert className="h-3.5 w-3.5 text-red-600" />;
    return <Info className="h-3.5 w-3.5 text-blue-600" />;
  }

  async function markNotificationAsRead(notificationId: string) {
    if (!notificationId) return;
    setMarkingNotificationId(notificationId);
    try {
      await api.post(
        `/tenants/notifications/${encodeURIComponent(notificationId)}/read`,
        undefined,
        { tenantRequired: true }
      );
      setRows((prev) =>
        prev.map((row) => (row.id === notificationId ? { ...row, unread: false } : row))
      );
    } catch (err: any) {
      toast.error(typeof err?.message === "string" ? err.message : "Failed to mark notification as read");
    } finally {
      setMarkingNotificationId(null);
    }
  }

  function openNotification(row: TenantNotification) {
    setSelectedNotificationId(row.id);
    setDialogOpen(true);
  }

  function handleDialogOpenChange(open: boolean) {
    if (!open && selectedNotification?.unread) {
      void markNotificationAsRead(selectedNotification.id);
    }
    setDialogOpen(open);
    if (!open) {
      setSelectedNotificationId(null);
    }
  }

  async function markAllAsRead() {
    if (markingAll || unreadCount <= 0) return;
    setMarkingAll(true);
    try {
      const raw = await api.post<unknown>(
        "/tenants/notifications/mark-all-read",
        undefined,
        { tenantRequired: true }
      );
      const payload = asObject(raw);
      const markedCount =
        payload && typeof payload.marked_count === "number"
          ? payload.marked_count
          : unreadCount;
      setRows((prev) => prev.map((row) => ({ ...row, unread: false })));
      toast.success(`Marked ${markedCount} notification(s) as read.`);
    } catch (err: any) {
      toast.error(typeof err?.message === "string" ? err.message : "Failed to mark all notifications as read");
    } finally {
      setMarkingAll(false);
    }
  }

  async function deleteNotification(notificationId: string) {
    if (!notificationId) return;
    setDeletingNotificationId(notificationId);
    try {
      await api.post(
        `/tenants/notifications/${encodeURIComponent(notificationId)}/delete`,
        undefined,
        { tenantRequired: true }
      );
      setRows((prev) => prev.filter((row) => row.id !== notificationId));
      if (selectedNotificationId === notificationId) {
        setDialogOpen(false);
        setSelectedNotificationId(null);
      }
      toast.success("Notification deleted.");
    } catch (err: any) {
      toast.error(typeof err?.message === "string" ? err.message : "Failed to delete notification");
    } finally {
      setDeletingNotificationId(null);
    }
  }

  return (
    <AppShell title={appTitle} nav={nav} activeHref={activeHref}>
      <div className="space-y-5">
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-600 to-blue-500 p-5 text-white shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold">Notifications</h1>
              <p className="mt-0.5 text-sm text-blue-100">
                Tenant alerts for overdue asset returns and operational warnings.
              </p>
            </div>
            <Button
              variant="outline"
              className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              onClick={() => void load()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BellRing className="h-4 w-4 text-slate-600" />
                <h2 className="text-sm font-semibold text-slate-900">Notification Feed</h2>
              </div>
              <div className="text-xs text-slate-500">
                Total: {filtered.length} · Unread: {unreadCount}
              </div>
            </div>

            <div className="grid gap-2 md:grid-cols-4">
              <div className="relative md:col-span-2">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-8"
                  placeholder="Search title, message, or type"
                />
              </div>

              <Select value={severityFilter} onValueChange={setSeverityFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All severities" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All severities</SelectItem>
                  {severityValues.map((severity) => (
                    <SelectItem key={severity} value={severity}>
                      {severity}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All types</SelectItem>
                  {typeValues.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                className="md:col-span-4 md:justify-self-end"
                onClick={() => void markAllAsRead()}
                disabled={markingAll || unreadCount <= 0}
              >
                <CheckCheck className="h-3.5 w-3.5" />
                {markingAll ? "Marking..." : "Mark All As Read"}
              </Button>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="text-xs">Severity</TableHead>
                <TableHead className="text-xs">Type</TableHead>
                <TableHead className="text-xs">Notification</TableHead>
                <TableHead className="text-xs">Due At</TableHead>
                <TableHead className="text-xs">Created At</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!loading &&
                filtered.map((row) => (
                  <TableRow
                    key={row.id}
                    className={
                      row.unread
                        ? "cursor-pointer bg-blue-50/80 hover:bg-blue-100/70"
                        : "cursor-pointer hover:bg-slate-50"
                    }
                    role="button"
                    tabIndex={0}
                    aria-label={`Open notification ${row.title}`}
                    onClick={() => openNotification(row)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openNotification(row);
                      }
                    }}
                  >
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700">
                        <SeverityIcon severity={row.severity} />
                        {row.severity}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-700">{row.type}</TableCell>
                    <TableCell className="text-xs text-slate-700">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium text-slate-900">{row.title}</div>
                        {row.unread && (
                          <span className="inline-flex rounded-full border border-blue-200 bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-800">
                            Unread
                          </span>
                        )}
                      </div>
                      <div>{row.message}</div>
                    </TableCell>
                    <TableCell className="text-xs text-slate-700">{formatDateTime(row.due_at)}</TableCell>
                    <TableCell className="text-xs text-slate-700">{formatDateTime(row.created_at)}</TableCell>
                    <TableCell>
                      <span
                        className={
                          row.unread
                            ? "inline-flex rounded-full border border-blue-200 bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-800"
                            : "inline-flex rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600"
                        }
                      >
                        {row.unread ? "Unread" : "Read"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteNotification(row.id);
                        }}
                        disabled={deletingNotificationId === row.id}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {deletingNotificationId === row.id ? "Deleting..." : "Delete"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}

              {!loading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-slate-500">
                    No notifications found.
                  </TableCell>
                </TableRow>
              )}

              {loading && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-slate-500">
                    Loading notifications...
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedNotification ? (
                <SeverityIcon severity={selectedNotification.severity} />
              ) : (
                <BellRing className="h-4 w-4 text-slate-500" />
              )}
              {selectedNotification?.title || "Notification"}
            </DialogTitle>
            <DialogDescription>
              {selectedNotification ? `${selectedNotification.type} · ${selectedNotification.severity}` : "Details"}
            </DialogDescription>
          </DialogHeader>

          {selectedNotification && (
            <div className="space-y-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                {selectedNotification.message}
              </div>
              <div className="grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                <div>
                  <span className="font-medium text-slate-700">Created:</span>{" "}
                  {formatDateTime(selectedNotification.created_at)}
                </div>
                <div>
                  <span className="font-medium text-slate-700">Due:</span>{" "}
                  {formatDateTime(selectedNotification.due_at)}
                </div>
                <div>
                  <span className="font-medium text-slate-700">Status:</span>{" "}
                  {selectedNotification.unread ? "Unread" : "Read"}
                </div>
                <div>
                  <span className="font-medium text-slate-700">Reference:</span>{" "}
                  {selectedNotification.entity_type || "N/A"} · {selectedNotification.entity_id || "N/A"}
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                  onClick={() => void deleteNotification(selectedNotification.id)}
                  disabled={deletingNotificationId === selectedNotification.id}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {deletingNotificationId === selectedNotification.id ? "Deleting..." : "Delete Notification"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
