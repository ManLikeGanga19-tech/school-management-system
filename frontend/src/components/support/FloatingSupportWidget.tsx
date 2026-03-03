"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Headset, Send, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import {
  areSupportMessagesEqual,
  areSupportThreadsEqual,
  normalizeSupportMessages,
  normalizeSupportThreads,
  normalizeSupportUnreadCount,
  type SupportMessage,
  type SupportThread,
} from "@/lib/support";

type FloatingSupportWidgetProps = {
  enabled: boolean;
  pageHref: string;
};

function formatTime(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
}

export function FloatingSupportWidget({ enabled, pageHref }: FloatingSupportWidgetProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [activeThreadId, setActiveThreadId] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [draft, setDraft] = useState("");
  const latestMessageIdRef = useRef<string>("");
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const keepPinnedToBottomRef = useRef(true);

  const updatePinState = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    keepPinnedToBottomRef.current = distanceToBottom <= 64;
  }, []);

  const scrollToBottomIfNeeded = useCallback((force = false) => {
    const el = messagesRef.current;
    if (!el) return;
    if (force || keepPinnedToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  const activeThread = useMemo(
    () => threads.find((row) => row.id === activeThreadId) || null,
    [threads, activeThreadId]
  );

  const loadUnreadCount = useCallback(async () => {
    if (!enabled) return;
    try {
      const raw = await api.get<unknown>("/support/tenant/unread-count", {
        tenantRequired: true,
        noRedirect: true,
      });
      setUnreadCount(normalizeSupportUnreadCount(raw));
    } catch {
      setUnreadCount(0);
    }
  }, [enabled]);

  const loadThreads = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!enabled) return;
    if (!silent) setLoading(true);
    try {
      const raw = await api.get<unknown>("/support/tenant/threads?limit=30&offset=0", {
        tenantRequired: true,
        noRedirect: true,
      });
      const list = normalizeSupportThreads(raw);
      setThreads((prev) => (areSupportThreadsEqual(prev, list) ? prev : list));
      setActiveThreadId((prev) => {
        if (prev && list.some((item) => item.id === prev)) return prev;
        return list[0]?.id || "";
      });
    } catch {
      if (!silent) {
        setThreads([]);
        setActiveThreadId("");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [enabled]);

  const loadMessages = useCallback(async (threadId: string, opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!enabled || !threadId) {
      if (!silent) setMessages([]);
      return;
    }
    try {
      const raw = await api.get<unknown>(
        `/support/tenant/threads/${threadId}/messages?limit=120&offset=0`,
        {
          tenantRequired: true,
          noRedirect: true,
        }
      );
      const list = normalizeSupportMessages(raw);
      setMessages((prev) => (areSupportMessagesEqual(prev, list) ? prev : list));
      if (list.length > 0) {
        const latest = list[list.length - 1];
        if (
          latest.sender_mode === "SAAS_ADMIN" &&
          latest.id !== latestMessageIdRef.current &&
          latestMessageIdRef.current
        ) {
          toast.info("New admin reply", { description: latest.body.slice(0, 120) });
        }
        latestMessageIdRef.current = latest.id;
      }
      await api.post(
        `/support/tenant/threads/${threadId}/read`,
        {},
        { tenantRequired: true, noRedirect: true }
      );
      setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, unread_for_tenant: 0 } : t)));
      void loadUnreadCount();
    } catch {
      if (!silent) setMessages([]);
    }
  }, [enabled, loadUnreadCount]);

  useEffect(() => {
    if (!enabled) {
      setOpen(false);
      setThreads([]);
      setMessages([]);
      setUnreadCount(0);
      setActiveThreadId("");
      return;
    }
    void loadUnreadCount();
  }, [enabled, loadUnreadCount]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      void loadUnreadCount();
      if (open) void loadThreads({ silent: true });
    }, 8000);
    return () => window.clearInterval(timer);
  }, [enabled, loadUnreadCount, loadThreads, open]);

  useEffect(() => {
    if (!enabled || !open) return;
    void loadThreads();
  }, [enabled, open, loadThreads]);

  useEffect(() => {
    if (!enabled || !open || !activeThreadId) {
      setMessages([]);
      return;
    }
    keepPinnedToBottomRef.current = true;
    void loadMessages(activeThreadId, { silent: false });
    const timer = window.setInterval(() => {
      void loadMessages(activeThreadId, { silent: true });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [enabled, open, activeThreadId, loadMessages]);

  useEffect(() => {
    if (messages.length === 0) return;
    const frame = window.requestAnimationFrame(() => {
      scrollToBottomIfNeeded(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, scrollToBottomIfNeeded]);

  async function sendMessage() {
    if (!enabled) return;
    const text = draft.trim();
    if (!text) return;

    setSending(true);
    try {
      keepPinnedToBottomRef.current = true;
      if (!activeThreadId) {
        const createdRaw = await api.post<unknown>(
          "/support/tenant/threads",
          {
            subject: "Quick Support Chat",
            priority: "NORMAL",
            message: text,
          },
          { tenantRequired: true, noRedirect: true }
        );
        const createdThread = normalizeSupportThreads([createdRaw])[0];
        if (createdThread) {
          setActiveThreadId(createdThread.id);
          setThreads((prev) => [createdThread, ...prev]);
          setDraft("");
          await loadMessages(createdThread.id, { silent: true });
          await loadThreads({ silent: true });
          toast.success("Message sent to SaaS Admin.");
        }
      } else {
        await api.post(
          `/support/tenant/threads/${activeThreadId}/messages`,
          { message: text },
          { tenantRequired: true, noRedirect: true }
        );
        setDraft("");
        await loadMessages(activeThreadId, { silent: true });
        await loadThreads({ silent: true });
      }
    } catch (err: any) {
      toast.error(typeof err?.message === "string" ? err.message : "Failed to send support message");
    } finally {
      setSending(false);
    }
  }

  if (!enabled) return null;

  return (
    <>
      <Button
        type="button"
        size="icon"
        className="fixed bottom-5 right-5 z-[60] h-14 w-14 rounded-full bg-blue-600 shadow-lg hover:bg-blue-700"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Contact Admin"
      >
        <Headset className="h-6 w-6" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Button>

      {open && (
        <div className="fixed bottom-24 right-5 z-[60] w-[380px] max-w-[calc(100vw-1.5rem)] rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
            <div>
              <div className="text-sm font-semibold text-slate-900">Contact Admin</div>
              <div className="text-[11px] text-slate-500">Quick support chat</div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href={pageHref}>Open Full</Link>
              </Button>
              <Button type="button" variant="ghost" size="icon" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="px-3 py-2">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {threads.slice(0, 4).map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => setActiveThreadId(thread.id)}
                  className={`rounded-full border px-2 py-0.5 text-[10px] ${
                    thread.id === activeThreadId
                      ? "border-blue-300 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  {thread.subject}
                  {thread.unread_for_tenant > 0 ? ` (${thread.unread_for_tenant})` : ""}
                </button>
              ))}
            </div>

            <div
              ref={messagesRef}
              onScroll={updatePinState}
              className="h-[280px] overflow-y-auto rounded-md border border-slate-200 p-2"
            >
              {loading && <div className="text-xs text-slate-500">Loading support chat...</div>}
              {!loading && messages.length === 0 && (
                <div className="pt-12 text-center text-xs text-slate-500">
                  Send a message to start chatting with SaaS Admin.
                </div>
              )}
              {messages.map((msg) => {
                const isTenant = msg.sender_mode === "TENANT";
                return (
                  <div key={msg.id} className={`mb-2 flex ${isTenant ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[85%] rounded-xl px-2.5 py-2 text-xs ${
                        isTenant
                          ? "bg-blue-600 text-white"
                          : "border border-slate-200 bg-white text-slate-800"
                      }`}
                    >
                      {msg.reply_to_body && (
                        <div
                          className={`mb-1 rounded border-l-2 px-2 py-1 text-[10px] ${
                            isTenant
                              ? "border-blue-200 bg-blue-500/25 text-blue-50"
                              : "border-slate-300 bg-slate-100 text-slate-600"
                          }`}
                        >
                          <div className="font-semibold">
                            {msg.reply_to_sender_mode === "TENANT" ? "You" : (msg.reply_to_sender_name || "SaaS Admin")}
                          </div>
                          <div className="line-clamp-2 break-words">{msg.reply_to_body}</div>
                        </div>
                      )}
                      <div className="whitespace-pre-wrap break-words">{msg.body}</div>
                      <div className={`mt-1 text-[10px] ${isTenant ? "text-blue-100" : "text-slate-400"}`}>
                        {isTenant ? "You" : msg.sender_name || "SaaS Admin"} · {formatTime(msg.created_at)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-2 space-y-2">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type your support message..."
                className="min-h-[86px]"
                disabled={sending}
              />
              <div className="flex items-center justify-between">
                {activeThread && (
                  <Badge variant="outline" className="text-[10px]">
                    {activeThread.status.replaceAll("_", " ")}
                  </Badge>
                )}
                <Button onClick={() => void sendMessage()} disabled={sending}>
                  <Send className="h-4 w-4" />
                  {sending ? "Sending..." : "Send"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
