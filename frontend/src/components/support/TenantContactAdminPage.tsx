"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Headset, RefreshCw, Reply, Send, X } from "lucide-react";

import { AppShell, type AppNavItem } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import {
  areSupportMessagesEqual,
  areSupportThreadsEqual,
  normalizeSupportMessages,
  normalizeSupportThreads,
  supportPriorityLabel,
  supportStatusLabel,
  type SupportMessage,
  type SupportThread,
  type SupportThreadPriority,
} from "@/lib/support";

type TenantContactAdminPageProps = {
  appTitle: string;
  nav: AppNavItem[];
  activeHref: string;
};

const THREAD_PAGE_SIZE_OPTIONS = [12, 20, 30, 40, 50] as const;

function formatDateTime(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-KE", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadgeClass(status: string): string {
  if (status === "WAITING_ADMIN") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "WAITING_TENANT") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "RESOLVED") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "CLOSED") return "border-slate-200 bg-slate-100 text-slate-600";
  return "border-purple-200 bg-purple-50 text-purple-700";
}

export function TenantContactAdminPage({
  appTitle,
  nav,
  activeHref,
}: TenantContactAdminPageProps) {
  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>("");

  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [creatingThread, setCreatingThread] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);

  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [subject, setSubject] = useState("");
  const [priority, setPriority] = useState<SupportThreadPriority>("NORMAL");
  const [openingMessage, setOpeningMessage] = useState("");
  const [replyMessage, setReplyMessage] = useState("");
  const [replyTarget, setReplyTarget] = useState<SupportMessage | null>(null);
  const [threadPage, setThreadPage] = useState(1);
  const [threadPageSize, setThreadPageSize] =
    useState<(typeof THREAD_PAGE_SIZE_OPTIONS)[number]>(20);
  const [threadHasMore, setThreadHasMore] = useState(false);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const keepPinnedToBottomRef = useRef(true);

  const updatePinState = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    keepPinnedToBottomRef.current = distanceToBottom <= 72;
  }, []);

  const scrollToBottomIfNeeded = useCallback((force = false) => {
    const el = messagesRef.current;
    if (!el) return;
    if (force || keepPinnedToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  const loadThreads = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) setLoadingThreads(true);
    try {
      const q = new URLSearchParams();
      if (statusFilter !== "ALL") q.set("status", statusFilter);
      q.set("limit", String(threadPageSize));
      q.set("offset", String((threadPage - 1) * threadPageSize));
      const raw = await api.get<unknown>(`/support/tenant/threads?${q.toString()}`, {
        tenantRequired: true,
        noRedirect: true,
      });
      const list = normalizeSupportThreads(raw);
      setThreads((prev) => (areSupportThreadsEqual(prev, list) ? prev : list));
      setThreadHasMore(list.length >= threadPageSize);
      setActiveThreadId((prev) => {
        if (prev && list.some((item) => item.id === prev)) return prev;
        return list[0]?.id || "";
      });
    } catch (err: any) {
      if (!silent) {
        setThreads([]);
        setActiveThreadId("");
        toast.error(typeof err?.message === "string" ? err.message : "Failed to load support threads");
      }
    } finally {
      if (!silent) setLoadingThreads(false);
    }
  }, [statusFilter, threadPage, threadPageSize]);

  const loadMessages = useCallback(async (threadId: string, opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!threadId) {
      if (!silent) setMessages([]);
      return;
    }
    if (!silent) setLoadingMessages(true);
    try {
      const raw = await api.get<unknown>(
        `/support/tenant/threads/${threadId}/messages?limit=500&offset=0`,
        { tenantRequired: true, noRedirect: true }
      );
      const list = normalizeSupportMessages(raw);
      setMessages((prev) => (areSupportMessagesEqual(prev, list) ? prev : list));
      await api.post(
        `/support/tenant/threads/${threadId}/read`,
        {},
        { tenantRequired: true, noRedirect: true }
      );
      setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, unread_for_tenant: 0 } : t)));
    } catch (err: any) {
      if (!silent) {
        setMessages([]);
        toast.error(typeof err?.message === "string" ? err.message : "Failed to load conversation");
      }
    } finally {
      if (!silent) setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    setThreadPage(1);
  }, [statusFilter, threadPageSize]);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    if (!activeThreadId) {
      setMessages([]);
      return;
    }
    setReplyTarget(null);
    keepPinnedToBottomRef.current = true;
    void loadMessages(activeThreadId, { silent: false });
  }, [activeThreadId, loadMessages]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadThreads({ silent: true });
    }, 8000);
    return () => window.clearInterval(timer);
  }, [loadThreads]);

  useEffect(() => {
    if (!activeThreadId) return;
    const timer = window.setInterval(() => {
      void loadMessages(activeThreadId, { silent: true });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [activeThreadId, loadMessages]);

  useEffect(() => {
    if (messages.length === 0) return;
    const frame = window.requestAnimationFrame(() => {
      scrollToBottomIfNeeded(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, scrollToBottomIfNeeded]);

  const activeThread = useMemo(
    () => threads.find((row) => row.id === activeThreadId) || null,
    [threads, activeThreadId]
  );

  async function createThread() {
    const text = openingMessage.trim();
    if (!text) {
      toast.error("Please enter your support message.");
      return;
    }

    setCreatingThread(true);
    try {
      const created = await api.post<unknown>(
        "/support/tenant/threads",
        {
          subject: subject.trim() || null,
          priority,
          message: text,
        },
        { tenantRequired: true, noRedirect: true }
      );
      const thread = normalizeSupportThreads([created])[0];
      if (thread) {
        setThreads((prev) => [thread, ...prev.filter((item) => item.id !== thread.id)]);
        setActiveThreadId(thread.id);
      }
      setSubject("");
      setPriority("NORMAL");
      setOpeningMessage("");
      toast.success("Support ticket created and sent to SaaS Admin.");
      await loadThreads({ silent: true });
      if (thread) await loadMessages(thread.id, { silent: true });
    } catch (err: any) {
      toast.error(typeof err?.message === "string" ? err.message : "Failed to create support ticket");
    } finally {
      setCreatingThread(false);
    }
  }

  async function sendReply() {
    if (!activeThreadId) {
      toast.error("Select a support ticket first.");
      return;
    }

    const text = replyMessage.trim();
    if (!text) {
      toast.error("Please type your reply message.");
      return;
    }

    setSendingReply(true);
    try {
      keepPinnedToBottomRef.current = true;
      await api.post(
        `/support/tenant/threads/${activeThreadId}/messages`,
        { message: text, reply_to_message_id: replyTarget?.id ?? null },
        { tenantRequired: true, noRedirect: true }
      );
      setReplyMessage("");
      setReplyTarget(null);
      await loadMessages(activeThreadId, { silent: true });
      await loadThreads({ silent: true });
      toast.success("Reply sent to SaaS Admin.");
    } catch (err: any) {
      toast.error(typeof err?.message === "string" ? err.message : "Failed to send reply");
    } finally {
      setSendingReply(false);
    }
  }

  return (
    <AppShell title={appTitle} nav={nav} activeHref={activeHref}>
      <div className="space-y-5">
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-600 to-blue-500 p-5 text-white shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold">Contact Admin</h1>
              <p className="mt-0.5 text-sm text-blue-100">
                Open support tickets and chat directly with the SaaS Admin for troubleshooting.
              </p>
            </div>
            <Button
              variant="outline"
              className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              onClick={() => void loadThreads()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">New Ticket</CardTitle>
              <CardDescription>Create a support request for SaaS Admin.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Subject</Label>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Finance posting issue"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Priority</Label>
                <Select value={priority} onValueChange={(value) => setPriority(value as SupportThreadPriority)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOW">Low</SelectItem>
                    <SelectItem value="NORMAL">Normal</SelectItem>
                    <SelectItem value="HIGH">High</SelectItem>
                    <SelectItem value="URGENT">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Message *</Label>
                <Textarea
                  value={openingMessage}
                  onChange={(e) => setOpeningMessage(e.target.value)}
                  placeholder="Describe the issue clearly so support can help quickly."
                  className="min-h-[120px]"
                />
              </div>
              <Button onClick={() => void createThread()} disabled={creatingThread} className="w-full">
                <Headset className="h-4 w-4" />
                {creatingThread ? "Creating..." : "Create Ticket"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">Ticket Inbox</CardTitle>
                  <CardDescription>Track all your active and historical support conversations.</CardDescription>
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-8 w-[170px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All statuses</SelectItem>
                    <SelectItem value="OPEN">Open</SelectItem>
                    <SelectItem value="WAITING_ADMIN">Waiting Admin</SelectItem>
                    <SelectItem value="WAITING_TENANT">Waiting You</SelectItem>
                    <SelectItem value="RESOLVED">Resolved</SelectItem>
                    <SelectItem value="CLOSED">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
                <div className="flex h-[520px] flex-col rounded-md border border-slate-200">
                  <div className="min-h-0 flex-1 overflow-y-auto p-2">
                    {loadingThreads && (
                      <div className="px-2 py-6 text-xs text-slate-500">Loading support tickets...</div>
                    )}
                    {!loadingThreads && threads.length === 0 && (
                      <div className="px-2 py-6 text-xs text-slate-500">No support tickets yet.</div>
                    )}
                    {!loadingThreads &&
                      threads.map((thread) => {
                        const active = thread.id === activeThreadId;
                        return (
                          <button
                            key={thread.id}
                            type="button"
                            onClick={() => setActiveThreadId(thread.id)}
                            className={`mb-2 w-full rounded-lg border px-3 py-2 text-left transition ${
                              active
                                ? "border-blue-300 bg-blue-50"
                                : "border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/40"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="truncate text-xs font-semibold text-slate-900">{thread.subject}</div>
                              {thread.unread_for_tenant > 0 && (
                                <Badge className="bg-red-600 text-white">{thread.unread_for_tenant}</Badge>
                              )}
                            </div>
                            <div className="mt-1 flex items-center gap-1.5">
                              <Badge variant="outline" className={`text-[10px] ${statusBadgeClass(thread.status)}`}>
                                {supportStatusLabel(thread.status)}
                              </Badge>
                              <Badge variant="outline" className="text-[10px]">
                                {supportPriorityLabel(thread.priority)}
                              </Badge>
                            </div>
                            <div className="mt-1 line-clamp-2 text-[11px] text-slate-600">
                              {thread.last_message_preview || "No message preview."}
                            </div>
                            <div className="mt-1 text-[10px] text-slate-400">
                              {formatDateTime(thread.last_message_at)}
                            </div>
                          </button>
                        );
                      })}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-2 py-2">
                    <div className="text-[11px] text-slate-500">Page {threadPage}</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-slate-500">Rows</span>
                      <Select
                        value={String(threadPageSize)}
                        onValueChange={(value) =>
                          setThreadPageSize(Number(value) as (typeof THREAD_PAGE_SIZE_OPTIONS)[number])
                        }
                      >
                        <SelectTrigger className="h-7 w-[84px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {THREAD_PAGE_SIZE_OPTIONS.map((size) => (
                            <SelectItem key={size} value={String(size)}>
                              {size}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={loadingThreads || threadPage <= 1}
                        onClick={() => setThreadPage((prev) => Math.max(1, prev - 1))}
                      >
                        Prev
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={loadingThreads || !threadHasMore}
                        onClick={() => setThreadPage((prev) => prev + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="flex h-[520px] flex-col rounded-md border border-slate-200">
                  <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        {activeThread?.subject || "Select a ticket"}
                      </div>
                      {activeThread && (
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          Last update: {formatDateTime(activeThread.last_message_at)}
                        </div>
                      )}
                    </div>
                    {activeThread && (
                      <Badge variant="outline" className={`text-[10px] ${statusBadgeClass(activeThread.status)}`}>
                        {supportStatusLabel(activeThread.status)}
                      </Badge>
                    )}
                  </div>

                  <div
                    ref={messagesRef}
                    onScroll={updatePinState}
                    className="flex-1 overflow-y-auto px-3 py-3"
                  >
                    {!activeThread && (
                      <div className="pt-16 text-center text-sm text-slate-500">Pick a ticket to view messages.</div>
                    )}
                    {activeThread && loadingMessages && (
                      <div className="text-xs text-slate-500">Loading conversation...</div>
                    )}
                    {activeThread && !loadingMessages && messages.length === 0 && (
                      <div className="text-xs text-slate-500">No messages yet.</div>
                    )}
                    {activeThread &&
                      messages.map((msg) => {
                        const isTenant = msg.sender_mode === "TENANT";
                        const replySenderLabel =
                          msg.reply_to_sender_mode === "TENANT"
                            ? "You"
                            : (msg.reply_to_sender_name || "SaaS Admin");
                        return (
                          <div
                            key={msg.id}
                            className={`mb-2 flex ${isTenant ? "justify-end" : "justify-start"}`}
                          >
                            <div
                              className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                                isTenant
                                  ? "bg-blue-600 text-white"
                                  : "border border-slate-200 bg-white text-slate-800"
                              }`}
                            >
                              {msg.reply_to_body && (
                                <div
                                  className={`mb-1 rounded border-l-2 px-2 py-1 text-[11px] ${
                                    isTenant
                                      ? "border-blue-200 bg-blue-500/25 text-blue-50"
                                      : "border-slate-300 bg-slate-100 text-slate-600"
                                  }`}
                                >
                                  <div className="font-semibold">{replySenderLabel}</div>
                                  <div className="line-clamp-2 break-words">{msg.reply_to_body}</div>
                                </div>
                              )}
                              <div className="whitespace-pre-wrap break-words">{msg.body}</div>
                              <div className="mt-1 flex items-center justify-between gap-2">
                                <div
                                  className={`text-[10px] ${isTenant ? "text-blue-100" : "text-slate-400"}`}
                                >
                                  {isTenant ? "You" : msg.sender_name || "SaaS Admin"} · {formatDateTime(msg.created_at)}
                                </div>
                                {activeThread && (
                                  <button
                                    type="button"
                                    onClick={() => setReplyTarget(msg)}
                                    className={`inline-flex items-center gap-1 text-[10px] ${
                                      isTenant ? "text-blue-100 hover:text-white" : "text-slate-500 hover:text-slate-800"
                                    }`}
                                  >
                                    <Reply className="h-3 w-3" />
                                    Reply
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                  </div>

                  <Separator />

                  <div className="space-y-2 p-3">
                    {replyTarget && (
                      <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-[11px] font-semibold text-blue-700">
                              Replying to {replyTarget.sender_mode === "TENANT" ? "your message" : (replyTarget.sender_name || "SaaS Admin")}
                            </div>
                            <div className="line-clamp-2 text-xs text-blue-800">{replyTarget.body}</div>
                          </div>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-blue-700 hover:bg-blue-100"
                            onClick={() => setReplyTarget(null)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    )}
                    <Textarea
                      value={replyMessage}
                      onChange={(e) => setReplyMessage(e.target.value)}
                      placeholder={activeThread ? "Type your reply..." : "Select a ticket first"}
                      className="min-h-[92px]"
                      disabled={!activeThread || sendingReply}
                    />
                    <div className="flex justify-end">
                      <Button
                        onClick={() => void sendReply()}
                        disabled={!activeThread || sendingReply}
                        className="min-w-[120px]"
                      >
                        <Send className="h-4 w-4" />
                        {sendingReply ? "Sending..." : "Send Reply"}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
