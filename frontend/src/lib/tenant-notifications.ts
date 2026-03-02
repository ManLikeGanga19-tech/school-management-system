import { asArray } from "@/lib/utils/asArray";

export type TenantNotificationPreview = {
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

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeTenantNotificationPreviews(input: unknown): TenantNotificationPreview[] {
  return asArray<unknown>(input)
    .map((raw): TenantNotificationPreview | null => {
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
    .filter((row): row is TenantNotificationPreview => Boolean(row))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function parseTenantUnreadCount(input: unknown): number | null {
  const payload = asObject(input);
  if (!payload) return null;
  const parsed = Number(payload.unread_count);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}
