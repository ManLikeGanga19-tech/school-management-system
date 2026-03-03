import { asArray } from "@/lib/utils/asArray";

type UnknownRecord = Record<string, unknown>;

function asObject(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

export type SupportThreadStatus =
  | "OPEN"
  | "WAITING_ADMIN"
  | "WAITING_TENANT"
  | "RESOLVED"
  | "CLOSED";

export type SupportThreadPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type SupportSenderMode = "TENANT" | "SAAS_ADMIN" | "SYSTEM";

export type SupportThread = {
  id: string;
  tenant_id: string;
  tenant_name: string | null;
  tenant_slug: string | null;
  subject: string;
  status: SupportThreadStatus;
  priority: SupportThreadPriority;
  last_message_preview: string | null;
  unread_for_tenant: number;
  unread_for_admin: number;
  created_at: string | null;
  updated_at: string | null;
  last_message_at: string | null;
};

export type SupportMessage = {
  id: string;
  thread_id: string;
  tenant_id: string;
  sender_user_id: string | null;
  sender_mode: SupportSenderMode;
  sender_name: string | null;
  sender_email: string | null;
  reply_to_message_id: string | null;
  reply_to_body: string | null;
  reply_to_sender_mode: SupportSenderMode | null;
  reply_to_sender_name: string | null;
  body: string;
  created_at: string | null;
};

export function normalizeSupportThreads(input: unknown): SupportThread[] {
  return asArray<unknown>(input)
    .map((raw): SupportThread | null => {
      const row = asObject(raw);
      if (!row) return null;
      const id = asString(row.id);
      const tenantId = asString(row.tenant_id);
      if (!id || !tenantId) return null;

      const status = asString(row.status).toUpperCase() as SupportThreadStatus;
      const priority = asString(row.priority).toUpperCase() as SupportThreadPriority;

      return {
        id,
        tenant_id: tenantId,
        tenant_name: asString(row.tenant_name) || null,
        tenant_slug: asString(row.tenant_slug) || null,
        subject: asString(row.subject) || "General Support",
        status:
          status === "OPEN" ||
          status === "WAITING_ADMIN" ||
          status === "WAITING_TENANT" ||
          status === "RESOLVED" ||
          status === "CLOSED"
            ? status
            : "OPEN",
        priority:
          priority === "LOW" ||
          priority === "NORMAL" ||
          priority === "HIGH" ||
          priority === "URGENT"
            ? priority
            : "NORMAL",
        last_message_preview: asString(row.last_message_preview) || null,
        unread_for_tenant: asNumber(row.unread_for_tenant),
        unread_for_admin: asNumber(row.unread_for_admin),
        created_at: asString(row.created_at) || null,
        updated_at: asString(row.updated_at) || null,
        last_message_at: asString(row.last_message_at) || null,
      };
    })
    .filter((row): row is SupportThread => Boolean(row));
}

export function normalizeSupportMessages(input: unknown): SupportMessage[] {
  return asArray<unknown>(input)
    .map((raw): SupportMessage | null => {
      const row = asObject(raw);
      if (!row) return null;
      const id = asString(row.id);
      const threadId = asString(row.thread_id);
      const tenantId = asString(row.tenant_id);
      if (!id || !threadId || !tenantId) return null;

      const senderMode = asString(row.sender_mode).toUpperCase() as SupportSenderMode;
      const replySenderMode = asString(row.reply_to_sender_mode).toUpperCase() as SupportSenderMode;
      return {
        id,
        thread_id: threadId,
        tenant_id: tenantId,
        sender_user_id: asString(row.sender_user_id) || null,
        sender_mode:
          senderMode === "TENANT" || senderMode === "SAAS_ADMIN" || senderMode === "SYSTEM"
            ? senderMode
            : "TENANT",
        sender_name: asString(row.sender_name) || null,
        sender_email: asString(row.sender_email) || null,
        reply_to_message_id: asString(row.reply_to_message_id) || null,
        reply_to_body: asString(row.reply_to_body) || null,
        reply_to_sender_mode:
          replySenderMode === "TENANT" || replySenderMode === "SAAS_ADMIN" || replySenderMode === "SYSTEM"
            ? replySenderMode
            : null,
        reply_to_sender_name: asString(row.reply_to_sender_name) || null,
        body: asString(row.body),
        created_at: asString(row.created_at) || null,
      };
    })
    .filter((row): row is SupportMessage => Boolean(row));
}

export function normalizeSupportUnreadCount(input: unknown): number {
  const row = asObject(input);
  if (!row) return 0;
  return asNumber(row.unread_count);
}

export function areSupportThreadsEqual(a: SupportThread[], b: SupportThread[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (left.id !== right.id) return false;
    if (left.status !== right.status) return false;
    if (left.priority !== right.priority) return false;
    if (left.subject !== right.subject) return false;
    if (left.last_message_preview !== right.last_message_preview) return false;
    if (left.unread_for_tenant !== right.unread_for_tenant) return false;
    if (left.unread_for_admin !== right.unread_for_admin) return false;
    if (left.last_message_at !== right.last_message_at) return false;
    if (left.updated_at !== right.updated_at) return false;
  }
  return true;
}

export function areSupportMessagesEqual(a: SupportMessage[], b: SupportMessage[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (left.id !== right.id) return false;
    if (left.body !== right.body) return false;
    if (left.sender_mode !== right.sender_mode) return false;
    if (left.sender_name !== right.sender_name) return false;
    if (left.reply_to_message_id !== right.reply_to_message_id) return false;
    if (left.reply_to_body !== right.reply_to_body) return false;
    if (left.reply_to_sender_mode !== right.reply_to_sender_mode) return false;
    if (left.reply_to_sender_name !== right.reply_to_sender_name) return false;
    if (left.created_at !== right.created_at) return false;
  }
  return true;
}

export function supportStatusLabel(status: SupportThreadStatus): string {
  if (status === "WAITING_ADMIN") return "Waiting Admin";
  if (status === "WAITING_TENANT") return "Waiting You";
  if (status === "RESOLVED") return "Resolved";
  if (status === "CLOSED") return "Closed";
  return "Open";
}

export function supportPriorityLabel(priority: SupportThreadPriority): string {
  if (priority === "URGENT") return "Urgent";
  if (priority === "HIGH") return "High";
  if (priority === "LOW") return "Low";
  return "Normal";
}
